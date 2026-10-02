/**
 * Per-code and per-holder aggregates shared by the speed, flow, aging and health metrics
 * (BUILD-SPEC §3.4-3.6, §3.14). One pass over holder spans; every count keeps its item refs.
 */
import type { Dict } from "../types";
import type { HolderSpan, ItemRef, Status } from "../types";
import { percentile } from "../time/percentile";
import { type Ctx, inPipelineGroup, isSnoozed, key, spanBh, speedEligible } from "./context";
import { codeHealth, holderHealth, thresholdFor } from "./health";

export interface CodeStat {
  code: string; wip: number; snoozed: number; overYellow: number; overRed: number; overdueRefs: ItemRef[];
  completedBh: number[]; priorCompletedBh: number[]; entered: number; exited: number; oldestBd: number | null;
  p50Bd: number | null; p90Bd: number | null; priorP50Bd: number | null; status: Status; proposed: boolean; wipRefs: ItemRef[];
  unknownAge: number; exitedToHold: number; holdExitBd: number[]; snoozedLong: number; reason?: string;
}

const bd = (bh: number) => bh / 24;

/** Current QUEUE spans (one per item), restricted to in-pipeline, filter-allowed items. */
export function currentQueue(c: Ctx): HolderSpan[] {
  const out: HolderSpan[] = [];
  for (const [k, s] of c.current) {
    const it = c.itemByKey.get(k);
    if (!it || !c.allowed(it) || !inPipelineGroup(c, it)) continue;
    if (s.kind === "QUEUE" && s.endMs == null) out.push(s);
  }
  return out;
}

