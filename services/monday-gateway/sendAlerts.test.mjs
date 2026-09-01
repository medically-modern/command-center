import { describe, it, expect } from "vitest";
import {
  alertKey,
  shouldAlert,
  pruneAlertState,
  takeSuppressed,
  createAlertState,
  formatSendFailure,
  COOLDOWN_MS,
  MAX_ALERTS_PER_WINDOW,
  sweepAlertReason,
  formatFailureSweep,
} from "./sendAlerts.mjs";

describe("throttle", () => {
  it("pages the first time and then goes quiet for the window", () => {
    const state = createAlertState();
    const k = alertKey({ boardId: "1", message: "boom" });
    expect(shouldAlert(state, k, 0)).toBe(true);
    expect(shouldAlert(state, k, 1_000)).toBe(false);
    expect(shouldAlert(state, k, COOLDOWN_MS - 1)).toBe(false);
    expect(shouldAlert(state, k, COOLDOWN_MS)).toBe(true);
  });

  it("treats different boards, and different errors, as different problems", () => {
    const state = createAlertState();
    expect(shouldAlert(state, alertKey({ boardId: "1", message: "boom" }), 0)).toBe(true);
    expect(shouldAlert(state, alertKey({ boardId: "2", message: "boom" }), 0)).toBe(true);
    expect(shouldAlert(state, alertKey({ boardId: "1", message: "different" }), 0)).toBe(true);
  });

  it("collapses the same failure across jobs — a lost token fails EVERY job", () => {
    const state = createAlertState();
    // Real Monday item ids are 11 digits, which redaction strips, so 50 failing
    // jobs share one shape. ⚠️ Short numbers are NOT stripped (an error code
    // like "HTTP 429" must stay legible), so a complaint distinguished only by
    // a small number would not collapse here — the global cap below is what
    // stops that becoming a storm.
    const fire = (i) =>
      shouldAlert(state, alertKey({ boardId: "1", message: `Item ${12937566800 + i} unauthorized` }), 0);
    expect([...Array(50).keys()].filter(fire).length).toBe(1);
  });

  it("caps total volume even when every failure is a different shape", () => {
    const state = createAlertState();
    const fire = (i) => shouldAlert(state, alertKey({ boardId: String(i), message: "boom" }), 0);
    expect([...Array(20).keys()].filter(fire).length).toBe(MAX_ALERTS_PER_WINDOW);
  });

  it("counts what it swallowed, and hands it over once", () => {
    const state = createAlertState();
    const k = alertKey({ boardId: "1", message: "boom" });
    shouldAlert(state, k, 0);
    shouldAlert(state, k, 1);
    shouldAlert(state, k, 2);
    expect(takeSuppressed(state)).toBe(2);
    expect(takeSuppressed(state)).toBe(0);
  });

  it("lets traffic through again once the window rolls", () => {
    const state = createAlertState();
    const fire = (i, t) => shouldAlert(state, alertKey({ boardId: String(i), message: "boom" }), t);
    [...Array(10).keys()].forEach((i) => fire(i, 0));
    expect(fire(99, COOLDOWN_MS)).toBe(true);
  });

  it("prunes stale entries so a long-lived process does not grow forever", () => {
    const state = createAlertState();
    state.keys.set("a", 0);
    state.keys.set("b", COOLDOWN_MS * 2);
    pruneAlertState(state, COOLDOWN_MS * 2);
    expect([...state.keys.keys()]).toEqual(["b"]);
  });
});

