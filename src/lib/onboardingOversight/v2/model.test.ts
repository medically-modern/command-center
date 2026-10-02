/**
 * V2-M (DESIGN INTENT v2 model): Next Action Date rule, DVS never late, the reason split, escalation untouched vs
 * worked, returned-from-escalation, and reconciliation of tiles, stage rows and lists. Synthetic items only.
 */
import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../model/buildSnapshot";
import { ev, item } from "../__fixtures__/builders";
import { OO_CONFIG as C } from "../config";
import type { ItemRow, RawEvent } from "../types";
import { buildV2, plainAction } from "./model";
import { listFor } from "./lists";
import { DEFAULT_STEPS, DEFAULT_DUE_SOON, dueSoonWindow } from "./steps";

const NOW = Date.parse("2026-10-01T14:00:00-04:00"); // Thursday
const MN = C.stageColumn.MN, ESC = C.escalationColumn.MN, NAD = "date_mm1wadgs", EVID = "text_mm2yd068";
const INS = C.stageColumn.INS;
const P = 98938576; // a real processor's monday user (not automation)
const model = (items: ItemRow[], events: RawEvent[]) => buildV2(buildSnapshot({ snapshotAt: NOW, items, events, access: null, commsSla: null, fax: null, excludedIntCounts: null, cursors: {}, fetchErrors: [], mode: "fixture" }), DEFAULT_STEPS);
const enter = (id: string, label: number, when: string) => ev("MN", id, MN, null, label, when, { user: P });

