/**
 * Manager patient list and patient page model (Brandon CR-10). One row per open patient item: plain stage and
 * sub-stage, owner, escalation bucket, time here, last action (phrased, dated, by whom), days since anyone
 * touched it, attempts as counts, and rule-based falling-behind / "doesn't add up" flags with a short reason.
 * Wording comes only from labels.ts. Computed from the cached snapshot (items, events, holder spans).
 */
import type { Dict, HolderSpan, ItemRef, RawEvent } from "../types";
import type { Ctx } from "./context";
import { inPipelineGroup, isSnoozed, key } from "./context";
import { continuousHold } from "./codeStats";
import { attribute, liveOwners, personByKey, tierOf } from "../people/owners";
import { BUCKET, WHO, actionPhrase, attemptsPhrase, stepName, subStageName } from "../labels";
import { bucketDays } from "./bucketDays";

export type FlagId = "limbo" | "overTarget" | "untouched" | "attempts" | "bouncing" | "data";
export interface PFlag { id: FlagId; label: string; reason: string; severity: 1 | 2 | 3; /** data flags: the patient is open on an earlier board but already further along (clean-up, not late work). */ stale?: boolean }
export interface LastAction { phrase: string; atMs: number; who: string }
export type WarnState = "ok" | "approaching" | "over";
export type Ball = "Us" | "Payer" | "Provider" | "Patient";
/** CR-12 early warning: time and attempts vs this sub-stage's normal, and whose move it is. */
export interface Warning {
  normBd: number; ratio: number; timeState: WarnState; daysToCross: number;
  attempts: { kind: string; n: number | null; normal: number; state: WarnState } | null;
  state: WarnState; ball: Ball; ballWhy: string; lastOurActionMs: number | null;
}
export interface PatientRow {
  ref: ItemRef; key: string; board: string; step: string; sub: string; kind: string; code: string | null;
  owner: string; ownerKeys: string[]; bucket: "MGR" | "FINAL" | null; hereBd: number; hereSinceMs: number; synthetic: boolean;
  last: LastAction | null; lastKey: string | null; touchedBd: number; referralMs: number; /** business days on this board (stage) so far */ stageBd: number; attempts: string; flags: PFlag[]; behindBd: number; trips: number; escalatedBd: number; snoozed: boolean; /** snoozed with a date in the future and ≤ ball.maxDateAheadBd (round 9) */ snoozedBounded: boolean; warn: Warning;
}

export const FLAG_LABEL: Record<FlagId, string> = { limbo: "Waiting too long on a decision", overTarget: "Over target", untouched: "No progress logged", attempts: "Many attempts, no progress", bouncing: "Back and forth", data: "Doesn't add up" };
const DAY = 86400000;
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const bdTxt = (x: number) => `${x < 10 ? x.toFixed(1).replace(/\.0$/, "") : Math.round(x)} business day${Math.abs(x - 1) < 0.05 ? "" : "s"}`;

export function eventsByItem(c: Ctx): Map<string, RawEvent[]> {
  const cached = (c as unknown as { _ev?: Map<string, RawEvent[]> })._ev; if (cached) return cached;
  const m = new Map<string, RawEvent[]>();
  for (const e of c.snap.events) { const k = key(e.boardKey, e.itemId); (m.get(k) ?? m.set(k, []).get(k)!).push(e); }
  for (const l of m.values()) l.sort((a, b) => a.atMs - b.atMs);
  (c as unknown as { _ev?: Map<string, RawEvent[]> })._ev = m; return m;
}
export function whoDid(c: Ctx, userId: number | null): string {
  const a = attribute(userId, c.cfg);
  return a.kind === "person" ? personByKey(a.key!, c.cfg)?.name ?? WHO.unknown : a.kind === "automation" ? WHO.automation : WHO.unattributed;
}
const MN_ATTEMPT_MAP = (c: Ctx) => (c.cfg.metricLabels.MN.attempts.map as Record<string, number | string>);

