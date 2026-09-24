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
import { COMMS_NOTE_STAGE, UNDO_WINDOW_MS, commsNoteLine, type InboxItem, type InboxList } from "@/lib/commsInbox/rules";
import { appendNoteToRecord, fetchDossierItemsForPick } from "@/lib/commsHub/dossierApi";
import { pickActive } from "@/lib/commsHub/dossier";

/** The list is live: a rep watches it for new texts. */
export const LIST_TTL_MS = 30_000;
/** The badge rides on every page, so it is gentler. */
export const BADGE_TTL_MS = 60_000;
/**
 * ⚠️ A poll's "last read" is stamped when the read RESOLVES, a few hundred ms
 * after the tick that asked for it, so a freshness gate of exactly one period
 * finds that read too fresh on the next tick and the poll quietly runs at TWICE
 * its period. Measured 2026-09-23 with a 300ms read: the list was read every
 * ~60s and the badge every ~120s. The slack lets a read that finished a little
 * late still count as due on the next tick.
 */
const POLL_SLACK_MS = 5_000;
/** A failed config read is asked again after this. */
const CONFIG_RETRY_MS = 60_000;
/**
 * An open tab re-reads the switch this often (Josh, 2026-09-23: *"make tabs
 * re-check every few minutes"*), so turning the Inbox on or off on the gateway
 * reaches a tab without a reload. It used to be read once per page load, which
 * is how a rep who opened Communications before the switch went on sat on the
 * old screens for the rest of the afternoon.
 */
export const CONFIG_RECHECK_MS = 3 * 60_000;
/**
 * How often the shared timer looks at whether a read is due. ⚠️ Deliberately
 * SHORTER than the period it serves: `configCheckedAt` is stamped when a read
 * RESOLVES, so a timer ticking at exactly `CONFIG_RECHECK_MS` would find the
 * last read a few milliseconds too fresh on every other tick and quietly run at
 * twice the stated period. Ticking each minute puts a re-check 3–4 minutes
 * apart, and a failed first read is retried on the same tick.
 */
const CONFIG_TICK_MS = CONFIG_RETRY_MS;

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
/** When the switch was last read successfully — what a re-check is timed from. */
let configCheckedAt = 0;

/**
 * Read the switch. The FIRST read happens whatever the tab is doing — a page
 * cannot decide which screens to draw without it, and `reportDial` waits on it.
 * After that it is re-read every `CONFIG_RECHECK_MS`, and only from a tab
 * somebody can see (INCIDENT_2026-08-20's rule: no polling from a hidden tab).
 */
function loadConfig(): void {
  if (configInflight) return;
  const loaded = configStore.get().loaded;
  if (loaded) {
    if (Date.now() - configCheckedAt < CONFIG_RECHECK_MS) return;
    if (hidden()) return;
  } else if (configFailedAt && Date.now() - configFailedAt < CONFIG_RETRY_MS) {
    return;
  }
  if (!inboxConfigured()) {
    // A build with no gateway has nothing to ask, now or later.
    if (!loaded) configStore.set({ enabled: false, ui: false, loaded: true });
    configCheckedAt = Date.now();
    return;
  }
  configInflight = fetchCommsConfig()
    .then((c) => {
      configCheckedAt = Date.now();
      configFailedAt = 0;
      const prev = configStore.get();
      // An answer that changes nothing keeps the snapshot's identity, so a
      // re-check every few minutes re-renders nothing (rule 2).
      if (prev.loaded && prev.enabled === c.enabled && prev.ui === c.ui) return;
      configStore.set({ enabled: c.enabled, ui: c.ui, loaded: true });
    })
    .catch(() => {
      configFailedAt = Date.now();
      // ⚠️ A failed FIRST read is "off, for now" — never a reason to show a
      // half-built Inbox. A failed RE-check keeps what the tab already had: a
      // network blip must not pull the Inbox out from under a rep mid-resolve,
      // nor put it up in front of one. The next re-check settles it.
      if (loaded) configCheckedAt = Date.now();
    })
    .finally(() => {
      configInflight = null;
    });
}