export function codeStats(c: Ctx): Map<string, CodeStat> {
  const m = new Map<string, CodeStat>();
  const get = (code: string) => {
    let s = m.get(code);
    if (!s) { s = { code, wip: 0, snoozed: 0, overYellow: 0, overRed: 0, overdueRefs: [], completedBh: [], priorCompletedBh: [], entered: 0, exited: 0,
      oldestBd: null, p50Bd: null, p90Bd: null, priorP50Bd: null, status: "nodata", proposed: false, wipRefs: [], unknownAge: 0, exitedToHold: 0, holdExitBd: [], snoozedLong: 0 }; m.set(code, s); }
    return s;
  };
  const openAges = new Map<string, number[]>();
  for (const s of currentQueue(c)) {
    const st = get(s.code!); const it = c.itemByKey.get(key(s.boardKey, s.itemId))!;
    st.wip++; st.wipRefs.push({ boardKey: s.boardKey, itemId: s.itemId });
    const age = bd(spanBh(c, s));
    if (!s.synthetic) st.oldestBd = Math.max(st.oldestBd ?? 0, age); else st.unknownAge++;
    const tt = thresholdFor(c.cfg, s.code!);
    if (isSnoozed(c, it)) { st.snoozed++; if (tt && !s.synthetic && age >= 2 * tt.r) st.snoozedLong++; continue; }
    const t = thresholdFor(c.cfg, s.code!);
    if (t && !s.synthetic) {
      if (age >= t.y) st.overYellow++;
      if (age >= t.r) { st.overRed++; st.overdueRefs.push({ boardKey: s.boardKey, itemId: s.itemId }); }
      (openAges.get(s.code!) ?? openAges.set(s.code!, []).get(s.code!)!).push(age);
    }
  }
  // Completed code time (S-04): per item per code, summed over its segments, counted where the code's last segment
  // ended. Only forward exits (next state = later code or EXITED) count; exits into a hold are tracked separately.
  // Spans ending in a bulk event and non-eligible items (duplicates, import cohorts) are excluded.
  const order = c.cfg.codeOrder as Record<string, number>;
  for (const [k, spans] of c.spansByItem) {
    const it = c.itemByKey.get(k); if (!it || !c.allowed(it)) continue;
    const eligible = speedEligible(c, it);
    const per = new Map<string, { bh: number; lastEnd: number | null; open: boolean; forward: boolean; bulk: boolean; sawMarker: boolean; raw31: boolean }>();
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      if (s.kind !== "QUEUE" || !s.code) continue;
      if (!s.reentry && s.startMs >= c.start && s.startMs <= c.now && eligible) get(s.code).entered++;
      const nextImmediate = spans[i + 1];
      const forward = !!nextImmediate && (nextImmediate.kind === "EXITED" || (nextImmediate.kind === "QUEUE" && (order[nextImmediate.code ?? ""] ?? 0) > (order[s.code] ?? 0)));
      const r = per.get(s.code) ?? { bh: 0, lastEnd: null, open: false, forward: false, bulk: false, sawMarker: false, raw31: false };
      r.bh += spanBh(c, s); r.lastEnd = s.endMs; r.open = s.endMs == null; r.forward = forward; r.bulk = s.endEventBulk;
      if (s.code === "1.1.3.1" && nextImmediate?.code === "1.1.3.2") r.sawMarker = true;
      if (s.code === "1.1.3.1" && s.stageLabel === 3 && nextImmediate?.code !== "1.1.3.2") r.raw31 = true;
      per.set(s.code, r);
      // CR-3 (review N2): items that left this code into a hold, with how long they had been in the code, so a healthy p50 cannot hide them.
      if (!forward && s.endMs != null && nextImmediate && ["STUCK", "MGR", "FINAL"].includes(nextImmediate.kind) && s.endMs >= c.start) { get(s.code).exitedToHold++; if (!s.synthetic) get(s.code).holdExitBd.push(spanBh(c, s) / 24); }
    }
    for (const [code0, r] of per) {
      if (r.open || r.lastEnd == null || !r.forward || r.bulk || !eligible) continue;
      // Completed label-3 time with no DME Benefits? marker is not separable: report it as 1.1.3.1+2 (§3.2.3).
      const code = code0 === "1.1.3.1" && r.raw31 && !r.sawMarker ? "1.1.3.1+2" : code0;
      const st = get(code);
      if (r.lastEnd >= c.start && r.lastEnd <= c.now) { st.completedBh.push(r.bh); st.exited++; }
      else if (r.lastEnd >= c.priorStart && r.lastEnd < c.start) st.priorCompletedBh.push(r.bh);
    }
  }
  for (const st of m.values()) {
    const n = c.cfg.health.minSample;
    const p50 = percentile(st.completedBh, 50, n); const p90 = percentile(st.completedBh, 90, n); const pp = percentile(st.priorCompletedBh, 50, n);
    st.p50Bd = p50 == null ? null : bd(p50); st.p90Bd = p90 == null ? null : bd(p90); st.priorP50Bd = pp == null ? null : bd(pp);
    const t = thresholdFor(c.cfg, st.code);
    st.proposed = !!t && !t.confirmed;
    st.status = codeHealth(c.cfg, t, st.p50Bd, st.completedBh.length, openAges.get(st.code) ?? []);
    // Unknown-age guard for queues too (prototype review R11).
    if (st.wip && st.unknownAge / st.wip > c.cfg.health.maxUnknownShare && st.status !== "breaking") { st.status = "risk"; st.reason = `age unknown for ${st.unknownAge} of ${st.wip}`; }
    // CR-5 (review N5): snooze cannot hide work forever; items snoozed beyond 2x red make the code At risk.
    if (st.snoozedLong > 0 && (st.status === "healthy" || st.status === "nodata")) { st.status = "risk"; st.reason = `${st.snoozedLong} snoozed beyond 2x red`; }
  }
  return m;
}

export interface HolderStat { kind: "STUCK" | "MGR" | "FINAL"; board: string; count: number; limbo: number; overYellow: number; limboRefs: ItemRef[]; bouncing: number; bouncingRefs: ItemRef[]; byOrigin: Record<string, number>; unknown: number; agesBd: number[]; oldestBd: number | null;
  loopAgeMaxBd: number | null; refs: ItemRef[]; status: Status; reason?: string; proposed: boolean; byGroup: number;
  priorCount: number; newThisPeriod: number; unknownRefs: ItemRef[]; maxPossibleBd: number | null }

/** Continuous escalation hold (E-02): start of the unbroken run of MGR/FINAL spans ending now (a move to Stuck resolves it).
 *  For a STUCK item it returns the dead-lead span start instead (shown without thresholds). */
export function continuousHold(c: Ctx, spans: HolderSpan[]): { startMs: number; synthetic: boolean } | null {
  const last = spans[spans.length - 1];
  if (!last || last.endMs != null || !["STUCK", "MGR", "FINAL"].includes(last.kind)) return null;
  if (last.kind === "STUCK") return { startMs: last.startMs, synthetic: last.synthetic };
  let i = spans.length - 1;
  while (i > 0 && ["MGR", "FINAL"].includes(spans[i - 1].kind)) i--;
  return { startMs: spans[i].startMs, synthetic: spans[i].synthetic };
}

