/**
 * The search box's data source: one live Monday query per (debounced) query.
 *
 * Replaces "filter the 5,657-patient snapshot" as what answers the search box
 * — see `searchPatientsLive` for the measurements. Three rules here, each of
 * which is what makes "always up to date" true rather than aspirational:
 *
 * 1. **Latest wins.** Every keystroke after the debounce aborts the request
 *    in flight and bumps a generation counter; a response for an older query
 *    is dropped even if it arrives last. Without this, typing "jose del" then
 *    "jose delgado" can paint the broader result set over the narrower one.
 * 2. **Nothing is served from a cache.** There is no snapshot to fall back to;
 *    a failed request reports `error` and leaves the previous results on
 *    screen marked as such, rather than substituting older data.
 * 3. **Results on screen are re-fetched** every `REFRESH_MS` while a query is
 *    present and the tab is visible, silently. A rep who leaves a name up for
 *    ten minutes is otherwise looking at a ten-minute-old answer, and a live
 *    search costs ~200 complexity — cheaper than one page of the old download.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  liveSearchRules,
  searchPatientsLive,
  type SystemPatient,
} from "@/lib/systemMgmt/mondayApi";
import { rankLiveResults } from "./useSystemPatients";

export const LIVE_SEARCH_DEBOUNCE_MS = 300;
export const LIVE_SEARCH_REFRESH_MS = 45_000;

export interface LiveSearchState {
  /** Ranked rows for `searchedQuery`. Empty while nothing has been searched. */
  results: SystemPatient[];
  /** The query the current `results` answer — lags `query` while a search runs. */
  searchedQuery: string;
  /** A request for the CURRENT query is in flight (first fetch, not a refresh). */
  searching: boolean;
  /** The query is non-empty but below the minimum length — nothing was asked. */
  tooShort: boolean;
  /** The most recent request for the current query failed; `results` may be older. */
  error: string | null;
  /** Re-run the current query now (the page's Refresh button). */
  refresh: () => void;
}

export function useLiveSearch(query: string): LiveSearchState {
  const [results, setResults] = useState<SystemPatient[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const trimmed = query.trim();
  const rules = liveSearchRules(query);
  const tooShort = trimmed.length > 0 && rules === null;

  const run = useCallback(async (q: string, silent: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const gen = ++generation.current;
    if (!silent) {
      setSearching(true);
      setError(null);
    }
    try {
      const rows = await searchPatientsLive(q, controller.signal);
      if (gen !== generation.current) return; // superseded
      setResults(rankLiveResults(rows, q));
      setSearchedQuery(q);
      setError(null);
    } catch (e) {
      if (gen !== generation.current) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === generation.current) setSearching(false);
    }
  }, []);

  // Debounced search on every query change.
  useEffect(() => {
    if (!rules) {
      // Nothing to ask. Drop whatever was on screen — results for a query the
      // rep has deleted are not results for the one they are about to type.
      generation.current++;
      abortRef.current?.abort();
      setResults([]);
      setSearchedQuery("");
      setSearching(false);
      setError(null);
      return;
    }
    const t = setTimeout(() => void run(query, false), LIVE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `rules` is derived from `query`; depending on the string keeps the effect
    // keyed on what the rep typed rather than on a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, run]);

  // Silent refresh while a query sits on screen — see rule 3 above.
  useEffect(() => {
    if (!rules) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void run(queryRef.current, true);
    }, LIVE_SEARCH_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules !== null, run]);

  // Abort anything in flight on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const refresh = useCallback(() => {
    if (liveSearchRules(queryRef.current)) void run(queryRef.current, false);
  }, [run]);

  return { results, searchedQuery, searching, tooShort, error, refresh };
}
