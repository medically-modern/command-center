/**
 * Every number on the overview opens the patient list filtered to exactly that set (DESIGN INTENT v2).
 * A list id names the set; this resolves it to one plain title and the rows.
 */
import type { V2Model, V2Row, Reason } from "./model";
import { REASON_LABEL, ESC_TYPE_LABEL, type EscType } from "./model";
import { PATTERN_LABEL } from "./detect";
import { stageName, type StageId } from "./steps";

export interface ListResult { title: string; rows: V2Row[]; /** a historical set (worked / became actionable): the untouched mark would describe today, not the set */ hideUntouched?: boolean }

const TILE: Record<string, [string, (r: V2Row) => boolean]> = {
  pipeline: ["In Pipeline", () => true],
  onTrack: ["On Track", (r) => !r.late],
  procPastDue: ["Processor Past Due", (r) => r.late && r.with === "Processor"],
  dueSoon: ["Due Soon", (r) => r.dueSoon],
  escPastDue: ["Escalations Past Due", (r) => r.late && r.with !== "Processor"],
};
const PERSON: Record<string, [string, (r: V2Row) => boolean]> = {
  inSteps: ["Patients", () => true],
  notGottenTo: ["Not Started", (r) => r.actionableMs != null && (!r.touchedInStep || r.returned)],
  actionable: ["Actionable now", (r) => r.actionableMs != null],
  notStarted: ["Not started", (r) => r.actionableMs != null && !r.touchedInStep && !r.returned],
  attempted: ["Attempted, not resolved", (r) => r.actionableMs != null && r.touchedInStep && !r.returned],
  returnedUntouched: ["Returned from escalation, untouched", (r) => r.actionableMs != null && r.returned],
  pastDue: ["Past Due", (r) => r.late],
};
const ESC: Record<string, [string, (r: V2Row) => boolean]> = {
  inEsc: ["In escalation", () => true],
  past2: ["Past Due", (r) => r.late],
  past2Untouched: ["Past Due, untouched", (r) => r.reason === "escUntouched"],
  past2Working: ["Past Due, being worked", (r) => r.reason === "escWorking"],
};

