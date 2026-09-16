/**
 * Care Coordinator — "My Patients" (the `scheduledCalls` role, renamed 2026-09-08).
 *
 * Rebuilt 2026-09-14 to Brandon's "Notes for masani dashboard (9/14/26)",
 * kept word for word where the board allowed it. CLAUDE.md §5.30.
 *
 * The page, top to bottom:
 *   1. Header — the summary as an overview, not pills: total, Patient Intake,
 *      Welcome Call, overdue.
 *   2. The day strip — every booked call laid out by time across the screen,
 *      one day at a time, intake and welcome in their two colours.
 *   3. Two gray columns, Patient Intake and Welcome Call. Each has the same
 *      model: Today / Future (default Today), and inside each Scheduled /
 *      Unscheduled sections with totals.
 *
 * ⚠️ STILL READ-ONLY. Two slim board reads plus one gateway request for the
 * welcome-call bookings (lib/careCoordinator/mondayApi.ts, useWelcomeCallBookings).
 * Every button that changes anything — Text, a booking link, "Open" — is either
 * the shared texting component or a hand-off to the stage page whose verified
 * write path already exists. The follow-up push Brandon asked for lives on the
 * STAGE pages' attempt loggers (Josh, 2026-09-14): Patient Intake's "Log call
 * attempt" and Welcome Call's +1 both write the date this page reads.
 *
 * ⚠️ ONE COORDINATOR, NO ASSIGNMENT (Josh, 2026-09-08). The role bar IS the
 * assignment; nothing here routes a patient to a person. If a second
 * coordinator arrives, this is a FILTER over the same lists, never routing.
 *
 * Escalated patients render nowhere here — "this user should not see this" —
 * and are counted in each column's footer; they are worked from Oversight's
 * manager columns (§7, §5.34).
 *
 * Confirm Receipt + Chase Clinicals is NOT on this page. It was hidden behind
 * a flag on 2026-09-10 and is not part of the 2026-09-14 design; its rules
 * (`chaseBuckets`) and read (`fetchChaseItems`) survive in the lib for the day
 * somebody wants a third column, but there is no flag to flip any more.
 *
 * The role's COUNT is unchanged: the bar still reads "booked calls still ahead
 * today" (`useRoleCounts` + both baseline generators, §5.8/§5.15). Changing it
 * is a counting-contract change and is deliberately not part of this build.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, HeartHandshake, Loader2, Plus, RefreshCw } from "lucide-react";

import { useBackNavigation } from "@/hooks/useBackNavigation";
import { useAccessContext } from "@/components/AccessProvider";
import { getUser } from "@/lib/shared/auth";
import { hasMondayAuth } from "@/lib/shared/mondayEndpoint";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";
import BookingLinkDialog from "@/components/scheduledCalls/BookingLinkDialog";
import type { BookingKind } from "@/lib/scheduledCalls/bookingLink";
import { etToday } from "@/lib/masheke/etDate";
import { nowMinutesEt, type ScheduledCall } from "@/lib/scheduledCalls/workflow";
import { cn } from "@/lib/utils";

import { useBoardPoll } from "@/hooks/careCoordinator/useBoardPoll";
import { useWelcomeCallBookings } from "@/hooks/careCoordinator/useWelcomeCallBookings";
import {
  fetchIntakeLeads, fetchWelcomeCallItems, INTAKE_FORM_GROUPS, INTAKE_FORM_GROUP_IDS,
} from "@/lib/careCoordinator/mondayApi";
import {
  intakeBuckets, matchesFormFilter, nextUp, summarize, toScheduledCall, welcomeCallBuckets,
  FORM_FILTERS, FORM_FILTER_LABEL, READY_AFTER_HOURS,
  type FormFilter, type Horizon, type IntakeLead, type WelcomeCallItem,
} from "@/lib/careCoordinator/workflow";
import { PipelineColumn, Section } from "@/components/careCoordinator/PipelineColumn";
import {
  IntakeScheduledCard, IntakeUnscheduledCard, WelcomeScheduledCard, WelcomeUnscheduledCard,
} from "@/components/careCoordinator/cards";
import { ScheduleGrid } from "@/components/careCoordinator/ScheduleGrid";

/** Board polls. The intake read is the ~1,700-row Partial Leads group at ~25
 *  columns — the same order of cost as the intake sidebar's own list read
 *  (§5.25), on the same cadence the old Scheduled Calls page used. */
