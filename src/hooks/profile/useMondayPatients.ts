import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { fetchGroupItems, fetchItemById, hasToken } from "@/lib/profile/mondayApi";
import { mondayItemToPatient } from "@/lib/profile/mondayMapping";
import { applyPendingAdvances } from "@/lib/shared/pendingAdvance";

const POLL_MS = 15_000;
const LS_CACHE_KEY_BASE = "prof-patients-cache";
// Per-group cache key. Without scoping, flipping the Unverified Referrals
// filter paints the previous group's patients from localStorage before the
// fetch lands. Derived per call rather than held in a module-level variable —
// two pages using this hook during a lazy route transition would otherwise
// race on it and read each other's cache.
function cacheKeyFor(groupId?: GroupSelector): string {
  const key = groupKeyOf(groupId);
  return key ? `${LS_CACHE_KEY_BASE}:${key}` : LS_CACHE_KEY_BASE;
}

/** One group, or several — Already In System spans 1. Intake and its own
 *  board group (§5.10). */
type GroupSelector = string | string[];

/**
 * Stable identity for a group selection.
 *
 * A caller passing an ARRAY builds a fresh one every render, so the
 * change-detection below has to compare contents, not the reference — comparing
 * references would re-fetch (and re-raise the blocking overlay) on every single
 * render of the page.
 */
function groupKeyOf(groupId?: GroupSelector): string {
  if (!groupId) return "";
  return Array.isArray(groupId) ? groupId.join(",") : groupId;
}
const LS_OVERLAY_KEY = "prof-overlays";

