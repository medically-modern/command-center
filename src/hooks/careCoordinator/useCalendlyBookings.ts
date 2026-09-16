/**
 * One column's bookings — every patient's call OF ONE KIND, in ONE gateway
 * request (§5.30, §5.30d, §5.31e).
 *
 * Both columns of the Care Coordinator dashboard use this. Welcome calls exist
 * in Calendly and nowhere else; intake calls have a monday mirror that DROPS
 * bookings silently (it joins on the invitee's email inside the two DTC form
 * groups, §5.15), so Calendly is the source of truth for both and the mirror is
 * the intake column's fallback. It asks the gateway's `POST /calendly/patients`,
 * which answers a whole list from the shared window index it already keeps for
 * the per-patient chip — one round trip per column load, and no extra Calendly
 * reads however many patients are on screen.
 *
 * ⚠️ **`kind` is part of the identity of a read, not a filter over one.** Two
 * columns share this hook and the gateway's index holds both kinds, so the
 * module-scope coalescing key carries the kind — otherwise the intake column's
 * in-flight request would satisfy the welcome column's and each would render
 * the other's appointments.
 *
 * Incident guards (INCIDENT_2026-08-20), same as `useWelcomeCallBooking`:
 *  · the dependency is the SORTED, JOINED email list — a poll returning the
 *    same patients in a different order is not a new set (rule 2);
 *  · one in-flight request per set, coalesced;
 *  · re-asked only when the set changes, on the coordinator's Refresh, and on
 *    a slow timer matched to the gateway's own index TTL — that timer hits the
 *    gateway's cache, never Calendly;
 *  · a FAILURE is not cached and is surfaced: an empty map with `error` set
 *    must be rendered as "couldn't check", never as "nobody is booked".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchPatientBookings, welcomeCallBookingAvailable, type WelcomeCallBooking,
} from "@/lib/welcomeCall/calendlyBooking";
import type { BookingKind } from "@/lib/scheduledCalls/bookingLink";

/** The gateway rebuilds its window index every ten minutes; asking sooner
 *  returns the same answer. */
const RECHECK_MS = 10 * 60_000;

const EMPTY: ReadonlyMap<string, WelcomeCallBooking | null> = new Map();

/**
 * The dependency string's separator: a character no email address can contain.
 *
 * ⚠️ Written as an ESCAPE, never as a literal NUL byte. It was a literal one
 * from 2026-09-14 to 2026-09-16, which made this the only file in the repo git
 * and grep treated as BINARY — no diff, no `grep`, no review of any change to
 * it. Same value, same behaviour, readable source.
 */
const SEP = "\u0000";

let inflight: { key: string; p: Promise<void> } | null = null;

export interface CalendlyBookingsState {
  byEmail: ReadonlyMap<string, WelcomeCallBooking | null>;
  loading: boolean;
  /** Set when the LAST read failed. The map is then stale or empty. */
  error: string | null;
  /** False in a build with no gateway. */
  available: boolean;
  /**
   * The last day the gateway's window actually covered, or null.
   *
   * ⚠️ Load-bearing for the intake column: a mirror booking BEYOND this date is
   * outside what Calendly was asked about, so its absence from the answer is
   * not evidence that it was cancelled (`workflow.intakeBooking`, branch 5).
   */
  through: string | null;
  /**
   * Has THIS set of addresses been answered for?
   *
   * ⚠️ Not "a read has succeeded at some point". The caller renders Scheduled
   * off `byEmail`, so while this is false every patient looks unbooked and the
   * screen must say it is still checking (§5.30b's rule, one step earlier: a
   * read that has not finished is not "nobody is booked").
   */
  ready: boolean;
  refetch: () => void;
}

export function useCalendlyBookings(emails: string[], kind: BookingKind): CalendlyBookingsState {
  /** The addresses, normalised, deduped and SORTED — a poll returning the same
   *  patients in a different order is not a new set (incident rule 2). */
  const addresses = useMemo(
    () => Array.from(new Set(emails.map((e) => (e ?? "").trim().toLowerCase()).filter((e) => e.includes("@")))).sort().join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the STRING is the dependency, by design
    [emails.join(SEP)],
  );
  /**
   * What is being asked, in full — the kind AND the addresses.
   *
   * ⚠️ The kind belongs in here. Both columns share this hook and the module
   * scope below, so a key of addresses alone would let the intake column's
   * in-flight request satisfy the welcome column's and leave each rendering the
   * other's appointments.
   */
  const key = `${kind}|${addresses}`;
  const [byEmail, setByEmail] = useState<ReadonlyMap<string, WelcomeCallBooking | null>>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * WHICH set of addresses has been answered for — never a bare boolean.
   *
   * ⚠️ The board read lands first and the address list comes OUT of it, so this
   * hook is mounted with an empty list, takes the no-addresses branch below and would
   * latch a plain `ready` to true before a single address had been asked about.
   * The page then showed no "checking" state through the whole real read and
   * every booked patient sat in Unscheduled (found in a browser, 2026-09-16 —
   * reasoning about it had missed it). `ready` is per-KEY for the same reason
   * `useCalendlyDay.loaded` is per-DAY.
   */
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [through, setThrough] = useState<string | null>(null);
  const want = useRef(key);

  const run = useCallback(() => {
    if (!welcomeCallBookingAvailable()) return;
    want.current = key;
    if (!addresses) { setByEmail(EMPTY); setError(null); setReadyKey(key); setLoading(false); return; }
    if (inflight && inflight.key === key) return;
    setLoading(true);
    const p = fetchPatientBookings(addresses.split(","), kind).then((res) => {
      if (want.current !== key) return;
      if (res.ok) { setByEmail(res.bookings); setThrough(res.through); setError(null); setReadyKey(key); }
      else setError(res.error);
      setLoading(false);
    }).finally(() => { if (inflight?.key === key) inflight = null; });
    inflight = { key, p };
  }, [key, addresses, kind]);

  useEffect(() => {
    run();
    const id = setInterval(run, RECHECK_MS);
    return () => clearInterval(id);
  }, [run]);

  return { byEmail, loading, error, available: welcomeCallBookingAvailable(), ready: readyKey === key, through, refetch: run };
}