/**
 * ONE timer for the whole tab, however many components read the switch — the
 * header, the hub, the patient screen and Reports all do. It runs while any of
 * them is mounted, and a tab coming back into view re-reads a stale switch at
 * once rather than on the next tick.
 */
let configWatchers = 0;
let configTimer: ReturnType<typeof setInterval> | null = null;
function onConfigVisible(): void {
  if (!document.hidden) loadConfig();
}
function watchConfig(): () => void {
  configWatchers += 1;
  if (configWatchers === 1) {
    configTimer = setInterval(loadConfig, CONFIG_TICK_MS);
    document.addEventListener("visibilitychange", onConfigVisible);
  }
  return () => {
    configWatchers -= 1;
    if (configWatchers > 0) return;
    if (configTimer) clearInterval(configTimer);
    configTimer = null;
    document.removeEventListener("visibilitychange", onConfigVisible);
  };
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
 * did before the inbox existed (plan §8: additive first). Re-read every few
 * minutes while the tab is open (`CONFIG_RECHECK_MS`), so a switch flipped on
 * the gateway reaches the screen without a reload — the hub's rails already
 * follow it both ways (`AssignedPatientsPage`'s `[inboxOn]` effect).
 */
export function useCommsConfig(): ConfigState {
  const state = useSyncExternalStore(configStore.subscribe, configStore.get, configStore.get);
  useEffect(() => {
    loadConfig();
    return watchConfig();
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
  if (!force && Date.now() - badgeStore.get().at < BADGE_TTL_MS - POLL_SLACK_MS) return;
  if (!force && hidden()) return;
  badgeInflight = fetchInboxCount()
    .then(setBadge)
    .catch(() => {
      // Quiet: a badge that cannot be read KEEPS the last number it had rather
      // than dropping to nothing, which on a badge reads as "nothing open" — a
      // failed read is not an empty answer (§9). Backs off exactly as far as a
      // success would; the next read corrects it.
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
  /** The query last ASKED for — what `loading` and `error` are about. */
  sig: string;
  /** The query `data` ANSWERS. It trails `sig` while a new query loads, which
   *  is exactly the moment the rows on screen belong to the previous one. */
  dataSig: string;
  data: InboxList | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number;
}
const listStore = createStore<ListState>({ sig: "", dataSig: "", data: null, loading: false, error: null, fetchedAt: 0 });
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
  if (!force && sameQuery && Date.now() - cur.fetchedAt < LIST_TTL_MS - POLL_SLACK_MS) return Promise.resolve();
  if (!force && sameQuery && hidden()) return Promise.resolve();

  // A NEW query keeps the previous rows on screen while it loads, so typing in
  // the search box does not flash an empty list.
  listStore.set({ ...cur, sig, loading: true });
  const p = fetchInbox(q)
    .then((data) => {
      // ⚠️ A slow answer to a query the rep has since changed must not paint
      // over the current one.
      if (!listQuery || sigOf(listQuery) !== sig) return;
      listStore.set({ sig, dataSig: sig, data, loading: false, error: null, fetchedAt: Date.now() });
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
      // ⚠️ Keyed on what the DATA answers: `sig` moves the moment a new query
      // starts, so reading it here made `stale` false at exactly the moment it
      // should be true (2026-09-23 review).
      stale: !!state.data && state.dataSig !== sig,
      loading: state.loading,
      error: current ? state.error : null,
      reload,
    }),
    [state, current, sig, reload],
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
/** A flush asked for while one was running. The running pass read its list
 *  BEFORE the new request, so without one more pass a note released mid-flush
 *  waited for the next trigger — possibly the next day (2026-09-23 review). */
let flushAgain = false;
/** Resolutions this browser has MOVED ON from — copied now, whatever their age. */
const released = new Set<string>();
/** One timer, for the youngest note still inside its Undo window — or a retry. */
let dueTimer: ReturnType<typeof setTimeout> | null = null;
/** When the last pass that could read the outbox saw a note still inside its
 *  Undo window come due. Infinity when it saw none. */
let knownDue = Infinity;
/** How far up `COPY_RETRY_MS` the failed passes in a row have climbed. */
let retryStep = 0;

/**
 * A note nobody has moved on from is copied only once Undo can no longer take
 * it back — plus a margin for the difference between this browser's clock and
 * the gateway's, which is the clock `canUndo` reads.
 */
export const COPY_UNCLAIMED_AFTER_MS = UNDO_WINDOW_MS + 2 * 60_000;

/**
 * A pass that did not finish — the outbox could not be read, or a copy failed —
 * is tried again on this ladder, then left to the next trigger (moving on,
 * opening Communications).
 *
 * ⚠️ It exists because the due TIMER is often the only trigger: a rep sitting
 * on one item presses nothing, so a gateway blip at the moment the timer fired
 * left a note uncopied past its Undo window with the tab still open (Greptile,
 * PR #58). ⚠️ It is bounded because an outage is not a reason to keep asking —
 * the note is safe in the log, and the gateway caps a copy at three attempts
 * anyway (`MAX_MIRROR_ATTEMPTS`), so every rung here is either a blip recovered
 * or one attempt closer to the health check saying so.
 */
export const COPY_RETRY_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000] as const;

/** The next rung, or null once the ladder is spent. */
function nextRetryDelay(): number | null {
  if (retryStep >= COPY_RETRY_MS.length) return null;
  return COPY_RETRY_MS[retryStep++];
}

/**
 * Copy this rep's uncopied resolve notes into the patients' Monday notes.
 *
 * @param release  the resolution the rep just MOVED ON from — copied at once.
 *
 * ⚠️⚠️ **Only what nobody can still Undo.** A resolution is copied when the rep
 * moves on from it (`release`), or once its Undo window has closed. It used to
 * be every pending note on every trigger — so a SECOND tab opening
 * Communications copied a note the first tab was still showing with Undo, and
 * that Undo was then refused: exactly the Monday line Undo exists to prevent
 * (2026-09-23 review). A note left behind by a closed tab is copied by the next
 * trigger after its window closes, and while a page is open one timer makes
 * sure that happens without waiting for a click.
 *
 * ⚠️⚠️ CLAIM FIRST. The claim is a compare-and-set on the gateway, so two open
 * tabs can never both write a note; only the RESOLVER's browser is ever
 * offered one (`appendNoteToRecord` stamps the signed-in person's initials).
 *
 * ⚠️ A failed copy never un-resolves anything — the note is safe in the log —
 * and the toast names the patient, because by then the rep is on the next item.
 *
 * ⚠️ A pass that did not finish is tried again on `COPY_RETRY_MS`, but only
 * while there is known work — a note moved on from, or one waiting out its
 * window — so a tab with nothing to copy does not keep asking a gateway that is
 * down.
 */
export function flushCommsOutbox(release?: string | null): Promise<void> {
  if (release) released.add(release);
  if (!inboxConfigured()) return Promise.resolve();
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    do {
      flushAgain = false;
      // What this pass can speak for. A release that lands while it runs is
      // left to the pass `flushAgain` adds.
      const before = new Set(released);
      let pending: OutboxEntry[] = [];
      try {
        pending = await fetchOutbox();
      } catch {
        if (released.size || Number.isFinite(knownDue)) {
          const d = nextRetryDelay();
          if (d !== null) {
            const at = Date.now() + d;
            // ⚠️ A due time already PAST is what fired this pass; taking it
            // would retry in a second and spend the whole ladder in five.
            scheduleDue(knownDue > Date.now() ? Math.min(knownDue, at) : at);
          }
        }
        return;
      }
      // Moved on from, but no longer offered: copied by another tab, undone,
      // noteless, or out of attempts. Nothing is left to do for them — and
      // keeping them would count as known work on every failed read.
      const offered = new Set(pending.map((e) => e.resolutionId));
      for (const id of before) if (!offered.has(id)) released.delete(id);
      const now = Date.now();
      let nextDue = Infinity;
      let failed = false;
      for (const e of pending) {
        if (!released.has(e.resolutionId) && now - e.resolvedAt <= COPY_UNCLAIMED_AFTER_MS) {
          nextDue = Math.min(nextDue, e.resolvedAt + COPY_UNCLAIMED_AFTER_MS);
          continue;
        }
        const out = await copyOne(e.resolutionId);
        // A failure stays "moved on", so the retry copies it at once.
        if (out === "failed" || out === "retry") failed = true;
        else released.delete(e.resolutionId);
      }
      knownDue = nextDue;
      if (failed) {
        const d = nextRetryDelay();
        if (d !== null) nextDue = Math.min(nextDue, Date.now() + d);
      } else {
        retryStep = 0;
      }
      scheduleDue(nextDue);
    } while (flushAgain);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

function scheduleDue(at: number): void {
  if (dueTimer) clearTimeout(dueTimer);
  dueTimer = null;
  if (!Number.isFinite(at)) return;
  dueTimer = setTimeout(
    () => {
      dueTimer = null;
      void flushCommsOutbox();
    },
    Math.max(1_000, at - Date.now() + 5_000),
  );
}

/**
 * A copy that reached Monday but whose "done" never reached the gateway —
 * remembered in THIS browser, so the re-claim that follows the stale-claim
 * timeout records it instead of appending the line a second time. Monday notes
 * are append-only; a duplicate line cannot be taken back (2026-09-23 review).
 * Best effort: a browser that blocks storage loses only this safety net.
 */
const copiedKey = (rid: string) => `mm-comms-copied:${rid}`;
function readCopied(rid: string): string | null {
  try {
    return localStorage.getItem(copiedKey(rid));
  } catch {
    return null;
  }
}
function writeCopied(rid: string, to: string): void {
  try {
    localStorage.setItem(copiedKey(rid), to);
  } catch {
    /* best effort */
  }
}
function clearCopied(rid: string): void {
  try {
    localStorage.removeItem(copiedKey(rid));
  } catch {
    /* best effort */
  }
}

/** Retried: the append it records can never be taken back. */
async function reportDone(rid: string, to: string): Promise<boolean> {
  for (const wait of [0, 1_000, 3_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      await reportMirrorDone(rid, to);
      return true;
    } catch {
      /* tried again */
    }
  }
  return false;
}

/** Test seam. */
export async function copyOne(
  resolutionId: string,
): Promise<"copied" | "skipped" | "failed" | "not-claimed" | "retry"> {
  let claimed: OutboxEntry | null = null;
  try {
    claimed = await claimMirror(resolutionId);
  } catch {
    // The claim could not be ASKED — a blip, not "somebody else holds it". The
    // note stays moved-on and is tried again (`COPY_RETRY_MS`).
    return "retry";
  }
  if (!claimed) return "not-claimed";

  // ⚠️⚠️ This browser already wrote it, on a try whose "done" was lost: record
  // it — never write it again.
  const already = readCopied(resolutionId);
  if (already) {
    if (await reportDone(resolutionId, already)) clearCopied(resolutionId);
    return "copied";
  }

  let patient = "this patient";
  try {
    if (!claimed.itemId || !claimed.itemBoard) {
      await reportMirrorDone(resolutionId, "none:unmatched");
      return "skipped";
    }
    // ⚠️ STRICT: a board that did not answer must never read as "this patient
    // has no live record" — that recorded the copy as done with nowhere to put
    // it, on one Monday blip (2026-09-23 review). It throws instead, and the
    // copy is retried.
    const items = await fetchDossierItemsForPick(
      { itemId: claimed.itemId, boardId: claimed.itemBoard, name: "", phone: "" },
      { strict: true },
    );
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
    const to = `${live.boardId}:${live.itemId}`;
    writeCopied(resolutionId, to);
    // ⚠️ Not a failure even if "done" never lands: the note IS on Monday. The
    // claim times out, the note is offered again, and the marker above records
    // it rather than appending it twice.
    if (await reportDone(resolutionId, to)) clearCopied(resolutionId);
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
  configCheckedAt = 0;
  if (configTimer) clearInterval(configTimer);
  configTimer = null;
  configWatchers = 0;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onConfigVisible);
  badgeStore.set({ counts: null, at: 0 });
  badgeInflight = null;
  listStore.set({ sig: "", dataSig: "", data: null, loading: false, error: null, fetchedAt: 0 });
  listInflight = null;
  listQuery = null;
  flushing = null;
  flushAgain = false;
  released.clear();
  if (dueTimer) clearTimeout(dueTimer);
  dueTimer = null;
  knownDue = Infinity;
  retryStep = 0;
}
