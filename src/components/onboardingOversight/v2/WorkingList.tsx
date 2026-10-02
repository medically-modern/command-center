/**
 * Personal working list (Brandon, CR-16 "Personal working lists"): a person's own queue, laid out so they know where
 * to start. Escalation owners (Janelle, Katie): Past Due untouched (oldest first), then Past Due being worked, then
 * Due Soon, then within the limit; optional grouping by sub-stage to batch similar decisions. Processors: their queue
 * in action-date order. A burn-down line says how many per day clear Past Due in 2 weeks and how many cleared today.
 * Read-only: a row opens the existing Command Center screen where the actions live.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import type { V2Model, V2Row, EscType } from "@/lib/onboardingOversight/v2/model";
import { STAGES, pipelineOrder, stageName } from "@/lib/onboardingOversight/v2/steps";
import { patientUrl } from "@/lib/onboardingOversight/v2/open";
import type { StaffCalls } from "@/lib/onboardingOversight/v2/calls";
import { callsPerDay } from "./Overview";
import { useEscReasons, WhyCell, type LoadReasons } from "./EscReason";

const fmt = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const dayWord = (n: number) => (n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);
/** The decision an escalation is waiting on, by sub-stage (defaults for Brandon to confirm). */
const DECISION: Record<string, string> = {
  "int.first": "Keep calling or Stuck", "int.calling": "Keep calling or Stuck", "int.sendoff": "Send on or Stuck",
  "mn.eval": "Qualifies or Stuck", "mn.send": "Resend or Stuck", "mn.confirm": "Keep chasing or Stuck",
  "mn.chase": "Keep chasing or Stuck", "mn.dr": "Wait or Stuck",
  "ins.benefits": "Proceed or Stuck", "ins.submit": "Submit or Stuck", "ins.outstanding": "Chase payer or Stuck",
  "ins.denied": "Appeal or Stuck", "ins.dvs": "Wait or Stuck", "wc.call": "Keep calling or Stuck", "fpc.cleanup": "Finish or Stuck",
};
type EscState = "pastUntouched" | "pastWorked" | "dueSoon" | "within";
const ESC_ORDER: EscState[] = ["pastUntouched", "pastWorked", "dueSoon", "within"];
const ESC_LABEL: Record<EscState, string> = { pastUntouched: "Past Due, untouched", pastWorked: "Past Due, being worked", dueSoon: "Due Soon", within: "Within 2 days" };
const escState = (r: V2Row): EscState => (r.late ? (r.untouched ? "pastUntouched" : "pastWorked") : r.dueSoon ? "dueSoon" : "within");
type ProcState = "past" | "dueSoon" | "notGotten" | "workable" | "notDue";
const PROC_ORDER: ProcState[] = ["past", "dueSoon", "notGotten", "workable", "notDue"];
const PROC_LABEL: Record<ProcState, string> = { past: "Past Due", dueSoon: "Due Soon", notGotten: "Not gotten to", workable: "Attempted", notDue: "Not due yet" };
const procState = (r: V2Row): ProcState => (r.late ? "past" : r.dueSoon ? "dueSoon" : r.actionableMs == null ? "notDue" : !r.touchedInStep || r.returned ? "notGotten" : "workable");
type Narrow = { g: "state" | "stage" | "sub"; v: string } | null;

