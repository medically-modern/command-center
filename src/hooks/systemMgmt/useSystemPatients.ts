/**
 * Hook that fetches all patients across every board and provides
 * search + escalation filtering.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  fetchAllPatients,
  removeEscalation as apiRemoveEscalation,
  type SystemPatient,
} from "@/lib/systemMgmt/mondayApi";

const POLL_MS = 90_000; // refresh every 90s

export function useSystemPatients() {
  const [patients, setPatients] = useState<SystemPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const all = await fetchAllPatients();
      setPatients(all);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, POLL_MS);
    return () => clearInterval(interval);
  }, [refetch]);

  /** All patients with an active escalation */
  const escalated = useMemo(
    () => patients.filter((p) => p.escalated),
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

  return { patients, escalated, loading, error, refetch, removeEscalation };
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
    // Name match: fuzzy
    if (fuzzyMatch(trimmed, p.name)) return true;
    // Exact substring fallback
    if (p.name.toLowerCase().includes(trimmed.toLowerCase())) return true;
    return false;
  });
}
