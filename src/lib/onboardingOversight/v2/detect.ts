/**
 * Breakdown detection (Brandon, "make problems painfully obvious"). A GENERAL detector: every step, person and
 * escalation bucket is scored against one fixed library of failure patterns. Nothing here names a particular step,
 * person or day; all weights and thresholds live in DETECT. Severity = pattern weight x count x how far past normal
 * x step priority x trend.
 */
import type { V2Model, V2Row } from "./model";
import type { StepDef } from "./steps";
import { STAGES } from "./steps";

export type Pattern = "pileUp" | "neglect" | "notKeepingUp" | "brokenLoop" | "noOwner" | "fastSlipping" | "goneQuiet";
export interface Breaking { kind: "step" | "person" | "escalation"; where: string; label: string; owner: string; count: number; pctOfStep: number | null; pattern: Pattern; severity: number; keys: string[]; /** M in "N of M": the patients in that step, bucket or person */ of: number; /** the step's priority (Low sorts last) */ priority: "High" | "Normal" | "Low"; /** other patterns found on essentially the same patients (merged into this row) */ also?: Pattern[] }
/** Brandon's own words only (the detection logic keeps its internal names). Pile-up and fast-step slipping read as plain past due. */
export const PATTERN_LABEL: Record<Pattern, string> = {
  pileUp: "Past due", fastSlipping: "Past due", neglect: "Untouched", notKeepingUp: "Behind", brokenLoop: "Sent back - untouched", noOwner: "No owner", goneQuiet: "No activity logged",
};
export const PATTERN_HINT: Record<Pattern, string> = {
  pileUp: "Past due: longer than the step's normal time since it became workable",
  fastSlipping: "Past due: longer than the step's normal time since it became workable",
  neglect: "Untouched: past due with no logged action since it became workable (or since it was escalated)",
  notKeepingUp: "Behind: more patients coming into the step each day than are being done",
  brokenLoop: "Sent back - untouched: returned from escalation and not touched since",
  noOwner: "No owner: the step has no one assigned in Normal times",
  goneQuiet: "No activity logged: logged work dropped sharply in the last week while patients are still waiting",
};

export const DETECT = {
  weight: { pileUp: 1, neglect: 1.25, notKeepingUp: 1, brokenLoop: 1.3, noOwner: 1.1, fastSlipping: 1.2, goneQuiet: 1.2 } as Record<Pattern, number>,
  priority: { High: 1.5, Normal: 1, Low: 0.35 },
  pileUpMin: 5, neglectMin: 3, loopMin: 2, noOwnerMin: 1,
  fastNormalMax: 2, fastPctMin: 30, fastMin: 2,
  keepUpMarginPerDay: 1, keepUpDays: 5,
  quietDropRatio: 0.35, quietMinPriorPerDay: 2,
  overdueCap: 3, trendMin: 0.6, trendMax: 1.8,
  topN: 6,
  /** below this a finding is noise and is not shown ("nothing is breaking" when none clears it) */
  minSeverity: 10,
  /** one row per problem: a finding whose patients are (almost) all inside a more severe one, and at least this share of its size, merges into it */
  mergeShare: 0.9,
  /** Proposed Stuck is the most urgent thing on a manager's list (clear every day) */
  proposedStuckBoost: 1.5,
};

const unowned = (o: string | undefined) => !o || /^(unassigned|none|—|-)$/i.test(o.trim());

