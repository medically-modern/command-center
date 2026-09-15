/**
 * Care Coordinator — "My Patients". The pure rules behind the two-column
 * dashboard the `scheduledCalls` role renders (CLAUDE.md §5.30).
 *
 * Rewritten 2026-09-14 to Brandon's notes ("Notes for masani dashboard
 * (9/14/26)"). The shape is now ONE model on both columns:
 *
 *     Today   → Scheduled · Unscheduled
 *     Future  → Scheduled · Unscheduled
 *
 * SCHEDULED is a booked call. On intake that is the Calendly mirror on the
 * patient's Profile Send Off row (§5.15); on Welcome Call it is Calendly
 * itself, read through the gateway and joined by email (§5.31e), because the
 * Welcome Call board has no booking column. Today vs Future is the booking's
 * Eastern day.
 *
 * UNSCHEDULED is everybody else the coordinator can call. Today vs Future is
 * the FOLLOW-UP DATE: an attempt pushes it forward (one calendar day, exactly
 * as the Welcome Call +1 does — `followUp.ts`), the patient sits in Future
 * until the date arrives and then comes back to Today on their own. Nothing
 * ages out; nothing needs clearing.
 *
 * ⚠️ On Patient Intake this reads ONLY the Follow Up DATE column
 * (`date_mm3874an`). The Follow Up STATUS beside it is the flag every intake
 * list uses to decide who is active, and writing it is the one-way door Josh
 * removed on 2026-08-13 (§5.10). The intake attempt writer never touches the
 * status — `followUp.test.ts` scans for it — so the intake page, its role
 * count and both baselines are exactly as they were; only this dashboard reads
 * the date. On Welcome Call the stage page's own snooze (Follow Up = Done +
 * date) is read as-is; that page still hides a Done patient until cleared
 * while this one wakes them on the date (a known, documented mismatch — Josh
 * chose "dashboard only", 2026-09-14).
 *
 * Escalated patients are COUNTED here and listed nowhere: Brandon — "this user
 * should not see this — but they should go to a manager view". They are in
 * Oversight's Manager Intervention / Final Decisions columns (§7, §5.34).
 *
 * Everything takes `today` / `now` as arguments so the tests can walk a day
 * without touching the clock. Monday's dates are naive Eastern (§9);
 * `created_at` is a real UTC instant and is the one value compared as a
 * timestamp.
 */
import { parseAttemptValue } from "@/lib/masheke/attemptLog";
import { isCrossSell, isFirstTimePumpUser } from "@/lib/welcomeCall/workflow";
import { minutesOfDay, type ScheduledCall } from "@/lib/scheduledCalls/workflow";
import type { WelcomeCallBooking } from "@/lib/welcomeCall/calendlyBooking";
import { etPartsOf } from "./scheduleEntries";

/* ── Constants that ARE the spec ────────────────────────────── */

/**
 * How long after a form is started before its patient lands in the calling
 * list. Corey's workflow: the intake form's own 30-minute and 24-hour nudges
 * run first (§5.24 — Drop-off Attempt counts exactly those two), and "2 days
 * later" the patient arrives in the rep's bucket.
 */
export const READY_AFTER_HOURS = 48;

/** Profile Send Off's Intake Escalation labels (mirrors masheke's index model). */
const INTAKE_ESCALATED_LABELS = new Set(["Manager Escalation Required", "Final Escalation Required"]);

/** Welcome Call board escalation — by INDEX since the board joined the
 *  Propose Stuck ladder (2026-09-14, §5.34; welcomeCall/mondayApi
 *  ESCALATION_INDEX), with the label texts as a belt-and-braces fallback for
 *  a row read without its raw value. Index 0 = with a manager (the board's
 *  own label still reads "Escalation Required"); index 2 = a stuck proposal
 *  awaiting Final Decisions — counted, never listed. */
const WC_ESCALATION_MANAGER = 0;
const WC_ESCALATION_FINAL = 2;
const WC_ESCALATED_LABELS = new Set(["Escalation Required", "Manager Escalation Required"]);
const WC_PROPOSED_STUCK_LABEL = "Final Escalation Required";

/** Medical Evaluation escalation indices (masheke/mondayMapping ESCALATION_INDEX). */
const ME_ESCALATION_MANAGER = 0;
const ME_ESCALATION_FINAL = 2;

