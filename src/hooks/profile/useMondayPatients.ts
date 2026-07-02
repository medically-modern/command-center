import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { fetchGroupItems, fetchItemById, hasToken } from "@/lib/profile/mondayApi";
import { mondayItemToPatient } from "@/lib/profile/mondayMapping";

const POLL_MS = 15_000;
const LS_CACHE_KEY = "prof-patients-cache";
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

function loadCachedPatients(): Patient[] {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Patient[];
  } catch { return []; }
}

function persistPatientCache(patients: Patient[]): void {
  try {
    localStorage.setItem(LS_CACHE_KEY, JSON.stringify(patients));
  } catch { /* ignore */ }
}

export function useMondayPatients(injectedPatientId?: string | null) {
  const cachedRef = useRef(loadCachedPatients());
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
      const items = await fetchGroupItems(undefined);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      const ps = safeItems.map(mondayItemToPatient);
      for (const base of ps) {
        if (!receivedRef.current[base.id]) receivedRef.current[base.id] = base;
      }
      const merged = applyOverlays(ps);

      if (injectedPatientId && !merged.some((p) => p.id === injectedPatientId)) {
        try {
          const item = await fetchItemById(injectedPatientId);
          if (item) {
            const injected = mondayItemToPatient(item);
            if (!receivedRef.current[injected.id]) receivedRef.current[injected.id] = injected;
            merged.unshift(injected);
          }
        } catch { /* ignore */ }
      }

      setPatients(merged);
      persistPatientCache(merged);
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
  }, [applyOverlays]);

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

  return { patients, loading, initialLoading, error, refetch, updateLocal, clearOverlay, removeOverlayKeys, saveOverlay, hasOverlay, getReceived };
}
