import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { fetchGroupItems, fetchItemById, writeDate, writeStatusIndex, COL, GROUPS, hasToken } from "@/lib/masheke/mondayApi";
// Note: GROUPS import kept for GROUPS.medicalNecessity
import { mondayItemToPatient, ESCALATION_INDEX } from "@/lib/masheke/mondayMapping";
import { hasStaleEvaluateEscalation } from "@/lib/masheke/evaluateReentry";
import { etToday } from "@/lib/masheke/etDate";

const POLL_MS = 30_000;
const LS_KEY = "mash-overlays";
// Namespaced per tab — a shared key would seed a freshly-mounted role page
// with the PREVIOUS role's patients until its first Monday fetch lands.
const LS_CACHE_KEY = "mash-patients-cache";
const cacheKey = (tab: TabKey) => `${LS_CACHE_KEY}:${tab}`;
// One-time cleanup of the pre-namespacing key — nothing reads it anymore and
// it holds a full patient snapshot (PHI) that would otherwise sit in
// localStorage forever.
try { localStorage.removeItem(LS_CACHE_KEY); } catch { /* ignore */ }

function loadCachedPatients(tab: TabKey): Patient[] {
  try {
    const raw = localStorage.getItem(cacheKey(tab));
    if (!raw) return [];
    return JSON.parse(raw) as Patient[];
  } catch { return []; }
}

function persistPatientCache(tab: TabKey, patients: Patient[]): void {
  try {
    localStorage.setItem(cacheKey(tab), JSON.stringify(patients));
  } catch { /* ignore */ }
}

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

