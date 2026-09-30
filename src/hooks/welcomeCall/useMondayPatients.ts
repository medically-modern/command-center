import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { COL, fetchGroupItems, fetchItemById, GROUPS, hasToken, writeDate } from "@/lib/welcomeCall/mondayApi";
import { mondayItemToPatient } from "@/lib/welcomeCall/mondayMapping";
import {
  applyPendingAdvances, groupScope, hasPendingAdvance, markPendingAdvance, scopeExceptPinned,
  sharedPendingAdvances,
} from "@/lib/shared/pendingAdvance";
import { addBusinessDaysIso, etToday } from "@/lib/masheke/etDate";
import { isExpedited } from "@/lib/shared/expedited";

const POLL_MS = 30_000;

/** The population this queue's claims are about (lib/shared/pendingAdvance).
 *  ⚠️ Scoped (2026-09-28): Final Confirm is the same board and item id, so an
 *  unscoped claim made here hid the patient from Final Confirm too. */
const WELCOME_CALL_SCOPE = groupScope(GROUPS.welcomeCall);
const LS_KEY = "wc-overlays";
const LS_CACHE_KEY = "wc-patients-cache";

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

export function useMondayPatients(
  injectedPatientId?: string | null,
  /** The deep-linked id when the link is PINNED (`pinnedDeepLinkId`), else null. */
  pinnedId?: string | null,
) {
  const cachedRef = useRef(loadCachedPatients());
  const [patients, setPatients] = useState<Patient[]>(cachedRef.current);
  const [loading, setLoading] = useState(cachedRef.current.length === 0);
  // Blocks the page (full-screen overlay) from mount until this role's first
  // fetch lands. Unlike `loading`, it's always true on mount regardless of the
  // localStorage cache, and a background poll never re-raises it — so you can't
  // click a stale cached list before fresh Monday data arrives.
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // local-session overlay so UI edits persist without re-fetching from Monday
  const overlayRef = useRef<Map<string, Partial<Patient>>>(loadOverlays());

  // ⚠️ The board's OWN values, before any overlay is merged in — the thing
  // `clearOverlay` needs to put back on screen.
  //
  // Dropping an overlay entry is not the same as undoing its effect: the
  // rendered patient in `patients` was built by merging that overlay over the
  // board, so deleting it alone leaves every edited field exactly as the rep
  // left it until a refetch happens to land. Reset says "cleared local edits"
  // and then a Send in that window writes the very edits it claims to have
  // discarded — and if the refetch FAILS there is no window, just the wrong
  // values (Greptile, PR #57). Keeping the pre-overlay copy makes the revert
  // synchronous and independent of the network.
  const baseRef = useRef<Map<string, Patient>>(new Map());

  const mountedRef = useRef(true);

  // Patients hidden optimistically because a send advanced them out of this
  // group (id → when). Reconciled against the board on every poll — see
  // lib/shared/pendingAdvance. In memory on purpose: a reload is a fresh read.
  // ⚠️ The SHARED claim map (2026-09-25) — module state, so an advance made
  // here still hides the patient on the Care Coordinator dashboard and after
  // this page unmounts. See `sharedPendingAdvances`' comment for the Keith
  // Dye measurement that forced it.
  const pendingAdvanceRef = useRef(sharedPendingAdvances);
  // ⚠️ A PINNED deep link (`?pin=1` — opened from Pipeline Oversight or Search,
  // lib/shared/managerOrigin) is shown whatever this browser hid: injected,
  // kept at commit, never dropped by markAdvanced (Mary Mathis, 2026-09-28).
  const pinnedRef = useRef(pinnedId ?? null);
  useEffect(() => { pinnedRef.current = pinnedId ?? null; }, [pinnedId]);

  // Patients we've already stamped with an arrival Follow Up Date this session
  // (see the backfill in refetch) — stops us re-writing the same one each poll.
  const stampedRef = useRef<Set<string>>(new Set());

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
      const items = await fetchGroupItems(undefined);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      const ps = safeItems.map(mondayItemToPatient);

      // ── Follow Up Date backfill: a new arrival is TOMORROW's work ──
      // Josh, 2026-09-22: "when patient arrives, should only show up tomorrow."
      // Welcome Call items are created by the Insurance hop (automation
      // 7918324247), which writes no Follow Up Date — and this queue buckets on
      // that date (welcomeCall/sidebarList.isWelcomeCallSnoozed), where a blank
      // counts as DUE. So every patient the Insurance board finished landed in
      // the rep's list and the role bar the same minute, and the bar grew as
      // fast as Insurance worked. The first Welcome Call page to see them now
      // stamps the next business day.
      //
      // ⚠️ THE DATE ONLY — the Follow Up STATUS column is deliberately NOT
      // written. The status means "a rep put this patient off"; an arrival is
      // nobody's judgement, and writing it would file them under Follow Up in
      // the sidebar and read as Paused on the profile badge (§5.18). Submit
      // Auth stamps its Follow Up Date the same way and for the same reason.
      //
      // ⚠️ Fires on a BLANK date only, so it can never move a date a rep or
      // the +1 button chose. On the day this shipped that was the 5 live
      // patients carrying no date at all; they slide one day, once.
      //
      // ⚠️ EXPEDITED ARRIVALS ARE DUE TODAY (§5.56) — a manager's mark from
      // Profile Send Off, copied forward by the hops. Skipping this very wait
      // is what the mark is for.
      const arrivalStr = addBusinessDaysIso(etToday(), 1);
      const sameDayStr = etToday();
      for (const p of ps) {
        if (!p.followUpDate && !stampedRef.current.has(p.id)) {
          stampedRef.current.add(p.id);
          const dueStr = isExpedited(p.expedited) ? sameDayStr : arrivalStr;
          p.followUpDate = dueStr; // reflect locally right away
          writeDate(p.id, COL.followUpDate, dueStr).catch(() => {
            stampedRef.current.delete(p.id); // retry on the next poll
          });
        }
      }

      for (const p of ps) baseRef.current.set(p.id, p);
      const merged = ps.map((p) => {
        const o = overlayRef.current.get(p.id);
        return o ? { ...p, ...o } : p;
      });

      // ⚠️ A deep link is exempt from this group's queue rules but NOT from an
      // advance made this session — re-injecting a patient we just hid hands
      // back the live Send button the hide exists to take away.
      if (
        injectedPatientId &&
        (pinnedRef.current === injectedPatientId ||
          !hasPendingAdvance(pendingAdvanceRef.current, WELCOME_CALL_SCOPE, injectedPatientId)) &&
        !merged.some((p) => p.id === injectedPatientId)
      ) {
        try {
          const item = await fetchItemById(injectedPatientId);
          if (item) {
            const injected = mondayItemToPatient(item);
            baseRef.current.set(injected.id, injected);
            const o = overlayRef.current.get(injected.id);
            merged.unshift(o ? { ...injected, ...o } : injected);
          }
        } catch { /* ignore */ }
      }

      // ⚠️ Hide at the POINT OF COMMIT, not where the list was built: everything
      // in between is an await during which a send can resolve, and a list
      // filtered earlier would put that patient — Send button and all — back on
      // screen (Greptile, PR #54).
      const visible = applyPendingAdvances(
        merged, pendingAdvanceRef.current, scopeExceptPinned(WELCOME_CALL_SCOPE, pinnedRef.current),
      );
      setPatients(visible);
      persistPatientCache(visible);
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
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refetch(cachedRef.current.length > 0);
    const id = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch]);

  // Local-only update — used by UI handlers. Does NOT write to Monday;
  // call writeStatusIndex from mondayApi for that.
  const update = useCallback((id: string, patch: Partial<Patient>) => {
    overlayRef.current.set(id, { ...(overlayRef.current.get(id) ?? {}), ...patch });
    setPatients((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        return { ...p, ...patch, lastUpdated: new Date().toISOString() };
      }),
    );
  }, []);

  /**
   * Drop this patient's local edits AND put the board's values back on screen.
   *
   * ⚠️ The second half is not a nicety. `patients` holds the MERGED patient, so
   * deleting the overlay changes nothing that is rendered — the rep's edits stay
   * up until a refetch lands, and a Send in that window writes exactly the edits
   * Reset claimed to discard. A failed refetch makes it permanent. Reverting
   * from `baseRef` makes Reset synchronous and true regardless of the network;
   * the caller's `refetch()` is then belt-and-braces rather than the mechanism.
   *
   * A patient with no base entry (never seen in a fetch) is left alone: there is
   * nothing truer to show them, and blanking would invent data.
   */
  const clearOverlay = useCallback((id: string) => {
    overlayRef.current.delete(id);
    removeOverlay(id);
    const base = baseRef.current.get(id);
    if (!base) return;
    setPatients((prev) => prev.map((p) => (p.id === id ? base : p)));
  }, []);

  /** Reset's entry point — the name every stage page's Reset calls
   *  (`resetDiscardsEdits.test.ts`). Here it IS `clearOverlay`: this stage's
   *  send always advances the patient off screen, so restoring the board copy
   *  after a send is never seen, and one function serves both. The other hooks
   *  keep the two apart, because their sends can leave a patient in the queue. */
  const discardEdits = clearOverlay;


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


  /** A send advanced this patient off the stage — take them off screen now
   *  rather than leaving them in the queue with a live Send button until the
   *  next poll AND the Monday automation that moves the item. Display only: the
   *  board still decides, and the poll brings them back if nothing moved. */
  const markAdvanced = useCallback((id: string) => {
    markPendingAdvance(pendingAdvanceRef.current, WELCOME_CALL_SCOPE, id);
    if (id !== pinnedRef.current) setPatients((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { patients, loading, initialLoading, error, refetch, update, markAdvanced, clearOverlay, discardEdits, saveOverlay, hasOverlay };
}
