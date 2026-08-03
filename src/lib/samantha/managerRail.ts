/**
 * Manager-view rail narrowing — make a role page's sidebar list exactly the
 * patients behind the oversight bar the manager clicked.
 *
 * Clicking a bar in Pipeline Oversight deep-links into the role page for that
 * patient. Before this, the page then showed its OWN idea of a list — every
 * Benefits patient, every DVS patient — so a manager who clicked a bar of 4
 * landed on a sidebar of 17 and had no way to walk the cohort they were
 * looking at. The chart and the page disagreed.
 *
 * The oversight chart id and reason bucket ride in the URL (`mvc` / `mvb`,
 * lib/shared/managerOrigin), and the predicates below re-express each bar's
 * rule against the samantha `Patient` model so the page can filter locally —
 * no oversight fetch, no patient-id list in the query string.
 *
 * ⚠️ These MIRROR `CHART_FILTERS` + `reasonBuckets` in lib/oversight/oversightApi.
 * They read the same board facts through a different model, so the two must be
 * changed together — that's what `managerRail.test.ts` guards. Bucket labels
 * are matched EXACTLY as authored in the chart defs.
 */
import type { Patient } from "./workflow";
import { isNegUniversal } from "./workflow";
import { PROPOSED_STUCK_TAG } from "../masheke/proposedStuck";

export type RailPredicate = (p: Patient) => boolean;

/** Days Since Stage Started label indices at "6–8 Days" or beyond. Index 5 is
 *  unused on the board; matching the set (not `>= 2`) mirrors the chart. */
const OVERDUE_DAY_INDICES = new Set([2, 3, 4, 6, 7, 8]);

const MANAGER_ESC = "Manager Escalation Required";

/** Rose-tier DVS statuses — a human has to look. Mirrors DvsPage `toneFor`. */
const DVS_FAILED = new Set(["MLTC", "Failed", "Manual Review", "Denied"]);
const CLAIMS_FAILED = new Set(["Claims Error", "Claims Denied", "Payment Incorrect"]);

const hasProposedStuckStamp = (p: Patient): boolean =>
  (p.notes ?? "").includes(PROPOSED_STUCK_TAG);

const isInactive = (p: Patient): boolean =>
  isNegUniversal(p.insurance?.universal?.["active"]);

const isPumpSosNotClear = (p: Patient): boolean =>
  p.insurance?.codes?.["pump"]?.sos === "not-clear";

/** Escalated to a manager AND sat at 6–8 days or beyond (board automation
 *  raises the label when the days column crosses that mark). */
const isCheckOverdue = (p: Patient): boolean =>
  p.escalationLabel === MANAGER_ESC && OVERDUE_DAY_INDICES.has(p.daysSinceStageIndex ?? -1);

const isUniversalCheckFail = (p: Patient): boolean => {
  const u = p.insurance?.universal;
  // In-Network negative covers Out-of-Network AND Medicare not Primary.
  return isNegUniversal(u?.["in-network"]) || u?.["dme-benefits"] === "not-confirmed";
};

const FINAL_ESC = "Final Escalation Required";
const isFinal = (p: Patient): boolean => p.escalationLabel === FINAL_ESC;

const dvsRetryStatus = (p: Patient): boolean =>
  p.dvsStatus === "Retry Queued" || p.pumpDvsStatus === "Retry Queued";

const dvsManualStatus = (p: Patient): boolean =>
  DVS_FAILED.has(p.dvsStatus ?? "") ||
  DVS_FAILED.has(p.pumpDvsStatus ?? "") ||
  // Both halves of the board's split claims family — supplies AND pump.
  CLAIMS_FAILED.has(p.claimsStatus ?? "") ||
  CLAIMS_FAILED.has(p.ipClaimsStatus ?? "");