export function holderStats(c: Ctx, loopAgeOf: (k: string) => { bh: number; synthetic: boolean } | null): HolderStat[] {
  const out = new Map<string, HolderStat>();
  for (const [k, s] of c.current) {
    const it = c.itemByKey.get(k);
    if (!it || !c.allowed(it) || !inPipelineGroup(c, it) || s.endMs != null) continue;
    if (s.kind !== "STUCK" && s.kind !== "MGR" && s.kind !== "FINAL") continue;
    const id = `${s.kind}:${s.boardKey}`;
    const t = (c.cfg.holderThresholds as Dict)[s.kind] ?? { confirmed: true };
    const st = out.get(id) ?? { kind: s.kind, board: s.boardKey, count: 0, unknown: 0, agesBd: [], oldestBd: null, loopAgeMaxBd: null, refs: [], status: "healthy" as Status, proposed: !t.confirmed, byGroup: 0, limbo: 0, overYellow: 0, limboRefs: [], bouncing: 0, bouncingRefs: [], byOrigin: {}, priorCount: 0, newThisPeriod: 0, unknownRefs: [], maxPossibleBd: null };
    st.count++; st.refs.push({ boardKey: s.boardKey, itemId: s.itemId }); if (s.byGroup) st.byGroup++;
    { const sp = c.spansByItem.get(k)!; const origin = [...sp].reverse().find((x) => x.kind === "QUEUE" && x.code)?.code ?? "unknown"; st.byOrigin[origin] = (st.byOrigin[origin] ?? 0) + 1; }
    const hold = continuousHold(c, c.spansByItem.get(k)!);
    const la = loopAgeOf(k);
    if (!hold || hold.synthetic) { st.unknown++; st.unknownRefs.push({ boardKey: s.boardKey, itemId: s.itemId }); st.maxPossibleBd = Math.max(st.maxPossibleBd ?? 0, c.bh(it.createdAtMs, c.now) / 24); }
    if (hold && !hold.synthetic && hold.startMs >= c.start) st.newThisPeriod++;
    if (hold && !hold.synthetic) { // known hold: record its age (bug fix: this was the else-branch of the line above)
      const age = bd(c.bh(hold.startMs, c.now));
      const eff = age; // D-35: limbo and status use the continuous escalation hold only; loop age is an annotation
      st.agesBd.push(eff); st.oldestBd = Math.max(st.oldestBd ?? 0, age);
      if (la && !la.synthetic && bd(la.bh) > (t.r ?? Infinity) && age <= (t.r ?? Infinity)) { st.bouncing++; st.bouncingRefs.push({ boardKey: s.boardKey, itemId: s.itemId }); }
      if (t.r != null && eff > t.r) { st.limbo++; st.limboRefs.push({ boardKey: s.boardKey, itemId: s.itemId }); }
      if (t.y != null && eff > t.y) st.overYellow++;
    }
    if (la && !la.synthetic) st.loopAgeMaxBd = Math.max(st.loopAgeMaxBd ?? 0, bd(la.bh));
    out.set(id, st);
  }
  // Prior-period comparison: how many items were in this holder state at the start of the period.
  for (const [k, spans] of c.spansByItem) {
    const it = c.itemByKey.get(k); if (!it || !c.allowed(it) || !inPipelineGroup(c, it)) continue;
    const at = spans.find((x) => x.startMs <= c.start && (x.endMs == null || x.endMs > c.start));
    if (!at || (at.kind !== "STUCK" && at.kind !== "MGR" && at.kind !== "FINAL")) continue;
    const id = `${at.kind}:${at.boardKey}`;
    const st = out.get(id); if (st) st.priorCount++;
  }
  for (const st of out.values()) {
    const t = (c.cfg.holderThresholds as Dict)[st.kind];
    if (st.kind === "STUCK") { st.status = "finding"; st.reason = "dead leads: an outcome, not an alarm"; continue; } // Brandon CR B
    const h = holderHealth(c.cfg, t, st.agesBd, st.unknown);
    st.status = h.status; st.reason = h.reason;
    if (st.loopAgeMaxBd != null && st.loopAgeMaxBd > 2 * t.r && (st.oldestBd ?? 0) <= 2 * t.r) st.reason = `${st.loopAgeMaxBd.toFixed(1)} bd in loop`;
  }
  return [...out.values()];
}
