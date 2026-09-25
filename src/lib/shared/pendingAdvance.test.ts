import { describe, it, expect, beforeEach } from "vitest";
import {
  pendingAdvanceVerdict,
  applyPendingAdvances,
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

  it("is a no-op with nothing pending — same array back", () => {
    const list = q("1", "2");
    expect(applyPendingAdvances(list, new Map(), T)).toBe(list);
  });

  it("hides a marked patient", () => {
    const pending = new Map([["1", T]]);
    expect(applyPendingAdvances(q("1", "2"), pending, T + 1_000)).toEqual([{ id: "2" }]);
  });

  it("RETURNS the patient once the claim lapses", () => {
    const pending = new Map([["1", T]]);
    const out = applyPendingAdvances(q("1", "2"), pending, T + PENDING_ADVANCE_TTL_MS + 1);
    expect(out).toEqual([{ id: "1" }, { id: "2" }]);
    expect(pending.size).toBe(0);
  });

  it("NEVER spends a marker just because the patient is missing from the list", () => {
    // The Greptile finding. Every fetchGroupItems swallows a pagination error
    // and returns the pages it got, so a patient still in the stage can simply
    // be absent from a poll. Spending the marker there un-hides them early,
    // with a live Send button — the re-send window this exists to close.
    const pending = new Map([["1", T]]);
    applyPendingAdvances(q("2", "3"), pending, T + 1_000);
    expect(pending.has("1")).toBe(true);

    // ...and a later, complete poll still finds them hidden.
    expect(applyPendingAdvances(q("1", "2", "3"), pending, T + 2_000)).toEqual([
      { id: "2" },
      { id: "3" },
    ]);
  });

  it("is safe to apply twice — hiding at commit time must be idempotent", () => {
    // The hooks filter at the point of setPatients, and a caller may well have
    // filtered an intermediate list too.
    const pending = new Map([["1", T]]);
    const once = applyPendingAdvances(q("1", "2"), pending, T + 1_000);
    const twice = applyPendingAdvances(once, pending, T + 1_000);
    expect(twice).toEqual([{ id: "2" }]);
    expect(pending.has("1")).toBe(true);
  });

  it("lapses each marker on its own clock", () => {
    const pending = new Map([["fresh", T], ["stale", T - PENDING_ADVANCE_TTL_MS - 1]]);
    const out = applyPendingAdvances(q("fresh", "stale", "other"), pending, T);
    expect(out.map((p) => p.id)).toEqual(["stale", "other"]);
    expect([...pending.keys()]).toEqual(["fresh"]);
  });

  it("never invents a patient the queue did not contain", () => {
    // Lapsing only un-hides; it can't add somebody the filter excluded.
    const pending = new Map([["ghost", T - PENDING_ADVANCE_TTL_MS - 1]]);
    expect(applyPendingAdvances(q("1"), pending, T)).toEqual([{ id: "1" }]);
  });
});

describe("the shared claim store (Keith Dye, 2026-09-25)", () => {
  const q = (...ids: string[]) => ids.map((id) => ({ id }));

  beforeEach(() => resetPendingAdvances());

  it("one map serves every queue and screen — a claim written anywhere hides everywhere", () => {
    // The two holes the per-hook `useRef(new Map())` had: leaving the page
    // threw the claim away, and no other screen (the Care Coordinator
    // dashboard) could consult it. A Monday item id is globally unique, so
    // module state is safe; this pins that the module EXPORTS the one map.
    sharedPendingAdvances.set("13133155597", T);
    expect(applyPendingAdvances(q("13133155597", "2"), sharedPendingAdvances, T + 1)).toEqual([{ id: "2" }]);
  });

  it("the TTL outlasts Monday's read-index lag", () => {
    // Keith Dye: the automation moved him 1.7s after the advancer flipped, yet
    // the group-filtered items_page kept returning him for ~10 minutes. Two
    // minutes of hiding put him back — with a live Advance button — for the
    // rest of that lag.
    expect(PENDING_ADVANCE_TTL_MS).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it("resetPendingAdvances empties it — the test seam", () => {
    sharedPendingAdvances.set("1", T);
    resetPendingAdvances();
    expect(sharedPendingAdvances.size).toBe(0);
  });
});
