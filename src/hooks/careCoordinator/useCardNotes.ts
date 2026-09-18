/**
 * The notes body for every card currently on screen, in one batched read.
 *
 * Brandon, 2026-09-17: the running case history should be OPEN on the card by
 * default, and "See notes" goes away with it. That turns notes from something
 * fetched once, on a click, into something every rendered card wants — so the
 * fetch has to be shared, batched and cached, or it is one Monday request per
 * patient per render (INCIDENT_2026-08-20's shape, against Monday rather than
 * RingCentral).
 *
 * Structurally a copy of `useDirectoryNames` (§5.28), which solves the same
 * problem for patient names, and it keeps the same four properties:
 *
 * 1. **One request per batch of ids**, never one per card — `fetchItemNotesBatch`.
 * 2. **Cached at module scope for the tab, MISSES INCLUDED.** A patient with an
 *    empty notes column is an ANSWER, and caching it is what stops the same
 *    empty patients being re-asked about on every poll, for ever. There is
 *    deliberately no TTL: a note added elsewhere during one sitting is not
 *    worth re-reading 1,700 rows for, and opening the patient shows it.
 * 3. ⚠️ **A FAILURE IS NOT CACHED.** Marking a failed read as a miss would pin
 *    those cards blank for the rest of the session with nothing erroring —
 *    exactly the `fetchDirectoryNames` lesson. They are simply retried on the
 *    next pass.
 * 4. ⚠️ **The effect's dependency is a STRING, not the id array** (incident
 *    rule 2): a fresh array identity every render would re-arm the effect every
 *    render. The returned Map is the module snapshot, so it is safe in a dep
 *    array too.
 *
 * ⚠️ Only the ids handed in are fetched, and the caller hands in the cards it
 * has actually RENDERED — the sections paginate at 12, so scrolling costs one
 * more request rather than the column costing 1,700.
 */
import { useEffect, useMemo, useState } from "react";

import { fetchItemNotesBatch } from "@/lib/careCoordinator/mondayApi";

/** `${columnId}:${itemId}` → the body. A cached entry may legitimately be "". */
const cache = new Map<string, string>();
/** One in-flight request per cache key, so two columns asking at once coalesce. */
const inflight = new Map<string, Promise<void>>();
/** Bumped whenever the cache gains anything, so mounted hooks re-render once. */
let version = 0;

const keyFor = (columnId: string, id: string) => `${columnId}:${id}`;

/** What the module knows right now, for the ids asked about. */
function snapshotFor(ids: readonly string[], columnId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const v = cache.get(keyFor(columnId, id));
    if (v !== undefined) out.set(id, v);
  }
  return out;
}

async function load(ids: string[], columnId: string): Promise<void> {
  const wanted = ids.filter((id) => !cache.has(keyFor(columnId, id)) && !inflight.has(keyFor(columnId, id)));
  if (!wanted.length) return;

  const run = (async () => {
    const answers = await fetchItemNotesBatch(wanted, columnId);
    for (const id of wanted) {
      // An id the batch didn't answer for is a miss, and a miss is an answer —
      // the item is gone, or carries nothing. Cached either way.
      cache.set(keyFor(columnId, id), answers.get(id) ?? "");
    }
    version += 1;
  })();

  for (const id of wanted) inflight.set(keyFor(columnId, id), run);
  try {
    await run;
  } catch {
    // Deliberately swallowed and deliberately NOT cached — see rule 3. Notes
    // are context for a call, so a failed read costs a coordinator a click on
    // the patient, never the page.
  } finally {
    for (const id of wanted) inflight.delete(keyFor(columnId, id));
  }
}

export function useCardNotes(ids: readonly string[], columnId: string): Map<string, string> {
  // The string IS the dependency (rule 4). Sorted so the same set in a
  // different order is not a new request.
  const signature = useMemo(() => [...ids].filter(Boolean).sort().join(","), [ids]);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!signature || !columnId) return;
    let alive = true;
    void load(signature.split(","), columnId).then(() => {
      if (alive) setTick(version);
    });
    return () => { alive = false; };
  }, [signature, columnId]);

  // Rebuilt only when the id set or the cache generation changes, so the
  // returned Map is stable between renders that changed neither.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => snapshotFor(signature ? signature.split(",") : [], columnId), [signature, columnId, version]);
}
