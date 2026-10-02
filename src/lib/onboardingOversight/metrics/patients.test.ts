/** CR-10 manager patient list: falling-behind and "doesn't add up" flags (PF-1..5) and the label mapping (LB-1..2). */
import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../model/buildSnapshot";
import { ctxFor } from "./context";
import { patientRows, patientHistory } from "./patients";
import { actionPhrase, subStageName } from "../labels";
import { ev, item } from "../__fixtures__/builders";
import { OO_CONFIG as C } from "../config";
import type { ItemRow, RawEvent } from "../types";

const NOW = Date.parse("2026-10-01T14:00:00-04:00");
const MN = C.stageColumn.MN, ESC = C.escalationColumn.MN;
const q = { periodDays: 28 as const, filters: {} };
const rowsOf = (items: ItemRow[], events: RawEvent[]) => { const d = { ctx: ctxFor(buildSnapshot({ snapshotAt: NOW, items, events, access: null, commsSla: null, fax: null, excludedIntCounts: null, cursors: {}, fetchErrors: [], mode: "fixture" }), q) }; return { rows: patientRows(d.ctx), d }; };
const ids = (r: { flags: { id: string }[] }) => r.flags.map((f) => f.id);

describe("patient flags", () => {
  it("PF-1 limbo only past 2 business days (1.5 bd in Janelle's bucket is not flagged)", () => {
    const mk = (id: string, at: string) => ({ i: item("MN", id, "2026-09-20T10:00:00-04:00", { values: { [MN]: 11, [ESC]: 0 } }), e: [ev("MN", id, MN, null, 11, "2026-09-20T10:00:00-04:00"), ev("MN", id, ESC, null, 0, at)] });
    const a = mk("9000000701", "2026-09-28T14:00:00-04:00"), b = mk("9000000702", "2026-09-30T02:00:00-04:00");
    const { rows } = rowsOf([a.i, b.i], [...a.e, ...b.e]);
    expect(ids(rows.find((r) => r.ref.itemId === "9000000701")!)).toContain("limbo");
    expect(ids(rows.find((r) => r.ref.itemId === "9000000702")!)).not.toContain("limbo");
    expect(rows[0].ref.itemId).toBe("9000000701"); // most behind first
  });
  it("PF-2 untouched for more than 3 business days, with the reason in words", () => {
    const { rows } = rowsOf([item("MN", "9000000703", "2026-09-21T10:00:00-04:00", { values: { [MN]: 9 } }), item("MN", "9000000713", "2026-09-21T10:00:00-04:00", { values: { [MN]: 10 } })],
      [ev("MN", "9000000703", MN, null, 9, "2026-09-21T10:00:00-04:00"), ev("MN", "9000000713", MN, null, 10, "2026-09-21T10:00:00-04:00")]);
    // A queue waiting on the provider (Confirm Receipt) is not flagged: no status change is expected while waiting.
    expect(rows.find((r) => r.ref.itemId === "9000000713")!.flags.some((x) => x.id === "untouched")).toBe(false);
    const f = rows.find((r) => r.ref.itemId === "9000000703")!.flags.find((x) => x.id === "untouched")!;
    expect(f.reason).toMatch(/No status change in \d+(\.\d)? business days/);
  });
  it("PF-3 a planned backward move (chasing clinicals -> re-evaluate) is not 'doesn't add up'; an unplanned one is", () => {
    const planned = [ev("MN", "9000000704", MN, null, 11, "2026-09-28T10:00:00-04:00"), ev("MN", "9000000704", MN, 11, 8, "2026-09-29T10:00:00-04:00")];
    const unplanned = [ev("MN", "9000000705", MN, null, 10, "2026-09-28T10:00:00-04:00"), ev("MN", "9000000705", MN, 10, 9, "2026-09-29T10:00:00-04:00")];
    const { rows } = rowsOf([item("MN", "9000000704", "2026-09-28T10:00:00-04:00", { values: { [MN]: 8 } }), item("MN", "9000000705", "2026-09-28T10:00:00-04:00", { values: { [MN]: 9 } })], [...planned, ...unplanned]);
    expect(ids(rows.find((r) => r.ref.itemId === "9000000704")!)).not.toContain("data");
    expect(rows.find((r) => r.ref.itemId === "9000000705")!.flags.find((x) => x.id === "data")!.reason).toMatch(/^Went back from/);
  });
  it("PF-4 history log marks a repeat visit and a quiet gap", () => {
    const e = [ev("MN", "9000000706", MN, null, 9, "2026-09-01T10:00:00-04:00"), ev("MN", "9000000706", MN, 9, 10, "2026-09-02T10:00:00-04:00"), ev("MN", "9000000706", MN, 10, 9, "2026-09-03T10:00:00-04:00"), ev("MN", "9000000706", MN, 9, 10, "2026-09-04T10:00:00-04:00")];
    const { d } = rowsOf([item("MN", "9000000706", "2026-09-01T10:00:00-04:00", { values: { [MN]: 10 } })], e);
    const h = patientHistory(d.ctx, "MN:9000000706");
    expect(h.some((b) => b.notes.some((n) => /Back here again/.test(n)))).toBe(true);
    expect(h[h.length - 1].notes.some((n) => /with no status change/.test(n))).toBe(true);
  });
});
describe("label mapping (one swappable file)", () => {
  it("LB-1 phrases are keyed by label index, not text: a renamed label keeps its phrase", () => {
    expect(actionPhrase("MN", MN, 10, "Confirm Receipt")).toBe(actionPhrase("MN", MN, 10, "2C. Confirm Receipt"));
    expect(actionPhrase("MN", ESC, 0, "Escalation Required")).toMatch(/Janelle/);
  });
  it("LB-2 every taxonomy queue has a plain sub-stage name (no codes on screen)", () => {
    for (const x of C.codes.filter((y) => y.kind === "pipeline")) expect(subStageName("QUEUE", x.code)).not.toMatch(/\d\.\d/);
  });
});

