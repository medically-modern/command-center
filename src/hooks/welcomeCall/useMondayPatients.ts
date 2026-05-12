import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { fetchGroupItems, fetchItemById, GROUPS, hasToken } from "@/lib/welcomeCall/mondayApi";
import { mondayItemToPatient } from "@/lib/welcomeCall/mondayMapping";

const POLL_MS = 30_000;

export function useMondayPatients(injectedPatientId?: string | null) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // local-session overlay so UI edits persist without re-fetching from Monday
  const overlayRef = useRef<Map<string, Partial<Patient>>>(new Map());

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
      const [items, escalationItems] = await Promise.all([
        fetchGroupItems(),
        fetchGroupItems(GROUPS.escalation),
      ]);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      const ps = safeItems.map(mondayItemToPatient);
      const merged = ps.map((p) => {
        const o = overlayRef.current.get(p.id);
        return o ? { ...p, ...o } : p;
      });

      // Merge in escalated patients from the Escalation group
      const safeEscItems = Array.isArray(escalationItems) ? escalationItems : [];
      const escPatients = safeEscItems.map(mondayItemToPatient).map((p) => ({
        ...p,
        escalated: true,
      }));
      for (const ep of escPatients) {
        if (!merged.some((m) => m.id === ep.id)) {
          const o = overlayRef.current.get(ep.id);
          merged.push(o ? { ...ep, ...o } : ep);
        }
      }

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

  // Local-only update — used by UI handlers. Does NOT write to Monday;
  // call writeStatusIndex from mondayApi for that.
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
  }, []);

  return { patients, loading, error, refetch, update, clearOverlay };
}
