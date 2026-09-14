/**
 * Care Coordinator — "My Patients". The pure rules behind the three-column
 * dashboard the `scheduledCalls` role renders (CLAUDE.md §5.30).
 *
 * ⚠️ READ-ONLY OVER EXISTING COLUMNS. This module invents no board state: every
 * bucket below is derived from columns the stage pages already read, and the
 * page writes nothing to Monday except through the stage pages it links to.
 * Josh, 2026-09-08: "without changing ANY of the data and how we have it in
 * monday". A rule here that needs a new column is the wrong rule.
 *
 * Three populations, three sets of rules, deliberately kept apart because each
 * stage already has its own definition of "due" (the §5.8 counting contract):
 *
 *   - Intake        — Profile Send Off's DTC form groups. Who to CALL: a booked
 *                     Calendly call, or a form drop-off whose automated nudges
 *                     have finished. Ordered callbacks first, then longest-waiting.
 *   - Chase         — Medical Evaluation's Confirm Receipt + Chase Clinicals
 *                     stages, by Next Action Date, most overdue first — the
 *                     SAME due rule `useRoleCounts` applies (blank NAD = due,
 *                     future NAD = waiting, escalation 2 = gone, 0 = manager's).
 *   - Welcome Call  — the Welcome Call group, `Follow Up = "Done"` as the snooze
 *                     and `Escalation Required` as the manager flag, exactly as
 *                     `useRoleCounts` and `welcomeCall/sidebarList` read them.
 *
 * Everything takes `today` / `now` as arguments so the tests can walk a day
 * without touching the clock. Monday's dates are naive Eastern (§9); `created_at`
 * is a real UTC instant and is the one value compared as a timestamp.
 */
import { parseAttemptValue } from "@/lib/masheke/attemptLog";
import { isCrossSell, isFirstTimePumpUser } from "@/lib/welcomeCall/workflow";
import { minutesOfDay, type ScheduledCall } from "@/lib/scheduledCalls/workflow";

/* ── Constants that ARE the spec ────────────────────────────── */

/**
 * How long after a form is started before its patient lands in the calling
 * list. Corey's workflow: the intake form's own 30-minute and 24-hour nudges
 * run first (§5.24 — Drop-off Attempt counts exactly those two), and "2 days
 * later" the patient arrives in the rep's bucket.
 */
export const READY_AFTER_HOURS = 48;

/**
 * The stop rule. Five outbound attempts and the patient leaves the calling
 * list for the "exhausted" shelf — still visible, no longer ordered as work.
 * Read off the existing Attempt Counter (`numeric_mm5ze82q`), which every
 * intake attempt already bumps; nothing new is written to reach it.
 */
export const MAX_INTAKE_ATTEMPTS = 5;

/** Profile Send Off's Intake Escalation labels (mirrors masheke's index model). */
const INTAKE_ESCALATED_LABELS = new Set(["Manager Escalation Required", "Final Escalation Required"]);

/** Welcome Call board escalation — by INDEX since the board joined the
 *  Propose Stuck ladder (2026-09-14, §5.34; welcomeCall/mondayApi
 *  ESCALATION_INDEX), with the label texts as a belt-and-braces fallback for
 *  a row read without its raw value. Index 0 = with a manager (the board's
 *  own label still reads "Escalation Required"); index 2 = a stuck proposal
 *  awaiting Final Decisions — counted, never listed, like the chase column. */
const WC_ESCALATION_MANAGER = 0;
const WC_ESCALATION_FINAL = 2;
const WC_ESCALATED_LABELS = new Set(["Escalation Required", "Manager Escalation Required"]);
const WC_PROPOSED_STUCK_LABEL = "Final Escalation Required";

/** Medical Evaluation escalation indices (masheke/mondayMapping ESCALATION_INDEX). */
const ME_ESCALATION_MANAGER = 0;
const ME_ESCALATION_FINAL = 2;