export default function WorkingList({ m, name, onByStep, calls = null, grouped = false, loadReasons }: { m: V2Model; name: string; onByStep?: () => void; calls?: StaffCalls | null; grouped?: boolean; loadReasons?: LoadReasons }) {
  const navigate = useNavigate();
  const esc = m.escOwners.some((e) => e.name === name);
  const owners = { mgr: m.escOwners[0]?.name ?? "Janelle", final: m.escOwners[1]?.name ?? "Katie" };
  const all = useMemo(() => m.rows.filter((r) => (esc ? r.with === name : r.with === "Processor" && r.owner === name)), [m, name, esc]);
  const why = useEscReasons(esc ? all : [], loadReasons); // the reason each escalation was raised with (EscReason.tsx)
  const [q, setQ] = useState(""); const [narrow, setNarrow] = useState<Narrow>(null); const [bySub, setBySub] = useState(grouped);
  const state = (r: V2Row): string => (esc ? escState(r) : procState(r));
  const order: string[] = esc ? ESC_ORDER : PROC_ORDER;
  /** default: state order; escalations oldest in escalation first; processors in action-date order (workable longest first, then by Next Action Date) */
  const cmp = (a: V2Row, b: V2Row) => (bySub ? pipelineOrder(a.stage, a.stepId) - pipelineOrder(b.stage, b.stepId) : 0) || order.indexOf(state(a)) - order.indexOf(state(b))
    || (esc ? (b.escDays ?? 0) - (a.escDays ?? 0) : (a.actionableMs ?? Infinity) - (b.actionableMs ?? Infinity) || a.stepSinceMs - b.stepSinceMs);
  const isNotStarted = (r: V2Row) => r.actionableMs != null && (!r.touchedInStep || r.returned);
  const inState = (r: V2Row, v: string) => (v === "past" ? r.late : v === "pastUntouched" ? r.late && r.untouched : v === "notStarted" ? isNotStarted(r) : state(r) === v);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => (!narrow || (narrow.g === "state" ? inState(r, narrow.v) : narrow.g === "stage" ? r.stage === narrow.v : r.stepId === narrow.v))
      && (!needle || r.name.toLowerCase().includes(needle) || r.itemId.includes(needle) || (why.whyOf(r)?.text.toLowerCase().includes(needle) ?? false))).sort(cmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, narrow, bySub, why.reasons]);
  const past = all.filter((r) => r.late).length;
  const perDay = Math.ceil(past / 10); const cleared = (m.sets[`cleared:${name}`] ?? []).length;
  const count = (f: (r: V2Row) => string) => { const c = new Map<string, number>(); for (const r of all) c.set(f(r), (c.get(f(r)) ?? 0) + 1); return c; };
  const sg = count((r) => r.stage), ss = count((r) => r.stepId);
  // One line of three numbers (minimalism): each narrows the list; click again to reset. No count is repeated elsewhere.
  const head: [string, number, Narrow][] = esc
    ? [["In escalation", all.length, null], ["Past Due", past, { g: "state", v: "past" }], ["Untouched", all.filter((r) => r.late && r.untouched).length, { g: "state", v: "pastUntouched" }]]
    : [["Patients", all.length, null], ["Not Started", all.filter(isNotStarted).length, { g: "state", v: "notStarted" }], ["Past Due", past, { g: "state", v: "past" }]];
  const link = (g: "stage" | "sub", v: string, label: string, n: number) => { const on = narrow?.g === g && narrow.v === v; return (
    <button type="button" key={`${g}:${v}`} aria-pressed={on} className={`wl-link ${on ? "wl-link-on" : ""}`} onClick={() => setNarrow(on ? null : { g, v })}>{label} {n}</button>); };
  const calls1 = esc ? null : callsPerDay(calls, name, m.windowDays, m.people.map((p) => p.name), true);
  const showStage = sg.size > 1;
  let lastGroup = "";
  const clearedN = (m.sets[`cleared:${name}`] ?? []).length;
  // Two kinds of escalation (Brandon, CORE RULE): Proposed Stuck first ("clear today"), then Edge Cases, then Unclassified (never guessed).
  const sections: [EscType | null, ((l: V2Row[]) => string) | null][] = esc ? [
    ["proposedStuck", (l) => `Proposed Stuck · clear today · waiting ${l.length} · past due ${l.filter((r) => r.late).length || "–"} · cleared today ${clearedN || "–"}`],
    ["edgeCase", (l) => `Edge Cases · ${l.length} · past due ${l.filter((r) => r.late).length || "–"}`],
    ["unclassified", (l) => `Unclassified · ${l.length}`],
  ] : [[null, null]];
  return (
    <section className="tt wl oo-block" aria-label={`${name} working list`}>
      <div className="wl-head">
        <h2 className="tt-title">{name}</h2>
        <div className="wl-big">{head.map(([l, n, nv]) => { const on = !!nv && narrow?.g === nv.g && narrow.v === nv.v; return (
          <button type="button" key={l} className={`wl-big-n ${on ? "wl-link-on" : ""}`} aria-pressed={on} onClick={() => setNarrow(nv && !on ? nv : null)}><span className="wl-big-v">{n}</span> {l}</button>); })}</div>
        <span className="wl-burn" title="Past Due ÷ 10 business days; cleared = left this person's queue today">{perDay}/day to clear in 2 weeks · cleared today {cleared || "–"}{!esc && <> · calls/day {calls1 ?? "no call data"}</>}</span>
      </div>
      {showStage && <div className="tt-strip" role="group" aria-label="By stage">
        <div className="tt-strip-group">{STAGES.filter((x) => sg.get(x.id)).map((x) => link("stage", x.id, x.name, sg.get(x.id)!))}</div>
        {/* sub-stages only once a stage is picked (minimalism: no wall of numbers) */}
        {narrow && (narrow.g === "stage" || narrow.g === "sub") && <div className="tt-strip-group">{m.steps.filter((x) => ss.get(x.id) && x.stage === (narrow.g === "stage" ? narrow.v : m.steps.find((y) => y.id === narrow.v)?.stage)).map((x) => link("sub", x.id, x.step, ss.get(x.id)!))}</div>}
      </div>}
      <div className="wl-tools">
        <label className="tt-search"><Search size={16} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or ID" aria-label="Search name or ID" /></label>
        {narrow && <button type="button" className="wl-link" onClick={() => setNarrow(null)}>Show all {all.length}</button>}
        <button type="button" className={`wl-link ${bySub ? "wl-link-on" : ""}`} aria-pressed={bySub} onClick={() => setBySub(!bySub)}>Group by sub-stage</button>
        {onByStep && <button type="button" className="wl-link" onClick={onByStep}>By step</button>}
      </div>
      {sections.map(([t, head]) => { const list = t ? shown.filter((r) => r.escType === t) : shown; lastGroup = ""; if (t && !list.length) return null; return <div key={t ?? "all"} className="wl-section">
        {head && <h3 className="wl-sec-h">{head(list)}</h3>}
      <div className="tt-card"><table className="tt-table">
          <thead><tr>
            <th className="tt-th">Patient</th>{showStage && <th className="tt-th">Stage</th>}<th className="tt-th">Sub-stage</th>
            {esc ? <><th className="tt-th tt-th-n">Days</th><th className="tt-th tt-th-why">Why escalated</th><th className="tt-th">Before escalation</th><th className="tt-th">Decision</th></>
              : <><th className="tt-th">Workable since</th><th className="tt-th">Last action</th></>}
            <th className="tt-th">Attempts</th>
          </tr></thead>
          <tbody>{list.flatMap((r) => {
            const out: React.ReactNode[] = [];
            if (bySub && r.stepId !== lastGroup) { lastGroup = r.stepId; out.push(<tr key={`g:${r.stepId}`} className="wl-group"><td colSpan={8}>{r.step} {list.filter((x) => x.stepId === r.stepId).length}</td></tr>); }
            const url = patientUrl(r, owners);
            out.push(<tr key={r.key} className="tt-row" tabIndex={0} onClick={() => navigate(url)} onKeyDown={(e) => { if (e.key === "Enter") navigate(url); }}>
              <td className="tt-c-name"><span className="tt-name" title={`monday item ${r.itemId}`}>{r.name}</span></td>
              {showStage && <td className="tt-c-stage"><span className="tt-plain">{stageName(r.stage)}</span></td>}
              <td className="tt-c-sub"><span className="tt-subtext">{r.step}</span></td>
              {esc ? <>
                <td className="tt-c-time tt-n"><span className="tt-plain">{r.escDays ?? 0}</span></td>
                <td className="tt-c-why"><WhyCell row={r} state={why} /></td>
                <td className="tt-c-last"><span className="tt-last">{r.beforeEsc ?? <span className="tt-muted-inline">No action yet</span>}</span></td>
                <td className="tt-c-with"><span className="tt-plain">{DECISION[r.stepId] ?? "Return or Stuck"}</span></td>
              </> : <>
                <td className="tt-c-with"><span className="tt-plain">{r.actionableMs != null ? fmt(r.actionableMs) : "Not due yet"}</span></td>
                <td className="tt-c-last"><span className="tt-last">{r.last ? r.last.label : <span className="tt-muted-inline">No action yet</span>}</span>{r.last && <span className="tt-muted">{fmt(r.last.atMs)}</span>}</td>
              </>}
              <td className="tt-c-att"><span className="tt-plain">{r.attempts}</span></td>
            </tr>);
            return out;
          })}</tbody></table>
          {!list.length && <p className="tt-empty">No patients.</p>}
        </div>
        </div>; })}
    </section>
  );
}
