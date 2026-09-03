import { describe, it, expect } from "vitest";
import { pendingAdvanceVerdict, applyPendingAdvances, PENDING_ADVANCE_TTL_MS } from "./pendingAdvance";

const T0 = 1_700_000_000_000;

describe("pendingAdvanceVerdict", () => {
  it("hides the patient while the board has not caught up yet", () => {
    expect(pendingAdvanceVerdict(true, T0, T0)).toBe("hide");
    expect(pendingAdvanceVerdict(true, T0, T0 + 29_000)).toBe("hide");
  });

  it("drops the marker once the board shows them out of the stage", () => {
    // The advance landed — from here they are filtered out on their own merits.
    expect(pendingAdvanceVerdict(false, T0, T0 + 5_000)).toBe("landed");
  });

  it("treats a patient missing from the fetch as landed, not hidden forever", () => {
    // `stillInStage` is false for an item that isn't in the board read at all.
    expect(pendingAdvanceVerdict(false, T0, T0)).toBe("landed");
  });

  it("RETURNS the patient when the advance never showed up", () => {
    // The whole safety property: a send that didn't land must not remove the
    // patient from the only queue that would surface them.
    expect(pendingAdvanceVerdict(true, T0, T0 + PENDING_ADVANCE_TTL_MS)).toBe("expired");
    expect(pendingAdvanceVerdict(true, T0, T0 + PENDING_ADVANCE_TTL_MS + 1)).toBe("expired");
  });

  it("gives a real advance far more time than it needs", () => {
    // A 30s poll + Monday indexing + the gateway's ~26s of job retries must all
    // fit inside the window, or a patient who DID advance flickers back.
    expect(PENDING_ADVANCE_TTL_MS).toBeGreaterThan(60_000);
    expect(pendingAdvanceVerdict(true, T0, T0 + 60_000)).toBe("hide");
  });

  it("landed wins over expiry — an advance confirmed late is still an advance", () => {
    expect(pendingAdvanceVerdict(false, T0, T0 + PENDING_ADVANCE_TTL_MS * 10)).toBe("landed");
  });
});

describe("applyPendingAdvances", () => {
  const q = (...ids: string[]) => ids.map((id) => ({ id }));
  const T = 1_700_000_000_000;

  it("is a no-op with nothing pending — same array back", () => {
    const list = q("1", "2");
    const pending = new Map<string, number>();
    expect(applyPendingAdvances(list, pending, T)).toBe(list);
  });

  it("hides a marked patient who is still in the queue", () => {
    const pending = new Map([["1", T]]);
    expect(applyPendingAdvances(q("1", "2"), pending, T + 1_000)).toEqual([{ id: "2" }]);
    // Still unsettled, so the marker stays for the next poll to re-ask.
    expect(pending.has("1")).toBe(true);
  });

  it("spends the marker once the patient is out of the queue", () => {
    const pending = new Map([["1", T]]);
    expect(applyPendingAdvances(q("2"), pending, T + 1_000)).toEqual([{ id: "2" }]);
    expect(pending.size).toBe(0);
  });

  it("RETURNS the patient when the advance never landed", () => {
    const pending = new Map([["1", T]]);
    const out = applyPendingAdvances(q("1", "2"), pending, T + PENDING_ADVANCE_TTL_MS + 1);
    expect(out).toEqual([{ id: "1" }, { id: "2" }]);
    expect(pending.size).toBe(0);
  });

  it("settles each marker independently", () => {
    // One landed, one still in flight, one expired — in a single pass.
    const pending = new Map([["landed", T], ["inflight", T], ["stale", T - PENDING_ADVANCE_TTL_MS - 1]]);
    const out = applyPendingAdvances(q("inflight", "stale", "other"), pending, T);
    expect(out.map((p) => p.id)).toEqual(["stale", "other"]);
    expect([...pending.keys()]).toEqual(["inflight"]);
  });

  it("never invents a patient the queue did not contain", () => {
    // Expiry only un-hides; it can't add somebody the filter excluded.
    const pending = new Map([["ghost", T - PENDING_ADVANCE_TTL_MS - 1]]);
    expect(applyPendingAdvances(q("1"), pending, T)).toEqual([{ id: "1" }]);
  });
});
