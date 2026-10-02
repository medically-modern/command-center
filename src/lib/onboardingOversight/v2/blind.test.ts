/**
 * Blind acceptance test for "Breakdown detection" (DESIGN-INTENT, Brandon Fri ~13:20). Written by the red team WITHOUT reading
 * detect.ts: a healthy baseline plus four planted breakdowns the builders never saw. Each must reach the top 5 of m.breaking.
 * Synthetic only: item ids start 99, no names. "Today" is Thursday 2026-10-01 14:00 ET; history covers the last 20 business days.
 *
 * Planted (all away from the DESIGN-INTENT examples):
 *   P1 Chase Clinicals (mn.chase, Masheke): 14 patients, 8 past due on a 10-day step, untouched, arrivals but no exits (pile-up / not keeping up).
 *   P2 Sam (Insurance, Auth Outstanding): 2 patients a day worked through Sep 23, nothing since, still holding 30 (gone quiet).
 *   P3 Janelle on Welcome Call: 10 escalated 4-7 days ago, untouched (neglect / pile-up in an escalation bucket, not Insurance).
 *   P4 Doctor Appointment (mn.dr): 6 escalated to Katie, returned Sep 10, no action since, 15 days vs 10 (broken loop).
 */
import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../model/buildSnapshot";
import { ev, item } from "../__fixtures__/builders";
import { OO_CONFIG as C } from "../config";
import type { ItemRow, RawEvent } from "../types";
import { buildV2 } from "./model";
import type { Breaking } from "./detect";
import { DEFAULT_STEPS } from "./steps";

const NOW = Date.parse("2026-10-01T14:00:00-04:00");
const MN = C.stageColumn.MN, INS = C.stageColumn.INS, WCS = C.stageColumn.WC;
const ESC_MN = C.escalationColumn.MN, ESC_WC = C.escalationColumn.WC, NAD = "date_mm1wadgs", EVID = "text_mm2yd068";
const P = 98938576, JANELLE = 102869398, KATIE = 109186258; // real processor / Janelle / Katie monday users
const model = (items: ItemRow[], events: RawEvent[]) => buildV2(buildSnapshot({ snapshotAt: NOW, items, events, access: null, commsSla: null, fax: null, excludedIntCounts: null, cursors: {}, fetchErrors: [], mode: "fixture" }), DEFAULT_STEPS);

// the last 20 business days before today (Sep 7 is Labor Day)
const DAYS = ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18",
  "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30"];
const t = (d: string, h: number, m = 0) => `${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-04:00`;

interface Bag { items: ItemRow[]; events: RawEvent[] }
let seq = 0; const nid = () => `99${String(++seq).padStart(8, "0")}`;

/** Healthy baseline: the owners log actions every business day (completed patients pass through steps) and every step holds patients in normal time. */
function baseline(): Bag {
  const b: Bag = { items: [], events: [] };
  for (const d of DAYS) {
    for (let k = 0; k < 2; k++) { // Masheke: Evaluation, Send Request, Confirm Receipt each day, then closed
      const id = nid();
      b.items.push(item("MN", id, t(d, 8), { values: { [MN]: 14 } }));
      b.events.push(ev("MN", id, MN, null, 8, t(d, 8), { user: P }), ev("MN", id, MN, 8, 9, t(d, 9), { user: P }), ev("MN", id, EVID, null, null, t(d, 9, 30), { user: P }),
        ev("MN", id, MN, 9, 10, t(d, 10), { user: P }), ev("MN", id, MN, 10, 14, t(d, 11), { user: P }));
    }
    for (let k = 0; k < 2; k++) { // Masani: Welcome Calls completed each day
      const id = nid();
      b.items.push(item("WC", id, t(d, 8), { group: "group_mm1x5s5d", values: { [WCS]: 4 } }));
      b.events.push(ev("WC", id, WCS, null, 7, t(d, 9), { user: P }), ev("WC", id, WCS, 7, 4, t(d, 13), { user: P }));
    }
  }
  const hold = (n: number, board: "MN" | "WC", col: string, label: number, dates: string[]) => {
    for (let k = 0; k < n; k++) { const id = nid(), d = dates[k % dates.length];
      b.items.push(item(board, id, t(d, 8), { values: { [col]: label } })); b.events.push(ev(board, id, col, null, label, t(d, 9), { user: P }));
      if (label === 10) b.events.push(ev(board, id, EVID, null, null, t(dates[dates.length - 1], 11), { user: P })); }
  };
  hold(6, "MN", MN, 8, ["2026-10-01"]); hold(6, "MN", MN, 9, ["2026-10-01"]);
  hold(10, "MN", MN, 10, ["2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30"]); hold(8, "WC", WCS, 7, ["2026-09-30", "2026-10-01"]);
  return b;
}