describe("v2 model", () => {
  const items: ItemRow[] = []; const events: RawEvent[] = [];
  const add = (it: ItemRow, ...es: RawEvent[]) => { items.push(it); events.push(...es); };
  // A: Send request (normal 1) entered 5 business days ago, nothing since -> late, not started, untouched
  add(item("MN", "9000001001", "2026-09-24T10:00:00-04:00", { values: { [MN]: 9 } }), enter("9000001001", 9, "2026-09-24T10:00:00-04:00"));
  // B: Confirm receipt with a future Next Action Date -> not actionable, not late, not due soon
  add(item("MN", "9000001002", "2026-09-10T10:00:00-04:00", { values: { [MN]: 10, [NAD]: "2026-10-06" } }), enter("9000001002", 10, "2026-09-10T10:00:00-04:00"));
  // C: Send request, a logged attempt the next day -> late, attempted
  add(item("MN", "9000001003", "2026-09-24T10:00:00-04:00", { values: { [MN]: 9 } }), enter("9000001003", 9, "2026-09-24T10:00:00-04:00"), ev("MN", "9000001003", EVID, null, null, "2026-09-25T11:00:00-04:00", { user: P }));
  // D: escalated to Janelle 5 business days ago, nothing since -> past 2 days, untouched by manager
  add(item("MN", "9000001004", "2026-09-20T10:00:00-04:00", { values: { [MN]: 8, [ESC]: 0 } }), enter("9000001004", 8, "2026-09-21T10:00:00-04:00"), ev("MN", "9000001004", ESC, null, 0, "2026-09-24T10:00:00-04:00", { user: P }));
  // E: escalated to Janelle, an action logged after -> past 2 days, being worked
  add(item("MN", "9000001005", "2026-09-20T10:00:00-04:00", { values: { [MN]: 8, [ESC]: 0 } }), enter("9000001005", 8, "2026-09-21T10:00:00-04:00"), ev("MN", "9000001005", ESC, null, 0, "2026-09-24T10:00:00-04:00", { user: P }), ev("MN", "9000001005", EVID, null, null, "2026-09-28T10:00:00-04:00", { user: 102869398 }));
  // F: escalated, returned to the processor, untouched since -> late, returned from escalation, untouched
  add(item("MN", "9000001006", "2026-09-18T10:00:00-04:00", { values: { [MN]: 9, [ESC]: 1 } }), enter("9000001006", 9, "2026-09-21T10:00:00-04:00"), ev("MN", "9000001006", ESC, null, 0, "2026-09-22T10:00:00-04:00", { user: P }), ev("MN", "9000001006", ESC, 0, 1, "2026-09-24T10:00:00-04:00", { user: 102869398 }));
  // G: Insurance DVS for a month -> never late
  add(item("INS", "9000001007", "2026-09-01T10:00:00-04:00", { values: { [INS]: 1 } }), ev("INS", "9000001007", INS, null, 1, "2026-09-01T10:00:00-04:00", { user: P }));
  // H: Confirm receipt entered Sep 10, Next Action Date reached Sep 28 -> actionable since Sep 28, 3 days, not late (normal 10)
  add(item("MN", "9000001008", "2026-09-10T10:00:00-04:00", { values: { [MN]: 10, [NAD]: "2026-09-28" } }), enter("9000001008", 10, "2026-09-10T10:00:00-04:00"));
  const m = model(items, events); const row = (id: string) => m.rows.find((r) => r.itemId === id)!;

  it("V2-M1 lateness counts from the Next Action Date; a future date is not actionable", () => {
    expect(row("9000001002").actionableMs).toBeNull(); expect(row("9000001002").late).toBe(false); expect(row("9000001002").dueSoon).toBe(false);
    const h = row("9000001008"); expect(h.actionableDays).toBe(4); // round-up rule: Sep 28 00:00 -> Oct 1 14:00 = 3.x business days -> 4 expect(h.inStageDays).toBeGreaterThan(10); expect(h.late).toBe(false);
    expect(row("9000001001").actionableDays).toBe(6); expect(row("9000001001").late).toBe(true);
  });
  it("V2-M2 DVS is never late", () => { const g = row("9000001007"); expect(g.step).toBe("DVS"); expect(g.late).toBe(false); expect(g.dueSoon).toBe(false); });
  it("V2-M3 the processor reason split: not started, attempted, returned from escalation untouched", () => {
    expect(row("9000001001").reason).toBe("notStarted"); expect(row("9000001001").untouched).toBe(true);
    expect(row("9000001003").reason).toBe("attempted");
    expect(row("9000001006").reason).toBe("returnedUntouched"); expect(row("9000001006").with).toBe("Processor");
  });
  it("V2-M4 escalation: with Janelle, past 2 days, untouched vs being worked; whole days in escalation", () => {
    const d = row("9000001004"), e = row("9000001005");
    expect(d.with).toBe("Janelle"); expect(d.escDays).toBe(6); // round-up rule expect(d.reason).toBe("escUntouched");
    expect(e.reason).toBe("escWorking"); expect(e.step).toBe("Evaluation");
  });
  it("V2-M5 tiles, stage rows and lists reconcile; whole days only", () => {
    const procLate = m.rows.filter((r) => r.late && r.with === "Processor").length, escLate = m.rows.filter((r) => r.late && r.with !== "Processor").length;
    expect(m.tiles.processorPastDue).toBe(procLate); expect(m.tiles.escalationsPastDue).toBe(escLate);
    expect(m.stages.reduce((n, s) => n + s.late, 0)).toBe(procLate + escLate);
    expect(m.stages.reduce((n, s) => n + s.lateEsc, 0)).toBe(escLate);
    for (const s of m.stages) expect(Object.values(s.reasons).reduce((n, x) => n + x, 0)).toBe(s.late);
    expect(listFor(m, "tile:procPastDue")!.rows.length).toBe(m.tiles.processorPastDue);
    expect(listFor(m, "stage:MN:reason:notStarted")!.rows.length).toBe(m.stages.find((s) => s.stage === "MN")!.reasons.notStarted);
    const jan = m.escOwners.find((o) => o.name === "Janelle")!; expect(listFor(m, "esc:Janelle:past2Untouched")!.rows.length).toBe(jan.past2Untouched);
    for (const r of m.rows) { expect(Number.isInteger(r.inStageDays)).toBe(true); if (r.escDays != null) expect(Number.isInteger(r.escDays)).toBe(true); }
  });
  it("V2-M6 By Employee: actionable = not started + attempted + returned (per person); no judgments", () => {
    for (const p of m.people.filter((x) => x.hasSteps)) {
      const rs = m.rows.filter((r) => r.with === "Processor" && r.owner === p.name && r.actionableMs != null);
      expect(p.returnedUntouched).toBe(rs.filter((r) => r.returned).length);
      expect(p.notStarted + p.attempted + p.returnedUntouched).toBe(p.actionable);
    }
    for (const p of m.people.filter((x) => x.hasSteps)) expect(p.notGottenTo).toBe(p.notStarted + p.returnedUntouched); // V2-M16 (CR-16)
    expect(m.tiles.inPipeline).toBe(m.rows.length);
    expect(JSON.stringify(m.people)).not.toMatch(/needs help|doing well|behind/i);
  });
  it("V2-M7 generated names off-line", () => { for (const r of m.rows) expect(r.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/); });

});

