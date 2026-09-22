/**
 * Per-role counts that honor each role's assigned filter (B):
 *   nonEscalated → live non-escalated count
 *   escalated    → escalated-only count
 *   all          → non-escalated + escalated   (sum; no overlap)
 *   crossSell    → the cross-sell subset of the non-escalated count
 *   nonCrossSell → the rest of it
 *
 * Both the non-escalated and escalated counts now come from the SAME scoped
 * useRoleCounts fetch (no separate all-boards fetch), and useRoleCounts only
 * pulls the boards these roles need.
 *
 * ⚠️ The cross-sell pair SPLITS the non-escalated count; it never adds to it.
 * `escalated` is disjoint from `nonEscalated` and so is summed for "all";
 * `crossSell` is a SUBSET of `nonEscalated`, so summing it anywhere would
 * double-count every cross-sell patient. That is the same trap the DVS count
 * carries a comment about in useRoleCounts.
 */
import { useMemo } from "react";
import { useRoleCounts, type RoleCounts } from "./useRoleCounts";
import { CROSS_SELL_FILTER_ROLES, roleFilterFor } from "@/lib/roleView";
import type { ProcessorProfile } from "@/lib/accessStore";

type Profile = Pick<ProcessorProfile, "roles" | "roleFilters"> | null | undefined;

export function useFilteredRoleCounts(profile: Profile): { counts: RoleCounts; loading: boolean } {
  const roles = profile?.roles ?? [];
  const { counts: nonEsc, escalatedCounts: esc, crossSellCounts: cross, loading } =
    useRoleCounts({ roleIds: roles });

  const counts = useMemo<RoleCounts>(() => {
    const out: RoleCounts = {};
    for (const id of roles) {
      /* ⚠️ A cross-sell filter stored against a role that has no cross-sell
         count (hand-edited access.json, or a role that loses the feature) falls
         back to the default rather than reading `cross[id] ?? 0` and parking
         that bar at a permanent 0. Same fail-safe posture as
         `viewFilterFromParams`: an unrecognised value degrades to today's
         behaviour instead of silently emptying somebody's queue. */
      const stored = roleFilterFor(profile, id);
      const f =
        (stored === "crossSell" || stored === "nonCrossSell") && !CROSS_SELL_FILTER_ROLES.has(id)
          ? "nonEscalated"
          : stored;
      if (f === "escalated") out[id] = esc[id] ?? 0;
      else if (f === "all") out[id] = (nonEsc[id] ?? 0) + (esc[id] ?? 0);
      else if (f === "crossSell") out[id] = cross[id] ?? 0;
      // Clamped at 0: the two numbers land from the same fetch, but a cached
      // count from a previous session can briefly pair a fresh subset with a
      // stale total, and a bar reading "-2" is worse than one reading 0.
      else if (f === "nonCrossSell") out[id] = Math.max(0, (nonEsc[id] ?? 0) - (cross[id] ?? 0));
      else out[id] = nonEsc[id] ?? 0;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.join(","), JSON.stringify(profile?.roleFilters ?? {}), nonEsc, esc, cross]);

  return { counts, loading };
}
