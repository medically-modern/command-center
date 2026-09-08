/**
 * The four card renderers — one per population on the dashboard.
 *
 * Each turns a bucket entry from `lib/careCoordinator/workflow` into a
 * `PatientCard`, and each links "Open" to the stage page that WORKS that
 * patient, with `?patientId=` — every role hook already injects a deep-linked
 * patient whether or not its queue rule would show them (§7), so this one
 * link is the whole hand-off.
 */
import { Printer, Mail, Send, Phone } from "lucide-react";

import { ProfileStatusBadge } from "@/components/shared/ProfileStatusBadge";
import {
  intakeProfileStatus, mashekeProfileStatus, welcomeCallProfileStatus,
} from "@/lib/shared/profileStatus";
import { displayTime } from "@/lib/scheduledCalls/workflow";
import { NOTES_COLUMN } from "@/lib/careCoordinator/mondayApi";
import {
  attemptLabel, chaseRoute, daysInPipeline, formatWait, latestAttempt, methodLabel, toCount,
  type ChaseEntry, type IntakeLead, type ReadyLead, type ScheduledLead, type WelcomeCallEntry,
} from "@/lib/careCoordinator/workflow";
import { Chip, PatientCard, When, type Tone } from "./PatientCard";

const FROM = "from=care-coordinator";

/** "Wed, Sep 10" from YYYY-MM-DD, without letting a UTC parse shift the day. */
function shortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
  if (!m) return ymd || "—";
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function pipelineChip(dateOfIntake: string, createdAt: string, today: string) {
  const d = daysInPipeline(dateOfIntake, createdAt, today);
  return d === null ? null : <Chip tone="muted" key="pipe">{d}d in pipeline</Chip>;
}

/** The exact string the intake sidebar and header print (sidebarList.contactTally). */
function tally(lead: IntakeLead): string {
  return `Call Attempts: ${toCount(lead.attemptCounter)} | Auto. Texts: ${Math.min(toCount(lead.dropOffAttempt), 2)}`;
}

function intakeBadge(lead: IntakeLead) {
  // `ignoreFollowUp` — Patient Intake's rule (§5.10): the queue's Follow Up
  // pair is a one-way door nothing reads, so honouring it would say Paused
  // about a patient sitting in the calling list.
  return <ProfileStatusBadge size="sm" status={intakeProfileStatus(lead, { ignoreFollowUp: true })} />;
}

function intakeSub(lead: IntakeLead): string {
  const source = (lead.referralSource || "").trim();
  const via = lead.dropOffStep ? "Web form" : source ? `Referral · ${source}` : "Referral";
  const parts = [via];
  if (lead.dropOffStep) parts.push(/^completed$/i.test(lead.dropOffStep.trim()) ? "form completed" : lead.dropOffStep);
  if (lead.reasonForInquiry) parts.push(lead.reasonForInquiry);
  return parts.join(" · ");
}

function needsPump(lead: IntakeLead): boolean {
  return /new pump/i.test(lead.pumpNeed ?? "") || /pump/i.test(lead.requestType ?? "") && !/supplies/i.test(lead.requestType ?? "");
}

