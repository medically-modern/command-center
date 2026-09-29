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
import { Camera } from "lucide-react";
import { PHOTO_OF_CARD, coveragePathPill, intakeInsurance, type PillSlots } from "@/lib/careCoordinator/pills";
import { carrierFromPhoto } from "@/lib/careCoordinator/carrierAssign";
import type { InsuranceCardTarget } from "./InsuranceCardDialog";
import type { PillActions } from "./PatientCard";
import { INTAKE_FORM_GROUPS } from "@/lib/careCoordinator/mondayApi";
import { intakeProfileHref } from "@/lib/profile/intakeLink";
import {
  formCompletion, formatDaysSince, shortMonthDay,
  type IntakeLead, type ReviewEntry, type ScheduledEntry, type UnscheduledEntry,
  type WelcomeCallItem,
} from "@/lib/careCoordinator/workflow";
import { isAlreadyInSystemResult } from "@/lib/profile/dupCheckFlag";
import { networkPill } from "@/lib/careCoordinator/networkPill";
import { stateCode, stateFromAddress } from "@/lib/shared/usState";
import { cardWarnings } from "@/lib/profile/intakeWarnings";
import { PatientCard } from "./PatientCard";
import type { CallTarget } from "./CallPatientDialog";

/**
 * What the two columns share once the column itself has done the batched work.
 *
 * ⚠️ `notes` arrives from the COLUMN's one batched read (`useCardNotes`), not
 * from the card — a card that fetched its own would be one Monday request per
 * patient per render. `reached` and `contact` come from the page's one batched
 * read of the gateway's call and text archives (`useContactTotals` — Postgres,
 * never RingCentral, since 2026-09-24). Both are `undefined` until they land,
 * and every renderer below treats that as "we don't know yet", never as a
 * negative.
 */
export interface CardExtras {
  notes: string | undefined;
  reached?: { byText: boolean; byCall: boolean };
  /**
   * The four all-time counts behind the card's counter line, from the page's
   * one batched read of the call and text archives (`useContactTotals`).
   * ⚠️ `undefined` renders no counters at all — see `PatientCard`'s own note
   * on why four zeroes would be a claim. A `null` count is an archive that is
   * not running.
   */
  contact?: {
    callsOut: number | null; callsIn: number | null;
    textsOut: number | null; textsIn: number | null;
    callsSince?: string | null; textsSince?: string | null;
  };
  /**
   * Ring them in the page, and open the log-the-attempt pop-up.
   *
   * ⚠️ The card builds the target rather than the page, because only the card
   * knows which BOARD this patient is on — the two columns keep separate
   * attempt counters, follow-up dates and notes columns, and a target built
   * one place for both is how an attempt gets written against the wrong one.
   * Absent, `PatientContact` falls back to its own dial-only popup (§5.50).
   */
  onCall?: (target: CallTarget) => void;
  /**
   * Open the card photo with the carrier picker beside it.
   *
   * ⚠️ Absent leaves the Insurance pill an ordinary label. The Welcome Call
   * card never reads it — that board carries no insurance card and no Insurance
   * Provided Via, so `insurancePillAction` is an intake-only call.
   */
  onInsuranceCard?: (target: InsuranceCardTarget) => void;
}

const FROM = "from=care-coordinator";

/** The board's own attempt counter, floored at 0 — one per column. Exported
 *  for the page's booking-popup log path, which must count exactly as the
 *  cards do — two parsers is how the same patient gets two different "next"
 *  attempt numbers. */
