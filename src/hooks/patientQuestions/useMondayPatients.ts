/**
 * Read-only hook for Patient Questions.
 * Fetches from both boards, merges, sorts by most recent message first.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PatientQuestion } from "@/lib/patientQuestions/types";
import { fetchPatientQuestions, hasToken } from "@/lib/patientQuestions/mondayApi";

const POLL_MS = 30_000;
const LS_CACHE_KEY = "pq-patients-cache";

function loadCache(): PatientQuestion[] {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PatientQuestion[];
  } catch { return []; }
}

function persistCache(data: PatientQuestion[]): void {
  try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

export function useMondayPatients() {
  const cachedRef = useRef(loadCache());
  const [patients, setPatients] = useState<PatientQuestion[]>(cachedRef.current);
  const [loading, setLoading] = useState(cachedRef.current.length === 0);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async (silent = false) => {
    if (!hasToken()) {
      if (mountedRef.current) {
        setError("VITE_MONDAY_API_TOKEN is not set.");
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await fetchPatientQuestions();
      if (!mountedRef.current) return;
      setPatients(data);
      persistCache(data);
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : "Failed to load patient questions");
    } finally {
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refetch(cachedRef.current.length > 0);
    const id = setInterval(() => refetch(true), POLL_MS);
    return () => { mountedRef.current = false; clearInterval(id); };
  }, [refetch]);

  return { patients, loading, error, refetch };
}
