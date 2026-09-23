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
 * and they are worked from Oversight's manager columns (§7, §5.34).
 * ⚠️ They are no longer COUNTED here either: the footers that carried that
 * number went with Brandon's 2026-09-17 list (see the note above
 * `ColumnLists`). `intakeBuckets` still computes `withManager`, so the count
 * is one line away if it is ever wanted back.
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
import { useCalendlyBookings } from "@/hooks/careCoordinator/useCalendlyBookings";
import { CallPatientDialog, type CallTarget } from "@/components/careCoordinator/CallPatientDialog";
import {
  fetchIntakeLeads, fetchWelcomeCallItems, INTAKE_FORM_GROUPS, INTAKE_FORM_GROUP_IDS, NOTES_COLUMN,
} from "@/lib/careCoordinator/mondayApi";
import {
  bucketedLeads, intakeBuckets, nextUp, summarize, toScheduledCall, welcomeCallBuckets,
  type CalendlyLookup, type Horizon, type IntakeLead, type WelcomeCallItem,
} from "@/lib/careCoordinator/workflow";
import { EMPTY_SELECTION, matchesFacets, type FacetSelection } from "@/lib/careCoordinator/intakeFilter";
import { useCardNotes } from "@/hooks/careCoordinator/useCardNotes";
import { useContactStates } from "@/hooks/useContactStates";
import { contactKey } from "@/lib/contactState/contactState";
import { IntakeFilter } from "@/components/careCoordinator/IntakeFilter";
import { PipelineColumn, Section } from "@/components/careCoordinator/PipelineColumn";
import {
  IntakeReviewCard, IntakeScheduledCard, IntakeUnscheduledCard,
  WelcomeScheduledCard, WelcomeUnscheduledCard,
  type CardExtras,
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

  /**
   * Every patient's booking, ONE gateway request per column (§5.31e, §5.30d).
   *
   * ⚠️ **BOTH columns ask Calendly, and they ask for different KINDS.** They
   * share the gateway's one window index, so the second column costs a round
   * trip to the gateway and no extra Calendly reads at all. Before 2026-09-16
   * only the Welcome Call column asked and Patient Intake read the monday
   * mirror alone, which is how the strip and the column below it came to
   * disagree about who was booked.
   */
  const welcomeEmails = useMemo(() => (welcome.data ?? []).map((w) => w.email), [welcome.data]);
  const bookings = useCalendlyBookings(welcomeEmails, "welcome");
  const intakeEmails = useMemo(() => (intake.data ?? []).map((l) => l.email), [intake.data]);
  const intakeBookings = useCalendlyBookings(intakeEmails, "intake");
  const intakeCalendly = useMemo<CalendlyLookup>(
    () => ({ ready: intakeBookings.ready, byEmail: intakeBookings.byEmail, through: intakeBookings.through }),
    [intakeBookings.ready, intakeBookings.byEmail, intakeBookings.through],
  );

  /**
   * The five-facet filter over the Patient Intake column (Brandon, 2026-09-17),
   * replacing the Partial / Complete / All toggle.
   *
   * ⚠️ Applied BEFORE bucketing, not after, so the column's own counts — the
   * Today/Future header, each section's total — describe what is on screen.
   * Filtering the rendered lists alone would leave a header promising rows the
   * filter had just removed.
   */
  const [facets, setFacets] = useState<FacetSelection>(EMPTY_SELECTION);
  const allIntakeLeads = useMemo(() => intake.data ?? [], [intake.data]);
  const intakeLeads = useMemo(
    () => allIntakeLeads.filter((l) => matchesFacets(l, facets, INTAKE_FORM_GROUPS)),
    [allIntakeLeads, facets],
  );

  /**
   * Who we have actually got through to this week, and how many calls with
   * each number — ONE account-wide RingCentral read, shared by every card
   * (Brandon, 2026-09-17: the green text/phone icons, and `Call Log (3)`).
   *
   * ⚠️ **NOT a per-patient lookup, and it must never become one.** The call log
   * is one of RingCentral's more rate-limited endpoints, which is why
   * `CallHistoryButton` fetches on OPEN and why Josh declined a per-card count
   * on 2026-09-16 (§5.16, §5.30c). `useContactStates` is the batched,
   * module-cached, 5-minute-TTL read the manager sidebars already make, so a
   * page full of cards costs exactly what one card costs. It is enabled
   * unconditionally here — unlike the sidebars' `?mv=` gate — because this
   * whole page IS the coordinator's queue, and the marks are the point of it.
   */
  const contacts = useContactStates(true);

  /**
   * The patient the coordinator is on the phone with, or null.
   *
   * ⚠️ Held by the PAGE rather than the card so exactly one call dialog can be
   * open at a time, and so it survives the card re-rendering under it on a
   * poll. Cleared on close, which is also what discards the draft note — §9's
   * notes-box rule: a note typed for one patient must never be one press from
   * the next one's chart.
   */
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);

  const ctx = useMemo(() => ({ today, nowMinutes, nowMs }), [today, nowMinutes, nowMs]);
  const intakeB = useMemo(
    () => intakeBuckets(intakeLeads, { ...ctx, formGroupIds: INTAKE_FORM_GROUP_IDS, calendly: intakeCalendly }),
    [intakeLeads, ctx, intakeCalendly],
  );

  /**
   * The population the FILTER's options are counted over — every lead this
   * column can render, with no facet selection applied.
   *
   * ⚠️ **NOT `allIntakeLeads`, and that was the bug** (Brandon, 2026-09-22:
   * *"the filters look like it's taking from all of them (e.g. in equity type,
   * there's 1686 for not set)"*). 1,686 is the 8/25 SNJ import, which
   * `intakeBuckets` excludes — so every option was counted over rows the
   * column could never show, and the largest number in the control described a
   * population that is not on the screen.
   *
   * ⚠️ It buckets the UNFILTERED list, deliberately paying for a second fold:
   * counting over the filtered one makes a chosen facet's other values vanish,
   * and then there is no way to widen the selection again (§5.30e).
   */
  const facetPopulation = useMemo(
    () => bucketedLeads(intakeBuckets(allIntakeLeads, { ...ctx, formGroupIds: INTAKE_FORM_GROUP_IDS, calendly: intakeCalendly })),
    [allIntakeLeads, ctx, intakeCalendly],
  );
  const welcomeB = useMemo(
    () => welcomeCallBuckets(welcome.data ?? [], ctx, bookings.byEmail),
    [welcome.data, ctx, bookings.byEmail],
  );
  const summary = useMemo(() => summarize(intakeB, welcomeB), [intakeB, welcomeB]);

  /**
   * Notes for every card in each column, in one batched read per column
   * (Brandon, 2026-09-17: notes open by default, "See notes" gone).
   *
   * ⚠️ The ids come from the BUCKETS, i.e. the patients this column will
   * render — not from the raw board read. Patient Intake's read is ~1,754 rows
   * and the column shows a few dozen; asking for the notes of 1,700 rows the
   * coordinator cannot see is the §5.25 cost this page took out of the list
   * query in the first place.
   */
  const intakeNoteIds = useMemo(() => [
    ...intakeB.scheduledToday, ...intakeB.scheduledFuture,
    ...intakeB.unscheduledToday, ...intakeB.unscheduledFuture,
    // ⚠️ Review Profile rides the SAME batched notes read. Left out, those
    // cards would each show an empty notes line for ever — and the notes are
    // how a coordinator sees what the last call found out, which on this
    // bucket is the whole job (§5.30e: one request per COLUMN, never per card).
    ...intakeB.reviewProfile,
  ].map((e) => e.item.id), [intakeB]);
  const welcomeNoteIds = useMemo(() => [
    ...welcomeB.scheduledToday, ...welcomeB.scheduledFuture,
    ...welcomeB.unscheduledToday, ...welcomeB.unscheduledFuture,
  ].map((e) => e.item.id), [welcomeB]);
  const intakeNotes = useCardNotes(intakeNoteIds, NOTES_COLUMN.intake);
  const welcomeNotes = useCardNotes(welcomeNoteIds, NOTES_COLUMN.welcome);

  /**
   * Everything a card needs that the column fetched once on its behalf.
   *
   * ⚠️ `callCount` is withheld whenever the shared read came back at its page
   * cap. That read is a 7-day, page-capped window (`ACTIVITY_RECORD_LIMIT`), so
   * on a busy week its oldest calls fall off the end — and a count rendered on
   * screen as fact must not be quietly low. Undefined renders no parentheses at
   * all, which is the honest answer. The green icons are unaffected: a clipped
   * window can only fail to notice contact, which reads as "keep trying".
   */
  const extrasFor = useCallback((itemId: string, phone: string, notes: Map<string, string>): CardExtras => {
    const state = contacts.states?.get(contactKey(phone));
    return {
      notes: notes.get(itemId),
      reached: contacts.states ? { byText: !!state?.reachedByText, byCall: !!state?.reachedByCall } : undefined,
      callCount: contacts.states && !contacts.truncated ? (state?.calls ?? 0) : undefined,
      /* ⚠️ Present only once the read has landed, and ZEROES when it has but
         this patient is not in it — that is the honest reading: the window
         held nothing for them. Before it lands there are no rows at all,
         because four zeroes would be a claim nobody has touched them. */
      contact: contacts.states
        ? {
            callsOut: state?.callsOut ?? 0,
            callsIn: state?.callsIn ?? 0,
            textsOut: state?.textsOut ?? 0,
            textsIn: state?.textsIn ?? 0,
            callsClipped: contacts.truncated,
            textsClipped: contacts.textsTruncated,
          }
        : undefined,
      onCall: setCallTarget,
    };
  }, [contacts.states, contacts.truncated, contacts.textsTruncated]);
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

  /**
   * Refresh: the two board reads AND both Calendly lookups.
   *
   * ⚠️ `refreshing` is its own flag, not `intake.loading || welcome.loading`.
   * Those are "until the FIRST read settles" by design (`useBoardPoll`), so
   * they are false forever after the page has loaded — the spin animation on
   * this button could only ever have fired once, on a press nobody makes. A
   * Refresh that looks like it did nothing gets pressed again.
   */
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(() => {
    setRefreshing(true);
    bookings.refetch();
    intakeBookings.refetch();
    void Promise.allSettled([intake.refetch(), welcome.refetch()]).finally(() => setRefreshing(false));
  }, [bookings, intakeBookings, intake, welcome]);
  const anyLoading = intake.loading || welcome.loading || refreshing;

  const user = getUser();
  const who = access.type === "processor" ? access.profile.name || user?.name || user?.email : user?.name || user?.email;

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
          {/* ⚠️ Three stats, not four — "Overdue" is gone (Brandon, 2026-09-22:
              "get rid of the 0 overdue on top in the banner"). It read 0 for
              essentially everybody, because an unscheduled lead is only
              overdue once a follow-up DATE has passed and almost none of this
              column has one. `summarize` still computes it, so nothing about
              the rule moved and putting the stat back is one line. */}
          <dl className="ml-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:ml-8 sm:grid-cols-3" aria-label="Summary">
            <Stat label="Total in pipeline" value={summary.total} strong />
            <Stat label="Patient Intake" value={summary.intake.total} />
            <Stat label="Welcome Call" value={summary.welcome.total} />
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
            notice={<IntakeBookingsNotice bookings={intakeBookings} />}
            controls={
              <IntakeFilter
                leads={facetPopulation}
                groups={INTAKE_FORM_GROUPS}
                selection={facets}
                onChange={setFacets}
                onClearAll={() => setFacets(EMPTY_SELECTION)}
                shown={intakeLeads.length}
                total={facetPopulation.length}
              />
            }
          >
            {/* ⚠️ The skeleton goes the moment there is ANYTHING to show, not
                when the read settles. Patient Intake streams its pages on a
                cold load (`useBoardPoll`'s batch callback), so gating on
                `loading` alone would keep the skeleton up for all four round
                trips and throw the first three away. The load bar above stays
                for the whole read, which is what says the list is still
                growing. */}
            {intake.loading && !intake.data && <Skeleton />}
            {intake.data && (
              <ColumnLists
                horizon={intakeHorizon}
                scheduledToday={intakeB.scheduledToday.map((e) => (
                  <IntakeScheduledCard key={e.item.id} entry={e} nextUp={e === intakeNextUp} onBookingLink={linkForIntake}
                    extras={extrasFor(e.item.id, e.item.phone, intakeNotes)} />
                ))}
                scheduledFuture={intakeB.scheduledFuture.map((e) => (
                  <IntakeScheduledCard key={e.item.id} entry={e} nextUp={false} onBookingLink={linkForIntake}
                    extras={extrasFor(e.item.id, e.item.phone, intakeNotes)} />
                ))}
                unscheduled={(intakeHorizon === "today" ? intakeB.unscheduledToday : intakeB.unscheduledFuture).map((e) => (
                  <IntakeUnscheduledCard key={e.item.id} entry={e} today={today} onBookingLink={linkForIntake}
                    extras={extrasFor(e.item.id, e.item.phone, intakeNotes)} />
                ))}
                review={intakeB.reviewProfile.map((e) => (
                  <IntakeReviewCard key={e.item.id} entry={e} today={today} onBookingLink={linkForIntake}
                    extras={extrasFor(e.item.id, e.item.phone, intakeNotes)} />
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
          >
            {welcome.loading && <Skeleton />}
            {!welcome.loading && (
              <ColumnLists
                horizon={welcomeHorizon}
                scheduledToday={welcomeB.scheduledToday.map((e) => (
                  <WelcomeScheduledCard key={e.item.id} entry={e} nextUp={e === welcomeNextUp} onBookingLink={linkForWelcome}
                    extras={extrasFor(e.item.id, e.item.phone, welcomeNotes)} />
                ))}
                scheduledFuture={welcomeB.scheduledFuture.map((e) => (
                  <WelcomeScheduledCard key={e.item.id} entry={e} nextUp={false} onBookingLink={linkForWelcome}
                    extras={extrasFor(e.item.id, e.item.phone, welcomeNotes)} />
                ))}
                unscheduled={(welcomeHorizon === "today" ? welcomeB.unscheduledToday : welcomeB.unscheduledFuture).map((e) => (
                  <WelcomeUnscheduledCard key={e.item.id} entry={e} today={today} onBookingLink={linkForWelcome}
                    extras={extrasFor(e.item.id, e.item.phone, welcomeNotes)} />
                ))}
              />
            )}
          </PipelineColumn>
        </div>
      </main>

      {/* ⚠️ Keyed on the patient, so the draft note cannot survive a change of
          patient — §9's notes-box rule, which this codebase records costing a
          note filed against the wrong chart. */}
      <CallPatientDialog
        key={callTarget?.itemId ?? "none"}
        target={callTarget}
        onClose={() => setCallTarget(null)}
        onLogged={() => { void intake.refetch(); void welcome.refetch(); }}
      />
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
function ColumnLists({ horizon, scheduledToday, scheduledFuture, unscheduled, review }: {
  horizon: Horizon;
  scheduledToday: React.ReactElement[];
  scheduledFuture: React.ReactElement[];
  unscheduled: React.ReactElement[];
  /** Review Profile — Patient Intake only; omitted on Welcome Call. */
  review?: React.ReactElement[];
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
      {/* ⚠️ Rendered under TODAY only, and that is the rule rather than a
          layout choice: nothing dates a Review Profile patient — no follow-up
          date, no booking — so they belong to neither horizon, and "Future"
          promises a date that will bring them back. Today is where a
          coordinator looks for work with no clock on it (§5.30's blank-date
          rule for Unscheduled, one bucket over). A logged attempt gives them a
          date and moves them to Unscheduled → Future, which is the whole
          transition Brandon described. */}
      {review && horizon === "today" && (
        <Section title="Review Profile" count={review.length} tone="review">
          {review}
        </Section>
      )}
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
function WelcomeBookingsNotice({ bookings }: { bookings: ReturnType<typeof useCalendlyBookings> }) {
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

/**
 * The same three states for Patient Intake — with one difference that matters.
 *
 * ⚠️ This column has a FALLBACK and the Welcome Call column does not: a failed
 * or unfinished Calendly read leaves it showing the monday mirror's bookings
 * (`workflow.intakeBooking`), which is a real answer, just an older and
 * lossier one. So the sentence says what is on screen — "showing the bookings
 * mirrored onto monday" — rather than the Welcome Call column's "Scheduled
 * isn't filled in yet", which would be false here.
 */
function IntakeBookingsNotice({ bookings }: { bookings: ReturnType<typeof useCalendlyBookings> }) {
  const checking = bookings.available && !bookings.ready && !bookings.error;
  if (!checking && !bookings.error && bookings.available) return null;

  const Icon = checking ? Loader2 : AlertTriangle;
  const text = checking
    ? "Checking Calendly — Scheduled is showing the bookings mirrored onto monday until it answers."
    : bookings.available
      ? `Couldn't read Calendly, so Scheduled is showing the bookings mirrored onto monday — a booking made under an address the board doesn't hold won't be here. ${bookings.error}`
      : "Calendly needs the gateway, which isn't configured in this build — Scheduled is showing the bookings mirrored onto monday.";

  return (
    <p role="status" className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <Icon className={cn("mt-px h-3.5 w-3.5 shrink-0", checking && "animate-spin")} aria-hidden />
      <span>{text}</span>
    </p>
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

/* ⚠️ **THE "NOT SHOWN" FOOTERS ARE GONE** (Brandon, 2026-09-17: *"Delete 'Not
 * shown: 8 with a manager — see Oversight · 19 completed forms that chose
 * "Send request now" — advance from Info Collection.'"*). `IntakeFooter` and
 * `WelcomeFooter` counted every row the column excluded, with its reason.
 *
 * ⚠️ That was §7's rule on the page — a state that matches no view is invisible
 * app-wide — and this is the one deletion in his list that costs something
 * real: the ~1,697 imported/8-25-bulk rows Patient Intake excludes are now
 * accounted for nowhere on this screen. It is a deliberate trade he asked for
 * twice over (both footers named), on a page he reads every day, and the
 * numbers are still derivable: `intakeBuckets` computes `excluded` and
 * `withManager` exactly as before and nothing else changed. Do not re-add the
 * lines without asking him; if the imported rows ever need surfacing again, a
 * facet on the filter is the place that does it without re-adding a paragraph.
 */
