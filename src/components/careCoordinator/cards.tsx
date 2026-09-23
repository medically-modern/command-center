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
import { toast } from "sonner";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import type { PillActions } from "./PatientCard";
import { fetchInsuranceCardAsset, INTAKE_FORM_GROUPS } from "@/lib/careCoordinator/mondayApi";
import {
  formCompletion, formatDaysSince, shortMonthDay,
  type IntakeLead, type ReviewEntry, type ScheduledEntry, type UnscheduledEntry,
  type WelcomeCallItem,
} from "@/lib/careCoordinator/workflow";
import { isAlreadyInSystemResult } from "@/lib/profile/dupCheckFlag";
import { PatientCard } from "./PatientCard";
import type { CallTarget } from "./CallPatientDialog";

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
  /**
   * The four real counts behind the card's two counter rows, from the same
   * account-wide read. ⚠️ `undefined` renders no rows at all — see
   * `PatientCard`'s own note on why four zeroes would be a claim.
   */
  contact?: {
    callsOut: number; callsIn: number; textsOut: number; textsIn: number;
    callsClipped?: boolean; textsClipped?: boolean;
  };
  /**
   * Ring them in the page, and open the log-the-attempt pop-up.
   *
   * ⚠️ The card builds the target rather than the page, because only the card
   * knows which BOARD this patient is on — the two columns keep separate
   * attempt counters, follow-up dates and notes columns, and a target built
   * one place for both is how an attempt gets written against the wrong one.
   * Absent leaves `PatientContact`'s ordinary `tel:` handoff.
   */
  onCall?: (target: CallTarget) => void;
}

const FROM = "from=care-coordinator";

/** The board's own attempt counter, floored at 0 — one per column. */
function attemptsOf(lead: IntakeLead): number {
  const n = Number(lead.attemptCounter);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function welcomeAttemptsOf(item: WelcomeCallItem): number {
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
 * The RingCentral half is the literal answer to his question and fixes both.
 * The board half STAYS because it is the only one that reaches past the shared
 * window: a patient called a fortnight ago has no RingCentral evidence left,
 * and dropping their edge back to gray would say we had never tried.
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
  const attempts = attemptsOf(lead);
  return (
    <PatientCard
      name={lead.name}
      variant="intake"
      attempted={calledOut(attempts, extras)}
      nextUp={nextUp}
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      network={lead.stediInNetwork}
      when={<ScheduledWhen entry={entry} muted={entry.when === "today-passed"} />}
      pills={intakePills(lead, false)}
      pillActions={insurancePillAction(lead)}
      inSystem={inSystem(lead)}
      contact={extras.contact}
      phone={lead.phone}
      notes={extras.notes}
      notesLabel="Profile Send Off notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake"
      onCall={callHandler(extras, "intake", lead, attemptsOf(lead), intakeHref(lead))}
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
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      network={lead.stediInNetwork}
      when={<DaysSince createdAt={lead.createdAt} today={today} />}
      pills={intakePills(lead, true)}
      pillActions={insurancePillAction(lead)}
      inSystem={inSystem(lead)}
      contact={extras.contact}
      phone={lead.phone}
      notes={extras.notes}
      notesLabel="Profile Send Off notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake — log the attempt there"
      onCall={callHandler(extras, "intake", lead, attemptsOf(lead), intakeHref(lead))}
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
  if (!lead.hasInsuranceCard || intakeInsurance(lead) !== PHOTO_UPLOAD) return undefined;
  return {
    insurance: {
      title: `Open ${lead.name}'s insurance card`,
      onClick: () => void openInsuranceCard(lead),
    },
  };
}

/**
 * Resolve the card's signed URL, then open it.
 *
 * ⚠️⚠️ **THE TWO STEPS ARE NOT AN OPTIMISATION — one step was the bug.** This
 * shipped on 2026-09-18 passing the file column's own `text` straight to the
 * viewer, and that link is a `protected_static` path: **302 to a login page**
 * without a monday session, so the pill opened an error on every patient while
 * every test stayed green (nothing asserts a URL is reachable). The signed
 * `public_url` lives on the ASSET and expires in an hour, so it can only be
 * fetched on the click — `mondayApi.fetchInsuranceCardAsset`.
 *
 * ⚠️ A failure SAYS SO. The whole point of the pill is that the photo is the
 * insurance answer for these patients (§5.30c: 18 of 20 carry no carrier at
 * all), so "nothing happened" is the one outcome that teaches a coordinator to
 * stop pressing it. The same reasoning as the Comms Hub's `viewFax`, which is
 * the other fetch-then-open in the app.
 *
 * ⚠️ One request per click, `inFlight` guarded: a double-click on a card in a
 * long list is ordinary, and this is a read against the same monday budget the
 * ~1,754-row column already spends (§5.30's load note).
 */
const inFlight = new Set<string>();

async function openInsuranceCard(lead: IntakeLead) {
  if (inFlight.has(lead.id)) return;
  inFlight.add(lead.id);
  const toastId = `card-photo-${lead.id}`;
  toast.loading("Opening the insurance card…", { id: toastId });
  try {
    const photo = await fetchInsuranceCardAsset(lead.id);
    if (!photo) {
      // The column said a file was attached and the item does not hold it —
      // a cleared asset, or a value we could not read. Name that, rather than
      // opening something arbitrary off the item.
      toast.error("That insurance card is no longer on the patient's row.", { id: toastId });
      return;
    }
    toast.dismiss(toastId);
    openFileViewer({ url: photo.url, name: `Insurance card — ${lead.name}` });
  } catch (e) {
    toast.error(`Couldn't open the insurance card: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
  } finally {
    inFlight.delete(lead.id);
  }
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
      doctor={lead.providedDoctorName}
      clinic={lead.providedClinicPhone}
      network={lead.stediInNetwork}
      when={<DaysSince createdAt={lead.createdAt} today={today} />}
      pills={intakePills(lead, true)}
      pillActions={insurancePillAction(lead)}
      inSystem={inSystem(lead)}
      blocker={entry.blocker}
      blockerDetail={entry.blockerDetail}
      contact={extras.contact}
      phone={lead.phone}
      notes={extras.notes}
      notesLabel="Profile Send Off notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={intakeHref(lead)}
      openLabel="Open on Patient Intake — review and advance"
      onCall={callHandler(extras, "intake", lead, attemptsOf(lead), intakeHref(lead))}
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
      doctor={item.doctorName}
      clinic={welcomeClinic(item)}
      when={<ScheduledWhen entry={entry} muted={entry.when === "today-passed"} />}
      pills={welcomePills(item)}
      contact={extras.contact}
      phone={item.phone}
      notes={extras.notes}
      notesLabel="Welcome Call notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={welcomeHref(item)}
      openLabel="Open on Welcome Call"
      onCall={callHandler(extras, "welcome", item, welcomeAttemptsOf(item), welcomeHref(item))}
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
      doctor={item.doctorName}
      clinic={welcomeClinic(item)}
      when={<DaysSince createdAt={item.createdAt} today={today} />}
      pills={welcomePills(item)}
      contact={extras.contact}
      phone={item.phone}
      notes={extras.notes}
      notesLabel="Welcome Call notes"
      reached={extras.reached}
      callCount={extras.callCount}
      openHref={welcomeHref(item)}
      openLabel="Open on Welcome Call — log the attempt there"
      onCall={callHandler(extras, "welcome", item, welcomeAttemptsOf(item), welcomeHref(item))}
      onBookingLink={() => onBookingLink(item)}
    />
  );
}