/** Attempts as counts, plus the raw numbers used by the attempt flags. */
function attempts(c: Ctx, board: string, it: Dict, evs: RawEvent[]): { text: string; mnCounter: number | "escalated" | null; mnLogged: number; insDenials: number } {
  if (board === "MN") {
    const idx = it.values[c.cfg.metricLabels.MN.attempts.col]?.index;
    const counter = idx == null ? null : (MN_ATTEMPT_MAP(c)[String(idx)] as number | "escalated" | undefined) ?? null;
    const logged = (c.cfg.metricLabels.MN_attemptTextCols as readonly string[]).filter((col) => it.values[col]?.nonEmpty).length;
    const n = typeof counter === "number" ? counter : counter === "escalated" ? 3 : logged;
    return { text: n ? attemptsPhrase.mnFollowUps(n) + (counter === "escalated" ? " · escalated" : "") : "No follow-ups yet", mnCounter: counter, mnLogged: logged, insDenials: 0 };
  }
  if (board === "INS") {
    const col = c.cfg.stageColumn.INS; const subs = evs.filter((e) => e.columnId === col && e.toIndex === c.cfg.metricLabels.INS.authOutstanding).length;
    const den = evs.filter((e) => e.columnId === col && e.toIndex === c.cfg.metricLabels.INS.denied).length;
    return { text: subs || den ? attemptsPhrase.insSubmissions(subs, den) : "No auth submitted yet", mnCounter: null, mnLogged: 0, insDenials: den };
  }
  if (board === "WC") {
    const t = c.cfg.metricLabels.WC.welcomeText; const sent = it.values[t.col]?.index === t.index || evs.some((e) => e.columnId === t.col && e.toIndex === t.index);
    const calls = !!it.values[c.cfg.metricLabels.WC.callAttemptsText]?.nonEmpty;
    return { text: [sent ? attemptsPhrase.wcText : "", calls ? attemptsPhrase.wcCalls : ""].filter(Boolean).join(" · ") || "No contact logged yet", mnCounter: null, mnLogged: 0, insDenials: 0 };
  }
  const asks = evs.filter((e) => e.columnId === c.cfg.stageColumn.INT && e.toIndex === c.cfg.metricLabels.INT.needMoreInfo).length;
  return { text: asks ? attemptsPhrase.intAsks(asks) : "—", mnCounter: null, mnLogged: 0, insDenials: 0 };
}

const worse = (a: WarnState, b: WarnState): WarnState => (a === "over" || b === "over" ? "over" : a === "approaching" || b === "approaching" ? "approaching" : "ok");

/**
 * CR-12 (spec §3.19): time state = days in this sub-stage vs its normal (approaching from norms.approachShare);
 * attempt state = attempts without progress vs a normal count (approaching at normal − 1); ball in court from the
 * sub-stage's waiting-on party and the date of OUR last action (any non-automation, non-bulk change on the item,
 * including the evidence columns) against the cadence.
 */
