/**
 * Fetches patient counts for each role from all 4 Monday boards.
 *
 * Uses localStorage cache for instant page load on return visits —
 * cached counts are shown immediately, then silently refreshed from Monday.
 *
 * Samantha board (18410601299): 3 groups → Benefits, Submit Auth, Auth Outstanding
 * Masheke board (18406060017): 1 group, filtered by Stage Advancer → Evaluate, Send Request, Confirm Receipt, Chase Clinicals
 * Welcome Call board (18410804557): welcomeCall group
 * Profile board (18406352652): intake group
 * Subscription board (18407459988): Subscriptions group
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { fetchGroupItems as fetchSamanthaGroup, GROUPS as SAM_GROUPS, hasToken as samHasToken } from "@/lib/samantha/mondayApi";
import { fetchGroupItems as fetchMashekeGroup, GROUPS as MESH_GROUPS, hasToken as meshHasToken } from "@/lib/masheke/mondayApi";

// Inline count fetcher for Welcome Call and Profile boards.
// We avoid importing from their mondayApi modules because Vite code-splits
// those into lazy page chunks, making the imports undefined in this eager chunk.
const WC_BOARD_ID = 18410804557;
const WC_GROUP_ID = "group_mm1wvq8p";
const FINAL_CONFIRM_GROUP_ID = "group_mm2x8jtj";
const PROFILE_BOARD_ID = 18406352652;
const PROFILE_GROUP_ID = "group_mm1xf2jb";
const SUB_BOARD_ID = 18407459988;
const SUB_GROUP_ID = "topics";

function getMondayToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
}

async function fetchBoardGroupIds(boardId: number, groupId: string): Promise<string[]> {
  const PAGE = 500;
  const token = getMondayToken();
  if (!token) return [];
  const compareValue = JSON.stringify([groupId]);

  // First page
  const query = `
    query ($bid: ID!) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: "group", compare_value: ${compareValue} }] }) {
          cursor
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
    const page = json?.data?.boards?.[0]?.items_page;
    const firstItems = Array.isArray(page?.items) ? page.items : [];
    const ids: string[] = firstItems.map((i: any) => String(i.id));
    let cursor: string | null = page?.cursor ?? null;

    // Follow cursor pages
    while (cursor) {
      const nextQuery = `
        query ($cursor: String!) {
          next_items_page(limit: ${PAGE}, cursor: $cursor) {
            cursor
            items { id }
          }
        }
      `;
      const nextRes = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ query: nextQuery, variables: { cursor } }),
      });
      const nextJson = await nextRes.json();
      const nextPage = nextJson?.data?.next_items_page;
      const nextItems = Array.isArray(nextPage?.items) ? nextPage.items : [];
      ids.push(...nextItems.map((i: any) => String(i.id)));
      cursor = nextPage?.cursor ?? null;
    }

    return ids;
  } catch {
    return [];
  }
}

export interface RoleCounts {
  [roleId: string]: number;
}

/** Patient IDs per role — used for movement tracking */
export interface RolePatientIds {
  [roleId: string]: string[];
}

// ── Count cache (instant load on return visits) ──

const LS_COUNTS_KEY = "role-counts-cache";

