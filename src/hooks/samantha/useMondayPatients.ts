import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient, ProductCodeId, ProductCodeState } from "@/lib/samantha/workflow";
import { fetchGroupItems, fetchItemById, GROUPS, hasToken } from "@/lib/samantha/mondayApi";
import { mondayItemToPatient } from "@/lib/samantha/mondayMapping";
import {
  applyPendingAdvances, groupScope, hasPendingAdvance, markPendingAdvance, sharedPendingAdvances,
} from "@/lib/shared/pendingAdvance";

/**
 * Apply the local-edit overlay on top of a freshly-fetched patient.
 *
 * IMPORTANT: insurance.codes must be deep-merged per code id, NOT shallow-replaced.
 * The user's overlay holds fields they edited (auth, sos), but the fresh fetch from
 * an auth-group fetch ALSO carries Monday-only readback fields like _mondayAuthLabel,
 * methods, dates. A naive `{ ...p, ...overlay }` clobbers those Monday fields when
 * the user switches from Benefits → Submit Auth (the overlay was built without them).
 */
function applyOverlay(p: Patient, o: Partial<Patient> | undefined): Patient {
  if (!o) return p;
  const merged: Patient = { ...p, ...o };
  if (o.insurance && p.insurance) {
    const fromMondayCodes = p.insurance.codes ?? {};
    const fromOverlayCodes = o.insurance.codes ?? {};
    const codeKeys = new Set<ProductCodeId>([
      ...(Object.keys(fromMondayCodes) as ProductCodeId[]),
      ...(Object.keys(fromOverlayCodes) as ProductCodeId[]),
    ]);
    const codes: Partial<Record<ProductCodeId, ProductCodeState>> = {};
    for (const k of codeKeys) {
      codes[k] = {
        ...(fromMondayCodes[k] ?? { status: "pending" }),
        ...(fromOverlayCodes[k] ?? {}),
      } as ProductCodeState;
    }
    merged.insurance = {
      ...p.insurance,
      ...o.insurance,
      codes,
    };
  }
  return merged;
}

const POLL_MS = 30_000;
const LS_KEY = "sam-overlays";
// Namespaced per group — a shared key would seed a freshly-mounted role page
// with the PREVIOUS group's patients until its first Monday fetch lands.
const LS_CACHE_KEY = "sam-patients-cache";
const cacheKey = (group: SidebarGroup) => `${LS_CACHE_KEY}:${group}`;
// One-time cleanup of the pre-namespacing key — nothing reads it anymore and
// it holds a full patient snapshot (PHI) that would otherwise sit in
// localStorage forever.
try { localStorage.removeItem(LS_CACHE_KEY); } catch { /* ignore */ }

function loadCachedPatients(group: SidebarGroup): Patient[] {
  try {
    const raw = localStorage.getItem(cacheKey(group));
    if (!raw) return [];
    return JSON.parse(raw) as Patient[];
  } catch { return []; }
}

function persistPatientCache(group: SidebarGroup, patients: Patient[]): void {
  try {
    localStorage.setItem(cacheKey(group), JSON.stringify(patients));
  } catch { /* ignore */ }
}