export function warningFor(c: Ctx, it: Dict, kind: string, code: string | null, hereBd: number, synthetic: boolean, snoozedIn: boolean, evs: RawEvent[],
  at: { mnCounter: number | "escalated" | null; insDenials: number }): Warning {
  let snoozed = snoozedIn; const N = c.cfg.norms; const B = c.cfg.ball; const key0 = kind === "QUEUE" ? (code ?? "UNMAPPED") : kind;
  const normBd = N.time[key0] ?? N.time.UNMAPPED; const ratio = synthetic ? 0 : hereBd / normBd;
  // Consult C2: one rule read once. The displayed days are rounded to 0.1; late = that figure > normal; due soon from 75% of normal.
  const shown = Math.round(hereBd * 10) / 10;
  const timeState: WarnState = synthetic ? "ok" : shown > normBd ? "over" : shown >= normBd * N.approachShare ? "approaching" : "ok";
  let attempts: Warning["attempts"] = null;
  const an = kind === "QUEUE" ? N.attempts[code ?? ""] : undefined;
  if (an) {
    const n = an.kind === "providerFollowUps" ? (at.mnCounter === "escalated" ? an.normal : at.mnCounter) : an.kind === "authDenials" ? at.insDenials
      : an.kind === "calls" ? (it.values[c.cfg.metricLabels.WC.callAttemptsText]?.num ?? null) : an.kind === "intakeAttempts" ? (it.values["numeric_mm5ze82q"]?.num ?? null) : null;
    attempts = { kind: an.kind, n, normal: an.normal, state: n == null ? "ok" : n >= an.normal ? "over" : an.normal > 1 && n >= an.normal - 1 ? "approaching" : "ok" };
  }
  // A set follow-up / chase date counts as "on cadence" only when it is in the future and at most maxDateAheadBd away (round 8: not gameable).
  if (snoozed) { const rules = (c.cfg.snooze as Dict)[it.boardKey]; const ds = rules ? it.values[rules.dateCol]?.date : null;
    const ahead = ds ? c.bh(c.now, Date.parse(`${ds}T12:00:00-05:00`)) / 24 : Infinity; if (!(ahead <= B.maxDateAheadBd)) snoozed = false; }
  const ours = evs.filter((e) => !e.bulk && e.userId !== c.cfg.automationUserId);
  const lastOur = ours.length ? ours[ours.length - 1].atMs : null; const sinceOur = lastOur == null ? Infinity : c.bh(lastOur, c.now) / 24;
  const party = kind === "QUEUE" ? String((c.cfg.waitingOn as Dict)[code ?? ""] ?? "us") : "decision";
  const ago = (x: number) => (x === Infinity ? "nothing logged in monday" : `last logged ${Math.round(x)}d ago`);
  let ball: Ball = "Us"; let ballWhy = "Our step";
  if (party === "decision") { ball = "Us"; ballWhy = kind === "MGR" ? "Janelle to decide" : "Katie to decide"; }
  else if (party === "provider") { if (sinceOur <= B.providerCadenceBd || snoozed) { ball = "Provider"; ballWhy = snoozed ? "Chase date set" : `Chased, ${ago(sinceOur)}`; } else ballWhy = `No chase logged in cadence (${ago(sinceOur)}; monday only, CC calls/faxes not connected)`; }
  else if (party === "payer") { if (sinceOur <= B.payerCadenceBd || snoozed) { ball = "Payer"; ballWhy = snoozed ? "Follow-up date set" : `Followed up, ${ago(sinceOur)}`; } else ballWhy = `No follow-up in cadence (${ago(sinceOur)})`; }
  else if (party === "patient") {
    const calls = attempts?.kind === "calls" ? attempts.n ?? 0 : 0;
    if (calls >= B.callsMeanPatient) { ball = "Patient"; ballWhy = `${calls} calls, no answer`; }
    else if (sinceOur <= B.patientCadenceBd || snoozed) { ball = "Patient"; ballWhy = snoozed ? "Call-back date set" : `Contacted, ${ago(sinceOur)}`; }
    else ballWhy = `No contact in cadence (${ago(sinceOur)})`;
  } else if (snoozed) ballWhy = "Follow-up date set";
  return { normBd, ratio, timeState, daysToCross: Math.round((normBd - shown) * 10) / 10, attempts, state: worse(timeState, attempts?.state ?? "ok"), ball, ballWhy, lastOurActionMs: lastOur };
}