describe("CR-12 early warning and ball in court", () => {
  const now = Date.parse("2026-10-01T14:00:00-04:00");
  it("EW-1 time state vs the sub-stage's own normal: ok < 75% ≤ approaching ≤ 100% < over", () => {
    // Confirm Receipt (1.1.2.3) normal 6 business days: 2 bd ok, 5 bd approaching, 7 bd over.
    const mk = (id: string, start: string) => ({ i: item("MN", id, start, { values: { [MN]: 10 } }), e: [ev("MN", id, MN, null, 10, start, { user: 98938576 })] });
    const a = mk("9000000801", "2026-09-29T14:00:00-04:00"), b = mk("9000000802", "2026-09-24T14:00:00-04:00"), c2 = mk("9000000803", "2026-09-22T10:00:00-04:00");
    const { rows } = rowsOf([a.i, b.i, c2.i], [...a.e, ...b.e, ...c2.e]);
    const st = (id: string) => rows.find((r) => r.ref.itemId === id)!.warn.timeState;
    expect(st("9000000801")).toBe("ok"); expect(st("9000000802")).toBe("approaching"); expect(st("9000000803")).toBe("over");
    expect(rows.find((r) => r.ref.itemId === "9000000802")!.warn.normBd).toBe(C.norms.time["1.1.2.3"]);
  });
  it("EW-2 ball: a chase within cadence = Provider; no chase in cadence = Us; a decision = Us", () => {
    const chased = [ev("MN", "9000000811", MN, null, 10, "2026-09-20T10:00:00-04:00", { user: 98938576 }), ev("MN", "9000000811", "color_mm1wz0vg", null, 2, "2026-09-30T10:00:00-04:00", { user: 98938576 })];
    const idle = [ev("MN", "9000000812", MN, null, 10, "2026-09-20T10:00:00-04:00", { user: 98938576 })];
    const esc = [ev("MN", "9000000813", MN, null, 11, "2026-09-20T10:00:00-04:00"), ev("MN", "9000000813", ESC, null, 0, "2026-09-30T10:00:00-04:00")];
    const { rows } = rowsOf([item("MN", "9000000811", "2026-09-20T10:00:00-04:00", { values: { [MN]: 10, color_mm1wz0vg: 2 } }), item("MN", "9000000812", "2026-09-20T10:00:00-04:00", { values: { [MN]: 10 } }),
      item("MN", "9000000813", "2026-09-20T10:00:00-04:00", { values: { [MN]: 11, [ESC]: 0 } })], [...chased, ...idle, ...esc]);
    const ball = (id: string) => rows.find((r) => r.ref.itemId === id)!.warn.ball;
    expect(ball("9000000811")).toBe("Provider"); expect(ball("9000000812")).toBe("Us"); expect(ball("9000000813")).toBe("Us");
    expect(now).toBeGreaterThan(0);
  });
  it("EW-3 attempts vs normal: the 3rd provider follow-up is 'over' (normal 3), the 2nd 'approaching'", () => {
    const { rows } = rowsOf([item("MN", "9000000821", "2026-09-29T10:00:00-04:00", { values: { [MN]: 11, color_mm1wz0vg: 1 } }), item("MN", "9000000822", "2026-09-29T10:00:00-04:00", { values: { [MN]: 11, color_mm1wz0vg: 3 } })],
      [ev("MN", "9000000821", MN, null, 11, "2026-09-29T10:00:00-04:00"), ev("MN", "9000000822", MN, null, 11, "2026-09-29T10:00:00-04:00")]);
    expect(rows.find((r) => r.ref.itemId === "9000000821")!.warn.attempts!.state).toBe("over");
    expect(rows.find((r) => r.ref.itemId === "9000000822")!.warn.attempts!.state).toBe("approaching");
  });
});