export const CHASE_STAGES = ["Confirm Receipt", "Chase Clinicals"] as const;
export type ChaseStage = (typeof CHASE_STAGES)[number];

/* ── Records — the slim shapes the reads produce ─────────────── */

export interface IntakeLead {
  id: string;
  name: string;
  groupId: string;
  /** ISO instant from Monday's `created_at`. */
  createdAt: string;
  phone: string;
  email: string;
  /** Furthest form step reached ("Step 4 - Doctor", "Saved for later",
   *  "Completed"); BLANK means the patient never touched the DTC form. */
  dropOffStep: string;
  attemptCounter: string;
  dropOffAttempt: string;
  requestType: string;
  pumpNeed: string;
  reasonForInquiry: string;
  proceedPreference: string;
  /** Calendly mirror: "YYYY-MM-DD HH:mm" ET, or blank. */
  scheduledCallTime: string;
  bookingStatus: string;
  intakeCallComplete: string;
  intakeEscalation: string;
  referralType: string;
  referralSource: string;
  alreadyInSystem: string;
  followUp: string;
  followUpDate: string;
  dupCheckResult: string;
  state: string;
  generalInsurance: string;
  calendlyEventUri: string;
}

export interface ChaseItem {
  id: string;
  name: string;
  groupId: string;
  createdAt: string;
  phone: string;
  subStage: string;
  nextActionDate: string;
  /** Escalation status INDEX from the column's raw value; null when unset. */
  escalationIndex: number | null;
  escalation: string;
  mnAttempts: string;
  clinicalsMethod: string;
  doctorName: string;
  clinicName: string;
  requestSentAt: string;
  appointmentDate: string;
  dateOfIntake: string;
  confirmAttempts: [string, string, string];
  chaseAttempts: [string, string, string];
  receiptConfirmedName: string;
  requestType: string;
  serving: string;
}

export interface WelcomeCallItem {
  id: string;
  name: string;
  groupId: string;
  createdAt: string;
  phone: string;
  /** The join between a Calendly welcome-call booking and this chart — the
   *  schedule grid's "Open". Nothing else on this page reads it. */
  email: string;
  escalation: string;
  /** Raw Escalation index (0 manager · 1 done · 2 proposed stuck). Optional
   *  because fixtures predate it; `escalation` text is the fallback. */
  escalationIndex?: number | null;
  followUp: string;
  followUpDate: string;
  serving: string;
  requestType: string;
  pumpQty: string;
  ipLastBillDate: string;
  medicarePriorPumpDate: string;
  callAttempts: string;
  doctorName: string;
  primaryInsurance: string;
  referralReceivedDate: string;
}

/* ── Small shared helpers ────────────────────────────────────── */

const ymd = (v: string | null | undefined): string => (v ?? "").trim().slice(0, 10);

/** Whole days from `a` to `b` (YYYY-MM-DD each). Positive when b is later. */
export function daysBetween(a: string, b: string): number | null {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd(a));
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd(b));
  if (!pa || !pb) return null;
  // UTC noon on both sides so a DST boundary can't shave a day off.
  const ua = Date.UTC(+pa[1], +pa[2] - 1, +pa[3], 12);
  const ub = Date.UTC(+pb[1], +pb[2] - 1, +pb[3], 12);
  return Math.round((ub - ua) / 86_400_000);
}

/** Count as a number; blank/garbage/negative read 0 (same posture as
 *  profile/sidebarList `attemptCount`). */
