/**
 * DESIGN INTENT v2 model (Brandon CR-14/15). One row per open patient with the step it is in, whole business days,
 * who has it (processor or escalation), lateness measured from when the Next Action Date was reached, and the
 * reason split: Processor (not started | attempted, not resolved | returned from escalation, untouched) vs
 * Escalation (past 2 days untouched | past 2 days being worked). No judgments.
 */
import type { FullSnapshot } from "../model/buildSnapshot";
import type { ItemRow, RawEvent } from "../types";
import { ctxFor, key as keyOf, speedEligible } from "../metrics/context";
import { patientRows } from "../metrics/patients";
import { actionPhrase, actionShort } from "../labels";
import { OO_CONFIG } from "../config";
import { attribute, personByKey } from "../people/owners";
import { detect, type Breaking } from "./detect";
import { type StageId, type StepDef, type DueSoonCfg, DEFAULT_DUE_SOON, dueSoonWindow, STAGES, stepIdAt } from "./steps";

export type Reason = "notStarted" | "attempted" | "returnedUntouched" | "escUntouched" | "escWorking";
export const REASON_LABEL: Record<Reason, string> = {
  notStarted: "Not started", attempted: "Attempted, not resolved", returnedUntouched: "Returned from escalation, untouched",
  escUntouched: "Escalation past due, untouched", escWorking: "Escalation past due, being worked",
};
export const PROC_REASONS: Reason[] = ["notStarted", "attempted", "returnedUntouched"];
export const ESC_REASONS: Reason[] = ["escUntouched", "escWorking"];

export interface V2Row {
  key: string; itemId: string; boardKey: string; boardId: string; name: string;
  stage: StageId; stepId: string; step: string; owner: string;
  /** "Processor", or the escalation owner's name from the step table */ with: string; escSinceMs: number | null; escDays: number | null;
  /** escalated rows: Proposed Stuck, Edge Case, or Unclassified (never guessed); null when with the processor */ escType: EscType | null;
  stepSinceMs: number; inStageDays: number; normal: number | null;
  /** when the item became actionable in this step (Next Action Date reached), null if not yet */
  actionableMs: number | null; actionableDays: number | null;
  late: boolean; dueSoon: boolean; reason: Reason | null; untouched: boolean; touchedInStep: boolean;
  /** returned from escalation during this step and untouched since (late or not) */ returned: boolean;
  /** last return from escalation during this step (the list shows "returned N days ago"), null if none */ returnedMs: number | null; returnedDays: number | null;
  /** `by`: who did it (§3.10.1 rules 1-2), or null when unattributed. */
  last: { label: string; atMs: number; by?: string | null } | null; attempts: string;
  /** escalated rows: the last real action before the escalation (what had been tried), null if none */ beforeEsc?: string | null;
}

const DAY = 864e5, AUTO = -4;
/** Columns a scheduled job updates every business day (found in the activity log: same minute, many items, daily). Never a person's action. INS "Days Auth Outstanding". */
const SCHEDULED_COLUMNS = new Set(["numeric_mm5f5ars"]);
/** The person who made an event (§3.10.1: a direct monday edit, else the Command Center person matched from the
 *  gateway's write log), or null when it can only be called the shared account. */
const whoName = (e: RawEvent): string | null => { const a = attribute(e.userId, OO_CONFIG, e.actorKey); return a.kind === "person" ? personByKey(a.key!, OO_CONFIG)?.name ?? null : null; };
/** Work no one can be named for (a shared-account write the gateway log does not match, or an unknown monday user). */
export const NOT_NAMED = "Not named";
/** A step-table owner name and a person name are the same person: equal, or the owner is the short form ("Sam" → Samantha). */
export const sameName = (owner: string, person: string): boolean => { const o = owner.trim().toLowerCase(), p = person.trim().toLowerCase(); return !!o && (o === p || p.startsWith(o)); };
/** Owner names in a step-table owner cell ("Janelle / Katie" → both). */
const ownerParts = (owner: string): string[] => owner.split("/").map((x) => x.trim()).filter(Boolean);
const human = (e: RawEvent) => !e.bulk && e.userId !== AUTO && e.userId != null && !SCHEDULED_COLUMNS.has(e.columnId);
/** An exit from an escalation value that is set back to the same value within the hour: not a return and not a new escalation (the §0.2 clock rule; red-team r17 N3). */
const isBlipOut = (evs: RawEvent[], col: string, e: RawEvent) => evs.some((x) => x.columnId === col && x.atMs > e.atMs && x.atMs - e.atMs <= 36e5 && x.toIndex === e.fromIndex);
const isBlipBack = (evs: RawEvent[], col: string, e: RawEvent) => evs.some((x) => x.columnId === col && x.atMs < e.atMs && e.atMs - x.atMs <= 36e5 && x.fromIndex === e.toIndex);
const NAD: Record<string, string> = { INT: "date_mm3874an", MN: "date_mm1wadgs", INS: "date_mm34m2dz", WC: "date_mm38a7k7" };
const STAGE_COL = OO_CONFIG.stageColumn as Record<string, string>;
const ESC_COL = OO_CONFIG.escalationColumn as Record<string, string>;
const INT_SUB = "color_mm6ct431", INT_ATT = "numeric_mm5ze82q";
const dateMs = (s: string) => Date.parse(`${s}T00:00:00-04:00`);
const isExitLabel = (b: string, i: number | null) => i != null && (((OO_CONFIG.exitLabels as unknown as Record<string, number[]>)[b] ?? []).includes(i) || (b === "MN" && i === 15) || ((b === "INS" || b === "WC") && i === 2));

/** Value of a status/date/number column at time t, replayed from the item's events (falls back to the current value). */
function at<T>(evs: RawEvent[], col: string, t: number, cur: T, pick: (e: RawEvent, side: "to" | "from") => T): T {
  let lastBefore: RawEvent | null = null, firstAfter: RawEvent | null = null;
  for (const e of evs) { if (e.columnId !== col) continue; if (e.atMs <= t) lastBefore = e; else if (!firstAfter) firstAfter = e; }
  if (lastBefore) return pick(lastBefore, "to"); if (firstAfter) return pick(firstAfter, "from"); return cur;
}
const idx = (e: RawEvent, s: "to" | "from") => (s === "to" ? e.toIndex : e.fromIndex);
const dte = (e: RawEvent, s: "to" | "from") => (s === "to" ? e.toDate ?? null : e.fromDate ?? null);
const num = (e: RawEvent, s: "to" | "from") => (s === "to" ? e.toNum ?? 0 : null) ?? 0;

