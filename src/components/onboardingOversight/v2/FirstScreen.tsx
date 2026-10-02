/**
 * Overview v3 (Brandon: "answers, not a matrix"): under the tiles and the flow strip, two ranked short lists. One
 * top-to-bottom read; no adding up, no scanning across columns. Every row opens its patients.
 */
import { useState } from "react";
import type { V2Model } from "@/lib/onboardingOversight/v2/model";
import { pastDueShares, type Box } from "@/lib/onboardingOversight/v2/shares";

type Open = (listId: string) => void;

/**
 * The overview's two ranked lists (Brandon): Escalations Past Due by owner x kind, Processor Past Due by owner x step.
 * Header: "<title>: N (x%)". Rows: Owner | Where | Past Due | %, every % a share of ALL past due (both boxes sum to
 * 100%; rows sum to their header). Sorted purely by Past Due, largest first; top 6, then "+ N more". Rows open patients.
 */
function RankedBox({ title, box, open }: { title: string; box: Box; open: Open }) {
  const [more, setMore] = useState(false);
  const shown = more ? box.rows : box.rows.slice(0, 6);
  return <div className="v2-card fs-card">
    <h3 className="fs-h fs-total">{title}: <span className="fs-total-n">{box.n}</span> <span className="fs-total-p">({box.pct}%)</span></h3>
    {!box.rows.length ? <p className="fs-none">None past due.</p> : <table className="mt fs-table">
      <thead><tr><th>Owner</th><th>Where</th><th className="mt-n">Past Due</th><th className="mt-n" title="Share of all past due (both boxes)">%</th></tr></thead>
      <tbody>{shown.map(({ b, i, pct }) => <tr key={`${b.owner}|${b.where}`} className="fs-row" tabIndex={0} onClick={() => open(`bkt:${i}:past`)} onKeyDown={(e) => { if (e.key === "Enter") open(`bkt:${i}:past`); }}>
        <td>{b.owner}</td><td>{b.label}</td><td className="mt-n">{b.pastDue}</td><td className="mt-n">{pct}%</td></tr>)}</tbody>
    </table>}
    {box.rows.length > 6 && <button type="button" className="fs-more" onClick={() => setMore(!more)}>{more ? "Show fewer" : `+ ${box.rows.length - 6} more`}</button>}
  </div>;
}

export function Ranked({ m, open }: { m: V2Model; open: Open }) {
  const sh = pastDueShares(m.buckets); // buckets are already sorted: Past Due, Low priority last
  return <div className="oo-block fs-two">
    <RankedBox title="Escalations Past Due" box={sh.esc} open={open} />
    <RankedBox title="Processor Past Due" box={sh.proc} open={open} />
  </div>;
}