export function IntakeScheduledCard({ entry, today, onBookingLink }: {
  entry: ScheduledLead; today: string; onBookingLink: (lead: IntakeLead) => void;
}) {
  const { lead, booking, minutesUntil, when } = entry;
  const tone: Tone = when === "today-now" ? "good" : when === "today-passed" ? "muted" : when === "later" ? "muted" : "info";
  const whenLabel =
    when === "later" ? shortDate(booking.date)
    : booking.time ? displayTime(booking.time) : "Today · no time";
  const timing =
    when === "today-now" ? <Chip tone="good" key="t">Now</Chip>
    : when === "today-passed" ? <Chip tone="muted" key="t">Passed · still to make</Chip>
    : when === "today-upcoming" && minutesUntil !== null ? <Chip tone="info" key="t">Starts in {minutesUntil >= 60 ? `${Math.floor(minutesUntil / 60)}h ${minutesUntil % 60}m` : `${minutesUntil}m`}</Chip>
    : when === "today-upcoming" ? <Chip tone="info" key="t">Today</Chip>
    : <Chip tone="muted" key="t">{shortDate(booking.date)}</Chip>;

  return (
    <PatientCard
      tone={tone}
      name={lead.name}
      badge={intakeBadge(lead)}
      when={<When tone={tone === "muted" ? "muted" : "info"}>{whenLabel}</When>}
      sub={intakeSub(lead)}
      chips={<>
        {timing}
        {when !== "later" && <Chip tone="neutral" key="today">Today</Chip>}
        {pipelineChip("", lead.createdAt, today)}
        {needsPump(lead) && <Chip tone="info" key="pump">Pump request</Chip>}
        {lead.requestType && <Chip tone="neutral" key="rt">{lead.requestType}</Chip>}
        <Chip tone="muted" key="tally">{tally(lead)}</Chip>
      </>}
      phone={lead.phone}
      notes={{ itemId: lead.id, columnId: NOTES_COLUMN.intake, label: "Profile Send Off notes" }}
      openHref={`/unverified-referrals?patientId=${encodeURIComponent(lead.id)}&${FROM}`}
      openLabel="Open on Patient Intake"
      extraActions={
        <button type="button" onClick={() => onBookingLink(lead)} className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent" title="Send a new booking link to reschedule">
          Reschedule link
        </button>
      }
    />
  );
}

export function IntakeReadyCard({ entry, today, exhausted = false, onBookingLink }: {
  entry: ReadyLead; today: string; exhausted?: boolean; onBookingLink: (lead: IntakeLead) => void;
}) {
  const { lead, waitingMs, attempts } = entry;
  const uncalled = attempts === 0;
  const tone: Tone = exhausted ? "muted" : uncalled ? "warn" : "neutral";
  return (
    <PatientCard
      tone={tone}
      name={lead.name}
      badge={intakeBadge(lead)}
      when={<When tone={exhausted ? "muted" : uncalled ? "warn" : "muted"}>{formatWait(waitingMs)} waiting</When>}
      sub={intakeSub(lead)}
      chips={<>
        {exhausted
          ? <Chip tone="muted" key="cap">{attempts} attempts · stop rule</Chip>
          : <Chip tone="muted" key="cb">No callback set</Chip>}
        {pipelineChip("", lead.createdAt, today)}
        {needsPump(lead) && <Chip tone="info" key="pump">Pump request</Chip>}
        {lead.requestType && <Chip tone="neutral" key="rt">{lead.requestType}</Chip>}
        {lead.dupCheckResult && /duplicate/i.test(lead.dupCheckResult) && <Chip tone="warn" key="dup">Possible duplicate</Chip>}
        <Chip tone={uncalled ? "warn" : "muted"} key="tally">{tally(lead)}</Chip>
      </>}
      phone={lead.phone}
      notes={{ itemId: lead.id, columnId: NOTES_COLUMN.intake, label: "Profile Send Off notes" }}
      openHref={`/unverified-referrals?patientId=${encodeURIComponent(lead.id)}&${FROM}`}
      openLabel="Open on Patient Intake — log the attempt there"
      extraActions={
        <button type="button" onClick={() => onBookingLink(lead)} className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent" title="Text or email a Calendly booking link — the callback IS the booking">
          Booking link
        </button>
      }
    />
  );
}

function MethodIcon({ method }: { method: string }) {
  const cls = "h-3 w-3";
  if (/parachute/i.test(method)) return <Send className={cls} aria-hidden />;
  if (/email/i.test(method)) return <Mail className={cls} aria-hidden />;
  if (/fax/i.test(method)) return <Printer className={cls} aria-hidden />;
  return <Phone className={cls} aria-hidden />;
}

