/**
 * All-time call and text counts for every card on the Care Coordinator page,
 * in one batched read (Brandon, 2026-09-24: *"can we connect this to how many
 * outbound calls in total have ever gone to the patient? and is that a huge
 * call that will get us blocked from rc on every page load?"*).
 *
 * It replaced `useContactStates(true)` on this page — a SEVEN-DAY RingCentral
 * window, so every patient nobody had touched this week read 0/0 however often
 * we had rung them before.
 *
 * ⚠️⚠️ **NOT A RINGCENTRAL READ — the answer to his second question.** The
 * gateway counts out of `call_archive` and `sms_archive` in Postgres
 * (`services/monday-gateway/contactTotalsRules.mjs`), so a page load costs the
 * phone account nothing. The read it replaced WAS RingCentral — up to ~18
 * requests per load, the call log in RingCentral's tightest HEAVY group — so
 * the page's RingCentral traffic went from that to zero.
 *
 * It still keeps INCIDENT_2026-08-20's rules, because "cheap" is not a licence
 * to be careless on a page a coordinator sits on all day:
 *
 * 1. **One request per batch of numbers**, never one per card — the gateway
 *    takes 200 at a time and the page asks for about a hundred.
 * 2. **Cached at module scope, keyed by the last ten digits**, with a TTL:
 *    counts change as calls are made, so unlike `useCardNotes` a cached answer
 *    goes stale. Re-asked every `TTL_MS`, and only while the tab is visible.
 * 3. ⚠️ **A failure is NOT cached**, so the next pass retries — marking a
 *    failed read as zero would print "nobody has rung this patient" as a fact.
 *    A number with no answer renders NO counters, which is what the card has
 *    always shown before its read lands.
 * 4. ⚠️ **The effect depends on a STRING** (incident rule 2), and the returned
 *    Map is rebuilt only when that string or the cache generation changes.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  fetchContactTotals,
  messagingConfigured,
  type ContactCoverage,
  type ContactTotals,
} from "@/lib/assignedPatients/messagingApi";

/** The gateway's own cap (`MAX_TOTALS_NUMBERS`). Chunked here, so a column
 *  that grows is more requests, never a refused one. */
export const TOTALS_BATCH = 200;

/**
 * How long an answer stands. Two minutes: the Communications inbox's capture
 * tick puts a call or a text into the archives within about a minute (§5.49),
 * so a count older than this can be missing the call the coordinator just
 * made. Each re-ask is one indexed Postgres read for the whole page.
 */
export const TOTALS_TTL_MS = 120_000;
const TICK_MS = 60_000;

/** The same key `contactState.contactKey` uses — the last ten digits. */
export const totalsKey = (raw: unknown): string => String(raw ?? "").replace(/\D/g, "").slice(-10);

interface Entry { totals: ContactTotals | null; at: number }
const cache = new Map<string, Entry>();
const inflight = new Set<string>();
let coverage: ContactCoverage | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const l of listeners) l();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const getVersion = () => version;

/**
 * Ask about every number in `phones` that has no fresh answer, in batches.
 * `phones` may repeat a number in several spellings — one is sent per key.
 */
async function load(phones: string[]): Promise<void> {
  if (!messagingConfigured()) return;
  const now = Date.now();
  const firstSpelling = new Map<string, string>();
  for (const p of phones) {
    const k = totalsKey(p);
    if (k.length !== 10 || firstSpelling.has(k) || inflight.has(k)) continue;
    const hit = cache.get(k);
    if (hit && now - hit.at < TOTALS_TTL_MS) continue;
    firstSpelling.set(k, p);
  }
  const wanted = [...firstSpelling.entries()];
  if (!wanted.length) return;

  for (const [k] of wanted) inflight.add(k);
  let changed = false;
  try {
    for (let i = 0; i < wanted.length; i += TOTALS_BATCH) {
      const chunk = wanted.slice(i, i + TOTALS_BATCH);
      try {
        const { results, coverage: cov } = await fetchContactTotals(chunk.map(([, spelled]) => spelled));
        if (cov) coverage = cov;
        const at = Date.now();
        for (const [k, spelled] of chunk) {
          // Absent from an ok answer means the gateway could not read the
          // number — cached as "no answer" for the TTL, so an unreadable
          // number is not re-asked on every tick.
          cache.set(k, { totals: results[spelled] ?? null, at });
        }
        changed = true;
      } catch {
        // ⚠️ NOT cached — rule 3. This chunk's numbers stay unanswered and are
        // retried on the next tick; the other chunks keep what they got.
      }
    }
  } finally {
    for (const [k] of wanted) inflight.delete(k);
  }
  if (changed) emit();
}

/**
 * Forget what we know about one number and ask again — for after a call is
 * placed or logged, when the count on the card is about to be wrong. Cheap:
 * one Postgres read on the next load.
 */
export function invalidateContactTotals(phone: string): void {
  const k = totalsKey(phone);
  if (!k || !cache.delete(k)) return;
  emit();
}

export interface ContactTotalsView {
  /** Last ten digits → totals. Absent = no answer yet (render nothing). */
  byNumber: Map<string, ContactTotals>;
  /** How far back the archives reach, for the card's "since" wording. */
  coverage: ContactCoverage | null;
}

export function useContactTotals(phones: readonly string[]): ContactTotalsView {
  // The string IS the dependency (rule 4). Sorted and de-duplicated, so the
  // same set in another order is not a new request.
  const signature = useMemo(
    () => [...new Set(phones.map((p) => (p ?? "").trim()).filter(Boolean))].sort().join("|"),
    [phones],
  );
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);

  useEffect(() => {
    if (!signature) return;
    const list = signature.split("|");
    void load(list);
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load(list);
    }, TICK_MS);
    const onVisible = () => {
      if (!document.hidden) void load(list);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `v` re-runs the load after an invalidation, which is what refreshes a
    // count the moment a call is logged rather than a minute later.
  }, [signature, v]);

  return useMemo(() => {
    const byNumber = new Map<string, ContactTotals>();
    if (signature) {
      for (const p of signature.split("|")) {
        const k = totalsKey(p);
        const hit = cache.get(k)?.totals;
        if (hit) byNumber.set(k, hit);
      }
    }
    return { byNumber, coverage };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, v]);
}

/** Test seam — resets the module store between cases. */
export function __resetContactTotalsForTest(): void {
  cache.clear();
  inflight.clear();
  coverage = null;
  version = 0;
  listeners.clear();
}
