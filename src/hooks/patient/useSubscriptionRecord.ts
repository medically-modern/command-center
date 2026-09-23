/**
 * The full Subscription-board record for one item, so the patient screen's
 * Subscription → Profile tab can EDIT it (§5.45b).
 *
 * ⚠️⚠️ **THE POINT IS THE `Patient`, NOT THE COLUMNS.** The screen already has
 * this item through the Comms Hub dossier, but that read carries only the
 * columns `stageDetail`'s SUBSCRIPTION map names — a subset (§5.28). Handing a
 * subset to `sendPatientToMonday` is the §5.25 partial-record hazard, so the
 * edit path reads the board's own `READ_COLUMN_IDS` through the subscription
 * slice's own `fetchItemById` and maps it with the slice's own mapping. One
 * shape, one mapping, one writer — the same object `/subscription` sends.
 *
 * ⚠️ **Fetched on OPEN, never on a timer.** Every INCIDENT_2026-08-20 guard:
 * module-scope cache, one in-flight request per item, a `want` ref so a slow
 * answer cannot paint the previous patient's record into the open one, and a
 * FAILURE that is not cached so re-opening retries (§5.28's
 * `fetchDirectoryNames` lesson).
 *
 * ⚠️⚠️ **THE CACHE IS FOR PAINTING, NEVER FOR SENDING** (2026-09-23). It used
 * to be the answer: a hit on open meant no read at all, for the rest of the
 * session, and the send was built on it. The Subscription send writes every
 * board-mirrored column it holds — Next Order, Order Type, Subscription, the
 * infusion sets and their quantities, the auth statuses and ids, Doctor, NPI,
 * Secondary Insurance, Fax/Parachute — so a record read at 9 AM and sent at 3
 * PM put 9 AM's values back over anything /subscription, Welcome Call's hop or
 * another rep had written since, with a green toast. So a hit is SHOWN and then
 * re-read (`load`), and a send builds on `readFresh()` — a read issued at the
 * moment of the press, with only the rep's own edits laid over it. That is the
 * notes rule (`dossierApi.readNotesNow`) applied to a whole record: Monday has
 * no compare-and-set, so the base of a write is read immediately before it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchItemById } from "@/lib/subscription/mondayApi";
import { mondayItemToPatient } from "@/lib/subscription/mondayMapping";
import type { Patient } from "@/lib/subscription/workflow";

const cache = new Map<string, Patient>();
const inflight = new Map<string, Promise<Patient | null>>();

export function clearSubscriptionRecordCache(): void {
  cache.clear();
  inflight.clear();
}

export function useSubscriptionRecord(itemId: string, enabled: boolean): {
  patient: Patient | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  /** The record as the board holds it NOW — the only base a send may use.
   *  Bypasses the cache and any read in flight; throws when it cannot say. */
  readFresh: () => Promise<Patient>;
} {
  const [patient, setPatient] = useState<Patient | null>(() => cache.get(itemId) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const want = useRef(itemId);

  const load = useCallback(async (force = false) => {
    want.current = itemId;
    if (!itemId) {
      setPatient(null);
      return;
    }
    // A hit paints at once and is then RE-READ — shown, never trusted (see
    // the header). While it is on screen a failed re-read is not an error: the
    // form is still usable, and the send re-reads for itself regardless.
    const hit = force ? undefined : cache.get(itemId);
    if (hit) setPatient(hit);
    else {
      setLoading(true);
      setError("");
    }
    try {
      let p = inflight.get(itemId);
      if (!p || force) {
        p = fetchItemById(itemId).then((it) => (it ? mondayItemToPatient(it) : null));
        // ⚠️ The `finally` belongs to the CHAINED promise, or an older pass
        // clears the slot while the one behind it is still running (§5.28).
        p = p.finally(() => inflight.delete(itemId));
        inflight.set(itemId, p);
      }
      const rec = await p;
      if (rec) cache.set(itemId, rec);
      else cache.delete(itemId);
      // A slow answer for a patient the rep has already left is dropped.
      if (want.current === itemId) {
        setPatient(rec);
        if (!rec) setError("That item is no longer on the Subscription board.");
      }
    } catch (e) {
      // NOT cached — re-opening the tab retries rather than pinning it broken.
      if (want.current === itemId && !hit) setError(e instanceof Error ? e.message : String(e));
      else if (hit) console.warn("[useSubscriptionRecord] re-read failed; showing the cached record", e);
    } finally {
      if (want.current === itemId) setLoading(false);
    }
  }, [itemId]);

  const readFresh = useCallback(async (): Promise<Patient> => {
    // Deliberately NOT the in-flight dedupe: a read that started before the
    // rep pressed Send is exactly the staleness this exists to close.
    const it = await fetchItemById(itemId);
    const rec = it ? mondayItemToPatient(it) : null;
    if (!rec) {
      cache.delete(itemId);
      throw new Error("That item is no longer on the Subscription board.");
    }
    cache.set(itemId, rec);
    if (want.current === itemId) setPatient(rec);
    return rec;
  }, [itemId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  /** After a send — re-read the board rather than trusting the local edits. */
  const reload = useCallback(async () => {
    cache.delete(itemId);
    await load(true);
  }, [itemId, load]);

  return { patient, loading, error, reload, readFresh };
}