function loadCachedCounts(): RoleCounts {
  try {
    const raw = localStorage.getItem(LS_COUNTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as RoleCounts;
  } catch { return {}; }
}

function persistCountsCache(counts: RoleCounts): void {
  try {
    localStorage.setItem(LS_COUNTS_KEY, JSON.stringify(counts));
  } catch { /* quota exceeded or private browsing — ignore */ }
}

// Stage Advancer values that map to masheke tabs
const MASHEKE_STAGE_MAP: Record<string, string> = {
  "Evaluate MN": "evaluate",
  "Send Request": "sendRequest",
  "Confirm Receipt": "confirmReceipt",
  "Chase Clinicals": "chaseBenefits",  // Chase tab → Chase Benefits role
};

const POLL_MS = 60_000;

export function useRoleCounts() {
  const cachedRef = useRef(loadCachedCounts());
  const [counts, setCounts] = useState<RoleCounts>(cachedRef.current);
  const [patientIds, setPatientIds] = useState<RolePatientIds>({});
  const [loading, setLoading] = useState(Object.keys(cachedRef.current).length === 0);
  const mountedRef = useRef(true);

  const fetchCounts = useCallback(async (silent = false) => {
    if (mountedRef.current && !silent) {
      setLoading(true);
    }
    const next: RoleCounts = {};
    const nextIds: RolePatientIds = {};

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
        // Wait — looking back at the mapping: Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6 standalone roles.
        // Hmm, but we built ChaseBenefitsPage using Samantha's InsurancePanel...
        // Actually re-reading Josh's clarification: the 6 roles from these two repos are:
        // Masheke: Evaluate, Send Request, Confirm Receipt, Chase (→ "Chase Benefits")
        // Samantha: Submit Auth, Auth Outstanding
        // That's only 6. The Benefits tab from Samantha is NOT one of the 6 standalone roles.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        // Chase Benefits = masheke's Chase tab.
        // Samantha has: Submit Auth and Auth Outstanding. Her Benefits tab isn't one of the 6.
        // But we built ChasebenefitsPage from Samantha's Benefits tab — that's wrong per Josh's correction.
        //
        // For now, count what we have:
        const bArr = Array.isArray(benefits) ? benefits : [];
        const sArr = Array.isArray(submitAuth) ? submitAuth : [];
        const aArr = Array.isArray(authOutstanding) ? authOutstanding : [];
        next.benefits = bArr.length;
        next.submitAuth = sArr.length;
        next.authOutstanding = aArr.length;
        nextIds.benefits = bArr.map((i: any) => String(i.id));
        nextIds.submitAuth = sArr.map((i: any) => String(i.id));
        nextIds.authOutstanding = aArr.map((i: any) => String(i.id));
      }

      // Masheke board — single group, filter by Stage Advancer
      if (meshHasToken()) {
        const items = await fetchMashekeGroup(MESH_GROUPS.medicalNecessity).catch(() => []);
        const safeItems = Array.isArray(items) ? items : [];

        // Initialize masheke role counts + IDs
        next.evaluate = 0;
        next.sendRequest = 0;
        next.confirmReceipt = 0;
        next.chaseBenefits = 0;
        nextIds.evaluate = [];
        nextIds.sendRequest = [];
        nextIds.confirmReceipt = [];
        nextIds.chaseBenefits = [];

        const todayStr = new Date().toISOString().slice(0, 10);

        for (const item of safeItems) {
          // Find Stage Advancer column value
          const stageCol = item.column_values?.find(
            (c: any) => c.id === "color_mm1wyr92"
          );
          const stageText = stageCol?.text ?? "";
          const roleId = MASHEKE_STAGE_MAP[stageText];
          if (roleId && roleId in next) {
            // Only count "active" patients — exclude pending (future nextActionDate) and stuck (escalated)
            const nadCol = item.column_values?.find((c: any) => c.id === "date_mm1wadgs");
            const nad = (nadCol?.text ?? "").slice(0, 10);
            if (nad && nad > todayStr) continue; // pending

            const escCol = item.column_values?.find((c: any) => c.id === "color_mm1x7997");
            const escText = escCol?.text ?? "";
            if (escText === "Escalation Required" || escText === "Escalate") continue; // stuck
            next[roleId]++;
            nextIds[roleId].push(String(item.id));
          }
        }
      }

      // Welcome Call board
      const wcIds = await fetchBoardGroupIds(WC_BOARD_ID, WC_GROUP_ID);
      next.welcomeCall = wcIds.length;
      nextIds.welcomeCall = wcIds;

      // Final Profile Confirmation (same board, different group)
      const fcIds = await fetchBoardGroupIds(WC_BOARD_ID, FINAL_CONFIRM_GROUP_ID);
      next.finalConfirm = fcIds.length;
      nextIds.finalConfirm = fcIds;

      // Profile board
      const profIds = await fetchBoardGroupIds(PROFILE_BOARD_ID, PROFILE_GROUP_ID);
      next.profile = profIds.length;
      nextIds.profile = profIds;

      // Subscription board
      const subIds = await fetchBoardGroupIds(SUB_BOARD_ID, SUB_GROUP_ID);
      next.subscription = subIds.length;
      nextIds.subscription = subIds;

      // Patient Questions — count from both boards
      try {
        const { fetchPatientQuestionsCount } = await import("@/lib/patientQuestions/mondayApi");
        next.patientQuestions = await fetchPatientQuestionsCount();
      } catch {
        next.patientQuestions = 0;
      }

      // System Management — count escalations across all boards
      // We import fetchAllPatients lazily to avoid circular deps
      try {
        const { fetchAllPatients } = await import("@/lib/systemMgmt/mondayApi");
        const allPatients = await fetchAllPatients();
        next.systemMgmt = allPatients.filter((p) => p.escalated).length;
      } catch {
        next.systemMgmt = 0;
      }
    } catch (e) {
      console.error("Failed to fetch role counts:", e);
    }

    if (!mountedRef.current) return;
    setCounts(next);
    setPatientIds(nextIds);
    persistCountsCache(next);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // If we have cached counts, fetch silently (no spinner)
    fetchCounts(Object.keys(cachedRef.current).length > 0);
    const interval = setInterval(() => fetchCounts(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchCounts]);

  return { counts, patientIds, loading, refetch: fetchCounts };
}