describe("v2 model, closed loop and capacity (architect v2)", () => {
  const INT_SUB = "color_mm6ct431", INT_ATT = "numeric_mm5ze82q", ESCI = C.escalationColumn.INT;
  const items: ItemRow[] = []; const events: RawEvent[] = [];
  const add = (it: ItemRow, ...es: RawEvent[]) => { items.push(it); events.push(...es); };
  // R1: escalated to Katie, returned Sep 29 (Done), still open, nothing since -> in Katie's returned set; untouched although not late (Confirm Receipt, normal 10)
  add(item("MN", "9000002001", "2026-09-10T10:00:00-04:00", { values: { [MN]: 10, [ESC]: 1 } }), enter("9000002001", 10, "2026-09-10T10:00:00-04:00"), ev("MN", "9000002001", ESC, null, 2, "2026-09-25T10:00:00-04:00", { user: P }), ev("MN", "9000002001", ESC, 2, 1, "2026-09-29T10:00:00-04:00", { user: 109186258 }));
  // R2: Janelle forwards to Katie (0 -> 2): not a return to the processor
  add(item("MN", "9000002002", "2026-09-10T10:00:00-04:00", { values: { [MN]: 10, [ESC]: 2 } }), enter("9000002002", 10, "2026-09-10T10:00:00-04:00"), ev("MN", "9000002002", ESC, null, 0, "2026-09-25T10:00:00-04:00", { user: P }), ev("MN", "9000002002", ESC, 0, 2, "2026-09-28T10:00:00-04:00", { user: 102869398 }));
  // R3: escalated 4 days in a 1-day step, returned yesterday -> actionable since the return: not late (manager days not charged)
  add(item("MN", "9000002003", "2026-09-20T10:00:00-04:00", { values: { [MN]: 9, [ESC]: 1 } }), enter("9000002003", 9, "2026-09-21T10:00:00-04:00"), ev("MN", "9000002003", ESC, null, 0, "2026-09-24T10:00:00-04:00", { user: P }), ev("MN", "9000002003", ESC, 0, 1, "2026-10-01T09:00:00-04:00", { user: 102869398 })); // returned this morning: under a day, not past due
  // U1: Send Request, an action on Sep 22, its Next Action Date Sep 24 passed, nothing since -> late, attempted, untouched
  add(item("MN", "9000002004", "2026-09-20T10:00:00-04:00", { values: { [MN]: 9, [NAD]: "2026-09-24" } }), enter("9000002004", 9, "2026-09-21T10:00:00-04:00"), ev("MN", "9000002004", EVID, null, null, "2026-09-22T10:00:00-04:00", { user: P }));
  // I1: Intake calling: first attempt Sep 22 (0 -> 1) starts the step; later attempts are actions -> attempted, not "not started"
  add(item("INT", "9000002005", "2026-09-21T10:00:00-04:00", { values: { [INT_SUB]: 7, [INT_ATT]: 3 } }), ev("INT", "9000002005", INT_ATT, null, null, "2026-09-22T10:00:00-04:00", { user: P }), ev("INT", "9000002005", INT_ATT, null, null, "2026-09-23T10:00:00-04:00", { user: P }), ev("INT", "9000002005", INT_ATT, null, null, "2026-09-24T10:00:00-04:00", { user: P }));
  events.filter((e) => e.itemId === "9000002005").forEach((e, i) => { e.toNum = i + 1; });
  // C1: Intake sub-stage 7 -> 1 yesterday = entering Profile Send-off (became actionable for that step, owner Masani)
  add(item("INT", "9000002006", "2026-09-28T10:00:00-04:00", { values: { [INT_SUB]: 1 } }), ev("INT", "9000002006", INT_SUB, 7, 1, "2026-09-30T11:00:00-04:00", { user: P }));
  // C2: MN advanced Send Request -> Confirm Receipt yesterday: worked credited to Send Request; an escalation flip is not work
  add(item("MN", "9000002007", "2026-09-28T10:00:00-04:00", { values: { [MN]: 10 } }), enter("9000002007", 9, "2026-09-28T10:00:00-04:00"), ev("MN", "9000002007", MN, 9, 10, "2026-09-30T12:00:00-04:00", { user: P }));
  add(item("MN", "9000002008", "2026-09-28T10:00:00-04:00", { values: { [MN]: 8, [ESC]: 0 } }), enter("9000002008", 8, "2026-09-28T10:00:00-04:00"), ev("MN", "9000002008", ESC, null, 0, "2026-09-30T12:00:00-04:00", { user: P }));
  void ESCI;
  const m = model(items, events); const row = (id: string) => m.rows.find((r) => r.itemId === id)!;
  it("V2-M8 returned set: Katie's return still open counts; Janelle forwarding to Katie does not; untouched after a return even when not late", () => {
    expect(m.sets["returned:Katie"]).toContain("MN:9000002001"); expect(m.sets["returned:Janelle"]).not.toContain("MN:9000002002"); expect(m.sets["returned:Katie"]).not.toContain("MN:9000002002");
    const r1 = row("9000002001"); expect(r1.returned).toBe(true); expect(r1.untouched).toBe(true); expect(r1.late).toBe(false);
    expect(m.escOwners.find((o) => o.name === "Katie")!.returned28).toBe(m.sets["returned:Katie"].length);
  });
  it("V2-M9 a return restarts the clock: escalation days are not charged to the processor", () => { const r = row("9000002003"); expect(r.with).toBe("Processor"); expect(r.late).toBe(false); });
  it("V2-M10 untouched = nothing logged since it became actionable; reason attempted when worked earlier", () => { const r = row("9000002004"); expect(r.late).toBe(true); expect(r.reason).toBe("attempted"); expect(r.untouched).toBe(true); });
  it("V2-M11 Intake attempts: the first call starts Calling the Patient; later calls are actions, not a new start", () => { const r = row("9000002005"); expect(r.step).toBe("Calling the Patient"); expect(new Date(r.stepSinceMs).toISOString().slice(0, 10)).toBe("2026-09-22"); expect(r.touchedInStep).toBe(true); });
  it("V2-M12 capacity: entering a step counts as became actionable for that step; advancing counts as worked for the step left; escalation flips are not work", () => {
    expect(m.sets["became:Masani:int.sendoff"]).toContain("INT:9000002006");
    expect(m.sets["worked:Masheke:mn.send"]).toContain("MN:9000002007");
    expect(m.sets["worked:Masheke:mn.eval"] ?? []).not.toContain("MN:9000002008");
    expect(m.windowDays[0]).toBe("2026-09-30"); // today excluded
  });
  it("V2-M13 the last of the 4 weekly bars equals today's late count, per stage", () => { for (const s of m.stages) expect(s.bars[3]).toBe(s.late); });
});

