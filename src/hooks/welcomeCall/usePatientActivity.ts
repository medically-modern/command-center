/**
 * usePatientActivity — the RingCentral history for ONE patient, fetched when a
 * rep actually opens it.
 *
 * Brandon, 2026-09-09: *"there should be a ring central activity box - where we
 * can toggle between texts, calls and voicemails"*, sitting near the top of the
 * Welcome Call screen.
 *
 * ⚠️ This is a per-patient RingCentral read hanging off a stage page, which is
 * the exact shape of INCIDENT_2026-08-20 (~1,166 req/sec from one browser, the
 * phone system down for the whole company). Four rules keep it safe, and none
 * is optional:
 *
 * 1. **Fetched on OPEN, never on render.** A Welcome Call header renders for
 *    every patient a rep clicks through; only the tab they actually look at is
 *    loaded. Same trade `CallHistoryButton` makes (§5.16).
 * 2. **One request per (phone, tab), ever.** Answers are cached at module
 *    scope, MISSES INCLUDED, and an `inflight` map coalesces simultaneous
 *    mounts of the same key. There is **no polling and no TTL**: a rep reading
 *    a thread mid-call does not need it re-fetched every 30 seconds, and the
 *    Refresh control is there for the one case that does.
 * 3. **The returned value is memoized**, so a caller putting it in a dep array
 *    cannot spin (incident rule 2).
 * 4. **A failure is not cached.** A throw leaves the key unset so opening the
 *    tab again retries; caching it would freeze the box empty for the rest of
 *    the session with nothing erroring (§5.28's `fetchDirectoryNames` lesson).
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  RC_VIA_GATEWAY,
  fetchVoicemails,
  fetchPatientCallHistory,
  type VoicemailRecord,
} from "@/lib/fax/ringcentralApi";
import { fetchConversation, type ConversationMessage } from "@/lib/assignedPatients/messagingApi";
import { toPatientCalls, type PatientCall } from "@/lib/callHistory/callHistory";
import { phoneIdentity } from "@/lib/welcomeCall/activityMatch";

export type ActivityTab = "texts" | "calls" | "voicemails";

export interface ActivityData {
  texts: ConversationMessage[];
  calls: PatientCall[];
  voicemails: VoicemailRecord[];
}

export interface ActivityState {
  /** Undefined until this (phone, tab) has been loaded. */
  data: Partial<ActivityData>;
  loading: boolean;
  error: string | null;
  /** Re-read this tab now, ignoring the cache. */
  reload: () => void;
}

type Key = string;
// ⚠️ Keyed on the full E.164 number — see `phoneIdentity`. A suffix key can
// hand one patient another patient's cached thread.
const keyOf = (phone: string, tab: ActivityTab): Key => `${phoneIdentity(phone)}::${tab}`;

let cache = new Map<Key, unknown>();
const errors = new Map<Key, string>();
const inflight = new Map<Key, Promise<void>>();
const listeners = new Set<() => void>();

function emit(next: Map<Key, unknown>) {
  cache = next;
  for (const l of listeners) l();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
/** Stable identity — the Map is replaced, never mutated. */
function getSnapshot() {
  return cache;
}

async function loadTab(phone: string, tab: ActivityTab): Promise<unknown> {
  // ⚠️ The GATEWAY route, not `fetchSmsConversation`. Two reasons, both
  // load-bearing: it passes `messageStatus`/`deliveryError` through verbatim,
  // which is the ONLY surface RingCentral's late "SendingFailed" verdict ever
  // reaches (§5.5) — a raw RC read carries neither, so a text that failed would
  // render here as an ordinary sent bubble — and it serves the Postgres SMS
  // archive, so it reaches past RingCentral's rolling ~30 days (§5.27).
  if (tab === "texts") return (await fetchConversation(phone)).messages;
  if (tab === "calls") return await fetchPatientCallHistory(phone);
  // ⚠️ Voicemail has NO per-number filter on this endpoint, so the read is
  // account-wide and narrowed here. Both sides go through `toE164`, so the
  // comparison is exact rather than a shared suffix: RingCentral returns E.164
  // and the board's value is normalised to it.
  const all = await fetchVoicemails({ sinceDays: 180 });
  const want = phoneIdentity(phone);
  return all.filter((v) => phoneIdentity(v.fromNumber) === want);
}

function load(phone: string, tab: ActivityTab, force: boolean): Promise<void> {
  const k = keyOf(phone, tab);
  // An unnormalisable number identifies nobody — do not fetch on a guess.
  if (!RC_VIA_GATEWAY || !phoneIdentity(phone)) return Promise.resolve();
  if (!force && cache.has(k)) return Promise.resolve();
  const running = inflight.get(k);
  if (running) return running;

  errors.delete(k);
  const p = loadTab(phone, tab)
    .then((rows) => {
      const next = new Map(cache);
      next.set(k, rows);
      emit(next);
    })
    .catch((e: unknown) => {
      // NOT cached — see rule 4. Recorded only so the box can say what failed.
      errors.set(k, e instanceof Error ? e.message : String(e));
      emit(new Map(cache));
    })
    .finally(() => {
      inflight.delete(k);
    });
  inflight.set(k, p);
  return p;
}

/**
 * @param phone   the patient's number
 * @param tab     which list is on screen
 * @param open    false while the box is collapsed — nothing is fetched at all
 */
export function usePatientActivity(phone: string, tab: ActivityTab, open: boolean): ActivityState {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const k = keyOf(phone, tab);
  const [, bump] = useState(0);

  useEffect(() => {
    // Dependencies are STRINGS and a boolean — never an object or an array
    // whose identity changes on render (incident rule 2).
    if (open) void load(phone, tab, false);
  }, [phone, tab, open]);

  const reload = useCallback(() => {
    void load(phone, tab, true).then(() => bump((n) => n + 1));
  }, [phone, tab]);

  return useMemo(() => {
    const rows = map.get(k);
    const data: Partial<ActivityData> = {};
    if (rows !== undefined) {
      if (tab === "texts") data.texts = rows as ConversationMessage[];
      else if (tab === "calls") data.calls = rows as PatientCall[];
      else data.voicemails = rows as VoicemailRecord[];
    }
    return {
      data,
      loading: open && rows === undefined && !errors.has(k),
      error: errors.get(k) ?? null,
      reload,
    };
  }, [map, k, tab, open, reload]);
}

/** Test seam — drops the module-scope cache. */
export function __resetPatientActivity() {
  errors.clear();
  inflight.clear();
  emit(new Map());
}
