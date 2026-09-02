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
 *  1. **One request per BATCH, not per row**, and the first stop is Postgres.
 *     `resolveNames` asks the gateway's patient directory — a daily-refreshed
 *     copy of number → name — and falls back to Monday only for what it didn't
 *     know. The Monday half still batches 100 numbers into a single `any_of`
 *     rule across all seven boards in one aliased request, so even a cold
 *     directory costs a handful of requests rather than one per row.
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
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { resolveNames } from "@/lib/commsHub/directoryApi";

/**
 * Numbers per Monday request. `any_of` takes three digit shapes each, so 100
 * keys is 300 compare values across seven aliased boards.
 *
 * Verified against the live API 2026-09-02 at exactly this size: one request,
 * 300 compare values, every known number resolved. It was 60, which turned a
 * 900-conversation inbox into 15 round trips.
 */
const BATCH = 100;

/**
 * Batches in flight at once.
 *
 * ⚠️ This is not the incident's shape and the distinction is the whole point:
 * INCIDENT_2026-08-20 was ~1,166 requests per SECOND from one browser, growing
 * with the list. This is at most three, fixed, whatever the list holds. Running
 * them strictly one after another was over-cautious rather than safe — a
 * 900-row inbox took fifteen serial round trips, so names trickled in for
 * fifteen seconds and reps reported the list as slow.
 */
const CONCURRENCY = 3;

/**
 * Most numbers resolved in one pass — a brake, not a target.
 *
 * ⚠️ It used to be 500, which was LOWER than a real inbox: the Text tab shows
 * ~900 conversations, so 400 of them resolved to nothing and then waited for a
 * poll to change the list before the effect fired again. That is the "it takes
 * a really long time to load the names" report. At BATCH × CONCURRENCY this
 * ceiling is 15 requests in 5 waves, once per session.
 */
const MAX_PER_PASS = 1500;

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

/**
 * Resolve everything we don't already have an answer for.
 *
 * ⚠️ **`keys` must arrive in the order the LIST shows them**, because the
 * batches go out in that order and the cap trims the tail. Handing this the
 * sorted key list (as the hook briefly did) meant the cap dropped whichever
 * numbers happened to sort last — which is why every unresolved row in the
 * reported screenshot had an area code in the 700s–900s, and why the rows a rep
 * was actually looking at were not the ones that filled in first.
 */
async function run(keys: string[]): Promise<void> {
  // `new Set` preserves insertion order, so the list's order survives here.
  const todo = [...new Set(keys)].filter((k) => k.length === 10 && !known.has(k)).slice(0, MAX_PER_PASS);
  if (!todo.length) return;

  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) chunks.push(todo.slice(i, i + BATCH));

  // Workers pull chunks in order, so the top of the list is always in the first
  // wave and its names land within one round trip.
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const chunk = chunks[next++];
      if (!chunk) return;
      // Postgres first, Monday only for whatever it didn't know — on a warm
      // directory the second half usually doesn't run at all.
      const { ok, names } = await resolveNames(chunk);
      // ⚠️ Record the MISSES too — but ONLY on a read that actually happened.
      // Without the miss-caching every unmatched number is asked about again on
      // the next render that changes the list, forever; without the `ok` guard a
      // single Monday blip turns a batch of real patients into permanent bare
      // numbers.
      if (!ok) continue;
      for (const k of chunk) known.set(k, names.get(k) ?? "");
      // Emit per batch so names fill in as they land rather than all at the end.
      emit();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
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

  /**
   * ⚠️ The keys in LIST order, which is NOT what the signature below holds.
   * The signature is sorted so that a poll returning the same conversations in
   * a different order isn't treated as a new set; `run` needs the real order,
   * because it batches in order and the top of the list is what a rep is
   * looking at. Passing `signature.split(",")` to `resolve` conflated the two
   * and made the resolution order alphabetical by phone number.
   */
  const keysRef = useRef<string[]>(keys);
  // Declared FIRST, so it has already run by the time the effect below fires on
  // this render — effects run in declaration order.
  useEffect(() => {
    keysRef.current = keys;
  });

  // Value-compared dependency — see rule 3 in the header.
  const signature = useMemo(
    () => (enabled ? [...new Set(keys)].filter((k) => k && k.length === 10).sort().join(",") : ""),
    [keys, enabled],
  );
  useEffect(() => {
    if (!signature) return;
    resolve(keysRef.current);
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
