/**
 * Synthetic snapshot sized to the volumes measured on 2026-10-01 (snapshot/VOLUME-HEALTH.md, VERIFY-1 V1):
 * MN WIP Chase 77 / Confirm 77 / Stuck 51 / Send 24 / Evaluate 17 / Dr Appt 5; INS Benefits 39 / Denied 25 /
 * Outstanding 21 / Stuck 17 / Submit 3 / DVS 2; WC Review 61 / Stuck 43 / Welcome 28; escalations Janelle 133,
 * Katie 29; ~25 releases a week. IDs are synthetic (9xxxxxxxxx), no names. Used for design exploration screenshots.
 */
import type { ItemRow, RawEvent } from "../types";
import { OO_CONFIG as C } from "../config";
import { buildSnapshot, type FullSnapshot } from "../model/buildSnapshot";
import { ev, item, uid } from "./builders";

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const DAY = 86400000;

export function realisticSnapshot(snapshotAt = Date.UTC(2026, 9, 1, 18)): FullSnapshot {
  const r = rng(42); const items: ItemRow[] = []; const events: RawEvent[] = [];
  let id = 9100000000; let p = 1;
  const iso = (ms: number) => new Date(ms).toISOString();
  const ago = (days: number) => snapshotAt - days * DAY;
  const between = (a: number, b: number) => a + r() * (b - a);
  const MN = C.stageColumn.MN, INS = C.stageColumn.INS, WC = C.stageColumn.WC, EM = C.escalationColumn.MN, EI = C.escalationColumn.INS, EW = C.escalationColumn.WC;
  const add = (board: "MN" | "INS" | "WC", created: number, path: [number, number][], opts: { esc?: [number, number][]; group?: string; method?: number; source?: number; u?: string } = {}) => {
    const i = String(id++); const col = (C.stageColumn as Record<string, string>)[board]; const ecol = board === "MN" ? EM : board === "INS" ? EI : EW;
    const last = path[path.length - 1][0]; const lastEsc = opts.esc?.length ? opts.esc[opts.esc.length - 1][0] : null;
    items.push(item(board, i, iso(created), { uid: opts.u ?? uid(p), group: opts.group, values: { [col]: last, [ecol]: lastEsc, [C.clinicalsMethodColumn]: opts.method ?? 0, [C.referralSourceColumn]: opts.source ?? 1 } }));
    let prev: number | null = null;
    for (const [label, at] of path) { events.push(ev(board, i, col, prev, label, iso(at))); prev = label; }
    let pe: number | null = null;
    for (const [label, at] of opts.esc ?? []) { events.push(ev(board, i, ecol, pe, label, iso(at))); pe = label; }
    return i;
  };
  // 1) ~26 weeks of completed journeys (MN -> INS -> WC -> released), typical stage times near observed medians.
  for (let w = 0; w < 26; w++) for (let k = 0; k < 25; k++) {
    const t0 = ago(w * 7 + 21 + r() * 7); const u = uid(p++);
    const mnEnd = t0 + between(1.5, 9) * DAY; const insEnd = mnEnd + between(1, 6) * DAY; const wcRev = insEnd + between(0.5, 3) * DAY; const rel = wcRev + between(0.1, 1.2) * DAY;
    if (rel > snapshotAt) continue;
    const chase = r() < 0.5;
    add("MN", t0, chase ? [[8, t0], [9, t0 + 0.2 * DAY], [11, t0 + 0.5 * DAY], [14, mnEnd]] : [[8, t0], [9, t0 + 0.2 * DAY], [10, t0 + 0.5 * DAY], [14, mnEnd]], { group: "group_mm1x5q4e", method: r() < 0.6 ? 0 : 1, u });
    add("INS", mnEnd, [[3, mnEnd], [4, mnEnd + 0.3 * DAY], [6, mnEnd + 0.5 * DAY], [7, insEnd]], { group: "group_mm2vw3c0", u });
    add("WC", insEnd, [[7, insEnd], [0, wcRev], [4, rel]], { group: "group_mm1x5s5d", u });
  }
  // 2) Current queue WIP with realistic ages.
  // Ages skew young (most work is recent, with a long tail) except where the measured data shows a real backlog (uniform).
  const open = (board: "MN" | "INS" | "WC", label: number, n: number, ageMin: number, ageMax: number, method?: number, uniform = false) => {
    for (let k = 0; k < n; k++) { const u = between(0, 1); const c = ago(ageMin + (ageMax - ageMin) * (uniform ? u : u * u * u)); add(board, c, [[board === "MN" ? 8 : board === "INS" ? 3 : 7, c], ...(label !== (board === "MN" ? 8 : board === "INS" ? 3 : 7) ? [[label, c + 0.3 * DAY] as [number, number]] : [])], { method }); p++; }
  };
  open("MN", 8, 17, 0.1, 3); open("MN", 9, 24, 0.1, 4); open("MN", 10, 77, 0.5, 12); open("MN", 11, 50, 1, 25, 0); open("MN", 11, 27, 1, 14, 1); open("MN", 0, 5, 3, 30);
  open("INS", 3, 39, 0.1, 6, undefined, true); open("INS", 4, 3, 0.1, 2); open("INS", 6, 21, 0.5, 15); open("INS", 1, 2, 0.5, 3);
  open("WC", 7, 28, 0.1, 6); open("WC", 0, 61, 0.1, 4);
  // 3) Escalations: Janelle (idx 0) 133 = MN 26, INS 56 (25 on Auth Denied), WC 3, rest on INT-like MN; Katie (idx 2) MN 9, INS 20.
  const escalate = (board: "MN" | "INS" | "WC", stage: number, idx: 0 | 2, n: number, holdMin: number, holdMax: number) => {
    for (let k = 0; k < n; k++) { const held = between(holdMin, holdMax); const c = ago(held + between(2, 20)); add(board, c, [[board === "MN" ? 8 : board === "INS" ? 3 : 7, c], [stage, c + 0.5 * DAY]], { esc: [[idx, ago(held)]] }); p++; }
  };
  escalate("MN", 11, 0, 20, 10, 70); escalate("MN", 10, 0, 6, 0.2, 1.5);
  escalate("INS", 3, 0, 31, 8, 60); escalate("INS", 0, 0, 25, 15, 75);
  escalate("WC", 7, 0, 3, 0.5, 4);
  escalate("MN", 9, 2, 6, 1, 6); escalate("MN", 8, 2, 3, 0.2, 0.9);
  escalate("INS", 6, 2, 11, 20, 66); escalate("INS", 3, 2, 9, 5, 40);
  // A few items bouncing between queue and escalation.
  for (let k = 0; k < 6; k++) { const c = ago(40); add("INS", c, [[3, c]], { esc: [[0, ago(30)], [1, ago(25)], [0, ago(18)], [1, ago(12)], [2, ago(1)]] }); p++; }
  // 3b) Intake: ~25 completed per week, 40 collecting info, 6 in clean-up (dates after the sub-stage history start).
  const INT = C.stageColumn.INT, SUB = C.intSubStageColumn;
  for (let w = 0; w < 6; w++) for (let k = 0; k < 25; k++) { const c = ago(w * 7 + between(1, 7)); const i = String(id++); const done = c + between(0.3, 3) * DAY; if (done > snapshotAt) continue;
    items.push(item("INT", i, iso(c), { group: "group_mm1y57sz", values: { [INT]: 1 } })); events.push(ev("INT", i, INT, null, 1, iso(done))); }
  for (let k = 0; k < 40; k++) { const c = ago(0.1 + 3.9 * between(0, 1) ** 3); items.push(item("INT", String(id++), iso(c), { group: "group_mm1xf2jb", values: { [INT]: null } })); }
  for (let k = 0; k < 6; k++) { const c = ago(between(1, 5)); const i = String(id++); items.push(item("INT", i, iso(c), { group: "group_mm6c3rhb", values: { [INT]: null, [SUB]: 1 } })); events.push(ev("INT", i, SUB, null, 1, iso(c + 0.5 * DAY))); }
  // 4) Dead leads (Stuck): MN 51, INS 17, WC 43, steady ~4 per week.
  const dead = (board: "MN" | "INS" | "WC", n: number, stuckLabel: number, group: string) => { for (let k = 0; k < n; k++) { const s = ago(between(1, 180)); const c = s - between(3, 20) * DAY; add(board, c, [[board === "MN" ? 8 : board === "INS" ? 3 : 7, c], [stuckLabel, s]], { group }); p++; } };
  dead("MN", 51, 15, "group_mm1xyczx"); dead("INS", 17, 2, "group_mm5g7twt"); dead("WC", 43, 2, "group_mm1xyczx");
  return buildSnapshot({ snapshotAt, items, events, mode: "fixture", commsSla: { open: 31, over: 9, resolved: 612, within: 541, withinPct: 88, medianMs: 3.6 * 3600000, byHow: { called: 240, texted: 372 }, reps: [] },
    fax: { weeks: Array.from({ length: 12 }, (_, i) => ({ weekStart: `w${i}`, byGroup: { Faxes: 80 + (i % 3) * 7, Calls: 95, "Text Messages": 310, "Miss Voicemails": 45 } })), neverClosed: { Faxes: 822, Calls: 1092, "Text Messages": 3733, "Miss Voicemails": 538 } },
    excludedIntCounts: { total: 1729, escalated: 264 }, cursors: { INT: snapshotAt, MN: snapshotAt, INS: snapshotAt, WC: snapshotAt }, fetchErrors: [],
    access: { managers: ["josh", "janelle", "brandon", "corey", "katie"], callAnswererKeys: ["katie", "janelle", "masani", "josh", "brandon"],
      roles: { masheke: ["evaluate", "sendRequest", "chaseParachute", "updateClinicals", "fax"], samantha: ["benefits", "submitAuth", "authOutstanding"], madeline: ["chaseFax", "confirmReceipt"],
        victor: ["profile", "intakeCleanup", "unverifiedReferrals"], masani: [], katie: ["profile", "unverifiedReferrals", "doctorAppointments", "intakeCleanup", "welcomeCall"],
        corey: ["welcomeCall"], brandon: ["profile", "finalConfirm", "unverifiedReferrals", "dvs", "benefits", "submitAuth", "authOutstanding"], janelle: ["doctorAppointments"], josh: ["authDenied"] } } });
}
