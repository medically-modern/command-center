/**
 * useFaxOutcomes — one shared read of RingCentral's recent outbound faxes.
 *
 * Feeds the "Fax Bad" badge on every masheke patient header. The badge is
 * per-patient; the FETCH deliberately is not.
 *
 * ⚠️ **This is the shape that took the phone system down on 2026-08-20.** A
 * status lookup per patient, from a component that re-renders on every patient
 * switch, against a shared production phone system — that is precisely
 * INCIDENT_2026-08-20_RINGCENTRAL.md. So this hook is built to its rules:
 *
 * 1. **One request set, shared by every consumer.** The store lives at module
 *    scope; N mounted badges cost what one costs. A single `inflight` promise
 *    means simultaneous mounts coalesce into one fetch, and `fetchRecentOutbound
 *    Faxes` is itself capped at 3 requests.
 * 2. **The returned value is a stable reference** (rule 2 — "if a hook's return
 *    value goes in a dep array, that value must be memoized"). `useSyncExternal
 *    Store` hands back the module snapshot, whose identity changes only when the
 *    data does, so a caller listing it in a dep array cannot spin.
 * 3. **Nothing is fire-and-forget inside a render-driven effect.** The only
 *    effect runs on mount with `[]` deps, and every path through `refresh()`
 *    returns early unless the TTL has actually expired.
 *
 * A failure is deliberately silent: no toast, no retry storm. The badge simply
 * doesn't render, which is the same thing the app showed before it existed.
 */
import { useEffect, useSyncExternalStore } from "react";
import { RC_VIA_GATEWAY, fetchRecentOutboundFaxes } from "@/lib/fax/ringcentralApi";
import { buildFaxOutcomes, type FaxOutcome } from "@/lib/fax/faxOutcome";

export interface FaxOutcomesState {
  /** Number (last 10 digits) → latest outcome. Null until the first load lands. */
  outcomes: Map<string, FaxOutcome> | null;
  loading: boolean;
  /** Set when RingCentral couldn't be read. Callers render nothing rather than an error. */
  error: string | null;
}

/** How long a load stays fresh. RingCentral reports a fax verdict a median of
 *  11 minutes after the send, so a two-minute window is far tighter than the
 *  signal it carries — and it caps this hook at ~3 requests per 2 min per tab. */
const TTL_MS = 120_000;

const EMPTY: FaxOutcomesState = { outcomes: null, loading: false, error: null };

let snapshot: FaxOutcomesState = EMPTY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: FaxOutcomesState) {
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
function getSnapshot(): FaxOutcomesState {
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
  inflight = fetchRecentOutboundFaxes()
    .then((records) => {
      fetchedAt = Date.now();
      emit({ outcomes: buildFaxOutcomes(records), loading: false, error: null });
    })
    .catch((e: unknown) => {
      // Back off exactly as far as a success would: a failing RingCentral must
      // not be retried faster than a working one.
      fetchedAt = Date.now();
      emit({
        outcomes: snapshot.outcomes,
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
 * The latest fax outcome per number. Safe to call from as many components as
 * you like — they all read the same store and share one network load.
 */
export function useFaxOutcomes(): FaxOutcomesState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void refresh();
    // Re-check while the page is open — a fax sent minutes ago has usually not
    // reached its verdict yet. TTL-guarded, so the extra ticks cost nothing.
    const id = setInterval(() => void refresh(), TTL_MS);
    // A hidden tab skips its polls, so by the time somebody looks again the
    // badge can be arbitrarily old — a fax that has since failed shows nothing,
    // and one since re-sent still shows red. Refresh the moment the tab is
    // looked at rather than leaving that up for the rest of the interval.
    // Still TTL-guarded, so tabbing back and forth costs no extra requests.
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Mount-only. Nothing in this hook may depend on render-derived values.
  }, []);
  return state;
}

/** Test seam — resets the module store between cases. */
export function __resetFaxOutcomesForTest(): void {
  snapshot = EMPTY;
  fetchedAt = 0;
  inflight = null;
  listeners.clear();
}
