import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/subscription/workflow";
import { fetchGroupItems, fetchItemById, hasToken } from "@/lib/subscription/mondayApi";
import { mondayItemToPatient } from "@/lib/subscription/mondayMapping";

const POLL_MS = 30_000;
const LS_KEY = "sub-overlays";

function loadOverlays(): Map<string, Partial<Patient>> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, Partial<Patient>>));
  } catch { return new Map(); }
}
function persistOverlays(map: Map<string, Partial<Patient>>): void {
  try {
    const obj: Record<string, Partial<Patient>> = {};
    map.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}
function removeOverlayFromStorage(id: string): void {
  try { const m = loadOverlays(); m.delete(id); persistOverlays(m); } catch { /* ignore */ }
}

export function useMondayPatients(injectedPatientId?: string | null) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<Map<string, Partial<Patient>>>(loadOverlays());
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    if (!hasToken()) {
      if (mountedRef.current) {
        setError("VITE_MONDAY_API_TOKEN is not set. Add it in your project env vars and rebuild.");
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const items = await fetchGroupItems();
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      const ps = safeItems.map(mondayItemToPatient);
      const merged = ps.map((p) => {
        const o = overlayRef.current.get(p.id);
        return o ? { ...p, ...o } : p;
      });

      if (injectedPatientId && !merged.some((p) => p.id === injectedPatientId)) {
        try {
          const item = await fetchItemById(injectedPatientId);
          if (item) {
            const injected = mondayItemToPatient(item);
            const o = overlayRef.current.get(injected.id);
            merged.unshift(o ? { ...injected, ...o } : injected);
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
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refetch();
    const id = setInterval(refetch, POLL_MS);
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
    removeOverlayFromStorage(id);
  }, []);

  const saveOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current.get(id);
    if (overlay) { const m = loadOverlays(); m.set(id, overlay); persistOverlays(m); }
  }, []);

  const hasOverlay = useCallback((id: string) => {
    const o = overlayRef.current.get(id);
    return !!o && Object.keys(o).length > 0;
  }, []);

  return { patients, loading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay };
}
