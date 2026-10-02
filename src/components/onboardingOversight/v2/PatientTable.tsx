/**
 * Level 2 (DESIGN INTENT v2): the patient list, styled after the Tandem tracker table. One title naming the set,
 * a search box, sortable headers, nothing else. A row opens the existing Command Center patient profile.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import type { V2Row } from "@/lib/onboardingOversight/v2/model";
import { STAGES, pipelineOrder, stageName } from "@/lib/onboardingOversight/v2/steps";
import { patientUrl } from "@/lib/onboardingOversight/v2/open";
import { SOURCE_LABEL } from "@/lib/onboardingOversight/v2/escReason";
import { REASON_ORDER, useEscReasons, WhyCell, type LoadReasons } from "./EscReason";

const fmt = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const dayWord = (n: number) => (n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);
/** Team words for a few logged actions whose short labels read oddly in a list (product-owner v2 pass 1). */
/** Plain words, no symbols (Brandon feedback round 1: no decorative icons). */
const lastWords = (l: string) => l.replace(/^[^\p{L}\p{N}]+/u, "").replace(/^Method: (.*)$/, "Chase method: $1");
type Key = "name" | "stage" | "time" | "with" | "why" | "last" | "attempts";

export default function PatientTable({ title, rows, hideUntouched = false, escOwners = { mgr: "Janelle", final: "Katie" }, loadReasons }: { title: string; rows: V2Row[]; hideUntouched?: boolean; escOwners?: { mgr: string; final: string }; loadReasons?: LoadReasons }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  // Why escalated (Josh, 2026-10-02): read live for this list's escalated rows only (EscReason.tsx).
  const why = useEscReasons(rows, loadReasons); const { whyOf, bySource } = why;
  const showWhy = why.escRows.length > 0;
  // Summary on top (Brandon, 2026-10-02): counts by stage then sub-stage (pipeline order); click narrows, click again or "Show all" resets.
  const [narrow, setNarrow] = useState<{ g: "stage" | "sub" | "why"; v: string } | null>(null);
  const byStage = STAGES.map((s0) => ({ id: s0.id, name: s0.name, n: rows.filter((r) => r.stage === s0.id).length })).filter((x) => x.n);
  const pickedStage = narrow && narrow.g !== "why" ? (narrow.g === "stage" ? narrow.v : rows.find((r) => r.stepId === narrow.v)?.stage) : null;
  const subs = pickedStage ? [...new Map(rows.filter((r) => r.stage === pickedStage).sort((a, b) => pipelineOrder(a.stage, a.stepId) - pipelineOrder(b.stage, b.stepId)).map((r) => [r.stepId, r.step])).entries()]
    .map(([id, name]) => ({ id, name, n: rows.filter((r) => r.stepId === id).length })) : [];
  const link = (g: "stage" | "sub" | "why", v: string, label: string, n: number) => { const on = narrow?.g === g && narrow.v === v; return (
    <button type="button" key={`${g}:${v}`} aria-pressed={on} className={`wl-link ${on ? "wl-link-on" : ""}`} onClick={() => setNarrow(on ? (g === "sub" ? { g: "stage", v: pickedStage! } : null) : { g, v })}>{label} {n}</button>); };
  // Default (Brandon, CR-16): Stage in pipeline order → sub-stage in workflow order → longest time in stage first. A list remounts per set, so the default returns on reopen.
  const [sort, setSort] = useState<{ k: Key; desc: boolean }>({ k: "stage", desc: false });
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inNarrow = (r: V2Row) => !narrow || (narrow.g === "stage" ? r.stage === narrow.v : narrow.g === "why" ? r.escType != null && (whyOf(r)?.source ?? "none") === narrow.v : r.stepId === narrow.v);
    const list = rows.filter((r) => inNarrow(r) && (!needle || r.name.toLowerCase().includes(needle) || r.itemId.includes(needle) || (whyOf(r)?.text.toLowerCase().includes(needle) ?? false)));
    const val = (r: V2Row): string | number => sort.k === "name" ? r.name : sort.k === "stage" ? pipelineOrder(r.stage, r.stepId) : sort.k === "time" ? r.inStageDays
      : sort.k === "with" ? (r.with === "Processor" ? -1 : r.escDays ?? 0)
      : sort.k === "why" ? (r.escType == null ? "~" : `${REASON_ORDER.indexOf(whyOf(r)?.source ?? "none")}${(whyOf(r)?.text ?? "").toLowerCase()}`) : sort.k === "last" ? r.last?.atMs ?? 0 : r.attempts;
    return list.sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return (sort.desc ? -c : c) || (sort.k === "stage" ? b.inStageDays - a.inStageDays : 0); });
  }, [rows, q, sort, narrow, why.reasons]); // eslint-disable-line react-hooks/exhaustive-deps -- whyOf reads why.reasons
  // No duplicate labels (minimalism): a column whose value is the same on every row of this set is not shown.
  const showStage = new Set(rows.map((r) => r.stage)).size > 1;
  const showWith = rows.some((r) => r.with !== "Processor" || r.returnedDays != null);
  const showSub = new Set(rows.map((r) => r.stepId)).size > 1;
  const th = (k: Key, label: string) => (
    <th className="tt-th"><button type="button" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k === "time" || k === "last" }))}>{label} {sort.k === k ? <span aria-hidden>{sort.desc ? "↓" : "↑"}</span> : null}</button></th>);
  return (
    <section className="tt oo-block" aria-label={title}>
      <h2 className="tt-title">{title}</h2>
      {(byStage.length > 1 || subs.length > 1 || bySource.length > 0 || (byStage.length === 1 && new Set(rows.map((r) => r.stepId)).size > 1)) && <div className="tt-strip" role="group" aria-label="Summary">
        {byStage.length > 1 || subs.length > 1 || new Set(rows.map((r) => r.stepId)).size > 1 ? <div className="tt-strip-group">{byStage.map((x) => link("stage", x.id, x.name, x.n))}</div> : null}
        {subs.length > 1 && <div className="tt-strip-group">{subs.map((x) => link("sub", x.id, x.name, x.n))}</div>}
        {bySource.length > 0 && <div className="tt-strip-group" aria-label="Why escalated"><span className="tt-strip-label">Why escalated</span>{bySource.map((x) => link("why", x.src, SOURCE_LABEL[x.src], x.n))}</div>}
        {narrow && <button type="button" className="tt-reset" onClick={() => setNarrow(null)}>Show all {rows.length}</button>}
      </div>}
      <label className="tt-search"><Search size={16} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or ID" aria-label="Search name or ID" /></label>
      <div className="tt-card"><table className="tt-table">
        <thead><tr>{th("name", "Patient")}{showStage && th("stage", "Stage")}{showSub && <th className="tt-th"><span className="tt-th-plain">Sub-stage</span></th>}{th("time", "Time in stage")}{showWith && th("with", "With")}{showWhy && th("why", "Why escalated")}{th("last", "Last action")}{th("attempts", "Attempts")}</tr></thead>
        <tbody>{shown.map((r) => {
          return (
            <tr key={r.key} className="tt-row" tabIndex={0}
              onClick={() => navigate(patientUrl(r, escOwners))} onKeyDown={(e) => { if (e.key === "Enter") navigate(patientUrl(r, escOwners)); }}>
              <td className="tt-c-name"><span className="tt-name" title={`monday item ${r.itemId}`}>{r.name}</span></td>
              {showStage && <td className="tt-c-stage"><span className="tt-plain">{stageName(r.stage)}</span></td>}
              {showSub && <td className="tt-c-sub"><span className="tt-subtext">{r.step}</span></td>}
              <td className="tt-c-time"><span className="tt-strong">{dayWord(r.inStageDays)}</span><span className="tt-muted">since {fmt(r.stepSinceMs)}</span></td>
              {showWith && <td className="tt-c-with">{r.with === "Processor" ? <><span className="tt-strong tt-plain">Processor</span>{r.returnedDays != null && <span className="tt-muted">returned {r.returnedDays === 0 ? "today" : `${dayWord(r.returnedDays)} ago`}</span>}</>
                : <><span className="tt-strong tt-plain">Escalation · {r.with}</span><span className="tt-muted">{dayWord(r.escDays ?? 0)} in escalation</span></>}</td>}
              {showWhy && <td className="tt-c-why"><WhyCell row={r} state={why} /></td>}
              <td className="tt-c-last"><span className="tt-last">{r.last ? lastWords(r.last.label) : <span className="tt-muted-inline">No action yet</span>}</span>{r.last && <span className="tt-muted">{fmt(r.last.atMs)}{r.last.by ? ` · ${r.last.by}` : ""}</span>}</td>
              <td className="tt-c-att"><span className="tt-plain">{r.attempts}</span></td>
            </tr>);
        })}</tbody></table>
        {!shown.length && <p className="tt-empty">No patients.</p>}
      </div>
    </section>
  );
}