export function toCount(raw: string | null | undefined): number {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** "1d 14h" · "9h" · "12m" · "just now". `ms` negative or NaN reads "just now". */
export function formatWait(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${m}m`;
}

/** Milliseconds since a Monday `created_at`, or 0 when unparseable. */
export function waitingMs(createdAt: string, nowMs: number): number {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? Math.max(0, nowMs - t) : 0;
}

/**
 * Days a patient has been with us, from the earliest date we hold: the board's
 * Date of Intake when the stage carries one, else the item's creation day
 * (ET). Display only.
 */
export function daysInPipeline(dateOfIntake: string, createdAt: string, today: string): number | null {
  const from = ymd(dateOfIntake) || createdDayEt(createdAt);
  if (!from) return null;
  const d = daysBetween(from, today);
  return d === null ? null : Math.max(0, d);
}

/** The ET calendar day of an ISO instant, YYYY-MM-DD. */
export function createdDayEt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(t));
}

/* ── Due labels (chase) ──────────────────────────────────────── */

export type DueKind = "overdue" | "today" | "tomorrow" | "upcoming" | "none";

export interface DueLabel {
  kind: DueKind;
  /** "2d overdue" · "Due today" · "Due tomorrow" · "Due in 3d" · "No date". */
  text: string;
  /** Days overdue (positive) — 0 unless `kind === "overdue"`. */
  daysOverdue: number;
}

/**
 * The Next Action Date relative to today.
 *
 * ⚠️ A BLANK date is due, not "none": `useRoleCounts` counts a blank NAD as due
 * (`if (nad && nad > todayStr) continue`), and the masheke hook backfills it to
 * today on its next poll. Reading blank as "no date, not urgent" would hide the
 * newest arrivals in the stage.
 */
export function dueLabel(nextActionDate: string, today: string): DueLabel {
  const nad = ymd(nextActionDate);
  if (!nad) return { kind: "today", text: "Due today · no date set", daysOverdue: 0 };
  const diff = daysBetween(nad, today); // positive ⇒ nad is in the past
  if (diff === null) return { kind: "none", text: "No date", daysOverdue: 0 };
  if (diff > 0) return { kind: "overdue", text: `${diff}d overdue`, daysOverdue: diff };
  if (diff === 0) return { kind: "today", text: "Due today", daysOverdue: 0 };
  if (diff === -1) return { kind: "tomorrow", text: "Due tomorrow", daysOverdue: 0 };
  return { kind: "upcoming", text: `Due in ${-diff}d`, daysOverdue: 0 };
}

/** "Attempt 1" … "Attempt 3", "Attempt 4+ · escalate" for the Escalate label,
 *  null when the column is blank (a fresh arrival — nothing to say yet). */
export function attemptLabel(mnAttempts: string): string | null {
  const v = (mnAttempts ?? "").trim();
  if (!v) return null;
  if (/^escalate$/i.test(v)) return "Attempt 4+ · escalate";
  return v;
}

/** Clinicals Method for display — blank counts as Fax, as every chase queue
 *  reads it (§5.9: "a missing method counts as fax so nobody falls through"). */
export function methodLabel(clinicalsMethod: string): string {
  const v = (clinicalsMethod ?? "").trim();
  return v || "Fax";
}

/** Which chase page works this patient — the §5.9 split, in one place. */
export function chaseRoute(item: Pick<ChaseItem, "subStage" | "clinicalsMethod">): string {
  if (item.subStage === "Confirm Receipt") return "/confirm-receipt";
  const cm = (item.clinicalsMethod ?? "").trim();
  return cm === "Parachute" || cm === "Email" ? "/chase-parachute" : "/chase-fax";
}

/**
 * The most recent attempt logged for the stage the patient is IN — the chase
 * columns for Chase Clinicals, the confirm-receipt columns for Confirm Receipt.
 * Both stages write "M/D/YY, h:mm PM · note —XX" into three per-attempt text
 * columns; the last non-empty one is what the coordinator needs to read before
 * she picks up the phone. Null when nothing has been logged.
 */
export function latestAttempt(item: Pick<ChaseItem, "subStage" | "confirmAttempts" | "chaseAttempts">):
  { attempt: number; date: string; note: string } | null {
  const cols = item.subStage === "Chase Clinicals" ? item.chaseAttempts : item.confirmAttempts;
  for (let i = cols.length - 1; i >= 0; i--) {
    const raw = (cols[i] ?? "").trim();
    if (!raw) continue;
    const chip = parseAttemptValue(i + 1, raw);
    return { attempt: chip.attempt, date: chip.date, note: chip.note };
  }
  return null;
}

/* ── Intake ──────────────────────────────────────────────────── */

export interface Booking {
  /** YYYY-MM-DD (ET). */
  date: string;
  /** HH:mm:ss, or "" when the column carried a date only. */
  time: string;
}

/** The live Calendly booking on a lead, or null (none, or canceled). */
export function liveBooking(lead: Pick<IntakeLead, "scheduledCallTime" | "bookingStatus">): Booking | null {
  const raw = (lead.scheduledCallTime ?? "").trim();
  if (!raw) return null;
  // A canceled call keeps its row and its time; showing it would have the
  // coordinator ring somebody who called off (lib/scheduledCalls/workflow).
  if ((lead.bookingStatus ?? "").trim().toLowerCase() === "canceled") return null;
  const [date, time = ""] = raw.split(/\s+/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, time: time ? (time.length === 5 ? `${time}:00` : time) : "" };
}

/** Did this patient ever touch the DTC form? The Drop-off Step is written by
 *  the form service and by nothing else, so a blank one means the row came in
 *  some other way — an import, a manual entry, a referral. */
export function isFormLead(lead: Pick<IntakeLead, "dropOffStep">): boolean {
  return (lead.dropOffStep ?? "").trim() !== "";
}

export function isIntakeEscalated(lead: Pick<IntakeLead, "intakeEscalation">): boolean {
  return INTAKE_ESCALATED_LABELS.has((lead.intakeEscalation ?? "").trim());
}

export type IntakeExclusion =
  | "imported"      // never touched the form — the DME / referral rows in the form groups
  | "callDone"      // Intake Call Complete = Yes
  | "sendNow"       // completed form, chose "Send request now" — no call wanted
  | "nurturing"     // inside the 48-hour automated window
  | "cleanUp";      // unbooked patient already in Profile Clean-Up — not a call

export interface ScheduledLead {
  lead: IntakeLead;
  booking: Booking;
  /** Minutes from now to the call; negative once it has started. Null when the
   *  booking is on another day or carries no time. */
  minutesUntil: number | null;
  /** upcoming today · happening now · passed today · another day. */
  when: "today-upcoming" | "today-now" | "today-passed" | "later";
}

export interface ReadyLead {
  lead: IntakeLead;
  waitingMs: number;
  attempts: number;
}

export interface IntakeBuckets {
  /** Booked calls, today and onward, in time order. Passed-today calls sink to
   *  the end of today's block rather than vanishing — a call the coordinator
   *  missed is still hers to make. */
  scheduled: ScheduledLead[];
  /** Form drop-offs whose nudges have run, no booking, under the attempt cap.
   *  Longest-waiting first. */
  ready: ReadyLead[];
  /** Hit the attempt cap. Kept visible, ordered most-recently-created first. */
  exhausted: ReadyLead[];
  /** Escalated to a manager (either rung). Not the coordinator's work. */
  withManager: IntakeLead[];
  /** Why the rest of the groups' rows are not on this screen. Counts only. */
  excluded: Record<IntakeExclusion, number>;
}

export interface IntakeContext {
  /** YYYY-MM-DD, ET. */
  today: string;
  /** Minutes past ET midnight. */
  nowMinutes: number;
  /** Epoch ms. */
  nowMs: number;
  /** The two DTC form groups — a READY lead must still be in one of them. */
  formGroupIds: readonly string[];
}

const NOW_BEFORE_MIN = 5;
const NOW_AFTER_MIN = 10;

/**
 * Sort the intake population into what the left column shows.
 *
 * The order of checks is the rule. A booking wins over everything but an
 * escalation (a booked call is a promise to the patient, whatever else the row
 * says); after that the exclusions are checked cheapest-fact-first so the count
 * a row lands in is the FIRST reason it isn't a call, not an arbitrary one.
 */
export function intakeBuckets(leads: IntakeLead[], ctx: IntakeContext): IntakeBuckets {
  const scheduled: ScheduledLead[] = [];
  const ready: ReadyLead[] = [];
  const exhausted: ReadyLead[] = [];
  const withManager: IntakeLead[] = [];
  const excluded: Record<IntakeExclusion, number> = {
    imported: 0, callDone: 0, sendNow: 0, nurturing: 0, cleanUp: 0,
  };
  const readyAfterMs = READY_AFTER_HOURS * 3_600_000;

  for (const lead of leads) {
    if (isIntakeEscalated(lead)) { withManager.push(lead); continue; }

    const booking = liveBooking(lead);
    if (booking && booking.date >= ctx.today) {
      const at = booking.time ? minutesOfDay(booking.time) : null;
      let when: ScheduledLead["when"] = "later";
      let minutesUntil: number | null = null;
      if (booking.date === ctx.today) {
        if (at === null) when = "today-upcoming";
        else {
          minutesUntil = at - ctx.nowMinutes;
          when = ctx.nowMinutes < at - NOW_BEFORE_MIN ? "today-upcoming"
            : ctx.nowMinutes <= at + NOW_AFTER_MIN ? "today-now"
            : "today-passed";
        }
      }
      scheduled.push({ lead, booking, minutesUntil, when });
      continue;
    }

    // From here down: nobody booked. Is this a patient to ring?
    if (!isFormLead(lead)) { excluded.imported++; continue; }
    if (!ctx.formGroupIds.includes(lead.groupId)) { excluded.cleanUp++; continue; }
    if ((lead.intakeCallComplete ?? "").trim().toLowerCase() === "yes") { excluded.callDone++; continue; }
    if (
      (lead.dropOffStep ?? "").trim().toLowerCase() === "completed" &&
      /send request now/i.test(lead.proceedPreference ?? "")
    ) { excluded.sendNow++; continue; }

    const waited = waitingMs(lead.createdAt, ctx.nowMs);
    const attempts = toCount(lead.attemptCounter);
    if (attempts >= MAX_INTAKE_ATTEMPTS) { exhausted.push({ lead, waitingMs: waited, attempts }); continue; }
    if (waited < readyAfterMs) { excluded.nurturing++; continue; }
    ready.push({ lead, waitingMs: waited, attempts });
  }

  scheduled.sort((a, b) => {
    if (a.booking.date !== b.booking.date) return a.booking.date < b.booking.date ? -1 : 1;
    // Within today, a passed call goes after the ones still to make.
    const pa = a.when === "today-passed" ? 1 : 0;
    const pb = b.when === "today-passed" ? 1 : 0;
    if (pa !== pb) return pa - pb;
    const ta = a.booking.time ? minutesOfDay(a.booking.time) : null;
    const tb = b.booking.time ? minutesOfDay(b.booking.time) : null;
    if (ta === null && tb === null) return a.lead.name.localeCompare(b.lead.name);
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb || a.lead.name.localeCompare(b.lead.name);
  });
  // Longest-waiting first — Corey's header text for this column, verbatim.
  ready.sort((a, b) => b.waitingMs - a.waitingMs || a.lead.name.localeCompare(b.lead.name));
  exhausted.sort((a, b) => a.waitingMs - b.waitingMs || a.lead.name.localeCompare(b.lead.name));

  return { scheduled, ready, exhausted, withManager, excluded };
}

/** How many ready leads nobody has rung yet. The column's alert pill. */
export function uncalledCount(ready: ReadyLead[]): number {
  return ready.filter((r) => r.attempts === 0).length;
}

/* ── Chase (Confirm Receipt + Chase Clinicals) ───────────────── */

export interface ChaseEntry {
  item: ChaseItem;
  due: DueLabel;
}

export interface ChaseBuckets {
  /** NAD today or earlier (or blank). Most overdue first. */
  due: ChaseEntry[];
  /** NAD in the future — snoozed on a date that brings them back. Soonest first. */
  upcoming: ChaseEntry[];
  /** A booked provider visit still ahead — parked until it happens (§5.12). */
  awaitingVisit: ChaseEntry[];
  /** Escalation index 0 — a manager's, not the coordinator's. */
  withManager: ChaseEntry[];
  /** Escalation index 2 — a stuck proposal awaiting Final Decisions. Count only. */
  proposedStuck: number;
}

export function isChaseStage(subStage: string): subStage is ChaseStage {
  return (CHASE_STAGES as readonly string[]).includes((subStage ?? "").trim());
}

/**
 * The middle column. Mirrors `useRoleCounts`' Medical Evaluation rule for the
 * two stages, then splits "not due" into its two honest reasons.
 */
export function chaseBuckets(items: ChaseItem[], today: string): ChaseBuckets {
  const due: ChaseEntry[] = [];
  const upcoming: ChaseEntry[] = [];
  const awaitingVisit: ChaseEntry[] = [];
  const withManager: ChaseEntry[] = [];
  let proposedStuck = 0;

  for (const item of items) {
    if (!isChaseStage(item.subStage)) continue;
    if (item.escalationIndex === ME_ESCALATION_FINAL) { proposedStuck++; continue; }
    const entry: ChaseEntry = { item, due: dueLabel(item.nextActionDate, today) };
    if (item.escalationIndex === ME_ESCALATION_MANAGER) { withManager.push(entry); continue; }
    const appt = ymd(item.appointmentDate);
    if (appt && appt >= today) { awaitingVisit.push(entry); continue; }
    if (entry.due.kind === "upcoming" || entry.due.kind === "tomorrow") { upcoming.push(entry); continue; }
    due.push(entry);
  }

  const byNad = (a: ChaseEntry, b: ChaseEntry) => {
    const na = ymd(a.item.nextActionDate) || "0000-00-00"; // blank = oldest, i.e. most urgent
    const nb = ymd(b.item.nextActionDate) || "0000-00-00";
    return na < nb ? -1 : na > nb ? 1 : a.item.name.localeCompare(b.item.name);
  };
  due.sort(byNad);
  upcoming.sort(byNad);
  awaitingVisit.sort((a, b) => (ymd(a.item.appointmentDate) < ymd(b.item.appointmentDate) ? -1 : 1));
  withManager.sort(byNad);

  return { due, upcoming, awaitingVisit, withManager, proposedStuck };
}

export function overdueCount(due: ChaseEntry[]): number {
  return due.filter((e) => e.due.kind === "overdue").length;
}

/* ── Welcome Call ────────────────────────────────────────────── */

export interface WelcomeCallEntry {
  item: WelcomeCallItem;
  firstTimePump: boolean;
  crossSell: boolean;
  attempts: number;
}

export interface WelcomeCallBuckets {
  /** Not snoozed, not escalated. Oldest arrival first. */
  callNow: WelcomeCallEntry[];
  /** Follow Up = "Done" — asleep, with a date when one was set. Soonest first,
   *  dateless last. */
  followUpLater: WelcomeCallEntry[];
  /** Escalation index 0 — the manager's (Manager Intervention). */
  withManager: WelcomeCallEntry[];
  /** Escalation index 2 — proposed stuck, awaiting a Final Decision in
   *  Oversight. Counted for the footer, never listed (the chase column's rule). */
  proposedStuck: number;
}

export function isWelcomeCallEscalated(item: Pick<WelcomeCallItem, "escalation" | "escalationIndex">): boolean {
  if (item.escalationIndex != null) return item.escalationIndex === WC_ESCALATION_MANAGER;
  return WC_ESCALATED_LABELS.has((item.escalation ?? "").trim());
}

export function isWelcomeCallProposedStuck(item: Pick<WelcomeCallItem, "escalation" | "escalationIndex">): boolean {
  if (item.escalationIndex != null) return item.escalationIndex === WC_ESCALATION_FINAL;
  return (item.escalation ?? "").trim() === WC_PROPOSED_STUCK_LABEL;
}

export function welcomeCallBuckets(items: WelcomeCallItem[]): WelcomeCallBuckets {
  const callNow: WelcomeCallEntry[] = [];
  const followUpLater: WelcomeCallEntry[] = [];
  const withManager: WelcomeCallEntry[] = [];
  let proposedStuck = 0;

  for (const item of items) {
    const entry: WelcomeCallEntry = {
      item,
      firstTimePump: isFirstTimePumpUser(item),
      crossSell: isCrossSell(item),
      attempts: toCount(item.callAttempts),
    };
    if (isWelcomeCallProposedStuck(item)) { proposedStuck++; continue; }
    if (isWelcomeCallEscalated(item)) { withManager.push(entry); continue; }
    if ((item.followUp ?? "").trim() === "Done") { followUpLater.push(entry); continue; }
    callNow.push(entry);
  }

  const byCreated = (a: WelcomeCallEntry, b: WelcomeCallEntry) =>
    (Date.parse(a.item.createdAt) || 0) - (Date.parse(b.item.createdAt) || 0) ||
    a.item.name.localeCompare(b.item.name);
  callNow.sort(byCreated);
  withManager.sort(byCreated);
  followUpLater.sort((a, b) => {
    const da = ymd(a.item.followUpDate);
    const db = ymd(b.item.followUpDate);
    if (!da && !db) return byCreated(a, b);
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : da > db ? 1 : byCreated(a, b);
  });

  return { callNow, followUpLater, withManager, proposedStuck };
}

/* ── The header ──────────────────────────────────────────────── */

export interface Summary {
  total: number;
  intake: number;
  chase: number;
  welcome: number;
  overdue: number;
  escalated: number;
}

/**
 * The chips across the top. "Total in pipeline" is the work the coordinator
 * can pick up — booked or ready intake calls, every un-escalated chase patient
 * (due or snoozed), every un-escalated Welcome Call patient. Escalated
 * patients are counted separately: they are on screen, but they are a
 * manager's to move.
 */
export function summarize(intake: IntakeBuckets, chase: ChaseBuckets, welcome: WelcomeCallBuckets): Summary {
  const intakeN = intake.scheduled.length + intake.ready.length;
  const chaseN = chase.due.length + chase.upcoming.length + chase.awaitingVisit.length;
  const welcomeN = welcome.callNow.length + welcome.followUpLater.length;
  return {
    total: intakeN + chaseN + welcomeN,
    intake: intakeN,
    chase: chaseN,
    welcome: welcomeN,
    overdue: overdueCount(chase.due),
    escalated: intake.withManager.length + chase.withManager.length + welcome.withManager.length,
  };
}

/* ── The schedule grid's input ───────────────────────────────── */

/**
 * An intake lead as the day grid's `ScheduledCall`, so the grid can be fed
 * from the same read as the column rather than a second read of the same
 * three groups. Mirrors `lib/scheduledCalls/mondayApi.ts` `toScheduledCall`
 * field-for-field — canceled bookings are passed THROUGH (the grid's own
 * `isLiveBooking` drops them), so the two renderings can't disagree.
 */
export function toScheduledCall(lead: IntakeLead): ScheduledCall {
  const raw = (lead.scheduledCallTime ?? "").trim();
  const [date = "", time = ""] = raw ? raw.split(/\s+/) : ["", ""];
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    callDate: date,
    callTime: time ? (time.length === 5 ? `${time}:00` : time) : "",
    bookingStatus: lead.bookingStatus,
    reason: lead.reasonForInquiry,
    requestType: lead.requestType,
    generalInsurance: lead.generalInsurance,
    state: lead.state,
    calendlyEventUri: lead.calendlyEventUri,
  };
}