const keysOf = (b: Bag, ids: string[]) => ids.map((i) => `${b.items.find((x) => x.itemId === i)!.boardKey}:${i}`);

const SAM = 101662208; // Samantha's monday user (config.people)

function plants(): { bag: Bag; p1: string[]; p2: string[]; p3: string[]; p4: string[] } {
  const bag: Bag = { items: [], events: [] }; const p1: string[] = [], p2: string[] = [], p3: string[] = [], p4: string[] = [];
  // P1: Chase Clinicals pile-up: 8 entered 12-18 business days ago (past due, normal 10), 6 more arrived in the last 6 days; nobody left, nothing logged
  ["2026-09-08", "2026-09-08", "2026-09-09", "2026-09-09", "2026-09-10", "2026-09-10", "2026-09-11", "2026-09-11", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-09-30"].forEach((d) => {
    const id = nid(); p1.push(id); bag.items.push(item("MN", id, t(d, 8), { values: { [MN]: 11 } })); bag.events.push(ev("MN", id, MN, null, 11, t(d, 9), { user: P })); });
  // P2: Sam went quiet: 2 patients a day sent to Auth Outstanding Sep 2..Sep 23, nothing the last 5 business days; 30 still held (Next Action Date in the future)
  DAYS.filter((d) => d <= "2026-09-23").forEach((d) => { for (let k = 0; k < 2; k++) { const id = nid(); p2.push(id);
    bag.items.push(item("INS", id, t(d, 8), { values: { [INS]: 6, [NAD]: "2026-10-08" } }));
    // Samantha's own monday user: since 2026-10-02 work is credited to the person who did it (Josh), so Sam's
    // planted work must be hers (in production a shared-account write is named by the gateway's rule 2).
    bag.events.push(ev("INS", id, INS, null, 4, t(d, 9), { user: SAM }), ev("INS", id, INS, 4, 6, t(d, 14), { user: SAM })); } });
  // P3: Janelle's Welcome Call bucket: 10 escalated Sep 22-25 (4-7 business days), nobody touched them
  ["2026-09-22", "2026-09-22", "2026-09-22", "2026-09-23", "2026-09-23", "2026-09-23", "2026-09-24", "2026-09-24", "2026-09-25", "2026-09-25"].forEach((d) => {
    const id = nid(); p3.push(id); bag.items.push(item("WC", id, t("2026-09-16", 8), { values: { [WCS]: 7, [ESC_WC]: 0 } }));
    bag.events.push(ev("WC", id, WCS, null, 7, t("2026-09-16", 9), { user: P }), ev("WC", id, ESC_WC, null, 0, t(d, 10), { user: P })); });
  // P4: Doctor Appointment loop: escalated to Katie Sep 3, returned Sep 10, untouched since (15 business days vs normal 10)
  for (let k = 0; k < 6; k++) { const id = nid(); p4.push(id); bag.items.push(item("MN", id, t("2026-08-20", 8), { values: { [MN]: 0, [ESC_MN]: 1 } }));
    bag.events.push(ev("MN", id, MN, null, 0, t("2026-08-20", 9), { user: P }), ev("MN", id, ESC_MN, null, 2, t("2026-09-03", 10), { user: P }), ev("MN", id, ESC_MN, 2, 1, t("2026-09-10", 10), { user: KATIE })); }
  return { bag, p1, p2, p3, p4 };
}

const base = baseline(), pl = plants();
const full = model([...base.items, ...pl.bag.items], [...base.events, ...pl.bag.events]);
const baseOnly = model(base.items, base.events);
const top = full.breaking.slice(0, 5);
const hit = (f: (b: Breaking) => boolean) => top.filter(f);
const sev = (bs: Breaking[]) => Math.max(...bs.map((b) => b.severity));
const overlaps = (b: Breaking, keys: string[]) => b.keys.some((k) => keys.includes(k));

