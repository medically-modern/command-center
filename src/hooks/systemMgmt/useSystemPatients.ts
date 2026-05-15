/**
 * Hook that fetches all patients across every board and provides
 * search + escalation filtering.
 *
 * Uses localStorage cache for instant page load on return visits —
 * cached data is shown immediately, then silently refreshed from Monday.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  fetchAllPatients,
  removeEscalation as apiRemoveEscalation,
  buildCompletionMap,
  type SystemPatient,
} from "@/lib/systemMgmt/mondayApi";

const POLL_MS = 90_000; // refresh every 90s
const LS_CACHE_KEY = "sysmgmt-patients-cache";

// ── Patient cache (instant load on return visits) ──

function loadCachedPatients(): SystemPatient[] {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SystemPatient[];
  } catch { return []; }
}

function persistPatientCache(patients: SystemPatient[]): void {
  try {
    localStorage.setItem(LS_CACHE_KEY, JSON.stringify(patients));
  } catch { /* quota exceeded or private browsing — ignore */ }
}

export function useSystemPatients() {
  const cachedRef = useRef(loadCachedPatients());
  const [patients, setPatients] = useState<SystemPatient[]>(cachedRef.current);
  const [loading, setLoading] = useState(cachedRef.current.length === 0);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async (silent = false) => {
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const all = await fetchAllPatients();
      if (!mountedRef.current) return;
      setPatients(all);
      persistPatientCache(all);
      setError(null);
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // If we have cached patients, fetch silently (no spinner)
    refetch(cachedRef.current.length > 0);
    const interval = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refetch]);

  /** All patients with an active escalation (exclude completed) */
  const escalated = useMemo(
    () => patients.filter((p) => p.escalated && !p.isCompleted),
    [patients],
  );

  /** Map of lowercase patient name → list of completed board labels */
  const completionMap = useMemo(
    () => buildCompletionMap(patients),
    [patients],
  );

  /** Remove escalation and optimistically update local state */
  const removeEscalation = useCallback(
    async (patient: SystemPatient) => {
      await apiRemoveEscalation(patient);
      setPatients((prev) =>
        prev.map((p) =>
          p.id === patient.id
            ? { ...p, escalated: false, escalationText: "Done" }
            : p,
        ),
      );
    },
    [],
  );

  return { patients, escalated, completionMap, loading, error, refetch, removeEscalation };
}

// ── Fuzzy search helper ──────────────────────────────────────

/**
 * Simple fuzzy matching: checks if all characters of the query
 * appear in order within the target string.
 */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Normalize phone to digits only for comparison.
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Search patients by name (fuzzy) or phone (digit substring).
 */
export function searchPatients(
  patients: SystemPatient[],
  query: string,
): SystemPatient[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const isDigits = /^\d+$/.test(trimmed.replace(/[\s\-()]/g, ""));
  const normalizedQuery = normalizePhone(trimmed);

  return patients.filter((p) => {
    // Phone match: digit substring
    if (isDigits && normalizedQuery.length >= 3) {
      const normalizedPhone = normalizePhone(p.phone);
      if (normalizedPhone.includes(normalizedQuery)) return true;
    }
    // Exact substring match (works for any length)
    if (p.name.toLowerCase().includes(trimmed.toLowerCase())) return true;
    // Fuzzy match only for queries with 3+ chars (avoids matching everything on 1-2 chars)
    if (trimmed.length >= 3 && fuzzyMatch(trimmed, p.name)) return true;
    return false;
  });
}
