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
import { GROUPS as SAM_GROUPS, BOARD_ID as SAM_BOARD_ID, hasToken as samHasToken } from "@/lib/samantha/mondayApi";
import { GROUPS as MESH_GROUPS, hasToken as meshHasToken } from "@/lib/masheke/mondayApi";

const MASHEKE_BOARD_ID = 18406060017;

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

/**
 * Light per-item fetcher: ids plus the TEXT of only the named columns.
 * Used where counting needs a couple of column values (e.g. masheke's Stage
 * Advancer split) — a fraction of the payload of the full-column fetchers.
 */
interface LightItem {
  id: string;
  cols: Record<string, string>;
}

async function fetchBoardGroupItemsLight(
  boardId: number,
  groupId: string,
  columnIds: string[],
): Promise<LightItem[]> {
  const PAGE = 500;
  const token = getMondayToken();
  if (!token) return [];
  const compareValue = JSON.stringify([groupId]);
  const itemFields = `id column_values(ids: $cols) { id text }`;

  const toLight = (items: any[]): LightItem[] =>
    items.map((i: any) => ({
      id: String(i.id),
      cols: Object.fromEntries(
        (i.column_values ?? []).map((c: any) => [c.id, c.text ?? ""]),
      ),
    }));

  const query = `
    query ($bid: ID!, $cols: [String!]) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: "group", compare_value: ${compareValue} }] }) {
          cursor
          items { ${itemFields} }
        }
      }
    }
  `;
  try {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ query, variables: { bid: boardId, cols: columnIds } }),
    });
    const json = await res.json();
    const page = json?.data?.boards?.[0]?.items_page;
    const out: LightItem[] = toLight(Array.isArray(page?.items) ? page.items : []);
    let cursor: string | null = page?.cursor ?? null;

    while (cursor) {
      const nextQuery = `
        query ($cursor: String!, $cols: [String!]) {
          next_items_page(limit: ${PAGE}, cursor: $cursor) {
            cursor
            items { ${itemFields} }
          }
        }
      `;
      const nextRes = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ query: nextQuery, variables: { cursor, cols: columnIds } }),
      });
      const nextJson = await nextRes.json();
      const nextPage = nextJson?.data?.next_items_page;
      out.push(...toLight(Array.isArray(nextPage?.items) ? nextPage.items : []));
      cursor = nextPage?.cursor ?? null;
    }
    return out;
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

// True once any fetch has completed during THIS page load (module scope, so
// it survives in-app navigation but resets on a hard reload). Returning to
// the dashboard shows cached values instantly with a silent refresh; only a
// hard reload shows the loading skeleton.
let fetchedThisSession = false;

