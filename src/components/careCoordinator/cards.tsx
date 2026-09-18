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
 *  · Intake:  Doctor / Clinic from the PROVIDED form columns; pills Request
 *             Type · Insurance · Insulin Pump Coverage Path · CGM Coverage
 *             Path · Completed|Partial (unscheduled only); counts = Call
 *             Attempts · Auto. Texts.
 *  · Welcome: Doctor / Clinic from the verified block (this board has no
 *             "provided" columns); the same four pills, Primary Insurance in
 *             the insurance slot (the board has no General Insurance — Josh,
 *             2026-09-14) and no Form slot; counts = Call Attempts · Welcome
 *             Call Text sent (0/1).
 *
 * ⚠️ Rebuilt 2026-09-16: the pills are a FIXED, LABELLED GRID now, not a
 * flex-wrapped list of whatever was non-blank, so they line up card to card
 * (`lib/careCoordinator/pills.ts`). A blank slot renders a faint em dash
 * rather than disappearing — which is what used to make every row different.
 * Referral Source left the Welcome Call pills with that rebuild.
 */
import { displayTime } from "@/lib/scheduledCalls/workflow";
import { coveragePathPill, intakeInsurance, PHOTO_UPLOAD, type PillSlots } from "@/lib/careCoordinator/pills";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import type { PillActions } from "./PatientCard";
import { INTAKE_FORM_GROUPS } from "@/lib/careCoordinator/mondayApi";
import {
  autoTexts, formCompletion, formatDaysSince, shortMonthDay, welcomeCallTexts,
  type IntakeLead, type ReviewEntry, type ScheduledEntry, type UnscheduledEntry,
  type WelcomeCallItem,
} from "@/lib/careCoordinator/workflow";
import { PatientCard } from "./PatientCard";

/**
 * What the two columns share once the column itself has done the batched work.
 *
 * ⚠️ `notes` arrives from the COLUMN's one batched read (`useCardNotes`), not
 * from the card — a card that fetched its own would be one Monday request per
 * patient per render. `reached` and `callCount` come from the one account-wide
 * RingCentral read the page already makes. Both are `undefined` until they
 * land, and every renderer below treats that as "we don't know yet", never as
 * a negative.
 */
export interface CardExtras {
  notes: string | undefined;
  reached?: { byText: boolean; byCall: boolean };
  callCount?: number;
}

const FROM = "from=care-coordinator";

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

/**
 * ⚠️ `status` is `""` rather than absent on an unscheduled card and ABSENT on a
 * scheduled one — `PillRow` tells those apart. A booked patient may already sit
 * in Profile Clean-Up, where they are neither Completed nor Partial, so a dash
 * there would claim a form state the row no longer has.
 */
function intakePills(lead: IntakeLead, withCompletion: boolean): PillSlots {
  return {
    requestType: lead.requestType,
    insurance: intakeInsurance(lead),
    // ⚠️ Through `coveragePathPill`, so a "Not Serving" path is the em dash —
    // the same rule the filter's options are built from, which is what stops
    // the filter offering a value no card shows (`intakeFilter.facetValue`).
    ipPath: coveragePathPill(lead.ipCoveragePath),
    cgmPath: coveragePathPill(lead.cgmCoveragePath),
    ...(withCompletion ? { status: formCompletion(lead, INTAKE_FORM_GROUPS) ?? "" } : {}),
  };
}

const intakeHref = (lead: IntakeLead) => `/unverified-referrals?patientId=${encodeURIComponent(lead.id)}&${FROM}`;

