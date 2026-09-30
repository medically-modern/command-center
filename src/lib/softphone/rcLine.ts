/**
 * Has this person connected their OWN RingCentral login? (§5.13c)
 *
 * Until they have, their browser rings on the shared extension (Katie's) and
 * only if a manager made them a call answerer — five at most, because that is
 * all the registrations one extension gets (§5.13b). Once they have, the
 * gateway provisions THEIR extension and none of Katie's five is spent.
 *
 * ⚠️ Asked of the gateway ONCE per page load (and again after a connect,
 * disconnect or sign-in), never on a timer — the status is our own Postgres,
 * but INCIDENT_2026-08-20's rules hold for every request a page makes. Other
 * tabs of the browser hear about a change through a storage event, not a poll.
 *
 * ⚠️ The snapshot object only changes when the state does, so it is safe in
 * dependency arrays (the incident's rule 2).
 */
import { useEffect, useSyncExternalStore } from "react";
import { getIdToken, onAuthChange } from "@/lib/shared/auth";
import { clearCachedSipInfo, type SipLine } from "./registration";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

/** Written by the tab that connected or disconnected; every other tab of the
 *  browser re-reads the status when it changes. */
export const LINE_CHANGED_KEY = "mm-rc-line-changed";

export interface RcLineState {
  /** The status has been asked (or there is nothing to ask). */
  loaded: boolean;
  /** The gateway has the second RingCentral app set up. */
  configured: boolean;
  connected: boolean;
  /** Connected, but the grant died — the person has to connect again. */
  broken: boolean;
  extension: { number: string; name: string } | null;
  /** The outcome of a Connect that just came back, for one toast. */
  notice: { kind: "connected" | "error"; reason: string } | null;
}

const INITIAL: RcLineState = {
  loaded: false,
  configured: false,
  connected: false,
  broken: false,
  extension: null,
  notice: null,
};

/**
 * Whether this browser's phone should be on, and on which line.
 *
 * ⚠️ Nothing registers until the status is in: an answerer who has connected
 * must not first register on the shared line, spending one of Katie's five for
 * the second it takes to learn otherwise. A failed status read counts as "not
 * connected", so an answerer is never left without a phone by it.
 *
 * ⚠️ A connected person whose grant died stays on "own" — provisioning then
 * says "connect again" — rather than dropping back to the shared line, which
 * would quietly take one of Katie's five (rcUserAuth.mjs says the same).
 */
export function phoneLine(answerer: boolean, s: RcLineState): { enabled: boolean; line: SipLine | null } {
  if (!s.loaded) return { enabled: false, line: null };
  if (s.connected) return { enabled: true, line: "own" };
  return answerer ? { enabled: true, line: "shared" } : { enabled: false, line: null };
}

let state: RcLineState = INITIAL;
const listeners = new Set<() => void>();
let started = false;
let inFlight: Promise<void> | null = null;

function set(patch: Partial<RcLineState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function authHeaders(): Record<string, string> {
  const token = getIdToken();
  return token ? { "X-MM-Auth": token } : {};
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function announceChange(): void {
  const s = storage();
  clearCachedSipInfo(s ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  try {
    s?.setItem(LINE_CHANGED_KEY, String(Date.now()));
  } catch {
    /* storage disabled — other tabs catch up on their next load */
  }
}

/** Re-read the status. One request at a time. */
export function refreshRcLine(): Promise<void> {
  if (inFlight) return inFlight;
  if (!GATEWAY) {
    set({ loaded: true });
    return Promise.resolve();
  }
  inFlight = (async () => {
    try {
      const res = await fetch(`${GATEWAY}/rc/user/status`, { headers: authHeaders() });
      if (!res.ok) {
        set({ loaded: true, connected: false, broken: false, extension: null });
        return;
      }
      const j = (await res.json()) as {
        configured?: boolean;
        connected?: boolean;
        broken?: boolean;
        extension?: { number?: string; name?: string };
      };
      set({
        loaded: true,
        configured: !!j.configured,
        connected: !!j.connected,
        broken: !!j.broken,
        extension: j.connected ? { number: j.extension?.number || "", name: j.extension?.name || "" } : null,
      });
    } catch {
      set({ loaded: true, connected: false, broken: false, extension: null });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** The page's own address without a previous outcome on it. */
function cleanHref(): string {
  const u = new URL(window.location.href);
  u.searchParams.delete("rc");
  u.searchParams.delete("rcReason");
  return u.toString();
}

/**
 * Coming back from RingCentral's sign-in: read the outcome off the address,
 * then take it off so a reload does not repeat it.
 */
function consumeReturn(): void {
  const u = new URL(window.location.href);
  const outcome = u.searchParams.get("rc");
  if (outcome !== "connected" && outcome !== "error") return;
  const reason = u.searchParams.get("rcReason") || "";
  try {
    window.history.replaceState(window.history.state, "", cleanHref());
  } catch {
    /* leave the address as it is */
  }
  if (outcome === "connected") announceChange();
  set({ notice: { kind: outcome, reason } });
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  consumeReturn();
  void refreshRcLine();
  onAuthChange(() => void refreshRcLine());
  window.addEventListener("storage", (e) => {
    if (e.key === LINE_CHANGED_KEY) void refreshRcLine();
  });
}

/** Send the browser to RingCentral's sign-in. Throws with a message to show. */
export async function connectRcLine(): Promise<void> {
  if (!GATEWAY) throw new Error("Calling needs the Monday gateway.");
  const res = await fetch(`${GATEWAY}/rc/user/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ returnTo: cleanHref() }),
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !j.url) throw new Error(j.error || `Couldn't start the RingCentral sign-in (${res.status})`);
  window.location.assign(j.url);
}

/** Go back to the shared line (or to no phone, for a non-answerer). */
export async function disconnectRcLine(): Promise<void> {
  if (!GATEWAY) return;
  const res = await fetch(`${GATEWAY}/rc/user/disconnect`, { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(`Couldn't disconnect (${res.status})`);
  announceChange();
  await refreshRcLine();
}

export function clearRcLineNotice(): void {
  if (state.notice) set({ notice: null });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): RcLineState {
  return state;
}

export function useRcLine(): RcLineState {
  useEffect(() => {
    start();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
