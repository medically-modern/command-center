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
 * ⚠️ **Fetched only when the tab is open AND the person may edit.** A rep
 * without `editProfile` never triggers it, so the read-only screen costs
 * exactly what it cost before. Every INCIDENT_2026-08-20 guard otherwise:
 * module-scope cache, one in-flight request per item, a `want` ref so a slow
 * answer cannot paint the previous patient's record into the open one, no
 * timer, and a FAILURE that is not cached so re-opening retries (§5.28's
 * `fetchDirectoryNames` lesson).
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
    if (!force) {
      const hit = cache.get(itemId);
      if (hit) {
        setPatient(hit);
        return;
      }
    }
    setLoading(true);
    setError("");
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
      // A slow answer for a patient the rep has already left is dropped.
      if (want.current === itemId) {
        setPatient(rec);
        if (!rec) setError("That item is no longer on the Subscription board.");
      }
    } catch (e) {
      // NOT cached — re-opening the tab retries rather than pinning it broken.
      if (want.current === itemId) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (want.current === itemId) setLoading(false);
    }
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

  return { patient, loading, error, reload };
}
