import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/mesheke/workflow";
import { fetchGroupItems, GROUPS, hasToken } from "@/lib/mesheke/mondayApi";
import { mondayItemToPatient } from "@/lib/mesheke/mondayMapping";

const POLL_MS = 30_000;

export type TabKey = "evaluate" | "sendRequest" | "confirmReceipt" | "chase";

// Stage Advancer (color_mm1wyr92) text values that map to each tab.
const SUB_STAGE_FILTER: Record<TabKey, string> = {
  evaluate: "Evaluate MN",
  sendRequest: "Send Request",
  confirmReceipt: "Confirm Receipt",
  chase: "Chase Clinicals",
};

// Evaluate tab is special: it shows patients in any of the four MN stages
// (Evaluate MN, Send Request, Confirm Receipt, Chase Clinicals) and groups them
// by stage in the sidebar. The other three tabs are scoped to their own stage only.
const EVALUATE_VISIBLE_STAGES: ReadonlySet<string> = new Set([
  "Evaluate MN",
  "Send Request",
  "Confirm Receipt",
  "Chase Clinicals",
]);

function matchesTab(stageAdvancer: string | undefined, tab: TabKey): boolean {
  if (!stageAdvancer) return false;
  if (tab === "evaluate") return EVALUATE_VISIBLE_STAGES.has(stageAdvancer);
  return stageAdvancer === SUB_STAGE_FILTER[tab];
}

export function useMondayPatients(activeTab: TabKey = "evaluate") {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      // Always pull from the single MN group, then filter by sub-stage
      const items = await fetchGroupItems(GROUPS.medicalNecessity);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      const allPatients = safeItems.map(mondayItemToPatient);

      // Filter to patients whose Stage Advancer matches this tab
      const filtered = allPatients.filter((p) => matchesTab(p.subStage, activeTab));

      const merged = filtered.map((p) => {
        const o = overlayRef.current.get(p.id);
        return o ? { ...p, ...o } : p;
      });
      setPatients(merged);
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : "Failed to load patients from Monday");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [activeTab]);

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
  }, []);

  return { patients, loading, error, refetch, update, clearOverlay };
}
