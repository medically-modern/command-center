/**
 * useDvsPatients — patients at the fully-automatic DVS stage
 * (HANDOFF-Josh-DVS.md v2). Fetches Insurance-board items whose Stage
 * Advancer = "DVS" (index 1) BOARD-WIDE — the DVS stage has no dedicated
 * group yet, so items stay wherever their group automation left them.
 *
 * Read-only monitor: no local overlay, no saves — the page just polls and
 * renders what the bot writes to the board.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/samantha/workflow";
import { fetchStageItems, fetchItemById, hasToken } from "@/lib/samantha/mondayApi";
import { mondayItemToPatient, STAGE_INDEX } from "@/lib/samantha/mondayMapping";

const POLL_MS = 30_000;

export function useDvsPatients(injectedPatientId?: string | null) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async (maybeSilent: unknown = false) => {
    const silent = maybeSilent === true;
    if (!hasToken()) {
      if (mountedRef.current) {
        setError("VITE_MONDAY_API_TOKEN is not set. Add it in your project env vars and rebuild.");
        setLoading(false);
        setInitialLoading(false);
      }
      return;
    }
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const items = await fetchStageItems(STAGE_INDEX.dvs);
      if (!mountedRef.current) return;
      const list = (Array.isArray(items) ? items : []).map(mondayItemToPatient);

      // Deep-linked patient (oversight drill-down) may have already left the
      // DVS stage — inject them individually so the link still lands.
      if (injectedPatientId && !list.some((p) => p.id === injectedPatientId)) {
        try {
          const item = await fetchItemById(injectedPatientId, true);
          if (item) list.unshift(mondayItemToPatient(item));
        } catch { /* patient may not be on this board */ }
      }

      setPatients(list);
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : "Failed to load patients from Monday");
    } finally {
      if (mountedRef.current) {
        if (!silent) setLoading(false);
        setInitialLoading(false);
      }
    }
  }, [injectedPatientId]);

  useEffect(() => {
    mountedRef.current = true;
    refetch(false);
    const id = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch]);

  return { patients, loading, initialLoading, error, refetch };
}
