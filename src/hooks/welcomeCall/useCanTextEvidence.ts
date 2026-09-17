/**
 * useCanTextEvidence — "have we ever exchanged a text with this number?", for
 * the Welcome Call Can Text auto-fill.
 *
 * Josh, 2026-09-17: *"if the number has received texts we should auto fill it as
 * yes"* / *"postgres only lookup, sure"*.
 *
 * ⚠️⚠️ **THIS IS A PER-PATIENT LOOKUP ON A STAGE PAGE — the exact shape of
 * INCIDENT_2026-08-20 — AND IT IS SAFE FOR ONE REASON ONLY: the gateway answers
 * it from Postgres and never touches RingCentral.** That is why it may run when
 * a patient is opened, where `usePatientActivity` beside it has to wait for a
 * rep to open a tab. If `/messaging/can-text` ever grows a RingCentral read,
 * this file's fetch policy has to change in the same commit.
 *
 * The incident's own rules still apply and none is optional:
 *  1. **One request per number, ever** — answers are cached at module scope,
 *     MISSES INCLUDED, so a rep clicking through a sidebar asks about each
 *     number once per session. There is no polling and no TTL: the evidence
 *     only ever gains "yes", so a stale answer can under-report and never
 *     mislead.
 *  2. **The returned value is memoized and the store is replaced, never
 *     mutated**, so a caller can put it in a dependency array without spinning.
 *  3. **`inflight` coalesces** simultaneous mounts asking about the same number.
 *  4. **A failure is NOT cached.** A throw leaves the numbers unset so the next
 *     patient open retries; caching it would freeze the auto-fill off for the
 *     rest of the session with nothing erroring (§5.28's `fetchDirectoryNames`
 *     lesson). It is also swallowed: this is an accelerator, and a rep who is
 *     simply asked the question has lost nothing.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchCanTextEvidence, messagingConfigured } from "@/lib/assignedPatients/messagingApi";
import type { CanTextEvidence } from "@/lib/welcomeCall/phoneSlots";

/** Digits, matching `fillCanTextFromEvidence`'s own key. */
const digits = (s: string) => String(s ?? "").replace(/\D/g, "");

/** digits → "yes", for numbers the archive has evidence for. Misses are stored
 *  as `false` so they are not asked about again. */
let store = new Map<string, boolean>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function emit(next: Map<string, boolean>) {
  store = next;
  for (const l of listeners) l();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getSnapshot() {
  return store;
}

async function load(numbers: string[]): Promise<void> {
  const want = numbers.filter((n) => digits(n) && !store.has(digits(n)) && !inflight.has(digits(n)));
  if (!want.length) return;
  const p = fetchCanTextEvidence(want)
    .then((results) => {
      const next = new Map(store);
      // ⚠️ Every number ASKED about is recorded, not just the hits — otherwise
      // a patient with no text history is re-asked on every render.
      for (const n of want) next.set(digits(n), false);
      for (const [n, v] of Object.entries(results)) {
        if (v === "yes") next.set(digits(n), true);
      }
      emit(next);
    })
    .catch(() => {
      /* Not cached — rule 4. Swallowed: the rep is asked, as before. */
    })
    .finally(() => {
      for (const n of want) inflight.delete(digits(n));
    });
  for (const n of want) inflight.set(digits(n), p);
  return p;
}

/**
 * @param numbers the slot numbers on screen. Pass `[]` to ask nothing.
 * @returns the shape `fillCanTextFromEvidence` and `canTextWasDerived` take.
 */
export function useCanTextEvidence(numbers: string[]): CanTextEvidence {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  /* ⚠️ A STRING dependency, never the array — incident rule 2. The caller
     rebuilds its slots on every keystroke, so an array identity here would
     re-run the effect on every character typed into a phone field. */
  const key = numbers.map(digits).filter(Boolean).sort().join(",");

  useEffect(() => {
    if (!messagingConfigured() || !key) return;
    void load(key.split(","));
  }, [key]);

  return useMemo(() => {
    const out: CanTextEvidence = {};
    for (const n of numbers) {
      if (map.get(digits(n))) out[n] = "yes";
    }
    return out;
    // `key` stands in for `numbers` deliberately (see above); `map` is a
    // replaced-not-mutated snapshot, so its identity is a real change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
}

/** Test seam — drops the module-scope cache. */
export function __resetCanTextEvidence() {
  inflight.clear();
  emit(new Map());
}
