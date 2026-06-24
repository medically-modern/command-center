/**
 * Per-role counts that honor each role's assigned filter (B):
 *   nonEscalated → live non-escalated count   (useRoleCounts)
 *   escalated    → escalated-only count        (useEscalatedCounts)
 *   all          → non-escalated + escalated   (sum; no overlap — the two
 *                  sources are mutually exclusive)
 *
 * Escalated counts (a heavier all-boards fetch) are only pulled when at least
 * one visible role actually needs them.
 */
import { useMemo } from "react";
import { useRoleCounts, type RoleCounts } from "./useRoleCounts";
import { useEscalatedCounts } from "./useEscalatedCounts";
import { roleFilterFor } from "@/lib/roleView";
import type { ProcessorProfile } from "@/lib/accessStore";

type Profile = Pick<ProcessorProfile, "roles" | "roleFilters"> | null | undefined;

export function useFilteredRoleCounts(profile: Profile): { counts: RoleCounts; loading: boolean } {
  const roles = profile?.roles ?? [];

  const needsEsc = roles.some((id) => {
    const f = roleFilterFor(profile, id);
    return f === "escalated" || f === "all";
  });

  // Hooks must run unconditionally; useEscalatedCounts gates its fetch on `enabled`.
  const { counts: nonEsc, loading: nonEscLoading } = useRoleCounts();
  const { counts: esc, loading: escLoading } = useEscalatedCounts(needsEsc);

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

  const loading = nonEscLoading || (needsEsc && escLoading);
  return { counts, loading };
}
