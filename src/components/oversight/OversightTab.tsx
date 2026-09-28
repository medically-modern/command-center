/**
 * OversightTab — pipeline oversight dashboard with 12 bar charts in a
 * compact 3×4 grid that fits on one screen. Clicking a chart opens a
 * modal drill-down table overlay.
 *
 * Data is fetched from Monday.com via oversightApi, cached in localStorage
 * for instant reload, and polled every 90 seconds.
 *
 * ⚠️ **Brandon's `viewOversight` look (pixel-match Phase 7, §5.52) is VISUAL
 * ONLY.** `oversight.css` restyles the header, the columns and the chart cards
 * under `.cc-ov`; the finder and the pinned patient read the Map this tab
 * already holds (`lib/oversight/oversightFocus`) and act through the SAME
 * routes and decision writers the drill-down uses. Josh, 2026-09-24: *"a
 * search inside oversight would be helpful but it would need to be keyed on
 * only patients that are IN oversight"* — so it asks Monday nothing.
 */
import { Fragment, useState, useEffect, useCallback, useId, useMemo, useRef } from "react";
import "./oversight.css";
import {
  fetchOversightData,
  fetchPriorityOptions,
  fetchPillColors,
  approveProposedStuck,
  returnProposedToQueue,
  approveInsuranceStuck,
  returnInsuranceToQueue,
  escalateSubmitAuthToFinal,
  reasonBucketsFor,
  CHART_DEFS,
  OVERSIGHT_SECTIONS,
  DAY_BUCKET_LABELS,
  DAY_BUCKET_COLORS,
  APPENDIX_BUCKET,
  matchesAppendixBar,
  PROFILE_FORM_GROUP_COMPLETED,
  PROFILE_FORM_GROUP_PARTIAL,
  type OversightPatient,
  type ChartDef,
  type DayBucketLabel,
} from "@/lib/oversight/oversightApi";
// Patient Intake's decisions live with that stage's writer, not in oversightApi:
// they share the escalation ladder and the Call Log stamp with the role page, so
// a second copy here is exactly the drift the keep-in-agreement rules exist for.
import {
  approveIntakeStuck, returnIntakeToPipeline, proposeIntakeStuck,
} from "@/lib/profile/unverifiedWrite";
// Same rule for the Welcome Call board (§5.34): its ladder writers live with
// its write layer, shared with the two stage pages, never re-spelt here.
import {
  approveWelcomeCallStuck, returnWelcomeCallToQueue, escalateWelcomeCallToFinal,
} from "@/lib/welcomeCall/mondayWrite";
// The in-oversight finder, the pinned patient and the decision rules the
// drill-down shares with it (§5.52) — one reading of "which rows get a
// button", never a second copy in this file.
import {
  pipelinePeople,
  searchPipeline,
  seniorChart,
  columnOf,
  decisionActions,
  decisionCopy,
  isBotOwnedRow,
  searchFootLine,
  searchEmptyLine,
  type DecisionAction,
  type PipelinePerson,
} from "@/lib/oversight/oversightFocus";
import { extractProposedStuckReason } from "@/lib/masheke/proposedStuck";
import { returnAttemptReset } from "@/lib/masheke/attemptRollup";
import { etTodayYmd } from "@/lib/samantha/benefitsDerive";
import { MANAGER_ORIGIN_PARAM, MANAGER_CHART_PARAM, MANAGER_BUCKET_PARAM, PIN_DEEP_LINK_PARAM } from "@/lib/shared/managerOrigin";
import { getUser } from "@/lib/shared/auth";
import { useAccessContext } from "@/components/AccessProvider";
import { Loader2, BarChart3, X, ExternalLink, StickyNote, Search, ArrowUp, ArrowDown, ArrowUpDown, Star, SlidersHorizontal, Plus, Trash2, RotateCcw, Flag, RefreshCw, User } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  loadPriorityConfig,
  savePriorityConfig,
  isVip,
  DEFAULT_PRIORITY_CONFIG,
  DAY_BUCKETS_ORDERED,
  type PriorityConfig,
  type PriorityTier,
} from "@/lib/oversight/priority";

// ── Chart ID → Command Center route mapping ──────────────────────────────

const CHART_ROUTES: Record<string, string | null> = {
  "dtc-partial-leads": null,        // no CC view
  "dtc-raw-intake": null,           // no CC view
  // Profile Send Off split by referral: Verified → /profile, Unverified →
  // /unverified-referrals, Already In System → /in-system-referrals (patients
  // still open via ?patientId injection regardless of the page's own filter).
  "profile-send-off": "/profile",
  "profile-send-off-unverified": "/unverified-referrals",
  "profile-send-off-in-system": "/in-system-referrals",
  // Both intake manager charts open the same stage page in manager mode. Without
  // these, CHART_ROUTES[chartId] is undefined and handlePatientClick toasts
  // "This stage doesn't have a dedicated page yet" — a manager could see the
  // escalated patient on the bar and had no way to open them.
  "profile-send-off-unverified-escalated": "/unverified-referrals",
  "profile-send-off-unverified-stuck": "/unverified-referrals",
  // §5.20 — Clean-Up's three route to the page that renders the RIGHT pane.
  // Sending a manager to /unverified-referrals would show them the left pane
  // alone, i.e. not the work the chart is about.
  "profile-send-off-cleanup": "/profile-cleanup",
  "profile-send-off-cleanup-escalated": "/profile-cleanup",
  "profile-send-off-cleanup-stuck": "/profile-cleanup",
  "evaluate": "/evaluate",
  "send-request": "/send-request",
  "confirm-receipt": "/confirm-receipt",
  "confirm-receipt-escalations": "/confirm-receipt",
  // Chase split by method: Fax → fax role page, Email & Parachute → parachute role page
  // (patients still open via ?patientId injection regardless of the page's own filter).
  "chase-fax": "/chase-fax",
  "chase-email-parachute": "/chase-parachute",
  "chase-fax-escalations": "/chase-fax",
  "chase-email-parachute-escalations": "/chase-parachute",
  // 3rd-Attempt escalation charts — route like their base stage.
  "evaluate-escalated-3rd": "/evaluate",
  "send-request-escalated-3rd": "/send-request",
  "confirm-receipt-escalated-3rd": "/confirm-receipt",
  "chase-fax-escalated-3rd": "/chase-fax",
  "chase-email-parachute-escalated-3rd": "/chase-parachute",
  // Manager views (2026-07): merged escalation charts route like their base
  // stage. Final Decisions (Proposed Stuck) charts also route to the stage page
  // (opened in manager mode) so the manager can view/work the patient in the UI;
  // the Approve/Return actions still live in the drill-down itself.
  "evaluate-escalated-merged": "/evaluate",
  "send-request-escalated-merged": "/send-request",
  "confirm-receipt-escalated-merged": "/confirm-receipt",
  "chase-fax-escalated-merged": "/chase-fax",
  "chase-email-parachute-escalated-merged": "/chase-parachute",
  "evaluate-proposed-stuck": "/evaluate",
  "send-request-proposed-stuck": "/send-request",
  "confirm-receipt-proposed-stuck": "/confirm-receipt",
  "chase-fax-proposed-stuck": "/chase-fax",
  "chase-email-parachute-proposed-stuck": "/chase-parachute",
  // Insurance Final Decisions charts — like the ME Proposed Stuck charts, these
  // route to the stage page (manager mode) so the manager can view/work the
  // patient; the Approve/Return actions still live in the drill-down itself.
  "benefits-final-escalation": "/benefits",
  // Reason-bucketed since 2026-08-02 and therefore stage-mixed, exactly like
  // "submit-auth-manager": DVS rows open the DVS monitor, and a proposed-stuck
  // row is overridden to /submit-auth per patient in handlePatientClick.
  "submit-auth-final-escalation": "/dvs",
  "auth-outstanding-final-escalation": "/auth-outstanding",
  // Manager Intervention: managers click through to work the patient.
  "benefits-manager-escalation": "/benefits",
  // DVS charts open the DVS monitor page for the clicked patient (?patientId
  // deep-link + ?from=system-mgmt), i.e. the same DVS UI a rep clicks into.
  // Merged Manager Intervention chart (2026-07-29): DVS rows open the DVS
  // monitor; a Submit Auth proposed-stuck row opens /submit-auth instead —
  // handlePatientClick overrides per patient by their Stage Advancer.
  "submit-auth-manager": "/dvs",
  "benefits": "/benefits",
  "submit-auth": "/submit-auth",
  "auth-outstanding": "/auth-outstanding",
  "auth-denial": null,              // no CC view yet
  "welcome-call": "/welcome-call",
  // Welcome Call board manager views (§5.34) — every column opens the stage
  // page in manager mode, whose sidebar then lists that column's cohort.
  "welcome-call-manager": "/welcome-call",
  "welcome-call-final": "/welcome-call",
  "profile-review": "/final-confirm",
  "profile-review-manager": "/final-confirm",
  "profile-review-final": "/final-confirm",
  // Doctor Appointments — all three columns open the outreach page. The work is
  // calling the PATIENT; the chase UI would show the wrong job entirely.
  "doctor-appointments": "/doctor-appointments",
  "doctor-appointments-manager": "/doctor-appointments",
  "doctor-appointments-final": "/doctor-appointments",
};

/** Days Since Stage Started — the cell the snooze tag rides in. */
const DAYS_IN_STAGE_COL = "color_mm1wwm05";

/**
 * "MM/DD" when this Follow Up Date snoozes the patient, else null.
 *
 * Mirrors `isSnoozedAuthOutstanding` — future date = snoozed, blank = due —
 * on the raw Monday text (yyyy-mm-dd, timezone-naive ET, so the string compare
 * is the date compare and no `new Date()` is involved; CLAUDE.md §9).
 */
function snoozedUntil(raw: string | undefined): string | null {
  const ymd = (raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (ymd <= etTodayYmd()) return null;
  return `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}`;
}

// ⚠️ `isBotOwnedRow` and the per-kind decision copy MOVED to
// `lib/oversight/oversightFocus` (§5.52) when the pinned patient card needed
// them too. Import them; never re-declare them here — two copies of "which rows
// get a button" is how one column offers a decision the other refuses.

// ── Constants ──────────────────────────────────────────────────────────────

const POLL_MS = 90_000;
const LS_CACHE_KEY = "oversight-cache";

/** Brandon's `fmt` — thousands separators, en-US. Kept here rather than
 *  imported from `reports/reportsRules`, which would drag the patient screen and
 *  the orders slice into this chunk for a one-liner. */
const fmt = (n: number) => n.toLocaleString("en-US");

// ── One card frame for all three chart kinds (Brandon, 2026-08-12) ──
// The cards used to size themselves to their content, so a row's three columns
// came out at three different heights: the stacked Manager Intervention chart
// carries a legend line under its title, and the reason charts grow a footnote
// only when there is something to footnote. `h-full` makes every card fill its
// grid row (grid items stretch, so the row is the tallest card) and the plot
// area takes the slack — which also lines the x-axis labels up across the row.
// Any new chart kind must use these two or it will be the odd one out again.
//
// ⚠️ `hist` / `hbars` are Brandon's card and plot (§5.52, `oversight.css`). The
// Tailwind classes stay: `.cc-ov .hist …` outranks every single-class utility,
// so they only ever show through in a host that does not load that stylesheet.
const CHART_CARD_CLASS =
  "h-full flex flex-col rounded-2xl border bg-card shadow-sm p-4 transition-all duration-200 border-border hover:shadow-md hover:ring-1 hover:ring-foreground/10 hist";
/** The bars. min-h keeps the old 200px floor when a row has nothing taller
 *  (Brandon's `.hbars` lowers it to his 120px under `.cc-ov`). */
const CHART_PLOT_CLASS = "flex items-end gap-1.5 flex-1 min-h-[200px] hbars";

/**
 * The "+N unknown" / "+N in no bar" line under a chart.
 *
 * Always rendered, even with nothing to say: an appearing/disappearing line
 * changes the card's height, which is half of what made the columns ragged.
 * Empty parts are dropped, and an empty line still holds its row.
 */
function ChartFootnote({ parts }: { parts: string[] }) {
  const text = parts.filter(Boolean).join(" · ");
  return (
    <p className="text-[9px] text-muted-foreground mt-1.5 text-right min-h-[0.875rem] unk" aria-hidden={!text}>
      {text}
    </p>
  );
}

/**
 * Placeholder for one bar chart while Monday is queried. Mirrors StageChart's
 * frame (card, title row, count, 8 day-bucket bars) so the real charts drop
 * straight into the same boxes without the layout shifting.
 *
 * Bar heights come from `seed`, not Math.random: a re-render mid-fetch must not
 * reshuffle the skeleton, which reads as flicker rather than loading.
 */
function ChartSkeleton({ seed }: { seed: number }) {
  return (
    <div className="h-full rounded-xl bg-card border shadow-card p-4 hist">
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-8" />
      </div>
      <div className="flex items-end gap-1.5 h-[120px]">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-sm"
            // Deterministic pseudo-random heights: varied enough to read as a
            // chart, stable across renders.
            style={{ height: `${18 + ((seed * 7 + i * 29) % 70)}%` }}
          />
        ))}
      </div>
      <div className="flex gap-1.5 mt-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="flex-1 h-2" />
        ))}
      </div>
    </div>
  );
}

// ── "Requesting" summary (Send Request / Confirm Receipt / Chase) ─────────
// Derived from the MN Request Consolidated dropdown — the actual doctor-facing
// ask list. Up to four pills:
//   CGM Script / IP Script  → that script document is being requested
//   MR                      → medical records document is being requested
//   Language in MR          → records exist but coverage language is missing
// MR and "Language in MR" are mutually exclusive: if we still need the records
// document, we don't separately call out the language.
const REQ_CONSOLIDATED_COL = "dropdown_mm2yd3a2";
const REQ_COLORS: Record<string, string> = {
  "CGM Script": "#0ea5e9",
  "IP Script": "#8b5cf6",
  MR: "#f59e0b",
  "Language in MR": "#db2777",
};
const LANG_KEYWORDS = [
  "language",
  "education",
  "injection",
  "blood sugar",
  "cgm use",
  "current cgm",
  "hypoglyc",
];

