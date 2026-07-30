/**
 * Manager-view origin — WHICH oversight column a manager clicked through from.
 *
 * Pipeline Oversight's manager views have three columns (Processor Overview /
 * Manager Intervention / Final Decisions) and every one of them deep-links into
 * the same role page. The page therefore needs to know where the click came
 * from, because the right action bar differs: a patient opened from Final
 * Decisions has ALREADY been proposed stuck, so offering "Propose Stuck" again
 * is a no-op — that manager needs to decide (Escalate Stuck / Return to Queue).
 *
 * The origin rides in the URL as `?mv=` alongside the existing `?manager=1` /
 * `?escalated=1` / `?from=system-mgmt` params, so Back-navigation and the
 * drill-down URL mirroring keep working untouched.
 *
 * Deliberately a TINY standalone module with no oversight imports: every role
 * page reads it, and pulling oversightApi (all the chart defs + filters) into
 * those bundles just to parse one query param would be a real cost. OversightTab
 * owns the writing side — it knows its own column layout — and pages only ever
 * read.
 */

/** The three manager-view columns, plus the ordinary (non-manager) entry. */
export type ManagerOrigin = "overview" | "manager-intervention" | "final-decisions";

/** Query-string key. Short because it sits alongside patientId/from/manager. */
export const MANAGER_ORIGIN_PARAM = "mv";

/**
 * The oversight CHART id the click came from, when the column alone isn't
 * specific enough. Two charts can share a column — DVS "Retry Queue" and DVS
 * "Manual Review" are both Manager Intervention — so a page that wants its
 * list to match the exact bar chart needs the chart, not just the column.
 */
export const MANAGER_CHART_PARAM = "mvc";

/**
 * The reason BUCKET (bar) within that chart, when the manager clicked a
 * specific bar rather than the card header. The Insurance manager charts are
 * reason-bucketed, so the chart id alone would list every reason — clicking
 * "Inactive insurance" has to land on a sidebar of inactive patients, not on
 * every patient the card counts.
 *
 * Carries the bucket's display label verbatim (e.g. "Pump SoS"); pages match
 * it against their own known labels and ignore anything unrecognised.
 */
export const MANAGER_BUCKET_PARAM = "mvb";

const VALID: readonly ManagerOrigin[] = ["overview", "manager-intervention", "final-decisions"];

function isManagerOrigin(v: string): v is ManagerOrigin {
  return (VALID as readonly string[]).includes(v);
}

/**
 * Read the origin out of a page's search params. Returns null when the param is
 * absent or unrecognised — i.e. a rep opening the page normally, or an older
 * bookmarked oversight link from before this param existed. Callers treat null
 * as "ordinary page", so a missing param can never hide a rep's own buttons.
 */
export function managerOriginFromParams(params: URLSearchParams): ManagerOrigin | null {
  const raw = params.get(MANAGER_ORIGIN_PARAM);
  if (!raw) return null;
  return isManagerOrigin(raw) ? raw : null;
}

/**
 * True for the two MANAGER ESCALATION columns (Manager Intervention / Final
 * Decisions) — the views where a manager owns the patient and may correct board
 * facts a rep can't (see `components/samantha/ManagerIdentityEditDialog`).
 *
 * Deliberately excludes "overview": Processor Overview is the rep's own queue
 * shown to a manager, and an edit affordance there would be one click away from
 * the rep-facing page it mirrors.
 *
 * One predicate so the three Insurance pages can't drift apart on who gets it.
 */
export function isManagerEscalationView(origin: ManagerOrigin | null): boolean {
  return origin === "manager-intervention" || origin === "final-decisions";
}

/**
 * The oversight chart id this page was opened from, or null for an ordinary
 * visit. Pages match it against their own known chart ids, so an unrecognised
 * value simply means "don't narrow" — never an empty list.
 */
export function managerChartFromParams(params: URLSearchParams): string | null {
  return params.get(MANAGER_CHART_PARAM) || null;
}

/**
 * The reason bucket this page was opened from, or null when the manager
 * opened the whole card (or on an ordinary visit). Null means "don't narrow
 * to one bar" — never an empty list.
 */
export function managerBucketFromParams(params: URLSearchParams): string | null {
  return params.get(MANAGER_BUCKET_PARAM) || null;
}
