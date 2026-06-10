/**
 * useEscalatedCounts — per-role counts of ESCALATED patients only.
 *
 * Powers the Managers › Dashboards view: each role bar shows how many
 * patients in that role are currently marked "Escalation Required"
 * (or "Escalate") on Monday — not the full queue.
 *
 * Reuses the System Management cross-board fetch (all 5 boards), then
 * buckets escalated patients into roles via each patient's roleRoute,
 * which maps 1:1 onto ROLES[].route in config.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { ROLES } from "@/lib/config";
import type { RoleCounts, RolePatientIds } from "@/hooks/useRoleCounts";

const LS_KEY = "escalated-counts-cache";
const POLL_MS = 60_000;

/** route → roleId lookup built from config */
const ROUTE_TO_ROLE: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.route, r.id]),
);

function loadCache(): RoleCounts {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as RoleCounts;
  } catch {
    return {};
  }
}

function persistCache(counts: RoleCounts): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(counts));
  } catch {
    /* ignore */
  }
}

export function useEscalatedCounts(enabled: boolean) {
  const cachedRef = useRef(loadCache());
  const [counts, setCounts] = useState<RoleCounts>(cachedRef.current);
  const [patientIds, setPatientIds] = useState<RolePatientIds>({});
  const [loading, setLoading] = useState(
    Object.keys(cachedRef.current).length === 0,
  );
  const mountedRef = useRef(true);

  const fetchCounts = useCallback(async (silent = false) => {
    if (mountedRef.current && !silent) setLoading(true);

    const next: RoleCounts = {};
    const nextIds: RolePatientIds = {};
    // Initialize every role to 0 so unaffected roles read as "clear",
    // not "unknown".
    for (const r of ROLES) {
      next[r.id] = 0;
      nextIds[r.id] = [];
    }

    try {
      // Lazy import to avoid pulling the systemMgmt chunk eagerly.
      const { fetchAllPatients } = await import("@/lib/systemMgmt/mondayApi");
      const patients = await fetchAllPatients();

      for (const p of patients) {
        if (!p.escalated || p.isCompleted) continue;
        const roleId = ROUTE_TO_ROLE[p.roleRoute];
        if (!roleId) continue; // no matching role page (e.g. blank route)
        next[roleId]++;
        nextIds[roleId].push(p.id);
      }

      // System Management bar = total escalations across the pipeline.
      next.systemMgmt = patients.filter(
        (p) => p.escalated && !p.isCompleted,
      ).length;
    } catch (e) {
      console.error("Failed to fetch escalated counts:", e);
    }

    if (!mountedRef.current) return;
    setCounts(next);
    setPatientIds(nextIds);
    persistCache(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;
    fetchCounts(Object.keys(cachedRef.current).length > 0);
    const interval = setInterval(() => fetchCounts(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [enabled, fetchCounts]);

  return { counts, patientIds, loading, refetch: fetchCounts };
}