function requestingPills(p: OversightPatient): string[] {
  const items = (p.cols[REQ_CONSOLIDATED_COL] ?? "").toLowerCase();
  if (!items.trim()) return [];
  const pills: string[] = [];
  if (items.includes("cgm script")) pills.push("CGM Script");
  if (items.includes("pump script")) pills.push("IP Script");
  const needsMr = items.includes("medical records") || items.includes("letter of medical necessity");
  if (needsMr) {
    pills.push("MR");
  } else if (LANG_KEYWORDS.some((k) => items.includes(k))) {
    pills.push("Language in MR");
  }
  return pills;
}

/** Abbreviated labels for bar chart x-axis */
const BUCKET_SHORT_LABELS: Record<DayBucketLabel, string> = {
  "0–2 Days": "0-2",
  "3–5 Days": "3-5",
  "6–8 Days": "6-8",
  "9–12 Days": "9-12",
  "13-15 Days": "13-15",
  "16-20 Days": "16-20",
  "21-29 Days": "21-29",
  "30+ Days": "30+",
};

// ── LocalStorage cache helpers ─────────────────────────────────────────────

type CacheShape = Record<string, OversightPatient[]>;

function loadCache(): Map<string, OversightPatient[]> | null {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    const map = new Map<string, OversightPatient[]>();
    for (const [k, v] of Object.entries(parsed)) map.set(k, v);
    return map;
  } catch {
    return null;
  }
}

function persistCache(data: Map<string, OversightPatient[]>): void {
  try {
    const obj: CacheShape = {};
    for (const [k, v] of data.entries()) obj[k] = v;
    localStorage.setItem(LS_CACHE_KEY, JSON.stringify(obj));
  } catch {
    /* quota exceeded or private browsing */
  }
}

// ── Bucket ordering for sort ───────────────────────────────────────────────

const BUCKET_ORDER: Record<string, number> = {};
DAY_BUCKET_LABELS.forEach((label, i) => {
  BUCKET_ORDER[label] = i;
});
BUCKET_ORDER["Unknown"] = DAY_BUCKET_LABELS.length;

function bucketSortValue(bucket: DayBucketLabel | "Unknown"): number {
  return BUCKET_ORDER[bucket] ?? DAY_BUCKET_LABELS.length;
}

// ── StageChart (compact card) ─────────────────────────────────────────────

interface StageChartProps {
  chart: ChartDef;
  patients: OversightPatient[];
  priorityConfig: PriorityConfig;
  onChartClick: () => void;
  /** A DayBucketLabel, or APPENDIX_BUCKET when the appendix bar is clicked. */
  onBarClick: (bucket: string) => void;
}

const VIP_COLOR = "var(--mm-teal)";

/** Form-group filter for the Patient Intake charts. The DTC form splits its
 *  own queue into Completed and Partial groups, and a manager wants to see
 *  either half on its own — a partial fill-out isn't workable the way a
 *  finished one is, so mixing them flattens two different problems into one
 *  set of day buckets. Every other chart is unaffected. */
const FORM_GROUP_FILTERS = [
  { key: "all", label: "All", groupId: null as string | null },
  { key: "completed", label: "Completed", groupId: PROFILE_FORM_GROUP_COMPLETED },
  { key: "partial", label: "Partial", groupId: PROFILE_FORM_GROUP_PARTIAL },
] as const;

function StageChart({ chart, patients: allPatients, priorityConfig, onChartClick, onBarClick }: StageChartProps) {
  const [formFilter, setFormFilter] = useState<string>("all");
  // Only the intake charts carry the toggle — they are the only ones whose
  // population spans the two form groups.
  const showsFormToggle = chart.id.startsWith("profile-send-off-unverified");
  const patients = useMemo(() => {
    if (!showsFormToggle || formFilter === "all") return allPatients;
    const gid = FORM_GROUP_FILTERS.find((f) => f.key === formFilter)?.groupId;
    return gid ? allPatients.filter((p) => p.groupId === gid) : allPatients;
  }, [allPatients, formFilter, showsFormToggle]);

  const bucketCounts = useMemo(() => {
    const counts: Record<DayBucketLabel, number> = {} as Record<DayBucketLabel, number>;
    const vipCounts: Record<DayBucketLabel, number> = {} as Record<DayBucketLabel, number>;
    for (const label of DAY_BUCKET_LABELS) {
      counts[label] = 0;
      vipCounts[label] = 0;
    }
    let unknownCount = 0;
    let totalVip = 0;
    // Appendix-bar patients are counted separately and REMOVED from the day
    // buckets — a patient parked six weeks for a doctor appointment would
    // otherwise sit in "30+ Days" reading as a rotting case every day until
    // the visit (ChartDef.appendixBar).
    let appendixCount = 0;
    let appendixVip = 0;

    for (const p of patients) {
      const vip = isVip(p, priorityConfig);
      if (vip) totalVip++;
      if (chart.appendixBar && matchesAppendixBar(chart, p)) {
        appendixCount++;
        if (vip) appendixVip++;
        continue;
      }
      if (p.dayBucket === "Unknown") {
        unknownCount++;
      } else {
        counts[p.dayBucket]++;
        if (vip) vipCounts[p.dayBucket]++;
      }
    }
    return { counts, vipCounts, unknownCount, totalVip, appendixCount, appendixVip };
  }, [patients, priorityConfig, chart]);

  const { counts, vipCounts, unknownCount, totalVip, appendixCount, appendixVip } = bucketCounts;
  const totalCount = patients.length;
  const maxCount = useMemo(
    () => Math.max(1, ...Object.values(counts)),
    [counts],
  );

  return (
    <div className={cn(CHART_CARD_CLASS, "text-left w-full")}>
      {showsFormToggle && (
        // Brandon's `.hist .toggle` (§5.52): the look is his, the filter is ours.
        <div className="toggle">
          {FORM_GROUP_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={formFilter === f.key}
              onClick={(e) => { e.stopPropagation(); setFormFilter(f.key); }}
              className={formFilter === f.key ? "on" : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Header — clickable to show all patients */}
      <button
        onClick={onChartClick}
        className="flex items-center justify-between mb-3 w-full text-left group cursor-pointer h"
      >
        <h3 className="text-[0.95rem] font-bold tracking-tight text-foreground truncate min-w-0 group-hover:underline decoration-foreground/30 underline-offset-4 t">
          {chart.title}
        </h3>
        <div className="flex items-center gap-1.5 ml-2 shrink-0 n">
          {totalVip > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: VIP_COLOR }}
              title={`${totalVip} priority patient${totalVip !== 1 ? "s" : ""}`}
            >
              <Star className="h-2.5 w-2.5 fill-white" />
              {totalVip}
            </span>
          )}
          <span className="text-2xl font-bold text-foreground tabular-nums leading-none tn">
            {totalCount}
          </span>
        </div>
      </button>

      {/* Bar chart — each bar clickable to filter */}
      <div className={CHART_PLOT_CLASS}>
        {DAY_BUCKET_LABELS.map((label) => {
          const count = counts[label];
          const vip = vipCounts[label];
          const heightPct = count > 0 ? (count / maxCount) * 100 : 0;

          return (
            <button
              key={label}
              onClick={(e) => {
                e.stopPropagation();
                if (count > 0) onBarClick(label);
              }}
              className={cn(
                "flex-1 flex flex-col items-center justify-end h-full group/bar",
                count > 0 ? "cursor-pointer" : "cursor-default",
              )}
              title={`${label}: ${count} patient${count !== 1 ? "s" : ""}${vip > 0 ? ` · ${vip} VIP` : ""}`}
            >
              {/* VIP count (gold ★) for this bucket */}
              <span className="text-[8px] font-bold leading-none h-2.5" style={{ color: vip > 0 ? VIP_COLOR : "transparent" }}>
                {vip > 0 ? `★${vip}` : "★"}
              </span>

              {/* Count above bar */}
              <span className="text-[9px] tabular-nums font-semibold mb-0.5 text-muted-foreground h-3">
                {count > 0 ? count : ""}
              </span>

              {/* Bar — VIP portion highlighted gold at the top */}
              <div className="w-full flex items-end justify-center flex-1">
                <div
                  className={cn(
                    "w-full rounded-t-md overflow-hidden flex flex-col justify-start transition-all duration-300 ease-out",
                    count > 0 && "group-hover/bar:opacity-80 group-hover/bar:ring-1 group-hover/bar:ring-foreground/30",
                    count === 0 && "invisible",
                  )}
                  style={{
                    height: count > 0 ? `${Math.max(heightPct, 3)}%` : "0%",
                    backgroundColor: DAY_BUCKET_COLORS[label],
                    minHeight: count > 0 ? "4px" : undefined,
                  }}
                >
                  {vip > 0 && (
                    <div
                      style={{ height: `${(vip / count) * 100}%`, backgroundColor: VIP_COLOR }}
                      title={`${vip} VIP`}
                    />
                  )}
                </div>
              </div>

              {/* Label below */}
              <span className="text-[8px] mt-1 text-muted-foreground whitespace-nowrap">
                {BUCKET_SHORT_LABELS[label]}
              </span>
            </button>
          );
        })}

        {/* Appendix bar — sectioned off to the right of "30+" by a rule and a
            wider gap, because it isn't on the days axis at all. */}
        {chart.appendixBar && (
          <>
            <div
              className="self-stretch w-px shrink-0 mx-1"
              style={{ backgroundColor: "var(--border)" }}
              aria-hidden="true"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (appendixCount > 0) onBarClick(APPENDIX_BUCKET);
              }}
              className={cn(
                "flex-1 flex flex-col items-center justify-end h-full group/bar",
                appendixCount > 0 ? "cursor-pointer" : "cursor-default",
              )}
              title={`${chart.appendixBar.label}: ${appendixCount} patient${appendixCount !== 1 ? "s" : ""}${appendixVip > 0 ? ` · ${appendixVip} VIP` : ""}`}
            >
              <span
                className="text-[8px] font-bold leading-none h-2.5"
                style={{ color: appendixVip > 0 ? VIP_COLOR : "transparent" }}
              >
                {appendixVip > 0 ? `★${appendixVip}` : "★"}
              </span>
              <span className="text-[9px] tabular-nums font-semibold mb-0.5 text-muted-foreground h-3">
                {appendixCount > 0 ? appendixCount : ""}
              </span>
              <div className="w-full flex items-end justify-center flex-1">
                <div
                  className={cn(
                    "w-full rounded-t-md overflow-hidden flex flex-col justify-start transition-all duration-300 ease-out",
                    appendixCount > 0 &&
                      "group-hover/bar:opacity-80 group-hover/bar:ring-1 group-hover/bar:ring-foreground/30",
                    appendixCount === 0 && "invisible",
                  )}
                  style={{
                    height: appendixCount > 0 ? `${Math.max((appendixCount / maxCount) * 100, 3)}%` : "0%",
                    backgroundColor: chart.appendixBar.color,
                    minHeight: appendixCount > 0 ? "4px" : undefined,
                  }}
                >
                  {appendixVip > 0 && (
                    <div
                      style={{
                        height: `${(appendixVip / appendixCount) * 100}%`,
                        backgroundColor: VIP_COLOR,
                      }}
                      title={`${appendixVip} VIP`}
                    />
                  )}
                </div>
              </div>
              <span
                className="text-[8px] mt-1 whitespace-nowrap font-semibold"
                style={{ color: chart.appendixBar.color }}
              >
                {chart.appendixBar.short}
              </span>
            </button>
          </>
        )}
      </div>

      {/* Unknown note */}
      <ChartFootnote parts={[unknownCount > 0 ? `+${unknownCount} unknown` : ""]} />
    </div>
  );
}

// ── ReasonStageChart — reason-bucketed chart (Katie 2026-07-29) ───────────
// The x-axis is one bar per REASON (identity colors, fixed order — not the
// sequential day ramp; each bar carries its own label so color is never the
// only carrier). A patient can match several bars and is counted in each;
// the header count stays DISTINCT patients, so bars can sum past it.

