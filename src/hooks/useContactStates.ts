/**
 * useContactStates — one shared read of recent RingCentral activity, folded
 * into "who owes whom a reply" per patient number.
 *
 * Feeds the contact marks in the top-right of every manager-view patient
 * sidebar row. The marks are per-patient; the FETCH deliberately is not.
 *
 * ⚠️ **This is the shape that took the phone system down on 2026-08-20** — a
 * per-patient RingCentral lookup from a component that re-renders on every
 * patient switch, against a phone system shared by test and prod. So this hook
 * is a copy of `useFaxOutcomes` in structure, built to the same rules from
 * INCIDENT_2026-08-20_RINGCENTRAL.md §8:
 *
 * 1. **One request set, shared by every consumer.** The store lives at module
 *    scope, so forty mounted rows cost what one costs; a single `inflight`
 *    promise coalesces simultaneous mounts into one load; and both underlying
 *    reads are themselves page-capped.
 * 2. **The returned value is a stable reference** (rule 2 — "if a hook's return
 *    value goes in a dep array, that value must be memoized"). `useSyncExternal
 *    Store` hands back the module snapshot, whose identity changes only when
 *    the data does.
 * 3. **Nothing is fire-and-forget inside a render-driven effect.** The effect
 *    depends on `enabled` alone — a boolean, so it cannot change identity — and
 *    every path through `refresh()` returns early unless the TTL has expired.
 *
 * A failure is deliberately silent: no toast, no retry storm. The marks simply
 * don't render, which is what every sidebar showed before they existed.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  RC_VIA_GATEWAY,
  fetchRecentCallActivity,
  fetchRecentMessageActivity,
  mmPhoneNumber,
} from "@/lib/fax/ringcentralApi";
import {
  buildContactStates,
  type ContactState,
  type RcMessageRecord,
} from "@/lib/contactState/contactState";

export interface ContactStatesState {
  /** Number (last 10 digits) → state. Null until the first load lands. */
  states: Map<string, ContactState> | null;
  loading: boolean;
  /** Set when RingCentral couldn't be read. Callers render nothing. */
  error: string | null;
}

/**
 * The window the marks describe (Josh, 2026-09-01). One window for all four
 * situations, so "no marks" reliably means "nobody has touched this patient
 * this week" — and so "we called them" stays a fact about now rather than
 * something that goes true for every patient who has ever been worked.
 */
export const CONTACT_WINDOW_DAYS = 7;

/**
 * How long a load stays fresh. Deliberately long: this is a whole-week summary
 * shown to a manager scanning a queue, not a live thread, and each refresh is
 * up to ~18 RingCentral requests. Five minutes of staleness costs nothing a
 * manager would notice.
 */
const TTL_MS = 300_000;

const EMPTY: ContactStatesState = { states: null, loading: false, error: null };

let snapshot: ContactStatesState = EMPTY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: ContactStatesState) {
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Stable identity — see rule 2 in the header. */
function getSnapshot(): ContactStatesState {
  return snapshot;
}

/**
 * Load once per TTL. Every guard here is a brake:
 * no gateway → never call; already in flight → join it; still fresh → no-op;
 * tab hidden → wait until it's looked at again.
 */
function refresh(): Promise<void> {
  if (!RC_VIA_GATEWAY) return Promise.resolve();
  if (inflight) return inflight;
  if (Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  if (typeof document !== "undefined" && document.hidden) return Promise.resolve();

  emit({ ...snapshot, loading: true });
  // Both reads are awaited together rather than fired and forgotten — rule 3.
  inflight = Promise.all([
    fetchRecentMessageActivity({ days: CONTACT_WINDOW_DAYS }),
    fetchRecentCallActivity({ days: CONTACT_WINDOW_DAYS }),
  ])
    .then(([messages, calls]) => {
      fetchedAt = Date.now();
      emit({
        states: buildContactStates(messages as RcMessageRecord[], calls, {
          ownNumbers: [mmPhoneNumber()],
        }),
        loading: false,
        error: null,
      });
    })
    .catch((e: unknown) => {
      // Back off exactly as far as a success would: a failing RingCentral must
      // not be retried faster than a working one.
      fetchedAt = Date.now();
      emit({
        states: snapshot.states,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Recent contact per number. Safe to call from as many rows as you like — they
 * all read the same store and share one network load.
 *
 * `enabled` is the manager-view gate. When false NOTHING is fetched: a
 * processor working their own queue must not spend the account's RingCentral
 * budget on a column they can't see.
 */
export function useContactStates(enabled: boolean): ContactStatesState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    // Re-check while the page is open, TTL-guarded so the extra ticks are free.
    const id = setInterval(() => void refresh(), TTL_MS);
    // A hidden tab skips its polls, so by the time somebody looks again the
    // marks can be arbitrarily old. Refresh when the tab is looked at rather
    // than leaving it for the rest of the interval — still TTL-guarded, so
    // tabbing back and forth costs no extra requests.
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `enabled` is a boolean — it cannot change identity between renders, which
    // is the whole failure mode this file's header is about.
  }, [enabled]);
  return enabled ? state : EMPTY;
}

/** Test seam — resets the module store between cases. */
export function __resetContactStatesForTest(): void {
  snapshot = EMPTY;
  fetchedAt = 0;
  inflight = null;
  listeners.clear();
}