export function attemptsOf(lead: IntakeLead): number {
  const n = Number(lead.attemptCounter);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

export function welcomeAttemptsOf(item: WelcomeCallItem): number {
  const n = Number(item.callAttempts);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * The card's Call handler, or undefined when the page supplied none.
 *
 * ⚠️ The CARD builds the target, not the page, because only the card knows
 * which board this patient is on — the two columns keep separate attempt
 * counters, follow-up dates and notes columns, and one target shape built in
 * one place for both is how an attempt gets written against the wrong board.
 *
 * ⚠️ A patient with no number gets no handler at all, so `PatientContact`
 * falls back to its own "No phone on file" — a Call button that opens a dialog
 * which then cannot dial is worse than no button.
 */
function callHandler(
  extras: CardExtras, column: CallTarget["column"],
  item: { id: string; name: string; phone: string }, attempts: number, openHref: string,
): (() => void) | undefined {
  const raise = extras.onCall;
  if (!raise || !item.phone.trim()) return undefined;
  return () => raise({ column, itemId: item.id, name: item.name, phone: item.phone, attempts, openHref });
}

/**
 * The card's POST-CALL Log attempt: the same target `callHandler` builds,
 * opened log-only (`dial: false`). Until 2026-09-25 the attempt form's only
 * door on this page was the Call button, so saying what happened after the
 * dialog was closed meant placing a whole new call (Josh: *"make sure log
 * call attempt here is wired up to work post and during call"*).
 *
 * ⚠️ Unlike Call it does NOT require a phone number — an attempt against a
 * patient with no number on file is still an attempt worth recording.
 */
function logAttemptHandler(
  extras: CardExtras, column: CallTarget["column"],
  item: { id: string; name: string; phone: string }, attempts: number, openHref: string,
): (() => void) | undefined {
  const raise = extras.onCall;
  if (!raise) return undefined;
  return () => raise({ column, itemId: item.id, name: item.name, phone: item.phone, attempts, openHref, dial: false });
}

/**
 * Has anybody rung this patient yet — the card's green left edge.
 *
 * ⚠️ **THE UNION OF TWO SOURCES, AND BOTH HALVES EARN THEIR PLACE** (Brandon,
 * 2026-09-22: *"is the green border on the left working for welcome call too?
 * doesn't seem like it. that green border is if we've done an outbound call to
 * them yet"*). It was the board's attempt counter alone, which is a record of
 * somebody pressing *Log call attempt* — so a patient rung three times without
 * the button being pressed read as never contacted, and on Welcome Call, where
 * almost nothing writes that column, the edge was gray on everybody.
 *
 * The call-log half is the literal answer to his question and fixes both; it
 * is ALL-TIME since 2026-09-24 (the call archive, back to its first backfill),
 * where it used to be a seven-day RingCentral window. The board half STAYS
 * because it is the only one that reaches past the archive's start: a call
 * logged before the archive began has no call-log row, and dropping that
 * patient's edge back to gray would say we had never tried.
 */
function calledOut(attempts: number, extras: CardExtras): boolean {
  return attempts > 0 || (extras.contact?.callsOut ?? 0) > 0;
}

/**
 * Does the duplicate check say we already have this person?
 *
 * ⚠️ **THE VERDICT COLUMN LEADS, NOT THE FLAG** — `lib/profile/dupCheckFlag.ts`
 * is the whole argument: on a PARTIAL lead the check is deliberately flag-only
 * and never writes Already In System, because writing it trips the board
 * automation that empties this very queue. So reading the flag alone would
 * hide the pill from most of the population it exists for. The flag is ORed in
 * for the Completed group, where the check does file it.
 */
function inSystem(lead: IntakeLead): boolean {
  return isAlreadyInSystemResult(lead.dupCheckResult) || lead.alreadyInSystem.trim() === "Yes";
}

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

/** A card resting until noon after a morning attempt (§5.30k) — amber, where its wait would be. */
function BackAt({ label }: { label: string }) {
  return <span className="shrink-0 text-sm font-semibold text-amber-700 dark:text-amber-300">{label}</span>;
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

// Routed by the lead's GROUP (intakeLink.ts — Jason Ortiz-Troxell, 2026-09-25):
// a Partial Leads card must open the page saying Partial, and a Clean-Up card
// its own page, or the card and the profile disagree about the same patient.
const intakeHref = (lead: IntakeLead) => intakeProfileHref(lead.id, lead.groupId, FROM);

export function IntakeScheduledCard({ entry, nextUp, onBookingLink, extras }: {
  entry: ScheduledEntry<IntakeLead>; nextUp: boolean; onBookingLink: (lead: IntakeLead) => void; extras: CardExtras;
}) {
  const lead = entry.item;
  const attempts = attemptsOf(lead);
  return (
    <PatientCard
      name={lead.name}
      variant="intake"
      attempted={calledOut(attempts, extras)}
      nextUp={nextUp}
      state={stateCode(lead.state)}
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      networkPill={networkPill(lead)}
      warnings={cardWarnings(lead)}
      when={<ScheduledWhen entry={entry} muted={entry.when === "today-passed"} />}
      pills={intakePills(lead, false)}
      pillActions={insurancePillAction(lead, extras)}
      inSystem={inSystem(lead)}
      inSystemVerdict={lead.dupCheckResult}
      contact={extras.contact}
      phone={lead.phone}
      notes={extras.notes}
      notesLabel="Profile Send Off notes"
      reached={extras.reached}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake"
      onCall={callHandler(extras, "intake", lead, attemptsOf(lead), intakeHref(lead))}
      onLogAttempt={logAttemptHandler(extras, "intake", lead, attemptsOf(lead), intakeHref(lead))}
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
      attempted={calledOut(entry.attempts, extras)}
      state={stateCode(lead.state)}
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      networkPill={networkPill(lead)}
      warnings={cardWarnings(lead)}
      when={entry.backAt ? <BackAt label={entry.backAt} /> : <DaysSince createdAt={lead.createdAt} today={today} />}
      pills={intakePills(lead, true)}
      pillActions={insurancePillAction(lead, extras)}
      inSystem={inSystem(lead)}
      inSystemVerdict={lead.dupCheckResult}
      contact={extras.contact}
      phone={lead.phone}
      notes={extras.notes}
      notesLabel="Profile Send Off notes"
      reached={extras.reached}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake — log the attempt there"
      onCall={callHandler(extras, "intake", lead, attemptsOf(lead), intakeHref(lead))}
      onLogAttempt={logAttemptHandler(extras, "intake", lead, attemptsOf(lead), intakeHref(lead))}
      onBookingLink={() => onBookingLink(lead)}
    />
  );
}

/**
 * The Insurance pill opens the uploaded card, with the carrier picker beside it.
 *
 * Brandon, 2026-09-17: *"'Card on file' should also be a link where you can
 * open up the card from that view … Change to 'Photo upload'."* — then
 * 2026-09-22: *"i should be able to see the photo, but also then assign a
 * general insurance from a drop-down. Once i've assigned it, that general
 * insurance should be the pill, instead of 'Photo Upload', with a little photo
 * icon in top right of the pill."*
 *
 * ⚠️⚠️ **THE GATE IS THE FILE, NOT THE PILL'S WORDS.** It used to also require
 * the pill to read "Photo upload", which was right while the only thing the
 * press did was open the photo — and is wrong now that it also sets the
 * carrier, because the press is what MAKES the pill stop saying that. Keyed on
 * the words, the dialog would close and the pill would go inert on its own
 * next poll: no way back to the photo, and no way to correct a carrier read off
 * it wrongly. Keyed on the file, the photo stays one press away for as long as
 * it is on the row, which is what the glyph promises.
 *
 * ⚠️ **The pill changing to the carrier costs nothing here** —
 * `pills.intakeInsurance` already prefers a real General Insurance over the
 * photo note, so writing the column IS the pill change. Do not add a second
 * rule for it; that function is also what the intake filter's Insurance facet
 * derives its options from (§5.30e), and the two must stay one string.
 *
 * ⚠️ The glyph only renders once a carrier is actually on the row
 * (`carrierFromPhoto`): on a patient who has not been assigned one yet the pill
 * still reads "Photo upload", which already says where the answer is.
 */
function insurancePillAction(lead: IntakeLead, extras: CardExtras): PillActions | undefined {
  const open = extras.onInsuranceCard;
  // ⚠️ The FILE, or the patient's own answer that they would send one — never
  // the pill's words (see above). The second half is Ann Hawkins (Brandon,
  // 2026-09-24: "why can't we click into the photo of the card for Ann
  // Hawkins?"): she answered "Photo of card" and no file ever reached her row,
  // so the pill read "Photo upload" and pressed nothing. It opens the dialog
  // now, which says no photo came through and still takes the carrier and
  // member ID. `insuranceProvidedVia` does not change when a carrier is set,
  // so this half cannot make the press disable itself either.
  const choseCard = (lead.insuranceProvidedVia ?? "").trim() === PHOTO_OF_CARD;
  if (!open || !(lead.hasInsuranceCard || choseCard)) return undefined;
  const fromPhoto = carrierFromPhoto(lead);
  return {
    insurance: {
      title: !lead.hasInsuranceCard
        ? `${lead.name} chose to send a card photo, but none came through — open to record the carrier and member ID`
        : fromPhoto
          ? `${intakeInsurance(lead)} — read off ${lead.name}'s card photo. Open it, or change the carrier or member ID.`
          : `Open ${lead.name}'s insurance card and record the carrier and member ID`,
      onClick: () => open({
        itemId: lead.id, name: lead.name, carrier: lead.generalInsurance, hasPhoto: lead.hasInsuranceCard,
      }),
      icon: fromPhoto ? <Camera className="h-2.5 w-2.5" /> : undefined,
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
  const attempts = attemptsOf(lead);
  return (
    <PatientCard
      name={lead.name}
      variant="intake"
      attempted={calledOut(attempts, extras)}
      state={stateCode(lead.state)}
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      networkPill={networkPill(lead)}
      warnings={cardWarnings(lead)}
      when={<DaysSince createdAt={lead.createdAt} today={today} />}
      pills={intakePills(lead, true)}
      pillActions={insurancePillAction(lead, extras)}
      inSystem={inSystem(lead)}
      inSystemVerdict={lead.dupCheckResult}
      blocker={entry.blocker}
      contact={extras.contact}
      phone={lead.phone}
      notes={extras.notes}
      notesLabel="Profile Send Off notes"
      reached={extras.reached}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake — review and advance"
      onCall={callHandler(extras, "intake", lead, attemptsOf(lead), intakeHref(lead))}
      onLogAttempt={logAttemptHandler(extras, "intake", lead, attemptsOf(lead), intakeHref(lead))}
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
  const attempts = welcomeAttemptsOf(item);
  return (
    <PatientCard
      name={item.name}
      variant="welcome"
      attempted={calledOut(attempts, extras)}
      nextUp={nextUp}
      state={stateFromAddress(item.address)}
      doctor={item.doctorName}
      clinic={welcomeClinic(item)}
      when={<ScheduledWhen entry={entry} muted={entry.when === "today-passed"} />}
      pills={welcomePills(item)}
      contact={extras.contact}
      phone={item.phone}
      notes={extras.notes}
      notesLabel="Welcome Call notes"
      reached={extras.reached}
      openHref={welcomeHref(item)}
      openLabel="Open on Welcome Call"
      onCall={callHandler(extras, "welcome", item, welcomeAttemptsOf(item), welcomeHref(item))}
      onLogAttempt={logAttemptHandler(extras, "welcome", item, welcomeAttemptsOf(item), welcomeHref(item))}
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
      attempted={calledOut(entry.attempts, extras)}
      state={stateFromAddress(item.address)}
      doctor={item.doctorName}
      clinic={welcomeClinic(item)}
      when={entry.backAt ? <BackAt label={entry.backAt} /> : <DaysSince createdAt={item.createdAt} today={today} />}
      pills={welcomePills(item)}
      contact={extras.contact}
      phone={item.phone}
      notes={extras.notes}
      notesLabel="Welcome Call notes"
      reached={extras.reached}
      openHref={welcomeHref(item)}
      openLabel="Open on Welcome Call — log the attempt there"
      onCall={callHandler(extras, "welcome", item, welcomeAttemptsOf(item), welcomeHref(item))}
      onLogAttempt={logAttemptHandler(extras, "welcome", item, welcomeAttemptsOf(item), welcomeHref(item))}
      onBookingLink={() => onBookingLink(item)}
    />
  );
}
