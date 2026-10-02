/**
 * Level 1 (DESIGN INTENT v2, Brandon feedback round 1, VISUAL MINIMALISM RULES): four tiles, then By Stage and
 * By Employee. Plain numbers, one weight, a thin left border for health, nothing decorative. Every number opens
 * exactly its set.
 */
import type { V2Model, V2Row, Reason } from "@/lib/onboardingOversight/v2/model";
import { REASON_LABEL } from "@/lib/onboardingOversight/v2/model";
import type { StaffCalls } from "@/lib/onboardingOversight/v2/calls";
import { DEFAULT_HEALTH, healthOf, type HealthCfg } from "@/lib/onboardingOversight/v2/steps";
import Tree, { type TreeRow } from "./Tree";

type Open = (listId: string) => void;
/** Share of a base, whole percent. */
export const pct = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 100) : 0);

/**
 * The one coloured element allowed besides the health border (Brandon, 100% bar exception): the whole bar is the
 * row's patients; processor Past Due in three blues, escalation Past Due in two oranges, everything else light grey.
 */
const PROC: Reason[] = ["notStarted", "attempted", "returnedUntouched"], ESC: Reason[] = ["escUntouched", "escWorking"];
function Bar({ total, counts, open, label, esc = false }: { total: number; counts: Partial<Record<Reason, number>>; open: (r: Reason) => void; label: string; esc?: boolean }) {
  if (!total) return null;
  const segs = [...PROC, ...ESC].filter((r) => counts[r]);
  const rest = total - segs.reduce((n, r) => n + (counts[r] ?? 0), 0);
  return <span className="sb-wrap"><span className="sb" role="img" aria-label={label}>
    {segs.map((r) => <button type="button" key={r} className={`sb-seg v2-seg-${r}`} style={{ width: `${(counts[r]! / total) * 100}%` }}
      title={`${REASON_LABEL[r]}: ${counts[r]} (${pct(counts[r]!, total)}%)`} aria-label={`${REASON_LABEL[r]}: ${counts[r]}`} onClick={() => open(r)} />)}
    {rest > 0 && <span className="sb-seg sb-rest" style={{ width: `${(rest / total) * 100}%` }} title={`${esc ? "Within limit" : "Other (not past due)"}: ${rest} (${pct(rest, total)}%)`} />}
  </span><span className="sb-label">{label}</span></span>;
}
/** One compact legend line under every table with the bar (Brandon). */
const WITHIN_HINT = "Within limit: in escalation but not yet past its normal time (1 business day for Proposed Stuck, the Edge Case normal for edge cases, 2 days otherwise)";
const OTHER_HINT = "Other: not past due. Within normal time, escalated but within its limit, or waiting on a future Next Action Date";
export function BarLegend({ only = "all" }: { only?: "all" | "proc" | "esc" }) {
  return <div className="sb-legend">
    {only !== "esc" && <><span className="sb-lg-group">Processor:</span>{(["notStarted", "attempted", "returnedUntouched"] as Reason[]).map((r, i) => <span key={r}><i className={`sb-sw v2-seg-${r}`} />{["Not started", "Attempted", "Returned"][i]}</span>)}</>}
    {only !== "proc" && <><span className="sb-lg-group">Escalation:</span>{(["escUntouched", "escWorking"] as Reason[]).map((r, i) => <span key={r}><i className={`sb-sw v2-seg-${r}`} />{["Untouched", "Being worked"][i]}</span>)}</>}
    {only === "esc" ? <span title={WITHIN_HINT}><i className="sb-sw sb-rest" />Within limit</span>
      : <><span className="sb-lg-group">On Track:</span><span title={OTHER_HINT}><i className="sb-sw sb-rest" />Other</span></>}
  </div>;
}
const reasonCounts = (rs: V2Row[]) => rs.reduce((m, r) => { if (r.late && r.reason) m[r.reason] = (m[r.reason] ?? 0) + 1; return m; }, {} as Partial<Record<Reason, number>>);

