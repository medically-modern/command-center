import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/subscription/workflow";
import { fetchGroupItems, fetchItemById, hasToken } from "@/lib/subscription/mondayApi";
import { mondayItemToPatient } from "@/lib/subscription/mondayMapping";

const POLL_MS = 30_000;
const LS_KEY = "sub-overlays";
const LS_CACHE_KEY = "sub-patients-cache";

// ── Patient cache (instant load on return visits) ──

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
  } catch { /* quota exceeded or private browsing — ignore */ }
}

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
  const cachedRef = useRef(loadCachedPatients());
  const [patients, setPatients] = useState<Patient[]>(cachedRef.current);
  const [loading, setLoading] = useState(cachedRef.current.length === 0);
  // Blocks the page (full-screen overlay) from mount until this role's first
  // fetch lands. Unlike `loading`, it's always true on mount regardless of the
  // localStorage cache, and a background poll never re-raises it — so you can't
  // click a stale cached list before fresh Monday data arrives.
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<Map<string, Partial<Patient>>>(loadOverlays());
  const mountedRef = useRef(true);
  const isFirstLoadRef = useRef(true);

  const refetch = useCallback(async (maybeSilent: unknown = false) => {
    const silent = maybeSilent === true;
    if (!hasToken()) {
      if (mountedRef.current) {
        setError("VITE_MONDAY_API_TOKEN is not set. Add it in your project env vars and rebuild.");
        setLoading(false);
      }
      return;
    }
    // Only show loading spinner on first load or manual refresh
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
      isFirstLoadRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // If we have cached patients, fetch silently in the background (no spinner)
    refetch(cachedRef.current.length > 0);
    const id = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch]);

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

  return { patients, loading, initialLoading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay };
}
