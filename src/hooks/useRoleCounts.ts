/**
 * Fetches patient counts for each role from all 4 Monday boards.
 *
 * Counts mirror each role page's ACTIVE sidebar view (not the raw group
 * size): escalated / follow-up / scheduled patients are excluded per the
 * same rules each sidebar applies. The SAME light fetch also yields the
 * per-role ESCALATED count (escalatedCounts), so the All/Escalated filters
 * never need a separate heavy all-boards fetch.
 *
 * PERFORMANCE:
 *  - Pass `{ roleIds }` to fetch ONLY the boards those roles need (a processor
 *    with 2 queues no longer triggers all ~10 board fetches). Omit for all.
 *  - Each board is fetched independently and merged AS IT ARRIVES — the
 *    dashboard fills in board-by-board instead of waiting for the slowest.
 *  - The loading flag clears once the Monday role boards land; the RingCentral
 *    fax count and Patient Questions finish in the background and never hold
 *    the spinner.
 *  - Cached counts from localStorage render instantly on reload, then refresh.
 *
 * Samantha board (18410601299): 3 groups → Benefits, Submit Auth, Auth Outstanding
 *   active = not escalated AND followUp !== "Follow Up"
 * Masheke board (18406060017): 1 group, split by Stage Advancer → Evaluate,
 *   Send Request, Confirm Receipt, Chase (fax/parachute split by Clinicals
 *   Method). active = not escalated AND nextActionDate blank/past/today
 * Welcome Call board (18410804557): welcomeCall group (active = not
 *   escalated AND followUp !== "Done") + finalConfirm group (not escalated)
 * Profile board (18406352652): intake group — active = followUp !== "Done",
 *   split into profile (verified) vs unverifiedReferrals by Referral Type
 *   "Patient" OR Referral Source "CareCentrix" (lib/profile/referralSplit.ts)
 * Subscription board (18407459988): Subscriptions group — all items
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { GROUPS as SAM_GROUPS, BOARD_ID as SAM_BOARD_ID, hasToken as samHasToken } from "@/lib/samantha/mondayApi";
import { GROUPS as MESH_GROUPS, hasToken as meshHasToken } from "@/lib/masheke/mondayApi";
import { MONDAY_API_URL, mondayIdentityHeaders } from "@/lib/shared/mondayEndpoint";
import { etToday } from "@/lib/masheke/etDate";

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
const MESH_PROPOSED_STUCK_COL = "color_mm5f37ve"; // Proposed Stuck (propose→approve flow)
// Samantha
const SAM_ESC_COL = "color_mm2vsh2f";      // Escalation
const SAM_FOLLOWUP_COL = "color_mm34jz1x"; // Follow Up
const SAM_FOLLOWUP_DATE_COL = "date_mm34m2dz"; // Follow Up Date (daily bucket)
const SAM_STAGE_COL = "color_mm1ws96t";    // Stage Advancer (DVS role count)
const SAM_DVS_STAGE_INDEX = 1;             // "DVS" label index (verified 2026-07-21)
// Welcome Call board (shared by welcomeCall + finalConfirm groups)
const WC_ESC_COL = "color_mm1x7997";       // Escalation
const WC_FOLLOWUP_COL = "color_mm38w2tk";  // Follow Up
// Profile
const PROF_FOLLOWUP_COL = "color_mm3822qq"; // Follow Up
const PROF_REFERRAL_TYPE_COL = "color_mm1wm4n4";   // Referral Type (role split)
const PROF_REFERRAL_SOURCE_COL = "color_mm1w5wxr"; // Referral Source (role split)

const ESC_REQUIRED = "Escalation Required";
// Insurance board escalation split into two labels (2026-07) — either counts as
// escalated. Masheke + Welcome Call still use the single ESC_REQUIRED above.
const SAM_ESCALATED = new Set(["Manager Escalation Required", "Final Escalation Required"]);
const isSamEscalated = (txt: string): boolean => SAM_ESCALATED.has(txt);

/** Selected index of a status column from its raw `value` JSON, or null. */
function statusIndex(raw: string | undefined): number | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { index?: number } | null;
    return typeof parsed?.index === "number" ? parsed.index : null;
  } catch {
    return null;
  }
}