export const CHASE_STAGES = ["Confirm Receipt", "Chase Clinicals"] as const;
export type ChaseStage = (typeof CHASE_STAGES)[number];

/** The intake form's automated nudges are exactly two (§5.24). */
export const MAX_AUTO_TEXTS = 2;

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
  /** Follow Up Date `date_mm3874an` — the ONLY snooze this dashboard reads on
   *  intake. Pushed by a logged attempt; read by nothing else on the board. */
  followUpDate: string;
  dupCheckResult: string;
  state: string;
  generalInsurance: string;
  calendlyEventUri: string;
  /** What the PATIENT typed on the form — never the verified doctor (§5.20). */
  providedDoctorName: string;
  providedClinicPhone: string;
  ipCoveragePath: string;
  cgmCoveragePath: string;
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
  /** The join between a Calendly welcome-call booking and this chart. */
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
  /** Pump "SoS Last Bill" (YYYY-MM-DD or ""), named for `isFirstTimePumpUser`. */
  ipLastBillDate: string;
  medicarePriorPumpDate: string;
  callAttempts: string;
  doctorName: string;
  primaryInsurance: string;
  referralReceivedDate: string;
  referralSource: string;
  ipCoveragePath: string;
  cgmCoveragePath: string;
  doctorPhone: string;
  clinicName: string;
  clinicAddress: string;
  /** Welcome Call Text trigger `color_mm1xtqvv` — "Send" once pressed. The
   *  board has no text counter, so this is the one board fact about texts. */
  welcomeCallText: string;
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

/**
 * "Days since intake" for the card — Brandon: "don't need hours, can just put
 * <1 day". Whole ET days since the row was created.
 */
export function formatDaysSince(createdAt: string, today: string): string {
  const d = daysInPipeline("", createdAt, today);
  if (d === null) return "—";
  if (d < 1) return "<1 day";
  return d === 1 ? "1 day" : `${d} days`;
}

/** `MM/DD` from YYYY-MM-DD, without letting a UTC parse shift the day. */
export function shortMonthDay(ymdStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymdStr ?? "");
  return m ? `${m[2]}/${m[3]}` : ymdStr || "—";
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

/* ── The shared Today / Future model ─────────────────────────── */

export type Horizon = "today" | "future";

export type ScheduledWhen = "today-upcoming" | "today-now" | "today-passed" | "later";

/** A booked call on either column. */
export interface ScheduledEntry<T> {
  item: T;
  /** YYYY-MM-DD (ET). */
  date: string;
  /** HH:mm:ss, or "" when only a day is known. */
  time: string;
  /** Minutes from now to the call; negative once it has started. Null when the
   *  booking is on another day or carries no time. */
  minutesUntil: number | null;
  when: ScheduledWhen;
  /** The Calendly booking behind a Welcome Call entry — carries the
   *  reschedule link. Intake entries have the monday mirror instead. */
  booking?: WelcomeCallBooking;
}

/** A patient to ring, on either column. */
export interface UnscheduledEntry<T> {
  item: T;
  attempts: number;
  /** YYYY-MM-DD, or "" when nothing has pushed them. */
  followUpDate: string;
  /** Days the follow-up date is already past. 0 when due today or undated. */
  overdueDays: number;
  waitingMs: number;
}

export interface ColumnBuckets<T> {
  scheduledToday: ScheduledEntry<T>[];
  scheduledFuture: ScheduledEntry<T>[];
  unscheduledToday: UnscheduledEntry<T>[];
  unscheduledFuture: UnscheduledEntry<T>[];
  /** Escalated — a manager's. Counted for the footer, never listed. */
  withManager: number;
}

export interface BucketContext {
  /** YYYY-MM-DD, ET. */
  today: string;
  /** Minutes past ET midnight. */
  nowMinutes: number;
  /** Epoch ms. */
  nowMs: number;
}

const NOW_BEFORE_MIN = 5;
const NOW_AFTER_MIN = 10;