describe("message is PHI-safe", () => {
  it("never carries the item id or the actor", () => {
    const { body } = formatSendFailure({
      boardId: "18410601299",
      label: "Benefits send",
      attempts: 4,
      message: "Item 12937566870 rejected",
    });
    expect(body).not.toContain("12937566870");
    expect(body).toContain("#");
    expect(body).toContain("18410601299");
  });

  it("redacts values Monday echoes back in quotes", () => {
    const { body } = formatSendFailure({ message: "The label 'Beverly Danyluk' does not exist" });
    expect(body).not.toContain("Beverly");
    expect(body).toContain("'…'");
  });

  it("says the stage did not advance — that is the actionable half", () => {
    expect(formatSendFailure({}).body).toMatch(/NOT advanced/);
  });

  it("names a suppressed burst rather than implying one casualty", () => {
    expect(formatSendFailure({ suppressed: 12 }).body).toContain("+12 more suppressed");
    expect(formatSendFailure({ suppressed: 0 }).body).not.toContain("suppressed");
  });

  it("pages at high priority — data did not reach Monday", () => {
    expect(formatSendFailure({}).priority).toBe("high");
  });
});

// ── Reads vs writes: what actually deserves a push ────────────────────────
// 2026-09-01: two transient Monday blips paged Josh twice in two hours — 8
// reads 500ing at 16:07, 2 reads 503ing at 17:55, out of 23,719 requests, with
// ZERO writes lost. Neither was actionable. These pin the rule that keeps that
// quiet without going quiet on a real one.
describe("sweepAlertReason", () => {
  it("pages on a single failed write — that is a save that did not land", () => {
    expect(sweepAlertReason({ failedWrites: 1, failedReads: 0, requests: 5000 })).toBe("writes");
  });

  it("stays quiet on the 2026-09-01 16:07 burst (8 failed reads of 9,103)", () => {
    expect(sweepAlertReason({ failedWrites: 0, failedReads: 8, requests: 9103 })).toBe(null);
  });

  it("stays quiet on the 17:55 burst (2 failed reads of 7,196)", () => {
    expect(sweepAlertReason({ failedWrites: 0, failedReads: 2, requests: 7196 })).toBe(null);
  });

  it("still pages on a REAL read outage — both count and rate cleared", () => {
    expect(sweepAlertReason({ failedWrites: 0, failedReads: 400, requests: 1000 })).toBe("reads");
  });

  it("needs BOTH thresholds: a high rate on tiny volume does not page", () => {
    // 1-of-2 failing at 3am is not an outage. Rate alone would page here.
    expect(sweepAlertReason({ failedWrites: 0, failedReads: 1, requests: 2 })).toBe(null);
  });

  it("needs BOTH thresholds: a big count on huge volume does not page", () => {
    // Count alone would page on a busy afternoon that is actually fine.
    expect(sweepAlertReason({ failedWrites: 0, failedReads: 30, requests: 100000 })).toBe(null);
  });

  it("a write failure outranks quiet reads", () => {
    expect(sweepAlertReason({ failedWrites: 2, failedReads: 1, requests: 9000 })).toBe("writes");
  });

  it("no failures at all is silent", () => {
    expect(sweepAlertReason({ failedWrites: 0, failedReads: 0, requests: 9000 })).toBe(null);
  });
});

describe("formatFailureSweep wording", () => {
  it("a read alert says plainly that nothing was lost", () => {
    const m = formatFailureSweep({
      windowMinutes: 60, reason: "reads", failedReads: 400, failedWrites: 0, requests: 1000,
    });
    expect(m.title).toContain("no writes lost");
    expect(m.body).toContain("No writes lost");
    expect(m.body).toContain("400 failed Monday READS");
  });

  it("a write alert leads with the writes, not a pooled total", () => {
    // The old wording was "8 failed Monday calls (of 76 writes)", which reads
    // as "8 of the 76 writes failed". It was 8 reads and zero writes.
    const m = formatFailureSweep({
      windowMinutes: 60, reason: "writes", failedWrites: 3, failedReads: 8, requests: 900,
    });
    expect(m.title).toContain("WRITES");
    expect(m.body).toContain("3 failed Monday WRITES");
    expect(m.body).toContain("did not land");
    expect(m.body).toContain("+8 failed reads");
  });
});