export function detect(m: Omit<V2Model, "breaking" | "buckets">, cfg = DETECT): Breaking[] {
  const out: Breaking[] = [];
  const stepById = new Map(m.steps.map((s) => [s.id, s]));
  const prio = (s?: StepDef) => cfg.priority[s?.priority ?? "Normal"];
  const subBars = new Map<string, number[]>(); for (const st of m.stages) { subBars.set(st.stage, st.bars); for (const sub of st.subs ?? []) if (sub.subStepId) subBars.set(sub.subStepId, sub.bars); }
  /** past-due trend: now vs a week ago, damped and capped */
  const trend = (id: string) => { const b = subBars.get(id); if (!b) return 1; const r = Math.sqrt((b[3] + 1) / (b[2] + 1)); return Math.min(cfg.trendMax, Math.max(cfg.trendMin, r)); };
  /** how far past normal, on average, for the late rows (1 = just past) */
  const overdue = (rs: V2Row[]) => { const late = rs.filter((r) => r.late); if (!late.length) return 1;
    const f = late.reduce((n, r) => { const norm = Math.max(1, r.normal ?? 1); const d = r.with !== "Processor" ? r.escDays ?? 0 : r.actionableDays ?? 0; return n + Math.max(0, d - norm) / norm; }, 0) / late.length;
    return 1 + Math.min(cfg.overdueCap, f); };
  const push = (b: Omit<Breaking, "severity" | "of" | "priority">, sev: number, p = 1) => { if (b.count > 0 && sev / p >= cfg.minSeverity) /* the floor ignores priority: Low ranks lower, it never hides a breakdown */ out.push({ ...b, of: 0, priority: "Normal", severity: Math.round(sev * 10) / 10 }); };
  const holders = (rs: V2Row[]) => [...new Set(rs.map((r) => (r.with === "Processor" ? r.owner : r.with)))].join(", ");

  // Steps (processor side)
  for (const st of m.steps) {
    if (st.stage === "ESC") continue;
    const all = m.rows.filter((r) => r.stepId === st.id); const proc = all.filter((r) => r.with === "Processor");
    const late = proc.filter((r) => r.late); const p = prio(st), t = trend(st.id), od = overdue(proc);
    const base = { kind: "step" as const, where: st.id, label: st.step, owner: st.owner };
    const pct = (n: number) => (all.length ? Math.round((n / all.length) * 100) : null);
    if (late.length >= cfg.pileUpMin) push({ ...base, count: late.length, pctOfStep: pct(late.length), pattern: "pileUp", keys: late.map((r) => r.key) }, cfg.weight.pileUp * late.length * od * p * t, p);
    const neg = late.filter((r) => r.untouched);
    if (neg.length >= cfg.neglectMin) push({ ...base, count: neg.length, pctOfStep: pct(neg.length), pattern: "neglect", keys: neg.map((r) => r.key) }, cfg.weight.neglect * neg.length * overdue(neg) * p * t, p);
    if (st.normal != null && st.normal <= cfg.fastNormalMax && proc.length && late.length >= cfg.fastMin && (late.length / proc.length) * 100 >= cfg.fastPctMin)
      push({ ...base, count: late.length, pctOfStep: pct(late.length), pattern: "fastSlipping", keys: late.map((r) => r.key) }, cfg.weight.fastSlipping * late.length * od * p * t * (1 + late.length / proc.length), p);
    const loop = proc.filter((r) => r.returned && (r.late || r.untouched));
    if (loop.length >= cfg.loopMin) push({ ...base, count: loop.length, pctOfStep: pct(loop.length), pattern: "brokenLoop", keys: loop.map((r) => r.key) }, cfg.weight.brokenLoop * loop.length * overdue(loop) * p * t, p);
    if (unowned(st.owner) && all.length >= cfg.noOwnerMin)
      push({ ...base, owner: holders(all) || "Unassigned", count: all.length, pctOfStep: 100, pattern: "noOwner", keys: all.map((r) => r.key) }, cfg.weight.noOwner * all.length * overdue(all) * p, p);
    const rate = m.stepRates[st.id];
    // arrivals outrunning completions only matter once the step is also slipping; on a long step it is otherwise work in flight
    if (rate && late.length > 0 && rate.actionable - rate.worked >= cfg.keepUpMarginPerDay) {
      const gap = Math.round((rate.actionable - rate.worked) * cfg.keepUpDays);
      push({ ...base, count: late.length, pctOfStep: pct(late.length), pattern: "notKeepingUp", keys: late.map((r) => r.key) }, cfg.weight.notKeepingUp * gap * p * t, p);
    }
    if (rate && proc.length && rate.worked20 >= cfg.quietMinPriorPerDay && rate.worked <= rate.worked20 * cfg.quietDropRatio)
      push({ ...base, count: proc.length, pctOfStep: pct(proc.length), pattern: "goneQuiet", keys: proc.map((r) => r.key) }, cfg.weight.goneQuiet * proc.length * (1 - rate.worked / rate.worked20) * p, p);
  }
  // People: logged activity dropping sharply while they still hold work
  for (const pe of m.people) {
    if (!pe.hasSteps || !pe.inSteps) continue;
    const prior = pe.weeks.slice(0, 3).reduce((n, w) => n + w.worked, 0) / 3, last = pe.weeks[3]?.worked ?? 0;
    if (prior >= cfg.quietMinPriorPerDay && last <= prior * cfg.quietDropRatio) {
      const rs = m.rows.filter((r) => r.with === "Processor" && r.owner === pe.name);
      push({ kind: "person", where: pe.name, label: pe.name, owner: pe.name, count: rs.length, pctOfStep: null, pattern: "goneQuiet", keys: rs.map((r) => r.key) }, cfg.weight.goneQuiet * rs.length * (1 - last / prior));
    }
  }
  // Escalation buckets: per owner, and per stage (patients held in escalation there)
  for (const e of m.escOwners) {
    const rs = m.rows.filter((r) => r.with === e.name); const late = rs.filter((r) => r.late); const neg = late.filter((r) => r.untouched);
    const base = { kind: "escalation" as const, where: e.name, label: `${e.name} · escalations`, owner: e.name };
    if (neg.length >= cfg.neglectMin) push({ ...base, count: neg.length, pctOfStep: rs.length ? Math.round((neg.length / rs.length) * 100) : null, pattern: "neglect", keys: neg.map((r) => r.key) }, cfg.weight.neglect * neg.length * overdue(neg));
    else if (late.length >= cfg.pileUpMin) push({ ...base, count: late.length, pctOfStep: rs.length ? Math.round((late.length / rs.length) * 100) : null, pattern: "pileUp", keys: late.map((r) => r.key) }, cfg.weight.pileUp * late.length * overdue(late));
    // Proposed Stuck must clear every day: any one past its 1-day normal is Neglect, touched or not (Brandon, CORE RULE).
    const stuck = late.filter((r) => r.escType === "proposedStuck");
    if (stuck.length) push({ ...base, label: `${e.name} · Proposed Stuck`, count: stuck.length, pctOfStep: rs.length ? Math.round((stuck.length / rs.length) * 100) : null, pattern: "neglect", keys: stuck.map((r) => r.key) }, cfg.weight.neglect * stuck.length * overdue(stuck) * cfg.proposedStuckBoost);
    const ret = m.sets[`returned:${e.name}`] ?? []; const loop = m.rows.filter((r) => ret.includes(r.key) && (r.untouched || r.late));
    if (loop.length >= cfg.loopMin) push({ ...base, label: `${e.name} · returned`, count: loop.length, pctOfStep: null, pattern: "brokenLoop", keys: loop.map((r) => r.key) }, cfg.weight.brokenLoop * loop.length * overdue(loop));
  }
  for (const st of STAGES) {
    const all = m.rows.filter((r) => r.stage === st.id); const late = all.filter((r) => r.late && r.with !== "Processor");
    if (late.length >= cfg.pileUpMin) push({ kind: "escalation", where: `${st.id}:esc`, label: `${st.name} · in escalation`, owner: holders(late), count: late.length, pctOfStep: all.length ? Math.round((late.length / all.length) * 100) : null, pattern: "pileUp", keys: late.map((r) => r.key) },
      cfg.weight.pileUp * late.length * overdue(late) * trend(st.id) * (late.length / Math.max(1, all.length) + 0.5));
  }
  // M for "N of M" and the priority, per place
  const ofPlace = (b: Breaking) => b.kind === "step" ? m.rows.filter((r) => r.stepId === b.where).length : b.kind === "person" ? m.rows.filter((r) => r.with === "Processor" && r.owner === b.where).length
    : b.where.endsWith(":esc") ? m.rows.filter((r) => r.stage === b.where.split(":")[0]).length : m.rows.filter((r) => r.with === b.where).length;
  for (const b of out) { b.count = b.keys.length || b.count; b.of = ofPlace(b); b.priority = b.kind === "step" ? stepById.get(b.where)?.priority ?? "Normal" : "Normal"; }
  // One row per place: its most severe pattern; then the overall ranking.
  const best = new Map<string, Breaking>();
  for (const b of out) { const k = `${b.kind}:${b.where}:${b.label}`; const cur = best.get(k); if (!cur || b.severity > cur.severity) best.set(k, b); }
  const ranked = [...best.values()].sort((a, b) => b.severity - a.severity);
  const kept: Breaking[] = [];
  for (const b of ranked) {
    const host = kept.find((k) => { const ks = new Set(k.keys); const inside = b.keys.filter((x) => ks.has(x)).length;
      return b.keys.length > 0 && inside / b.keys.length >= cfg.mergeShare && b.keys.length >= k.keys.length * cfg.mergeShare; });
    if (host) { if (host.pattern !== b.pattern && !(host.also ?? []).includes(b.pattern)) host.also = [...(host.also ?? []), b.pattern]; continue; }
    kept.push({ ...b });
  }
  // Brandon: sort by count, largest first; Low-priority steps always below Normal/High.
  const pr = { High: 0, Normal: 0, Low: 1 } as const;
  return kept.sort((a, b) => pr[a.priority] - pr[b.priority] || b.count - a.count || b.severity - a.severity);
}