export function listFor(m: V2Model, id: string): ListResult | null {
  const [kind, a, b, c] = id.split(":");
  const n = (rows: V2Row[], ...parts: string[]) => ({ title: [...parts, String(rows.length)].join(" · "), rows });
  if (kind === "tile") {
    if (a === "complete") return n(m.completedRows, "Onboarding Complete", "last 28 days");
    const t = TILE[a]; return t ? n(m.rows.filter(t[1]), t[0]) : null;
  }
  if (kind === "stage") {
    const st = a as StageId; const sub = a.includes(".") ? a : null; const rs = sub ? m.rows.filter((r) => r.stepId === sub) : m.rows.filter((r) => r.stage === st); const name = sub ? m.steps.find((x) => x.id === sub)?.step ?? sub : stageName(st);
    if (b === "in") return n(rs, name, "In-Stage");
    if (b === "late") return n(rs.filter((r) => r.late), name, "Past Due");
    if (b === "dueSoon") return n(rs.filter((r) => r.dueSoon), name, "Due Soon");
    if (b === "lateProc") return n(rs.filter((r) => r.late && r.with === "Processor"), name, "Processor Past Due");
    if (b === "lateEsc") return n(rs.filter((r) => r.late && r.with !== "Processor"), name, "Past Due", "in escalation");
    if (b === "reason") return n(rs.filter((r) => r.reason === c), name, "Past Due", REASON_LABEL[c as Reason] ?? c);
    return null;
  }
  if (kind === "flow") {
    // flow:<7|28>:in | completed | stuck[:<stage>]   (in vs out over the same window)
    const f = m.flow[Number(a) as 7 | 28]; if (!f) return null; const win = `last ${f.days} days`;
    if (b === "in") return n(f.inRows, "New referrals in", win);
    if (b === "completed") { const keys = new Set(f.completedKeys); return n(m.completedRows.filter((r) => keys.has(r.key)), "Completed", win); }
    if (b === "stuck") { const rs = c ? f.stuck[c as StageId] ?? [] : Object.values(f.stuck).flat(); return n(rs, "Moved to Stuck", ...(c ? [stageName(c as StageId)] : []), win); }
    return null;
  }
  if (kind === "bkt") {
    // bkt:<index>:past|untouched|all
    const bk = m.buckets[Number(a)]; if (!bk) return null; const ks = new Set(b === "past" ? bk.pastKeys : b === "untouched" ? bk.untouchedKeys : bk.keys);
    return n(m.rows.filter((r) => ks.has(r.key)), bk.owner, bk.label, b === "past" ? "Past Due" : b === "untouched" ? "Untouched" : "In bucket");
  }
  if (kind === "det") {
    const b = m.breaking[Number(a)]; if (!b) return null; const keys = new Set(b.keys);
    return n(m.rows.filter((r) => keys.has(r.key)), b.label, PATTERN_LABEL[b.pattern]);
  }
  if (kind === "brk") {
    // brk:<proc|esc|all>:<stage id or step id>:<column>[:<owner>] — one cell of a tile's breakdown table (CR-16)
    const [, set, sid, col, who] = id.split(":");
    const sub = sid.includes("."); const name = sub ? m.steps.find((x) => x.id === sid)?.step ?? sid : stageName(sid as StageId);
    const base = m.rows.filter((r) => (sub ? r.stepId === sid : r.stage === sid) && (set === "proc" ? r.with === "Processor" : set === "esc" ? r.with !== "Processor" : true));
    const late = set === "all" ? base : base.filter((r) => r.late);
    const f: Record<string, [string, (r: V2Row) => boolean]> = {
      all: ["In Pipeline", () => true], late: [set === "esc" ? "Escalations Past Due" : "Processor Past Due", () => true],
      notStarted: ["Past Due · Not started", (r) => r.reason === "notStarted"], attempted: ["Past Due · Attempted, not resolved", (r) => r.reason === "attempted"],
      returnedUntouched: ["Past Due · Returned from escalation, untouched", (r) => r.reason === "returnedUntouched"],
      escUntouched: ["Escalations Past Due · Untouched", (r) => r.reason === "escUntouched"], escWorking: ["Escalations Past Due · Being worked", (r) => r.reason === "escWorking"],
      pastAll: ["Past Due", (r) => r.late], esc: ["In escalation", (r) => r.with !== "Processor"],
      owner: [`${who}`, (r) => (r.with === "Processor" ? r.owner : r.with) === who],
    };
    const g = f[col]; if (!g) return null;
    const title = col === "owner" ? (set === "esc" ? `Escalations Past Due · ${who}` : set === "all" ? `In Pipeline · ${who}` : `Processor Past Due · ${who}`) : g[0];
    return n(late.filter(g[1]), name, title);
  }
  if (kind === "person") {
    // person:<name>:<column>[:<step id>]
    const stepId = c; const stepName = stepId ? m.steps.find((x) => x.id === stepId)?.step ?? stepId : null;
    const rs = m.rows.filter((r) => r.with === "Processor" && r.owner === a && (!stepId || r.stepId === stepId));
    const who = stepName ? [a, stepName] : [a];
    if (b === "worked" || b === "became") {
      const keys = new Set(m.sets[`${b}:${a}${stepId ? `:${stepId}` : ""}`] ?? []);
      const p = m.people.find((x) => x.name === a); const ps = stepId ? p?.bySteps.find((x) => x.stepId === stepId) : p;
      const perDay = Math.round((b === "worked" ? ps?.workedPerDay : ps?.actionablePerDay) ?? 0);
      // The number clicked is a per-day average; the list is every still-open patient behind it over the 5 days (product-owner v2 pass 2).
      const rows = m.rows.filter((r) => keys.has(r.key));
      // Title states the per-day number clicked, then what the list holds (still-open patients behind it), so they never read as a contradiction.
      return { title: [...who, `${b === "worked" ? "Worked" : "New"} ${perDay}/day (last 5 days)`, `${rows.length} still open`].join(" · "), rows, hideUntouched: true };
    }
    const p = PERSON[b]; return p ? n(rs.filter(p[1]), ...who, p[0]) : null;
  }
  if (kind === "esc") {
    if (b === "returned") { const keys = new Set(m.sets[`returned:${a}`] ?? []); return n(m.rows.filter((r) => keys.has(r.key)), a, "Sent back, still open (28 days)"); }
    // esc:<owner>:<column>[:<kind>]  (rows are owner x kind on By Employee)
    const rs = m.rows.filter((r) => r.with === a && (!c || r.escType === c)); const e = ESC[b];
    return e ? n(rs.filter(e[1]), a, ...(c ? [ESC_TYPE_LABEL[c as EscType]] : []), e[0]) : null;
  }
  return null;
}