/** Where a booking sits relative to now. Shared by both columns. */
export function classifyBooking(
  date: string, time: string, ctx: Pick<BucketContext, "today" | "nowMinutes">,
): { when: ScheduledWhen; minutesUntil: number | null } {
  if (date !== ctx.today) return { when: "later", minutesUntil: null };
  const at = time ? minutesOfDay(time) : null;
  if (at === null) return { when: "today-upcoming", minutesUntil: null };
  const minutesUntil = at - ctx.nowMinutes;
  const when: ScheduledWhen =
    ctx.nowMinutes < at - NOW_BEFORE_MIN ? "today-upcoming"
    : ctx.nowMinutes <= at + NOW_AFTER_MIN ? "today-now"
    : "today-passed";
  return { when, minutesUntil };
}

/**
 * Which grouping a follow-up date puts the patient in.
 *
 * A date in the future ⇒ Future; today, past, or NO date ⇒ Today. Blank is
 * Today on purpose: nothing will bring a dateless patient back on its own, so
 * the only honest place for them is the list somebody is working (§7's
 * nothing-is-invisible rule).
 */
export function followUpHorizon(followUpDate: string, today: string): { horizon: Horizon; overdueDays: number } {
  const d = ymd(followUpDate);
  if (!d) return { horizon: "today", overdueDays: 0 };
  const diff = daysBetween(d, today); // positive ⇒ the date is past
  if (diff === null) return { horizon: "today", overdueDays: 0 };
  if (diff < 0) return { horizon: "future", overdueDays: 0 };
  return { horizon: "today", overdueDays: diff };
}

function byBookingTime<T>(a: ScheduledEntry<T>, b: ScheduledEntry<T>, name: (t: T) => string): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  // Within today, a passed call goes after the ones still to make.
  const pa = a.when === "today-passed" ? 1 : 0;
  const pb = b.when === "today-passed" ? 1 : 0;
  if (pa !== pb) return pa - pb;
  const ta = a.time ? minutesOfDay(a.time) : null;
  const tb = b.time ? minutesOfDay(b.time) : null;
  if (ta === null && tb === null) return name(a.item).localeCompare(name(b.item));
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta - tb || name(a.item).localeCompare(name(b.item));
}

/** The scheduled call "up next" — first of today's still to make. Its card
 *  is shaded darker. Null when every call today has passed. */
