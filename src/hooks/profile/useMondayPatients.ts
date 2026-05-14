import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { fetchGroupItems, fetchItemById, hasToken } from "@/lib/profile/mondayApi";
import { mondayItemToPatient } from "@/lib/profile/mondayMapping";

const POLL_MS = 15_000;

export function useMondayPatients(injectedPatientId?: string | null) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Overlay: local edits keyed by patient id → partial patient.
  // These survive re-fetches so polling doesn't clobber in-progress edits.
  const overlayRef = useRef<Record<string, Partial<Patient>>>({});

  const applyOverlays = useCallback((base: Patient[]): Patient[] => {
    const ov = overlayRef.current;
    return base.map((p) => (ov[p.id] ? { ...p, ...ov[p.id] } : p));
  }, []);

  const refetch = useCallback(async (silent = false) => {
    if (!hasToken()) {
      if (mountedRef.current) {
        setError("VITE_MONDAY_API_TOKEN is not set. Add it in your project env vars and rebuild.");
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const onPage = silent ? undefined : (moreItems: import("@/lib/profile/mondayApi").MondayItem[]) => {
        if (!mountedRef.current) return;
        const morePats = applyOverlays(moreItems.map(mondayItemToPatient));
        setPatients((prev) => [...prev, ...morePats]);
      };
      const items = await fetchGroupItems(undefined, onPage);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      const ps = safeItems.map(mondayItemToPatient);
      const merged = applyOverlays(ps);

      if (injectedPatientId && !merged.some((p) => p.id === injectedPatientId)) {
        try {
          const item = await fetchItemById(injectedPatientId);
          if (item) {
            const injected = mondayItemToPatient(item);
            merged.unshift(injected);
          }
        } catch { /* ignore */ }
      }

      setPatients(merged);
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : "Failed to load patients from Monday");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applyOverlays]);

  useEffect(() => {
    mountedRef.current = true;
    refetch();
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


  return { patients, loading, error, refetch, updateLocal, clearOverlay, removeOverlayKeys, saveOverlay, hasOverlay };
}