describe("v2 model, scheduled-job column (architect v2 r2)", () => {
  const SCHED = "numeric_mm5f5ars"; const INSE = C.escalationColumn.INS;
  const items: ItemRow[] = []; const events: RawEvent[] = [];
  // escalated to Janelle 5 days ago; the only later event is the daily scheduled counter -> untouched by manager, not worked, last action is the escalation
  items.push(item("INS", "9000003001", "2026-09-20T10:00:00-04:00", { values: { [INS]: 6, [INSE]: 0 } }));
  events.push(ev("INS", "9000003001", INS, null, 6, "2026-09-21T10:00:00-04:00", { user: P }), ev("INS", "9000003001", INSE, null, 0, "2026-09-24T10:00:00-04:00", { user: P }),
    ev("INS", "9000003001", SCHED, null, null, "2026-09-30T13:01:00Z"), ev("INS", "9000003001", SCHED, null, null, "2026-10-01T13:01:00Z"));
  const m = model(items, events); const r = m.rows.find((x) => x.itemId === "9000003001")!;
  items.push(item("INS", "9000003002", "2026-09-20T10:00:00-04:00", { values: { [INS]: 6 } }));
  events.push(ev("INS", "9000003002", INS, null, 6, "2026-09-21T10:00:00-04:00", { user: -4 }), ev("INS", "9000003002", SCHED, null, null, "2026-10-01T13:01:00Z"));
  const m2 = model(items, events); const r2 = m2.rows.find((x) => x.itemId === "9000003002")!;
  it("V2-M14b with only automation and the scheduled bump, there is no last action", () => {
    expect(r2.last).toBeNull(); expect(r2.untouched).toBe(true); expect(r2.reason).toBe("notStarted");
    expect(m2.sets["worked:Sam:ins.outstanding"] ?? []).not.toContain("INS:9000003002");
  });
  it("V2-M14 the scheduled 'Days Auth Outstanding' column is never a logged action: not manager work, not worked, not the last action", () => {
    expect(r.reason).toBe("escUntouched"); expect(r.untouched).toBe(true);
    expect(new Date(r.last!.atMs).toISOString().slice(0, 10)).toBe("2026-09-24");
    expect((m.sets["worked:Sam"] ?? []).includes("INS:9000003001")).toBe(false);
  });
});

