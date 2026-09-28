import { describe, it, expect, beforeEach } from "vitest";
import {
  pendingAdvanceVerdict,
  applyPendingAdvances,
  columnScopes,
  groupScope,
  hasPendingAdvance,
  markPendingAdvance,
  pendingAdvanceIds,
  stageScope,
  PENDING_ADVANCE_TTL_MS,
  sharedPendingAdvances,
  resetPendingAdvances,
} from "./pendingAdvance";

const T = 1_700_000_000_000;

describe("pendingAdvanceVerdict", () => {
  it("hides while the claim is inside its window", () => {
    expect(pendingAdvanceVerdict(T, T)).toBe("hide");
    expect(pendingAdvanceVerdict(T, T + 29_000)).toBe("hide");
  });

  it("lapses at the TTL, so a patient whose advance never landed comes back", () => {
    expect(pendingAdvanceVerdict(T, T + PENDING_ADVANCE_TTL_MS)).toBe("expired");
    expect(pendingAdvanceVerdict(T, T + PENDING_ADVANCE_TTL_MS + 1)).toBe("expired");
  });

  it("gives a real advance far more time than it needs", () => {
    // A 30s poll + Monday indexing + the group-move automation + the gateway's
    // ~26s of job retries must all fit, or a patient who DID advance flickers.
    expect(PENDING_ADVANCE_TTL_MS).toBeGreaterThan(60_000);
    expect(pendingAdvanceVerdict(T, T + 60_000)).toBe("hide");
  });
});

describe("applyPendingAdvances", () => {
  const q = (...ids: string[]) => ids.map((id) => ({ id }));
  const S = "group:test-queue";
  const claims = (...entries: [string, number][]) => {
    const m = new Map<string, number>();
    for (const [id, at] of entries) markPendingAdvance(m, S, id, at);
    return m;
  };

  it("is a no-op with nothing pending — same array back", () => {
    const list = q("1", "2");
    expect(applyPendingAdvances(list, new Map(), S, T)).toBe(list);
  });

  it("hides a marked patient", () => {
    expect(applyPendingAdvances(q("1", "2"), claims(["1", T]), S, T + 1_000)).toEqual([{ id: "2" }]);
  });

  it("RETURNS the patient once the claim lapses", () => {
    const pending = claims(["1", T]);
    const out = applyPendingAdvances(q("1", "2"), pending, S, T + PENDING_ADVANCE_TTL_MS + 1);
    expect(out).toEqual([{ id: "1" }, { id: "2" }]);
    expect(pending.size).toBe(0);
  });

  it("NEVER spends a marker just because the patient is missing from the list", () => {
    // The Greptile finding. Every fetchGroupItems swallows a pagination error
    // and returns the pages it got, so a patient still in the stage can simply
    // be absent from a poll. Spending the marker there un-hides them early,
    // with a live Send button — the re-send window this exists to close.
    const pending = claims(["1", T]);
    applyPendingAdvances(q("2", "3"), pending, S, T + 1_000);
    expect(hasPendingAdvance(pending, S, "1", T + 1_000)).toBe(true);

    // ...and a later, complete poll still finds them hidden.
    expect(applyPendingAdvances(q("1", "2", "3"), pending, S, T + 2_000)).toEqual([
      { id: "2" },
      { id: "3" },
    ]);
  });

  it("is safe to apply twice — hiding at commit time must be idempotent", () => {
    // The hooks filter at the point of setPatients, and a caller may well have
    // filtered an intermediate list too.
    const pending = claims(["1", T]);
    const once = applyPendingAdvances(q("1", "2"), pending, S, T + 1_000);
    const twice = applyPendingAdvances(once, pending, S, T + 1_000);
    expect(twice).toEqual([{ id: "2" }]);
    expect(hasPendingAdvance(pending, S, "1", T + 1_000)).toBe(true);
  });

  it("lapses each marker on its own clock", () => {
    const pending = claims(["fresh", T], ["stale", T - PENDING_ADVANCE_TTL_MS - 1]);
    const out = applyPendingAdvances(q("fresh", "stale", "other"), pending, S, T);
    expect(out.map((p) => p.id)).toEqual(["stale", "other"]);
    expect(pendingAdvanceIds(pending)).toEqual(["fresh"]);
  });

  it("never invents a patient the queue did not contain", () => {
    // Lapsing only un-hides; it can't add somebody the filter excluded.
    const pending = claims(["ghost", T - PENDING_ADVANCE_TTL_MS - 1]);
    expect(applyPendingAdvances(q("1"), pending, S, T)).toEqual([{ id: "1" }]);
  });
});

