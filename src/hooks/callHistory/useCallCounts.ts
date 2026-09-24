/**
 * useCallCounts — how many times we have called this patient and how many times
 * they have called us, from our own call archive (`lib/callHistory/callCounts`).
 *
 * ⚠️ **Read when the patient OPENS, never on a timer.** The route is
 * Postgres-only — it touches RingCentral not at all, which is the one reason a
 * per-patient read is allowed on a screen a rep clicks through (§5.31f makes the
 * same argument for Can Text). It is still one query per number per open, so:
 *
 *  1. **Every open re-reads, and the cache only PAINTS** (§5.45b's rule). A call
 *     made five minutes ago is in the archive within about a minute (the Inbox
 *     capture tick feeds it, §5.49), so a count cached for the session would be
 *     wrong exactly when a rep has just called somebody and looks.
 *  2. **One request per number at a time** — a remount while a read is out
 *     joins it rather than starting a second.
 *  3. ⚠️ **A FAILED read is not zero.** It is remembered only as "the last try
 *     failed", for the screen to say so, and the next open asks again. Caching
 *     it as an empty history would show "we have never called" for the rest of
 *     the session with nothing retrying (`fetchDirectoryNames`' lesson).
 *  4. **The effect's dependency is a STRING**, and the snapshot is a number, so
 *     nothing here can re-run on a fresh array (INCIDENT_2026-08-20 rule 2).
 *
 * ⚠️ **All or nothing across the patient's numbers.** With a primary and an
 * alternate, the counts appear only once BOTH have answered: a total drawn from
 * one of two numbers under-reports, and an under-report reads as a fact.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { archiveAvailable } from "@/lib/callHistory/archivedRecordings";
import {
  callNumberKey,
  countArchivedCalls,
  fetchArchivedCalls,
  fetchArchiveOldest,
  type ArchivedCallRow,
  type CallCounts,
} from "@/lib/callHistory/callCounts";

interface Entry {
  rows: ArchivedCallRow[];
  capped: boolean;
}

const entries = new Map<string, Entry>();
/** Keys whose LAST read failed. Display only — never a reason not to ask. */
const failedKeys = new Set<string>();
const inflight = new Map<string, Promise<void>>();
let oldest: string | null = null;
let oldestInflight: Promise<void> | null = null;

let version = 0;
const listeners = new Set<() => void>();
function emit() {
  version += 1;
  for (const l of listeners) l();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const getSnapshot = () => version;

function load(key: string, phone: string): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchArchivedCalls(phone)
    .then(({ rows, capped }) => {
      entries.set(key, { rows, capped });
      failedKeys.delete(key);
    })
    .catch(() => {
      // ⚠️ The previous answer, if any, stays on screen — it was true when it
      // was read, and a blip must not replace a real count with an error.
      failedKeys.add(key);
    })
    .finally(() => {
      inflight.delete(key);
      emit();
    });
  inflight.set(key, p);
  emit();
  return p;
}

function loadOldest(): void {
  if (oldest || oldestInflight) return;
  oldestInflight = fetchArchiveOldest()
    .then((iso) => {
      // Only a real answer is kept; null is asked again on the next open.
      if (iso) oldest = iso;
    })
    .finally(() => {
      oldestInflight = null;
      emit();
    });
}

export interface CallCountsView {
  /** false when there is nothing to ask — no gateway, or no usable number. */
  available: boolean;
  /** The counts, merged across the patient's numbers; null until every number
   *  has answered at least once. */
  counts: CallCounts | null;
  /** Calls with the ALTERNATE number alone (already inside `counts`). */
  altTotal: number;
  /** A read is out and there is nothing to paint yet. */
  loading: boolean;
  /** A number's read failed and there is no earlier answer to show for it. */
  failed: boolean;
  /** When our records begin (the archive's oldest call), or null. */
  since: string | null;
}

export function useCallCounts(primary: string, alternate = ""): CallCountsView {
  const pk = callNumberKey(primary);
  let ak = callNumberKey(alternate);
  if (ak === pk) ak = ""; // one number twice is one number
  const available = archiveAvailable() && !!pk;
  const keysSig = available ? `${pk}|${ak}` : "";

  useEffect(() => {
    if (!keysSig) return;
    const [p, a] = keysSig.split("|");
    void load(p, primary);
    if (a) void load(a, alternate);
    loadOldest();
    // ⚠️ Keyed on the digits, not on how the number is formatted: a reformat is
    // the same number and must not trigger a second read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig]);

  const v = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo<CallCountsView>(() => {
    if (!available) {
      return { available: false, counts: null, altTotal: 0, loading: false, failed: false, since: null };
    }
    const keys = ak ? [pk, ak] : [pk];
    const have = keys.map((k) => entries.get(k));
    const failed = keys.some((k, i) => !have[i] && failedKeys.has(k));
    const loading = !failed && have.some((e) => !e);
    let counts: CallCounts | null = null;
    let altTotal = 0;
    if (have.every(Boolean)) {
      const all = have.flatMap((e) => e!.rows);
      counts = countArchivedCalls(all, { capped: have.some((e) => e!.capped) });
      if (ak) altTotal = countArchivedCalls(entries.get(ak)!.rows).total;
    }
    return { available: true, counts, altTotal, loading, failed, since: oldest };
    // `v` is the store's version: every answer bumps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, available, pk, ak]);
}

/** Test seam — the store is module-scoped on purpose (it outlives a patient). */
export function __resetCallCountsForTests(): void {
  entries.clear();
  failedKeys.clear();
  inflight.clear();
  oldest = null;
  oldestInflight = null;
  version = 0;
}