export function patientRows(c: Ctx): PatientRow[] {
  const live = liveOwners(c.snap.access, c.cfg); const evMap = eventsByItem(c); const F = c.cfg.patientFlags;
  const mismatch = new Set(c.snap.extras?.historyMismatchItems ?? []);
  const journeyOf = new Map<string, (typeof c.journeys)[number]>();
  for (const j of c.journeys) { for (const x of Object.values(j.primary)) if (x) journeyOf.set(key(x.boardKey, x.itemId), j); for (const x of j.duplicates) journeyOf.set(key(x.boardKey, x.itemId), j); }
  const rows: PatientRow[] = [];
  for (const [k, s] of c.current) {
    const it = c.itemByKey.get(k);
    if (!it || !c.allowed(it) || !inPipelineGroup(c, it) || s.endMs != null) continue;
    if (s.kind !== "QUEUE" && s.kind !== "MGR" && s.kind !== "FINAL") continue;
    const spans = c.spansByItem.get(k)!; const evs = evMap.get(k) ?? []; const b = bucketDays(c, spans);
    const snoozed = s.kind === "QUEUE" && isSnoozed(c, it);
    let hereStart = spans[spans.length - 1].startMs; let synthetic = s.synthetic;
    if (s.kind !== "QUEUE") { const h = continuousHold(c, spans); if (h) { hereStart = h.startMs; synthetic = h.synthetic; } }
    const hereBd = c.bh(hereStart, c.now) / 24;
    const lastEv = [...evs].reverse().find((e) => !e.bulk) ?? evs[evs.length - 1];
    const last: LastAction | null = lastEv ? { phrase: actionPhrase(it.boardKey, lastEv.columnId, lastEv.toIndex, lastEv.toText, lastEv.toNum), atMs: lastEv.atMs, who: whoDid(c, lastEv.userId) } : null;
    const touchedBd = c.bh(lastEv?.atMs ?? it.createdAtMs, c.now) / 24;
    const procs = s.kind === "QUEUE" ? (live[s.code ?? ""] ?? []).filter((x) => tierOf(x, c.cfg) === "processor") : [];
    const ownerKeys = s.kind === "MGR" ? ["janelle"] : s.kind === "FINAL" ? ["katie"] : procs;
    const owner = s.kind === "MGR" ? "Janelle" : s.kind === "FINAL" ? "Katie" : procs.length ? procs.map((x) => personByKey(x, c.cfg)?.name ?? x).join(", ") : "No one assigned";
    const at = attempts(c, it.boardKey, it, evs);
    const flags: PFlag[] = []; let behind = 0;
    const add = (id: FlagId, reason: string, severity: 1 | 2 | 3, stale = false) => flags.push({ id, label: FLAG_LABEL[id], reason, severity, stale });
    if (s.kind === "MGR" || s.kind === "FINAL") {
      const t = (c.cfg.holderThresholds as Dict)[s.kind]; const who = s.kind === "MGR" ? "Janelle" : "Katie";
      behind = hereBd - t.r;
      if (!synthetic && Math.round(hereBd * 10) / 10 > t.r) add("limbo", `With ${who} ${bdTxt(hereBd)} (limit ${t.r})`, 3);
    } else {
      const t = (c.cfg.thresholds as Dict)[s.code ?? ""] ?? (c.cfg.thresholds as Dict).UNMAPPED;
      behind = hereBd - t.r;
      if (!snoozed && !synthetic && hereBd > t.r) add("overTarget", `${bdTxt(hereBd)} in ${subStageName("QUEUE", s.code).toLowerCase()} (target ${t.r})`, 2);
    }
    // Only status changes are in the activity history (notes and call logs are not), so this says "no status change".
    // Escalated patients are covered by the limbo flag (their last action IS the hand-off), so they are not double-counted here.
    // Not in queues that wait on a payer, provider or patient: no status change is expected there while waiting (bench pass 3 #2).
    const extWait = s.kind === "QUEUE" && !String((c.cfg.waitingOn as Dict)[s.code ?? ""] ?? "us").startsWith("us");
    if (!snoozed && s.kind === "QUEUE" && !extWait && touchedBd > F.untouchedBd) add("untouched", `No status change in ${bdTxt(touchedBd)}`, touchedBd > 2 * F.untouchedBd ? 3 : 2);
    if (it.boardKey === "MN" && s.kind === "QUEUE" && ["1.1.2.3", "1.1.2.4F", "1.1.2.4P"].includes(s.code ?? "") && (at.mnCounter === "escalated" || (typeof at.mnCounter === "number" && at.mnCounter >= F.mnFollowUpsNoProgress)))
      add("attempts", `${at.mnCounter === "escalated" ? "Follow-ups used up" : `${at.mnCounter} follow-ups`} and still no records`, 2);
    if (it.boardKey === "INS" && at.insDenials >= F.insDenialsRepeat) add("attempts", `Denied by insurance ${at.insDenials} times`, 2);
    if ((b?.trips ?? 0) >= 2) add("bouncing", `Sent to escalation ${b!.trips} times and back`, 2);
    // Data that doesn't add up.
    if (it.boardKey === "MN" && typeof at.mnCounter === "number" && at.mnLogged > 0 && at.mnLogged !== at.mnCounter) add("data", `Follow-up counter says ${at.mnCounter}, but ${at.mnLogged} ${at.mnLogged === 1 ? "is" : "are"} written down`, 1);
    if (it.boardKey === "MN" && at.mnCounter != null && ["1.1.2.1", "1.1.2.2"].includes(s.code ?? "")) add("data", "Follow-ups recorded, but the records request hasn't been sent yet", 1);
    const intake = (it.values["date_mm1wf43j"]?.date as string | null | undefined) ?? null;
    const firstStage = evs.find((e) => e.columnId === (c.cfg.stageColumn as Dict)[it.boardKey]);
    if (intake && firstStage && firstStage.atMs < Date.parse(`${intake}T00:00:00-05:00`) - DAY)
      add("data", `Stage changes start ${fmtDate(firstStage.atMs)}, before the intake date ${fmtDate(Date.parse(`${intake}T12:00:00-05:00`))}`, 1);
    if (mismatch.has(k)) add("data", "Current status doesn't match its logged history", 1);
    // Journey checks: already further along on a later board, or a duplicate item for the same patient.
    // Skipped for items younger than dataCheckMinAgeBd (a normal hand-off can take a few hours), bench design pass 2 N6.
    const j = journeyOf.get(k);
    const oldEnough = c.bh(it.createdAtMs, c.now) / 24 >= F.dataCheckMinAgeBd;
    if (j && oldEnough) {
      const order = ["INT", "MN", "INS", "WC"]; const mine = order.indexOf(it.boardKey);
      const later = order.slice(mine + 1).map((bk) => j.primary[bk as "MN"]).find((x) => x && c.bh(x.createdAtMs, c.now) / 24 >= F.dataCheckMinAgeBd);
      // A later board item that ended as a dead lead (Stuck) before this item was worked again is a revival, not an error (red-team pass 9).
      const laterSpan = later ? c.current.get(key(later.boardKey, later.itemId)) : undefined;
      const revived = !!laterSpan && laterSpan.kind === "STUCK" && (evs[evs.length - 1]?.atMs ?? 0) > laterSpan.startMs;
      if (later && !revived) add("data", `Still open here, but already in ${stepName(later.boardKey)} since ${fmtDate(later.createdAtMs)}`, 1, true);
      else if (j.releaseMs) add("data", `Still open here, but released on ${fmtDate(j.releaseMs)}`, 1, true);
      const dup = j.duplicates.filter((x) => x.boardKey === it.boardKey && x.itemId !== it.itemId).length + (j.primary[it.boardKey as "MN"] && j.primary[it.boardKey as "MN"]!.itemId !== it.itemId ? 1 : 0);
      if (dup) add("data", `${dup + 1} ${stepName(it.boardKey)} items for the same patient`, 1, true);
    }
    // Stage went backwards (a later sub-stage, then an earlier one), other than the planned denial → remediation path.
    if (oldEnough) { const order = c.cfg.codeOrder as Record<string, number>; const qs = spans.filter((x) => x.kind === "QUEUE" && x.code && !x.startBulk);
      for (let i = 1; i < qs.length; i++) { const a = qs[i - 1], b2 = qs[i];
        if ((order[b2.code!] ?? 0) < (order[a.code!] ?? 0) && !F.plannedBackward.some(([x, y]) => x === a.code && y === b2.code)) { add("data", `Went back from "${subStageName("QUEUE", a.code)}" to "${subStageName("QUEUE", b2.code)}" on ${fmtDate(b2.startMs)}`, 1); break; } } }
    // A patient already further along (or released, or duplicated) is clean-up, not late work: keep only the data flags.
    if (flags.some((f) => f.stale)) { for (let x = flags.length - 1; x >= 0; x--) if (flags[x].id !== "data") flags.splice(x, 1); behind = 0; }
    flags.sort((a, b2) => b2.severity - a.severity);
    let warn = warningFor(c, it, s.kind, s.code, hereBd, synthetic, snoozed, evs, at);
    // Clean-up patients (already further along / released / duplicated) are not late work: same rule as the flags (one count everywhere).
    if (flags.some((f) => f.stale)) warn = { ...warn, state: "ok", timeState: "ok", attempts: warn.attempts ? { ...warn.attempts, state: "ok" } : null };
    rows.push({ ref: { boardKey: it.boardKey, itemId: it.itemId }, key: k, board: it.boardKey, step: stepName(it.boardKey), sub: subStageName(s.kind, s.code), kind: s.kind, code: s.code,
      stageBd: c.bh(spans[0].startMs, c.now) / 24,
      lastKey: lastEv ? `${it.boardKey}:${lastEv.columnId}:${lastEv.toIndex}` : null, referralMs: j?.arrivalMs ?? it.createdAtMs,
      owner, ownerKeys, bucket: s.kind === "MGR" || s.kind === "FINAL" ? s.kind : null, hereBd, hereSinceMs: hereStart, synthetic, last, touchedBd, attempts: at.text, flags, behindBd: behind,
      trips: b?.trips ?? 0, escalatedBd: b?.escalatedEpisodeBd ?? 0, snoozed, snoozedBounded: snoozed && (() => { const rules = (c.cfg.snooze as Dict)[it.boardKey]; const ds = rules ? it.values[rules.dateCol]?.date : null; return !!ds && c.bh(c.now, Date.parse(`${ds}T12:00:00-05:00`)) / 24 <= c.cfg.ball.maxDateAheadBd; })(), warn });
  }
  // Most behind first: worst flag, then how far past target, then how long untouched.
  const top = (r: PatientRow) => r.flags.filter((f) => f.id !== "data")[0]?.severity ?? 0;
  return rows.sort((a, b) => top(b) - top(a) || b.behindBd - a.behindBd || b.touchedBd - a.touchedBd);
}
/** Falling behind = any flag except "doesn't add up" (one definition for the Overview, strip, lists and tests). */
export const isBehind = (r: PatientRow) => r.flags.some((f) => f.id !== "data");
/** Open on an earlier board while already further along, released, or duplicated: clean-up, not late work. */
export const isStale = (r: PatientRow) => r.flags.some((f) => f.stale);
export const bucketLabel = (b: "MGR" | "FINAL" | null) => (b ? BUCKET[b] : "—");