describe("claims are scoped to the queue the patient LEFT (2026-09-28)", () => {
  const q = (...ids: string[]) => ids.map((id) => ({ id }));

  it("an Evaluate advance hides the patient on Evaluate and NOT on Send Request", () => {
    // Cursor's launch-bugs item 1. Medical Evaluation keeps every live
    // sub-stage in one group with one item id, so the unscoped claim that took
    // a patient out of Evaluate also hid them from Send Request — the queue
    // they had just arrived in — for fifteen minutes.
    const pending = new Map<string, number>();
    const evaluate = stageScope("medicalEvaluation", "evaluate");
    const sendRequest = stageScope("medicalEvaluation", "sendRequest");
    markPendingAdvance(pending, evaluate, "12936243860", T);
    expect(applyPendingAdvances(q("12936243860", "2"), pending, evaluate, T + 1)).toEqual([{ id: "2" }]);
    expect(applyPendingAdvances(q("12936243860", "3"), pending, sendRequest, T + 1)).toEqual([
      { id: "12936243860" },
      { id: "3" },
    ]);
  });

  it("the same holds for the group queues — Benefits → Submit Auth, Welcome Call → Final Confirm", () => {
    const pending = new Map<string, number>();
    markPendingAdvance(pending, groupScope("benefits-group"), "1", T);
    expect(hasPendingAdvance(pending, groupScope("benefits-group"), "1", T + 1)).toBe(true);
    expect(hasPendingAdvance(pending, groupScope("submit-auth-group"), "1", T + 1)).toBe(false);
  });

  it("a deep link into the NEXT queue is not refused by the previous queue's claim", () => {
    const pending = new Map<string, number>();
    markPendingAdvance(pending, groupScope("welcome-call"), "9", T);
    expect(hasPendingAdvance(pending, groupScope("final-confirm"), "9", T + 1)).toBe(false);
  });

  it("an expired claim answers no to hasPendingAdvance", () => {
    const pending = new Map<string, number>();
    markPendingAdvance(pending, "group:x", "1", T);
    expect(hasPendingAdvance(pending, "group:x", "1", T + PENDING_ADVANCE_TTL_MS)).toBe(false);
  });

  it("groupScope keys several groups as one population", () => {
    expect(groupScope(["a", "b"])).toBe(groupScope(["a", "b"]));
    expect(groupScope(["a", "b"])).not.toBe(groupScope("a"));
  });
});

describe("columnScopes — a Care Coordinator column shows several groups", () => {
  const FORM_A = "form-completed";
  const FORM_B = "form-partial";
  const CLEAN = "clean-up";
  const COLUMN = [FORM_B, FORM_A, CLEAN];
  const rows = (...r: [string, string][]) => r.map(([id, groupId]) => ({ id, groupId }));
  const apply = (pending: Map<string, number>, list: { id: string; groupId: string }[]) =>
    applyPendingAdvances(list, pending, (l) => columnScopes(l.groupId, COLUMN), T + 1);

  it("Info Collection → Clean-Up MOVES the card: a row already reported in Clean-Up stays", () => {
    const pending = new Map<string, number>();
    markPendingAdvance(pending, groupScope(FORM_A), "13133155597", T);
    expect(apply(pending, rows(["13133155597", CLEAN]))).toEqual(rows(["13133155597", CLEAN]));
  });

  it("…while the read still reports the group it left, the card is hidden", () => {
    const pending = new Map<string, number>();
    markPendingAdvance(pending, groupScope(FORM_A), "13133155597", T);
    expect(apply(pending, rows(["13133155597", FORM_A], ["2", FORM_A]))).toEqual(rows(["2", FORM_A]));
  });

  it("Clean-Up → Medical Necessity: a lagging read reporting a group OUTSIDE the column is hidden", () => {
    const pending = new Map<string, number>();
    markPendingAdvance(pending, groupScope(CLEAN), "5", T);
    expect(apply(pending, rows(["5", "completed-group"]))).toEqual([]);
    expect(apply(pending, rows(["5", CLEAN]))).toEqual([]);
  });

  it("a row with no group is unknown — any claim from the column hides it, as before", () => {
    const pending = new Map<string, number>();
    markPendingAdvance(pending, groupScope(FORM_A), "6", T);
    expect(apply(pending, rows(["6", ""]))).toEqual([]);
  });

  it("claims from queues outside the column never hide a card in it", () => {
    const pending = new Map<string, number>();
    markPendingAdvance(pending, groupScope("1-intake"), "7", T);
    markPendingAdvance(pending, stageScope("medicalEvaluation", "evaluate"), "7", T);
    expect(apply(pending, rows(["7", FORM_B]))).toEqual(rows(["7", FORM_B]));
  });
});

describe("the shared claim store (Keith Dye, 2026-09-25)", () => {
  const q = (...ids: string[]) => ids.map((id) => ({ id }));

  beforeEach(() => resetPendingAdvances());

  it("one map serves every queue and screen — a claim written anywhere is readable everywhere", () => {
    // The two holes the per-hook `useRef(new Map())` had: leaving the page
    // threw the claim away, and no other screen (the Care Coordinator
    // dashboard) could consult it. This pins that the module EXPORTS the one
    // map; which screens HONOUR a claim is the scope's job (above).
    markPendingAdvance(sharedPendingAdvances, "group:intake", "13133155597", T);
    expect(applyPendingAdvances(q("13133155597", "2"), sharedPendingAdvances, "group:intake", T + 1)).toEqual([{ id: "2" }]);
  });

  it("the TTL outlasts Monday's read-index lag", () => {
    // Keith Dye: the automation moved him 1.7s after the advancer flipped, yet
    // the group-filtered items_page kept returning him for ~10 minutes. Two
    // minutes of hiding put him back — with a live Advance button — for the
    // rest of that lag.
    expect(PENDING_ADVANCE_TTL_MS).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it("resetPendingAdvances empties it — the test seam", () => {
    markPendingAdvance(sharedPendingAdvances, "group:x", "1", T);
    resetPendingAdvances();
    expect(sharedPendingAdvances.size).toBe(0);
  });
});