const POLL_MS = 60_000;

/** "Now" for the cards — ticks so the day strip's now-line and "up next" stay
 *  honest between polls without a reload. */
function useNow(): { nowMinutes: number; nowMs: number } {
  const [now, setNow] = useState(() => ({ nowMinutes: nowMinutesEt(), nowMs: Date.now() }));
  useEffect(() => {
    const id = setInterval(() => setNow({ nowMinutes: nowMinutesEt(), nowMs: Date.now() }), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const fmtN = (n: number) => n.toLocaleString();

/**
 * What the booking-link dialog was opened FOR.
 *
 * `locked` is set by a patient's card, where the card itself has already
 * decided which call this is; the header's own button leaves it false and
 * keeps the picker (Brandon, 2026-09-16).
 */
type LinkTarget =
  | { kind: BookingKind; locked: boolean; name?: string; phone?: string; email?: string }
  | null;

export default function CareCoordinatorPage() {
  const navigate = useNavigate();
  const { goBack } = useBackNavigation();
  const { access } = useAccessContext();
  const { nowMinutes, nowMs } = useNow();
  const today = etToday();

  // The third argument is the key the remembered row total is stored under
  // (lib/careCoordinator/loadProgress.ts). Stable strings.
  const intake = useBoardPoll(fetchIntakeLeads, POLL_MS, "intake");
  const welcome = useBoardPoll(fetchWelcomeCallItems, POLL_MS, "welcome");

  /** Every Welcome Call patient's booking, one gateway request (§5.31e). */
  const welcomeEmails = useMemo(() => (welcome.data ?? []).map((w) => w.email), [welcome.data]);
  const bookings = useWelcomeCallBookings(welcomeEmails);

  /**
   * Partial / Complete / All over the Patient Intake column (Brandon,
   * 2026-09-16).
   *
   * ⚠️ Applied BEFORE bucketing, not after, so the column's own counts — the
   * Today/Future header, each section's total — describe what is on screen.
   * Filtering the rendered lists alone would leave a header promising rows the
   * filter had just removed.
   *
   * ⚠️ The footer's "not shown" counts move with it too, and that is correct:
   * they are the honest account of THIS column, and a filtered column really
   * is excluding fewer patients.
   */
  const [formFilter, setFormFilter] = useState<FormFilter>("all");
  const intakeLeads = useMemo(
    () => (intake.data ?? []).filter((l) => matchesFormFilter(l, formFilter, INTAKE_FORM_GROUPS)),
    [intake.data, formFilter],
  );

  const ctx = useMemo(() => ({ today, nowMinutes, nowMs }), [today, nowMinutes, nowMs]);
  const intakeB = useMemo(
    () => intakeBuckets(intakeLeads, { ...ctx, formGroupIds: INTAKE_FORM_GROUP_IDS }),
    [intakeLeads, ctx],
  );
  const welcomeB = useMemo(
    () => welcomeCallBuckets(welcome.data ?? [], ctx, bookings.byEmail),
    [welcome.data, ctx, bookings.byEmail],
  );
  const summary = useMemo(() => summarize(intakeB, welcomeB), [intakeB, welcomeB]);
  // ⚠️ The strip reads the UNFILTERED list on purpose. It is the day's
  // schedule, not a view of this column, and the mirror rows are also what
  // give a Calendly intake booking its monday item id — narrowing them would
  // silently drop "Open" links from calls the filter has nothing to do with.
  const scheduleCalls = useMemo<ScheduledCall[]>(() => (intake.data ?? []).map(toScheduledCall), [intake.data]);

  /** Today / Future per column. Default Today, always (Brandon). */
  const [intakeHorizon, setIntakeHorizon] = useState<Horizon>("today");
  const [welcomeHorizon, setWelcomeHorizon] = useState<Horizon>("today");

  /** Booking-link dialog. */
  const [link, setLink] = useState<LinkTarget>(null);
  const linkForIntake = useCallback((lead: IntakeLead) =>
    setLink({ kind: "intake", locked: true, name: lead.name, phone: lead.phone, email: lead.email }), []);
  const linkForWelcome = useCallback((item: WelcomeCallItem) =>
    setLink({ kind: "welcome", locked: true, name: item.name, phone: item.phone, email: item.email }), []);

  /** The strip hands back a ready route — it knows which board a block belongs to. */
  const openFromGrid = useCallback((href: string) => navigate(href), [navigate]);

  /** Email → Welcome Call item, so a Calendly welcome-call booking can link to
   *  the patient's chart on the strip. Read from the column's own fetch. */
  const welcomeItems = useMemo(
    () => (welcome.data ?? []).map((w) => ({ id: w.id, email: w.email })),
    [welcome.data],
  );

  const refreshAll = () => { intake.refetch(); welcome.refetch(); bookings.refetch(); };
  const anyLoading = intake.loading || welcome.loading;

  const user = getUser();
  const who = access.type === "processor" ? access.profile.name || user?.name || user?.email : user?.name || user?.email;

  const ex = intakeB.excluded;
  const intakeNextUp = nextUp(intakeB.scheduledToday);
  const welcomeNextUp = nextUp(welcomeB.scheduledToday);

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <BookingLinkDialog
        open={link !== null}
        onOpenChange={(v) => { if (!v) setLink(null); }}
        defaultKind={link?.kind ?? "intake"}
        lockKind={link?.locked ?? false}
        patientName={link?.name}
        phone={link?.phone}
        email={link?.email}
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

          {/* The summary — an overview, not pills (Brandon, 2026-09-14). */}
          <dl className="ml-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:ml-8 sm:grid-cols-4" aria-label="Summary">
            <Stat label="Total in pipeline" value={summary.total} strong />
            <Stat label="Patient Intake" value={summary.intake.total} />
            <Stat label="Welcome Call" value={summary.welcome.total} />
            <Stat label="Overdue" value={summary.overdue} warn={summary.overdue > 0} />
          </dl>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setLink({ kind: "intake", locked: false })}
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
      </header>

      <main className="mx-auto max-w-[1600px] px-3 sm:px-6 py-5 space-y-5">
        {!hasMondayAuth() && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            No Monday connection is configured in this build, so nothing can load here.
          </div>
        )}
        <div className="space-y-2">
          <StaleDataNotice error={intake.error} scope="The Patient Intake column" onRetry={intake.refetch} />
          <StaleDataNotice error={welcome.error} scope="The Welcome Call column" onRetry={welcome.refetch} />
        </div>

        {/* The day strip comes FIRST — above the lists (Brandon). */}
        <ScheduleGrid
          calls={scheduleCalls}
          welcomeItems={welcomeItems}
          nowMinutes={nowMinutes}
          onOpen={openFromGrid}
          remindersOn={access.type === "processor" && access.profile.roles.includes("scheduledCalls")}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* ── Patient Intake ─────────────────────────────────── */}
          <PipelineColumn
            title="Patient Intake"
            accent="intake"
            summary={summary.intake}
            horizon={intakeHorizon}
            onHorizon={setIntakeHorizon}
            progress={intake.progress}
            controls={<FormFilterToggle value={formFilter} onChange={setFormFilter} />}
            footer={
              <IntakeFooter
                imported={ex.imported} nurturing={ex.nurturing} sendNow={ex.sendNow}
                callDone={ex.callDone} cleanUp={ex.cleanUp} withManager={intakeB.withManager}
              />
            }
          >
            {intake.loading && <Skeleton />}
            {!intake.loading && (
              <ColumnLists
                horizon={intakeHorizon}
                scheduledToday={intakeB.scheduledToday.map((e) => (
                  <IntakeScheduledCard key={e.item.id} entry={e} nextUp={e === intakeNextUp} onBookingLink={linkForIntake} />
                ))}
                scheduledFuture={intakeB.scheduledFuture.map((e) => (
                  <IntakeScheduledCard key={e.item.id} entry={e} nextUp={false} onBookingLink={linkForIntake} />
                ))}
                unscheduled={(intakeHorizon === "today" ? intakeB.unscheduledToday : intakeB.unscheduledFuture).map((e) => (
                  <IntakeUnscheduledCard key={e.item.id} entry={e} today={today} onBookingLink={linkForIntake} />
                ))}
              />
            )}
          </PipelineColumn>

          {/* ── Welcome Call ───────────────────────────────────── */}
          <PipelineColumn
            title="Welcome Call"
            accent="welcome"
            summary={summary.welcome}
            horizon={welcomeHorizon}
            onHorizon={setWelcomeHorizon}
            progress={welcome.progress}
            notice={<WelcomeBookingsNotice bookings={bookings} />}
            footer={
              <WelcomeFooter withManager={welcomeB.withManager} proposedStuck={welcomeB.proposedStuck} />
            }
          >
            {welcome.loading && <Skeleton />}
            {!welcome.loading && (
              <ColumnLists
                horizon={welcomeHorizon}
                scheduledToday={welcomeB.scheduledToday.map((e) => (
                  <WelcomeScheduledCard key={e.item.id} entry={e} nextUp={e === welcomeNextUp} onBookingLink={linkForWelcome} />
                ))}
                scheduledFuture={welcomeB.scheduledFuture.map((e) => (
                  <WelcomeScheduledCard key={e.item.id} entry={e} nextUp={false} onBookingLink={linkForWelcome} />
                ))}
                unscheduled={(welcomeHorizon === "today" ? welcomeB.unscheduledToday : welcomeB.unscheduledFuture).map((e) => (
                  <WelcomeUnscheduledCard key={e.item.id} entry={e} today={today} onBookingLink={linkForWelcome} />
                ))}
              />
            )}
          </PipelineColumn>
        </div>
      </main>
    </div>
  );
}

