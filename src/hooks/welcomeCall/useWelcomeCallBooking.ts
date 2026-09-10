/**
 * The open patient's welcome-call booking.
 *
 * ⚠️ This is a per-patient read of a shared, rate-limited upstream on a stage
 * page a rep works all day — INCIDENT_2026-08-20's shape — so it carries the
 * same guards `usePatientActivity` and `useFaxOutcomes` do:
 *
 *  · reads **on patient open, never on a timer**. No polling at all;
 *  · a module-scope cache keyed by the patient's address, so paging back to a
 *    patient is free and two mounts share one answer;
 *  · one in-flight request per address, coalesced;
 *  · a stable returned identity, so putting it in a dependency array is safe
 *    (incident rule 2);
 *  · a FAILURE is not cached, so re-opening the patient retries.
 *
 * The heavy lifting is on the gateway, which builds ONE window index and
 * answers every patient from it — so N patients opened in an afternoon cost
 * roughly one Calendly window, not N.
 */
import { useEffect, useRef, useState } from "react";

import {
  fetchWelcomeCallBooking,
  welcomeCallBookingAvailable,
  type WelcomeCallBooking,
} from "@/lib/welcomeCall/calendlyBooking";

/** Bookings are rare and the gateway caches its own index for far longer than
 *  this; the browser copy exists only so clicking between patients is free. */
const TTL_MS = 120_000;

interface Entry {
  at: number;
  booking: WelcomeCallBooking | null;
  error: string | null;
  through: string | null;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

function keyFor(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

async function load(email: string): Promise<Entry> {
  const key = keyFor(email);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    const res = await fetchWelcomeCallBooking(email);
    const entry: Entry = {
      at: Date.now(),
      booking: res.booking,
      error: res.error,
      through: res.through,
    };
    // ⚠️ Only a good read is cached. Caching a failure pins the chip at
    // "couldn't check" for two minutes after a blip, on every patient.
    if (res.ok) cache.set(key, entry);
    inflight.delete(key);
    return entry;
  })();

  inflight.set(key, p);
  return p;
}

export interface WelcomeCallBookingState {
  booking: WelcomeCallBooking | null;
  loading: boolean;
  /** Set when the lookup FAILED. `booking: null` with no error means the
   *  patient genuinely has nothing booked in the window. */
  error: string | null;
  /** True when the patient has no email on the board, so nothing was asked.
   *  ⚠️ Distinct from "not booked" — email is the only join Calendly gives us
   *  (`calendlyPatientRules.normalizeEmail` says why a name cannot be one), so
   *  an emailless patient is UNANSWERABLE rather than unbooked. */
  noEmail: boolean;
  /** False in a build with no gateway. */
  available: boolean;
  through: string | null;
}

export function useWelcomeCallBooking(email: string | undefined | null): WelcomeCallBookingState {
  const addr = (email ?? "").trim();
  const [state, setState] = useState<Omit<Entry, "at">>(
    () => ({ booking: null, error: null, through: null }),
  );
  const [loading, setLoading] = useState(false);
  /** Binds a slow answer to the patient who was open when it was asked for —
   *  the same rule `useDeliveryRecheck` needs, and for the same reason: a read
   *  resolving after a sidebar click would paint the PREVIOUS patient's
   *  appointment onto the one now on screen. */
  const want = useRef("");

  useEffect(() => {
    if (!addr || !welcomeCallBookingAvailable()) {
      want.current = "";
      setState({ booking: null, error: null, through: null });
      setLoading(false);
      return;
    }
    want.current = addr;
    setLoading(true);
    void load(addr).then((entry) => {
      if (want.current !== addr) return;
      setState({ booking: entry.booking, error: entry.error, through: entry.through });
      setLoading(false);
    });
  }, [addr]);

  const noEmail = !addr;

  return {
    booking: state.booking,
    loading,
    error: state.error,
    noEmail,
    available: welcomeCallBookingAvailable(),
    through: state.through,
  };
}