describe("v2 model, round 16 (escalation clock, disjoint lateness, NAD, step regressions)", () => {
  const INT_ATT = "numeric_mm5ze82q", INT_SUB = "color_mm6ct431";
  const items: ItemRow[] = []; const events: RawEvent[] = [];
  const add = (it: ItemRow, ...es: RawEvent[]) => { items.push(it); events.push(...es); };
  const J = 102869398;
  // X1: Send Request (normal 1) entered Sep 14, escalated to Janelle yesterday -> escalation rule only: not late, not processor late
  add(item("MN", "9000004001", "2026-09-14T10:00:00-04:00", { values: { [MN]: 9, [ESC]: 0 } }), enter("9000004001", 9, "2026-09-14T10:00:00-04:00"), ev("MN", "9000004001", ESC, null, 0, "2026-09-30T10:00:00-04:00", { user: P }));
  // X2: escalated Sep 24, cleared and re-set to Janelle 30 minutes later -> her clock keeps Sep 24; a processor's attempt Sep 28 is "a logged action since escalated"
  add(item("MN", "9000004002", "2026-09-20T10:00:00-04:00", { values: { [MN]: 9, [ESC]: 0 } }), enter("9000004002", 9, "2026-09-21T10:00:00-04:00"), ev("MN", "9000004002", ESC, null, 0, "2026-09-24T10:00:00-04:00", { user: P }),
    ev("MN", "9000004002", ESC, 0, 1, "2026-09-24T10:10:00-04:00", { user: J }), ev("MN", "9000004002", ESC, 1, 0, "2026-09-24T10:40:00-04:00", { user: P }), ev("MN", "9000004002", EVID, null, null, "2026-09-28T10:00:00-04:00", { user: P }));
  // X3: escalated Sep 21, cleared Sep 30 10:00, re-set Sep 30 12:00 (2 hours later) -> a new escalation: 2 days (rounded up), not late
  add(item("MN", "9000004003", "2026-09-20T10:00:00-04:00", { values: { [MN]: 9, [ESC]: 0 } }), enter("9000004003", 9, "2026-09-20T10:00:00-04:00"), ev("MN", "9000004003", ESC, null, 0, "2026-09-21T10:00:00-04:00", { user: P }),
    ev("MN", "9000004003", ESC, 0, 1, "2026-09-30T10:00:00-04:00", { user: J }), ev("MN", "9000004003", ESC, 1, 0, "2026-09-30T12:00:00-04:00", { user: P }));
  // X4: Janelle Sep 22, forwarded to Katie Sep 30 -> with Katie, her clock starts Sep 30
  add(item("MN", "9000004004", "2026-09-20T10:00:00-04:00", { values: { [MN]: 8, [ESC]: 2 } }), enter("9000004004", 8, "2026-09-21T10:00:00-04:00"), ev("MN", "9000004004", ESC, null, 0, "2026-09-22T10:00:00-04:00", { user: P }), ev("MN", "9000004004", ESC, 0, 2, "2026-09-30T10:00:00-04:00", { user: J }));
  // X5: Send Request since Sep 1; the Next Action Date was pushed Sep 10 -> Sep 20 -> Oct 5 -> not actionable, not late, though its time in stage is far over normal
  const nad = (from: string | null, to: string, when: string) => { const e = ev("MN", "9000004005", NAD, null, null, when, { user: P }); e.fromDate = from; e.toDate = to; return e; };
  add(item("MN", "9000004005", "2026-09-01T10:00:00-04:00", { values: { [MN]: 9, [NAD]: "2026-10-05" } }), enter("9000004005", 9, "2026-09-01T10:00:00-04:00"), nad(null, "2026-09-10", "2026-09-02T10:00:00-04:00"), nad("2026-09-10", "2026-09-20", "2026-09-10T10:00:00-04:00"), nad("2026-09-20", "2026-10-05", "2026-09-21T10:00:00-04:00"));
  // X6: Intake counter 0 -> 1 Sep 22 (Calling the Patient), then reset 1 -> 0 Sep 29 -> back to Initial Intake to First Call, step start Sep 29
  const att = (to: number, when: string) => { const e = ev("INT", "9000004006", INT_ATT, null, null, when, { user: P }); e.toNum = to; return e; };
  add(item("INT", "9000004006", "2026-09-21T10:00:00-04:00", { values: { [INT_SUB]: 7, [INT_ATT]: 0 } }), att(1, "2026-09-22T10:00:00-04:00"), att(0, "2026-09-29T10:00:00-04:00"));
  const m = model(items, events); const row = (id: string) => m.rows.find((r) => r.itemId === id)!;
  it("V2-M4b an escalated patient is judged only by the escalation rule: never processor late; Processor Past Due + Escalations Past Due = Σ stage Late, disjoint", () => {
    const x = row("9000004001"); expect(x.with).toBe("Janelle"); expect(x.late).toBe(false); expect(x.dueSoon).toBe(false);
    expect(listFor(m, "tile:procPastDue")!.rows.map((r) => r.itemId)).not.toContain("9000004001");
    const p = new Set(listFor(m, "tile:procPastDue")!.rows.map((r) => r.key)), e = listFor(m, "tile:escPastDue")!.rows.map((r) => r.key);
    expect(e.some((k) => p.has(k))).toBe(false);
    expect(m.tiles.processorPastDue + m.tiles.escalationsPastDue).toBe(m.stages.reduce((n, s) => n + s.late, 0));
    expect(m.tiles.escalationsPastDue).toBe(m.stages.reduce((n, s) => n + s.lateEsc, 0));
    expect(m.tiles.dueSoon).toBe(listFor(m, "tile:dueSoon")!.rows.length);
  });
  it("V2-M4c escalation clock: re-set to the same owner within the hour keeps it; after the hour it restarts; a forward starts the new owner's clock", () => {
    expect(row("9000004002").escDays).toBe(6); expect(row("9000004002").late).toBe(true);
    expect(row("9000004003").escDays).toBe(2); expect(row("9000004003").late).toBe(false);
    const f = row("9000004004"); expect(f.with).toBe("Katie"); expect(f.escDays).toBe(2); // Katie since Sep 30 10:00, rounded up
  });
  // Josh, 2026-10-02: "being worked" needs an escalation owner (Janelle or Katie) — a processor's action no longer counts.
  it("V2-M4d a processor's action after the escalation is NOT the escalation being worked", () => { expect(row("9000004002").reason).toBe("escUntouched"); });
  it("V2-M1b a pushed Next Action Date keeps the patient not actionable: not late, not due soon, real time in stage", () => {
    const x = row("9000004005"); expect(x.actionableMs).toBeNull(); expect(x.late).toBe(false); expect(x.dueSoon).toBe(false); expect(x.inStageDays).toBeGreaterThan(20);
  });
  it("V2-M11b a counter decrease is a step change: back to Initial Intake to First Call, step start at the reset", () => {
    const x = row("9000004006"); expect(x.step).toBe("Initial Intake to First Call"); expect(new Date(x.stepSinceMs).toISOString().slice(0, 10)).toBe("2026-09-29");
  });
  it("V2-M6b By Employee identity holds on this fixture set too; no patient is off-step here", () => {
    for (const p of m.people.filter((x) => x.hasSteps)) expect(p.notStarted + p.attempted + p.returnedUntouched).toBe(p.actionable);
    expect(m.notOnStep).toEqual([]);
  });
});

