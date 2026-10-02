/** Normal time per step and owner (DESIGN INTENT v2): editable, opened by a toggle at the top of the overview. */
import { DEFAULT_STEPS, DEFAULT_DUE_SOON, DEFAULT_HEALTH, type HealthCfg, type DueSoonCfg, type StepDef, type Priority, stageName } from "@/lib/onboardingOversight/v2/steps";

export default function Settings({ steps, onChange, dueSoon = DEFAULT_DUE_SOON, onDueSoon, health = DEFAULT_HEALTH, onHealth }: { steps: StepDef[]; onChange: (s: StepDef[]) => void; dueSoon?: DueSoonCfg; onDueSoon?: (c: DueSoonCfg) => void; health?: HealthCfg; onHealth?: (c: HealthCfg) => void }) {
  const set = (id: string, patch: Partial<StepDef>) => onChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  return <div className="v2-card v2-settings oo-block">
    <p className="v2-note" title="Changes apply only on this browser.">Past Due = waiting longer than its normal time since workable (Next Action Date, or return from escalation).</p>
    <table className="v2-table">
      <thead><tr><th>Stage</th><th>Step</th><th>Normal time<span className="v2-th-sub">business days</span></th><th>Owner</th><th>Priority</th><th>Note</th></tr></thead>
      <tbody>{steps.map((s, i) => <tr key={s.id}>
        <td className="v2-stage-name">{i > 0 && steps[i - 1].stage === s.stage ? "" : s.stage === "ESC" ? "Escalation" : stageName(s.stage)}</td><td>{s.step}</td>
        <td>{s.id === "ins.dvs" ? <span className="v2-muted">none (never past due)</span>
          : <input type="number" min={0} className="v2-input v2-input-n" value={s.normal ?? ""} aria-label={`Normal days for ${s.step}`} onChange={(e) => set(s.id, { normal: e.target.value === "" ? (s.stage === "ESC" ? s.normal : null) : Math.max(s.stage === "ESC" ? 1 : 0, Math.round(Number(e.target.value))) })} />}</td>
        <td><input className="v2-input" value={s.owner} aria-label={`Owner of ${s.step}`} onChange={(e) => set(s.id, { owner: e.target.value })} /></td>
        <td>{s.stage === "ESC" ? null : <select className="v2-input v2-input-p" aria-label={`Priority of ${s.step}`} value={s.priority ?? "Normal"} onChange={(e) => set(s.id, { priority: e.target.value as Priority })}>{(["High", "Normal", "Low"] as Priority[]).map((p) => <option key={p}>{p}</option>)}</select>}</td>
        <td className="v2-muted">{s.note ?? ""}</td>
      </tr>)}</tbody>
    </table>
    {onDueSoon && <p className="v2-note v2-ds">Due Soon = the last <input type="number" min={1} max={100} className="v2-input v2-input-n" aria-label="Due Soon percent of normal time" value={dueSoon.pct} onChange={(e) => onDueSoon({ ...dueSoon, pct: Math.min(100, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />% of normal time (at least 1 day), for steps over <input type="number" min={0} className="v2-input v2-input-n" aria-label="Due Soon only for steps over this many days" value={dueSoon.overDays} onChange={(e) => onDueSoon({ ...dueSoon, overDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /> days. Shown in working lists and stage drill-ins.</p>}
    {onHealth && <p className="v2-note v2-ds">Health border (% past due): yellow from <input type="number" min={0} max={100} className="v2-input v2-input-n" aria-label="Yellow from percent" value={health.yellow} onChange={(e) => onHealth({ ...health, yellow: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />%, orange from <input type="number" min={0} max={100} className="v2-input v2-input-n" aria-label="Orange from percent" value={health.orange} onChange={(e) => onHealth({ ...health, orange: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />%, red over <input type="number" min={0} max={100} className="v2-input v2-input-n" aria-label="Red over percent" value={health.red} onChange={(e) => onHealth({ ...health, red: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />%.</p>}
    <button type="button" className="v2-reset" onClick={() => { onChange(DEFAULT_STEPS); onDueSoon?.(DEFAULT_DUE_SOON); onHealth?.(DEFAULT_HEALTH); }}>Reset to Brandon's values</button>
  </div>;
}