export function ChaseCard({ entry, today }: { entry: ChaseEntry; today: string }) {
  const { item, due } = entry;
  const escalated = item.escalationIndex === 0;
  const tone: Tone = escalated ? "bad" : due.kind === "overdue" ? "bad" : due.kind === "today" ? "warn" : "muted";
  const attempt = attemptLabel(item.mnAttempts);
  const method = methodLabel(item.clinicalsMethod);
  const last = latestAttempt(item);
  const isChase = item.subStage === "Chase Clinicals";
  return (
    <PatientCard
      tone={tone}
      name={item.name}
      badge={<ProfileStatusBadge size="sm" status={mashekeProfileStatus(item)} />}
      when={<When tone={due.kind === "overdue" ? "bad" : due.kind === "today" ? "warn" : "muted"}>{due.text}</When>}
      sub={[item.doctorName, item.clinicName].filter(Boolean).join(" — ") || "No doctor on file"}
      chips={<>
        <Chip tone={isChase ? "bad" : "good"} key="stage">{item.subStage}</Chip>
        {attempt && <Chip tone={/escalate/i.test(attempt) ? "warn" : "neutral"} key="att">{attempt}</Chip>}
        <Chip tone="neutral" key="m"><MethodIcon method={method} />{method}</Chip>
        {pipelineChip(item.dateOfIntake, item.createdAt, today)}
        {item.appointmentDate && <Chip tone="muted" key="appt">Visit {shortDate(item.appointmentDate)}</Chip>}
      </>}
      body={<>
        <div>
          <span className="font-semibold">Latest attempt:</span>{" "}
          {last ? <>{last.date}{last.note ? ` · ${last.note}` : ""}</> : <span className="text-muted-foreground">none logged for this stage yet</span>}
        </div>
        <div className="text-muted-foreground">
          {isChase
            ? "Cadence: next action moves +3 business days per attempt"
            : item.requestSentAt ? `Request sent ${shortDate(item.requestSentAt)}` : "Request sent date not on file"}
          {item.receiptConfirmedName && ` · receipt confirmed by ${item.receiptConfirmedName}`}
        </div>
      </>}
      phone={item.phone}
      notes={{ itemId: item.id, columnId: NOTES_COLUMN.chase, label: "MN Workflow Notes" }}
      openHref={`${chaseRoute(item)}?patientId=${encodeURIComponent(item.id)}&${FROM}`}
      openLabel={`Open on ${item.subStage}`}
    />
  );
}

export function WelcomeCard({ entry, today, snoozed = false }: { entry: WelcomeCallEntry; today: string; snoozed?: boolean }) {
  const { item, firstTimePump, crossSell, attempts } = entry;
  const escalated = /escalation required/i.test(item.escalation);
  const tone: Tone = escalated ? "bad" : snoozed ? "muted" : attempts === 0 ? "warn" : "neutral";
  const whenText = snoozed
    ? item.followUpDate ? `Follow up ${shortDate(item.followUpDate)}` : "Snoozed · no date"
    : `${formatWait(Date.now() - (Date.parse(item.createdAt) || Date.now()))} in stage`;
  return (
    <PatientCard
      tone={tone}
      name={item.name}
      badge={<ProfileStatusBadge size="sm" status={welcomeCallProfileStatus(item)} />}
      when={<When tone={snoozed ? "muted" : attempts === 0 ? "warn" : "muted"}>{whenText}</When>}
      sub={[item.doctorName, item.primaryInsurance].filter(Boolean).join(" · ") || "No doctor on file"}
      chips={<>
        {firstTimePump && <Chip tone="info" key="ftp">1st-time pump</Chip>}
        {crossSell && <Chip tone="good" key="xs">CGM cross-sell</Chip>}
        {item.serving && <Chip tone="neutral" key="srv">{item.serving}</Chip>}
        {pipelineChip(item.referralReceivedDate, item.createdAt, today)}
        <Chip tone={attempts === 0 ? "warn" : "muted"} key="att">Call attempts: {attempts}</Chip>
      </>}
      phone={item.phone}
      notes={{ itemId: item.id, columnId: NOTES_COLUMN.welcome, label: "Welcome Call notes" }}
      openHref={`/welcome-call?patientId=${encodeURIComponent(item.id)}&${FROM}`}
      openLabel="Open on Welcome Call"
    />
  );
}