describe("v2 model, weekly bars replay the Next Action Date history (red-team r16 #8)", () => {
  // Send Request since Sep 1, no Next Action Date until Sep 28, when it was set to Oct 5 -> late at the Sep 10, 17 and 24 week ends; not late today
  const e = ev("MN", "9000005001", NAD, null, null, "2026-09-28T10:00:00-04:00", { user: P }); e.fromDate = null; e.toDate = "2026-10-05";
  const m = model([item("MN", "9000005001", "2026-09-01T10:00:00-04:00", { values: { [MN]: 9, [NAD]: "2026-10-05" } })], [enter("9000005001", 9, "2026-09-01T10:00:00-04:00"), e]);
  it("V2-M13b older bars use the NAD as it was then, not today's", () => { expect(m.stages.find((s) => s.stage === "MN")!.bars).toEqual([1, 1, 1, 0]); });
});

describe("v2 model, round 17 (same-owner blip, not on a step)", () => {
  // B1: escalated to Katie Sep 22, cleared Sep 29 10:00 and set back to Katie 10:30 -> not a return, one escalation
  const items: ItemRow[] = [item("MN", "9000006001", "2026-09-20T10:00:00-04:00", { values: { [MN]: 10, [ESC]: 2 } }),
    // N1: an open Medical Necessity patient with a blank status -> on no step
    item("MN", "9000006002", "2026-09-20T10:00:00-04:00", { group: "group_mm1xf2jb", values: { [MN]: null } })];
  const events: RawEvent[] = [enter("9000006001", 10, "2026-09-21T10:00:00-04:00"), ev("MN", "9000006001", ESC, null, 2, "2026-09-22T10:00:00-04:00", { user: P }),
    ev("MN", "9000006001", ESC, 2, 1, "2026-09-29T10:00:00-04:00", { user: 109186258 }), ev("MN", "9000006001", ESC, 1, 2, "2026-09-29T10:30:00-04:00", { user: 109186258 })];
  const m = model(items, events); const r = m.rows.find((x) => x.itemId === "9000006001")!;
  it("V2-M8b a clear and re-set to the same owner within the hour is not a return and not a second escalation", () => {
    expect(m.sets["returned:Katie"]).not.toContain("MN:9000006001"); expect(r.attempts).toBe("escalated 1×"); expect(r.escDays).toBe(8);
  });
  it("V2-M15 a patient whose status maps to no step is in no count and is listed as not on a step", () => {
    expect(m.notOnStep).toContain("MN:9000006002"); expect(m.rows.some((x) => x.itemId === "9000006002")).toBe(false);
  });
});

