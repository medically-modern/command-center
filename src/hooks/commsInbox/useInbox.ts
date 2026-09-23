/**
 * The Communications inbox's shared state in the browser: whether the Inbox is
 * switched on, the list, the header badge — and the Monday copy of resolve
 * notes, which runs from here because it has to outlive whichever component
 * started it.
 *
 * Same rules as `hooks/commsHub/rcStore` (INCIDENT_2026-08-20_RINGCENTRAL.md
 * §8): one module-level store per read, a stable snapshot identity through
 * `useSyncExternalStore`, a TTL, and no polling at all from a hidden tab. The
 * difference is WHAT it reads — the gateway's Postgres, never RingCentral — so
 * a badge on every page for every rep costs one indexed query a minute each.
 *
 * ⚠️ The list and the badge are two views of ONE gateway snapshot (the list
 * response carries the badge counts), so every list load also feeds the badge:
 * the header and the tabs can never disagree about how many are open.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  claimMirror,
  fetchCommsConfig,
  fetchCommsState,
  fetchInbox,
  fetchInboxCount,
  fetchInboxItem,
  fetchOutbox,
  inboxConfigured,
  reportDialed,
  reportMirrorDone,
  reportMirrorError,
  type CommsConfig,
  type InboxQuery,
  type OutboxEntry,
} from "@/lib/commsInbox/api";
import { COMMS_NOTE_STAGE, commsNoteLine, type InboxItem, type InboxList } from "@/lib/commsInbox/rules";
import { appendNoteToRecord, fetchDossierItemsForPick } from "@/lib/commsHub/dossierApi";
import { pickActive } from "@/lib/commsHub/dossier";

/** The list is live: a rep watches it for new texts. */
export const LIST_TTL_MS = 30_000;
/** The badge rides on every page, so it is gentler. */
export const BADGE_TTL_MS = 60_000;
/** A failed config read is asked again after this. */
const CONFIG_RETRY_MS = 60_000;

const hidden = () => typeof document !== "undefined" && document.hidden;

/* ── tiny store helper ──────────────────────────────────────────────────── */