export function Tiles({ m, open, hc = DEFAULT_HEALTH }: { m: V2Model; open: Open; hc?: HealthCfg }) {
  const t = m.tiles; // no period-over-period comparisons anywhere (Brandon, "Main page % and trends")
  const tile = (label: string, v: number, id: string, sub: string | null, h: string | null, hint?: string) => (
    <button type="button" className={`v2-tile ${h ? `h-${h}` : "h-none"}`} title={hint} onClick={() => open(id)}><span className="v2-tile-label">{label}</span>
      <span className="v2-tile-n">{v}</span>{sub && <span className="v2-tile-sub">{sub}</span>}</button>);
  const share = (n: number) => `${pct(n, t.inPipeline)}% of pipeline`;
  const onTrack = t.inPipeline - t.processorPastDue - t.escalationsPastDue; // On Track + Processor Past Due + Escalations Past Due = In Pipeline
  return <div className="v2-tiles oo-block">
    {tile("In Pipeline", t.inPipeline, "tile:pipeline", null, null)}
    {tile("On Track", onTrack, "tile:onTrack", share(onTrack), null, "Everything not past due: within normal time, escalated under 2 days, or waiting on a future Next Action Date")}
    {tile("Processor Past Due", t.processorPastDue, "tile:procPastDue", share(t.processorPastDue), healthOf(t.processorPastDue, t.inPipeline, hc))}
    {tile("Escalations Past Due", t.escalationsPastDue, "tile:escPastDue", share(t.escalationsPastDue), healthOf(t.escalationsPastDue, t.inPipeline, hc))}
    {tile("Onboarding Complete", t.complete, "tile:complete", "last 28 days", null)}
  </div>;
}

export function ByStage({ m, open, hc = DEFAULT_HEALTH }: { m: V2Model; open: Open; hc?: HealthCfg; stage?: string | null; openStage?: (id: string) => void; back?: () => void }) {
  const row = (s: V2Model["stages"][number]): TreeRow => { const sid = s.subStepId ?? s.stage; return {
    id: sid, name: s.name, health: healthOf(s.late, s.inStage, hc),
    cells: [
      { v: s.inStage, open: () => open(`stage:${sid}:in`) },
      { v: s.late - s.lateEsc, open: () => open(`stage:${sid}:lateProc`) },
      { v: s.lateEsc, open: () => open(`stage:${sid}:lateEsc`) },
      { v: s.late, name: true, node: <Bar total={s.inStage} counts={s.reasons} open={(r) => open(`stage:${sid}:reason:${r}`)} label={`${pct(s.late - s.lateEsc, s.inStage)}% processor · ${pct(s.lateEsc, s.inStage)}% escalation`} /> },
    ],
    subs: s.subs?.map(row) }; };
  return <div className="v2-card mt-card oo-block"><Tree first="Stage" cols={["In Stage", "Processor Past Due", "Escalation Past Due", "Past Due"]} nameCols={["Past Due"]} rows={m.stages.map(row)} /><BarLegend /></div>;
}

/** Calls per day over the same window as worked per day: the last 5 completed business days (model.windowDays). */
export function callsPerDay(calls: StaffCalls | null, name: string, days: string[], others: string[] = [], hasSteps = true): number | null {
  if (!calls || calls.status !== "ok") return null;
  // The archive has answered inbound calls only: a number for someone who mostly dials out would read as low work, so only people without processor steps get one (red-team r16 #10).
  if (calls.source === "archive" && hasSteps) return null;
  // Calls are matched by first name; two people with the same first name show "—" rather than a shared count.
  const f = name.trim().split(/\s+/)[0]?.toLowerCase(); if (others.some((o) => o !== name && o.trim().split(/\s+/)[0]?.toLowerCase() === f)) return null;
  if (calls.ambiguous?.includes(f ?? "")) return null;
  // No entry at all in the call log: unknown, not zero (red-team r17 N1).
  const m = calls.perDay[f ?? ""]; if (!m) return null; const ds = days.slice(0, 5);
  return ds.length ? Math.round(ds.reduce((n, d) => n + (m?.[d] ?? 0), 0) / ds.length) : null;
}

/**
 * By Employee answers four questions per processor: how much they have, how much they haven't gotten to, how much is
 * past due, and whether they are keeping up. A name opens their working list; the per-step split is one more click.
 */
