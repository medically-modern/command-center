/**
 * Hook that fetches all patients across every board and provides
 * search + escalation filtering.
 *
 * Shows the cached snapshot immediately, then refreshes from Monday. ⚠️ While
 * that first live fetch is in flight the hook reports **`hydrating`**, and
 * callers must say so on screen: the cache is a head start, not an answer, and
 * a cross-board fetch takes ~15–20s (Profile Send Off alone is six sequential
 * 500-item pages). A page that renders cached data as if it were live tells a
 * rep "No patients found" about a patient who is simply not in the snapshot
 * yet — see `patientCache.ts` for the incident that made that concrete.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  fetchAllPatients,
  removeEscalation as apiRemoveEscalation,
  buildCompletionMap,
  type SystemPatient,
} from "@/lib/systemMgmt/mondayApi";
import { loadCachedPatients, persistPatientCache } from "@/lib/systemMgmt/patientCache";

const POLL_MS = 90_000; // refresh every 90s

export function useSystemPatients() {
  const [patients, setPatients] = useState<SystemPatient[]>([]);
  const [loading, setLoading] = useState(true);
  /** Showing a cached snapshot while the first live fetch is still running. */
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  /** Set once live data lands, so the async cache read can never overwrite it. */
  const liveLoadedRef = useRef(false);

  const refetch = useCallback(async (silent = false) => {
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const all = await fetchAllPatients();
      if (!mountedRef.current) return;
      liveLoadedRef.current = true;
      setPatients(all);
      setHydrating(false);
      setLoading(false);
      void persistPatientCache(all);
      setError(null);
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : String(e));
        // A failed refresh leaves whatever is on screen, but it is no longer
        // "about to be replaced" — keep the banner honest.
        setHydrating(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // The cache read is async (IndexedDB), so it races the live fetch. Whoever
    // wins, live data must stand: a cache landing second would roll Search back
    // to the older snapshot.
    void loadCachedPatients().then((cached) => {
      if (!mountedRef.current || liveLoadedRef.current || cached.length === 0) return;
      setPatients(cached);
      setLoading(false);
      setHydrating(true);
    });
    refetch(true);
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

  return { patients, escalated, completionMap, loading, hydrating, error, refetch, removeEscalation };
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
 * How well a patient matches, best first. `null` = no match at all.
 *
 * ⚠️ **The ranking is what makes the result cap safe.** Search renders only the
 * first 50 rows, and the raw filter returns patients in BOARD order (DTC Intake,
 * Secondary Claims, Subscription, Profile Send Off, …) then board position — so
 * before this existed, a patient's rank was decided by which board they sit on
 * and how deep, not by how well their name matched. `fuzzyMatch` is a loose
 * subsequence test, so "jose" matched 80 patients live — "Joseph …", "Jones
 * Steven", every name with j·o·s·e in order — and Jose Delgado, an exact
 * substring match on Profile Send Off (the 4th board, 1,700 rows deep in New
 * Form — Partial Leads), landed at **#55 and was never rendered**. Reported as
 * "he isn't in system-wide search"; nothing errored, and the full-name search
 * worked, which is what made it look like a data problem.
 *
 * Exact substring beats fuzzy, and a hit at the start of the name or of a word
 * beats one mid-word, so the people somebody actually typed the name of come
 * first regardless of board.
 */
const RANK_PHONE = 0;
/** The query is the whole name. */
const RANK_FULL_NAME = 1;
/**
 * The query is a whole WORD of the name — "jose" in "Jose Delgado".
 *
 * ⚠️ This rung is the one that fixes the reported bug, and a plain
 * "starts-with" test does not reach it: "jose" is also a prefix of "Joseph",
 * so Jose Delgado and 54 Josephs all scored identically and the tie fell back
 * to board order, leaving him at #55. A name somebody typed in full outranks a
 * name that merely begins with it.
 */
const RANK_WORD_EXACT = 2;
/** Prefix of the name, mid-word — "jose" in "Joseph McClellan". */
const RANK_NAME_PREFIX = 3;
/** Prefix of a later word — "smith" in "Rosemary Smithson". */
const RANK_WORD_PREFIX = 4;
/** Mid-word substring — "smith" in "Ladysmith Jones". */
const RANK_SUBSTRING = 5;
const RANK_FUZZY = 6;

function matchRank(
  p: SystemPatient,
  trimmed: string,
  isDigits: boolean,
  normalizedQuery: string,
): number | null {
  // Phone match: digit substring. First, because a rep typing digits means the
  // number — no name is going to be the better reading of "3475".
  if (isDigits && normalizedQuery.length >= 3) {
    if (normalizePhone(p.phone).includes(normalizedQuery)) return RANK_PHONE;
  }
  const name = p.name.toLowerCase();
  const q = trimmed.toLowerCase();
  // Exact substring match (works for any length)
  const at = name.indexOf(q);
  if (at >= 0) {
    const end = at + q.length;
    const startsWord = at === 0 || /\s/.test(name[at - 1]);
    const endsWord = end === name.length || /\s/.test(name[end]);
    if (at === 0 && endsWord) return RANK_FULL_NAME;
    if (startsWord && endsWord) return RANK_WORD_EXACT;
    if (at === 0) return RANK_NAME_PREFIX;
    return startsWord ? RANK_WORD_PREFIX : RANK_SUBSTRING;
  }
  // Fuzzy match only for queries with 3+ chars (avoids matching everything on 1-2 chars)
  if (trimmed.length >= 3 && fuzzyMatch(trimmed, p.name)) return RANK_FUZZY;
  return null;
}

/**
 * Order rows Monday has ALREADY matched, best first — and keep every one.
 *
 * The live search (`searchPatientsLive`) returns rows Monday matched by
 * `contains_text`, per word. `searchPatients` would DROP some of them: its
 * fuzzy fallback is a subsequence test, so "jose delgado" against
 * "Delgado, Jose" finds no rank and the row vanishes from a result set the
 * server just said it belongs in. Unmatched-locally rows rank last instead.
 */
export function rankLiveResults(
  patients: SystemPatient[],
  query: string,
): SystemPatient[] {
  const trimmed = query.trim();
  if (!trimmed) return patients;
  const isDigits = /^\d+$/.test(trimmed.replace(/[\s\-()]/g, ""));
  const normalizedQuery = normalizePhone(trimmed);
  const UNRANKED = RANK_FUZZY + 1;
  return patients
    .map((p, i) => ({ p, i, rank: matchRank(p, trimmed, isDigits, normalizedQuery) ?? UNRANKED }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((r) => r.p);
}

/**
 * Search patients by name (fuzzy) or phone (digit substring), best match first.
 */
export function searchPatients(
  patients: SystemPatient[],
  query: string,
): SystemPatient[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const isDigits = /^\d+$/.test(trimmed.replace(/[\s\-()]/g, ""));
  const normalizedQuery = normalizePhone(trimmed);

  const ranked: { p: SystemPatient; rank: number }[] = [];
  for (const p of patients) {
    const rank = matchRank(p, trimmed, isDigits, normalizedQuery);
    if (rank !== null) ranked.push({ p, rank });
  }
  // Stable sort, so within a rank the board order above is preserved — the
  // ordering reps are used to, just with the good matches lifted to the top.
  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.p);
}
