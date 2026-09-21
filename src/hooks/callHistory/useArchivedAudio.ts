/**
 * useArchivedAudio — which of these calls do we still have the audio for.
 *
 * ⚠️ **Without this a playback fallback fixes nothing a rep can see.** An
 * aged-out call arrives from RingCentral's call log with no `recording` object
 * at all, so the Play and download buttons are never DRAWN — the screen looks
 * exactly as it did before the archive existed, and the bytes sit in the bucket
 * unreachable (CLAUDE.md §5.16, §5.47).
 *
 * Structured like `useDirectoryNames`, and for the same reasons — a
 * call-history panel renders for every patient a rep clicks through, so a
 * lookup per row is INCIDENT_2026-08-20's shape with a nicer name:
 *
 *  1. **One request per LIST, never per call.** The route it asks is
 *     Postgres-only, so unlike everything else on this panel it spends no
 *     RingCentral budget at all — but that is a reason it is allowed to exist,
 *     not a reason to call it carelessly.
 *  2. **Answers cached at module scope, misses included.** "We hold no audio
 *     for this call" is an ANSWER, and caching it is what stops a re-render
 *     re-asking about the same twenty calls.
 *     ⚠️ **A FAILED read is not a miss.** A gateway blip recorded as "no audio"
 *     would hide every Play button for the rest of the session, with nothing
 *     retrying and nothing erroring — `fetchArchivedAudio` reports `ok` for
 *     exactly this, and a failed batch is left unknown so the next open asks
 *     again. Same lesson as `fetchDirectoryNames`.
 *  3. **The effect's dependency is a STRING**, not the array (incident rule 2).
 *  4. **The returned record is the module snapshot**, so it is a stable
 *     reference and safe in a dep array (rule 2 again).
 *
 * ⚠️ There is deliberately **no TTL and no polling**. The answer changes only
 * when the archive stores a recording, which is a once-ever transition per
 * call; re-opening the panel in a new tab is a fresh session and asks again.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  archiveAvailable,
  fetchArchivedAudio,
  type ArchivedAudio,
} from "@/lib/callHistory/archivedRecordings";

/** callId → what the archive holds. An entry with `hasAudio: false` is a cached
 *  answer; an ABSENT entry means we have not asked, or asking failed. */
const known = new Map<string, ArchivedAudio>();
let snapshot: Record<string, ArchivedAudio> = {};
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  snapshot = Object.fromEntries(known);
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const getSnapshot = () => snapshot;

async function run(callIds: readonly string[]): Promise<void> {
  const todo = [...new Set(callIds)].filter((id) => id && !known.has(id));
  if (!todo.length) return;
  const { ok, audio } = await fetchArchivedAudio(todo);
  // ⚠️ Only a SUCCESSFUL read may record a miss — see rule 2.
  if (!ok) return;
  for (const id of todo) {
    known.set(
      id,
      audio[id] ?? { hasAudio: false, audioState: "unknown", contentType: null, bytes: null, durationSec: 0 },
    );
  }
  emit();
}

/**
 * ⚠️ Chained onto the previous promise's `finally`, not the promise itself.
 * `useDirectoryNames` records why: a `finally` on the OUTER promise nulls the
 * slot while the one behind it is still running, and the next call starts a
 * third alongside.
 */
function schedule(callIds: readonly string[]): void {
  const next = inflight ? inflight.then(() => run(callIds)) : run(callIds);
  inflight = next.finally(() => {
    if (inflight === next) inflight = null;
  });
}

export function useArchivedAudio(callIds: readonly string[]): Record<string, ArchivedAudio> {
  const key = useMemo(() => [...new Set(callIds)].filter(Boolean).sort().join(","), [callIds]);
  useEffect(() => {
    if (!archiveAvailable() || !key) return;
    schedule(key.split(","));
  }, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test seam — the module cache outlives a component, which is the point. */
export function __resetArchivedAudioCache(): void {
  known.clear();
  snapshot = {};
  inflight = null;
}
