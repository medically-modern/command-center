/**
 * The full board record behind an embedded stage panel (§5.39c).
 *
 * ⚠️⚠️ **THE DOSSIER'S COLUMNS ARE NOT ENOUGH, and the failure is silent.**
 * The patient screen already holds each item, but through the Comms Hub
 * dossier, whose read carries only the columns `stageDetail` names — a subset
 * (§5.28). A stage panel reads its slice's whole `Patient`, and `col()`
 * defaults a missing column to `""`, which is indistinguishable from a blank
 * board cell (§5.25). Handed a subset, `EvaluatePanel` would draw a patient
 * with no scripts, no coverage paths and no attempts — a plausible, wrong
 * audit. So each board is re-read at full width through its OWN
 * `fetchItemById` + `mondayItemToPatient`: one shape, one mapping, the same
 * object the live page renders.
 *
 * ⚠️ **The loader is passed in rather than switched on here**, because each
 * slice has its own `Patient` type and a `Record<boardId, loader>` in this file
 * would have to widen them all to `unknown` — which is exactly the type hole
 * that lets a subset through unnoticed. The caller names the board and gets
 * that board's type back.
 *
 * ⚠️ **Fetched only when a panel is actually OPEN.** A patient screen renders
 * four stepper cards; only the sub-stage a manager presses is read. Every
 * INCIDENT_2026-08-20 guard otherwise: module-scope cache keyed by item AND
 * loader, one in-flight request per key with the `finally` on the CHAINED
 * promise (§5.28), a `want` ref so a slow answer cannot paint the previous
 * patient's record into the open one, no timer of any kind, and a FAILURE that
 * is NOT cached so re-opening retries (§5.28's `fetchDirectoryNames` lesson).
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Reads one item at full width and maps it to that slice's `Patient`. */
export type StageLoader<T> = (itemId: string) => Promise<T | null>;

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

export function clearStageRecordCache(): void {
  cache.clear();
  inflight.clear();
}

export function useStageRecord<T>(
  /** Distinguishes two boards' reads of the same item id — never omit it. */
  scope: string,
  itemId: string,
  loader: StageLoader<T>,
  enabled: boolean,
): { record: T | null; loading: boolean; error: string } {
  const key = `${scope}:${itemId}`;
  const [record, setRecord] = useState<T | null>(() => (cache.get(key) as T | undefined) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const want = useRef(key);
  // Held in a ref so a caller passing an inline arrow cannot re-run the effect
  // on every render — incident rule 2, one component over.
  const load = useRef(loader);
  load.current = loader;

  const run = useCallback(async () => {
    want.current = key;
    if (!itemId) {
      setRecord(null);
      return;
    }
    const hit = cache.get(key) as T | undefined;
    if (hit) {
      setRecord(hit);
      return;
    }
    setLoading(true);
    setError("");
    try {
      let p = inflight.get(key);
      if (!p) {
        p = load.current(itemId);
        p = p.finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      const rec = (await p) as T | null;
      if (rec) cache.set(key, rec);
      if (want.current === key) {
        setRecord(rec);
        if (!rec) setError("That item is no longer on this board.");
      }
    } catch (e) {
      if (want.current === key) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (want.current === key) setLoading(false);
    }
  }, [key, itemId]);

  useEffect(() => {
    if (!enabled) return;
    void run();
  }, [enabled, run]);

  return { record, loading, error };
}