/** List wording for the last action: team words, board-aware where the short label would hide what happened (product-owner v2 pass 2). */
function lastLabel(phrase: string, board: string, stepId: string): string {
  if (/^Set (the next follow-up|the next chase|a call-back|a follow-up) date/.test(phrase)) return board === "INS" ? (stepId === "ins.outstanding" ? "Payer follow-up date set" : "Follow-up date set") : board === "MN" ? "Next chase date set" : board === "WC" ? "Call-back date set" : "Follow-up date set";
  if (/^Follow-up set: (.*)/.test(phrase)) return phrase.replace(/^Follow-up set: (.*)/, board === "INS" && stepId === "ins.outstanding" ? "Payer follow-up: $1" : "Follow-up: $1");
  if (/^Status changed/.test(phrase)) return "Status changed";
  return actionShort(phrase).replace(/^⏰ /, "");
}

/**
 * Brandon (CR-16): Last action is a real human action in plain words. Field changes (chase method, dates set,
 * "records needed", generic status changes, group moves) are not actions and return null.
 */
export function plainAction(label: string): string | null {
  const arrow = /^→\s*(.+)$/.exec(label.trim()); if (arrow) return `Moved to ${arrow[1]}`;
  const l = label.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const rules: [RegExp, string | ((m: RegExpExecArray) => string)][] = [
    [/^Request sent$/, "Request sent"], [/^To (.+)$/, (m) => `Escalated to ${m[1]}`], [/^Back to queue$/, "Returned from escalation"],
    [/^Called$/, "Called"], [/^Call (\d+)$/, (m) => `Call ${m[1]} made`], [/^Receipt confirmed$/, "Receipt confirmed"],
    [/^Auth denied$/, "Auth denial recorded"], [/^Auth submitted$/, "Auth submitted"], [/^Benefits: /, "Benefits checked"],
    [/^Follow-up (\d+)$/, (m) => `Follow-up ${m[1]} sent`], [/^Follow-ups used up$/, "Last follow-up sent"],
    [/^(Payer )?[Ff]ollow-up: Done$/, "Follow-up done"], [/^Dr appointment$/, "Moved to Doctor Appointment"],
  ];
  for (const [re, out] of rules) { const m = re.exec(l); if (m) return typeof out === "string" ? out : out(m); }
  return null;
}

/** Deterministic generated name for exports, fixtures and screenshots (never a real patient). */
const FIRST = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Parker", "Rowan", "Sage", "Reese", "Blair", "Emerson"];
const LAST = ["Rivera", "Chen", "Patel", "Brooks", "Nguyen", "Foster", "Hayes", "Kim", "Lopez", "Morris", "Price", "Reed", "Shaw", "Tran", "Walsh", "Young"];
export function fakeName(id: string): string { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `${FIRST[h % 16]} ${LAST[(h >>> 4) % 16]}`; }

export interface StageSummary { stage: StageId; name: string; /** set on a sub-stage row (the step id) */ subStepId?: string; inStage: number; late: number; lateEsc: number; /** early warning (manager views only) */ dueSoon: number; bars: number[]; reasons: Record<Reason, number>; subs?: StageSummary[] }
export interface PersonSummary { name: string; stepId?: string; inSteps: number; actionable: number; notStarted: number; attempted: number; returnedUntouched: number; /** not started + returned untouched: no action since it became theirs (CR-16 "haven't gotten to") */ notGottenTo: number; pastDue: number; workedPerDay: number | null; actionablePerDay: number | null; weeks: { worked: number; actionable: number }[]; hasSteps: boolean }
export interface V2Model {
  now: number; rows: V2Row[]; steps: StepDef[];
  tiles: { /** all open patients (CR-16: the base for every tile %) */ inPipeline: number; processorPastDue: number; dueSoon: number; escalationsPastDue: number; complete: number; completePrior: number };
  stages: StageSummary[];
  people: (PersonSummary & { bySteps: PersonSummary[] })[];
  escOwners: { name: string; inEsc: number; past2: number; past2Untouched: number; past2Working: number; returned28: number; /** Two kinds of escalation: per type, held / past due / untouched past due / cleared today */ byType: Record<EscType, { n: number; past: number; untouched: number; worked: number }> }[];
  /** item keys behind each person-level and escalation-level count that is not a plain row filter */
  sets: Record<string, string[]>;
  completeKeys: string[];
  /** open patients whose current label maps to no step: not in any count; the header shows how many (red-team r16 #7) */
  notOnStep: string[];
  completedRows: V2Row[];
  /** in vs out over the same window: new referrals, completed, moved to Stuck (by the stage where it died) */
  flow: Record<7 | 28, { days: number; inRows: V2Row[]; completedKeys: string[]; stuck: Record<StageId, V2Row[]>; out: number; net: number }>;
  /** the completed business days used for every per-day figure (newest first) */
  windowDays: string[];
  /** per step: items worked per day vs items becoming actionable per day (last 5 and last 20 business days) */
  stepRates: Record<string, { worked: number; actionable: number; worked20: number; actionable20: number }>;
  /** Where it's breaking: every finding of the general detector, most severe first (detect.ts) */
  breaking: Breaking[];
  /**
   * Mutually exclusive buckets (Brandon): each open patient is in exactly one bucket, owner x (step, or escalation
   * kind). One owner per row, never combined; unowned work is "(no owner)". Sorted by Past Due, Low priority last.
   */
  buckets: Bucket[];
}