/**
 * The two sections of a column under one horizon.
 *
 * ⚠️ There used to be a second switch in here — "Today only" vs "Tomorrow+
 * too" on the Scheduled section — and it is gone (Brandon, 2026-09-16: "Only
 * have the today/future toggle on top, get rid of the today only tomorrow +
 * too below it on both sides"). One toggle now decides both sections, so
 * Today means today and Future means everything after it, with no second
 * control quietly widening one of them. It was also what made the two columns
 * drift out of alignment: the switch drew only under Today, so flipping a
 * column to Future changed the height of its Scheduled bar.
 */
function ColumnLists({ horizon, scheduledToday, scheduledFuture, unscheduled }: {
  horizon: Horizon;
  scheduledToday: React.ReactElement[];
  scheduledFuture: React.ReactElement[];
  unscheduled: React.ReactElement[];
}) {
  const scheduled = horizon === "future" ? scheduledFuture : scheduledToday;
  return (
    <>
      <Section title="Scheduled" count={scheduled.length} tone="scheduled">
        {scheduled}
      </Section>
      <Section title="Unscheduled" count={unscheduled.length} tone="unscheduled">
        {unscheduled}
      </Section>
    </>
  );
}

/**
 * What the Welcome Call column can say about its bookings.
 *
 * ⚠️ **AN UNFINISHED READ IS NOT "NOBODY IS BOOKED" EITHER**, and until
 * 2026-09-16 this only covered a FAILED one. Welcome calls exist in Calendly
 * alone, so every patient falls to Unscheduled until that read lands — and the
 * read cannot even start before the board read finishes, because the addresses
 * to ask about come from it. Measured against a slow gateway the same day: the
 * column sat at **Scheduled 0 · Unscheduled 15** with no notice at all, four
 * booked patients listed as people to ring, one of them five minutes out. That
 * is the same hole `useCalendlyDay.loaded` closed on the strip; `ready` is this
 * hook's version of it and the page simply never read it.
 *
 * Three states, never two: checking · could not check · fine.
 */
