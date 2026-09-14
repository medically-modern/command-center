/**
 * The card renderers — one per column, scheduled or unscheduled.
 *
 * Each turns a bucket entry from `lib/careCoordinator/workflow` into a
 * `PatientCard`, and each links "Open" to the stage page that WORKS that
 * patient, with `?patientId=` — every role hook already injects a deep-linked
 * patient whether or not its queue rule would show them (§7), so this one
 * link is the whole hand-off.
 *
 * Brandon's card content (2026-09-14), verbatim where it could be:
 *  · Intake:  Doctor / Clinic from the PROVIDED form columns; pills
 *             Completed|Partial (unscheduled only) · Request Type · General
 *             Insurance · Insulin Pump Coverage Path · CGM Coverage Path;
 *             counts = Call Attempts · Auto. Texts.
 *  · Welcome: Doctor / Clinic from the verified block (this board has no
 *             "provided" columns); pills Request Type · Primary Insurance
 *             (the board has no General Insurance — Josh, 2026-09-14) ·
 *             Insulin Pump Coverage Path · CGM Coverage Path · Referral
 *             Source; counts = Call Attempts · Welcome Call Text sent (0/1).
 * Blank pills are not shown.
 */
import { displayTime } from "@/lib/scheduledCalls/workflow";
import { INTAKE_FORM_GROUPS, NOTES_COLUMN } from "@/lib/careCoordinator/mondayApi";
import {
  autoTexts, formCompletion, formatDaysSince, shortMonthDay, welcomeCallTexts,
  type IntakeLead, type ScheduledEntry, type UnscheduledEntry, type WelcomeCallItem,
} from "@/lib/careCoordinator/workflow";
import { PatientCard } from "./PatientCard";

const FROM = "from=care-coordinator";

const pills = (values: (string | null | undefined)[]): string[] =>
  values.map((v) => (v ?? "").trim()).filter(Boolean);

/** The right-hand time for a scheduled box: `x:xx` today, `MM/DD x:xx` otherwise. */
function ScheduledWhen<T>({ entry, muted }: { entry: ScheduledEntry<T>; muted: boolean }) {
  const time = entry.time ? displayTime(entry.time) : "";
  const text = entry.when === "later"
    ? [shortMonthDay(entry.date), time].filter(Boolean).join(" ")
    : time || "Today";
  return (
    <span className={`shrink-0 text-sm font-semibold tabular-nums ${muted ? "text-muted-foreground" : "text-foreground"}`}>
      {text}
    </span>
  );
}

/** The right-hand wait for an unscheduled box — "Days since intake", gray. */
function DaysSince({ createdAt, today }: { createdAt: string; today: string }) {
  return <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{formatDaysSince(createdAt, today)}</span>;
}

/* ── Intake ─────────────────────────────────────────────────── */

function intakePills(lead: IntakeLead, withCompletion: boolean): string[] {
  return pills([
    withCompletion ? formCompletion(lead, INTAKE_FORM_GROUPS) : null,
    lead.requestType, lead.generalInsurance, lead.ipCoveragePath, lead.cgmCoveragePath,
  ]);
}

const intakeNotes = (lead: IntakeLead) => ({ itemId: lead.id, columnId: NOTES_COLUMN.intake, label: "Profile Send Off notes" });
const intakeHref = (lead: IntakeLead) => `/unverified-referrals?patientId=${encodeURIComponent(lead.id)}&${FROM}`;

export function IntakeScheduledCard({ entry, nextUp, onBookingLink }: {
  entry: ScheduledEntry<IntakeLead>; nextUp: boolean; onBookingLink: (lead: IntakeLead) => void;
}) {
  const lead = entry.item;
  const attempts = Number(lead.attemptCounter) > 0 ? Math.trunc(Number(lead.attemptCounter)) : 0;
  return (
    <PatientCard
      name={lead.name}
      attempted={attempts > 0}
      nextUp={nextUp}
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      when={<ScheduledWhen entry={entry} muted={entry.when === "today-passed"} />}
      pills={intakePills(lead, false)}
      attempts={attempts}
      texts={autoTexts(lead)}
      phone={lead.phone}
      notes={intakeNotes(lead)}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake"
      onBookingLink={() => onBookingLink(lead)}
    />
  );
}

export function IntakeUnscheduledCard({ entry, today, onBookingLink }: {
  entry: UnscheduledEntry<IntakeLead>; today: string; onBookingLink: (lead: IntakeLead) => void;
}) {
  const lead = entry.item;
  return (
    <PatientCard
      name={lead.name}
      attempted={entry.attempts > 0}
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      when={<DaysSince createdAt={lead.createdAt} today={today} />}
      pills={intakePills(lead, true)}
      attempts={entry.attempts}
      texts={autoTexts(lead)}
      phone={lead.phone}
      notes={intakeNotes(lead)}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake — log the attempt there"
      onBookingLink={() => onBookingLink(lead)}
    />
  );
}

/* ── Welcome Call ───────────────────────────────────────────── */

function welcomePills(item: WelcomeCallItem): string[] {
  return pills([item.requestType, item.primaryInsurance, item.ipCoveragePath, item.cgmCoveragePath, item.referralSource]);
}

/** Clinic Address is the well-filled one on this board (30 of 31 live rows);
 *  Clinic Name (20 of 31) and Doctor Phone fill in behind it. */
function welcomeClinic(item: WelcomeCallItem): string {
  return (item.clinicAddress || item.clinicName || item.doctorPhone || "").trim();
}

const welcomeNotes = (item: WelcomeCallItem) => ({ itemId: item.id, columnId: NOTES_COLUMN.welcome, label: "Welcome Call notes" });
const welcomeHref = (item: WelcomeCallItem) => `/welcome-call?patientId=${encodeURIComponent(item.id)}&${FROM}`;

export function WelcomeScheduledCard({ entry, nextUp, onBookingLink }: {
  entry: ScheduledEntry<WelcomeCallItem>; nextUp: boolean; onBookingLink: (item: WelcomeCallItem) => void;
}) {
  const item = entry.item;
  const attempts = Number(item.callAttempts) > 0 ? Math.trunc(Number(item.callAttempts)) : 0;
  return (
    <PatientCard
      name={item.name}
      attempted={attempts > 0}
      nextUp={nextUp}
      doctor={item.doctorName}
      clinic={welcomeClinic(item)}
      when={<ScheduledWhen entry={entry} muted={entry.when === "today-passed"} />}
      pills={welcomePills(item)}
      attempts={attempts}
      texts={welcomeCallTexts(item)}
      phone={item.phone}
      notes={welcomeNotes(item)}
      openHref={welcomeHref(item)}
      openLabel="Open on Welcome Call"
      onBookingLink={() => onBookingLink(item)}
    />
  );
}

export function WelcomeUnscheduledCard({ entry, today, onBookingLink }: {
  entry: UnscheduledEntry<WelcomeCallItem>; today: string; onBookingLink: (item: WelcomeCallItem) => void;
}) {
  const item = entry.item;
  return (
    <PatientCard
      name={item.name}
      attempted={entry.attempts > 0}
      doctor={item.doctorName}
      clinic={welcomeClinic(item)}
      when={<DaysSince createdAt={item.createdAt} today={today} />}
      pills={welcomePills(item)}
      attempts={entry.attempts}
      texts={welcomeCallTexts(item)}
      phone={item.phone}
      notes={welcomeNotes(item)}
      openHref={welcomeHref(item)}
      openLabel="Open on Welcome Call — log the attempt there"
      onBookingLink={() => onBookingLink(item)}
    />
  );
}
