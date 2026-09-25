/**
 * The search box's data source: one live Monday query per (debounced) query.
 *
 * Replaces "filter the 5,657-patient snapshot" as what answers the search box
 * — see `searchPatientsLive` for the measurements. Three rules here, each of
 * which is what makes "always up to date" true rather than aspirational:
 *
 * 1. **Latest wins.** Every keystroke — before the debounce, not after it —
 *    aborts the request in flight and bumps a generation counter; a response
 *    for an older query is dropped even if it arrives last. Without this,
 *    typing "jose del" then "jose delgado" can paint the broader result set
 *    over the narrower one, including during the 300ms the new query waits.
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
  /**
   * The query the current `results` answer — lags `query` while a search runs.
   * ⚠️ Always TRIMMED: callers ask `searchedQuery === query.trim()` to know the
   * answer on screen is for what was typed (see the hook body).
   */
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

export interface LiveSearchOptions {
  /**
   * Also match the boards' search FIELDS — member ids, doctor, clinic, doctor
   * phone, insurance, an order's identifiers (`fieldsLiteral`). The header
   * search sets it; System Management's search box and the Communications
   * hub's find-a-patient pane leave it off and are exactly what they were.
   */
  fields?: boolean;
}

export function useLiveSearch(query: string, opts: LiveSearchOptions = {}): LiveSearchState {
  const fields = !!opts.fields;
  const [results, setResults] = useState<SystemPatient[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ⚠️ Everything below runs on the TRIMMED text — the request, the refresh
     and `searchedQuery`. Both callers that read `searchedQuery` (System
     Management's Search and the Comms Hub's DossierSearch) decide "has THIS
     query been answered?" by comparing it with `query.trim()`. This hook used
     to store the raw text, so a name typed or pasted with a space on either end
     never compared equal: a search that found nobody sat on "Searching all
     boards…" with a spinner for ever instead of saying "No patients found",
     although Monday had answered in a second (reported 2026-09-24). Keying on
     the trimmed text also means a stray space neither re-asks Monday nor
     throws away an answer in flight. */
  const trimmed = query.trim();
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef(trimmed);
  queryRef.current = trimmed;

  const rules = liveSearchRules(trimmed);
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
      /* ⚠️ The NAME pass paints as soon as it lands, before the loose and
         same-number passes have run (§5.46b). Those two exist to catch a
         misspelling and a second spelling of a surname; waiting on them left
         the dropdown reading "Searching…" through up to three sequential round
         trips for the great majority of searches, which answer completely on
         the first. The merged set replaces this a moment later.
         ⚠️ Guarded by the SAME generation check as the final answer — a partial
         answer to a query the rep has typed past must not paint either. */
      const rows = await searchPatientsLive(
        q,
        controller.signal,
        (partial) => {
          if (gen !== generation.current) return;
          setResults(rankLiveResults(partial, q));
          setSearchedQuery(q);
          /* ⚠️ `searching` stays TRUE: rows are on screen and more may still
             arrive, and the spinner is the only thing saying so. Turning it off
             here would report a partial answer as the whole one. */
        },
        fields ? { fields: true } : undefined,
      );
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
  }, [fields]);

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
    // Invalidate NOW, not when the debounce fires: a request for the previous
    // query that resolves inside this 300ms window would otherwise still be
    // "current" and paint its (broader) answer under the new input. Aborting
    // here is also what keeps `searching` honest for the query on screen.
    generation.current++;
    abortRef.current?.abort();
    const t = setTimeout(() => void run(trimmed, false), LIVE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `rules` is derived from `trimmed`; depending on the string keeps the
    // effect keyed on what the rep typed rather than on a fresh object each
    // render — and on the TRIMMED string, so a stray space is not a new query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, run]);

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