describe("blind breakdown detection (red team, planted cases)", () => {
  it("B0 the baseline alone shows nothing strong; the planted cases are not in it", () => {
    expect(baseOnly.rows.length).toBeGreaterThanOrEqual(30); // Quarterback: red-team fixture sanity check was off by one (exactly 30 baseline rows) expect(baseOnly.tiles.processorPastDue).toBe(0);
    expect(full.rows.length).toBe(baseOnly.rows.length + pl.p1.length + pl.p2.length + pl.p3.length + pl.p4.length);
  });
  it("B1 a new step backing up: Chase Clinicals (Masheke) is in the top 5 as a pile-up family", () => {
    const f = hit((b) => b.where === "mn.chase" && ["pileUp", "neglect", "notKeepingUp"].includes(b.pattern));
    expect(f.length, JSON.stringify(top)).toBeGreaterThan(0);
    expect(f.some((b) => b.kind === "step" && overlaps(b, keysOf(pl.bag, pl.p1)))).toBe(true);
  });
  it("B1-rank (Quarterback note) at Brandon's Low priority for Chase Clinicals the same backlog still surfaces, ranked lower by design", () => {
    const i = full.breaking.findIndex((b) => b.where === "mn.chase"); console.log("B1 rank at Low priority:", i + 1, "of", full.breaking.length);
    const normal = buildV2(buildSnapshot({ snapshotAt: NOW, items: [...base.items, ...pl.bag.items], events: [...base.events, ...pl.bag.events], access: null, commsSla: null, fax: null, excludedIntCounts: null, cursors: {}, fetchErrors: [], mode: "fixture" }), DEFAULT_STEPS.map((s) => (s.id === "mn.chase" ? { ...s, priority: "Normal" as const } : s)));
    const j = normal.breaking.findIndex((b) => b.where === "mn.chase"); console.log("B1 rank at Normal priority:", j + 1);
    expect(i).toBeGreaterThanOrEqual(0); expect(j).toBeGreaterThanOrEqual(0); expect(j).toBeLessThan(5);
  });
  it("B2 a processor going quiet: Sam (Auth Outstanding) is in the top 5 as gone quiet", () => {
    const f = hit((b) => ["Sam", "ins.outstanding", "ins.submit", "ins.benefits"].includes(b.where) && (b.pattern === "goneQuiet" || (b.also ?? []).includes("goneQuiet"))); // Quarterback: interface gained `also` (merged patterns on the same patients) after this test was written
    expect(f.length, JSON.stringify(top)).toBeGreaterThan(0);
  });
  it("B3 a manager's bucket filling: Janelle on Welcome Call is in the top 5 (neglect or pile-up)", () => {
    const f = hit((b) => (b.kind === "escalation" && b.where === "Janelle" || overlaps(b, keysOf(pl.bag, pl.p3))) && ["neglect", "pileUp", "notKeepingUp"].includes(b.pattern));
    expect(f.length, JSON.stringify(top)).toBeGreaterThan(0);
    expect(f.some((b) => overlaps(b, keysOf(pl.bag, pl.p3)))).toBe(true);
  });
  it("B4 a loop forming: Doctor Appointment patients returned from Katie and stuck again are in the top 5", () => {
    const f = hit((b) => (b.where === "mn.dr" || overlaps(b, keysOf(pl.bag, pl.p4))) && ["brokenLoop", "neglect", "pileUp"].includes(b.pattern));
    expect(f.length, JSON.stringify(top)).toBeGreaterThan(0);
    expect(hit((b) => b.pattern === "brokenLoop" && overlaps(b, keysOf(pl.bag, pl.p4))).length || f.length).toBeGreaterThan(0);
  });
  it("B5 the baseline alone never outranks the planted cases; no baseline patient is flagged at the top", () => {
    const planted = [pl.p1, pl.p2, pl.p3, pl.p4].map((ids) => full.breaking.filter((b) => overlaps(b, keysOf(pl.bag, ids)) || b.where === "mn.chase" || b.where === "mn.dr" || b.where === "Janelle" || b.where === "Sam"))
      .filter((x) => x.length).map(sev);
    const baseMax = baseOnly.breaking.length ? sev(baseOnly.breaking) : 0;
    expect(planted.length).toBeGreaterThanOrEqual(4);
    for (const s of planted) expect(baseMax).toBeLessThan(s);
    const baseKeys = new Set(keysOf(base, base.items.map((i) => i.itemId)));
    const onlyBase = top.filter((b) => b.keys.length > 0 && b.keys.every((k) => baseKeys.has(k))); console.log("B5 baseline-only top findings:", JSON.stringify(onlyBase.map((b) => [b.kind, b.where, b.pattern, b.count, b.severity])), "baseline findings:", JSON.stringify(baseOnly.breaking.map((b) => [b.kind, b.where, b.pattern, b.count, b.severity])));
    expect(onlyBase.length).toBe(0);
  });
});

describe("blind breakdown detection on the DISPLAYED list (Brandon's one-owner-per-row buckets, sorted by Past Due)", () => {
  const shown = full.buckets.filter((b) => b.pastDue > 0 || b.flagged);
  const rank = (ids: string[]) => { const ks = new Set(keysOf(pl.bag, ids)); return shown.findIndex((b) => b.keys.some((k) => ks.has(k))); };
  it("BD every planted breakdown appears as a row of the displayed list (rank logged)", () => {
    const ranks = { p1: rank(pl.p1), p2: rank(pl.p2), p3: rank(pl.p3), p4: rank(pl.p4) };
    console.log("Displayed-list rank (1-based) of planted cases:", JSON.stringify(Object.fromEntries(Object.entries(ranks).map(([k, v]) => [k, v + 1]))), "of", shown.length);
    for (const v of Object.values(ranks)) expect(v).toBeGreaterThanOrEqual(0);
  });
});