function persistOverlays(map: Map<string, Partial<Patient>>): void {
  try {
    const obj: Record<string, Partial<Patient>> = {};
    map.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {
    // Storage full or unavailable
  }
}

function removeOverlay(id: string): void {
  try {
    const map = loadOverlays();
    map.delete(id);
    persistOverlays(map);
  } catch {
    // ignore
  }
}

export type TabKey = "evaluate" | "sendRequest" | "confirmReceipt" | "chase" | "doctorAppointments";

// Stage Advancer (color_mm1wyr92) text values that map to each tab.
const SUB_STAGE_FILTER: Record<TabKey, string> = {
  evaluate: "Evaluate MN",
  sendRequest: "Send Request",
  confirmReceipt: "Confirm Receipt",
  chase: "Chase Clinicals",
  // 2026-08-03. Being in this map also opts the stage into the Next Action Date
  // backfill below, which the outreach queue needs — a patient without a NAD
  // would be permanently "due" and re-called on every poll.
  doctorAppointments: "Doctor Appointment",
};

// Every tab — including Evaluate — now shows only its own stage.
// Deep-linked patients (via ?patientId=) are injected individually below.
function matchesTab(stageAdvancer: string | undefined, tab: TabKey): boolean {
  if (!stageAdvancer) return false;
  return stageAdvancer === SUB_STAGE_FILTER[tab];
}

export function useMondayPatients(activeTab: TabKey = "evaluate", injectedPatientId?: string | null) {
  // Lazy initializer — useRef would re-parse the whole cached list from
  // localStorage on every render just to throw it away.
  const [initialCache] = useState(() => loadCachedPatients(activeTab));
  const [patients, setPatients] = useState<Patient[]>(initialCache);
  // Patients currently in the Chase Clinicals stage — exposed separately for
  // the Evaluate sidebar's read-only viewer folder (never affects counts).
  const [chaseViewerPatients, setChaseViewerPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(initialCache.length === 0);
  // Blocks the page (full-screen overlay) from mount until THIS role's first
  // fetch lands. The cache is namespaced per tab, but it can still hold
  // patients who advanced off this stage since the last visit — a freshly
  // mounted page must not let you click them before Monday responds.
  // Unlike `loading`, this is always true on mount regardless of cache, and a
  // background poll never re-raises it.
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<Map<string, Partial<Patient>>>(loadOverlays());
  const mountedRef = useRef(true);
  // Patients we've already stamped with a Next Action Date this session.
  const stampedRef = useRef<Set<string>>(new Set());
  // Patients whose stale Evaluate-MN escalation we've already cleared this
  // session (the returning-patient self-heal below) — avoids re-writing each poll.
  const unescalatedRef = useRef<Set<string>>(new Set());

  const refetch = useCallback(async (maybeSilent: unknown = false) => {
    const silent = maybeSilent === true;
    if (!hasToken()) {
      if (mountedRef.current) {
        setError("VITE_MONDAY_API_TOKEN is not set. Add it in your project env vars and rebuild.");
        setLoading(false);
        setInitialLoading(false); // never leave the blocking overlay up over the error
      }
      return;
    }
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const items = await fetchGroupItems(GROUPS.medicalNecessity);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      const allPatients = safeItems.map(mondayItemToPatient);

      // ── Next Action Date backfill ──
      // Every patient in an active stage must have a Next Action Date (the
      // sidebar filters on NAD + sub-stage). New arrivals from Profile Send
      // Off land without one (the Profile board has no NAD column), so the
      // first masheke page to see them stamps NAD = today on Monday.
      // stampedRef prevents re-writing the same patient every poll.
      const todayStr = etToday();
      const activeStages = new Set(Object.values(SUB_STAGE_FILTER));
      for (const p of allPatients) {
        if (
          !p.nextActionDate &&
          p.subStage &&
          activeStages.has(p.subStage) &&
          !stampedRef.current.has(p.id)
        ) {
          stampedRef.current.add(p.id);
          p.nextActionDate = todayStr; // reflect locally right away
          writeDate(p.id, COL.nextActionDate, todayStr).catch(() => {
            stampedRef.current.delete(p.id); // retry on next poll
          });
        }
      }

      // ── Returning-patient self-heal (stale Evaluate-MN escalation) ──
      // A patient moved back to Evaluate MN for re-review can arrive still
      // carrying "Escalation Required" from a PRIOR stage (e.g. Chase Clinicals,
      // where Attempt 4+ escalates). That flag hides them from the rep — both
      // the sidebar and the burndown counts drop escalated patients — so they
      // read "Evaluate MN" everywhere yet never appear in the MN Evaluation
      // queue. The app-owned return path (Update Clinicals "Submit") clears the
      // flag itself, but a manual Monday move can't be intercepted at write
      // time; this catches those. Safe because Evaluate's own escalation only
      // fires at Evaluation Counter >= 3 (the 3rd-attempt SOP), so a counter < 3
      // escalation here is provably stale — hasStaleEvaluateEscalation.
      // Reset escalation → Done AND pull Next Action Date → today so they land
      // in the due-now list, not a hidden future/scheduled slot.
      // NOTE: we deliberately do NOT auto-clear a "Proposed Stuck" flag here —
      // a rep can legitimately propose-stuck FROM the Evaluate page, and there's
      // no counter-like safe signal to tell a stale proposal from a live one, so
      // clearing it on a poll could resolve a real proposal without the manager.
      // A proposed-stuck patient correctly stays in Oversight's Final Decisions
      // until a manager acts; the explicit return path (Update Clinicals Submit)
      // clears the proposal itself (returnToEvaluateVerified).
      for (const p of allPatients) {
        if (hasStaleEvaluateEscalation(p) && !unescalatedRef.current.has(p.id)) {
          unescalatedRef.current.add(p.id);
          p.escalation = "Done";       // reflect locally right away
          p.nextActionDate = todayStr; // due now, not scheduled
          Promise.all([
            writeStatusIndex(p.id, COL.escalation, ESCALATION_INDEX.done),
            writeDate(p.id, COL.nextActionDate, todayStr),
          ]).catch(() => {
            unescalatedRef.current.delete(p.id); // retry on next poll
          });
        }
      }

      // Filter to patients whose Stage Advancer matches this tab. A patient
      // with a pending stuck PROPOSAL leaves the stage queues immediately —
      // they sit in Pipeline Oversight's Final Decisions until the manager
      // approves (real Stuck) or returns them (proposal cleared).
      const filtered = allPatients.filter(
        (p) => matchesTab(p.subStage, activeTab) && !p.proposedStuck,
      );

      const merged = filtered.map((p) => {
        const o = overlayRef.current.get(p.id);
        return o ? { ...p, ...o } : p;
      });

      // Chase Clinicals viewer list — used by the Evaluate sidebar's
      // read-only "Chase Clinicals" folder. NOT part of `patients`, so it
      // never affects tab counts or the active list.
      const chase = allPatients
        .filter((p) => p.subStage === "Chase Clinicals" && !p.proposedStuck)
        .map((p) => {
          const o = overlayRef.current.get(p.id);
          return o ? { ...p, ...o } : p;
        });

      // Inject deep-linked patient if not in this group/stage (e.g. from Escalations)
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
      setChaseViewerPatients(chase);
      persistPatientCache(activeTab, merged);
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
    }
  }, [activeTab, injectedPatientId]);

  useEffect(() => {
    mountedRef.current = true;
    refetch(initialCache.length > 0);
    const id = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch, initialCache]);

  const update = useCallback((id: string, patch: Partial<Patient>) => {
    overlayRef.current.set(id, { ...(overlayRef.current.get(id) ?? {}), ...patch });
    setPatients((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        return { ...p, ...patch, lastUpdated: new Date().toISOString() };
      }),
    );
    // Keep the Chase Clinicals viewer list in sync too (Evaluate can edit
    // chase-stage patients opened from its sidebar folder).
    setChaseViewerPatients((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        return { ...p, ...patch, lastUpdated: new Date().toISOString() };
      }),
    );
  }, []);

  const clearOverlay = useCallback((id: string) => {
    overlayRef.current.delete(id);
    removeOverlay(id);
  }, []);


  const saveOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current.get(id);
    if (overlay) {
      const saved = loadOverlays();
      saved.set(id, overlay);
      persistOverlays(saved);
    }
  }, []);

  const hasOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current.get(id);
    return !!overlay && Object.keys(overlay).length > 0;
  }, []);


  return { patients, chaseViewerPatients, loading, initialLoading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay };
}