function createStore<S>(initial: S) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    set(next: S) {
      snapshot = next;
      for (const l of listeners) l();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/* ── the switch ─────────────────────────────────────────────────────────── */

type ConfigState = CommsConfig & { loaded: boolean };
const configStore = createStore<ConfigState>({ enabled: false, ui: false, loaded: false });
let configInflight: Promise<void> | null = null;
let configFailedAt = 0;

function loadConfig(): void {
  if (configInflight || configStore.get().loaded) return;
  if (configFailedAt && Date.now() - configFailedAt < CONFIG_RETRY_MS) return;
  if (!inboxConfigured()) {
    configStore.set({ enabled: false, ui: false, loaded: true });
    return;
  }
  configInflight = fetchCommsConfig()
    .then((c) => configStore.set({ ...c, loaded: true }))
    .catch(() => {
      // A failed read is "off, for now" — never a reason to show a half-built
      // Inbox. Asked again after a minute, not on every render.
      configFailedAt = Date.now();
    })
    .finally(() => {
      configInflight = null;
    });
}

/**
 * Report who dialed a number — the ONE entry point every Call button that dials
 * through the softphone uses (COMMS_INBOX_PLAN.md §4.6). The call log cannot
 * say who: the whole team is one RingCentral extension (§5.13b). It is what
 * makes *"We called · Katie"* on the timeline and an attributed *Called*
 * suggestion possible.
 *
 * Only while the module is on. If the switch has not been read yet — a dial on
 * a page that has just opened — it is read FIRST rather than guessed either way.
 * Best-effort: a dial is never held up by it.
 */
export function reportDial(number: string): void {
  if (!number) return;
  const c = configStore.get();
  if (c.loaded) {
    if (c.enabled) reportDialed(number);
    return;
  }
  loadConfig();
  void configInflight?.then(() => {
    if (configStore.get().enabled) reportDialed(number);
  });
}

/**
 * Is the Inbox switched on? `ui` false means every screen behaves exactly as it
 * did before the inbox existed (plan §8: additive first).
 */
export function useCommsConfig(): ConfigState {
  const state = useSyncExternalStore(configStore.subscribe, configStore.get, configStore.get);
  useEffect(() => {
    loadConfig();
  }, []);
  return state;
}

/* ── the badge ──────────────────────────────────────────────────────────── */

type Badge = { open: number; over: number } | null;
const badgeStore = createStore<{ counts: Badge; at: number }>({ counts: null, at: 0 });
let badgeInflight: Promise<void> | null = null;

function setBadge(counts: { open: number; over: number }): void {
  const prev = badgeStore.get().counts;
  // Same numbers → same identity, so nothing re-renders for a poll that
  // changed nothing (rule 2).
  if (prev && prev.open === counts.open && prev.over === counts.over) {
    badgeStore.set({ counts: prev, at: Date.now() });
    return;
  }
  badgeStore.set({ counts: { open: counts.open, over: counts.over }, at: Date.now() });
}

function refreshBadge(force = false): void {
  if (badgeInflight) return;
  if (!force && Date.now() - badgeStore.get().at < BADGE_TTL_MS) return;
  if (!force && hidden()) return;
  badgeInflight = fetchInboxCount()
    .then(setBadge)
    .catch(() => {
      // Quiet: a badge that cannot be read shows nothing rather than a stale
      // number. Backs off exactly as far as a success would.
      badgeStore.set({ counts: badgeStore.get().counts, at: Date.now() });
    })
    .finally(() => {
      badgeInflight = null;
    });
}

/** The unresolved count for the header — null until it is known. */
export function useInboxBadge(enabled: boolean): Badge {
  const state = useSyncExternalStore(badgeStore.subscribe, badgeStore.get, badgeStore.get);
  useEffect(() => {
    if (!enabled) return;
    refreshBadge();
    const id = setInterval(() => refreshBadge(), BADGE_TTL_MS);
    const onVisible = () => {
      if (!document.hidden) refreshBadge();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
  return enabled ? state.counts : null;
}

/* ── the list ───────────────────────────────────────────────────────────── */

interface ListState {
  sig: string;
  data: InboxList | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number;
}
const listStore = createStore<ListState>({ sig: "", data: null, loading: false, error: null, fetchedAt: 0 });
let listInflight: { sig: string; p: Promise<void> } | null = null;
let listQuery: InboxQuery | null = null;

const sigOf = (q: InboxQuery) => JSON.stringify([q.view, q.type, q.q.trim(), q.sort, q.sticky]);

function refreshList(force = false): Promise<void> {
  const q = listQuery;
  if (!q) return Promise.resolve();
  const sig = sigOf(q);
  const cur = listStore.get();
  if (listInflight && listInflight.sig === sig) return listInflight.p;
  const sameQuery = cur.sig === sig;
  if (!force && sameQuery && Date.now() - cur.fetchedAt < LIST_TTL_MS) return Promise.resolve();
  if (!force && sameQuery && hidden()) return Promise.resolve();

  // A NEW query keeps the previous rows on screen while it loads, so typing in
  // the search box does not flash an empty list.
  listStore.set({ ...cur, sig, loading: true });
  const p = fetchInbox(q)
    .then((data) => {
      // ⚠️ A slow answer to a query the rep has since changed must not paint
      // over the current one.
      if (!listQuery || sigOf(listQuery) !== sig) return;
      listStore.set({ sig, data, loading: false, error: null, fetchedAt: Date.now() });
      setBadge(data.badge);
    })
    .catch((e: unknown) => {
      if (!listQuery || sigOf(listQuery) !== sig) return;
      listStore.set({ ...listStore.get(), sig, loading: false, error: e instanceof Error ? e.message : String(e), fetchedAt: Date.now() });
    })
    .finally(() => {
      if (listInflight?.sig === sig) listInflight = null;
    });
  listInflight = { sig, p };
  return p;
}

/**
 * The list for one query. The component debounces the search box; every other
 * change (a tab, a chip, the sort) reads at once.
 */
export function useInboxList(query: InboxQuery, enabled: boolean) {
  const state = useSyncExternalStore(listStore.subscribe, listStore.get, listStore.get);
  const sig = sigOf(query);
  // The query in a ref, so the effect below depends on its SIGNATURE (a
  // string) and never on an object whose identity changes each render.
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    if (!enabled) return;
    listQuery = queryRef.current;
    void refreshList();
  }, [enabled, sig]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => void refreshList(), LIST_TTL_MS);
    const onVisible = () => {
      if (!document.hidden) void refreshList();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  const reload = useCallback(() => void refreshList(true), []);
  const current = state.sig === sig;
  return useMemo(
    () => ({
      data: state.data,
      // Rows for another query are still shown while this one loads; `stale`
      // says so, so the list can dim rather than claim they are this query's.
      stale: !current,
      loading: state.loading,
      error: current ? state.error : null,
      reload,
    }),
    [state, current, reload],
  );
}

/**
 * After a write (resolve, undo, note, link): read the list and the badge again
 * NOW rather than waiting out the TTL. The gateway invalidates its own snapshot
 * on every write, so the next read is already fresh.
 */
export function invalidateInbox(): void {
  void refreshList(true);
  refreshBadge(true);
}

/* ── one item ───────────────────────────────────────────────────────────── */

/**
 * One item, read when it is OPENED and when the rep (or a write) asks — never
 * on a timer of its own. The list polls; the workspace re-reads the open item
 * when its list row changes.
 *
 * ⚠️ The item is CLEARED before the next one loads, and a slow answer for the
 * previous key is dropped (`want`): the composer, the resolve bar and the note
 * all act on what is on screen, so holding one patient's item under another's
 * header is how a note lands on the wrong person (§5.28's rule).
 */
export function useInboxItem(key: string | null) {
  const [item, setItem] = useState<InboxItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const want = useRef<string | null>(null);

  const load = useCallback(async (k: string, spinner: boolean) => {
    want.current = k;
    if (spinner) setLoading(true);
    try {
      const out = await fetchInboxItem(k);
      if (want.current !== k) return;
      setItem(out);
      setError(null);
      setMoved(null);
    } catch (e: unknown) {
      if (want.current !== k) return;
      const err = e as { moved?: string | null; message?: string };
      setMoved(err?.moved ?? null);
      setError(err?.message || String(e));
    } finally {
      if (want.current === k) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setItem(null);
    setError(null);
    setMoved(null);
    if (!key) {
      want.current = null;
      setLoading(false);
      return;
    }
    void load(key, true);
  }, [key, load]);

  const reload = useCallback(() => {
    if (want.current) void load(want.current, false);
  }, [load]);

  // ⚠️ Only ever the item for the key ASKED FOR. The effect above clears the
  // old one — but an effect runs after the render in which the key changed, so
  // for that one render the previous patient's item would come back under the
  // new selection, composer and all.
  return { item: item && item.key === key ? item : null, loading, error, moved, reload };
}

/**
 * The inbox key a number files under — what a Texts, Calls or VMs row opens
 * (COMMS_INBOX_PLAN.md §1.2: *"Any log row opens the same item detail as the
 * Inbox"*).
 *
 * One Postgres read per row opened (`/comms/state`), never polled; no
 * RingCentral. The gateway returns a key for ANY number — an unmatched one files
 * under the number itself — so a thread with somebody who has never texted us
 * still opens, with an empty timeline and the composer.
 *
 * ⚠️ The answer is bound to the number it was asked for, and read back only
 * while that is still the number: a key for the previous row must never open
 * under the next one.
 */
export function useItemKeyForNumber(phone: string): {
  key: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [got, setGot] = useState<{ phone: string; key: string | null; error: string | null; done: boolean }>({
    phone: "",
    key: null,
    error: null,
    done: true,
  });
  const [seq, setSeq] = useState(0);
  const want = useRef("");

  useEffect(() => {
    want.current = phone;
    if (!phone) return;
    setGot((g) => (g.phone === phone ? { ...g, done: false } : { phone, key: null, error: null, done: false }));
    fetchCommsState([phone]).then(
      (out) => {
        if (want.current === phone) setGot({ phone, key: out.key, error: null, done: true });
      },
      (e: unknown) => {
        if (want.current === phone) {
          setGot({ phone, key: null, error: e instanceof Error ? e.message : String(e), done: true });
        }
      },
    );
  }, [phone, seq]);

  const reload = useCallback(() => setSeq((n) => n + 1), []);
  const mine = got.phone === phone;
  return {
    key: phone && mine ? got.key : null,
    loading: !!phone && (!mine || !got.done),
    error: phone && mine ? got.error : null,
    reload,
  };
}

/* ── the Monday copy (plan §5.2–§5.4) ───────────────────────────────────── */

let flushing: Promise<void> | null = null;

/**
 * Copy this rep's uncopied resolve notes into the patients' Monday notes.
 *
 * Runs when a row stops being sticky — the rep opens another item or leaves the
 * Inbox — and when Communications opens, to catch up anything a closed tab left
 * behind. Coalesced: two triggers at once run one pass.
 *
 * ⚠️⚠️ CLAIM FIRST. The claim is a compare-and-set on the gateway, so two open
 * tabs can never both write a note; only the RESOLVER's browser is ever
 * offered one (`appendNoteToRecord` stamps the signed-in person's initials).
 *
 * ⚠️ A failed copy never un-resolves anything — the note is safe in the log —
 * and the toast names the patient, because by then the rep is on the next item.
 */
export function flushCommsOutbox(): Promise<void> {
  if (!inboxConfigured()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    let pending: OutboxEntry[] = [];
    try {
      pending = await fetchOutbox();
    } catch {
      return; // the next trigger asks again
    }
    for (const e of pending) await copyOne(e.resolutionId);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Test seam. */
export async function copyOne(resolutionId: string): Promise<"copied" | "skipped" | "failed" | "not-claimed"> {
  let claimed: OutboxEntry | null = null;
  try {
    claimed = await claimMirror(resolutionId);
  } catch {
    return "not-claimed";
  }
  if (!claimed) return "not-claimed";
  let patient = "this patient";
  try {
    if (!claimed.itemId || !claimed.itemBoard) {
      await reportMirrorDone(resolutionId, "none:unmatched");
      return "skipped";
    }
    const items = await fetchDossierItemsForPick({ itemId: claimed.itemId, boardId: claimed.itemBoard, name: "", phone: "" });
    patient = items.find((i) => i.itemId === claimed!.itemId)?.name || items[0]?.name || patient;
    // The LIVE record — the one Recent notes writes to. A completed item is
    // read-only in new code (§5.38), so a patient with no live record keeps
    // the note in the log only (plan §5.2).
    const live = pickActive(items);
    if (!live) {
      await reportMirrorDone(resolutionId, "none:no-live-record");
      return "skipped";
    }
    if (!live.notesColId) {
      await reportMirrorDone(resolutionId, "none:no-notes-column");
      return "skipped";
    }
    const text = commsNoteLine({ how: claimed.how, note: claimed.note, resolvedAt: claimed.resolvedAt });
    await appendNoteToRecord({
      boardId: live.boardId,
      itemId: live.itemId,
      columnId: live.notesColId,
      columnType: live.notesColType,
      text,
      stage: COMMS_NOTE_STAGE,
      phone: live.phone,
    });
    await reportMirrorDone(resolutionId, `${live.boardId}:${live.itemId}`);
    return "copied";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await reportMirrorError(resolutionId, msg).catch(() => {});
    toast.error(`Resolved — couldn't copy your note on ${patient} to Monday: ${msg}`);
    return "failed";
  }
}

/** Test seam — resets the module stores between cases. */
export function __resetInboxStoresForTest(): void {
  configStore.set({ enabled: false, ui: false, loaded: false });
  configInflight = null;
  configFailedAt = 0;
  badgeStore.set({ counts: null, at: 0 });
  badgeInflight = null;
  listStore.set({ sig: "", data: null, loading: false, error: null, fetchedAt: 0 });
  listInflight = null;
  listQuery = null;
  flushing = null;
}
