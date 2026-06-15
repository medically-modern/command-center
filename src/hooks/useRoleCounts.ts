/**
 * Fetches patient counts for each role from all 4 Monday boards.
 *
 * Counts mirror each role page's ACTIVE sidebar view (not the raw group
 * size): escalated / follow-up / scheduled patients are excluded per the
 * same rules each sidebar applies.
 *
 * PERFORMANCE: each board is fetched independently and merged into state
 * AS IT ARRIVES — the dashboard fills in board-by-board instead of waiting
 * for the slowest board. Cached counts from localStorage render instantly
 * on reload, then refresh silently.
 *
 * Samantha board (18410601299): 3 groups → Benefits, Submit Auth, Auth Outstanding
 *   active = not escalated AND followUp !== "Follow Up"
 * Masheke board (18406060017): 1 group, split by Stage Advancer → Evaluate,
 *   Send Request, Confirm Receipt, Chase (fax/parachute split by Clinicals
 *   Method). active = not escalated AND nextActionDate blank/past/today
 * Welcome Call board (18410804557): welcomeCall group (active = not
 *   escalated AND followUp !== "Done") + finalConfirm group (not escalated)
 * Profile board (18406352652): intake group — active = followUp !== "Done"
 * Subscription board (18407459988): Subscriptions group — all items
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { GROUPS as SAM_GROUPS, BOARD_ID as SAM_BOARD_ID, hasToken as samHasToken } from "@/lib/samantha/mondayApi";
import { GROUPS as MESH_GROUPS, hasToken as meshHasToken } from "@/lib/masheke/mondayApi";
import { MONDAY_API_URL } from "@/lib/shared/mondayEndpoint";

const MASHEKE_BOARD_ID = 18406060017;

// Inline ids for Welcome Call / Profile / Subscription boards.
// We avoid importing from their mondayApi modules because Vite code-splits
// those into lazy page chunks, making the imports undefined in this eager chunk.
const WC_BOARD_ID = 18410804557;
const WC_GROUP_ID = "group_mm1wvq8p";
const FINAL_CONFIRM_GROUP_ID = "group_mm2x8jtj";
const PROFILE_BOARD_ID = 18406352652;
const PROFILE_GROUP_ID = "group_mm1xf2jb";
const SUB_BOARD_ID = 18407459988;
const SUB_GROUP_ID = "topics";

// ── Column ids used for "active view" filtering ──
// Masheke
const MESH_STAGE_COL = "color_mm1wyr92";   // Stage Advancer
const MESH_NAD_COL = "date_mm1wadgs";      // Next Action Date
const MESH_ESC_COL = "color_mm1x7997";     // Escalation
const MESH_METHOD_COL = "color_mm1xw7y5";  // Clinicals Method (chase fax/parachute split)
// Samantha
const SAM_ESC_COL = "color_mm2vsh2f";      // Escalation
const SAM_FOLLOWUP_COL = "color_mm34jz1x"; // Follow Up
// Welcome Call board (shared by welcomeCall + finalConfirm groups)
const WC_ESC_COL = "color_mm1x7997";       // Escalation
const WC_FOLLOWUP_COL = "color_mm38w2tk";  // Follow Up
// Profile
const PROF_FOLLOWUP_COL = "color_mm3822qq"; // Follow Up

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
    const res = await fetch(MONDAY_API_URL, {
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
      const nextRes = await fetch(MONDAY_API_URL, {
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
 * Used where counting needs a couple of column values (stage / escalation /
 * follow-up) — a fraction of the payload of the full-column fetchers.
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
    const res = await fetch(MONDAY_API_URL, {
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
      const nextRes = await fetch(MONDAY_API_URL, {
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
  // Counts still stream in progressively while loading (board by board).
  const [loading, setLoading] = useState(!fetchedThisSession);
  const mountedRef = useRef(true);

  const fetchCounts = useCallback(async (silent = false) => {
    if (mountedRef.current && !silent) {
      setLoading(true);
    }

    // Merge one board's results into state the moment that board resolves —
    // this is what makes the dashboard usable in ~1-2s instead of waiting
    // ~10s+ for every board to finish.
    const merge = (partialCounts: RoleCounts, partialIds: RolePatientIds) => {
      if (!mountedRef.current) return;
      setCounts((prev) => {
        const next = { ...prev, ...partialCounts };
        persistCountsCache(next);
        return next;
      });
      setPatientIds((prev) => ({ ...prev, ...partialIds }));
    };

    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

    // Samantha group → active count (not escalated, not follow-up), matching
    // the samantha sidebar's main list.
    const samActive = async (groupId: string, roleId: string) => {
      if (!samHasToken()) return;
      const items = await fetchBoardGroupItemsLight(SAM_BOARD_ID, groupId, [SAM_ESC_COL, SAM_FOLLOWUP_COL]);
      const active = items.filter(
        (i) => i.cols[SAM_ESC_COL] !== "Escalation Required" && i.cols[SAM_FOLLOWUP_COL] !== "Follow Up",
      );
      merge({ [roleId]: active.length }, { [roleId]: active.map((i) => i.id) });
    };

    const tasks: Promise<void>[] = [
      samActive(SAM_GROUPS.benefits, "benefits"),
      samActive(SAM_GROUPS.submitAuth, "submitAuth"),
      samActive(SAM_GROUPS.authOutstanding, "authOutstanding"),

      // Masheke board — single group, split by Stage Advancer; chase further
      // split by Clinicals Method (fax+email vs Parachute). Mirrors the
      // masheke sidebar active list: exclude escalated + future-dated.
      (async () => {
        if (!meshHasToken()) return;
        const items = await fetchBoardGroupItemsLight(
          MASHEKE_BOARD_ID,
          MESH_GROUPS.medicalNecessity,
          [MESH_STAGE_COL, MESH_NAD_COL, MESH_ESC_COL, MESH_METHOD_COL],
        );
        const next: RoleCounts = {
          evaluate: 0, sendRequest: 0, confirmReceipt: 0,
          chaseFax: 0, chaseParachute: 0,
          // legacy combined chase count — older cached clients / baselines
          chaseBenefits: 0,
        };
        const nextIds: RolePatientIds = {
          evaluate: [], sendRequest: [], confirmReceipt: [],
          chaseFax: [], chaseParachute: [], chaseBenefits: [],
        };
        for (const item of items) {
          const stage = item.cols[MESH_STAGE_COL] ?? "";
          let roleId: string | null = null;
          if (stage === "Evaluate MN") roleId = "evaluate";
          else if (stage === "Send Request") roleId = "sendRequest";
          else if (stage === "Confirm Receipt") roleId = "confirmReceipt";
          else if (stage === "Chase Clinicals") {
            roleId = item.cols[MESH_METHOD_COL] === "Parachute" ? "chaseParachute" : "chaseFax";
          }
          if (!roleId) continue;

          const nad = (item.cols[MESH_NAD_COL] ?? "").slice(0, 10);
          if (nad && nad > todayStr) continue; // scheduled (future)
          if (item.cols[MESH_ESC_COL] === "Escalation Required") continue; // escalated

          next[roleId]++;
          nextIds[roleId].push(item.id);
          if (roleId === "chaseFax" || roleId === "chaseParachute") {
            next.chaseBenefits++;
            nextIds.chaseBenefits.push(item.id);
          }
        }
        merge(next, nextIds);
      })(),

      // Welcome Call — active = not escalated, follow-up !== "Done"
      (async () => {
        const items = await fetchBoardGroupItemsLight(WC_BOARD_ID, WC_GROUP_ID, [WC_ESC_COL, WC_FOLLOWUP_COL]);
        const active = items.filter(
          (i) => i.cols[WC_ESC_COL] !== "Escalation Required" && i.cols[WC_FOLLOWUP_COL] !== "Done",
        );
        merge({ welcomeCall: active.length }, { welcomeCall: active.map((i) => i.id) });
      })(),

      // Final Profile Confirmation — active = not escalated
      (async () => {
        const items = await fetchBoardGroupItemsLight(WC_BOARD_ID, FINAL_CONFIRM_GROUP_ID, [WC_ESC_COL]);
        const active = items.filter((i) => i.cols[WC_ESC_COL] !== "Escalation Required");
        merge({ finalConfirm: active.length }, { finalConfirm: active.map((i) => i.id) });
      })(),

      // Profile — active = follow-up !== "Done"
      (async () => {
        const items = await fetchBoardGroupItemsLight(PROFILE_BOARD_ID, PROFILE_GROUP_ID, [PROF_FOLLOWUP_COL]);
        const active = items.filter((i) => i.cols[PROF_FOLLOWUP_COL] !== "Done");
        merge({ profile: active.length }, { profile: active.map((i) => i.id) });
      })(),

      // Subscription board (+ Update Clinicals shares it) — whole group
      (async () => {
        const subIds = await fetchBoardGroupIds(SUB_BOARD_ID, SUB_GROUP_ID);
        merge(
          { subscription: subIds.length, updateClinicals: subIds.length },
          { subscription: subIds, updateClinicals: [...subIds] },
        );
      })(),

      // Patient Questions — count from both boards
      (async () => {
        const pqCount = await import("@/lib/patientQuestions/mondayApi")
          .then((m) => m.fetchPatientQuestionsCount())
          .catch(() => 0);
        merge({ patientQuestions: pqCount }, {});
      })(),

      // FAX — unread fax count from RingCentral. On API failure we simply
      // don't merge, keeping the previous/cached number instead of showing
      // a misleading 0 ("Done!").
      (async () => {
        try {
          const n = await import("@/lib/fax/ringcentralApi").then((m) => m.fetchUnreadFaxCount());
          merge({ fax: n }, {});
        } catch (e) {
          console.error("RingCentral fax count failed:", e);
        }
      })(),
    ];

    await Promise.allSettled(tasks);

    if (!mountedRef.current) return;
    fetchedThisSession = true;
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // First fetch of a page load is non-silent (header spinner shows until
    // all boards land — counts still stream in earlier). Remounts within the
    // session refresh silently; 60s polls are always silent.
    fetchCounts(fetchedThisSession);
    const interval = setInterval(() => fetchCounts(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchCounts]);

  return { counts, patientIds, loading, refetch: fetchCounts };
}