// Manager Intervention shows the not-yet-promoted half; Final Decisions the
// promoted half. Mirrors the escalation split added to both CHART_FILTERS
// on 2026-08-02 — change the two together.
const isDvsRetry = (p: Patient): boolean => dvsRetryStatus(p) && !isFinal(p);
const isDvsManualReview = (p: Patient): boolean => dvsManualStatus(p) && !isFinal(p);
const isDvsRetryFinal = (p: Patient): boolean => dvsRetryStatus(p) && isFinal(p);
const isDvsManualReviewFinal = (p: Patient): boolean => dvsManualStatus(p) && isFinal(p);

const isSubmitAuthProposed = (p: Patient): boolean =>
  p.escalationLabel === MANAGER_ESC && hasProposedStuckStamp(p);

/** chart id → (bucket label → predicate). The `null` key is the whole chart,
 *  used when a manager opens a card without clicking a specific bar. */
const RAIL: Record<string, { buckets: Record<string, RailPredicate>; all: RailPredicate }> = {
  "benefits-manager-escalation": {
    buckets: {
      "Inactive insurance": isInactive,
      "Pump SoS": isPumpSosNotClear,
      "Check outstanding >5d": isCheckOverdue,
    },
    all: (p) => isInactive(p) || isPumpSosNotClear(p) || isCheckOverdue(p),
  },
  "benefits-final-escalation": {
    buckets: {
      "Propose Stuck": hasProposedStuckStamp,
      "Universal Check": isUniversalCheckFail,
    },
    // Population is the Final escalation itself, not the union of the bars —
    // a patient matching neither bar still belongs in this chart (and its
    // sidebar), which is the "+N in no bar" case on the card.
    all: (p) => p.escalationLabel === "Final Escalation Required",
  },
  "submit-auth-manager": {
    buckets: {
      "DVS Retry": isDvsRetry,
      "DVS Manual Review": isDvsManualReview,
      "Propose Stuck": isSubmitAuthProposed,
    },
    all: (p) => isDvsRetry(p) || isDvsManualReview(p) || isSubmitAuthProposed(p),
  },
  // Final Decisions · Submit Auth row — reason-bucketed like its Manager
  // Intervention twin (2026-08-02). Population is the union of the bars, NOT
  // "any Final patient": two of the three bars are stage-DVS patients, so this
  // chart deliberately has no stage rule of its own (see CHART_FILTERS).
  "submit-auth-final-escalation": {
    buckets: {
      "DVS Retry": isDvsRetryFinal,
      "DVS Manual Review": isDvsManualReviewFinal,
      "Propose Stuck": (p) => isFinal(p) && hasProposedStuckStamp(p),
    },
    all: (p) => isDvsRetryFinal(p) || isDvsManualReviewFinal(p) || (isFinal(p) && hasProposedStuckStamp(p)),
  },
  "auth-outstanding-final-escalation": {
    buckets: {
      "Propose Stuck": (p) => isFinal(p) && hasProposedStuckStamp(p),
    },
    // Population stays "any Final patient at this stage" — the bucket only
    // subdivides it, so a Final patient without a stamp is still listed.
    all: isFinal,
  },
};

/**
 * The predicate for a chart + bucket, or null when this page shouldn't narrow
 * at all (an ordinary rep visit, or an unrecognised/older link). Returning null
 * rather than an empty filter is deliberate: a stale bookmark must never blank
 * someone's sidebar.
 */
export function railFilterFor(chartId: string | null, bucket: string | null): RailPredicate | null {
  if (!chartId) return null;
  const entry = RAIL[chartId];
  if (!entry) return null;
  if (bucket) return entry.buckets[bucket] ?? entry.all;
  return entry.all;
}

/**
 * Apply a rail filter to a page's patient list. The deep-linked patient is
 * ALWAYS kept even when they no longer match — the manager clicked that row,
 * and a page that opens without the patient on it is worse than one extra row
 * (their state can also change between the chart fetch and the page load).
 */
export function applyRail(
  patients: Patient[],
  filter: RailPredicate | null,
  deepLinkedId: string | null,
): Patient[] {
  if (!filter) return patients;
  return patients.filter((p) => filter(p) || p.id === deepLinkedId);
}
