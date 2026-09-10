/**
 * One Eastern day's welcome-call bookings, for the schedule grid.
 *
 * ⚠️ Behind each read sit one Calendly `/scheduled_events` call plus one
 * `/scheduled_events/{id}/invitees` call PER booking, against the same Calendly
 * account the patient intake form books through. That is a shared, rate-limited
 * upstream reached from a page a coordinator leaves open all day, which is the
 * shape of INCIDENT_2026-08-20. So this hook carries the same guards the other
 * shared-upstream hooks do:
 *
 *  · a module-scope cache, so several mounts (and a day paged back and forth)
 *    share one answer;
 *  · one in-flight request per day, coalesced;
 *  · **no polling** — it reads when the day changes and when the coordinator
 *    asks, never on a timer. A booking made in the last minute matters far
 *    less here than a page that quietly hammers Calendly;
 *  · a stable returned identity, so putting it in a dependency array is safe
 *    (incident rule 2).
 *
 * ⚠️ A FAILED read is not an empty day. `error` is surfaced so the grid can say
 * so — rendering a Calendly outage as "no calls booked" is the one answer a
 * coordinator acts on by not ringing anybody.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchCalendlyDay, calendlyDayAvailable, type CalendlyBooking } from "@/lib/careCoordinator/calendlyDay";

/** Long enough that paging a day back and forth is free, short enough that a
 *  booking made this morning is on screen well inside the reminder lead. */
const TTL_MS = 60_000;

interface Entry { at: number; bookings: CalendlyBooking[]; error: string | null }

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

async function load(date: string, force: boolean): Promise<Entry> {
  const hit = cache.get(date);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit;

  const running = inflight.get(date);
  if (running) return running;

  const p = (async () => {
    const res = await fetchCalendlyDay(date, ["welcome"]);
    const entry: Entry = { at: Date.now(), bookings: res.bookings, error: res.error };
    // ⚠️ Only a good read is cached. Caching a failure pins the grid empty for
    // a minute after a blip and makes Refresh look broken.
    if (res.ok) cache.set(date, entry);
    inflight.delete(date);
    return entry;
  })();

  inflight.set(date, p);
  return p;
}

export interface CalendlyDayState {
  bookings: CalendlyBooking[];
  loading: boolean;
  error: string | null;
  /** False in a build with no gateway — the grid says so rather than showing
   *  an empty welcome-call day it has no way to fill. */
  available: boolean;
  refetch: () => void;
}

export function useCalendlyDay(date: string, enabled: boolean): CalendlyDayState {
  const [state, setState] = useState<{ bookings: CalendlyBooking[]; error: string | null }>(
    () => ({ bookings: [], error: null }),
  );
  const [loading, setLoading] = useState(false);
  /** Guards against a slow read for a day the coordinator has already paged
   *  away from painting over the day they are now looking at — the same
   *  bind-to-what-was-open rule `useDeliveryRecheck` needs (§5.5). */
  const want = useRef("");

  const run = useCallback((force: boolean) => {
    if (!enabled || !date || !calendlyDayAvailable()) return;
    want.current = date;
    setLoading(true);
    void load(date, force).then((entry) => {
      if (want.current !== date) return;
      setState({ bookings: entry.bookings, error: entry.error });
      setLoading(false);
    });
  }, [date, enabled]);

  useEffect(() => {
    if (!enabled) { want.current = ""; setState({ bookings: [], error: null }); setLoading(false); return; }
    run(false);
  }, [run, enabled]);

  const refetch = useCallback(() => run(true), [run]);

  return {
    bookings: state.bookings,
    loading,
    error: state.error,
    available: calendlyDayAvailable(),
    refetch,
  };
}
