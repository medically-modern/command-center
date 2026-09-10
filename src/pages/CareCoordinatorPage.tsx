/**
 * Care Coordinator — "My Patients" (the `scheduledCalls` role, renamed 2026-09-08).
 *
 * One person's view of everything a patient needs a phone call for, across the
 * three stages where that happens: the DTC intake queue, Confirm Receipt +
 * Chase Clinicals, and the Welcome Call — with the day's booked intake calls
 * on a grid underneath (the old Scheduled Calls page, whole). CLAUDE.md §5.30.
 *
 * Confirm Receipt + Chase Clinicals is currently HIDDEN behind
 * `SHOW_CHASE_COLUMN` (Josh, 2026-09-10) — see that flag for what moves with
 * it. The page renders two columns until it comes back.
 *
 * ⚠️ READ-ONLY. Three slim board reads, no writes (lib/careCoordinator/
 * mondayApi.ts). Every button that changes anything — Text, a booking link,
 * "Open" — is either the shared texting component or a hand-off to the stage
 * page whose verified write path already exists. No Monday column, group or
 * automation was added or changed to build this; every rule on this screen is
 * derived from columns the stage pages already read.
 *
 * ⚠️ ONE COORDINATOR, NO ASSIGNMENT. Josh, 2026-09-08: "care coordinator is one
 * woman right now … leave [scaling] out for today". The role bar IS the
 * assignment (`access.json` gives her the `scheduledCalls` role); nothing here
 * routes a patient to a person, and every queue stays workable from its own
 * page by anyone — the §5.13 model. If a second coordinator arrives, this is a
 * FILTER over the same lists, never routing.
 *
 * The role's COUNT is unchanged: the bar still reads "booked calls still ahead
 * today" (`useRoleCounts` + both baseline generators, §5.8/§5.15). Changing it
 * is a counting-contract change and is deliberately not part of this build.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, HeartHandshake, Plus, RefreshCw } from "lucide-react";

import { useBackNavigation } from "@/hooks/useBackNavigation";
import { useAccessContext } from "@/components/AccessProvider";
import { getUser } from "@/lib/shared/auth";
import { hasMondayAuth } from "@/lib/shared/mondayEndpoint";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";
import BookingLinkDialog from "@/components/scheduledCalls/BookingLinkDialog";
import { etToday } from "@/lib/masheke/etDate";
import { nowMinutesEt, type ScheduledCall } from "@/lib/scheduledCalls/workflow";
import { cn } from "@/lib/utils";

import { useBoardPoll } from "@/hooks/careCoordinator/useBoardPoll";
import {
  fetchChaseItems, fetchIntakeLeads, fetchWelcomeCallItems, INTAKE_FORM_GROUP_IDS,
} from "@/lib/careCoordinator/mondayApi";
import {
  chaseBuckets, intakeBuckets, overdueCount, summarize, toScheduledCall, uncalledCount, welcomeCallBuckets,
  MAX_INTAKE_ATTEMPTS, READY_AFTER_HOURS, type ChaseItem, type IntakeLead,
} from "@/lib/careCoordinator/workflow";
import { PipelineColumn, Section } from "@/components/careCoordinator/PipelineColumn";
import { ChaseCard, IntakeReadyCard, IntakeScheduledCard, WelcomeCard } from "@/components/careCoordinator/cards";
import { ScheduleGrid } from "@/components/careCoordinator/ScheduleGrid";

/** Board polls. The intake read is the ~1,700-row Partial Leads group at ~20
 *  columns — the same order of cost as the intake sidebar's own list read
 *  (§5.25), on the same cadence the old Scheduled Calls page used. */
const POLL_MS = 60_000;

/**
 * Confirm Receipt + Chase Clinicals is hidden for now (Josh, 2026-09-10) so the
 * two columns the coordinator actually works get the width. Flip to `true` to
 * bring it back — nothing else has to change with it.
 *
 * ⚠️ The flag governs the READ, the chips and the column TOGETHER, and that is
 * the point. Hiding the column while still counting the stage would put a
 * number in "Total in pipeline" that nothing on the page explains — the §7
 * complaint in reverse. Because the hidden read yields `[]`, `chaseBuckets`
 * comes back empty and `summarize` drops the stage from Total, overdue and
 * at-escalation on its own; there is no second place to keep in step.
 *
 * Nobody is stranded by this: the stage keeps its own pages, its role bar and
 * its Oversight row. This screen just stops mirroring it.
 */
const SHOW_CHASE_COLUMN: boolean = false;