describe("v2 model, CR-16 (a closing decision is not new work)", () => {
  // K1: escalated to Katie, "Done" Sep 30 12:00 and moved to Completed at 12:20 -> not new to the processor
  const items: ItemRow[] = [item("MN", "9000007001", "2026-09-20T10:00:00-04:00", { values: { [MN]: 14, [ESC]: 1 } }),
    // K2: escalated to Katie, "Done" Sep 30 12:00, still open -> a real return: new to the processor that day
    item("MN", "9000007002", "2026-09-20T10:00:00-04:00", { values: { [MN]: 10, [ESC]: 1 } })];
  const events: RawEvent[] = [enter("9000007001", 10, "2026-09-21T10:00:00-04:00"), ev("MN", "9000007001", ESC, null, 2, "2026-09-22T10:00:00-04:00", { user: P }), ev("MN", "9000007001", ESC, 2, 1, "2026-09-30T12:00:00-04:00", { user: 109186258 }), ev("MN", "9000007001", MN, 10, 14, "2026-09-30T12:20:00-04:00", { user: 109186258 }),
    enter("9000007002", 10, "2026-09-21T10:00:00-04:00"), ev("MN", "9000007002", ESC, null, 2, "2026-09-22T10:00:00-04:00", { user: P }), ev("MN", "9000007002", ESC, 2, 1, "2026-09-30T12:00:00-04:00", { user: 109186258 })];
  const m = model(items, events);
  it("V2-M12b a return that closes the patient within the hour is not 'new' work; a real return is", () => {
    const s = m.sets["became:Masheke:mn.confirm"] ?? [];
    expect(s).not.toContain("MN:9000007001"); expect(s).toContain("MN:9000007002");
  });
});

describe("v2 model, CR-16 (Due Soon window, plain last action)", () => {
  it("V2-M17 Due Soon only for steps over 3 days, in the last 20% of the window (at least 1 day)", () => {
    expect(dueSoonWindow(10, DEFAULT_DUE_SOON)).toBe(2); expect(dueSoonWindow(5, DEFAULT_DUE_SOON)).toBe(1); expect(dueSoonWindow(30, DEFAULT_DUE_SOON)).toBe(6);
    expect(dueSoonWindow(3, DEFAULT_DUE_SOON)).toBe(0); expect(dueSoonWindow(1, DEFAULT_DUE_SOON)).toBe(0); expect(dueSoonWindow(2, DEFAULT_DUE_SOON)).toBe(0);
    expect(dueSoonWindow(10, { pct: 50, overDays: 3 })).toBe(5);
  });
  it("V2-M18 Last action is a real action in plain words; field changes are not actions", () => {
    expect(plainAction("✉ Request sent")).toBe("Request sent"); expect(plainAction("⚖ To Janelle")).toBe("Escalated to Janelle");
    expect(plainAction("→ Clean-up")).toBe("Moved to Clean-up"); expect(plainAction("☎ Call 3")).toBe("Call 3 made");
    for (const x of ["Method: Fax", "Call-back date set", "Records needed", "Status changed", "Moved to another board group"]) expect(plainAction(x)).toBeNull();
  });
});

describe("v2 model, Flow: in vs out over the same window (Brandon)", () => {
  const INT_SUB = "color_mm6ct431";
  const items: ItemRow[] = [
    item("INT", "9000008001", "2026-09-30T10:00:00-04:00", { values: { [INT_SUB]: 7 } }), // new referral, still in Intake
    item("INT", "9000008002", "2026-08-25T19:00:00Z", { values: { [INT_SUB]: 7 } }), // inside a logged bulk-import window, and outside 28 days anyway
    item("MN", "9000008003", "2026-09-01T10:00:00-04:00", { values: { [MN]: 15 } }), // moved to Stuck on Sep 29
    item("WC", "9000008004", "2026-09-01T10:00:00-04:00", { values: { [C.stageColumn.WC]: 4 } }), // completed Sep 30
  ];
  const events: RawEvent[] = [enter("9000008003", 10, "2026-09-02T10:00:00-04:00"), ev("MN", "9000008003", MN, 10, 15, "2026-09-29T10:00:00-04:00", { user: P }),
    ev("WC", "9000008004", C.stageColumn.WC, 7, 4, "2026-09-30T10:00:00-04:00", { user: P })];
  const m = model(items, events);
  it("V2-F1 new referrals in = Intake items created in the window (bulk imports and older items excluded)", () => {
    expect(m.flow[28].inRows.map((r) => r.itemId)).toEqual(["9000008001"]); expect(m.flow[7].inRows.length).toBe(1);
  });
  it("V2-F2 out = completed (Welcome Call to Completed) + moved to Stuck, by the stage it died in; net = in - out", () => {
    expect(m.flow[28].completedKeys).toEqual(["WC:9000008004"]);
    expect(m.flow[28].stuck.MN.map((r) => r.itemId)).toEqual(["9000008003"]);
    expect(m.flow[28].out).toBe(2); expect(m.flow[28].net).toBe(1 - 2);
    expect(listFor(m, "flow:28:stuck:MN")!.rows.length).toBe(1); expect(listFor(m, "flow:28:in")!.title).toBe("New referrals in · last 28 days · 1");
  });
});