export interface Bucket { owner: string; kind: "step" | "esc"; where: string; label: string; priority: "High" | "Normal" | "Low"; pastDue: number; untouched: number; inBucket: number; keys: string[]; pastKeys: string[]; untouchedKeys: string[]; flagged: boolean }
export const NO_OWNER = "(no owner)";
export type EscType = "proposedStuck" | "edgeCase" | "unclassified";
export const ESC_TYPE_LABEL: Record<EscType, string> = { proposedStuck: "Proposed Stuck", edgeCase: "Edge Case", unclassified: "Unclassified" };

export function buildV2(snap: FullSnapshot, steps: StepDef[], opts: { names?: "live" | "fake"; dueSoon?: DueSoonCfg } = {}): V2Model {
  const dsCfg = opts.dueSoon ?? DEFAULT_DUE_SOON;
  const escClass = (snap as { escClass?: Record<string, string> }).escClass ?? {};
  // Live: the class read from the notes stamp at refresh (item.escClass). Tests and offline exports: the export's classification.
  const escTypeOf = (k: string): EscType => { const t = c.itemByKey.get(k)?.escClass ?? escClass[k]; return t === "proposedStuck" || t === "edgeCase" ? t : "unclassified"; };
  /** the escalation limit by type: Proposed Stuck and Edge Case have their own normal; unclassified keeps the holder's (2) */
  // Auth Denied is an Edge Case with its own normal (Brandon A3: 30 business days, the Auth Denied step's normal).
  const escLimit = (k: string, kind: "MGR" | "FINAL", stepId?: string | null) => { const t = escTypeOf(k);
    const d = stepById.get(t === "edgeCase" && stepId === "ins.denied" ? "ins.denied" : t === "proposedStuck" ? "esc.stuck" : t === "edgeCase" ? "esc.edge" : kind === "MGR" ? "esc.mgr" : "esc.final"); return d?.normal ?? 2; };
  const c = ctxFor(snap, { periodDays: 28, filters: {} });
  const now = c.now; const bd = (a: number, b: number) => c.bh(Math.min(a, b), Math.max(a, b)) / 24 * (b >= a ? 1 : -1);
  // ONE rounding rule (Brandon, 2026-10-02): days shown = business days elapsed, ROUNDED UP (any part of a business day
  // counts as a day); past due = days shown > normal. So "past due after N business days" holds literally, and a
  // shown day count can never disagree with past-due status on any screen.
  const days = (a: number, b: number) => Math.max(0, Math.ceil(bd(a, b) - 1e-9));
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const evMap = new Map<string, RawEvent[]>();
  for (const e of snap.events) { const k = keyOf(e.boardKey, e.itemId); (evMap.get(k) ?? evMap.set(k, []).get(k)!).push(e); }
  for (const v of evMap.values()) v.sort((a, b) => a.atMs - b.atMs);
  const pr = new Map(patientRows(c).map((r) => [r.key, r]));
  const boardId = (b: string) => (OO_CONFIG.boards as Record<string, string>)[b] ?? "";

  const isStepCol = (b: string, col: string) => col === STAGE_COL[b] || (b === "INT" && (col === INT_SUB || col === INT_ATT));
  const stepOf = (it: ItemRow, evs: RawEvent[], t: number) => { const b = it.boardKey; return stepIdAt(b, { stage: at(evs, STAGE_COL[b], t, it.values[STAGE_COL[b]]?.index ?? null, idx), intSub: b === "INT" ? at(evs, INT_SUB, t, it.values[INT_SUB]?.index ?? null, idx) : null, intAttempts: b === "INT" ? at(evs, INT_ATT, t, it.values[INT_ATT]?.num ?? 0, num) : null }); };
  /** actionable since = max(step start, Next Action Date, last return from escalation): a manager's days are never charged to the processor (architect #6) */
  const actionableAt = (st: { stepSinceMs: number; nadMs: number | null; lastReturnMs: number | null }, t: number): number | null => st.nadMs != null && st.nadMs > t ? null : Math.max(st.stepSinceMs, st.nadMs ?? 0, st.lastReturnMs ?? 0);
  // Josh, 2026-10-02: an escalation is "being worked" only when an escalation owner (the step table's Manager
  // Intervention / Final Decisions / Proposed Stuck / Edge Case owners: Janelle, Katie) took a named action on it —
  // a processor's edit or an unnamed write no longer counts. Needs attribution (rule 1 or the gateway's rule 2).
  const deciders = [...new Set(steps.filter((x) => x.stage === "ESC").flatMap((x) => ownerParts(x.owner)))];
  const byDecider = (e: RawEvent) => { const n = whoName(e); return !!n && deciders.some((o) => sameName(o, n)); };
  // Josh, 2026-10-02: "Worked" is credited to the person who made the change, under the step table's own name for them
  // ("Sam"), else their name; unnamed work goes to NOT_NAMED rather than to the step's owner.
  const ownerNames = [...new Set(steps.flatMap((x) => ownerParts(x.owner)))];
  const creditName = (e: RawEvent): string => { const n = whoName(e); return n ? ownerNames.find((o) => sameName(o, n)) ?? n : NOT_NAMED; };
  const escOwnerOf = (k: "MGR" | "FINAL") => stepById.get(k === "MGR" ? "esc.mgr" : "esc.final")?.owner || (k === "MGR" ? "Janelle" : "Katie");
  /** state of an item at time t: step, escalation, step start, actionable time */
  const stateAt = (it: ItemRow, evs: RawEvent[], t: number) => {
    const b = it.boardKey;
    const stage = at(evs, STAGE_COL[b], t, it.values[STAGE_COL[b]]?.index ?? null, idx);
    const stepId = stepIdAt(b, { stage, intSub: b === "INT" ? at(evs, INT_SUB, t, it.values[INT_SUB]?.index ?? null, idx) : null, intAttempts: b === "INT" ? at(evs, INT_ATT, t, it.values[INT_ATT]?.num ?? 0, num) : null });
    const escI = ESC_COL[b] ? at(evs, ESC_COL[b], t, it.values[ESC_COL[b]]?.index ?? null, idx) : null;
    const esc: "MGR" | "FINAL" | null = escI === 0 ? "MGR" : escI === 2 ? "FINAL" : null;
    const stepEvs = evs.filter((e) => e.atMs <= t && isStepCol(b, e.columnId));
    const change = [...stepEvs].reverse().find((e) => stepOf(it, evs, e.atMs) !== stepOf(it, evs, e.atMs - 1));
    const stepSinceMs = Math.max(it.createdAtMs, change?.atMs ?? it.createdAtMs);
    const ret = ESC_COL[b] ? [...evs].reverse().find((e) => e.atMs <= t && e.columnId === ESC_COL[b] && (e.fromIndex === 0 || e.fromIndex === 2) && e.toIndex !== 0 && e.toIndex !== 2) : undefined;
    let escIn = [...evs].reverse().find((e) => e.atMs <= t && ESC_COL[b] && e.columnId === ESC_COL[b] && (e.toIndex === 0 || e.toIndex === 2));
    // Cleared and re-set to the same owner within the hour keeps that owner's clock (red-team r16 #1); a forward to the other owner starts theirs.
    for (let guard = 0; escIn && guard < 50; guard++) {
      const cur = escIn; const prevOut = [...evs].reverse().find((e) => e.atMs < cur.atMs && e.columnId === ESC_COL[b] && e.fromIndex === cur.toIndex && e.toIndex !== cur.toIndex);
      if (!prevOut || cur.atMs - prevOut.atMs > 36e5) break;
      const prevIn = [...evs].reverse().find((e) => e.atMs <= prevOut.atMs && e.columnId === ESC_COL[b] && e.toIndex === cur.toIndex && e !== prevOut);
      if (!prevIn) break; escIn = prevIn;
    }
    const nadS = NAD[b] ? at(evs, NAD[b], t, it.values[NAD[b]]?.date ?? null, dte) : null;
    return { stepId, esc, stepSinceMs, escSinceMs: esc ? Math.max(escIn?.atMs ?? stepSinceMs, it.createdAtMs) : null, nadMs: nadS ? dateMs(nadS) : null, lastReturnMs: !esc && ret && ret.atMs >= stepSinceMs - 6e4 ? ret.atMs : null };
  };
  const isOpen = (k: string, t: number) => (c.spansByItem.get(k) ?? []).some((s) => (s.kind === "QUEUE" || s.kind === "MGR" || s.kind === "FINAL") && s.startMs <= t && (s.endMs == null || s.endMs > t));

  const rows: V2Row[] = []; const notOnStep: string[] = [];
  for (const [k, sp] of c.current) {
    if (sp.kind !== "QUEUE" && sp.kind !== "MGR" && sp.kind !== "FINAL") continue;
    const it = c.itemByKey.get(k); if (!it || !c.allowed(it)) continue;
    const evs = evMap.get(k) ?? []; const s = stateAt(it, evs, now); if (!s.stepId) { notOnStep.push(k); continue; }
    const def = stepById.get(s.stepId)!; const b = it.boardKey;
    const stage = b as StageId;
    const escDef = s.esc ? stepById.get(s.esc === "MGR" ? "esc.mgr" : "esc.final")! : null;
    const actionableMs = def.normal == null || s.esc ? (def.normal == null ? null : actionableAt(s, now)) : actionableAt(s, now);
    const actionableDays = actionableMs == null ? null : days(actionableMs, now);
    const escDays = s.escSinceMs != null ? days(s.escSinceMs, now) : null;
    const after = (t: number) => evs.some((e) => e.atMs > t + 6e4 && human(e) && e.columnId !== STAGE_COL[b] && e.columnId !== ESC_COL[b]);
    /** an escalation owner acting on an escalated item: a logged action NAMED to Janelle or Katie (the ESC step owners) after it was escalated, including a stage change (not the escalation flip itself) */
    const managerActed = (t: number) => evs.some((e) => e.atMs > t + 6e4 && human(e) && e.columnId !== ESC_COL[b] && byDecider(e));
    const touchedInStep = after(s.stepSinceMs);
    const returnedUntouched = s.lastReturnMs != null && !after(s.lastReturnMs);
    let late = false, dueSoon = false, reason: Reason | null = null, untouched = false;
    if (s.esc && escDef) {
      // Proposed Stuck: "anything older than 1 business day is past due" (Brandon) -> elapsed business time, not whole days.
      const lim = escLimit(k, s.esc, s.stepId); late = (escDays ?? 0) > lim; const w = dueSoonWindow(lim, dsCfg); dueSoon = !late && w > 0 && (escDays ?? 0) > lim - w;
      untouched = !managerActed(s.escSinceMs!);
      if (late) reason = untouched ? "escUntouched" : "escWorking";
    } else if (def.normal != null && actionableDays != null) {
      late = actionableDays > def.normal; const w = dueSoonWindow(def.normal, dsCfg); dueSoon = !late && w > 0 && actionableDays > def.normal - w;
      untouched = returnedUntouched || !after(actionableMs!); // architect #4: nothing since it became actionable
      if (late) reason = returnedUntouched ? "returnedUntouched" : !touchedInStep ? "notStarted" : "attempted";
    }
    const p = pr.get(k);
    // Last action = the last logged human action (scheduled columns and automation excluded), so it never contradicts "untouched" (product-owner v2 pass 4).
    const phraseOf = (e: RawEvent) => plainAction(lastLabel(actionPhrase(b, e.columnId, e.toIndex, e.toText, e.toNum), b, s.stepId));
    const lastAct = [...evs].reverse().find((e) => human(e) && e.event === "update_column_value" && phraseOf(e) != null);
    const escIns = ESC_COL[b] ? evs.filter((e) => e.columnId === ESC_COL[b] && (e.toIndex === 0 || e.toIndex === 2) && !isBlipBack(evs, ESC_COL[b], e)).length : 0;
    const rets = ESC_COL[b] ? evs.filter((e) => e.columnId === ESC_COL[b] && (e.fromIndex === 0 || e.fromIndex === 2) && e.toIndex !== 0 && e.toIndex !== 2 && !isBlipOut(evs, ESC_COL[b], e)).length : 0;
    const calls = b === "WC" ? it.values[OO_CONFIG.metricLabels.WC.callAttemptsText]?.num : b === "INT" ? it.values[INT_ATT]?.num : undefined;
    const base = calls != null ? (calls ? `${calls} call${calls === 1 ? "" : "s"}` : "") : p?.attempts && !/^No |^—$|attempts logged/i.test(p.attempts) ? p.attempts.replace(/ with provider/, "").replace(/^(\d+) auth submissions?/, "$1 submitted") : "";
    const attempts = [base, escIns ? `escalated ${escIns}×` : "", rets && !s.esc ? "returned" : ""].filter(Boolean).join(" · ") || "—";
    rows.push({
      key: k, itemId: it.itemId, boardKey: b, boardId: boardId(b), name: opts.names === "live" && it.name ? it.name : fakeName(it.itemId),
      stage, stepId: s.stepId, step: def.step, owner: s.esc ? escDef!.owner : def.owner, /* Sub-stage = the step in team terms; who has it is the With column */
      with: s.esc ? escOwnerOf(s.esc) : "Processor", escSinceMs: s.escSinceMs, escDays,
      stepSinceMs: s.stepSinceMs, inStageDays: days(s.stepSinceMs, now), normal: s.esc ? escLimit(k, s.esc, s.stepId) : def.normal, escType: s.esc ? escTypeOf(k) : null,
      actionableMs, actionableDays, late, dueSoon, reason, untouched, touchedInStep, returned: returnedUntouched, returnedMs: s.lastReturnMs, returnedDays: s.lastReturnMs != null ? days(s.lastReturnMs, now) : null,
      last: lastAct ? { label: phraseOf(lastAct)!, atMs: lastAct.atMs, by: whoName(lastAct) } : null, attempts,
      beforeEsc: s.esc ? (() => { const e = [...evs].reverse().find((x) => x.atMs < (s.escSinceMs ?? 0) && human(x) && x.event === "update_column_value" && x.columnId !== ESC_COL[b] && phraseOf(x) != null); return e ? phraseOf(e) : null; })() : null, // the last real human action; none -> "No action yet" (CR-16)
    });
  }

  // Onboarding complete: WC items moved to Completed (label 4) in the last 28 days vs the 28 before.
  const done = (from: number, to: number) => { const ks = new Set<string>(); for (const e of snap.events) if (e.boardKey === "WC" && e.columnId === STAGE_COL.WC && e.toIndex === 4 && e.atMs > from && e.atMs <= to) ks.add(keyOf(e.boardKey, e.itemId)); return [...ks]; };
  const completeKeys = done(now - 28 * DAY, now), completePrior = done(now - 56 * DAY, now - 28 * DAY).length;
  const completedRows: V2Row[] = completeKeys.map((k) => { const it = c.itemByKey.get(k)!; const evs = evMap.get(k) ?? []; const doneAt = [...evs].reverse().find((e) => e.columnId === STAGE_COL.WC && e.toIndex === 4)?.atMs ?? now;
    const row: V2Row = { key: k, itemId: it.itemId, boardKey: "WC", boardId: boardId("WC"), name: opts.names === "live" && it.name ? it.name : fakeName(it.itemId), stage: "WC", stepId: "done", step: "Onboarding complete", owner: "", with: "Processor", escSinceMs: null, escDays: null, escType: null,
      stepSinceMs: doneAt, inStageDays: days(doneAt, now), normal: null, actionableMs: null, actionableDays: null, late: false, dueSoon: false, reason: null, untouched: false, touchedInStep: true, returned: false, returnedMs: null, returnedDays: null, last: { label: "Completed", atMs: doneAt }, attempts: "—" }; return row; }).filter((r) => c.allowed({ boardKey: r.boardKey, itemId: r.itemId }));

  // Flow (Brandon, "are we keeping up?"): in vs out over the SAME window (not a comparison to a prior period).
  //  In        = items created on the Intake board in the window, excluding bulk imports and duplicates (speedEligible).
  //  Completed = Welcome Call items moved to Completed (label 4, "released" to the subscription board) in the window.
  //  Stuck     = items whose holder span became STUCK (Stuck label or Stuck group; real moves, not lag blips) in the window,
  //              counted on the board (stage) where the patient died.
  const simpleRow = (k: string, step: string, atMs: number, label: string): V2Row => { const it = c.itemByKey.get(k)!; const b = it.boardKey as StageId;
    return { key: k, itemId: it.itemId, boardKey: b, boardId: boardId(b), name: opts.names === "live" && it.name ? it.name : fakeName(it.itemId), stage: b, stepId: "flow", step, owner: "", with: "Processor", escSinceMs: null, escDays: null, escType: null,
      stepSinceMs: atMs, inStageDays: days(atMs, now), normal: null, actionableMs: null, actionableDays: null, late: false, dueSoon: false, reason: null, untouched: false, touchedInStep: true, returned: false, returnedMs: null, returnedDays: null, last: { label, atMs }, attempts: "—" }; };
  const openByUid = new Map<string, V2Row>(); for (const r of rows) { const u = c.itemByKey.get(r.key)?.uid; if (u) openByUid.set(u, r); }
  const flowFor = (w: number) => {
    const from = now - w * DAY;
    const inItems = c.snap.items.filter((it) => it.boardKey === "INT" && it.createdAtMs > from && it.createdAtMs <= now && c.allowed(it) && speedEligible(c, it));
    const inRows = inItems.map((it) => { const k = keyOf(it.boardKey, it.itemId); const open = rows.find((r) => r.key === k) ?? (it.uid ? openByUid.get(it.uid) : undefined);
      if (open) return open; const sp = (c.spansByItem.get(k) ?? []).at(-1);
      // Intake's patient id does not match the later boards' (checked on the export), so "where now" after Intake is where it was SENT:
      // the Intake exit label (1 = to Medical Necessity, 6 = to Welcome Call), or Stuck.
      const exit = [...(evMap.get(k) ?? [])].reverse().find((e) => e.columnId === STAGE_COL.INT && (e.toIndex === 1 || e.toIndex === 6));
      const step = sp?.kind === "STUCK" ? "Moved to Stuck" : exit ? (exit.toIndex === 1 ? "Sent to Medical Necessity" : "Sent to Welcome Call") : "Left Intake";
      return simpleRow(k, step, exit?.atMs ?? sp?.startMs ?? it.createdAtMs, step); });
    const completed = done(from, now);
    const stuck: Record<StageId, V2Row[]> = { INT: [], MN: [], INS: [], WC: [] };
    for (const it of c.snap.items) { if (!(it.boardKey in stuck) || !c.allowed(it)) continue; const k = keyOf(it.boardKey, it.itemId);
      const sp = (c.spansByItem.get(k) ?? []).find((x) => x.kind === "STUCK" && !x.synthetic && x.startMs > from && x.startMs <= now);
      if (sp) stuck[it.boardKey as StageId].push(simpleRow(k, "Moved to Stuck", sp.startMs, "Moved to Stuck")); }
    const out = completed.length + Object.values(stuck).reduce((n, x) => n + x.length, 0);
    return { days: w, inRows, completedKeys: completed, stuck, out, net: inRows.length - out };
  };
  const flow = { 7: flowFor(7), 28: flowFor(28) };

  // 4-week bars: late count (same rule, replayed) at the end of each of the last 4 weeks.
  const lateAt = (t: number): Map<StageId, number> => {
    const m = new Map<StageId, number>();
    for (const it of c.snap.items) {
      const k = keyOf(it.boardKey, it.itemId); if (it.createdAtMs > t || !isOpen(k, t) || !c.allowed(it)) continue;
      const s = stateAt(it, evMap.get(k) ?? [], t); if (!s.stepId) continue; const def = stepById.get(s.stepId)!;
      const stage = it.boardKey as StageId;
      let late = false;
      if (s.esc) late = days(s.escSinceMs!, t) > escLimit(k, s.esc, s.stepId);
      else if (def.normal != null) { const a = actionableAt(s, t); late = a != null && days(a, t) > def.normal; }
      if (late) { m.set(stage, (m.get(stage) ?? 0) + 1); m.set(s.stepId as StageId, (m.get(s.stepId as StageId) ?? 0) + 1); }
    }
    return m;
  };
  const weekEnds = [3, 2, 1, 0].map((w) => now - w * 7 * DAY); const barMaps = weekEnds.map(lateAt);

  const stages = STAGES.map(({ id, name }) => {
    const rs = rows.filter((r) => r.stage === id);
    const sum = (xs: V2Row[], bars: number[]): Omit<StageSummary, "stage" | "name"> => ({ inStage: xs.length, late: xs.filter((r) => r.late).length, dueSoon: xs.filter((r) => r.dueSoon).length, lateEsc: xs.filter((r) => r.late && r.with !== "Processor").length, bars,
      reasons: Object.fromEntries([...PROC_REASONS, ...ESC_REASONS].map((x) => [x, xs.filter((r) => r.reason === x).length])) as Record<Reason, number> });
    const out: StageSummary = { stage: id, name, ...sum(rs, barMaps.map((m) => m.get(id) ?? 0)) };
    // Click into a stage: the same columns by sub-stage (Brandon: sub-stages only after clicking a stage).
    out.subs = steps.filter((st) => st.stage === id).map((st) => ({ stage: id, name: st.step, subStepId: st.id, ...sum(rs.filter((r) => r.stepId === st.id), barMaps.map((m) => m.get(st.id as StageId) ?? 0)) })).filter((x) => x.inStage > 0);
    return out;
  });

  // By Employee. Most monday actions come through the shared Command Center account, so work is credited to the
  // step's owner (from the step table) at the time of the action, not to the monday user.
  // One window everywhere (architect #9): the last 20 COMPLETED business days, today excluded, holidays honoured (same calendar as c.bh).
  const dayKey = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const dk: string[] = []; for (let t = now - DAY; dk.length < 20 && t > now - 60 * DAY; t -= DAY) { const d = dayKey(t); const s0 = dateMs(d); if (c.bh(s0, s0 + DAY) > 0 && !dk.includes(d)) dk.push(d); }
  const dkSet = new Set(dk);
  const worked = new Map<string, Map<string, Set<string>>>(), became = new Map<string, Map<string, Set<string>>>(), workedStep = new Map<string, Map<string, Set<string>>>(), becameStep = new Map<string, Map<string, Set<string>>>();
  /** worked per person per step, keyed `${person}|${stepId}` */
  const workedPS = new Map<string, Map<string, Set<string>>>();
  const add = (m: Map<string, Map<string, Set<string>>>, owner: string, day: string, k: string) => { const a = m.get(owner) ?? m.set(owner, new Map()).get(owner)!; (a.get(day) ?? a.set(day, new Set()).get(day)!).add(k); };
  const credit = (m: Map<string, Map<string, Set<string>>>, mStep: Map<string, Map<string, Set<string>>>, def: StepDef, day: string, k: string) => { add(m, def.owner, day, k); add(mStep, def.id, day, k); };
  for (const it of c.snap.items) {
    if (!c.allowed(it)) continue; const k = keyOf(it.boardKey, it.itemId); const evs = evMap.get(k) ?? []; const b = it.boardKey;
    // Entry at creation (architect #2): a new item is in its first step from the moment it is created.
    { const d = dayKey(it.createdAtMs); if (dkSet.has(d)) { const s2 = stateAt(it, evs, it.createdAtMs + 1); const d2 = s2.stepId ? stepById.get(s2.stepId) : null; if (d2 && d2.normal != null && !s2.esc && (s2.nadMs == null || s2.nadMs <= it.createdAtMs)) credit(became, becameStep, d2, d, k); } }
    for (const e of evs) {
      const d = dayKey(e.atMs); if (!dkSet.has(d)) continue;
      const before = stateAt(it, evs, e.atMs - 1);
      // Worked (architect #3): any logged action, including advancing the patient out of the step (credited to the step it leaves); never the escalation flip.
      if (human(e) && e.columnId !== ESC_COL[b] && before.stepId && !before.esc) {
        // Credited to who did it (Josh, 2026-10-02), not to the step's owner; the step total counts everyone.
        const who = creditName(e); add(worked, who, d, k); add(workedStep, before.stepId, d, k); add(workedPS, `${who}|${before.stepId}`, d, k);
      }
      // Became actionable (architect #1): the STEP changed (stage column, or Intake sub-stage / first attempt), or the escalation came back.
      const stepChanged = isStepCol(b, e.columnId) && stepOf(it, evs, e.atMs) !== before.stepId;
      // A decision that closes the patient within the hour (e.g. Katie's "Done" then exit) or a same-owner blip is not a return (same rule as the returned set; CR-16 bench check).
      const returned = ESC_COL[b] && e.columnId === ESC_COL[b] && (e.fromIndex === 0 || e.fromIndex === 2) && e.toIndex !== 0 && e.toIndex !== 2 && !isBlipOut(evs, ESC_COL[b], e)
        && !evs.some((x) => x.columnId === STAGE_COL[b] && Math.abs(x.atMs - e.atMs) < 3600e3 && isExitLabel(b, x.toIndex)) && isOpen(k, e.atMs + 36e5);
      if (stepChanged || returned) { const s2 = stateAt(it, evs, e.atMs); const d2 = s2.stepId ? stepById.get(s2.stepId) : null; if (d2 && d2.normal != null && !s2.esc && (s2.nadMs == null || s2.nadMs <= e.atMs)) credit(became, becameStep, d2, d, k); }
      if (NAD[b] && e.columnId === NAD[b] && e.toDate && dkSet.has(e.toDate)) { const s2 = stateAt(it, evs, dateMs(e.toDate) + 12 * 3600e3); const d2 = s2.stepId ? stepById.get(s2.stepId) : null; if (d2 && d2.normal != null && !s2.esc) credit(became, becameStep, d2, e.toDate, k); }
    }
    const cur = NAD[b] ? it.values[NAD[b]]?.date : null;
    if (cur && dkSet.has(cur)) { const s2 = stateAt(it, evs, dateMs(cur) + 12 * 3600e3); const d2 = s2.stepId ? stepById.get(s2.stepId) : null; if (d2 && d2.normal != null && !s2.esc && isOpen(k, now)) credit(became, becameStep, d2, cur, k); }
  }
  const sets: Record<string, string[]> = {};
  // Cleared today (working-list burn-down, CR-16): an escalation leaving its owner (decided, returned or forwarded; not a same-owner blip),
  // or a processor's patient advancing out of their step. Today = the as-of date in ET.
  { const today = dayKey(now);
    for (const it of c.snap.items) {
      if (!c.allowed(it)) continue; const k = keyOf(it.boardKey, it.itemId); const evs = evMap.get(k) ?? []; const b = it.boardKey;
      for (const e of evs) {
        if (dayKey(e.atMs) !== today) continue;
        if (ESC_COL[b] && e.columnId === ESC_COL[b] && (e.fromIndex === 0 || e.fromIndex === 2) && e.toIndex !== e.fromIndex && !isBlipOut(evs, ESC_COL[b], e)) {
          const who = escOwnerOf(e.fromIndex === 0 ? "MGR" : "FINAL"); (sets[`cleared:${who}`] ??= []).includes(k) || sets[`cleared:${who}`].push(k);
        } else if (isStepCol(b, e.columnId)) {
          const before = stateAt(it, evs, e.atMs - 1); if (!before.stepId || before.esc || stepOf(it, evs, e.atMs) === before.stepId) continue;
          const who = stepById.get(before.stepId)?.owner; if (who) (sets[`cleared:${who}`] ??= []).includes(k) || sets[`cleared:${who}`].push(k);
        }
      }
    } }
  const avg = (m: Map<string, Set<string>> | undefined, ds: string[]) => (m ? ds.reduce((n, d) => n + (m.get(d)?.size ?? 0), 0) : 0) / ds.length;
  const stepOwners = [...new Set(steps.filter((s) => s.stage !== "ESC" && s.owner).map((s) => s.owner)), "Victor"]; // incl. Automated (DVS) and Unassigned, so By Employee adds up to By Stage
  // Plus anyone who worked processor steps they do not own (e.g. a manager clearing Benefits), and the unnamed share.
  const owners = [...stepOwners, ...[...worked.keys()].filter((n) => !stepOwners.includes(n)).sort((a, b) => (a === NOT_NAMED ? 1 : b === NOT_NAMED ? -1 : a.localeCompare(b)))];
  const w5 = dk.slice(0, 5); // the last 5 completed business days
  const personRow = (name: string, rs: V2Row[], wk: Map<string, Set<string>> | undefined, bc: Map<string, Set<string>> | undefined, hasSteps: boolean, stepId?: string): PersonSummary => {
    const act = rs.filter((r) => r.actionableMs != null);
    return {
      name, stepId, hasSteps, inSteps: rs.length, actionable: act.length,
      notStarted: act.filter((r) => !r.touchedInStep && !r.returned).length,
      attempted: act.filter((r) => r.touchedInStep && !r.returned).length,
      returnedUntouched: act.filter((r) => r.returned).length, // architect #7: returned and untouched, late or not
      notGottenTo: act.filter((r) => !r.touchedInStep || r.returned).length,
      pastDue: rs.filter((r) => r.late).length,
      workedPerDay: hasSteps ? Math.round(avg(wk, w5) * 10) / 10 : null, actionablePerDay: hasSteps ? Math.round(avg(bc, w5) * 10) / 10 : null,
      weeks: [3, 2, 1, 0].map((w) => { const ds = dk.slice(w * 5, w * 5 + 5); return { worked: Math.round(avg(wk, ds)), actionable: Math.round(avg(bc, ds)) }; }),
    };
  };
  const people = owners.map((name) => {
    const rs = rows.filter((r) => r.with === "Processor" && r.owner === name);
    const wk = worked.get(name), bc = became.get(name);
    sets[`worked:${name}`] = [...new Set(w5.flatMap((d) => [...(wk?.get(d) ?? [])]))];
    sets[`became:${name}`] = [...new Set(w5.flatMap((d) => [...(bc?.get(d) ?? [])]))];
    // Their own steps, plus any step they worked in (so their worked/day adds up across the drill-in).
    const own = steps.filter((st) => st.stage !== "ESC" && (st.owner === name || workedPS.has(`${name}|${st.id}`)));
    // Click a processor: the same columns by step (product-owner v2 pass 1, H3: the gap per step).
    const bySteps = own.map((st) => {
      const wkS = workedPS.get(`${name}|${st.id}`), bcS = st.owner === name ? becameStep.get(st.id) : undefined;
      sets[`worked:${name}:${st.id}`] = [...new Set(w5.flatMap((d) => [...(wkS?.get(d) ?? [])]))];
      sets[`became:${name}:${st.id}`] = [...new Set(w5.flatMap((d) => [...(bcS?.get(d) ?? [])]))];
      return personRow(st.step, rs.filter((r) => r.stepId === st.id), wkS, bcS, st.normal != null, st.id);
    });
    const total = personRow(name, rs, wk, bc, own.length > 0);
    // The person's rates are the sum of their step rows, so the drill-in adds up (ux-exec v2: 27 / 15 vs 24 / 12).
    if (total.hasSteps) { const sum = (f: (x: PersonSummary) => number | null) => bySteps.reduce((n, x) => n + Math.round(f(x) ?? 0), 0); // sum of the rounded step figures shown, so the drill-in adds up exactly
      total.workedPerDay = sum((x) => x.workedPerDay); total.actionablePerDay = sum((x) => x.actionablePerDay);
      total.weeks = total.weeks.map((_, i) => ({ worked: bySteps.reduce((n, x) => n + x.weeks[i].worked, 0), actionable: bySteps.reduce((n, x) => n + x.weeks[i].actionable, 0) })); }
    return { ...total, bySteps };
  });
  // Escalation owners. "Returned without resolution" = distinct patients still open whose escalation left this owner in the last 28 days without the item moving on (no exit, release or Stuck within the hour). Same set as DIAGNOSIS H2.
  const escOwners = (["MGR", "FINAL"] as const).map((kind) => { const name = escOwnerOf(kind); /* architect #8: names come from the step table */
    const rs = rows.filter((r) => r.with === name);
    const ret: string[] = [];
    for (const r of rows) {
      const evs = evMap.get(r.key) ?? []; const col = ESC_COL[r.boardKey]; if (!col) continue;
      const hit = evs.some((e) => e.columnId === col && e.atMs >= now - 28 * DAY && e.fromIndex === (kind === "MGR" ? 0 : 2) && e.toIndex !== 0 && e.toIndex !== 2 && !isBlipOut(evs, col, e)
        && !evs.some((x) => x.columnId === STAGE_COL[r.boardKey] && Math.abs(x.atMs - e.atMs) < 3600e3 && isExitLabel(r.boardKey, x.toIndex)));
      if (hit) ret.push(r.key);
    }
    sets[`returned:${name}`] = ret;
    const byType = Object.fromEntries((["proposedStuck", "edgeCase", "unclassified"] as EscType[]).map((t) => { const x = rs.filter((r) => r.escType === t);
      return [t, { n: x.length, past: x.filter((r) => r.late).length, untouched: x.filter((r) => r.reason === "escUntouched").length, worked: x.filter((r) => r.reason === "escWorking").length }]; })) as Record<EscType, { n: number; past: number; untouched: number; worked: number }>;
    return { name, byType, inEsc: rs.length, past2: rs.filter((r) => r.late).length, past2Untouched: rs.filter((r) => r.reason === "escUntouched").length, past2Working: rs.filter((r) => r.reason === "escWorking").length, returned28: ret.length };
  });
  const out: Omit<V2Model, "breaking" | "buckets"> = {
    now, rows, steps, completeKeys, completedRows,
    notOnStep, flow,
    tiles: { inPipeline: rows.length, processorPastDue: rows.filter((r) => r.late && r.with === "Processor").length, dueSoon: rows.filter((r) => r.dueSoon).length, escalationsPastDue: rows.filter((r) => r.late && r.with !== "Processor").length, complete: completeKeys.length, completePrior },
    stages, people, escOwners, sets, windowDays: dk,
    stepRates: Object.fromEntries(steps.map((st) => [st.id, { worked: Math.round(avg(workedStep.get(st.id), dk.slice(0, 5)) * 10) / 10, actionable: Math.round(avg(becameStep.get(st.id), dk.slice(0, 5)) * 10) / 10, worked20: Math.round(avg(workedStep.get(st.id), dk) * 10) / 10, actionable20: Math.round(avg(becameStep.get(st.id), dk) * 10) / 10 }])),
  };
  const breaking = detect(out);
  // Buckets: one per (owner, step) for processor work and (holder, escalation kind) for escalations. Past due and
  // untouched use the ONE dashboard definition (row.late, row.late && row.untouched), so every screen agrees.
  const bmap = new Map<string, Bucket>();
  for (const r of rows) {
    const esc = r.with !== "Processor"; const def = stepById.get(r.stepId);
    const owner = esc ? r.with : !def?.owner || /^(unassigned|none)$/i.test(def.owner) ? NO_OWNER : def.owner;
    const where = esc ? r.escType ?? "unclassified" : r.stepId; const id = `${owner}|${esc ? "esc" : "step"}|${where}`;
    const b = bmap.get(id) ?? bmap.set(id, { owner, kind: esc ? "esc" : "step", where, label: esc ? ESC_TYPE_LABEL[r.escType ?? "unclassified"] : def?.step ?? r.step, priority: esc ? "Normal" : def?.priority ?? "Normal", pastDue: 0, untouched: 0, inBucket: 0, keys: [], pastKeys: [], untouchedKeys: [], flagged: false }).get(id)!;
    b.inBucket++; b.keys.push(r.key); if (r.late) { b.pastDue++; b.pastKeys.push(r.key); if (r.untouched) { b.untouched++; b.untouchedKeys.push(r.key); } }
  }
  const buckets = [...bmap.values()];
  for (const f of breaking) { const ks = new Set(f.keys); for (const b of buckets) if (b.keys.some((k) => ks.has(k))) b.flagged = true; }
  const lowLast = { High: 0, Normal: 0, Low: 1 } as const;
  buckets.sort((a, b) => lowLast[a.priority] - lowLast[b.priority] || b.pastDue - a.pastDue || b.untouched - a.untouched || b.inBucket - a.inBucket);
  return { ...out, breaking, buckets };
}