/** ⚠️ Module-level, not an inline arrow — `useBoardPoll`'s effect re-arms on a
 *  fetcher that changes identity every render (INCIDENT_2026-08-20 rule 2). */
const noChaseItems = async (): Promise<ChaseItem[]> => [];
const chaseFetcher = SHOW_CHASE_COLUMN ? fetchChaseItems : noChaseItems;

/** "Now" for the cards — ticks so "Starts in 8m" and the waits stay honest
 *  between polls without a reload. */
function useNow(): { nowMinutes: number; nowMs: number } {
  const [now, setNow] = useState(() => ({ nowMinutes: nowMinutesEt(), nowMs: Date.now() }));
  useEffect(() => {
    const id = setInterval(() => setNow({ nowMinutes: nowMinutesEt(), nowMs: Date.now() }), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const fmtN = (n: number) => n.toLocaleString();

export default function CareCoordinatorPage() {
  const navigate = useNavigate();
  const { goBack } = useBackNavigation();
  const { access } = useAccessContext();
  const { nowMinutes, nowMs } = useNow();
  const today = etToday();

  // ⚠️ The third argument is the key the remembered row total is stored under,
  // and it is what lets the bar show a PERCENTAGE rather than a bare count —
  // Monday reports no total, so the denominator is what the last complete run
  // returned (lib/careCoordinator/loadProgress.ts). Stable strings; changing one
  // costs a coordinator their first percentage after deploy and nothing else.
  const intake = useBoardPoll(fetchIntakeLeads, POLL_MS, "intake");
  const chase = useBoardPoll(chaseFetcher, POLL_MS, "chase");
  const welcome = useBoardPoll(fetchWelcomeCallItems, POLL_MS, "welcome");

  const intakeB = useMemo(
    () => intakeBuckets(intake.data ?? [], { today, nowMinutes, nowMs, formGroupIds: INTAKE_FORM_GROUP_IDS }),
    [intake.data, today, nowMinutes, nowMs],
  );
  const chaseB = useMemo(() => chaseBuckets(chase.data ?? [], today), [chase.data, today]);
  const welcomeB = useMemo(() => welcomeCallBuckets(welcome.data ?? []), [welcome.data]);
  const summary = useMemo(() => summarize(intakeB, chaseB, welcomeB), [intakeB, chaseB, welcomeB]);
  const scheduleCalls = useMemo<ScheduledCall[]>(() => (intake.data ?? []).map(toScheduledCall), [intake.data]);

  /** Booking-link dialog: `null` closed, `"cold"` with no patient, or a lead. */
  const [linkFor, setLinkFor] = useState<IntakeLead | "cold" | null>(null);
  const openBookingLink = useCallback((lead: IntakeLead) => setLinkFor(lead), []);

  /** The grid hands back a ready route — it knows which board a block belongs
   *  to (intake vs welcome call), and blocks it can't identify never call this. */
  const openFromGrid = useCallback((href: string) => navigate(href), [navigate]);

  /** Email → Welcome Call item, so a Calendly welcome-call booking can link to
   *  the patient's chart. Read from the column's own fetch — no extra query. */
  const welcomeItems = useMemo(
    () => (welcome.data ?? []).map((w) => ({ id: w.id, email: w.email })),
    [welcome.data],
  );

  const refreshAll = () => { intake.refetch(); chase.refetch(); welcome.refetch(); };
  const anyLoading = intake.loading || chase.loading || welcome.loading;

  const user = getUser();
  const who = access.type === "processor" ? access.profile.name || user?.name || user?.email : user?.name || user?.email;

  const uncalled = uncalledCount(intakeB.ready);
  const overdue = overdueCount(chaseB.due);
  const wcUncalled = welcomeB.callNow.filter((e) => e.attempts === 0).length;
  const ex = intakeB.excluded;

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <BookingLinkDialog
        open={linkFor !== null}
        onOpenChange={(v) => { if (!v) setLinkFor(null); }}
        patientName={linkFor && linkFor !== "cold" ? linkFor.name : undefined}
        phone={linkFor && linkFor !== "cold" ? linkFor.phone : undefined}
        email={linkFor && linkFor !== "cold" ? linkFor.email : undefined}
      />

      <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
        <div className="px-3 sm:px-6 py-4 flex flex-wrap items-center gap-3">
          <button onClick={() => goBack()} aria-label="Back" className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
            <HeartHandshake className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Care Coordinator</p>
            <h1 className="text-2xl font-bold leading-tight">My Patients</h1>
            {who && <p className="truncate text-xs opacity-70">{who}</p>}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setLinkFor("cold")}
              title="Send someone a Calendly booking link"
              className="flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-4 w-4" />
              Booking link
            </button>
            <button
              onClick={refreshAll}
              className="flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1.5 text-sm hover:bg-white/10"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", anyLoading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {/* Summary chips — the top row of the mockup. */}
        <div className="px-3 sm:px-6 pb-4 flex flex-wrap items-center gap-2 text-xs">
          <Stat label="Total in pipeline" value={summary.total} strong />
          <Stat label="Patient Intake" value={summary.intake} />
          {SHOW_CHASE_COLUMN && <Stat label="Confirm / Chase" value={summary.chase} />}
          <Stat label="Welcome Call" value={summary.welcome} />
          <span
            className={cn(
              "rounded-md border px-2.5 py-1 font-medium",
              summary.overdue + summary.escalated > 0
                ? "border-rose-300/60 bg-rose-500/15 text-rose-100"
                : "border-white/15 bg-white/5 text-white/70",
            )}
          >
            {summary.overdue} overdue · {summary.escalated} at escalation
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-3 sm:px-6 py-5 space-y-5">
        {!hasMondayAuth() && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            No Monday connection is configured in this build, so nothing can load here.
          </div>
        )}
        <div className="space-y-2">
          <StaleDataNotice error={intake.error} scope="The Patient Intake column" onRetry={intake.refetch} />
          {SHOW_CHASE_COLUMN && (
            <StaleDataNotice error={chase.error} scope="The Confirm Receipt / Chase Clinicals column" onRetry={chase.refetch} />
          )}
          <StaleDataNotice error={welcome.error} scope="The Welcome Call column" onRetry={welcome.refetch} />
        </div>

        {/* Two columns share the width the three used to, so each card gets
            roughly half the page instead of a third. */}
        <div className={cn("grid grid-cols-1 gap-4", SHOW_CHASE_COLUMN ? "xl:grid-cols-3" : "lg:grid-cols-2")}>
          {/* ── Patient Intake ─────────────────────────────────── */}
          <PipelineColumn
            tint="sky"
            title="Patient Intake"
            subtitle="Callbacks first, then longest-waiting"
            count={summary.intake}
            progress={intake.progress}
            alert={uncalled ? `${uncalled} not yet called` : null}
            alertTone="warn"
            footer={
              <IntakeFooter
                imported={ex.imported} nurturing={ex.nurturing} sendNow={ex.sendNow}
                callDone={ex.callDone} cleanUp={ex.cleanUp} proposedStuck={0}
              />
            }
          >
            {intake.loading && <Skeleton />}
            {!intake.loading && summary.intake === 0 && intakeB.exhausted.length === 0 && intakeB.withManager.length === 0 && (
              <Empty>Nobody to call right now. Booked calls and form drop-offs older than {READY_AFTER_HOURS} hours land here.</Empty>
            )}
            <Section title="Scheduled" count={intakeB.scheduled.length} hint="booked Calendly calls, today and onward">
              {intakeB.scheduled.map((e) => <IntakeScheduledCard key={e.lead.id} entry={e} today={today} onBookingLink={openBookingLink} />)}
            </Section>
            <Section title="Unscheduled" count={intakeB.ready.length} hint={`form drop-offs past the ${READY_AFTER_HOURS}h automated window`}>
              {intakeB.ready.map((e) => <IntakeReadyCard key={e.lead.id} entry={e} today={today} onBookingLink={openBookingLink} />)}
            </Section>
            <Section title={`Exhausted · ${MAX_INTAKE_ATTEMPTS} attempts`} count={intakeB.exhausted.length} defaultOpen={false} hint="stop rule — no longer ordered as work">
              {intakeB.exhausted.map((e) => <IntakeReadyCard key={e.lead.id} entry={e} today={today} exhausted onBookingLink={openBookingLink} />)}
            </Section>
            <Section title="With a manager" count={intakeB.withManager.length} defaultOpen={false} hint="escalated — not yours to move">
              {intakeB.withManager.map((lead) => (
                <IntakeReadyCard key={lead.id} entry={{ lead, waitingMs: Math.max(0, nowMs - (Date.parse(lead.createdAt) || nowMs)), attempts: Number(lead.attemptCounter) || 0 }} today={today} onBookingLink={openBookingLink} />
              ))}
            </Section>
          </PipelineColumn>

          {/* ── Confirm Receipt + Chase Clinicals (hidden — see the flag) ── */}
          {SHOW_CHASE_COLUMN && (
            <PipelineColumn
              tint="amber"
              title="Confirm Receipt + Chase Clinicals"
              subtitle="Cadence-driven · most overdue first"
              count={summary.chase}
              progress={chase.progress}
              alert={overdue ? `${overdue} overdue` : null}
              footer={chaseB.proposedStuck > 0 ? <>Not shown: {chaseB.proposedStuck} proposed stuck — awaiting a Final Decision in Oversight.</> : undefined}
            >
              {chase.loading && <Skeleton />}
              {!chase.loading && summary.chase === 0 && chaseB.withManager.length === 0 && <Empty>Nothing in Confirm Receipt or Chase Clinicals.</Empty>}
              <Section title="Due" count={chaseB.due.length} hint="Next Action Date today or earlier">
                {chaseB.due.map((e) => <ChaseCard key={e.item.id} entry={e} today={today} />)}
              </Section>
              <Section title="Waiting" count={chaseB.upcoming.length} defaultOpen={false} hint="snoozed to a future Next Action Date">
                {chaseB.upcoming.map((e) => <ChaseCard key={e.item.id} entry={e} today={today} />)}
              </Section>
              <Section title="Awaiting a provider visit" count={chaseB.awaitingVisit.length} defaultOpen={false} hint="booked appointment still ahead">
                {chaseB.awaitingVisit.map((e) => <ChaseCard key={e.item.id} entry={e} today={today} />)}
              </Section>
              <Section title="With a manager" count={chaseB.withManager.length} defaultOpen={false} hint="escalated — Manager Intervention">
                {chaseB.withManager.map((e) => <ChaseCard key={e.item.id} entry={e} today={today} />)}
              </Section>
            </PipelineColumn>
          )}

          {/* ── Welcome Call ───────────────────────────────────── */}
          <PipelineColumn
            tint="teal"
            title="Welcome Call"
            subtitle="Live calls · pump & CGM flags"
            count={summary.welcome}
            progress={welcome.progress}
            alert={wcUncalled ? `${wcUncalled} not yet called` : null}
            alertTone="warn"
          >
            {welcome.loading && <Skeleton />}
            {!welcome.loading && summary.welcome === 0 && welcomeB.withManager.length === 0 && <Empty>Nothing in the Welcome Call queue.</Empty>}
            <Section title="Call now" count={welcomeB.callNow.length} hint="oldest arrival first">
              {welcomeB.callNow.map((e) => <WelcomeCard key={e.item.id} entry={e} today={today} />)}
            </Section>
            <Section title="Follow up later" count={welcomeB.followUpLater.length} defaultOpen={false} hint="marked Follow Up on the Welcome Call page">
              {welcomeB.followUpLater.map((e) => <WelcomeCard key={e.item.id} entry={e} today={today} snoozed />)}
            </Section>
            <Section title="With a manager" count={welcomeB.withManager.length} defaultOpen={false} hint="escalated">
              {welcomeB.withManager.map((e) => <WelcomeCard key={e.item.id} entry={e} today={today} />)}
            </Section>
          </PipelineColumn>
        </div>

        <ScheduleGrid
          calls={scheduleCalls}
          welcomeItems={welcomeItems}
          nowMinutes={nowMinutes}
          onOpen={openFromGrid}
          remindersOn={access.type === "processor" && access.profile.roles.includes("scheduledCalls")}
        />
      </main>
    </div>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <span className={cn("rounded-md border px-2.5 py-1", strong ? "border-white/30 bg-white/10 font-semibold" : "border-white/15 bg-white/5")}>
      {label} <span className="ml-1 tabular-nums font-bold">{fmtN(value)}</span>
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border bg-card/60" />)}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

/**
 * The honest small print. Every row in the form groups that is NOT on this
 * screen is counted here with its reason — a state that matches no view is
 * invisible app-wide (§7), and this column filters harder than any queue does.
 */
function IntakeFooter({ imported, nurturing, sendNow, callDone, cleanUp }: {
  imported: number; nurturing: number; sendNow: number; callDone: number; cleanUp: number; proposedStuck: number;
}) {
  const parts: string[] = [];
  if (imported) parts.push(`${fmtN(imported)} imported/referral rows that never touched the web form — worked from Info Collection`);
  if (nurturing) parts.push(`${nurturing} inside the ${READY_AFTER_HOURS}-hour automated text/email window`);
  if (sendNow) parts.push(`${sendNow} completed form${sendNow === 1 ? "" : "s"} that chose "Send request now" — advance from Info Collection`);
  if (callDone) parts.push(`${callDone} with the intake call already marked complete`);
  if (cleanUp) parts.push(`${cleanUp} unbooked in Profile Clean-Up`);
  if (!parts.length) return null;
  return <>Not shown: {parts.join(" · ")}.</>;
}