function ReasonStageChart({
  chart,
  patients,
  priorityConfig,
  onChartClick,
  onBarClick,
}: {
  chart: ChartDef;
  patients: OversightPatient[];
  priorityConfig: PriorityConfig;
  onChartClick: () => void;
  onBarClick: (bucket: string) => void;
}) {
  const buckets = chart.reasonBuckets ?? [];
  const { counts, vipCounts, totalVip, overlap, uncategorized } = useMemo(() => {
    const counts: Record<string, number> = {};
    const vipCounts: Record<string, number> = {};
    for (const b of buckets) {
      counts[b.label] = 0;
      vipCounts[b.label] = 0;
    }
    let totalVip = 0;
    let overlap = 0;
    let uncategorized = 0;
    for (const p of patients) {
      const labels = reasonBucketsFor(chart, p);
      if (labels.length > 1) overlap++;
      // Categorize-mode charts (population rule + buckets) can hold patients
      // matching no bar — e.g. a legacy Final escalation with neither a stamp
      // nor a failed check on the board. Footnote them like the day charts'
      // "+N unknown", or the bars silently sum under the header count.
      if (labels.length === 0) uncategorized++;
      const vip = isVip(p, priorityConfig);
      if (vip) totalVip++;
      for (const l of labels) {
        counts[l] = (counts[l] ?? 0) + 1;
        if (vip) vipCounts[l] = (vipCounts[l] ?? 0) + 1;
      }
    }
    return { counts, vipCounts, totalVip, overlap, uncategorized };
  }, [patients, priorityConfig, chart, buckets]);

  const totalCount = patients.length;
  const maxCount = Math.max(1, ...buckets.map((b) => counts[b.label] ?? 0));

  return (
    <div className={cn(CHART_CARD_CLASS, "text-left w-full")}>
      <button
        onClick={onChartClick}
        className="flex items-center justify-between mb-3 w-full text-left group cursor-pointer h"
      >
        <h3 className="text-[0.95rem] font-bold tracking-tight text-foreground truncate min-w-0 group-hover:underline decoration-foreground/30 underline-offset-4 t">
          {chart.title}
        </h3>
        <div className="flex items-center gap-1.5 ml-2 shrink-0 n">
          {totalVip > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: VIP_COLOR }}
              title={`${totalVip} priority patient${totalVip !== 1 ? "s" : ""}`}
            >
              <Star className="h-2.5 w-2.5 fill-white" />
              {totalVip}
            </span>
          )}
          <span className="text-2xl font-bold text-foreground tabular-nums leading-none tn">
            {totalCount}
          </span>
        </div>
      </button>

      {/* Reason bars — wider than day buckets (2–3 bars), each clickable */}
      <div className={cn(CHART_PLOT_CLASS, "gap-3 px-2")}>
        {buckets.map((b) => {
          const count = counts[b.label] ?? 0;
          const vip = vipCounts[b.label] ?? 0;
          const heightPct = count > 0 ? (count / maxCount) * 100 : 0;
          return (
            <button
              key={b.key}
              onClick={(e) => {
                e.stopPropagation();
                if (count > 0) onBarClick(b.label);
              }}
              className={cn(
                "flex-1 flex flex-col items-center justify-end h-full group/bar min-w-0",
                count > 0 ? "cursor-pointer" : "cursor-default",
              )}
              title={`${b.label}: ${count} patient${count !== 1 ? "s" : ""}${vip > 0 ? ` · ${vip} VIP` : ""}`}
            >
              <span className="text-[8px] font-bold leading-none h-2.5" style={{ color: vip > 0 ? VIP_COLOR : "transparent" }}>
                {vip > 0 ? `★${vip}` : "★"}
              </span>
              <span className="text-[10px] tabular-nums font-semibold mb-0.5 text-muted-foreground h-3.5">
                {count > 0 ? count : ""}
              </span>
              <div className="w-full flex items-end justify-center flex-1">
                <div
                  className={cn(
                    "w-full max-w-[72px] rounded-t-md overflow-hidden flex flex-col justify-start transition-all duration-300 ease-out",
                    count > 0 && "group-hover/bar:opacity-80 group-hover/bar:ring-1 group-hover/bar:ring-foreground/30",
                    count === 0 && "invisible",
                  )}
                  style={{
                    height: count > 0 ? `${Math.max(heightPct, 3)}%` : "0%",
                    backgroundColor: b.color,
                    minHeight: count > 0 ? "4px" : undefined,
                  }}
                >
                  {vip > 0 && (
                    <div
                      style={{ height: `${(vip / count) * 100}%`, backgroundColor: VIP_COLOR }}
                      title={`${vip} VIP`}
                    />
                  )}
                </div>
              </div>
              <span className="text-[9px] mt-1 text-muted-foreground truncate max-w-full">
                {b.short ?? b.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* A patient can match several reasons (bars sum past the header) or —
          on categorize-mode charts — none (bars sum under it). Say so instead
          of leaving the arithmetic looking broken. */}
      <ChartFootnote
        parts={[
          overlap > 0 ? `${overlap} in multiple bars` : "",
          uncategorized > 0 ? `+${uncategorized} in no bar` : "",
        ]}
      />
    </div>
  );
}

// ── StackedStageChart — two-series merged escalation chart ────────────────
// Manager Intervention (ME): amber = Attempt 4+ below, red = 3rd+ round on
// top (mockup rule: age is already the x-axis, so bars use SERIES colors,
// not the day-bucket colors). Legend pills show the split; the count is the
// deduped union.

function StackedStageChart({
  chart,
  seriesA,
  seriesB,
  others,
  onChartClick,
  onBarClick,
}: {
  chart: ChartDef;
  /** Attempt 4+ pool with the 3rd+ overlap already removed. */
  seriesA: OversightPatient[];
  /** 3rd+ round pool (wins the dedup). */
  seriesB: OversightPatient[];
  /** Escalated at this stage but matching NEITHER series — footnoted rather
   *  than dropped, because Processor Overview no longer holds them either. */
  others: OversightPatient[];
  onChartClick: () => void;
  onBarClick: (bucket: DayBucketLabel) => void;
}) {
  const st = chart.stacked!;
  const { aCounts, bCounts, maxCount, unknownCount } = useMemo(() => {
    const a: Record<DayBucketLabel, number> = {} as Record<DayBucketLabel, number>;
    const b: Record<DayBucketLabel, number> = {} as Record<DayBucketLabel, number>;
    for (const label of DAY_BUCKET_LABELS) {
      a[label] = 0;
      b[label] = 0;
    }
    let unknown = 0;
    for (const p of seriesA) {
      if (p.dayBucket === "Unknown") unknown++;
      else a[p.dayBucket]++;
    }
    for (const p of seriesB) {
      if (p.dayBucket === "Unknown") unknown++;
      else b[p.dayBucket]++;
    }
    const max = Math.max(1, ...DAY_BUCKET_LABELS.map((l) => a[l] + b[l]));
    return { aCounts: a, bCounts: b, maxCount: max, unknownCount: unknown };
  }, [seriesA, seriesB]);

  // Others count in the header — they ARE on this manager's desk; they just
  // have no series to sit in. The drill-down lists them with the rest.
  const total = seriesA.length + seriesB.length + others.length;

  return (
    <div className={cn(CHART_CARD_CLASS, "text-left w-full")}>
      <button
        onClick={onChartClick}
        className="flex items-start justify-between mb-3 w-full text-left group cursor-pointer h"
      >
        <div className="min-w-0">
          <h3 className="text-[0.95rem] font-bold tracking-tight text-foreground truncate group-hover:underline decoration-foreground/30 underline-offset-4 t">
            {chart.title}
          </h3>
          <span className="inline-flex gap-1.5 mt-1">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: `${st.aColor}22`, color: "#92400e" }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.aColor }} />
              {st.aLabel}: {seriesA.length}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: `${st.bColor}22`, color: "#991b1b" }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.bColor }} />
              {st.bLabel}: {seriesB.length}
            </span>
          </span>
        </div>
        {/* No VIP badge on this chart, so the count IS the `.n` (§5.52). */}
        <span className="text-2xl font-bold text-foreground tabular-nums leading-none ml-2 shrink-0 n">
          {total}
        </span>
      </button>

      <div className={CHART_PLOT_CLASS}>
        {DAY_BUCKET_LABELS.map((label) => {
          const a = aCounts[label];
          const b = bCounts[label];
          const count = a + b;
          return (
            <button
              key={label}
              onClick={(e) => {
                e.stopPropagation();
                if (count > 0) onBarClick(label);
              }}
              className={cn(
                "flex-1 flex flex-col items-center justify-end h-full group/bar",
                count > 0 ? "cursor-pointer" : "cursor-default",
              )}
              title={`${label}: ${count} patient${count !== 1 ? "s" : ""} (${st.aLabel} ${a} · ${st.bLabel} ${b})`}
            >
              <span className="text-[9px] tabular-nums font-semibold mb-0.5 text-muted-foreground h-3">
                {count > 0 ? count : ""}
              </span>
              <div className="w-full flex flex-col items-stretch justify-end flex-1 gap-px">
                {/* red 3rd+ on top, amber Attempt 4+ below (mockup order) */}
                {b > 0 && (
                  <div
                    className="w-full rounded-t-md group-hover/bar:opacity-80 transition-all duration-300"
                    style={{ height: `${Math.max((b / maxCount) * 100, 4)}%`, backgroundColor: st.bColor }}
                  />
                )}
                {a > 0 && (
                  <div
                    className={cn("w-full group-hover/bar:opacity-80 transition-all duration-300", b === 0 && "rounded-t-md")}
                    style={{ height: `${Math.max((a / maxCount) * 100, 4)}%`, backgroundColor: st.aColor }}
                  />
                )}
              </div>
              <span className="text-[8px] mt-1 text-muted-foreground whitespace-nowrap">
                {BUCKET_SHORT_LABELS[label]}
              </span>
            </button>
          );
        })}
      </div>

      <ChartFootnote
        parts={[
          others.length > 0 ? `+${others.length} other escalation${others.length !== 1 ? "s" : ""}` : "",
          unknownCount > 0 ? `+${unknownCount} unknown` : "",
        ]}
      />
    </div>
  );
}

/**
 * The three pools behind a merged Manager Intervention chart, from one place so
 * the bars, the header count and the drill-down can never disagree.
 *
 * `b` (3rd+ round) wins the dedup over `a` (Attempt 4+), as the bars do. The
 * third pool is everyone the chart's own population rule claims — every patient
 * escalated at this stage — who is in neither series. That used to be nobody's:
 * the series were the whole chart, and Processor Overview picked up the
 * remainder because it did not exclude escalated patients. It does now, so
 * anyone missing here is missing from the entire app.
 *
 * ⚠️ It took a name-filter callback until 2026-09-25, for the in-stage name
 * filter the finder replaced (§5.52). The finder PINS a patient rather than
 * hiding the others, so the charts always show their whole population now.
 */
function stackedSeries(
  def: ChartDef,
  data: Map<string, OversightPatient[]> | null,
): { a: OversightPatient[]; b: OversightPatient[]; others: OversightPatient[] } {
  const st = def.stacked!;
  const b = data?.get(st.bId) ?? [];
  const seen = new Set(b.map((p) => p.id));
  const a = st.aId
    ? (data?.get(st.aId) ?? []).filter((p) => !seen.has(p.id))
    : [];
  for (const p of a) seen.add(p.id);
  const others = (data?.get(def.id) ?? []).filter((p) => !seen.has(p.id));
  return { a, b, others };
}

// ── DrilldownModal (overlay) ──────────────────────────────────────────────

interface DrilldownModalProps {
  chart: ChartDef;
  patients: OversightPatient[];
  /** A day-bucket label, a reason-bucket label, or "all". */
  bucket: string;
  priorityConfig: PriorityConfig;
  pillColors: Record<string, Record<string, string>>;
  onBucketChange: (bucket: string) => void;
  onClose: () => void;
  onPatientClick: (patientId: string) => void;
  hasRoute: boolean;
  /** Decision-chart row actions. Final Decisions charts (Manager Views §3):
   *  Approve Stuck / Return to Queue. The Manager Intervention Submit Auth
   *  chart: "escalate" (→ Final Decisions, REQUIRED note). `appendNote` is
   *  stamped into the notes before the status flip. */
  onDecision?: (patientId: string, action: DecisionAction, appendNote?: string) => Promise<void>;
}

/** Sortable table header cell. */
/** Per-column width for the drill-down table. Attempt-log columns return "" so
 *  they flex to fill the remaining space (the widest columns); everything else
 *  gets a compact fixed width so there's no dead space between columns. */
function colWidthClass(label: string): string {
  if (/ Log$/.test(label)) return "";              // flex → widest, room for the note
  // Fixed, not flex. Since the manager charts started mirroring their stage's
  // columns there are enough of them that an unsized reason column stops being
  // constrained by table-fixed and its text spills over the neighbouring cell.
  // Full text is still one hover away.
  if (label === "Proposed Reason") return "w-[220px]";
  // Pill columns whose labels are longer than the 104px default. The pills are
  // whitespace-nowrap, so an undersized column used to paint over its
  // neighbour: "Final Escalation Required" alone needs ~141px, and it appears
  // on every escalated row of the manager views.
  if (label === "Reason") return "w-[170px]";
  if (label === "Escalation") return "w-[150px]";
  if (label === "Evaluation Count") return "w-[54px]";
  if (label === "Days in Stage") return "w-[74px]";
  if (label === "Clinicals Method") return "w-[80px]";
  if (label === "MN Attempts") return "w-[92px]";
  if (/Date|Sent|Action|Intake/.test(label)) return "w-[88px]";
  if (label === "Requesting") return "w-[112px]";
  return "w-[104px]";                               // insurance, referral, request type, serving
}

function Th({
  label,
  dir,
  onClick,
  width,
}: {
  label: string;
  dir: "asc" | "desc" | null;
  onClick: () => void;
  width?: string;
}) {
  return (
    <th className={cn("text-left px-2 py-1.5 font-medium text-muted-foreground select-none", width)}>
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 max-w-full hover:text-foreground transition-colors"
        title={`Sort by ${label}`}
      >
        <span className="truncate">{label}</span>
        {dir === null ? (
          <ArrowUpDown className="h-3 w-3 opacity-30 shrink-0" />
        ) : dir === "asc" ? (
          <ArrowUp className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowDown className="h-3 w-3 shrink-0" />
        )}
      </button>
    </th>
  );
}

