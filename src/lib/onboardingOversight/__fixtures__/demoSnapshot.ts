/**
 * Synthetic demo snapshot for fixture mode (VITE_OO_FIXTURE=1) and UI tests. Contains at least one
 * example of each holder state, a ping-pong loop, a parked item, stale flags, and released journeys.
 */
import type { Dict } from "../types";
import type { ItemRow, RawEvent } from "../types";
import { OO_CONFIG as C } from "../config";
import { buildSnapshot, type FullSnapshot } from "../model/buildSnapshot";
import { ev, item, uid, move } from "./builders";

const MN = C.stageColumn.MN, INS = C.stageColumn.INS, WC = C.stageColumn.WC, INT = C.stageColumn.INT;
const ESC_MN = C.escalationColumn.MN, ESC_INS = C.escalationColumn.INS;
const D = (d: number, h = 10) => new Date(Date.UTC(2026, 8, d, h + 4)).toISOString(); // Sept 2026, ET hour h

export function demoSnapshot(snapshotAt = Date.UTC(2026, 9, 1, 18)): FullSnapshot {
  const items: ItemRow[] = []; const events: RawEvent[] = [];
  let id = 9000000001;
  // 8 released patients: MN -> INS -> WC -> released
  for (let p = 1; p <= 8; p++) {
    const u = uid(p); const start = p;
    const mn = String(id++), ins = String(id++), wc = String(id++);
    items.push(item("MN", mn, D(start), { uid: u, group: "group_mm1x5q4e", values: { [MN]: 14, [C.clinicalsMethodColumn]: p % 2, [C.referralSourceColumn]: p % 3 === 0 ? 1 : 2 } }));
    events.push(ev("MN", mn, MN, null, 8, D(start)), ev("MN", mn, MN, 8, 9, D(start, 13)), ev("MN", mn, MN, 9, 11, D(start + 1)), ev("MN", mn, MN, 11, 14, D(start + 3)));
    items.push(item("INS", ins, D(start + 3, 11), { uid: u, group: "group_mm2vw3c0", values: { [INS]: 7 } }));
    events.push(ev("INS", ins, INS, null, 3, D(start + 3, 11)), ev("INS", ins, C.insBenefitsMarkerColumn, null, 1, D(start + 3, 12)), ev("INS", ins, INS, 3, 4, D(start + 3, 14)), ev("INS", ins, INS, 4, 6, D(start + 4)), ev("INS", ins, INS, 6, 7, D(start + 6)));
    items.push(item("WC", wc, D(start + 6, 11), { uid: u, group: "group_mm1x5s5d", values: { [WC]: 4 } }));
    events.push(ev("WC", wc, WC, null, 7, D(start + 6, 11)), ev("WC", wc, WC, 7, 0, D(start + 7)), ev("WC", wc, WC, 0, 4, D(start + 7, 15)));
  }
  // Open queue items across codes
  const open = (board: "MN" | "INS" | "WC", label: number, day: number, extra: Record<string, number | string | null> = {}) => {
    const i = String(id++); const col = (C.stageColumn as Dict)[board];
    items.push(item(board, i, D(day), { uid: uid(100 + Number(i) % 1000), values: { [col]: label, ...extra } }));
    events.push(ev(board, i, col, null, label, D(day)));
    return i;
  };
  open("MN", 8, 29); open("MN", 9, 30); open("MN", 10, 22); open("MN", 11, 10, { [C.clinicalsMethodColumn]: 0 }); open("MN", 11, 12, { [C.clinicalsMethodColumn]: 1 });
  open("INS", 3, 30); open("INS", 6, 8); open("INS", 6, 25); open("INS", 0, 20); open("WC", 7, 29); open("WC", 0, 30);
  // PP-1 style ping-pong: chase (fax) <-> Final Decisions, now in FINAL
  const pp = String(id++);
  items.push(item("MN", pp, D(1), { uid: uid(900), values: { [MN]: 11, [ESC_MN]: 2, [C.clinicalsMethodColumn]: 0 } }));
  events.push(ev("MN", pp, MN, null, 11, D(1)), ev("MN", pp, ESC_MN, null, 2, D(5)), ev("MN", pp, ESC_MN, 2, 1, D(8)), ev("MN", pp, ESC_MN, 1, 2, D(12)), ev("MN", pp, ESC_MN, 2, 1, D(15)), ev("MN", pp, ESC_MN, 1, 2, D(22)));
  // Parked with Manager Intervention 30+ days (INS), and a stuck WC item
  const parked = open("INS", 3, 1); events.push(ev("INS", parked, ESC_INS, null, 0, D(2)));
  items.find((x) => x.itemId === parked)!.values[ESC_INS] = { index: 0, nonEmpty: true };
  const stuck = open("WC", 2, 3);
  void stuck;
  // Stale flag on an exited INS item (DH-19)
  const ex = String(id++);
  items.push(item("INS", ex, D(2), { uid: uid(901), group: "group_mm2vw3c0", values: { [INS]: 7, [ESC_INS]: 0 } }));
  events.push(ev("INS", ex, INS, null, 3, D(2)), ev("INS", ex, INS, 3, 7, D(4)));
  // INT intake items and an item moved into Stuck by group only
  const i1 = String(id++); items.push(item("INT", i1, D(28), { values: { [INT]: null } }));
  const i2 = String(id++); items.push(item("INT", i2, D(10), { group: "group_mm1xyczx", values: { [INT]: null } }));
  events.push(move("INT", i2, "group_mm1xf2jb", "group_mm1xyczx", D(14)));
  return buildSnapshot({ snapshotAt, items, events, mode: "fixture", commsSla: { open: 12, over: 3, resolved: 140, within: 128, withinPct: 91, medianMs: 3.2 * 3600000, byHow: { called: 60, texted: 80 }, reps: [] },
    fax: { weeks: Array.from({ length: 12 }, (_, i) => ({ weekStart: `2026-07-${String(6 + i).padStart(2, "0")}`, byGroup: i === 3 ? {} : { Faxes: 20 + i, Calls: 30, "Text Messages": 90, "Miss Voicemails": 12 } })), neverClosed: { Faxes: 822, Calls: 1092, "Text Messages": 3733, "Miss Voicemails": 538 } },
    excludedIntCounts: { total: 1729, escalated: 264 }, cursors: { INT: snapshotAt, MN: snapshotAt, INS: snapshotAt, WC: snapshotAt }, fetchErrors: [],
    access: { managers: ["josh", "janelle", "brandon", "corey", "katie"], callAnswererKeys: ["katie", "janelle", "masani", "josh", "brandon"],
      roles: { masheke: ["evaluate", "sendRequest", "chaseParachute", "updateClinicals", "fax"], samantha: ["benefits", "submitAuth", "authOutstanding"], madeline: ["chaseFax", "confirmReceipt"],
        victor: ["profile", "intakeCleanup", "unverifiedReferrals"], masani: [], katie: ["profile", "unverifiedReferrals", "doctorAppointments", "intakeCleanup", "welcomeCall"],
        corey: ["welcomeCall"], brandon: ["profile", "finalConfirm", "unverifiedReferrals", "dvs", "benefits", "submitAuth", "authOutstanding"], janelle: ["doctorAppointments"], josh: ["authDenied", "evaluate"] } } });
}