export function IntakeScheduledCard({ entry, nextUp, onBookingLink, extras }: {
  entry: ScheduledEntry<IntakeLead>; nextUp: boolean; onBookingLink: (lead: IntakeLead) => void; extras: CardExtras;
}) {
  const lead = entry.item;
  const attempts = Number(lead.attemptCounter) > 0 ? Math.trunc(Number(lead.attemptCounter)) : 0;
  return (
    <PatientCard
      name={lead.name}
      variant="intake"
      attempted={attempts > 0}
      nextUp={nextUp}
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      when={<ScheduledWhen entry={entry} muted={entry.when === "today-passed"} />}
      pills={intakePills(lead, false)}
      pillActions={insurancePillAction(lead)}
      attempts={attempts}
      texts={autoTexts(lead)}
      phone={lead.phone}
      notes={extras.notes}
      notesLabel="Profile Send Off notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake"
      onBookingLink={() => onBookingLink(lead)}
    />
  );
}

export function IntakeUnscheduledCard({ entry, today, onBookingLink, extras }: {
  entry: UnscheduledEntry<IntakeLead>; today: string; onBookingLink: (lead: IntakeLead) => void; extras: CardExtras;
}) {
  const lead = entry.item;
  return (
    <PatientCard
      name={lead.name}
      variant="intake"
      attempted={entry.attempts > 0}
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      when={<DaysSince createdAt={lead.createdAt} today={today} />}
      pills={intakePills(lead, true)}
      pillActions={insurancePillAction(lead)}
      attempts={entry.attempts}
      texts={autoTexts(lead)}
      phone={lead.phone}
      notes={extras.notes}
      notesLabel="Profile Send Off notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake — log the attempt there"
      onBookingLink={() => onBookingLink(lead)}
    />
  );
}

/**
 * The Insurance pill opens the uploaded card, when there is one.
 *
 * Brandon, 2026-09-17: *"'Card on file' should also be a link where you can
 * open up the card from that view … Change to 'Photo upload'."* The photo is
 * the answer for these patients — 19 of the 23 live "Photo of card" rows carry
 * no General Insurance at all — so the pill that names it opens it.
 *
 * ⚠️ **The dropdown he asked for beside the photo is deliberately NOT here**
 * (Josh, 2026-09-18: "photo only, carrier gets picked on profile page"). The
 * carrier is a **Stedi input** (§5.11), so setting it from a photo with no
 * member ID and no re-run sets the next eligibility check up to fail on a
 * payer nobody verified — and this dashboard writes NOTHING (§5.30). The rep
 * reads the card here and types the carrier where Run Stedi lives.
 *
 * ⚠️ Keyed on the URL, not on the pill's words: one live row answers "Photo of
 * card" with no file attached, and an action on it would be a button that
 * opens nothing. The pill still says "Photo upload" there, which is true —
 * they told us they uploaded one.
 */
function insurancePillAction(lead: IntakeLead): PillActions | undefined {
  const url = (lead.insuranceCardUrl || "").trim();
  if (!url || intakeInsurance(lead) !== PHOTO_UPLOAD) return undefined;
  return {
    insurance: {
      title: `Open ${lead.name}'s insurance card`,
      onClick: () => openFileViewer({ url, name: `Insurance card — ${lead.name}` }),
    },
  };
}

/**
 * Review Profile — nobody to ring, a profile to check and advance.
 *
 * What it carries that the other two do not is the BLOCKER
 * (`workflow.intakeBlocker`) — "why has this not been advanced?" is the only
 * question a coordinator has about these patients, and until now the dashboard
 * could not answer it at all.
 *
 * ⚠️ Everything else is the ordinary card on purpose, Booking Link included:
 * a profile review can turn up a question only the patient can answer, and
 * they are one press from being a call again. It is also what keeps the three
 * sections the same shape to scan.
 */