describe("v2 model, one rounding rule (Brandon, 2026-10-02)", () => {
  it("V2-M19 days shown and past-due status always agree: late <=> days shown > normal, for every row (processor and escalation)", () => {
    const m = model([item("MN", "9000009001", "2026-09-28T10:00:00-04:00", { values: { [MN]: 9, [ESC]: 2 } })],
      [enter("9000009001", 9, "2026-09-28T10:00:00-04:00"), ev("MN", "9000009001", ESC, null, 2, "2026-09-30T13:00:00-04:00", { user: P })]);
    const r = m.rows[0]; expect(r.escDays).toBe(2); // Sep 30 13:00 -> Oct 1 14:00 is 1.x business days, shown as 2
    expect(r.late).toBe((r.escDays ?? 0) > (r.normal ?? 0));
  });
});

describe("v2 model, escalations worked only by Janelle or Katie; work credited to the person (Josh, 2026-10-02)", () => {
  const JANELLE = 102869398, KATIE_U = 109186258, SAM_U = 101662208;
  const evProcessor = ev("MN", "9000007001", EVID, null, null, "2026-09-25T10:00:00-04:00", { user: P }); // processor first
  const items: ItemRow[] = [
    item("MN", "9000007001", "2026-09-20T10:00:00-04:00", { values: { [MN]: 9, [ESC]: 0 } }),
    item("MN", "9000007002", "2026-09-20T10:00:00-04:00", { values: { [MN]: 9, [ESC]: 2 } }),
    item("MN", "9000007003", "2026-09-20T10:00:00-04:00", { values: { [MN]: 9, [ESC]: 0 } }),
  ];
  const events = [
    enter("9000007001", 9, "2026-09-21T10:00:00-04:00"), ev("MN", "9000007001", ESC, null, 0, "2026-09-22T10:00:00-04:00", { user: P }), evProcessor,
    ev("MN", "9000007001", EVID, null, null, "2026-09-26T10:00:00-04:00", { user: JANELLE }),
    enter("9000007002", 9, "2026-09-21T10:00:00-04:00"), ev("MN", "9000007002", ESC, null, 2, "2026-09-22T10:00:00-04:00", { user: P }),
    ev("MN", "9000007002", EVID, null, null, "2026-09-26T10:00:00-04:00", { user: KATIE_U }),
    // a shared-account write the gateway log matched to Janelle (rule 2) counts like her own edit
    enter("9000007003", 9, "2026-09-21T10:00:00-04:00"), ev("MN", "9000007003", ESC, null, 0, "2026-09-22T10:00:00-04:00", { user: P }),
    { ...ev("MN", "9000007003", EVID, null, null, "2026-09-26T10:00:00-04:00", { user: 100161122 }), actorKey: "janelle" },
  ];
  const m = model(items, events);
  const r = (id: string) => m.rows.find((x) => x.itemId === id)!;
  it("Janelle acting on a manager escalation = being worked", () => { expect(r("9000007001").reason).toBe("escWorking"); });
  it("Katie acting on a final escalation = being worked", () => { expect(r("9000007002").reason).toBe("escWorking"); });
  it("a named Command Center write by Janelle counts", () => { expect(r("9000007003").reason).toBe("escWorking"); });
  it("a shared-account write nobody could name does not count", () => {
    const m2 = model([items[2]], [events[6], events[7], { ...events[8], actorKey: undefined }]);
    expect(m2.rows[0].reason).toBe("escUntouched");
  });
  it("work is credited to whoever did it, under the step table's name for them", () => {
    const w = model([item("INS", "9000007010", "2026-09-28T09:00:00-04:00", { values: { [INS]: 4 } })], [
      ev("INS", "9000007010", INS, null, 3, "2026-09-28T09:30:00-04:00", { user: SAM_U }),
      ev("INS", "9000007010", INS, 3, 4, "2026-09-29T10:00:00-04:00", { user: SAM_U }),
    ]);
    expect(w.people.some((p) => p.name === "Sam")).toBe(true);
    expect(w.people.some((p) => p.name === "Samantha")).toBe(false);
  });
});