function loadOverlays(): Map<string, Partial<Patient>> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, Partial<Patient>>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function persistOverlays(map: Map<string, Partial<Patient>>): void {
  try {
    const obj: Record<string, Partial<Patient>> = {};
    map.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {
    // Storage full or unavailable
  }
}

function removeOverlay(id: string): void {
  try {
    const map = loadOverlays();
    map.delete(id);
    persistOverlays(map);
  } catch {
    // ignore
  }
}

export type SidebarGroup = "benefits" | "submitAuth" | "authOutstanding";

export function useMondayPatients(activeGroup: SidebarGroup = "benefits", injectedPatientId?: string | null) {
  // Lazy initializer — useRef would re-parse the whole cached list from
  // localStorage on every render just to throw it away.
  const [initialCache] = useState(() => loadCachedPatients(activeGroup));
  const [patients, setPatients] = useState<Patient[]>(initialCache);
  const [loading, setLoading] = useState(initialCache.length === 0);
  // Blocks the page (full-screen overlay) from mount until THIS group's first
  // fetch lands. The localStorage cache can hold patients who have since
  // advanced off the group, so a freshly-mounted role page would otherwise
  // render stale patients — and let you click them — for the ~poll window
  // before Monday responds. Unlike `loading`, this is always true on mount
  // regardless of cache, and a background poll never re-raises it.
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // local-session overlay so UI edits persist without re-fetching from Monday
  const overlayRef = useRef<Map<string, Partial<Patient>>>(loadOverlays());

  // ⚠️ The board's OWN values, before any overlay is merged in — what
  // `discardEdits` puts back on screen. Same device as the Welcome Call hook's
  // `baseRef` (Greptile, PR #57): deleting an overlay entry does not change what
  // is rendered, because `patients` holds the MERGED record.
  const baseRef = useRef<Map<string, Patient>>(new Map());

  const mountedRef = useRef(true);

  // Patients hidden optimistically because a send advanced them out of this
  // group (id → when). Reconciled against the board on every poll — see
  // lib/shared/pendingAdvance. In memory on purpose: a reload is a fresh read.
  // ⚠️ The SHARED claim map (2026-09-25) — module state, so an advance made
  // here still hides the patient on the Care Coordinator dashboard and after
  // this page unmounts. See `sharedPendingAdvances`' comment for the Keith
  // Dye measurement that forced it.
  const pendingAdvanceRef = useRef(sharedPendingAdvances);
  // ⚠️ Scoped to THIS group (2026-09-28): Benefits, Submit Auth and Auth
  // Outstanding are one board and one item id, so an unscoped claim made on
  // Benefits hid the patient from Submit Auth, where they had just arrived.
  const advanceScope = groupScope(GROUPS[activeGroup]);

  const refetch = useCallback(async (maybeSilent: unknown = false) => {
    const silent = maybeSilent === true;
    if (!hasToken()) {
      if (mountedRef.current) {
        setError("VITE_MONDAY_API_TOKEN is not set. Add it in your project env vars and rebuild.");
        setLoading(false);
        setInitialLoading(false); // never leave the blocking overlay up over the error
      }
      return;
    }
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const groupId = GROUPS[activeGroup];
      const items = await fetchGroupItems(groupId);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      // Stage = "DVS" items stay in their old group (no group-move automation
      // for the DVS stage yet), so a group fetch alone would keep showing a
      // patient the send already routed to DVS. They belong to the /dvs
      // monitor now — drop them here and in the counting twins (§5.8:
      // useRoleCounts samActive + both baseline countSamGroup).
      const ps = safeItems
        .map(mondayItemToPatient)
        .filter((p) => p.stageAdvancerText !== "DVS");
      for (const p of ps) baseRef.current.set(p.id, p);
      const merged = ps.map((p) => applyOverlay(p, overlayRef.current.get(p.id)));

      // If a specific patient was deep-linked but isn't in this group, fetch individually.
      // ⚠️ A deep link is exempt from this group's queue rules but NOT from an
      // advance made this session: re-injecting a patient we just hid hands the
      // rep back the live Send button the hide exists to take away.
      if (
        injectedPatientId &&
        !hasPendingAdvance(pendingAdvanceRef.current, advanceScope, injectedPatientId) &&
        !merged.some((p) => p.id === injectedPatientId)
      ) {
        try {
          // Both Submit Auth and Auth Outstanding need the per-product auth
          // columns (AUTH_READ_COLUMN_IDS) — mirror AUTH_GROUP_IDS. Omitting
          // submitAuth here made a deep-linked Submit Auth patient (e.g. an
          // Oversight ?patientId= link, or an escalated item not in the group)
          // read ALL auth data blank, risking a duplicate/blank re-submission.
          const useAuth = activeGroup === "authOutstanding" || activeGroup === "submitAuth";
          const item = await fetchItemById(injectedPatientId, useAuth);
          if (item) {
            const injected = mondayItemToPatient(item);
            baseRef.current.set(injected.id, injected);
            merged.unshift(applyOverlay(injected, overlayRef.current.get(injected.id)));
          }
        } catch { /* ignore \u2014 patient may not be on this board */ }
      }

      // ⚠️ Hide at the POINT OF COMMIT, not where the list was built: everything
      // in between is an await during which a send can resolve, and a list
      // filtered earlier would put that patient — Send button and all — back on
      // screen (Greptile, PR #54).
      const visible = applyPendingAdvances(merged, pendingAdvanceRef.current, advanceScope);
      setPatients(visible);
      persistPatientCache(activeGroup, visible);
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : "Failed to load patients from Monday");
    } finally {
      if (mountedRef.current) {
        if (!silent) setLoading(false);
        // First fetch for this group is done (even on error/silent) — lift the
        // blocking overlay so the page never stays stuck.
        setInitialLoading(false);
      }
    }
  }, [activeGroup, injectedPatientId, advanceScope]);

  useEffect(() => {
    mountedRef.current = true;
    refetch(initialCache.length > 0);
    const id = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch, initialCache]);

  // Local-only update — used by UI handlers. Does NOT write to Monday;
  // call writeStatusIndex from mondayApi for that.
  const update = useCallback((id: string, patch: Partial<Patient>) => {
    overlayRef.current.set(id, { ...(overlayRef.current.get(id) ?? {}), ...patch });
    setPatients((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        return { ...p, ...patch, lastUpdated: new Date().toISOString() };
      }),
    );
  }, []);

  const clearOverlay = useCallback((id: string) => {
    overlayRef.current.delete(id);
    removeOverlay(id);
  }, []);

  /**
   * Reset: drop this patient's local edits AND put the board's values back on
   * screen, now — what the Reset button's toast has always promised.
   *
   * ⚠️ Reset used to call `clearOverlay` and then `update()` with blanks
   * (`insurance: EMPTY_INSURANCE, notes: ""`) to empty the form on screen. But
   * `update` writes the OVERLAY, which every refetch merges back over the board,
   * so the blanks outlived the "refetching from Monday" they were paired with.
   * The next Send wrote `notes: ""` over the shared Call Reference Notes column,
   * and Add note appended one line onto `""` and replaced the whole column with
   * it — every Insurance stage's history for that patient, gone.
   *
   * Separate from `clearOverlay`, which runs after a SEND: restoring the pre-send
   * board record there would briefly show the old values on a patient who stays
   * in the queue, and read as a save that didn't take. A patient with no base
   * entry (never seen in a fetch) is left alone — blanking would invent data.
   */
  const discardEdits = useCallback((id: string) => {
    overlayRef.current.delete(id);
    removeOverlay(id);
    const base = baseRef.current.get(id);
    if (!base) return;
    setPatients((prev) => prev.map((p) => (p.id === id ? base : p)));
  }, []);


  const saveOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current.get(id);
    if (overlay) {
      const saved = loadOverlays();
      saved.set(id, overlay);
      persistOverlays(saved);
    }
  }, []);

  const hasOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current.get(id);
    return !!overlay && Object.keys(overlay).length > 0;
  }, []);


  /** A send advanced this patient out of the group — take them off screen now
   *  rather than leaving them in the queue with a live Send button until the
   *  next poll AND the Monday automation that moves the item. Display only: the
   *  board still decides, and the poll brings them back if nothing moved.
   *  ⚠️ Call ONLY when the send actually left this queue — `stageLeavesQueue`
   *  in lib/samantha/stageQueue owns that question, because a send here can
   *  legitimately write no stage at all. */
  const markAdvanced = useCallback((id: string) => {
    markPendingAdvance(pendingAdvanceRef.current, advanceScope, id);
    setPatients((prev) => prev.filter((p) => p.id !== id));
  }, [advanceScope]);

  return { patients, loading, initialLoading, error, refetch, update, markAdvanced, clearOverlay, discardEdits, saveOverlay, hasOverlay };
}