function loadOverlays(): Record<string, Partial<Patient>> {
  try {
    const raw = localStorage.getItem(LS_OVERLAY_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Partial<Patient>>;
  } catch {
    return {};
  }
}

function persistOverlays(overlays: Record<string, Partial<Patient>>): void {
  try {
    localStorage.setItem(LS_OVERLAY_KEY, JSON.stringify(overlays));
  } catch {
    // Storage full or unavailable
  }
}

function removePersistedOverlay(id: string): void {
  try {
    const overlays = loadOverlays();
    delete overlays[id];
    persistOverlays(overlays);
  } catch {
    // ignore
  }
}

function loadCachedPatients(groupId?: GroupSelector): Patient[] {
  try {
    const raw = localStorage.getItem(cacheKeyFor(groupId));
    if (!raw) return [];
    return JSON.parse(raw) as Patient[];
  } catch { return []; }
}

function persistPatientCache(patients: Patient[], groupId?: GroupSelector): void {
  try {
    localStorage.setItem(cacheKeyFor(groupId), JSON.stringify(patients));
  } catch { /* ignore */ }
}

export interface UseMondayPatientsOptions {
  /**
   * Fetch the LIST with this narrow column set instead of all of
   * `READ_COLUMN_IDS` (see `LIST_COLUMN_IDS`). Records built this way are
   * stamped `partial` so they can never reach a write, and the patient the rep
   * opens is fetched separately at full width via `loadDetail`.
   *
   * Omit it and the hook behaves exactly as before: full rows, and `detail`
   * simply mirrors nothing (the caller keeps deriving `selected` from the list).
   */
  listColumns?: string[];
}

export function useMondayPatients(
  injectedPatientId?: string | null,
  groupId?: GroupSelector,
  options?: UseMondayPatientsOptions,
) {
  // The deep link the page currently has. Kept current here so the stable
  // `refetch` above can read it without becoming order-dependent on renders.
  // Patients hidden optimistically because an exit advanced them out of this
  // queue (id → when). Reconciled against the board on every poll — see
  // lib/shared/pendingAdvance. In memory on purpose: a reload is a fresh read.
  const pendingAdvanceRef = useRef<Map<string, number>>(new Map());
  const injectedIdRef = useRef(injectedPatientId);
  useEffect(() => { injectedIdRef.current = injectedPatientId; }, [injectedPatientId]);

  // Read through a ref for the same reason as the deep link: `options` is a
  // fresh object literal every render, so depending on it would rebuild
  // `refetch`, restart the poll and re-raise the blocking overlay endlessly.
  const listColumnsRef = useRef(options?.listColumns);
  useEffect(() => { listColumnsRef.current = options?.listColumns; }, [options?.listColumns]);
  const cachedRef = useRef(loadCachedPatients(groupId));
  // Held in a ref so switching groups doesn't rebuild `refetch` (which the
  // poll interval depends on) — the effect below drives the re-fetch instead.
  const groupIdRef = useRef(groupId);
  const [patients, setPatients] = useState<Patient[]>(cachedRef.current);
  const [loading, setLoading] = useState(cachedRef.current.length === 0);
  // Blocks the page (full-screen overlay) from mount until this role's first
  // fetch lands. Unlike `loading`, it's always true on mount regardless of the
  // localStorage cache, and a background poll never re-raises it — so you can't
  // click a stale cached list before fresh Monday data arrives.
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Overlay: local edits keyed by patient id → partial patient.
  // These survive re-fetches so polling doesn't clobber in-progress edits.
  // Initialized from localStorage so saved progress persists across navigation.
  const overlayRef = useRef<Record<string, Partial<Patient>>>(loadOverlays());

  // "As received" snapshot: the FIRST pre-overlay Monday values seen for each
  // patient this session. The left "What We Received" cards read from this so
  // they keep showing the original intake data while the agent edits the
  // right side (and even after Run Stedi writes corrections to Monday).
  const receivedRef = useRef<Record<string, Patient>>({});

  const applyOverlays = useCallback((base: Patient[]): Patient[] => {
    const ov = overlayRef.current;
    return base.map((p) => (ov[p.id] ? { ...p, ...ov[p.id] } : p));
  }, []);

  /** Single-record form of the above. The detail record has to run through the
   *  same merge or an in-progress edit would vanish from the panes the moment
   *  the record is (re)fetched — while still being saved. */
  const applyOverlay = useCallback((p: Patient): Patient => {
    const ov = overlayRef.current[p.id];
    return ov ? { ...p, ...ov } : p;
  }, []);

  // ── The open patient, read at FULL width ──────────────────────────────
  // The list may be narrow (see `listColumns`), so the panes, the readiness
  // gate and every write read this record instead of a sidebar row.
  const [detail, setDetail] = useState<Patient | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  /** Who `detail` is meant to be RIGHT NOW. Every async apply below re-checks
   *  it, so a slow response for a patient the rep has already left can never
   *  paint over the one they moved to. */
  const detailIdRef = useRef<string | null>(null);

  const fetchDetail = useCallback(
    async (id: string, silent: boolean) => {
      if (!silent) {
        setDetailLoading(true);
        setDetailError(null);
      }
      try {
        const item = await fetchItemById(id);
        if (!mountedRef.current || detailIdRef.current !== id) return;
        if (!item) {
          // Gone from the board (moved on, deleted). Say so rather than
          // rendering an empty patient.
          if (!silent) setDetail(null);
          setDetailError("That patient could no longer be loaded from Monday.");
          return;
        }
        const full = mondayItemToPatient(item);
        // The as-received snapshot is taken HERE, not from the list: a narrow
        // list row would freeze `getReceived` at nine columns, and the panes
        // that read it (the patient's own form answers, e.g. the call slot they
        // picked before a rep overrode it) would read blank forever.
        if (!receivedRef.current[id]) receivedRef.current[id] = full;
        setDetail(applyOverlay(full));
        setDetailError(null);
      } catch (e) {
        if (!mountedRef.current || detailIdRef.current !== id) return;
        setDetailError(e instanceof Error ? e.message : "Failed to load this patient from Monday");
        // A silent refresh keeps whatever is already on screen; a first load
        // has nothing to keep. Either way we never fall back to the list row —
        // that record is partial, and showing it would put ~90 blank fields in
        // front of a rep as though the board were empty.
        if (!silent) setDetail(null);
      } finally {
        if (mountedRef.current && detailIdRef.current === id && !silent) setDetailLoading(false);
      }
    },
    [applyOverlay],
  );

  /**
   * Point the detail record at a patient (or `null` to clear it).
   *
   * Stable, so the page can call it straight from an effect keyed on the
   * selected id. Re-selecting the patient already open is a no-op — without
   * that guard the effect would refetch on every render.
   */
  const loadDetail = useCallback(
    (id: string | null) => {
      if (detailIdRef.current === id) return;
      detailIdRef.current = id;
      setDetail(null);
      setDetailError(null);
      if (!id) {
        setDetailLoading(false);
        return;
      }
      void fetchDetail(id, false);
    },
    [fetchDetail],
  );

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
      const listColumns = listColumnsRef.current;
      const items = await fetchGroupItems(groupIdRef.current, undefined, listColumns);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      // Stamped `partial` whenever the read was narrow, so nothing downstream
      // can mistake "never fetched" for "blank on the board".
      const ps = safeItems.map((it) => mondayItemToPatient(it, { partial: !!listColumns }));
      // ⚠️ Seed the as-received snapshot from the list ONLY when the list is
      // full-width. The snapshot is first-write-wins, so a NARROW row would
      // capture nine columns and keep them forever — which is why the two-tier
      // caller takes it in `fetchDetail` instead, off the full record.
      //
      // But it must still be seeded here for full-width callers: ProfilePage
      // reads `getReceived(selected.id) ?? selected` and never calls
      // `loadDetail`, so skipping this unconditionally left its "as received"
      // card falling through to the LIVE record — which then drifts as the rep
      // edits and as Monday refreshes, silently losing the first-seen values
      // the card exists to preserve.
      if (!listColumns) {
        for (const base of ps) {
          if (!receivedRef.current[base.id]) receivedRef.current[base.id] = base;
        }
      }
      // The group fetch IS this queue's membership test (the role split runs in
      // the page, over this list), so the optimistic hide is applied to exactly
      // that list and can never disagree with what the sidebar renders.
      const merged = applyPendingAdvances(applyOverlays(ps), pendingAdvanceRef.current);

      // Read through a ref: `refetch` is deliberately stable (recreating it
      // restarts the poll and re-raises the blocking overlay — see the groupKey
      // note below), so a captured `injectedPatientId` would be frozen at its
      // first-render value. It was: a patient who LEFT this queue, and whose
      // ?patientId= the page had since dropped, kept being re-injected on every
      // poll and sat in the sidebar forever.
      // ⚠️ A deep link is exempt from this queue's rules but NOT from an exit
      // taken this session. These pages already drop `?patientId=` on every
      // exit (clearDeepLink) — this is the belt to that braces, since the URL
      // can be re-pasted and the marker expires on its own.
      const injectedId = injectedIdRef.current;
      if (
        injectedId &&
        !pendingAdvanceRef.current.has(injectedId) &&
        !merged.some((p) => p.id === injectedId)
      ) {
        try {
          const item = await fetchItemById(injectedId);
          if (item) {
            const injected = mondayItemToPatient(item);
            if (!receivedRef.current[injected.id]) receivedRef.current[injected.id] = injected;
            merged.unshift(injected);
          }
        } catch { /* ignore */ }
      }

      setPatients(merged);
      persistPatientCache(merged, groupIdRef.current);

      // Refresh the open patient in the same pass. This is what keeps every
      // existing `refetch(true)` call site working unchanged — the post-save
      // reconciles, and above all the Stedi settle watcher, which polls
      // `refetch` waiting for the stedi* columns to land and would otherwise
      // never see them now that the list no longer carries them.
      const openId = detailIdRef.current;
      if (openId) await fetchDetail(openId, true);
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : "Failed to load patients from Monday");
    } finally {
      if (mountedRef.current) {
        if (!silent) setLoading(false);
        // First fetch for this role is done (even on error/silent) — lift the
        // blocking overlay so the page never stays stuck.
        setInitialLoading(false);
      }
    }
    // Both deps are stable useCallbacks, so `refetch` stays stable — the poll
    // interval and the groupKey effect below depend on that.
  }, [applyOverlays, fetchDetail]);

  // Keyed on the group CONTENTS: a caller selecting several groups passes a new
  // array each render, and comparing references would re-fetch every time —
  // re-raising the blocking overlay on each render and never settling.
  const groupKey = groupKeyOf(groupId);
  const groupKeyRef = useRef(groupKey);
  useEffect(() => {
    if (groupKeyRef.current === groupKey) return;
    groupKeyRef.current = groupKey;
    groupIdRef.current = groupId;
    cachedRef.current = loadCachedPatients(groupId);
    setPatients(cachedRef.current);
    setInitialLoading(true);
    refetch(false);
    // `groupId` is deliberately not a dependency — `groupKey` is its stable
    // identity, and adding the array itself would defeat the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, refetch]);

  useEffect(() => {
    mountedRef.current = true;
    refetch(cachedRef.current.length > 0);
    const id = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch]);

  /**
   * Optimistic local update — stores in overlay and patches state immediately.
   */
  const updateLocal = useCallback((id: string, patch: Partial<Patient>) => {
    overlayRef.current[id] = { ...overlayRef.current[id], ...patch };
    setPatients((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
    // The panes render from `detail`, not from the list, so an optimistic edit
    // that only patched `patients` would appear in the sidebar and nowhere else.
    setDetail((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  /**
   * Clear overlay for a patient after successful submit so next poll picks up
   * the Monday-side state.
   */
  const clearOverlay = useCallback((id: string) => {
    delete overlayRef.current[id];
    removePersistedOverlay(id);
  }, []);

  /**
   * Remove a specific set of fields from a patient's overlay. Use when
   * the page-side optimistic update needs to step out of the way so
   * Monday's freshly-polled value can render unmasked. Leaves all other
   * in-progress edits intact (unlike clearOverlay).
   */
  const removeOverlayKeys = useCallback(
    (id: string, keys: (keyof Patient)[]) => {
      const entry = overlayRef.current[id];
      if (!entry) return;
      for (const k of keys) delete entry[k];
      // If we just emptied the overlay, drop the bucket entirely.
      if (Object.keys(entry).length === 0) {
        delete overlayRef.current[id];
      }
    },
    [],
  );


  /** Persist the current overlay for a patient to localStorage so edits
   *  survive page navigation and browser refreshes. */
  const saveOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current[id];
    if (overlay) {
      const saved = loadOverlays();
      saved[id] = overlay;
      persistOverlays(saved);
    }
  }, []);

  const hasOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current[id];
    return !!overlay && Object.keys(overlay).length > 0;
  }, []);

  /** The as-received (first-seen, pre-edit) Monday values for a patient. */
  const getReceived = useCallback((id: string): Patient | undefined => receivedRef.current[id], []);

  /** An exit moved this patient out of the queue (Advance to MN, Advance to
   *  Clean-Up, Move to Profile Send Off, Mark as Stuck) — take them off screen
   *  now rather than leaving a live exit button until the next 15s poll AND the
   *  group move behind it. Display only: the board still decides, and the poll
   *  brings them back if nothing moved. */
  const markAdvanced = useCallback((id: string) => {
    pendingAdvanceRef.current.set(id, Date.now());
    setPatients((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return {
    patients, loading, initialLoading, error, refetch, updateLocal, markAdvanced, clearOverlay,
    removeOverlayKeys, saveOverlay, hasOverlay, getReceived,
    // The open patient at full width, plus its own load state. `detail` is null
    // until the fetch resolves — callers must gate writes on that, never fall
    // back to the (partial) list row.
    detail, detailLoading, detailError, loadDetail,
  };
}
