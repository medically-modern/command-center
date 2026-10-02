/**
 * Drill-in = breakdown first, list second (Brandon, CR-16), in the minimal table shape (VISUAL MINIMALISM RULES):
 * stages bold with subtotals, sub-stages collapsed until clicked, plain numbers, health as a thin left border
 * (% past due of that row's In Stage), Owner as a name only. Every number opens the patient list for that cell.
 */
import type { V2Model, V2Row } from "@/lib/onboardingOversight/v2/model";
import { STAGES, DEFAULT_HEALTH, healthOf, type HealthCfg } from "@/lib/onboardingOversight/v2/steps";
import Tree, { type TreeRow } from "./Tree";

export type BreakdownKind = "procPastDue" | "escPastDue" | "pipeline";
type Col = { key: string; label: string; f: (r: V2Row) => boolean };
const SET: Record<BreakdownKind, { set: "proc" | "esc" | "all"; title: string; base: (r: V2Row) => boolean; cols: Col[] }> = {
  procPastDue: { set: "proc", title: "Processor Past Due", base: (r) => r.with === "Processor" && r.late, cols: [
    { key: "late", label: "Past Due", f: () => true }, { key: "notStarted", label: "Not Started", f: (r) => r.reason === "notStarted" },
    { key: "attempted", label: "Attempted", f: (r) => r.reason === "attempted" }, { key: "returnedUntouched", label: "Returned", f: (r) => r.reason === "returnedUntouched" },
  ] },
  escPastDue: { set: "esc", title: "Escalations Past Due", base: (r) => r.with !== "Processor" && r.late, cols: [
    { key: "late", label: "Past Due", f: () => true }, { key: "escUntouched", label: "Untouched", f: (r) => r.reason === "escUntouched" },
    { key: "escWorking", label: "Worked", f: (r) => r.reason === "escWorking" },
  ] },
  pipeline: { set: "all", title: "In Pipeline", base: () => true, cols: [
    { key: "all", label: "Patients", f: () => true }, { key: "pastAll", label: "Past Due", f: (r) => r.late }, { key: "esc", label: "Escalated", f: (r) => r.with !== "Processor" },
  ] },
};
const holder = (r: V2Row) => (r.with === "Processor" ? r.owner : r.with);

export default function Breakdown({ m, kind, open, hc = DEFAULT_HEALTH }: { m: V2Model; kind: BreakdownKind; open: (listId: string) => void; hc?: HealthCfg }) {
  const cfg = SET[kind]; const rows = m.rows.filter(cfg.base);
  const line = (id: string, name: string, rs: V2Row[], all: V2Row[]): TreeRow => {
    const owners = [...new Set(rs.map(holder))];
    return { id, name, health: healthOf(cfg.set === "all" ? all.filter((r) => r.late).length : rs.length, all.length, hc) /* the measure this table shows (bench pass 5) */, cells: [
      ...cfg.cols.map((c) => { const v = rs.filter(c.f).length; return { v, open: () => open(`brk:${cfg.set}:${id}:${c.key}`) }; }),
      ...(cfg.set === "esc" ? m.escOwners.map((e) => { const v = rs.filter((r) => r.with === e.name).length; return { v, open: () => open(`brk:${cfg.set}:${id}:owner:${e.name}`) }; })
        : cfg.set === "all" ? [] : [{ v: owners.length === 1 ? owners[0] : null, name: true }]), // one owner per cell; never "Janelle, Katie"; In Pipeline has no Owner column (mixed holders)
    ] };
  };
  const tree: TreeRow[] = STAGES.flatMap((st) => {
    const rs = rows.filter((r) => r.stage === st.id); if (!rs.length) return [];
    const subs = m.steps.filter((x) => x.stage === st.id).map((x) => line(x.id, x.step, rs.filter((r) => r.stepId === x.id), m.rows.filter((r) => r.stepId === x.id))).filter((x) => x.cells[0].v);
    return [{ ...line(st.id, st.name, rs, m.rows.filter((r) => r.stage === st.id)), subs }];
  });
  return <div className="v2-card mt-card bk oo-block">
    <h2 className="bk-title">{cfg.title} · {rows.length}</h2>
    <Tree first="Stage" cols={[...cfg.cols.map((c) => c.label), ...(cfg.set === "esc" ? m.escOwners.map((e) => e.name) : cfg.set === "all" ? [] : ["Owner"])]} rows={tree} nameCols={["Owner"]} />
  </div>;
}