export function ByEmployee({ m, open, person, openPerson, back, hc = DEFAULT_HEALTH }: { m: V2Model; open: Open; calls?: StaffCalls | null; person?: string | null; openPerson?: (name: string) => void; back?: () => void; hc?: HealthCfg }) {
  const parent = person ? m.people.find((p) => p.name === person) : null;
  if (parent) {
    const rows: TreeRow[] = parent.bySteps.filter((p) => p.inSteps > 0 || (p.workedPerDay ?? 0) > 0 || (p.actionablePerDay ?? 0) > 0).map((p) => {
      const cell = (col: string) => () => open(`person:${parent.name}:${col}:${p.stepId}`);
      return { id: p.stepId!, name: p.name, health: healthOf(p.pastDue, p.inSteps, hc), cells: [
        { v: p.inSteps, open: cell("inSteps") }, { v: p.notStarted, open: cell("notStarted") }, { v: p.attempted, open: cell("attempted") },
        { v: p.returnedUntouched, open: cell("returnedUntouched") }, { v: p.pastDue, open: cell("pastDue") },
        { v: Math.round(p.workedPerDay ?? 0), open: cell("worked") }, { v: Math.round(p.actionablePerDay ?? 0), open: cell("became") },
      ] }; });
    return <>
      <h2 className="oo-title oo-block">{parent.name} · by step</h2>
      <div className="v2-card mt-card oo-block"><Tree first="Step" cols={["Patients", "Not Started", "Attempted", "Returned", "Past Due", "Worked/day", "New/day"]} rows={rows} expandable={false} /></div>
    </>;
  }
  // Anyone holding patients, plus anyone who worked steps they do not own (Josh, 2026-10-02: credit by person), incl. "Not named".
  const people: TreeRow[] = m.people.filter((p) => p.hasSteps && (p.inSteps > 0 || (p.workedPerDay ?? 0) > 0)).map((p) => {
    const cell = (col: string) => () => open(`person:${p.name}:${col}`);
    return { id: p.name, name: p.name, health: healthOf(p.pastDue, p.inSteps, hc), onName: openPerson ? () => openPerson(p.name) : undefined, cells: [
      { v: p.inSteps, open: cell("inSteps") }, { v: p.notGottenTo, open: cell("notGottenTo") }, { v: p.pastDue, open: cell("pastDue") },
      { v: Math.round(p.workedPerDay ?? 0), open: cell("worked") }, { v: Math.round(p.actionablePerDay ?? 0), open: cell("became") },
      { v: p.pastDue, name: true, node: <Bar total={p.inSteps} counts={reasonCounts(m.rows.filter((r) => r.with === "Processor" && r.owner === p.name))} open={() => open(`person:${p.name}:pastDue`)} label={`${pct(p.pastDue, p.inSteps)}%`} /> },
    ] }; });
  // Escalation rows are owner x kind (Brandon's two kinds), plus one "Sent back" row per owner that has any (H2).
  const KINDS = [["proposedStuck", "Proposed Stuck"], ["edgeCase", "Edge Case"], ["unclassified", "Unclassified"]] as const;
  const esc: TreeRow[] = m.escOwners.flatMap((e) => [...KINDS.filter(([k]) => e.byType[k].n > 0).map(([k, label]): TreeRow => { const t = e.byType[k]; const rs = m.rows.filter((r) => r.with === e.name && r.escType === k); return {
    id: `${e.name}:${k}`, name: `${e.name} · ${label}`, health: healthOf(t.past, t.n, hc), onName: openPerson ? () => openPerson(e.name) : undefined, cells: [
      { v: t.n, open: () => open(`esc:${e.name}:inEsc:${k}`) }, { v: t.past, open: () => open(`esc:${e.name}:past2:${k}`) },
      { v: t.untouched, open: () => open(`esc:${e.name}:past2Untouched:${k}`) }, { v: t.worked, open: () => open(`esc:${e.name}:past2Working:${k}`) },
      { v: t.past, name: true, node: <Bar esc total={t.n} counts={reasonCounts(rs)} open={(r) => open(`esc:${e.name}:${r === "escUntouched" ? "past2Untouched" : "past2Working"}:${k}`)} label={`${pct(t.past, t.n)}%`} /> },
    ] }; }),
    ...(e.returned28 ? [{ id: `${e.name}:sent`, name: `${e.name} · Sent back (28 days)`, health: null, cells: [{ v: e.returned28, open: () => open(`esc:${e.name}:returned`) }, { v: null }, { v: null }, { v: null }, { v: null, name: true, node: null }] } as TreeRow] : [])]);

  return <>
    <div className="v2-card mt-card oo-block"><Tree first="Processor" cols={["Patients", "Not Started", "Past Due", "Worked/day", "New/day", "Past Due share"]} nameCols={["Past Due share"]} rows={people} expandable={false} /><BarLegend only="proc" /></div>
    <div className="v2-card mt-card oo-block"><Tree first="Escalation" cols={["Patients", "Past Due", "Untouched", "Worked", "Past Due share"]} nameCols={["Past Due share"]} rows={esc} expandable={false} /><BarLegend only="esc" /></div>
  </>;
}
