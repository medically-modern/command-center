/**
 * Manager-view origin — WHICH oversight column a manager clicked through from.
 *
 * Pipeline Oversight's manager views have three columns (Processor Overview /
 * Manager as Processor / Final Decisions) and every one of them deep-links into
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
export type ManagerOrigin = "overview" | "manager-processor" | "final-decisions";

/** Query-string key. Short because it sits alongside patientId/from/manager. */
export const MANAGER_ORIGIN_PARAM = "mv";

const VALID: readonly ManagerOrigin[] = ["overview", "manager-processor", "final-decisions"];

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