export function IntakeReviewCard({ entry, today, onBookingLink, extras }: {
  entry: ReviewEntry<IntakeLead>; today: string; onBookingLink: (lead: IntakeLead) => void; extras: CardExtras;
}) {
  const lead = entry.item;
  const attempts = Number(lead.attemptCounter) > 0 ? Math.trunc(Number(lead.attemptCounter)) : 0;
  return (
    <PatientCard
      name={lead.name}
      variant="intake"
      attempted={attempts > 0}
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      when={<DaysSince createdAt={lead.createdAt} today={today} />}
      pills={intakePills(lead, true)}
      pillActions={insurancePillAction(lead)}
      blocker={entry.blocker}
      attempts={attempts}
      texts={autoTexts(lead)}
      phone={lead.phone}
      notes={extras.notes}
      notesLabel="Profile Send Off notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake — review and advance"
      onBookingLink={() => onBookingLink(lead)}
    />
  );
}

/* ── Welcome Call ───────────────────────────────────────────── */

/**
 * ⚠️ No `status`, and that is structural rather than a choice: the Welcome Call
 * variant's slot list has no Form column at all. A Welcome Call patient never
 * filled in the DTC web form, so an em dash under a "Form" caption would imply
 * one they skipped.
 *
 * ⚠️ **Referral Source is back, in that slot** (Brandon, 2026-09-17: "we need
 * to add referral source as a pill column for the welcome call side only — it
 * replaces the form column on the intake side"). It left the pills in the
 * 2026-09-16 rebuild; it is the fact worth the fifth column here, because it is
 * how this patient reached us and it is already in the column's read.
 */
function welcomePills(item: WelcomeCallItem): PillSlots {
  return {
    requestType: item.requestType,
    insurance: item.primaryInsurance,
    ipPath: coveragePathPill(item.ipCoveragePath),
    cgmPath: coveragePathPill(item.cgmCoveragePath),
    referralSource: item.referralSource,
  };
}

/** Clinic Address is the well-filled one on this board (30 of 31 live rows);
 *  Clinic Name (20 of 31) and Doctor Phone fill in behind it. */
function welcomeClinic(item: WelcomeCallItem): string {
  return (item.clinicAddress || item.clinicName || item.doctorPhone || "").trim();
}

const welcomeHref = (item: WelcomeCallItem) => `/welcome-call?patientId=${encodeURIComponent(item.id)}&${FROM}`;

export function WelcomeScheduledCard({ entry, nextUp, onBookingLink, extras }: {
  entry: ScheduledEntry<WelcomeCallItem>; nextUp: boolean; onBookingLink: (item: WelcomeCallItem) => void; extras: CardExtras;
}) {
  const item = entry.item;
  const attempts = Number(item.callAttempts) > 0 ? Math.trunc(Number(item.callAttempts)) : 0;
  return (
    <PatientCard
      name={item.name}
      variant="welcome"
      attempted={attempts > 0}
      nextUp={nextUp}
      doctor={item.doctorName}
      clinic={welcomeClinic(item)}
      when={<ScheduledWhen entry={entry} muted={entry.when === "today-passed"} />}
      pills={welcomePills(item)}
      attempts={attempts}
      texts={welcomeCallTexts(item)}
      phone={item.phone}
      notes={extras.notes}
      notesLabel="Welcome Call notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={welcomeHref(item)}
      openLabel="Open on Welcome Call"
      onBookingLink={() => onBookingLink(item)}
    />
  );
}

export function WelcomeUnscheduledCard({ entry, today, onBookingLink, extras }: {
  entry: UnscheduledEntry<WelcomeCallItem>; today: string; onBookingLink: (item: WelcomeCallItem) => void; extras: CardExtras;
}) {
  const item = entry.item;
  return (
    <PatientCard
      name={item.name}
      variant="welcome"
      attempted={entry.attempts > 0}
      doctor={item.doctorName}
      clinic={welcomeClinic(item)}
      when={<DaysSince createdAt={item.createdAt} today={today} />}
      pills={welcomePills(item)}
      attempts={entry.attempts}
      texts={welcomeCallTexts(item)}
      phone={item.phone}
      notes={extras.notes}
      notesLabel="Welcome Call notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={welcomeHref(item)}
      openLabel="Open on Welcome Call — log the attempt there"
      onBookingLink={() => onBookingLink(item)}
    />
  );
}
