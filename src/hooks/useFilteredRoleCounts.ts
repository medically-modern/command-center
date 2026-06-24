/**
 * Per-role counts that honor each role's assigned filter (B):
 *   nonEscalated → live non-escalated count
 *   escalated    → escalated-only count
 *   all          → non-escalated + escalated   (sum; no overlap)
 *
 * Both the non-escalated and escalated counts now come from the SAME scoped
 * useRoleCounts fetch (no separate all-boards fetch), and useRoleCounts only
 * pulls the boards these roles need.
 */
import { useMemo } from "react";
import { useRoleCounts, type RoleCounts } from "./useRoleCounts";
import { roleFilterFor } from "@/lib/roleView";
import type { ProcessorProfile } from "@/lib/accessStore";

type Profile = Pick<ProcessorProfile, "roles" | "roleFilters"> | null | undefined;

export function useFilteredRoleCounts(profile: Profile): { counts: RoleCounts; loading: boolean } {
  const roles = profile?.roles ?? [];
  const { counts: nonEsc, escalatedCounts: esc, loading } = useRoleCounts({ roleIds: roles });

  const counts = useMemo<RoleCounts>(() => {
    const out: RoleCounts = {};
    for (const id of roles) {
      const f = roleFilterFor(profile, id);
      if (f === "escalated") out[id] = esc[id] ?? 0;
      else if (f === "all") out[id] = (nonEsc[id] ?? 0) + (esc[id] ?? 0);
      else out[id] = nonEsc[id] ?? 0;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.join(","), JSON.stringify(profile?.roleFilters ?? {}), nonEsc, esc]);

  return { counts, loading };
}