describe("EW-4 one rule for late (consult C2)", () => {
  it("late iff the displayed days (0.1) exceed normal; every '+' is late, no due-soon row has a '+'", () => {
    const mk = (id: string, start: string) => ({ i: item("MN", id, start, { values: { [MN]: 9 } }), e: [ev("MN", id, MN, null, 9, start, { user: 98938576 })] });
    // Send request (normal 1 bd): 1.0 shown = due soon (not late); 1.1 shown = late (+0.1).
    const a = mk("9000000901", "2026-09-30T14:00:00-04:00"), b = mk("9000000902", "2026-09-30T11:30:00-04:00");
    const { rows } = rowsOf([a.i, b.i], [...a.e, ...b.e]);
    const r1 = rows.find((r) => r.ref.itemId === "9000000901")!, r2 = rows.find((r) => r.ref.itemId === "9000000902")!;
    expect(r1.warn.timeState).toBe("approaching"); expect(r1.warn.daysToCross).toBeGreaterThanOrEqual(0);
    expect(r2.warn.timeState).toBe("over"); expect(r2.warn.daysToCross).toBeLessThan(0);
    for (const r of rows) if (r.warn.daysToCross < 0) expect(r.warn.timeState).toBe("over");
  });
});

describe("round 9 guards", () => {
  it("CF-ESC the escalation limit is one number: holderThresholds.r equals norms.time for MGR and FINAL", () => {
    expect((C.holderThresholds as Record<string, { r: number }>).MGR.r).toBe(C.norms.time.MGR);
    expect((C.holderThresholds as Record<string, { r: number }>).FINAL.r).toBe(C.norms.time.FINAL);
  });
  it("TM-1 (mechanism) in an our-step queue a bounded snooze keeps the ball with us, so Team still counts the patient", () => {
    const { rows } = rowsOf([item("MN", "9000000971", "2026-09-10T10:00:00-04:00", { values: { [MN]: 9, [C.snooze.MN.dateCol]: "2026-10-06" } })], [ev("MN", "9000000971", MN, null, 9, "2026-09-10T10:00:00-04:00", { user: 98938576 })]);
    expect(rows[0].snoozedBounded).toBe(true); expect(rows[0].warn.ball).toBe("Us");
  });
  it("TM-1b a set date ≤ maxDateAheadBd in a provider queue moves the ball to Provider (item 5); a far date does not", () => {
    const mk = (id: string, date: string) => item("MN", id, "2026-09-10T10:00:00-04:00", { values: { [MN]: 10, [C.snooze.MN.dateCol]: date } });
    const e = (id: string) => ev("MN", id, MN, null, 10, "2026-09-10T10:00:00-04:00", { user: 98938576 });
    const { rows } = rowsOf([mk("9000000961", "2026-10-06"), mk("9000000962", "2026-12-15")], [e("9000000961"), e("9000000962")]);
    const r = (id: string) => rows.find((x) => x.ref.itemId === id)!;
    expect(r("9000000961").snoozedBounded).toBe(true); expect(r("9000000961").warn.ball).toBe("Provider");
    expect(r("9000000962").snoozedBounded).toBe(false); expect(r("9000000962").warn.ball).toBe("Us");
  });
  it("TM-1 a snooze far in the future does not exclude a patient (only a bounded snooze does)", () => {
    expect(C.ball.maxDateAheadBd).toBeGreaterThan(0);
    const { rows } = rowsOf([item("MN", "9000000951", "2026-09-20T10:00:00-04:00", { values: { [MN]: 9 } })], [ev("MN", "9000000951", MN, null, 9, "2026-09-20T10:00:00-04:00")]);
    expect(rows[0].snoozedBounded).toBe(false);
  });
});