function WelcomeBookingsNotice({ bookings }: { bookings: ReturnType<typeof useWelcomeCallBookings> }) {
  const checking = bookings.available && !bookings.ready && !bookings.error;
  if (!checking && !bookings.error && bookings.available) return null;

  const Icon = checking ? Loader2 : AlertTriangle;
  const text = checking
    ? "Checking Calendly for welcome-call bookings — Scheduled isn't filled in yet."
    : bookings.available
      ? `Couldn't check Calendly for welcome-call bookings, so Scheduled may be incomplete. ${bookings.error}`
      : "Welcome-call bookings need the gateway, which isn't configured in this build — Scheduled can't be filled.";

  return (
    <p role="status" className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <Icon className={cn("mt-px h-3.5 w-3.5 shrink-0", checking && "animate-spin")} aria-hidden />
      <span>{text}</span>
    </p>
  );
}

/** Brandon's Partial / Complete / All filter, on the Patient Intake column. */
function FormFilterToggle({ value, onChange }: { value: FormFilter; onChange: (v: FormFilter) => void }) {
  return (
    <div className="flex rounded-md border bg-background p-0.5 text-[11px]" role="group" aria-label="Filter by web form">
      {FORM_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onChange(f)}
          aria-pressed={value === f}
          className={cn(
            "rounded px-2 py-0.5 font-medium",
            value === f ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {FORM_FILTER_LABEL[f]}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, strong = false, warn = false }: { label: string; value: number; strong?: boolean; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-[0.15em] opacity-70">{label}</dt>
      <dd className={cn("text-xl font-bold leading-tight tabular-nums", strong && "text-2xl", warn && "text-rose-200")}>{fmtN(value)}</dd>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border bg-card/60" />)}
    </div>
  );
}

/**
 * The honest small print. Every row in the form groups that is NOT on this
 * screen is counted here with its reason — a state that matches no view is
 * invisible app-wide (§7), and this column filters harder than any queue does.
 * The escalated ones are here too, with where to find them.
 */
function IntakeFooter({ imported, nurturing, sendNow, callDone, cleanUp, withManager }: {
  imported: number; nurturing: number; sendNow: number; callDone: number; cleanUp: number; withManager: number;
}) {
  const parts: string[] = [];
  if (withManager) parts.push(`${withManager} with a manager — see Oversight`);
  if (imported) parts.push(`${fmtN(imported)} imported/referral rows that never touched the web form — worked from Info Collection`);
  if (nurturing) parts.push(`${nurturing} inside the ${READY_AFTER_HOURS}-hour automated text/email window`);
  if (sendNow) parts.push(`${sendNow} completed form${sendNow === 1 ? "" : "s"} that chose "Send request now" — advance from Info Collection`);
  if (callDone) parts.push(`${callDone} with the intake call already marked complete`);
  if (cleanUp) parts.push(`${cleanUp} unbooked in Profile Clean-Up`);
  if (!parts.length) return null;
  return <>Not shown: {parts.join(" · ")}.</>;
}

function WelcomeFooter({ withManager, proposedStuck }: { withManager: number; proposedStuck: number }) {
  const parts: string[] = [];
  if (withManager) parts.push(`${withManager} with a manager — see Oversight`);
  if (proposedStuck) parts.push(`${proposedStuck} proposed stuck — awaiting a Final Decision in Oversight`);
  if (!parts.length) return null;
  return <>Not shown: {parts.join(" · ")}.</>;
}