// Masheke escalation labels were renamed on the board (2026-07): index 0 is now
// "Manager Escalation Required" and index 2 "Final Escalation Required" — both
// count as escalated. Match by INDEX (not label text) so a future rename can't
// silently break the counts. (Samantha/Welcome Call labels are unchanged and
// keep their text match below.)
const MESH_ESCALATED_INDICES = [0, 2];
function isMeshEscalated(item: { vals: Record<string, string> }): boolean {
  const idx = statusIndex(item.vals[MESH_ESC_COL]);
  return idx !== null && MESH_ESCALATED_INDICES.includes(idx);
}

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
      headers: { "Content-Type": "application/json", Authorization: token, ...mondayIdentityHeaders() },
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
        headers: { "Content-Type": "application/json", Authorization: token, ...mondayIdentityHeaders() },
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
  /** Raw `value` JSON per column id — for index-based status matching
   *  (a status label can be renamed on the board; its index can't). */
  vals: Record<string, string>;
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
  const itemFields = `id column_values(ids: $cols) { id text value }`;

  const toLight = (items: any[]): LightItem[] =>
    items.map((i: any) => ({
      id: String(i.id),
      cols: Object.fromEntries(
        (i.column_values ?? []).map((c: any) => [c.id, c.text ?? ""]),
      ),
      vals: Object.fromEntries(
        (i.column_values ?? []).map(
          (c: { id: string; value: string | null }) => [c.id, c.value ?? ""],
        ),
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
      headers: { "Content-Type": "application/json", Authorization: token, ...mondayIdentityHeaders() },
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
        headers: { "Content-Type": "application/json", Authorization: token, ...mondayIdentityHeaders() },
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

/** Board-wide light fetch by Stage Advancer INDEX — the DVS stage has no
 *  dedicated group, so its items are found by the status value alone.
 *  Mirrors both baseline generators (§5.8 counting contract). */
async function fetchBoardStageItemsLight(
  boardId: number,
  stageColId: string,
  stageIndex: number,
  columnIds: string[],
): Promise<LightItem[]> {
  const PAGE = 500;
  const token = getMondayToken();
  if (!token) return [];
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
        items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: ${JSON.stringify(stageColId)}, compare_value: [${stageIndex}] }] }) {
          cursor
          items { ${itemFields} }
        }
      }
    }
  `;
  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, ...mondayIdentityHeaders() },
      body: JSON.stringify({ query, variables: { bid: boardId, cols: columnIds } }),
    });
    const json = await res.json();
    const page = json?.data?.boards?.[0]?.items_page;
    const out = toLight(Array.isArray(page?.items) ? page.items : []);
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
        headers: { "Content-Type": "application/json", Authorization: token, ...mondayIdentityHeaders() },
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
const LS_ESC_KEY = "role-esc-counts-cache";

function loadCache(key: string): RoleCounts {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) as RoleCounts;
  } catch {
    return {};
  }
}

function persistCache(key: string, counts: RoleCounts): void {
  try {
    localStorage.setItem(key, JSON.stringify(counts));
  } catch {
    /* quota exceeded or private browsing — ignore */
  }
}

const POLL_MS = 60_000;

// True once any fetch has completed during THIS page load (module scope, so
// it survives in-app navigation but resets on a hard reload). Returning to
// the dashboard shows cached values instantly with a silent refresh; only a
// hard reload shows the loading skeleton.
let fetchedThisSession = false;

/**
 * @param opts.roleIds When provided, fetch ONLY the boards needed for these
 *   roles. Omit to fetch everything (e.g. the System Management Operations tab).
 */
export function useRoleCounts(opts?: { roleIds?: string[] }) {
  const cachedRef = useRef(loadCache(LS_COUNTS_KEY));
  const escCachedRef = useRef(loadCache(LS_ESC_KEY));
  const [counts, setCounts] = useState<RoleCounts>(cachedRef.current);
  const [escalatedCounts, setEscalatedCounts] = useState<RoleCounts>(escCachedRef.current);
  const [patientIds, setPatientIds] = useState<RolePatientIds>({});
  const [loading, setLoading] = useState(!fetchedThisSession);
  const mountedRef = useRef(true);

  // Keep the latest scope in a ref so the fetch callback stays stable; the
  // effect below re-runs (refetch) whenever the scope key changes.
  const roleIds = opts?.roleIds;
  const roleKey = roleIds ? [...roleIds].sort().join(",") : "*ALL*";
  const roleIdsRef = useRef<string[] | undefined>(roleIds);
  roleIdsRef.current = roleIds;

  const fetchCounts = useCallback(async (silent = false) => {
    if (mountedRef.current && !silent) setLoading(true);

    const need = (id: string) => !roleIdsRef.current || roleIdsRef.current.includes(id);
    const needAny = (...ids: string[]) => ids.some(need);

    // Merge one board's results as it resolves — non-escalated counts,
    // escalated counts, and patient ids.
    const merge = (pc: RoleCounts, pe: RoleCounts, pi: RolePatientIds) => {
      if (!mountedRef.current) return;
      setCounts((prev) => { const next = { ...prev, ...pc }; persistCache(LS_COUNTS_KEY, next); return next; });
      setEscalatedCounts((prev) => { const next = { ...prev, ...pe }; persistCache(LS_ESC_KEY, next); return next; });
      if (Object.keys(pi).length) setPatientIds((prev) => ({ ...prev, ...pi }));
    };

    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

    // Samantha group → active (not escalated, not snoozed) + escalated.
    // Daily bucket (2026-07-20), Benefits + Submit Auth: a Follow Up only
    // hides the patient while its date is in the FUTURE — when the date
    // arrives (≤ today ET) the patient counts active again. Dateless
    // follow-ups stay snoozed.
    // Auth Outstanding (redesign §12, 2026-07-21): PURE date bucket —
    // snoozed iff Follow Up Date is in the future; the STATUS column is
    // ignored and a blank date counts as due.
    // Mirrors sidebarList (isSnoozedFollowUp / isSnoozedAuthOutstanding) +
    // both baseline generators (§5.8 counting contract — change together).
    const samActive = async (groupId: string, roleId: string, dateOnlyBucket = false) => {
      if (!samHasToken()) return;
      const fetched = await fetchBoardGroupItemsLight(SAM_BOARD_ID, groupId, [SAM_ESC_COL, SAM_FOLLOWUP_COL, SAM_FOLLOWUP_DATE_COL, SAM_STAGE_COL]);
      // Stage = "DVS" items stay in their old group (no group-move automation
      // yet) but belong to the board-wide dvs count below — drop them here so
      // a routed patient never counts in two roles (mirrors samantha
      // useMondayPatients + both baseline countSamGroup, §5.8).
      const items = fetched.filter((i) => i.cols[SAM_STAGE_COL] !== "DVS");
      const escN = items.filter((i) => isSamEscalated(i.cols[SAM_ESC_COL])).length;
      const snoozed = (i: (typeof items)[number]) => {
        const d = i.cols[SAM_FOLLOWUP_DATE_COL];
        if (dateOnlyBucket) return !!d && d > todayStr;
        if (i.cols[SAM_FOLLOWUP_COL] !== "Follow Up") return false;
        return !d || d > todayStr;
      };
      const active = items.filter((i) => !isSamEscalated(i.cols[SAM_ESC_COL]) && !snoozed(i));
      merge({ [roleId]: active.length }, { [roleId]: escN }, { [roleId]: active.map((i) => i.id) });
    };

    // ── Board tasks (these gate the loading flag) ──
    const boardTasks: Promise<void>[] = [];

    if (need("benefits")) boardTasks.push(samActive(SAM_GROUPS.benefits, "benefits"));
    if (need("submitAuth")) boardTasks.push(samActive(SAM_GROUPS.submitAuth, "submitAuth"));
    if (need("authOutstanding")) boardTasks.push(samActive(SAM_GROUPS.authOutstanding, "authOutstanding", true));

    if (needAny("evaluate", "sendRequest", "confirmReceipt", "chaseFax", "chaseParachute", "chaseBenefits")) {
      boardTasks.push(
        (async () => {
          if (!meshHasToken()) return;
          const items = await fetchBoardGroupItemsLight(
            MASHEKE_BOARD_ID,
            MESH_GROUPS.medicalNecessity,
            [MESH_STAGE_COL, MESH_NAD_COL, MESH_ESC_COL, MESH_METHOD_COL, MESH_PROPOSED_STUCK_COL],
          );
          const nc: RoleCounts = { evaluate: 0, sendRequest: 0, confirmReceipt: 0, chaseFax: 0, chaseParachute: 0, chaseBenefits: 0 };
          const ec: RoleCounts = { evaluate: 0, sendRequest: 0, confirmReceipt: 0, chaseFax: 0, chaseParachute: 0, chaseBenefits: 0 };
          const ids: RolePatientIds = { evaluate: [], sendRequest: [], confirmReceipt: [], chaseFax: [], chaseParachute: [], chaseBenefits: [] };
          for (const item of items) {
            // Proposed Stuck patients left the rep queues — they await the
            // manager's Final Decision (mirrors masheke useMondayPatients +
            // both baseline generators; §5.8 counting contract).
            if (item.cols[MESH_PROPOSED_STUCK_COL] === "Proposed Stuck") continue;
            const stage = item.cols[MESH_STAGE_COL] ?? "";
            let roleId: string | null = null;
            if (stage === "Evaluate MN") roleId = "evaluate";
            else if (stage === "Send Request") roleId = "sendRequest";
            else if (stage === "Confirm Receipt") roleId = "confirmReceipt";
            else if (stage === "Chase Clinicals") { const cm = item.cols[MESH_METHOD_COL]; roleId = cm === "Parachute" || cm === "Email" ? "chaseParachute" : "chaseFax"; }
            if (!roleId) continue;

            const isChase = roleId === "chaseFax" || roleId === "chaseParachute";
            if (isMeshEscalated(item)) {
              ec[roleId]++;
              if (isChase) ec.chaseBenefits++;
              continue; // escalated → not in the non-escalated active list
            }
            const nad = (item.cols[MESH_NAD_COL] ?? "").slice(0, 10);
            if (nad && nad > todayStr) continue; // scheduled (future)

            nc[roleId]++;
            ids[roleId].push(item.id);
            if (isChase) {
              nc.chaseBenefits++;
              ids.chaseBenefits.push(item.id);
            }
          }
          merge(nc, ec, ids);
        })(),
      );
    }

    // DVS — patients at Stage Advancer "DVS" board-wide (no dedicated group;
    // mirrors both baseline generators). Active = not escalated (a manual
    // review flips the stage to Auth Denied anyway).
    if (need("dvs")) {
      boardTasks.push(
        (async () => {
          if (!samHasToken()) return;
          const items = await fetchBoardStageItemsLight(SAM_BOARD_ID, SAM_STAGE_COL, SAM_DVS_STAGE_INDEX, [SAM_ESC_COL, SAM_FOLLOWUP_DATE_COL]);
          const escN = items.filter((i) => isSamEscalated(i.cols[SAM_ESC_COL])).length;
          // Date-only snooze, same rule as Auth Outstanding (Josh 2026-07-21):
          // a future Follow Up Date hides the patient from /dvs AND the count;
          // blank date = due. Mirrors DvsPage `snoozed` + both baseline
          // countDvs (§5.8 counting contract — change together).
          const snoozedDvs = (i: (typeof items)[number]) => {
            const d = i.cols[SAM_FOLLOWUP_DATE_COL];
            return !!d && d > todayStr;
          };
          const active = items.filter((i) => !isSamEscalated(i.cols[SAM_ESC_COL]) && !snoozedDvs(i));
          merge({ dvs: active.length }, { dvs: escN }, { dvs: active.map((i) => i.id) });
        })(),
      );
    }

    if (need("welcomeCall")) {
      boardTasks.push(
        (async () => {
          const items = await fetchBoardGroupItemsLight(WC_BOARD_ID, WC_GROUP_ID, [WC_ESC_COL, WC_FOLLOWUP_COL]);
          const escN = items.filter((i) => i.cols[WC_ESC_COL] === ESC_REQUIRED).length;
          const active = items.filter(
            (i) => i.cols[WC_ESC_COL] !== ESC_REQUIRED && i.cols[WC_FOLLOWUP_COL] !== "Done",
          );
          merge({ welcomeCall: active.length }, { welcomeCall: escN }, { welcomeCall: active.map((i) => i.id) });
        })(),
      );
    }

    if (need("finalConfirm")) {
      boardTasks.push(
        (async () => {
          const items = await fetchBoardGroupItemsLight(WC_BOARD_ID, FINAL_CONFIRM_GROUP_ID, [WC_ESC_COL]);
          const escN = items.filter((i) => i.cols[WC_ESC_COL] === ESC_REQUIRED).length;
          const active = items.filter((i) => i.cols[WC_ESC_COL] !== ESC_REQUIRED);
          merge({ finalConfirm: active.length }, { finalConfirm: escN }, { finalConfirm: active.map((i) => i.id) });
        })(),
      );
    }

    if (needAny("profile", "unverifiedReferrals")) {
      boardTasks.push(
        (async () => {
          const items = await fetchBoardGroupItemsLight(
            PROFILE_BOARD_ID,
            PROFILE_GROUP_ID,
            [PROF_FOLLOWUP_COL, PROF_REFERRAL_TYPE_COL, PROF_REFERRAL_SOURCE_COL],
          );
          const active = items.filter((i) => i.cols[PROF_FOLLOWUP_COL] !== "Done");
          // Verified/Unverified split — duplicates lib/profile/referralSplit.ts
          // (not imported: that module rides in the lazy Profile page chunk).
          // Only the TYPE column routes "Patient" — the SOURCE column has its
          // own "Patient" label that must NOT match.
          const isUnverified = (i: LightItem) =>
            (i.cols[PROF_REFERRAL_TYPE_COL] ?? "").trim().toLowerCase() === "patient" ||
            (i.cols[PROF_REFERRAL_SOURCE_COL] ?? "").trim().toLowerCase() === "carecentrix";
          const unverified = active.filter(isUnverified);
          const verified = active.filter((i) => !isUnverified(i));
          merge(
            { profile: verified.length, unverifiedReferrals: unverified.length },
            { profile: 0, unverifiedReferrals: 0 },
            { profile: verified.map((i) => i.id), unverifiedReferrals: unverified.map((i) => i.id) },
          );
        })(),
      );
    }

    if (needAny("subscription", "updateClinicals")) {
      boardTasks.push(
        (async () => {
          const subIds = await fetchBoardGroupIds(SUB_BOARD_ID, SUB_GROUP_ID);
          merge(
            { subscription: subIds.length, updateClinicals: subIds.length },
            { subscription: 0, updateClinicals: 0 },
            { subscription: subIds, updateClinicals: [...subIds] },
          );
        })(),
      );
    }

    // ── Side tasks: do NOT gate the spinner (RingCentral fax + Patient
    // Questions can be slow/external; the role bars shouldn't wait on them). ──
    const sideTasks: Promise<void>[] = [];

    if (need("patientQuestions")) {
      sideTasks.push(
        (async () => {
          const pqCount = await import("@/lib/patientQuestions/mondayApi")
            .then((m) => m.fetchPatientQuestionsCount())
            .catch(() => 0);
          merge({ patientQuestions: pqCount }, { patientQuestions: 0 }, {});
        })(),
      );
    }

    if (need("fax")) {
      sideTasks.push(
        (async () => {
          try {
            const live = await import("@/lib/fax/ringcentralApi").then((m) => m.fetchUnreadFaxCount());
            // Reset-at-midnight latch (shared, global): once the inbox first hits
            // zero today the bar stays "Done!" until ET midnight, even as new
            // faxes arrive. Falls back to the live count if the shared state is
            // unreachable, so faxes are never hidden by an outage.
            const shown = await import("@/lib/fax/faxClearedState")
              .then((m) => m.resolveFaxBurndownCount(live, etToday()))
              .catch(() => live);
            merge({ fax: shown }, { fax: 0 }, {});
          } catch (e) {
            console.error("RingCentral fax count failed:", e);
          }
        })(),
      );
    }

    await Promise.allSettled(boardTasks);
    if (!mountedRef.current) return;
    fetchedThisSession = true;
    if (!silent) setLoading(false); // bars are ready — don't wait on fax/PQ
    await Promise.allSettled(sideTasks); // finish in the background
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Refetch on mount and whenever the role scope changes. First fetch of a
    // page load is non-silent; in-session remounts/scope-changes and 60s polls
    // refresh silently (cached values stay on screen).
    fetchCounts(fetchedThisSession);
    const interval = setInterval(() => fetchCounts(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchCounts, roleKey]);

  return { counts, escalatedCounts, patientIds, loading, refetch: fetchCounts };
}
