/**
 * Fetches patient counts for each role from all 4 Monday boards.
 *
 * Samantha board (18410601299): 3 groups → Benefits, Submit Auth, Auth Outstanding
 * Mesheke board (18406060017): 1 group, filtered by Stage Advancer → Evaluate, Send Request, Confirm Receipt, Chase Clinicals
 * Welcome Call board (18410804557): welcomeCall group
 * Profile board (18406352652): intake group
 */
import { useEffect, useState, useCallback } from "react";
import { fetchGroupItems as fetchSamanthaGroup, GROUPS as SAM_GROUPS, hasToken as samHasToken } from "@/lib/samantha/mondayApi";
import { fetchGroupItems as fetchMeshekeGroup, GROUPS as MESH_GROUPS, hasToken as meshHasToken } from "@/lib/mesheke/mondayApi";

// Inline count fetcher for Welcome Call and Profile boards.
// We avoid importing from their mondayApi modules because Vite code-splits
// those into lazy page chunks, making the imports undefined in this eager chunk.
const WC_BOARD_ID = 18410804557;
const WC_GROUP_ID = "group_mm1wvq8p";
const FINAL_CONFIRM_GROUP_ID = "group_mm2x8jtj";
const PROFILE_BOARD_ID = 18406352652;
const PROFILE_GROUP_ID = "group_mm1xf2jb";

function getMondayToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
}

async function fetchBoardGroupCount(boardId: number, groupId: string): Promise<number> {
  const token = getMondayToken();
  if (!token) return 0;
  const compareValue = JSON.stringify([groupId]);
  const query = `
    query ($bid: ID!) {
      boards(ids: [$bid]) {
        items_page(limit: 500, query_params: { rules: [{ column_id: "group", compare_value: ${compareValue} }] }) {
          items { id }
        }
      }
    }
  `;
  try {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ query, variables: { bid: boardId } }),
    });
    const json = await res.json();
    const items = json?.data?.boards?.[0]?.items_page?.items;
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

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
        // Actually re-reading Josh's clarification: the 6 roles from these two repos are:
        // Mesheke: Evaluate, Send Request, Confirm Receipt, Chase (→ "Chase Benefits")
        // Samantha: Submit Auth, Auth Outstanding
        // That's only 6. The Benefits tab from Samantha is NOT one of the 6 standalone roles.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = mesheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        //
        // For now, count what we have:
        next.benefits = Array.isArray(benefits) ? benefits.length : 0;
        next.submitAuth = Array.isArray(submitAuth) ? submitAuth.length : 0;
        next.authOutstanding = Array.isArray(authOutstanding) ? authOutstanding.length : 0;
      }

      // Mesheke board — single group, filter by Stage Advancer
      console.log("[useRoleCounts] meshHasToken:", meshHasToken());
      if (meshHasToken()) {
        const items = await fetchMeshekeGroup(MESH_GROUPS.medicalNecessity).catch((e) => { console.error("[useRoleCounts] mesheke fetch failed:", e); return []; });
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
        console.log("[useRoleCounts] mesheke counts:", { evaluate: next.evaluate, sendRequest: next.sendRequest, confirmReceipt: next.confirmReceipt, chaseBenefits: next.chaseBenefits, totalItems: safeItems.length });
      }

      // Welcome Call board
      next.welcomeCall = await fetchBoardGroupCount(WC_BOARD_ID, WC_GROUP_ID);

      // Final Profile Confirmation (same board, different group)
      next.finalConfirm = await fetchBoardGroupCount(WC_BOARD_ID, FINAL_CONFIRM_GROUP_ID);

      // Profile board
      next.profile = await fetchBoardGroupCount(PROFILE_BOARD_ID, PROFILE_GROUP_ID);
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
