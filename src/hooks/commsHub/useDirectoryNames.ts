/**
 * useDirectoryNames — the patient name behind a phone number, for whole lists.
 *
 * The Communications Hub's Phone and Text lists used to show a bare number
 * whenever RingCentral had no contact for it, which is most patients: reps keep
 * offices and manufacturers in RingCentral, not the 6,000 people on our boards.
 * Josh, 2026-09-02: rely on RingCentral's contacts, and *"if it's just a number
 * we fall back to what's in our system"*.
 *
 * ⚠️ **CLAUDE.md §5.28 says not to resolve names per row, and it is still
 * right.** "One cross-board query per conversation on every poll" is the
 * INCIDENT_2026-08-20 shape. What makes this safe is that it is not that:
 *
 *  1. **One request per BATCH, not per row.** `fetchDirectoryNames` puts 60
 *     numbers into a single `any_of` rule and all seven boards into a single
 *     aliased GraphQL request. A 300-row list is ~5 requests.
 *  2. **Once per session, not per poll.** Every answer is cached at module
 *     scope, misses included — a number that is on no board is an ANSWER, and
 *     caching it is what stops the list re-asking about the same 200 unknown
 *     numbers every 30 seconds forever. Nothing here has a TTL for that reason:
 *     a patient's name does not change while a rep reads their texts.
 *     ⚠️ **A FAILED read is not a miss.** Monday 500s and 503s happen (§9
 *     records ten on 2026-09-01 alone); recording that batch as "on no board"
 *     would freeze 60 conversations at a bare phone number for the rest of the
 *     session, with nothing retrying and nothing erroring. `fetchDirectoryNames`
 *     reports `ok` for exactly this, and a failed chunk is left UNKNOWN so the
 *     next pass asks again.
 *  3. **The effect's dependency is a STRING, not an array** (incident rule 2 —
 *     "if a hook's return value goes in a dep array, that value must be
 *     memoized"). `keys.join(",")` compares by value, so a caller re-rendering
 *     with a freshly-built array does not re-fire the effect. Handing this hook
 *     an array dependency directly is exactly how the incident happened.
 *  4. **The returned Map is the module snapshot**, so it is a stable reference
 *     safe to put in a dep array (rule 2 again).
 *
 * A failure is silent by design: the rows keep showing numbers, which is what
 * they showed before this existed.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchDirectoryNames } from "@/lib/commsHub/dossierApi";

/** Numbers per Monday request. `any_of` takes three digit shapes each, so 60
 *  keys is 180 compare values — comfortably inside what the API accepts, and
 *  big enough that a typical list is one or two round trips. */
const BATCH = 60;

/**
 * Most numbers resolved in one pass. A bound, not a target: the Phone tab can
 * hold 600 calls and a rep only ever reads the top of it, so the cap keeps the
 * worst case at ~9 requests. Anything past it keeps showing its number and is
 * picked up on the next pass once the list changes.
 */
const MAX_PER_PASS = 500;

/** key → name. `""` means "looked up, on no board" — a cached answer, not a
 *  missing one. See rule 2 in the header. */
const known = new Map<string, string>();
/** The snapshot handed to React. Replaced (never mutated) so identity changes
 *  exactly when the data does. */
let snapshot: ReadonlyMap<string, string> = new Map();
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  snapshot = new Map(known);
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): ReadonlyMap<string, string> {
  return snapshot;
}

/** Resolve everything we don't already have an answer for, in batches, one
 *  batch at a time. Sequential rather than parallel on purpose: this is
 *  background enrichment for a list somebody is reading, and it must never
 *  become a burst against the account. */
async function run(keys: string[]): Promise<void> {
  const todo = [...new Set(keys)].filter((k) => k.length === 10 && !known.has(k)).slice(0, MAX_PER_PASS);
  if (!todo.length) return;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const { ok, names } = await fetchDirectoryNames(chunk);
    // ⚠️ Record the MISSES too — but ONLY on a read that actually happened.
    // Without the miss-caching every unmatched number is asked about again on
    // the next render that changes the list, forever; without the `ok` guard a
    // single Monday blip turns 60 real patients into permanent bare numbers.
    if (!ok) continue;
    for (const k of chunk) known.set(k, names.get(k) ?? "");
    // Emit per batch so names fill in as they land rather than all at the end.
    emit();
  }
}

function resolve(keys: string[]): void {
  // Chain rather than run alongside — two passes at once would double the
  // request rate for no benefit, and the second would mostly ask about numbers
  // the first is already resolving.
  //
  // ⚠️ The `finally` is attached to the CHAINED promise, and the previous one's
  // is not left to fire on its own. Reassigning `inflight` to a bare
  // `prev.then(...)` looks equivalent and is not: `prev`'s own `finally` would
  // still run when IT settled and null out `inflight` while the chained pass
  // was only just starting, so the very next call would see no pass in flight
  // and start a third one alongside — the doubled request rate this guard
  // exists to prevent.
  const prev = inflight;
  const started: Promise<void> = prev ? prev.then(() => run(keys)) : run(keys);
  const chained: Promise<void> = started
    .catch(() => {
      /* silent — see the header */
    })
    .finally(() => {
      // Only the newest pass may clear the slot; an older one settling must not
      // declare the queue empty.
      if (inflight === chained) inflight = null;
    });
  inflight = chained;
}

/**
 * Names for these numbers, as far as they are known yet.
 *
 * `keys` are last-10-digit contact keys. Pass the numbers the list is actually
 * showing; `enabled` should be false for a tab nobody is looking at, so a
 * closed tab costs nothing.
 */
export function useDirectoryNames(keys: string[], enabled = true): ReadonlyMap<string, string> {
  const names = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Value-compared dependency — see rule 3 in the header. The sort makes the
  // signature independent of list order, so re-sorting a list (a poll landing
  // in a different order) is not treated as a new set of numbers.
  const signature = useMemo(
    () => (enabled ? [...new Set(keys)].filter((k) => k && k.length === 10).sort().join(",") : ""),
    [keys, enabled],
  );
  useEffect(() => {
    if (!signature) return;
    resolve(signature.split(","));
  }, [signature]);
  return names;
}

/** Test seam — resets the module store between cases. */
export function __resetDirectoryNamesForTest(): void {
  known.clear();
  snapshot = new Map();
  inflight = null;
  listeners.clear();
}
