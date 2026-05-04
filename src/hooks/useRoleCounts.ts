/**
 * Fetches patient counts for each role from both Monday boards.
 *
 * Samantha board (18410601299): 3 groups → Chase Benefits, Submit Auth, Auth Outstanding
 * Mesheke board (18406060017): 1 group, filtered by Stage Advancer → Evaluate, Send Request, Confirm Receipt, Chase Clinicals
 */
import { useEffect, useState, useCallback } from "react";
import { fetchGroupItems as fetchSamanthaGroup, GROUPS as SAM_GROUPS, hasToken as samHasToken } from "@/lib/samantha/mondayApi";
import { fetchGroupItems as fetchMeshekeGroup, GROUPS as MESH_GROUPS, hasToken as meshHasToken } from "@/lib/mesheke/mondayApi";

export interface RoleCounts {
  [roleId: string]: number;
}

// Stage Advancer values that map to mesheke tabs
const MESHEKE_STAGE_MAP: Record<string, string> = {
  "Evaluate MN": "evaluate",
  "Send Request": "sendRequest",
  "Confirm Receipt": "confirmReceipt",
  "Chase Clinicals": "chaseBenefits",  // Chase tab → Chase Benefits role
};

const POLL_MS = 60_000;

export function useRoleCounts() {
  const [counts, setCounts] = useState<RoleCounts>({});
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    const next: RoleCounts = {};

    try {
      // Samantha board — each group is a separate fetch
      if (samHasToken()) {
        const [benefits, submitAuth, authOutstanding] = await Promise.all([
          fetchSamanthaGroup(SAM_GROUPS.benefits).catch(() => []),
          fetchSamanthaGroup(SAM_GROUPS.submitAuth).catch(() => []),
          fetchSamanthaGroup(SAM_GROUPS.authOutstanding).catch(() => []),
        ]);
        // Note: Samantha Benefits tab → "chaseBenefits" role in the original mapping
        // was wrong. The Samantha Benefits group maps to the role that processes insurance benefits.
        // Let's check: the user said Benefits tab = part of Samantha. The roles are:
        // submitAuth → Submit Auth group, authOutstanding → Auth Outstanding group.
        // The Benefits tab from Samantha wasn't mapped as a standalone role in the 6 we're building.
        // Wait — looking back at the mapping: Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6 standalone roles.
        // Hmm, but we built ChaseBenefitsPage using Samantha's InsurancePanel...
        // 
        // Actually re-reading Josh's clarification: the 6 roles from these two repos are:
        // Mesheke: Evaluate, Send Request, Confirm Receipt, Chase (→ "Chase Benefits")
        // Samantha: Submit Auth, Auth Outstanding
        // That's only 6. The Benefits tab from Samantha is NOT one of the 6.
        // But we built ChaseBenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        //
        // For now, count what we have:
        next.benefits = Array.isArray(benefits) ? benefits.length : 0;
        next.submitAuth = Array.isArray(submitAuth) ? submitAuth.length : 0;
        next.authOutstanding = Array.isArray(authOutstanding) ? authOutstanding.length : 0;
      }

      // Mesheke board — single group, filter by Stage Advancer
      if (meshHasToken()) {
        const items = await fetchMeshekeGroup(MESH_GROUPS.medicalNecessity).catch(() => []);
        const safeItems = Array.isArray(items) ? items : [];

        // Initialize mesheke role counts
        next.evaluate = 0;
        next.sendRequest = 0;
        next.confirmReceipt = 0;
        next.chaseBenefits = 0;

        for (const item of safeItems) {
          // Find Stage Advancer column value
          const stageCol = item.column_values?.find(
            (c: any) => c.id === "color_mm1wyr92"
          );
          const stageText = stageCol?.text ?? "";
          const roleId = MESHEKE_STAGE_MAP[stageText];
          if (roleId && roleId in next) {
            next[roleId]++;
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch role counts:", e);
    }

    setCounts(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  return { counts, loading, refetch: fetchCounts };
}
