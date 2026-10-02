/**
 * Flow (Brandon, "are we keeping up?"): in vs out over the SAME window, 7 or 28 days. Not a comparison to a prior
 * period. New referrals in | Completed (out) | Moved to Stuck (out) | Net change (growing red, shrinking green).
 */
import type { V2Model } from "@/lib/onboardingOversight/v2/model";
import { STAGES } from "@/lib/onboardingOversight/v2/steps";
import Tree from "./Tree";

export function FlowStrip({ m, w, setW, open, openStuck }: { m: V2Model; w: 7 | 28; setW: (w: 7 | 28) => void; open: (id: string) => void; openStuck: () => void }) {
  const f = m.flow[w]; const stuck = Object.values(f.stuck).reduce((n, x) => n + x.length, 0);
  const cell = (label: string, v: number, onClick: () => void, hint: string) => (
    <button type="button" className="fl-cell" title={hint} onClick={onClick}><span className="fl-label">{label}</span><span className="fl-n">{v}</span></button>);
  return <div className="v2-card oo-block fl">
    <div className="fl-win" role="group" aria-label="Window">{([7, 28] as const).map((d) => <button type="button" key={d} aria-pressed={w === d} className={`wl-link ${w === d ? "wl-link-on" : ""}`} onClick={() => setW(d)}>{d} days</button>)}</div>
    {cell("New referrals in", f.inRows.length, () => open(`flow:${w}:in`), "Patients created on the Intake board in the window (bulk imports and duplicates excluded)")}
    {cell("Completed (out)", f.completedKeys.length, () => open(`flow:${w}:completed`), "Welcome Call moved to Completed: released to the subscription board")}
    {cell("Moved to Stuck (out)", stuck, openStuck, "Moved to Stuck (dead lead) by the Stuck label or the Stuck group, on the stage where it happened")}
    <div className="fl-cell fl-net" title={`${f.inRows.length} in minus ${f.out} out`}><span className="fl-label">Net change</span>
      <span className={`fl-n ${f.net > 0 ? "fl-grow" : f.net < 0 ? "fl-shrink" : ""}`}>{f.net > 0 ? `+${f.net}` : f.net}</span>
      <span className={`fl-sub ${f.net > 0 ? "fl-grow" : f.net < 0 ? "fl-shrink" : ""}`}>{f.net > 0 ? "growing" : f.net < 0 ? "shrinking" : "steady"}</span></div>
  </div>;
}

/** Moved to Stuck, by the stage where the patient died; each number opens the list. */
export function StuckBreakdown({ m, w, open }: { m: V2Model; w: 7 | 28; open: (id: string) => void }) {
  const f = m.flow[w]; const total = Object.values(f.stuck).reduce((n, x) => n + x.length, 0);
  return <div className="v2-card mt-card oo-block">
    <h2 className="bk-title">Moved to Stuck · last {w} days · {total}</h2>
    <Tree first="Stage" cols={["Moved to Stuck"]} expandable={false} rows={STAGES.map((s) => ({ id: s.id, name: s.name, health: null, cells: [{ v: f.stuck[s.id].length, open: () => open(`flow:${w}:stuck:${s.id}`) }] }))} />
  </div>;
}
