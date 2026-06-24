/**
 * Pure helpers that turn a processor's profile (roles + per-role filters +
 * per-role order) into what the views need. Kept separate from accessStore
 * (a React hook) so role pages, the burndown, and tests can import these
 * without pulling in the GitHub-sync machinery.
 */
import { ROLES } from "./config";
import type { ProcessorProfile, RoleFilter } from "./accessStore";

const CONFIG_ORDER = new Map(ROLES.map((r, i) => [r.id, i]));

export const DEFAULT_ROLE_FILTER: RoleFilter = "nonEscalated";

/** The filter for one of a processor's roles (defaults to "nonEscalated"). */
export function roleFilterFor(
  profile: Pick<ProcessorProfile, "roleFilters"> | null | undefined,
  roleId: string,
): RoleFilter {
  return profile?.roleFilters?.[roleId] ?? DEFAULT_ROLE_FILTER;
}

/** A processor's assigned role ids ordered by their SOP number (1,2,3…),
 *  with any unnumbered roles falling back to the canonical config order. */
export function orderedRoleIds(
  profile: Pick<ProcessorProfile, "roles" | "roleOrder"> | null | undefined,
): string[] {
  const roles = profile?.roles ?? [];
  const order = profile?.roleOrder ?? {};
  return [...roles].sort((a, b) => {
    const oa = order[a];
    const ob = order[b];
    if (oa != null && ob != null && oa !== ob) return oa - ob;
    if (oa != null && ob == null) return -1;
    if (oa == null && ob != null) return 1;
    return (CONFIG_ORDER.get(a) ?? 999) - (CONFIG_ORDER.get(b) ?? 999);
  });
}

/** The display order number a processor set for a role, if any. */
export function roleOrderNumber(
  profile: Pick<ProcessorProfile, "roleOrder"> | null | undefined,
  roleId: string,
): number | null {
  const n = profile?.roleOrder?.[roleId];
  return typeof n === "number" ? n : null;
}

/** Resolve the active escalation filter from a role page's URL params.
 *  New `?filter=` wins; legacy `?manager=1` maps to "escalated"; default is
 *  "nonEscalated" (today's processor behavior). */
export function viewFilterFromParams(sp: URLSearchParams): RoleFilter {
  const f = sp.get("filter");
  if (f === "all" || f === "escalated" || f === "nonEscalated") return f;
  if (sp.get("manager") === "1") return "escalated";
  return "nonEscalated";
}

/** The query string a burndown bar uses to open a role page for a filter.
 *  "escalated" keeps the legacy ?manager=1 (so role pages + sidebars that read
 *  it keep working); "all" uses ?filter=all; "nonEscalated" → no param. */
export function filterQuery(filter: RoleFilter): string {
  if (filter === "escalated") return "?manager=1";
  if (filter === "all") return "?filter=all";
  return "";
}