export function useRoleCounts() {
  const cachedRef = useRef(loadCachedCounts());
  const [counts, setCounts] = useState<RoleCounts>(cachedRef.current);
  const [patientIds, setPatientIds] = useState<RolePatientIds>({});
  // Loading is true only until the first fetch of this PAGE LOAD completes.
  // In-app remounts (navigating back to the dashboard) reuse session values
  // instantly; a hard reload starts fresh so stale localStorage zeros never
  // render as "Done!".
  const [loading, setLoading] = useState(!fetchedThisSession);
  const mountedRef = useRef(true);

  const fetchCounts = useCallback(async (silent = false) => {
    if (mountedRef.current && !silent) {
      setLoading(true);
    }
    const next: RoleCounts = {};
    const nextIds: RolePatientIds = {};

    try {
      // All boards are fetched CONCURRENTLY — these used to run one after
      // another, which is why "pulling live counts" took 8-15s. Samantha
      // groups only need ids; masheke needs ids + 3 columns (Stage Advancer,
      // Next Action Date, Escalation) to mirror the sidebar's active list.
      const MASHEKE_LIGHT_COLS = ["color_mm1wyr92", "date_mm1wadgs", "color_mm1x7997"];
      const [
        samBenefits,
        samSubmitAuth,
        samAuthOutstanding,
        mashekeItems,
        wcIds,
        fcIds,
        profIds,
        subIds,
        pqCount,
      ] = await Promise.all([
        samHasToken() ? fetchBoardGroupIds(SAM_BOARD_ID, SAM_GROUPS.benefits) : Promise.resolve([]),
        samHasToken() ? fetchBoardGroupIds(SAM_BOARD_ID, SAM_GROUPS.submitAuth) : Promise.resolve([]),
        samHasToken() ? fetchBoardGroupIds(SAM_BOARD_ID, SAM_GROUPS.authOutstanding) : Promise.resolve([]),
        meshHasToken()
          ? fetchBoardGroupItemsLight(MASHEKE_BOARD_ID, MESH_GROUPS.medicalNecessity, MASHEKE_LIGHT_COLS)
          : Promise.resolve([] as LightItem[]),
        fetchBoardGroupIds(WC_BOARD_ID, WC_GROUP_ID),
        fetchBoardGroupIds(WC_BOARD_ID, FINAL_CONFIRM_GROUP_ID),
        fetchBoardGroupIds(PROFILE_BOARD_ID, PROFILE_GROUP_ID),
        fetchBoardGroupIds(SUB_BOARD_ID, SUB_GROUP_ID),
        import("@/lib/patientQuestions/mondayApi")
          .then((m) => m.fetchPatientQuestionsCount())
          .catch(() => 0),
      ]);

      // Samantha board roles
      next.benefits = samBenefits.length;
      next.submitAuth = samSubmitAuth.length;
      next.authOutstanding = samAuthOutstanding.length;
      nextIds.benefits = samBenefits;
      nextIds.submitAuth = samSubmitAuth;
      nextIds.authOutstanding = samAuthOutstanding;

      // Masheke board — single group, split by Stage Advancer.
      next.evaluate = 0;
      next.sendRequest = 0;
      next.confirmReceipt = 0;
      next.chaseBenefits = 0;
      nextIds.evaluate = [];
      nextIds.sendRequest = [];
      nextIds.confirmReceipt = [];
      nextIds.chaseBenefits = [];

      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

      for (const item of mashekeItems) {
        const roleId = MASHEKE_STAGE_MAP[item.cols["color_mm1wyr92"] ?? ""];
        if (roleId && roleId in next) {
          // Count must equal the sidebar's ACTIVE view exactly:
          //   - exclude escalated (hidden from sidebar active list)
          //   - exclude scheduled (future nextActionDate) — applies to ALL
          //     four masheke tabs; blank or past/today counts as active
          // Blocked / Stuck / Follow-up are NOT excluded — the sidebar
          // currently shows those in the active list (its filter buckets
          // are commented out), and this count mirrors the sidebar.
          const nad = (item.cols["date_mm1wadgs"] ?? "").slice(0, 10);
          if (nad && nad > todayStr) continue; // scheduled

          if (item.cols["color_mm1x7997"] === "Escalation Required") continue; // escalated

          next[roleId]++;
          nextIds[roleId].push(item.id);
        }
      }

      // Welcome Call / Final Profile Confirmation (same board, two groups)
      next.welcomeCall = wcIds.length;
      nextIds.welcomeCall = wcIds;
      next.finalConfirm = fcIds.length;
      nextIds.finalConfirm = fcIds;

      // Profile board
      next.profile = profIds.length;
      nextIds.profile = profIds;

      // Subscription board (+ Update Clinicals shares it)
      next.subscription = subIds.length;
      nextIds.subscription = subIds;
      next.updateClinicals = subIds.length;
      nextIds.updateClinicals = [...subIds];

      // Patient Questions — count from both boards
      next.patientQuestions = pqCount;

      // System Management is no longer a dashboard role (header button only).
    } catch (e) {
      console.error("Failed to fetch role counts:", e);
    }

    if (!mountedRef.current) return;
    setCounts(next);
    setPatientIds(nextIds);
    persistCountsCache(next);
    fetchedThisSession = true;
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // First fetch of a page load is non-silent (skeleton shows until real
    // numbers arrive). Remounts within the session refresh silently; 60s
    // polls are always silent.
    fetchCounts(fetchedThisSession);
    const interval = setInterval(() => fetchCounts(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchCounts]);

  return { counts, patientIds, loading, refetch: fetchCounts };
}