/** History log for one item: holder blocks with the actions inside them, gaps and repeats marked. */
export interface HistoryEvent { phrase: string; atMs: number; who: string; bulk: boolean; gapBeforeBd: number }
export interface HistoryBlock { label: string; owner: string; kind: string; code: string | null; startMs: number; endMs: number | null; days: number; synthetic: boolean; visit: number; events: HistoryEvent[]; quietBd: number; notes: string[] }
export function patientHistory(c: Ctx, k: string): HistoryBlock[] {
  const spans = c.spansByItem.get(k) ?? []; const evs = eventsByItem(c).get(k) ?? []; const live = liveOwners(c.snap.access, c.cfg); const F = c.cfg.patientFlags;
  const seen = new Map<string, number>();
  return spans.map((s: HolderSpan, i) => {
    const end = s.endMs ?? c.now; const sk = s.kind === "QUEUE" ? `Q:${s.code}` : s.kind; const visit = (seen.get(sk) ?? 0) + 1; seen.set(sk, visit);
    // Each event belongs to the block that was open when it happened (60 s tolerance for the event that opened it).
    const from = i === 0 ? -Infinity : s.startMs - 60000; const to = i === spans.length - 1 ? Infinity : spans[i + 1].startMs - 60000;
    const inside = evs.filter((e) => e.atMs >= from && e.atMs < to);
    let prev = s.startMs; let quiet = 0;
    const events: HistoryEvent[] = inside.map((e) => { const g = c.bh(prev, e.atMs) / 24; quiet = Math.max(quiet, g); prev = e.atMs;
      return { phrase: actionPhrase(e.boardKey, e.columnId, e.toIndex, e.toText, e.toNum), atMs: e.atMs, who: whoDid(c, e.userId), bulk: e.bulk, gapBeforeBd: g }; });
    quiet = Math.max(quiet, c.bh(prev, end) / 24);
    const procs = s.kind === "QUEUE" ? (live[s.code ?? ""] ?? []).filter((x) => tierOf(x, c.cfg) === "processor").map((x) => personByKey(x, c.cfg)?.name ?? x) : [];
    const notes: string[] = [];
    // Repeats are marked only when they are not a normal step back (config plannedBackward), so routine re-evaluation stays quiet.
    const prevQ = [...spans.slice(0, i)].reverse().find((x) => x.kind === "QUEUE");
    const planned = s.kind === "QUEUE" && prevQ && F.plannedBackward.some(([a, b2]) => a === prevQ.code && b2 === s.code);
    if (visit > 1 && s.kind !== "EXITED" && !planned) notes.push(s.kind === "MGR" || s.kind === "FINAL" ? `Escalated again (${visit === 2 ? "2nd" : visit === 3 ? "3rd" : `${visit}th`} time)` : `Back here again (${visit === 2 ? "2nd" : visit === 3 ? "3rd" : `${visit}th`} time)`);
    if (quiet > F.untouchedBd && s.kind !== "STUCK" && s.kind !== "EXITED") notes.push(`${bdTxt(quiet)} with no status change`);
    if (s.synthetic) notes.push("Start date unknown (before our history begins)");
    return { label: s.kind === "QUEUE" ? `${stepName(s.boardKey)} · ${subStageName("QUEUE", s.code)}` : subStageName(s.kind, null), kind: s.kind, code: s.code,
      owner: s.kind === "MGR" ? "Janelle" : s.kind === "FINAL" ? "Katie" : procs.join(", "), startMs: s.startMs, endMs: s.endMs, days: c.bh(s.startMs, end) / 24, synthetic: s.synthetic, visit, events, quietBd: quiet, notes };
  });
}
