/**
 * Pure helpers that turn a processor's profile (roles + per-role filters +
 * per-role order) into what the views need. Kept separate from accessStore
 * (a React hook) so role pages, the burndown, and tests can import these
 * without pulling in the GitHub-sync machinery.
 */
import { ROLES } from "./config";
import type { Access, CrossSellScope, EscalationFilter, ProcessorProfile, RoleFilter } from "./accessStore";

const CONFIG_ORDER = new Map(ROLES.map((r, i) => [r.id, i]));

/**
 * The role ids whose stage page is `route` (a pathname; a querystring is
 * tolerated and ignored).
 *
 * ⚠️ **The Chase pair maps BOTH WAYS.** The patient screen's Chase Clinicals
 * step routes to `/chase-fax`, but the chase job is split across TWO roles by
 * delivery method — `chaseFax` and `chaseParachute` (§5.9) — so a rep assigned
 * either one works Chase Clinicals, and a door gated on the route alone would
 * shut out half the chase team.
 */
const CHASE_ROUTES: ReadonlySet<string> = new Set(["/chase-fax", "/chase-parachute"]);
export function rolesForRoute(route: string): string[] {
  const path = (route || "").split("?")[0];
  if (!path) return [];
  const ids = ROLES.filter((r) => r.route === path).map((r) => r.id);
  if (CHASE_ROUTES.has(path)) {
    for (const r of ROLES) {
      if (CHASE_ROUTES.has(r.route) && !ids.includes(r.id)) ids.push(r.id);
    }
  }
  return ids;
}

/**
 * May this person WORK the stage page at `route`? (Josh, 2026-09-25, on the
 * patient screen's "Open <tool>" link: *"people who are assigned the ROLE of
 * final profile confirmation should see it; people who arent assigned that
 * rols shouldnt see it and it should be the read only thing"*.)
 *
 * The §5.3 model, applied to a door: a MANAGER sees everything (and while
 * `managers[]` is empty everyone resolves as one — the bootstrap window, so
 * this changes nothing until roles are actually configured); a PROCESSOR only
 * the pages of the roles on their profile; somebody the config does not know
 * gets nothing. ⚠️ Callers pass the SIGNED-IN person's resolved access, never
 * a borrowed view's (§5.39g): this decides what a rep may DO.
 */
export function mayWorkRoute(access: Access, route: string): boolean {
  const path = (route || "").split("?")[0];
  if (!path) return false;
  if (access.type === "manager") return true;
  if (access.type !== "processor") return false;
  const roles = access.profile.roles ?? [];
  return rolesForRoute(path).some((id) => roles.includes(id));
}

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
 *  "nonEscalated" (today's processor behavior).
 *
 *  ⚠️ Returns an EscalationFilter, never a cross-sell scope — and the BODY is
 *  deliberately unchanged from before cross-sell existed. `?filter=crossSell`
 *  is not one of the three recognised values, so it falls through to
 *  "nonEscalated" on its own. That is the whole safety property of this
 *  feature: every other slice's sidebarSections (masheke, samantha,
 *  finalConfirm, profile, subscription) keeps working untouched instead of
 *  each having to learn a value that means nothing to it. Read the cross-sell
 *  half separately, with `crossSellScopeFromParams`. */
export function viewFilterFromParams(sp: URLSearchParams): EscalationFilter {
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
  if (isCrossSellFilter(filter)) return `?filter=${filter}`;
  return "";
}

/** True for the two cross-sell values — the ones `viewFilterFromParams`
 *  deliberately does not recognise. */
export function isCrossSellFilter(filter: RoleFilter): filter is CrossSellScope {
  return filter === "crossSell" || filter === "nonCrossSell";
}

/** The cross-sell scope a Welcome Call page should apply, or null for
 *  "everybody" — which is what every other role and every other filter gets. */
export function crossSellScopeFromParams(sp: URLSearchParams): CrossSellScope | null {
  const f = sp.get("filter");
  return f === "crossSell" || f === "nonCrossSell" ? f : null;
}

/** Roles where a cross-sell filter means anything.
 *  ⚠️ `isCrossSell` is a Welcome Call rule (serving vs request type) and only
 *  that page applies the scope, so offering it on another role would store a
 *  filter nothing reads — a setting that silently does nothing, which is worse
 *  than not offering it. `/access` gates the two options on this. */
export const CROSS_SELL_FILTER_ROLES: ReadonlySet<string> = new Set(["welcomeCall"]);