function DrilldownModal({
  chart,
  patients,
  bucket,
  priorityConfig,
  pillColors,
  onBucketChange,
  onClose,
  onPatientClick,
  hasRoute,
  onDecision,
}: DrilldownModalProps) {
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null);
  // Decision actions — per-row busy lock while a decision writes.
  const [decidingId, setDecidingId] = useState<string | null>(null);
  // Decision modal: every decision action confirms through it, so the manager
  // can append a stamped note — approving stuck is the last thing recorded
  // before a patient leaves the pipeline, and "escalate" (Submit Auth manager
  // review, 2026-07-29) REQUIRES the note: the justification is the whole
  // payload the Final Decisions reviewer works from.
  const [decisionModal, setDecisionModal] = useState<{ id: string; action: DecisionAction } | null>(null);
  // What a decision means on THIS chart — `decisionCopy` (§5.52) is the one
  // reading, shared with the pinned patient card, so the row buttons here and
  // the card's buttons cannot drift apart. The note's wording, its column and
  // the required-note rule live with the dialog (`DecisionConfirmModal`).
  const { isDecisionChart, isEscalateChart, skipBotRows } = decisionCopy(chart);
  const runDecision = async (patientId: string, action: DecisionAction, appendNote?: string) => {
    if (!onDecision || decidingId) return;
    setDecidingId(patientId);
    try {
      await onDecision(patientId, action, appendNote);
    } finally {
      setDecidingId(null);
    }
  };
  const decide = async (patientId: string, action: DecisionAction) => {
    // Every decision action confirms first (stamped note + a view of the
    // notes the proposal was made in).
    if (isDecisionChart) {
      setDecisionModal({ id: patientId, action });
      return;
    }
    await runDecision(patientId, action);
  };
  // The dialog has already applied the required-note rule; it hands over the
  // trimmed note, or undefined when the manager left it blank.
  const confirmDecision = async (note: string | undefined) => {
    if (!decisionModal || decidingId) return;
    const { id, action } = decisionModal;
    await runDecision(id, action, note);
    setDecisionModal(null);
  };
  const [search, setSearch] = useState("");
  // sortKey: "name" | "days" | a column id; null = default (day bucket desc)
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Close on Escape (notes popup first, then the modal)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (decisionModal) setDecisionModal(null);
        else if (notesOpenId) setNotesOpenId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, notesOpenId, decisionModal]);

  // Columns in the chart's authored order. The "Days in Stage" column renders
  // as the day-bucket pill wherever the chart places it.
  const cols = chart.drilldownCols;
  const isDaysCol = (label: string) => label === "Days in Stage";

  // Reason-bucketed charts (2026-07-29) swap the day strip + day filtering
  // for the chart's reason bars; bar counts/filtering share one evaluation
  // (reasonBucketsFor) so they can never disagree with the card outside.
  const reasonBuckets = chart.reasonBuckets ?? [];
  const isReasonChart = reasonBuckets.length > 0;
  const reasonsByPatient = useMemo(() => {
    if (!isReasonChart) return new Map<string, string[]>();
    return new Map(patients.map((p) => [p.id, reasonBucketsFor(chart, p)]));
  }, [patients, chart, isReasonChart]);

  // Day-bucket counts for the bar chart + filtering
  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (isReasonChart) {
      for (const b of reasonBuckets) counts[b.label] = 0;
      for (const p of patients) {
        for (const l of reasonsByPatient.get(p.id) ?? []) counts[l] = (counts[l] ?? 0) + 1;
      }
      return counts;
    }
    for (const label of DAY_BUCKET_LABELS) counts[label] = 0;
    for (const p of patients) if (p.dayBucket !== "Unknown") counts[p.dayBucket]++;
    return counts;
  }, [patients, isReasonChart, reasonBuckets, reasonsByPatient]);
  const maxBucket = useMemo(
    () =>
      Math.max(
        1,
        ...(isReasonChart
          ? reasonBuckets.map((b) => bucketCounts[b.label] ?? 0)
          : DAY_BUCKET_LABELS.map((l) => bucketCounts[l] ?? 0)),
      ),
    [bucketCounts, isReasonChart, reasonBuckets],
  );

  const setSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "days" ? "desc" : "asc");
    }
  };

  const filtered = useMemo(() => {
    let list =
      bucket === "all"
        ? patients
        : bucket === APPENDIX_BUCKET
          // The appendix bar isn't on the days axis — filter by its own rule,
          // the same evaluation the bar count uses (matchesAppendixBar).
          ? patients.filter((p) => matchesAppendixBar(chart, p))
          : isReasonChart
            ? patients.filter((p) => (reasonsByPatient.get(p.id) ?? []).includes(bucket))
            : patients.filter((p) => p.dayBucket === bucket);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.dayBucket.toLowerCase().includes(q) ||
          cols.some((c) => (p.cols[c.colId] ?? "").toLowerCase().includes(q)),
      );
    }

    // If sorting by the Days column, sort by the actual day-bucket order.
    const sortCol = sortKey ? cols.find((c) => c.colId === sortKey) : null;
    const sortingDays = !!sortCol && isDaysCol(sortCol.label);

    const sorted = [...list];
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      sorted.sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        if (sortKey === "name") {
          av = a.name.toLowerCase();
          bv = b.name.toLowerCase();
        } else if (sortingDays) {
          return (bucketSortValue(a.dayBucket) - bucketSortValue(b.dayBucket)) * dir;
        } else {
          av = (a.cols[sortKey] ?? "").toLowerCase();
          bv = (b.cols[sortKey] ?? "").toLowerCase();
        }
        // Numeric compare when both values are purely numeric (dates/counts)
        const an = parseFloat(av as string);
        const bn = parseFloat(bv as string);
        const numeric =
          !Number.isNaN(an) &&
          !Number.isNaN(bn) &&
          /^[\d.,$%\s/-]+$/.test(av as string) &&
          /^[\d.,$%\s/-]+$/.test(bv as string);
        if (numeric) return (an - bn) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    } else {
      sorted.sort((a, b) => bucketSortValue(b.dayBucket) - bucketSortValue(a.dayBucket));
    }
    return sorted;
  }, [patients, bucket, search, sortKey, sortDir, cols, isReasonChart, reasonsByPatient]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card w-screen h-screen max-w-none max-h-none flex flex-col animate-in fade-in duration-150">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3 className="h-4 w-4 text-blue-500 shrink-0" />
            <h3 className="text-base font-semibold text-foreground truncate">
              {chart.title}
            </h3>
            <span className="text-xs text-muted-foreground shrink-0">
              {patients.length} total{bucket !== "all" ? ` · ${bucket}` : ""}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Bar chart — reason distribution on reason-bucketed charts,
            days-in-stage everywhere else; click a bar to filter */}
        <div className="px-5 pt-4 pb-3 border-b shrink-0">
          <div className="flex items-end gap-2 h-[140px]">
            {(isReasonChart
              ? reasonBuckets.map((b) => ({
                  label: b.label,
                  short: b.short ?? b.label,
                  color: b.color,
                  maxW: "max-w-[110px]",
                }))
              : DAY_BUCKET_LABELS.map((label) => ({
                  label: label as string,
                  short: BUCKET_SHORT_LABELS[label],
                  color: DAY_BUCKET_COLORS[label],
                  maxW: "",
                }))
            ).map(({ label, short, color, maxW }) => {
              const count = bucketCounts[label] ?? 0;
              const heightPct = count > 0 ? (count / maxBucket) * 100 : 0;
              const selected = bucket === label;
              const dimmed = bucket !== "all" && !selected;
              return (
                <button
                  key={label}
                  onClick={() => count > 0 && onBucketChange(selected ? "all" : label)}
                  className={cn(
                    "flex-1 flex flex-col items-center justify-end h-full group min-w-0",
                    count > 0 ? "cursor-pointer" : "cursor-default",
                  )}
                  title={`${label}: ${count} patient${count !== 1 ? "s" : ""}`}
                >
                  <span className="text-[10px] tabular-nums font-semibold mb-1 text-muted-foreground h-3.5">
                    {count > 0 ? count : ""}
                  </span>
                  <div className="w-full flex items-end justify-center flex-1">
                    <div
                      className={cn(
                        "w-full rounded-t-sm transition-all duration-300",
                        maxW,
                        count > 0 && "group-hover:opacity-90",
                        selected && "ring-2 ring-offset-1 ring-foreground/40",
                      )}
                      style={{
                        height: count > 0 ? `${Math.max(heightPct, 3)}%` : "2px",
                        backgroundColor: color,
                        opacity: dimmed ? 0.3 : 1,
                      }}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-[9px] mt-1 whitespace-nowrap truncate max-w-full",
                      selected ? "font-bold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {short}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Toolbar — search + clear filters + count */}
        <div className="flex items-center gap-2 px-5 py-2 border-b shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or any column…"
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          {(bucket !== "all" || search) && (
            <button
              onClick={() => {
                onBucketChange("all");
                setSearch("");
              }}
              className="text-xs text-blue-500 hover:underline shrink-0"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground shrink-0 tabular-nums">
            {filtered.length} shown
          </span>
        </div>

        {/* Table body. The table — header row included — renders even with zero
            rows: the drill-down doubles as the reference for WHICH columns a
            stage tracks, so an empty chart must still show them rather than
            collapse to a bare message. */}
        {/* overflow-x is required as well as -y: manager charts mirror their
            stage's columns, so the fixed-width table is routinely wider than
            the viewport. Without it the right-hand columns were simply
            unreachable rather than scrollable. */}
        <div className="flex-1 overflow-auto min-h-0">
          <TooltipProvider delayDuration={150}>
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b">
                  {chart.notesColId && (
                    <th className="w-8 px-1 py-1.5" />
                  )}
                  <Th
                    label="Name"
                    width="w-[150px]"
                    dir={sortKey === "name" ? sortDir : null}
                    onClick={() => setSort("name")}
                  />
                  {cols.map((col) => (
                    <Th
                      key={col.colId}
                      label={col.label}
                      width={colWidthClass(col.label)}
                      dir={sortKey === col.colId ? sortDir : null}
                      onClick={() => setSort(col.colId)}
                    />
                  ))}
                  {onDecision && (
                    // Pinned to the right edge: the decision is the whole
                    // reason a manager opened this table, so it must be on
                    // screen at rest rather than a horizontal scroll away.
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-[228px] sticky right-0 z-20 bg-card border-l border-border">
                      Decision
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={(chart.notesColId ? 1 : 0) + 1 + cols.length + (onDecision ? 1 : 0)}
                      className="px-5 py-12 text-center text-sm text-muted-foreground"
                    >
                      No patients match.
                    </td>
                  </tr>
                )}
                {filtered.map((patient, idx) => {
                  const bucketColor =
                    patient.dayBucket !== "Unknown"
                      ? DAY_BUCKET_COLORS[patient.dayBucket]
                      : "#888888";
                  return (
                    <tr
                      key={patient.id}
                      onClick={() => hasRoute && onPatientClick(patient.id)}
                      className={cn(
                        "border-b border-border/50 hover:bg-muted/50 transition-colors",
                        idx % 2 === 1 && "bg-muted/20",
                        hasRoute && "cursor-pointer",
                      )}
                    >
                      {chart.notesColId && (() => {
                        const noteText = patient.cols[chart.notesColId!] ?? "";
                        const hasNote = noteText.trim().length > 0;
                        return (
                          <td className="px-1 py-1 text-center w-8">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (hasNote) setNotesOpenId(patient.id);
                              }}
                              className={cn(
                                "p-0.5 rounded transition-colors",
                                hasNote
                                  ? "text-blue-500 hover:bg-blue-500/10"
                                  : "text-muted-foreground/20 cursor-default",
                              )}
                              disabled={!hasNote}
                              title={hasNote ? "View notes" : "No notes"}
                            >
                              <StickyNote className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        );
                      })()}
                      <td className="px-2 py-1 font-medium text-foreground truncate">
                        <span className="flex items-center gap-1">
                          {isVip(patient, priorityConfig) && (
                            <Star
                              className="h-3 w-3 shrink-0"
                              style={{ color: VIP_COLOR, fill: VIP_COLOR }}
                              aria-label="Priority patient"
                            />
                          )}
                          <span className="truncate">{patient.name}</span>
                          {hasRoute && (
                            <ExternalLink className="h-3 w-3 text-blue-400 shrink-0" />
                          )}
                        </span>
                      </td>
                      {cols.map((col) => {
                        if (isDaysCol(col.label)) {
                          return (
                            <td key={col.colId} className="px-2 py-1">
                              <span
                                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
                                style={{
                                  backgroundColor: `${bucketColor}20`,
                                  color: bucketColor,
                                }}
                              >
                                {patient.dayBucket}
                              </span>
                            </td>
                          );
                        }
                        if (/ Log$/.test(col.label)) {
                          const raw = (patient.cols[col.colId] ?? "").trim();
                          if (!raw) {
                            return (
                              <td key={col.colId} className="px-2 py-1 text-muted-foreground">—</td>
                            );
                          }
                          // Attempt log format: "datetime · outcome · note". Show the
                          // timestamp + note preview inline (truncated to the column),
                          // and the FULL note in a hover bubble.
                          const [ts, ...restParts] = raw.split(" · ");
                          const rest = restParts.join(" · ");
                          return (
                            <td key={col.colId} className="px-2 py-1 text-foreground/80">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="block truncate cursor-help">
                                    <span className="text-muted-foreground">{ts}</span>
                                    {rest && <span> · {rest}</span>}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  className="max-w-md whitespace-pre-wrap break-words text-xs leading-relaxed"
                                >
                                  {raw}
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }
                        if (col.pill) {
                          const raw = patient.cols[col.colId] ?? "";
                          const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
                          const colorMap = pillColors[col.colId] ?? {};
                          return (
                            <td key={col.colId} className="px-2 py-1">
                              {parts.length ? (
                                // overflow-hidden is load-bearing: the pills are
                                // whitespace-nowrap, and in a table-fixed layout a
                                // pill wider than its column paints OVER the next
                                // cell rather than clipping (browsers don't honour
                                // overflow on <td> itself — same reason the
                                // Requesting cell below wraps its content).
                                <span className="flex flex-wrap gap-1 overflow-hidden">
                                  {parts.map((v, i) => {
                                    const hex = colorMap[v.toLowerCase()] ?? "#94a3b8";
                                    return (
                                      <span
                                        key={i}
                                        className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
                                        style={{ backgroundColor: `${hex}22`, color: hex }}
                                      >
                                        {v}
                                      </span>
                                    );
                                  })}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        }
                        if (col.label === "Requesting") {
                          const pills = requestingPills(patient);
                          return (
                            // overflow-hidden: pills are whitespace-nowrap, so a
                            // long label ("Final Escalation Required") in a
                            // fixed-width column would otherwise paint over its
                            // neighbour instead of being clipped.
                            // Clipping lives on a span INSIDE the cell, not on
                            // the <td>: browsers don't reliably honour overflow
                            // on table cells, so a long label ("Final Escalation
                            // Required" in a 104px column) painted over its
                            // neighbour. Each pill truncates to the cell width
                            // and carries its full text as a title tooltip.
                            <td key={col.colId} className="px-2 py-1">
                              {pills.length ? (
                                <span className="flex flex-wrap gap-1 min-w-0 overflow-hidden">
                                  {pills.map((pp) => (
                                    <span
                                      key={pp}
                                      title={pp}
                                      className="inline-block max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-bold"
                                      style={{
                                        backgroundColor: `${REQ_COLORS[pp]}20`,
                                        color: REQ_COLORS[pp],
                                      }}
                                    >
                                      {pp}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        }
                        if (col.colId === "__proposedReason__") {
                          // The rep's stamped stuck reason, extracted from the MN
                          // notes. Truncated inline; full text on hover.
                          const raw = (patient.cols[col.colId] ?? "").trim();
                          if (!raw) {
                            return <td key={col.colId} className="px-2 py-1 text-muted-foreground">—</td>;
                          }
                          return (
                            // Same rule as the pill cell: the inner span does the
                            // clipping, since overflow on a <td> is unreliable.
                            <td key={col.colId} className="px-2 py-1 text-foreground/80">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="block truncate cursor-help">{raw}</span>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  className="max-w-md whitespace-pre-wrap break-words text-xs leading-relaxed"
                                >
                                  {raw}
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }
                        const value = patient.cols[col.colId] ?? "";
                        // Days in Stage on a date-bucketed stage also says WHEN
                        // the patient wakes up. Without it a manager sees a row
                        // sitting at "9–12 Days" that the processor burndown
                        // doesn't count, and the only explanation is a Follow Up
                        // Date they can't see from here.
                        const snooze =
                          col.colId === DAYS_IN_STAGE_COL && chart.snoozeDateColId
                            ? snoozedUntil(patient.cols[chart.snoozeDateColId])
                            : null;
                        return (
                          <td
                            key={col.colId}
                            className="px-2 py-1 text-foreground/80 truncate"
                          >
                            {value || "—"}
                            {snooze && (
                              <span
                                title={`Snoozed until ${snooze} — not in the processor burndown until then`}
                                className="ml-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold bg-amber-400/20 text-amber-600 dark:text-amber-400"
                              >
                                Snoozed → {snooze}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      {onDecision && (
                        // Matches the pinned header. bg-card (not transparent)
                        // so the columns it floats over don't show through.
                        <td className="px-2 py-1 sticky right-0 z-10 bg-card border-l border-border">
                          {isEscalateChart ? (
                            // Every row EXCEPT a bot-owned DVS state gets the
                            // decision buttons: the manager either promotes to
                            // Final Decisions or returns the patient to the
                            // rep's queue (the two outcomes the rep's Propose
                            // Stuck dialog promises). A DVS retry/manual row is
                            // a bot state with nothing to decide, so it stays
                            // button-free.
                            //
                            // Was "only a Propose Stuck row" (2026-08-03): that
                            // left every OTHER escalated row — a pump-SoS hold,
                            // a denial, a stamp-less manual escalation — with no
                            // way back. Since an escalation is what removes a
                            // patient from the rep's queue, a visible row a
                            // manager cannot clear is still a stranded patient.
                            !skipBotRows || !isBotOwnedRow(reasonsByPatient.get(patient.id) ?? []) ? (
                              <span className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => decide(patient.id, "escalate")}
                                  disabled={decidingId !== null}
                                  className="inline-flex items-center gap-1 rounded-md bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[11px] font-semibold px-2 py-1 transition-colors"
                                >
                                  {decidingId === patient.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : null}
                                  Escalate to Final
                                </button>
                                <button
                                  onClick={() => decide(patient.id, "return")}
                                  disabled={decidingId !== null}
                                  className="inline-flex items-center rounded-md border border-border hover:bg-muted disabled:opacity-50 text-foreground/80 text-[11px] font-semibold px-2 py-1 transition-colors"
                                >
                                  Return to Queue
                                </button>
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-[11px]">—</span>
                            )
                          ) : (
                            <span className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => decide(patient.id, "approve")}
                                disabled={decidingId !== null}
                                className="inline-flex items-center gap-1 rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[11px] font-semibold px-2 py-1 transition-colors"
                              >
                                {decidingId === patient.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : null}
                                Approve Stuck
                              </button>
                              <button
                                onClick={() => decide(patient.id, "return")}
                                disabled={decidingId !== null}
                                className="inline-flex items-center rounded-md border border-border hover:bg-muted disabled:opacity-50 text-foreground/80 text-[11px] font-semibold px-2 py-1 transition-colors"
                              >
                                Return to Queue
                              </button>
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TooltipProvider>
        </div>
      </div>

      {/* ── Notes popup (centered overlay) ── */}
      {notesOpenId && (() => {
        const pt = filtered.find((p) => p.id === notesOpenId) ?? patients.find((p) => p.id === notesOpenId);
        const noteText = pt && chart.notesColId ? pt.cols[chart.notesColId] ?? "" : "";
        if (!pt || !noteText) return null;
        return (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
            onClick={() => setNotesOpenId(null)}
          >
            <div
              className="bg-card border border-border rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col animate-in zoom-in-95 fade-in duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <StickyNote className="h-4 w-4 text-blue-500 shrink-0" />
                  <h4 className="text-sm font-semibold text-foreground truncate">
                    {pt.name}
                  </h4>
                </div>
                <button
                  onClick={() => setNotesOpenId(null)}
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
                <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                  {noteText}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Decision confirm (every decision action) — a stamped note, and a
          view of the notes the proposal was made in. The dialog is shared with
          the pinned patient card (§5.52); this block only finds the row. ── */}
      {decisionModal && (() => {
        const rp = filtered.find((p) => p.id === decisionModal.id) ?? patients.find((p) => p.id === decisionModal.id);
        if (!rp) return null;
        return (
          <DecisionConfirmModal
            key={`${decisionModal.id}:${decisionModal.action}`}
            chart={chart}
            patient={rp}
            action={decisionModal.action}
            busy={decidingId === decisionModal.id}
            onCancel={() => setDecisionModal(null)}
            onConfirm={confirmDecision}
          />
        );
      })()}
    </div>
  );
}

// ── DecisionConfirmModal — every Oversight decision confirms here ──────────

/**
 * The confirm dialog behind every decision button: the drill-down's rows AND
 * the pinned patient card (§5.52). One component, so the two surfaces cannot
 * word a decision differently or disagree about when a note is required. It
 * owns the note it collects and hands back the trimmed text (or undefined).
 *
 * Approving Stuck is the last thing recorded before a patient leaves the
 * pipeline, and "escalate" (Submit Auth manager review, 2026-07-29) REQUIRES
 * the note: the justification is the whole payload the Final Decisions
 * reviewer works from.
 *
 * ⚠️ It also closes on Escape (unless a write is in flight). The drill-down
 * keeps its own Escape chain on top — decision dialog first, then the notes
 * popup, then the drill-down — and both close the same dialog, so the pair is
 * harmless; the pinned card has no other listener, which is why this one exists.
 */
function DecisionConfirmModal({
  chart,
  patient,
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  chart: ChartDef;
  patient: OversightPatient;
  action: DecisionAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string | undefined) => void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  const titleId = useId();
  // The decision kinds differ in WHERE the note lands and whether a return
  // also re-dates the patient — Insurance deliberately doesn't re-date (Auth
  // Outstanding buckets on that date); Welcome Call clears a snooze instead.
  const { returnRedates, returnClearsSnooze, reasonNotesLabel, isEscalateChart, returnNotesColId } = decisionCopy(chart);
  const isApprove = action === "approve";
  const isEscalate = action === "escalate";
  // Manager Intervention's "send back to pipeline" REQUIRES a note (Josh,
  // 2026-08-03). Returning a patient is the one decision that leaves no
  // other trace: the escalation is cleared, the row vanishes from the
  // manager column, and the rep picks them up with no idea what was
  // looked at or why it came back. Final Decisions' return stays optional
  // — that column's rows already carry the proposal being answered.
  const noteRequired = isEscalate || (isEscalateChart && action === "return");
  const rpNotes = (returnNotesColId ? patient.cols[returnNotesColId] ?? "" : "").trim();
  const trimmed = note.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const confirm = () => {
    // A required note with nothing in it is exactly the blind hand-off the
    // two-step review exists to prevent — the confirm button is disabled, and
    // this guard backs it up.
    if (busy || (noteRequired && !trimmed)) return;
    void onConfirm(trimmed || undefined);
  };

  const title = isEscalate
    ? `Escalate ${patient.name} to Final Decisions`
    : isApprove
      ? `Approve ${patient.name} as Stuck`
      : `Return ${patient.name} to the queue`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card border border-border rounded-xl shadow-2xl w-[540px] max-h-[80vh] flex flex-col animate-in zoom-in-95 fade-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {isApprove || isEscalate
              ? <Flag className="h-4 w-4 text-red-600 shrink-0" />
              : <RotateCcw className="h-4 w-4 text-blue-500 shrink-0" />}
            <h4 id={titleId} className="text-sm font-semibold text-foreground truncate">
              {title}
            </h4>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0 space-y-3">
          <p className="text-xs text-muted-foreground">
            {isEscalate
              ? "Flags the patient Final Escalation Required — they move to the Final Decisions column, where a manager approves Stuck or returns them to the rep. Your note below is REQUIRED: it's what the Final Decisions review works from, stamped into the "
              : isApprove
                ? "Moves the patient to the Stuck stage and clears the escalation — they leave the pipeline. "
                : returnRedates
                  ? "Sets Next Action Date to today and clears the escalation, so the patient reappears in the rep's queue. "
                  : returnClearsSnooze
                    ? "Clears the Follow Up snooze and the escalation, so the patient reappears in the rep's queue as due now. "
                    : "Sets the Follow Up Date to today and clears the escalation, so the patient reappears in the rep's due queue. "}
            {isEscalate
              ? `${reasonNotesLabel}.`
              : noteRequired
                ? `Your note below is REQUIRED — it's the only record of this decision the rep will see, stamped into the ${reasonNotesLabel}.`
                : `Optionally add a note below — it's stamped into the ${reasonNotesLabel}.`}
          </p>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {reasonNotesLabel}
            </label>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground/80 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {rpNotes || <span className="text-muted-foreground">No notes yet.</span>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {isEscalate ? (
                <>Why does this need a final decision? <span className="text-red-500">*</span></>
              ) : noteRequired ? (
                <>What should the rep do next? <span className="text-red-500">*</span></>
              ) : (
                "Add a note (optional)"
              )}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={
                isEscalate
                  ? "e.g. Rep is right — payer has denied twice and won't take a peer-to-peer. Recommend Stuck."
                  : noteRequired
                    ? "e.g. Called the payer — auth is on file, just re-submit the pump line with modifier KX."
                    : "e.g. New clinicals arrived — back to Evaluate for re-review."
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t shrink-0">
          <button
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center rounded-md border border-border hover:bg-muted disabled:opacity-50 text-foreground/80 text-sm font-semibold px-3 py-1.5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy || (noteRequired && !trimmed)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md disabled:opacity-50 text-white text-sm font-semibold px-3 py-1.5 transition-colors",
              isApprove || isEscalate ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : isApprove || isEscalate ? <Flag className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
            {isEscalate ? "Escalate to Final Decisions" : isApprove ? "Approve Stuck" : "Return to Queue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PinnedPatientCard — Brandon's `.ov-focus` ──────────────────────────────

/**
 * The patient a finder pick pins on top (§5.52): who they are, how long they
 * have been in the stage, every chart that counts them, and the actions their
 * most senior chart offers.
 *
 * ⚠️⚠️ **Every action here is an EXISTING door.** Open profile is the patient
 * screen's own route (§5.39); Open in stage tool is the drill-down row's own
 * `navigateToPatient`; the decisions are `decisionActions` — the drill-down's
 * rule — confirmed through the drill-down's own dialog and written by the
 * drill-down's own `handleDecision`. Nothing on this card writes by itself.
 *
 * ⚠️ The decisions come from the SENIOR chart (Final Decisions over Manager
 * Intervention over Processor Overview): that is where a manager's decision
 * lives, and a patient in a Processor Overview chart only has nothing to
 * decide — the row gets no buttons, exactly as in the drill-down.
 */
function PinnedPatientCard({
  person,
  selectedStage,
  selectedStageTitle,
  busy,
  onSwitchStage,
  onOpenStageTool,
  onDecide,
  onClear,
}: {
  person: PipelinePerson;
  selectedStage: string;
  selectedStageTitle: string;
  busy: boolean;
  onSwitchStage: () => void;
  onOpenStageTool: (chartId: string) => void;
  onDecide: (chart: ChartDef, action: DecisionAction) => void;
  onClear: () => void;
}) {
  const p = person.patient;
  const senior = seniorChart(person.charts);
  const actions = senior ? decisionActions(senior, p) : [];
  const initial = (p.name.trim()[0] ?? "?").toUpperCase();
  // `null` is a deliberate "no page yet" (Auth Denied); the drill-down greys
  // its rows out on the same test.
  const noStageTool = !senior || CHART_ROUTES[senior.id] === null;
  return (
    <div className="row wrap" style={{ gap: 12, alignItems: "flex-start" }}>
      <span className="avatar lg" aria-hidden="true">{initial}</span>
      <div className="grow">
        <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
          <b className="name">{p.name}</b>
          <span className="xs muted">{person.sectionTitle}</span>
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
          <span className="chip">
            {p.dayBucket === "Unknown" ? "Days in stage unknown" : `${p.dayBucket} in stage`}
          </span>
          {person.charts.map((c) => {
            const col = columnOf(c.id);
            return (
              <span key={c.id} className={cn("chip", col === 2 && "amber", col === 3 && "red")}>
                {c.title}
              </span>
            );
          })}
        </div>
        {person.sectionId !== selectedStage && (
          <div className="xs muted" style={{ marginTop: 6 }}>
            This patient is in <b>{person.sectionTitle}</b>, not {selectedStageTitle} —{" "}
            <button type="button" className="link" onClick={onSwitchStage}>
              switch to their stage
            </button>
            .
          </div>
        )}
      </div>
      <div className="acts">
        <Link className="btn outline sm" to={`/patient/${encodeURIComponent(p.id)}?board=${p.boardId}`}>
          <User aria-hidden="true" /> Open profile
        </Link>
        <button
          type="button"
          className="btn outline sm"
          onClick={() => senior && onOpenStageTool(senior.id)}
          disabled={noStageTool}
          title={
            noStageTool
              ? "This stage doesn't have a dedicated page yet"
              : `Open ${senior.title} for this patient — the same page the drill-down opens`
          }
        >
          <ExternalLink aria-hidden="true" /> Open in stage tool
        </button>
        {senior &&
          actions.map(({ action, label }) => (
            <button
              key={action}
              type="button"
              className={cn("btn sm", action === "return" ? "ghost" : "danger-outline")}
              disabled={busy}
              onClick={() => onDecide(senior, action)}
            >
              {action === "return" ? <RotateCcw aria-hidden="true" /> : <Flag aria-hidden="true" />} {label}
            </button>
          ))}
        <button
          type="button"
          className="btn ghost xs"
          title="Clear"
          aria-label="Clear the pinned patient"
          onClick={onClear}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

/* ⚠️ **"Communications" left this dropdown on 2026-09-21** (Josh). It was never
   a stage — no board, no group, no days-in-stage, so there was nothing to chart
   and picking it navigated away instead of swapping the charts below. It is a
   header tab of its own now (§5.39c), which is a better door than an entry in a
   list of stages that quietly is not one. */

export default function OversightTab() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const cachedRef = useRef(loadCache());
  const [data, setData] = useState<Map<string, OversightPatient[]> | null>(
    cachedRef.current,
  );
  const [loading, setLoading] = useState(cachedRef.current === null);
  /** True during ANY Monday fetch, including silent background polls. */
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drill-down + stage state is seeded from the URL so the browser Back button
  // (e.g. returning from a patient's CC page) restores the exact view the user
  // left — the open chart, its bucket filter, and the selected stage.
  const [expandedChart, setExpandedChart] = useState<string | null>(
    () => searchParams.get("chart"),
  );
  // Day-bucket label OR a reason-bucket label (reason-bucketed charts,
  // 2026-07-29) — plain string either way; "all" = no bar filter. A stale URL
  // value that matches no bar simply filters to zero rows, and Clear filters
  // resets it.
  const [selectedBucket, setSelectedBucket] = useState<string>(() => {
    return searchParams.get("bucket") || "all";
  });
  const [priorityConfig, setPriorityConfig] = useState<PriorityConfig>(loadPriorityConfig);
  const [configOpen, setConfigOpen] = useState(false);
  const [priorityOptions, setPriorityOptions] = useState<{
    referralTypes: string[];
    insurances: string[];
  }>({ referralTypes: [], insurances: [] });
  const [pillColors, setPillColors] = useState<Record<string, Record<string, string>>>({});
  // Which pipeline stage is selected (one section's charts shown at a time).
  const [selectedStage, setSelectedStage] = useState<string>(() => {
    const s = searchParams.get("stage");
    return s && OVERSIGHT_SECTIONS.some((x) => x.id === s) ? s : OVERSIGHT_SECTIONS[0].id;
  });
  // ── The finder + the pinned patient (Brandon's `.ov-search` / `.ov-focus`,
  //    §5.52). ⚠️ This REPLACED the old in-stage name filter, which hid every
  //    bar the name was not in: the finder searches every stage at once and
  //    pins the patient instead, so the charts always show their whole
  //    population and the count above them stays the stage's real total.
  const [ovQuery, setOvQuery] = useState("");
  const [ovOpen, setOvOpen] = useState(false);
  /** The highlighted row — arrow keys move it, Enter picks it. */
  const [ovHi, setOvHi] = useState(0);
  const ovSearchRef = useRef<HTMLDivElement>(null);
  const ovInputRef = useRef<HTMLInputElement>(null);
  // Seeded from the URL like the stage and the drill-down, and mirrored back
  // into it below, so Back from a stage tool lands on the same pinned patient.
  const [focusId, setFocusId] = useState<string | null>(() => searchParams.get("patient"));
  // The pinned card's decision dialog. The PATIENT is snapshotted when the
  // dialog opens: a background poll that drops them mid-confirm must not pull
  // the dialog out from under the manager.
  const [pinDecision, setPinDecision] = useState<{ chartId: string; patient: OversightPatient; action: DecisionAction } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  // Brandon's "<name> · N patients in the pipeline" — the signed-in person,
  // exactly as Reports & Metrics resolves it (OperationsPage). ⚠️ Never the
  // borrowed "Viewing" person: `lib/shell/viewAs` may only be read by the three
  // shell files that own the borrow (§5.39h).
  const { email, config } = useAccessContext();
  const myName = getUser()?.name || config.processors?.[email]?.name || (email || "").split("@")[0] || "Signed in";
  const mountedRef = useRef(true);

  const updateConfig = useCallback((c: PriorityConfig) => {
    setPriorityConfig(c);
    savePriorityConfig(c);
  }, []);

  // Pull the live status-label options for the scoring editor.
  useEffect(() => {
    fetchPriorityOptions()
      .then((opts) => setPriorityOptions(opts))
      .catch(() => {
        /* editor falls back to whatever labels are already in the config */
      });
    fetchPillColors()
      .then((c) => setPillColors(c))
      .catch(() => {
        /* pills fall back to a neutral color */
      });
  }, []);

  // ── Data fetching ─────────────────────────────────────────────

  const refetch = useCallback(async (silent = false) => {
    // `fetching` tracks EVERY fetch, silent ones included — a background poll
    // used to update the charts with no on-screen sign that anything was
    // happening, so numbers changed under the manager unannounced. `loading` is
    // still cold-load-only, since that's what swaps in the skeleton.
    if (mountedRef.current) setFetching(true);
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await fetchOversightData();
      if (!mountedRef.current) return;
      setData(result);
      persistCache(result);
      setError(null);
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mountedRef.current) setFetching(false);
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (cachedRef.current) {
      refetch(true);
    } else {
      refetch(false);
    }

    const interval = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refetch]);

  // ── Handlers ──────────────────────────────────────────────────

  const handleChartClick = useCallback((chartId: string) => {
    setExpandedChart(chartId);
    setSelectedBucket("all");
  }, []);

  const handleBarClick = useCallback((chartId: string, bucket: string) => {
    setExpandedChart(chartId);
    setSelectedBucket(bucket);
  }, []);

  const handleClose = useCallback(() => {
    setExpandedChart(null);
    setSelectedBucket("all");
  }, []);

  const handleBucketChange = useCallback((bucket: string) => {
    setSelectedBucket(bucket);
  }, []);

  /**
   * Open a patient in the page that works the chart they sit in. The drill-down
   * row and the pinned card's "Open in stage tool" both land here, so the two
   * doors carry the same manager-mode params and the same per-patient
   * overrides — a second copy of this routing is how one of them would open a
   * rep's page where the other opens the manager's.
   */
  const navigateToPatient = useCallback(
    (chartId: string, patientId: string, bucket: string) => {
      let route = CHART_ROUTES[chartId];
      // The merged Submit Auth manager charts mix stages: DVS rows open the
      // DVS monitor (the chart's base route), but a proposed-stuck row is a
      // Submit Auth patient and belongs on that stage page. Both the Manager
      // Intervention chart and its Final Decisions twin are reason-bucketed
      // the same way, so both need the per-patient override.
      if (chartId === "submit-auth-manager" || chartId === "submit-auth-final-escalation") {
        const p = (data?.get(chartId) ?? []).find((x) => x.id === patientId);
        if (p && (p.cols["color_mm1ws96t"] ?? "").trim() === "Submit Auth.") route = "/submit-auth";
      }
      // Belt and braces: any patient whose Sub-Stage reads Doctor Appointment
      // opens the outreach page, whichever chart surfaced them. The dedicated
      // Doctor Appointments row routes there already, but a patient could
      // linger in another chart's population after a stage change.
      {
        const p = (data?.get(chartId) ?? []).find((x) => x.id === patientId);
        if (p && (p.cols["color_mm1wyr92"] ?? "").trim() === "Doctor Appointment") {
          route = "/doctor-appointments";
        }
      }
      if (!route) {
        toast.info("This stage doesn't have a dedicated page yet");
        return;
      }
      const params = new URLSearchParams({ patientId });
      params.set("from", "system-mgmt");
      // ⚠️ Pinned (2026-09-28, Mary Mathis): a patient opened from Oversight is
      // SHOWN on the page even if this browser hid them after an earlier action
      // — lib/shared/managerOrigin `PIN_DEEP_LINK_PARAM`.
      params.set(PIN_DEEP_LINK_PARAM, "1");
      // Tell the destination page WHICH manager column this click came from, so
      // it can resolve its own action bar (lib/shared/stageActions). Derived
      // from the section layout rather than the chart id, so adding a chart to a
      // column needs no change here.
      const section = OVERSIGHT_SECTIONS.find(
        (s) =>
          s.chartIds.includes(chartId) ||
          s.secondaryChartIds?.includes(chartId) ||
          s.tertiaryChartIds?.includes(chartId),
      );
      const isTertiary = !!section?.tertiaryChartIds?.includes(chartId);
      const isSecondary = !!section?.secondaryChartIds?.includes(chartId);
      // The chart itself, for pages whose list must match one specific bar
      // chart rather than a whole column (two DVS charts share a column).
      if (isTertiary || isSecondary) params.set(MANAGER_CHART_PARAM, chartId);
      if (isTertiary) {
        params.set(MANAGER_ORIGIN_PARAM, "final-decisions");
      } else if (isSecondary) {
        params.set(MANAGER_ORIGIN_PARAM, "manager-intervention");
      } else if (section?.primaryTitle) {
        // Column 1 of a 3-column manager view (plain stage views have no
        // primaryTitle and stay unmarked, i.e. an ordinary rep page).
        params.set(MANAGER_ORIGIN_PARAM, "overview");
      }
      // Any chart in a MANAGER column (2 or 3) opens the page in manager mode:
      // ?manager=1 narrows the sidebar to escalated patients and unhides the
      // panel actions that are gated for escalated items; ?escalated=1 styles
      // the page as escalated.
      //
      // Driven by the section layout, NOT by chart-id suffixes. The old suffix
      // list silently missed `benefits-manager-escalation` — singular
      // "-escalation" matches none of "-escalations" / "-final-escalation" — so
      // that chart opened an unfiltered rep sidebar showing every Benefits
      // patient instead of the escalated ones the chart counted.
      //
      // The destination page narrows its sidebar to exactly this bar
      // (lib/samantha/managerRail), so it also needs WHICH bar was clicked —
      // the chart id alone would list every reason on the card.
      if ((isSecondary || isTertiary) && bucket !== "all") {
        params.set(MANAGER_BUCKET_PARAM, bucket);
      }
      if (isSecondary || isTertiary) {
        // manager=1 unhides the manager actions. The rail filter is what makes
        // the sidebar match the chart, so this no longer has to double as a
        // list filter.
        params.set("manager", "1");
        // ?escalated=1 only red-styles the page, so set it only when the
        // patient really is escalated: the reason-bucketed charts are built on
        // board FACTS (the ">5d" bar aside, a patient can sit in one with no
        // escalation at all) and styling them as escalated would be a lie.
        const p = (data?.get(chartId) ?? []).find((x) => x.id === patientId);
        const esc = (p?.cols["color_mm2vsh2f"] ?? "").trim();
        if (esc === "Manager Escalation Required" || esc === "Final Escalation Required") {
          params.set("escalated", "1");
        }
      }
      navigate(`${route}?${params.toString()}`);
    },
    [navigate, data],
  );

  const handlePatientClick = useCallback(
    (patientId: string) => {
      if (expandedChart) navigateToPatient(expandedChart, patientId, selectedBucket);
    },
    [expandedChart, selectedBucket, navigateToPatient],
  );

  // Mirror stage + drill-down state into the URL (replace, no history spam) so
  // the entry that exists when the user clicks through to a patient already
  // encodes this view — Back then lands right back on the open drilldown, and
  // on the pinned patient (`patient`, Brandon's own param name, §5.52).
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "oversight");
    next.set("stage", selectedStage);
    if (expandedChart) next.set("chart", expandedChart);
    else next.delete("chart");
    if (expandedChart && selectedBucket !== "all") next.set("bucket", selectedBucket);
    else next.delete("bucket");
    if (focusId) next.set("patient", focusId);
    else next.delete("patient");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStage, expandedChart, selectedBucket, focusId]);

  // ── Derived values ────────────────────────────────────────────

  /**
   * ⚠️⚠️ **"IN oversight" means a chart on this screen counts them** (Josh,
   * 2026-09-24). The population is the Map already on screen, deduplicated —
   * never a board read — so the finder costs no request and cannot find a
   * patient the columns do not show. It is also the header's count: the only
   * charts outside every section are the stacked charts' source series, and
   * both sit inside their merged chart's own population, so the old
   * all-charts count and this one are the same number.
   */
  const people = useMemo(() => pipelinePeople(data), [data]);
  const hits = useMemo(() => searchPipeline(people, ovQuery), [people, ovQuery]);
  /** A highlight left past the end by a shrinking list falls back to the top. */
  const ovHiSafe = ovHi < hits.length ? ovHi : 0;
  const focusPerson = useMemo(
    () => (focusId ? people.find((p) => p.patient.id === focusId) ?? null : null),
    [people, focusId],
  );

  const chartById = useMemo(
    () => new Map(CHART_DEFS.map((c) => [c.id, c])),
    [],
  );

  // The drop-down closes on any mousedown outside the box (Brandon's rule).
  // Rows swallow their own mousedown so the input keeps focus until the pick.
  useEffect(() => {
    if (!ovOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ovSearchRef.current && !ovSearchRef.current.contains(e.target as Node)) setOvOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ovOpen]);

  /** Picking a row: switch the stage below to theirs and pin them on top. */
  const pickPerson = useCallback((person: PipelinePerson) => {
    setSelectedStage(person.sectionId);
    setFocusId(person.patient.id);
    setOvQuery("");
    setOvOpen(false);
    setOvHi(0);
    ovInputRef.current?.blur();
  }, []);

  const onFinderKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hits.length) return;
      e.preventDefault();
      // A closed list reopens on the row it shows highlighted, rather than
      // opening one row further down than the manager can see.
      if (!ovOpen) {
        setOvOpen(true);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setOvHi((i) => ((i < hits.length ? i : 0) + step + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      const person = hits[ovHiSafe];
      if (person) {
        e.preventDefault();
        pickPerson(person);
      }
    } else if (e.key === "Escape") {
      setOvQuery("");
      setOvOpen(false);
      setOvHi(0);
      ovInputRef.current?.blur();
    }
  };

  // Find the expanded chart's data for the modal
  const expandedChartDef = useMemo(
    () => (expandedChart ? CHART_DEFS.find((c) => c.id === expandedChart) : null),
    [expandedChart],
  );
  const expandedPatients = useMemo(() => {
    // The whole chart — the finder pins a patient rather than filtering the
    // charts (§5.52), and the drill-down keeps its own search box for rows.
    if (!expandedChart || !data) return [];
    const def = CHART_DEFS.find((c) => c.id === expandedChart);
    if (def?.stacked) {
      // Merged chart: union of both series plus the escalated-but-unclassified
      // remainder, tagged via the synthetic __series__ column (red 3rd+ wins
      // the dedup, same as the bars).
      const st = def.stacked;
      const { a, b, others } = stackedSeries(def, data);
      return [
        ...b.map((p) => ({ ...p, cols: { ...p.cols, __series__: st.bLabel } })),
        ...a.map((p) => ({ ...p, cols: { ...p.cols, __series__: st.aLabel } })),
        ...others.map((p) => ({ ...p, cols: { ...p.cols, __series__: "Other escalation" } })),
      ];
    }
    let list = data.get(expandedChart) ?? [];
    // Final Decisions: the reason has no Monday column of its own — pull the
    // stamped line back out of the chart's reason source (MN notes for Medical
    // Evaluation, Reference Notes for Insurance) into a synthetic
    // __proposedReason__ column so the drill-down can show it at a glance.
    if (def?.decision && def.reasonColId) {
      const reasonColId = def.reasonColId;
      list = list.map((p) => ({
        ...p,
        cols: { ...p.cols, __proposedReason__: extractProposedStuckReason(p.cols[reasonColId]) },
      }));
    }
    // Reason-bucketed charts: the matched bar labels become the synthetic
    // __reasons__ column (rendered as pills). Evaluated from the SAME rules
    // as the bars, so the table can never disagree with the chart.
    if (def?.reasonBuckets?.length) {
      list = list.map((p) => ({
        ...p,
        cols: { ...p.cols, __reasons__: reasonBucketsFor(def, p).join(", ") },
      }));
    }
    return list;
  }, [expandedChart, data]);

  // Final Decisions (§3): Approve writes the real Stuck (main Stage Advancer) and
  // clears the escalation; Return re-dates + clears the escalation (Proposed
  // Stuck also stamps the manager's optional note into the MN notes). The row
  // disappears optimistically; the silent refetch reconciles.
  const handleDecision = useCallback(
    async (patientId: string, action: DecisionAction, kind: NonNullable<ChartDef["decision"]>, chartId: string, appendNote?: string) => {
      try {
        if (kind === "intake-manager") {
          // Patient Intake, Manager Intervention. Escalate promotes to Final
          // Decisions by writing the SAME Propose Stuck the rep's dialog does,
          // one rung up — so the reason lands in the Call Log in the shape
          // Final Decisions already reads, rather than a second format.
          if (action === "escalate") {
            await proposeIntakeStuck(patientId, appendNote ?? "", "final", "manager-intervention");
          } else {
            await returnIntakeToPipeline(patientId, appendNote ?? "Returned by a manager");
          }
        } else if (kind === "intake-final") {
          if (action === "approve") await approveIntakeStuck(patientId, appendNote ?? "");
          else await returnIntakeToPipeline(patientId, appendNote ?? "Returned by a manager");
        } else if (kind === "submit-auth-manager") {
          // Manager Intervention Submit Auth: Escalate to Final Decisions
          // (required note — enforced by the modal AND the API, belt and
          // braces on a status flip) or Return to Queue (same clear-and-
          // re-date as a Final Decisions return).
          if (action === "escalate") await escalateSubmitAuthToFinal(patientId, appendNote ?? "");
          else await returnInsuranceToQueue(patientId, appendNote);
        } else if (kind === "insurance-final") {
          if (action === "approve") await approveInsuranceStuck(patientId, appendNote);
          else await returnInsuranceToQueue(patientId, appendNote);
        } else if (kind === "welcome-call-manager") {
          // Welcome Call board, Manager Intervention: Escalate to Final
          // Decisions (required note — the modal AND the writer enforce it) or
          // send back to the pipeline (clears the Follow Up snooze + the flag).
          if (action === "escalate") await escalateWelcomeCallToFinal(patientId, appendNote ?? "");
          else await returnWelcomeCallToQueue(patientId, appendNote);
        } else if (kind === "welcome-call-final") {
          if (action === "approve") await approveWelcomeCallStuck(patientId, appendNote);
          else await returnWelcomeCallToQueue(patientId, appendNote);
        } else {
          if (action === "approve") await approveProposedStuck(patientId, appendNote);
          // Same rule as the stage pages' own action bar: a return hands the rep
          // a working queue back, which means rolling the spent attempt columns
          // into the notes and resetting MN Attempts. `rowOf` is the stage key
          // the chart belongs to, and picks the scope (lib/masheke/attemptRollup).
          else await returnProposedToQueue(patientId, appendNote, {
            resetScope: returnAttemptReset(CHART_DEFS.find((c) => c.id === chartId)?.rowOf),
          });
        }
        toast.success(
          action === "escalate"
            ? "Escalated — sent to Final Decisions"
            : action === "approve"
              ? "Approved — patient marked Stuck"
              : "Returned to the rep's queue",
        );
        // Optimistic removal from the chart(s) the patient just left: an
        // escalated Manager Intervention row leaves ONLY the chart it was
        // decided from (it reappears under Final Decisions on the reconciling
        // refetch). Keyed on the chart id rather than the kind — several
        // Manager Intervention charts share the "submit-auth-manager" kind.
        const leaves = (k: string) =>
          kind === "submit-auth-manager" || kind === "intake-manager" || kind === "intake-final"
          || kind === "welcome-call-manager" || kind === "welcome-call-final"
            ? k === chartId
            : k.endsWith(kind === "insurance-final" ? "-final-escalation" : "-proposed-stuck");
        setData((prev) => {
          if (!prev) return prev;
          const next = new Map(prev);
          for (const [k, list] of next) {
            if (leaves(k)) next.set(k, list.filter((p) => p.id !== patientId));
          }
          return next;
        });
        // Reconcile AFTER Monday's indexing lag — an immediate refetch can
        // still read the pre-decision column values and resurrect the row
        // the optimistic update just removed. refetch guards on mountedRef.
        setTimeout(() => refetch(true), 12_000);
      } catch (e) {
        toast.error(
          `${action === "escalate" ? "Escalate to Final Decisions" : action === "approve" ? "Approve Stuck" : "Return to Queue"} failed`,
          { description: e instanceof Error ? e.message : String(e) },
        );
      }
    },
    [refetch],
  );

  /** The pinned card's confirm: same writer, same busy lock as the drill-down. */
  const confirmPinned = async (note: string | undefined) => {
    if (!pinDecision || pinBusy) return;
    const chart = chartById.get(pinDecision.chartId);
    if (!chart?.decision) return;
    setPinBusy(true);
    try {
      // handleDecision toasts its own failure and never rethrows, so the
      // dialog closes either way — exactly as the drill-down's does.
      await handleDecision(pinDecision.patient.id, pinDecision.action, chart.decision, chart.id, note);
    } finally {
      setPinBusy(false);
      setPinDecision(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────

  // Cold load (no cached data): render the SHAPE of the page rather than a bare
  // centred spinner, so the layout doesn't jump when the data lands and the
  // manager can see what's coming while Monday is queried. Same cells as the
  // real columns below, so the amber rule is already where it will be.
  if (loading && !data) {
    const section =
      OVERSIGHT_SECTIONS.find((s) => s.id === selectedStage) ?? OVERSIGHT_SECTIONS[0];
    const isManagerView = !!section.tertiaryChartIds?.length;
    const rows = section.chartIds.length || 3;
    return (
      <div className="cc-ov space-y-4">
        <div className="flex items-center gap-3 pt-3.5">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium text-muted-foreground">
            Loading {section.title} from Monday…
          </p>
        </div>
        {isManagerView ? (
          <div className="ov-cols">
            <div className="ov-cell c1"><div className="eyebrow">{section.primaryTitle ?? "Active"}</div></div>
            <div className="ov-cell c2"><div className="eyebrow">{section.secondaryTitle ?? "Escalations"}</div></div>
            <div className="ov-cell c3"><div className="eyebrow">{section.tertiaryTitle ?? "Escalations"}</div></div>
            {Array.from({ length: rows }).map((_, r) => (
              <Fragment key={r}>
                <div className="ov-cell c1"><ChartSkeleton seed={r * 3} /></div>
                <div className="ov-cell c2"><ChartSkeleton seed={r * 3 + 1} /></div>
                <div className="ov-cell c3"><ChartSkeleton seed={r * 3 + 2} /></div>
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="ov-grid g2">
            {Array.from({ length: rows * 2 }).map((_, i) => (
              <ChartSkeleton key={i} seed={i} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="cc-ov flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={() => refetch(false)}
          className="text-sm text-blue-500 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const currentSection =
    OVERSIGHT_SECTIONS.find((s) => s.id === selectedStage) ?? OVERSIGHT_SECTIONS[0];
  const listboxId = "ov-search-list";

  return (
    <div className="cc-ov space-y-3">
      {/* Header — Brandon's `.ov-hdr`: title + who and how many, the finder,
          the stage, and the sync state beside Edit scoring. */}
      <div className="ov-hdr">
        <div>
          <h1>Pipeline Oversight</h1>
          <div className="xs muted">
            {myName} · {fmt(people.length)} patient{people.length === 1 ? "" : "s"} in the pipeline
          </div>
        </div>

        {/* The finder. ⚠️ NAME ONLY and IN-OVERSIGHT ONLY, and the placeholder
            says so: the oversight read carries no DOB or phone, and "keyed on
            only patients that are IN oversight" is Josh's rule (§5.52). The
            header's search is the one that covers every board. */}
        <div className="ov-search" ref={ovSearchRef}>
          <Search aria-hidden="true" />
          <input
            ref={ovInputRef}
            className="input"
            value={ovQuery}
            onChange={(e) => {
              setOvQuery(e.target.value);
              setOvHi(0);
              setOvOpen(true);
            }}
            onFocus={() => {
              if (ovQuery.trim()) setOvOpen(true);
            }}
            onBlur={(e) => {
              // Keyboard users tab away; a row click never blurs (its
              // mousedown is swallowed), and the ✕ sits inside the box.
              if (!ovSearchRef.current?.contains(e.relatedTarget as Node | null)) setOvOpen(false);
            }}
            onKeyDown={onFinderKey}
            placeholder="Find a patient in the pipeline by name…"
            aria-label="Search the pipeline"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={ovOpen && !!ovQuery.trim()}
            aria-controls={listboxId}
            aria-activedescendant={ovOpen && hits.length ? `${listboxId}-${ovHiSafe}` : undefined}
          />
          {ovQuery && (
            <button
              type="button"
              className="clear"
              aria-label="Clear search"
              onClick={() => {
                setOvQuery("");
                setOvOpen(false);
                setOvHi(0);
                ovInputRef.current?.focus();
              }}
            >
              <X aria-hidden="true" />
            </button>
          )}
          {ovOpen && ovQuery.trim() && (
            <div className="gs-drop" role="listbox" id={listboxId} aria-label="Patients in the pipeline">
              {hits.length ? (
                <>
                  {hits.map((person, i) => {
                    const senior = seniorChart(person.charts);
                    const col = senior ? columnOf(senior.id) : 1;
                    const bucket = person.patient.dayBucket;
                    return (
                      <button
                        key={person.patient.id}
                        id={`${listboxId}-${i}`}
                        type="button"
                        role="option"
                        aria-selected={i === ovHiSafe}
                        className={cn("gs-row", i === ovHiSafe && "hi")}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setOvHi(i)}
                        onClick={() => pickPerson(person)}
                      >
                        <span className="who"><span className="nm">{person.patient.name}</span></span>
                        <span className="st onb">
                          {person.sectionTitle}{bucket !== "Unknown" ? ` · ${bucket}` : ""}
                        </span>
                        <span className="hit">
                          {col === 2 && <span className="st amber">Manager intervention</span>}
                          {col === 3 && <span className="st red">Final decisions</span>}
                        </span>
                      </button>
                    );
                  })}
                  <div className="gs-foot">{searchFootLine(hits.length)}</div>
                </>
              ) : (
                <div className="gs-foot">{searchEmptyLine(ovQuery)}</div>
              )}
            </div>
          )}
        </div>

        <select
          className="input"
          aria-label="Stage"
          value={selectedStage}
          onChange={(e) => setSelectedStage(e.target.value)}
        >
          {OVERSIGHT_SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>

        {/* Shown for every fetch, background polls included, so the manager
            always knows when the numbers are being pulled from Monday. The
            span renders even when empty: its auto margin is what keeps Edit
            scoring on the right. */}
        <span className="row xs muted sync">
          {fetching && (
            <>
              <RefreshCw className="animate-spin" aria-hidden="true" />
              Syncing with Monday…
            </>
          )}
          {error && <span className="text-destructive">Refresh failed</span>}
        </span>
        <button type="button" className="btn ghost xs" onClick={() => setConfigOpen(true)}>
          <SlidersHorizontal aria-hidden="true" /> Edit scoring
        </button>
      </div>

      {/* The pinned patient — Brandon's `.ov-focus`. */}
      {focusId && (focusPerson || data) && (
        <div className="ov-focus-wrap">
          <section className="card pad ov-focus" aria-label="Pinned patient">
            {focusPerson ? (
              <PinnedPatientCard
                person={focusPerson}
                selectedStage={selectedStage}
                selectedStageTitle={currentSection.title}
                busy={pinBusy}
                onSwitchStage={() => setSelectedStage(focusPerson.sectionId)}
                onOpenStageTool={(chartId) => navigateToPatient(chartId, focusPerson.patient.id, "all")}
                onDecide={(chart, action) =>
                  setPinDecision({ chartId: chart.id, patient: focusPerson.patient, action })
                }
                onClear={() => setFocusId(null)}
              />
            ) : (
              // ⚠️ Pinned from a stale link, or decided a moment ago: the Map no
              // longer holds them, so there is nothing to act on — say so
              // rather than render an empty card.
              <div className="row" style={{ gap: 12 }}>
                <span className="grow small muted">
                  This patient isn't in the pipeline any more — the columns below no longer count them.
                </span>
                <button
                  type="button"
                  className="btn ghost xs"
                  title="Clear"
                  aria-label="Clear the pinned patient"
                  onClick={() => setFocusId(null)}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Selected stage only — charts for the chosen pipeline stage */}
      {(() => {
        const section = currentSection;

        const resolve = (ids: string[]) =>
          ids.map((id) => chartById.get(id)).filter((c): c is ChartDef => Boolean(c));
        const charts = resolve(section.chartIds);
        const secondaryCharts = section.secondaryChartIds
          ? resolve(section.secondaryChartIds)
          : [];
        const tertiaryCharts = section.tertiaryChartIds
          ? resolve(section.tertiaryChartIds)
          : [];

        // Unique patients across this stage's PRIMARY charts only.
        // Deliberate: escalated + proposed-stuck patients left the active
        // pool, so the header counts the workable queue — the manager columns
        // carry their own per-chart counts.
        const seen = new Set<string>();
        for (const c of charts) for (const p of data?.get(c.id) ?? []) seen.add(p.id);
        const sectionTotal = seen.size;

        const renderChart = (chart: ChartDef) => {
          if (chart.reasonBuckets?.length) {
            return (
              <ReasonStageChart
                chart={chart}
                patients={data?.get(chart.id) ?? []}
                priorityConfig={priorityConfig}
                onChartClick={() => handleChartClick(chart.id)}
                onBarClick={(bucket) => handleBarClick(chart.id, bucket)}
              />
            );
          }
          if (chart.stacked) {
            // Two-series merged chart: series B (3rd+ round, red) wins the
            // dedup — a patient matching both pools counts once, in red.
            const { a, b, others } = stackedSeries(chart, data ?? null);
            return (
              <StackedStageChart
                chart={chart}
                seriesA={a}
                seriesB={b}
                others={others}
                onChartClick={() => handleChartClick(chart.id)}
                onBarClick={(bucket) => handleBarClick(chart.id, bucket)}
              />
            );
          }
          return (
            <StageChart
              chart={chart}
              patients={data?.get(chart.id) ?? []}
              priorityConfig={priorityConfig}
              onChartClick={() => handleChartClick(chart.id)}
              onBarClick={(bucket) => handleBarClick(chart.id, bucket)}
            />
          );
        };

        const renderGrid = (list: ChartDef[]) => (
          <div className={cn("ov-grid", list.length > 1 && "g2", list.length > 2 && "g3")}>
            {list.map((chart) => (
              <Fragment key={chart.id}>{renderChart(chart)}</Fragment>
            ))}
          </div>
        );

        // Row alignment (manager views 2026-07): a column-2/3 chart names the
        // column-1 chart it sits beside via its rowOf field.
        const escFor = (chart: ChartDef) =>
          secondaryCharts.find((s) => s.rowOf === chart.id) ?? null;
        const tertFor = (chart: ChartDef) =>
          tertiaryCharts.find((s) => s.rowOf === chart.id) ?? null;

        return (
          <section>
            <div className="stage-row">
              <h2>{section.title}</h2>
              <span className="small muted">
                {fmt(sectionTotal)} patient{sectionTotal !== 1 ? "s" : ""}
              </span>
              <span className="xs muted hint">
                the search above covers every stage — you don't have to pick the right one first
              </span>
            </div>

            {tertiaryCharts.length > 0 ? (
              // Three-column layout: Processor Overview | Manager Intervention |
              // Final Decisions, Brandon's `.ov-cols`. ⚠️ ONE grid of cells,
              // not his three stacks: each row pairs an original chart with its
              // escalation counterparts (an empty cell where a stage has none),
              // which is the row alignment Brandon asked for on 2026-08-12. The
              // cells carry his column padding and amber rule, so the line reads
              // continuous from the eyebrow down.
              <div className="ov-cols">
                <div className="ov-cell c1"><div className="eyebrow">{section.primaryTitle ?? "Active"}</div></div>
                <div className="ov-cell c2"><div className="eyebrow">{section.secondaryTitle ?? "Escalations"}</div></div>
                <div className="ov-cell c3"><div className="eyebrow">{section.tertiaryTitle ?? "Escalations"}</div></div>
                {charts.map((chart) => {
                  const esc = escFor(chart);
                  const ter = tertFor(chart);
                  return (
                    <Fragment key={chart.id}>
                      <div className="ov-cell c1">{renderChart(chart)}</div>
                      <div className="ov-cell c2">{esc ? renderChart(esc) : null}</div>
                      <div className="ov-cell c3">{ter ? renderChart(ter) : null}</div>
                    </Fragment>
                  );
                })}
              </div>
            ) : secondaryCharts.length > 0 ? (
              // Paired layout: each original chart on the LEFT, its escalated
              // counterpart on the RIGHT, split by the same amber rule.
              // Originals with no escalated counterpart leave the right side blank.
              <div className="ov-cols two">
                <div className="ov-cell c1"><div className="eyebrow">{section.primaryTitle ?? "Active"}</div></div>
                <div className="ov-cell c2"><div className="eyebrow">{section.secondaryTitle ?? "Escalations"}</div></div>
                {charts.map((chart) => {
                  const esc = escFor(chart);
                  return (
                    <Fragment key={chart.id}>
                      <div className="ov-cell c1">{renderChart(chart)}</div>
                      <div className="ov-cell c2">{esc ? renderChart(esc) : null}</div>
                    </Fragment>
                  );
                })}
              </div>
            ) : (
              renderGrid(charts)
            )}
          </section>
        );
      })()}

      {/* Drill-down modal overlay */}
      {expandedChart && expandedChartDef && (
        <DrilldownModal
          chart={expandedChartDef}
          patients={expandedPatients}
          bucket={selectedBucket}
          priorityConfig={priorityConfig}
          pillColors={pillColors}
          onBucketChange={handleBucketChange}
          onClose={handleClose}
          onPatientClick={handlePatientClick}
          hasRoute={CHART_ROUTES[expandedChart!] !== null}
          onDecision={expandedChartDef.decision ? (id, action, appendNote) => handleDecision(id, action, expandedChartDef.decision!, expandedChartDef.id, appendNote) : undefined}
        />
      )}

      {/* The pinned card's decision — the drill-down's own dialog. */}
      {pinDecision && (() => {
        const chart = chartById.get(pinDecision.chartId);
        if (!chart?.decision) return null;
        return (
          <DecisionConfirmModal
            key={`${pinDecision.patient.id}:${pinDecision.action}`}
            chart={chart}
            patient={pinDecision.patient}
            action={pinDecision.action}
            busy={pinBusy}
            onCancel={() => setPinDecision(null)}
            onConfirm={confirmPinned}
          />
        );
      })()}

      {/* Priority scoring config */}
      {configOpen && (
        <PriorityConfigModal
          config={priorityConfig}
          referralOptions={priorityOptions.referralTypes}
          insuranceOptions={priorityOptions.insurances}
          onChange={updateConfig}
          onReset={() => updateConfig(DEFAULT_PRIORITY_CONFIG)}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}

// ── PriorityConfigModal ──────────────────────────────────────────────────

const NUM_INPUT =
  "rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400";

function PriorityConfigModal({
  config,
  referralOptions,
  insuranceOptions,
  onChange,
  onReset,
  onClose,
}: {
  config: PriorityConfig;
  referralOptions: string[];
  insuranceOptions: string[];
  onChange: (c: PriorityConfig) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  type TierGroup = "referralTiers" | "insuranceTiers";
  type DefKey = "referralDefault" | "insuranceDefault";

  const setTier = (group: TierGroup, idx: number, patch: Partial<PriorityTier>) =>
    onChange({
      ...config,
      [group]: config[group].map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    });
  const addTier = (group: TierGroup) =>
    onChange({ ...config, [group]: [...config[group], { points: 1, match: [] }] });
  const removeTier = (group: TierGroup, idx: number) =>
    onChange({ ...config, [group]: config[group].filter((_, i) => i !== idx) });

  const renderTierGroup = (
    group: TierGroup,
    label: string,
    defKey: DefKey,
    options: string[],
  ) => {
    const usedInGroup = new Set(config[group].flatMap((t) => t.match));
    // Default-tier labels = real options not assigned to any tier above.
    const defaultLabels = options.filter((o) => !usedInGroup.has(o));
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-foreground">{label}</h4>
          <button
            onClick={() => addTier(group)}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <Plus className="h-3 w-3" /> Add tier
          </button>
        </div>
        <div className="space-y-2.5">
          {config[group].map((t, i) => {
            // Options available to add to THIS tier = not used by any tier.
            const available = options.filter((o) => !usedInGroup.has(o));
            return (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-border p-2"
              >
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <input
                    type="number"
                    value={t.points}
                    onChange={(e) => setTier(group, i, { points: Number(e.target.value) })}
                    className={cn(NUM_INPUT, "w-12")}
                  />
                  <span className="text-[11px] text-muted-foreground">pts</span>
                </div>
                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                  {t.match.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
                    >
                      {m}
                      <button
                        onClick={() =>
                          setTier(group, i, { match: t.match.filter((x) => x !== m) })
                        }
                        className="text-muted-foreground hover:text-red-600"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        setTier(group, i, { match: [...t.match, e.target.value] });
                    }}
                    className={cn(NUM_INPUT, "max-w-[180px]")}
                    disabled={available.length === 0}
                  >
                    <option value="">+ Add…</option>
                    {available.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => removeTier(group, i)}
                  className="text-muted-foreground hover:text-red-600 shrink-0 pt-0.5"
                  title="Remove tier"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <div className="flex items-start gap-2 pt-0.5">
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                value={config[defKey]}
                onChange={(e) => onChange({ ...config, [defKey]: Number(e.target.value) })}
                className={cn(NUM_INPUT, "w-12")}
              />
              <span className="text-[11px] text-muted-foreground">pts</span>
            </div>
            <span className="text-[11px] text-muted-foreground pt-1">
              everything else{defaultLabels.length ? ` (${defaultLabels.length} labels)` : ""}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[92vw] max-w-2xl max-h-[88vh] flex flex-col animate-in zoom-in-95 fade-in duration-150">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-blue-500" />
            <h3 className="text-base font-semibold text-foreground">Priority Scoring</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <p className="text-xs text-muted-foreground">
            Score = referral + insurance + days pressure (days pressure currently
            0). Pick the status labels for each tier; anything not assigned uses the
            "everything else" points. Options are pulled live from the Monday status columns.
          </p>
          {renderTierGroup("referralTiers", "Referral Type", "referralDefault", referralOptions)}
          {renderTierGroup("insuranceTiers", "Insurance", "insuranceDefault", insuranceOptions)}

          <div>
            <h4 className="text-sm font-bold text-foreground mb-2">Days Pressure</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DAY_BUCKETS_ORDERED.map((b) => (
                <div key={b} className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={config.daysPoints[b]}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        daysPoints: { ...config.daysPoints, [b]: Number(e.target.value) },
                      })
                    }
                    className={cn(NUM_INPUT, "w-12 shrink-0")}
                  />
                  <span className="text-[11px] text-muted-foreground">{b}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-foreground mb-2">VIP Threshold</h4>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={config.threshold}
                onChange={(e) => onChange({ ...config, threshold: Number(e.target.value) })}
                className={cn(NUM_INPUT, "w-16 shrink-0")}
              />
              <span className="text-xs text-muted-foreground">
                Patients scoring this or higher are flagged.
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