export function nextUp<T>(scheduledToday: ScheduledEntry<T>[]): ScheduledEntry<T> | null {
  return scheduledToday.find((e) => e.when !== "today-passed") ?? null;
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

export interface IntakeBuckets extends ColumnBuckets<IntakeLead> {
  /** Why the rest of the groups' rows are not on this screen. Counts only. */
  excluded: Record<IntakeExclusion, number>;
}

export interface IntakeContext extends BucketContext {
  /** The two DTC form groups — an UNSCHEDULED lead must still be in one. */
  formGroupIds: readonly string[];
}

/** Automated nudges actually sent — the form's 30-minute and 24-hour texts,
 *  clamped as the backend clamps them (§5.24). */
export function autoTexts(lead: Pick<IntakeLead, "dropOffAttempt">): number {
  return Math.min(toCount(lead.dropOffAttempt), MAX_AUTO_TEXTS);
}

/** "Completed" / "Partial" from the GROUP the form left the row in — not the
 *  Drop-off Step, which deliberately keeps saying where the PATIENT stopped
 *  even after a rep finishes the form by phone (§5.24). Null off the form
 *  groups (a booked patient already in Clean-Up). */
export function formCompletion(
  lead: Pick<IntakeLead, "groupId">,
  groups: { partial: string; completed: string },
): "Completed" | "Partial" | null {
  if (lead.groupId === groups.completed) return "Completed";
  if (lead.groupId === groups.partial) return "Partial";
  return null;
}

/**
 * Sort the intake population into the column's four lists.
 *
 * The order of checks is the rule. An escalation wins over everything (a
 * manager's, listed nowhere here); then a booking wins over every exclusion
 * (a booked call is a promise to the patient, whatever else the row says);
 * after that the exclusions are checked cheapest-fact-first so the count a row
 * lands in is the FIRST reason it isn't a call, not an arbitrary one.
 */
export function intakeBuckets(leads: IntakeLead[], ctx: IntakeContext): IntakeBuckets {
  const scheduledToday: ScheduledEntry<IntakeLead>[] = [];
  const scheduledFuture: ScheduledEntry<IntakeLead>[] = [];
  const unscheduledToday: UnscheduledEntry<IntakeLead>[] = [];
  const unscheduledFuture: UnscheduledEntry<IntakeLead>[] = [];
  let withManager = 0;
  const excluded: Record<IntakeExclusion, number> = {
    imported: 0, callDone: 0, sendNow: 0, nurturing: 0, cleanUp: 0,
  };
  const readyAfterMs = READY_AFTER_HOURS * 3_600_000;

  for (const lead of leads) {
    if (isIntakeEscalated(lead)) { withManager++; continue; }

    const booking = liveBooking(lead);
    if (booking && booking.date >= ctx.today) {
      const { when, minutesUntil } = classifyBooking(booking.date, booking.time, ctx);
      const entry: ScheduledEntry<IntakeLead> = { item: lead, date: booking.date, time: booking.time, when, minutesUntil };
      (booking.date === ctx.today ? scheduledToday : scheduledFuture).push(entry);
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
    // The automated window only applies before anybody has rung them — a
    // patient a rep already called is already being worked.
    if (attempts === 0 && waited < readyAfterMs) { excluded.nurturing++; continue; }

    const { horizon, overdueDays } = followUpHorizon(lead.followUpDate, ctx.today);
    const entry: UnscheduledEntry<IntakeLead> = {
      item: lead, attempts, followUpDate: ymd(lead.followUpDate), overdueDays, waitingMs: waited,
    };
    (horizon === "today" ? unscheduledToday : unscheduledFuture).push(entry);
  }

  const name = (l: IntakeLead) => l.name;
  scheduledToday.sort((a, b) => byBookingTime(a, b, name));
  scheduledFuture.sort((a, b) => byBookingTime(a, b, name));
  // Today: most overdue first, then longest-waiting — the header's own rule.
  unscheduledToday.sort((a, b) =>
    b.overdueDays - a.overdueDays || b.waitingMs - a.waitingMs || a.item.name.localeCompare(b.item.name));
  // Future: soonest date first.
  unscheduledFuture.sort((a, b) =>
    (a.followUpDate < b.followUpDate ? -1 : a.followUpDate > b.followUpDate ? 1 : 0) ||
    b.waitingMs - a.waitingMs || a.item.name.localeCompare(b.item.name));

  return { scheduledToday, scheduledFuture, unscheduledToday, unscheduledFuture, withManager, excluded };
}

/* ── Chase (Confirm Receipt + Chase Clinicals) — kept for the day the column
 *    comes back; not rendered since 2026-09-10 and not part of the 2026-09-14
 *    redesign. ──────────────────────────────────────────────── */

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
 * Mirrors `useRoleCounts`' Medical Evaluation rule for the two stages, then
 * splits "not due" into its two honest reasons.
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

export interface WelcomeCallFlags {
  firstTimePump: boolean;
  crossSell: boolean;
}

export interface WelcomeCallBuckets extends ColumnBuckets<WelcomeCallItem> {
  /** Escalation index 2 — proposed stuck, awaiting a Final Decision in
   *  Oversight. Counted for the footer, never listed. */
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

export function welcomeCallFlags(item: WelcomeCallItem): WelcomeCallFlags {
  return { firstTimePump: isFirstTimePumpUser(item), crossSell: isCrossSell(item) };
}

/** The one board fact about texts on this board: 1 once the Welcome Call
 *  Text trigger has been pressed, else 0 (Josh, 2026-09-14). */
export function welcomeCallTexts(item: Pick<WelcomeCallItem, "welcomeCallText">): number {
  return (item.welcomeCallText ?? "").trim() ? 1 : 0;
}

/**
 * Welcome-call bookings by invitee email, from the gateway's Calendly window
 * (§5.31e). `null` for an address with nothing booked. A patient whose
 * address is not in the map is treated as unbooked — so the caller must
 * only pass a map from a SUCCESSFUL read, and say so on screen otherwise
 * (a failed read is not "nobody is booked").
 */
export type WelcomeBookingMap = ReadonlyMap<string, WelcomeCallBooking | null>;

const emailKey = (e: string) => (e ?? "").trim().toLowerCase();

export function welcomeCallBuckets(
  items: WelcomeCallItem[],
  ctx: BucketContext,
  bookings: WelcomeBookingMap = new Map(),
): WelcomeCallBuckets {
  const scheduledToday: ScheduledEntry<WelcomeCallItem>[] = [];
  const scheduledFuture: ScheduledEntry<WelcomeCallItem>[] = [];
  const unscheduledToday: UnscheduledEntry<WelcomeCallItem>[] = [];
  const unscheduledFuture: UnscheduledEntry<WelcomeCallItem>[] = [];
  let withManager = 0;
  let proposedStuck = 0;

  for (const item of items) {
    if (isWelcomeCallProposedStuck(item)) { proposedStuck++; continue; }
    if (isWelcomeCallEscalated(item)) { withManager++; continue; }

    const booking = bookings.get(emailKey(item.email)) ?? null;
    if (booking) {
      // Calendly gives a real UTC instant; the grid and the lists are naive
      // Eastern, so convert ONCE here (§5.15's inversion — see scheduleEntries).
      const { date, time } = etPartsOf(booking.startTime);
      if (date && date >= ctx.today) {
        const { when, minutesUntil } = classifyBooking(date, time, ctx);
        const entry: ScheduledEntry<WelcomeCallItem> = { item, date, time, when, minutesUntil, booking };
        (date === ctx.today ? scheduledToday : scheduledFuture).push(entry);
        continue;
      }
    }

    const snoozed = (item.followUp ?? "").trim() === "Done";
    const { horizon, overdueDays } = followUpHorizon(snoozed ? item.followUpDate : "", ctx.today);
    const entry: UnscheduledEntry<WelcomeCallItem> = {
      item, attempts: toCount(item.callAttempts),
      followUpDate: snoozed ? ymd(item.followUpDate) : "",
      overdueDays, waitingMs: waitingMs(item.createdAt, ctx.nowMs),
    };
    (horizon === "today" ? unscheduledToday : unscheduledFuture).push(entry);
  }

  const name = (w: WelcomeCallItem) => w.name;
  scheduledToday.sort((a, b) => byBookingTime(a, b, name));
  scheduledFuture.sort((a, b) => byBookingTime(a, b, name));
  // Oldest arrival first, overdue snoozes ahead of the rest.
  const byCreated = (a: UnscheduledEntry<WelcomeCallItem>, b: UnscheduledEntry<WelcomeCallItem>) =>
    (Date.parse(a.item.createdAt) || 0) - (Date.parse(b.item.createdAt) || 0) ||
    a.item.name.localeCompare(b.item.name);
  unscheduledToday.sort((a, b) => b.overdueDays - a.overdueDays || byCreated(a, b));
  unscheduledFuture.sort((a, b) =>
    (a.followUpDate < b.followUpDate ? -1 : a.followUpDate > b.followUpDate ? 1 : 0) || byCreated(a, b));

  return { scheduledToday, scheduledFuture, unscheduledToday, unscheduledFuture, withManager, proposedStuck };
}

/* ── The header ──────────────────────────────────────────────── */

export interface ColumnSummary {
  today: { scheduled: number; unscheduled: number };
  future: { scheduled: number; unscheduled: number };
  /** Everything the coordinator can pick up in this column, both horizons. */
  total: number;
  /** Unscheduled patients whose follow-up date has already passed. */
  overdue: number;
}

export function columnSummary<T>(b: ColumnBuckets<T>): ColumnSummary {
  const overdue = b.unscheduledToday.filter((e) => e.overdueDays > 0).length;
  return {
    today: { scheduled: b.scheduledToday.length, unscheduled: b.unscheduledToday.length },
    future: { scheduled: b.scheduledFuture.length, unscheduled: b.unscheduledFuture.length },
    total: b.scheduledToday.length + b.scheduledFuture.length + b.unscheduledToday.length + b.unscheduledFuture.length,
    overdue,
  };
}

export interface Summary {
  total: number;
  intake: ColumnSummary;
  welcome: ColumnSummary;
  overdue: number;
}

/** The overview across the top. Escalated patients are not in it — they are
 *  a manager's, and this screen says so in each column's footer. */
export function summarize(intake: IntakeBuckets, welcome: WelcomeCallBuckets): Summary {
  const i = columnSummary(intake);
  const w = columnSummary(welcome);
  return { total: i.total + w.total, intake: i, welcome: w, overdue: i.overdue + w.overdue };
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
