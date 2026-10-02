/**
 * The one table shape every summary uses (Brandon, VISUAL MINIMALISM RULES): stage rows bold with their subtotal,
 * sub-stages indented and lighter, collapsed until the stage is clicked, empty ones hidden; plain right-aligned
 * numbers; zeros as a faint dash; the only colour a thin left border for health.
 */
import { useState, type ReactNode } from "react";
import type { Health } from "@/lib/onboardingOversight/v2/steps";

export type Cell = { v: number | string | null; open?: () => void; /** a name, not a number: left-aligned */ name?: boolean; /** custom content (the 100% bar, "103 (27)") */ node?: ReactNode };
export type TreeRow = { id: string; name: string; cells: Cell[]; health: Health; subs?: TreeRow[]; onName?: () => void };

export const Num = ({ c }: { c: Cell }) => {
  if (c.node !== undefined) return <>{c.node}</>;
  if (c.v == null || c.v === 0 || c.v === "") return <span className="pn-zero">–</span>;
  return c.open ? <button type="button" className="pn" onClick={c.open}>{c.v}</button> : <span className="pn-text">{c.v}</span>;
};

export default function Tree({ first, cols, rows, expandable = true, nameCols = [] }: { first: string; cols: string[]; rows: TreeRow[]; expandable?: boolean; nameCols?: string[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return <table className="mt">
    <thead><tr><th>{first}</th>{cols.map((c) => <th key={c} className={nameCols.includes(c) ? "mt-who" : "mt-n"}>{c}</th>)}</tr></thead>
    <tbody>{rows.flatMap((r) => {
      // No duplicate labels: a single sub-stage named like its stage is not shown.
      const subs = (r.subs ?? []).filter((s) => s.cells.some((c) => c.node === undefined && c.v != null && c.v !== 0 && c.v !== ""));
      const kids = subs.length === 1 && subs[0].name === r.name ? [] : subs;
      const can = expandable && kids.length > 0; const isOpen = open.has(r.id);
      const out = [<tr key={r.id} className={`mt-stage ${r.health ? `h-${r.health}` : "h-none"}`}>
        <td className="mt-name">{can ? <button type="button" className="mt-toggle" aria-expanded={isOpen} onClick={() => toggle(r.id)}>{r.name}</button>
          : r.onName ? <button type="button" className="mt-toggle" onClick={r.onName}>{r.name}</button> : r.name}</td>
        {r.cells.map((c, i) => <td key={i} data-label={cols[i] || undefined} className={c.node !== undefined && c.name ? "mt-bar" : c.name ? "mt-who" : "mt-n"}><Num c={c} /></td>)}
      </tr>];
      if (can && isOpen) for (const s of kids) out.push(<tr key={`${r.id}/${s.id}`} className={`mt-sub ${s.health ? `h-${s.health}` : "h-none"}`}>
        <td className="mt-name">{s.onName ? <button type="button" className="mt-toggle" onClick={s.onName}>{s.name}</button> : s.name}</td>
        {s.cells.map((c, i) => <td key={i} data-label={cols[i] || undefined} className={c.node !== undefined && c.name ? "mt-bar" : c.name ? "mt-who" : "mt-n"}><Num c={c} /></td>)}
      </tr>);
      return out;
    })}</tbody>
  </table>;
}
