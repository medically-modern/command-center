import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/finalConfirm/workflow";
import { fetchGroupItems, fetchItemById, hasToken } from "@/lib/finalConfirm/mondayApi";
import { mondayItemToPatient } from "@/lib/finalConfirm/mondayMapping";

const POLL_MS = 30_000;
const LS_KEY = "fc-overlays";

/** Read all saved overlays from localStorage. */
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

/** Persist the full overlay map to localStorage. */
function persistOverlays(map: Map<string, Partial<Patient>>): void {
  try {
    const obj: Record<string, Partial<Patient>> = {};
    map.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {
    // Storage full or unavailable — silently ignore.
  }
}

/** Remove one patient's overlay from localStorage. */
function removeOverlay(id: string): void {
  try {
    const map = loadOverlays();
    map.delete(id);
    persistOverlays(map);
  } catch {
    // ignore
  }
}

export function useMondayPatients(injectedPatientId?: string | null) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<Map<string, Partial<Patient>>>(loadOverlays());
  const mountedRef = useRef(true);

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
      const items = await fetchGroupItems(undefined);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      const ps = safeItems.map(mondayItemToPatient);
      const merged = ps.map((p) => {
        const o = overlayRef.current.get(p.id);
        return o ? { ...p, ...o } : p;
      });
      setPatients(merged);

      // If a patientId was injected (deep-link), fetch that item if not already present
      if (injectedPatientId && !merged.some((p) => p.id === injectedPatientId)) {
        try {
          const item = await fetchItemById(injectedPatientId);
          if (item && mountedRef.current) {
            const injected = mondayItemToPatient(item);
            setPatients((prev) => {
              if (prev.some((p) => p.id === injected.id)) return prev;
              return [...prev, injected];
            });
          }
        } catch (e) {
          console.warn("[useMondayPatients] failed to fetch injected patient", e);
        }
      }
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : "Failed to load patients from Monday");
    } finally {
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refetch();
    const id = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch]);

  const update = useCallback((id: string, patch: Partial<Patient>) => {
    setPatients((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const merged = { ...p, ...patch, lastUpdated: new Date().toISOString() };
        overlayRef.current.set(id, { ...(overlayRef.current.get(id) ?? {}), ...patch });
        return merged;
      }),
    );
  }, []);

  const clearOverlay = useCallback((id: string) => {
    overlayRef.current.delete(id);
    removeOverlay(id);
  }, []);

  /** Persist the current overlay for a patient to localStorage. */
  const saveOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current.get(id);
    if (overlay) {
      const saved = loadOverlays();
      saved.set(id, overlay);
      persistOverlays(saved);
    }
  }, []);

  /** Returns true if the patient has a non-empty overlay (unsaved local edits). */
  const hasOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current.get(id);
    return !!overlay && Object.keys(overlay).length > 0;
  }, []);

  /**
   * Insert a patient into local state, storing the overlay so the next
   * refetch preserves the local edits. Used by Split Order to add the
   * newly-duplicated Monday item to the sidebar immediately, before the
   * background poll picks it up.
   */
  const addPatient = useCallback((patient: Patient, overlay?: Partial<Patient>) => {
    if (overlay) {
      overlayRef.current.set(patient.id, {
        ...(overlayRef.current.get(patient.id) ?? {}),
        ...overlay,
      });
    }
    setPatients((prev) => {
      // Avoid duplicate inserts if the patient is already present.
      if (prev.some((p) => p.id === patient.id)) {
        return prev.map((p) => (p.id === patient.id ? { ...p, ...(overlay ?? {}) } : p));
      }
      return [...prev, patient];
    });
  }, []);

  return { patients, loading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay, addPatient };
}
