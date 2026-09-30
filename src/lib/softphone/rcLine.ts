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
import { getIdToken, getUser, onAuthChange } from "@/lib/shared/auth";
import { clearCachedSipInfo, type SipLine } from "./registration";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

/** Written by the tab that connected or disconnected; every other tab of the
 *  browser re-reads the status when it changes. */
export const LINE_CHANGED_KEY = "mm-rc-line-changed";
/** The last status the gateway gave this browser, per person. */
export const LINE_STATUS_KEY = "mm-rc-line-status";

export interface RcLineState {
  /** The status has been asked (or there is nothing to ask). */
  loaded: boolean;
  /** The gateway has the second RingCentral app set up. */
  configured: boolean;
  connected: boolean;
  /** Connected, but the grant died — the person has to connect again. */
  broken: boolean;
  /** Their line IS the shared extension (Katie's, or somebody using her
   *  login): they stay on the shared line for everything, as before. */
  sharedLine: boolean;
  extension: { number: string; name: string } | null;
  /** The outcome of a Connect that just came back, for one toast. */
  notice: { kind: "connected" | "error"; reason: string } | null;
}

const INITIAL: RcLineState = {
  loaded: false,
  configured: false,
  connected: false,
  broken: false,
  sharedLine: false,
  extension: null,
  notice: null,
};

/**
 * Whether this browser answers incoming calls, and on which line.
 *
 * ⚠️ **Connecting your own RingCentral login IS being a call answerer** (Josh,
 * 2026-09-30: *"assigned answerers now shifts to whos logged in on rc"*). The
 * manager-assigned list on /access (`callAnswerers`, five at most on Katie's
 * extension, §5.13b) no longer decides anything. Nobody is rung on the shared
 * line; outgoing calls still go out on it exactly as before (softphone.ts
 * `dialingShared`).
 *
 * `authOff` is a build without Google sign-in (local dev): nobody can connect
 * there, so everyone rings on the shared line, as before, or nothing could be
 * tried locally.
 *
 * ⚠️ A connected person whose grant died stays on "own" — provisioning then
 * says "connect again" and the badge turns red — rather than silently going
 * quiet or dropping onto Katie's line (rcUserAuth.mjs says the same).
 */
export function phoneLine(authOff: boolean, s: RcLineState): { enabled: boolean; line: SipLine | null } {
  if (authOff) return { enabled: true, line: "shared" };
  if (!s.loaded) return { enabled: false, line: null };
  // ⚠️ Connected to the shared extension itself: rung, on the shared line — never
  // a second set of credentials for the same extension (rcUserAuth.mjs).
  if (s.connected) return { enabled: true, line: s.sharedLine ? "shared" : "own" };
  return { enabled: false, line: null };
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

type KnownStatus = Pick<RcLineState, "configured" | "connected" | "broken" | "sharedLine" | "extension">;

function myEmail(): string {
  return (getUser()?.email || "").toLowerCase();
}

function rememberStatus(st: KnownStatus): void {
  try {
    storage()?.setItem(LINE_STATUS_KEY, JSON.stringify({ email: myEmail(), ...st }));
  } catch {
    /* storage disabled */
  }
}

/** The last status this browser was told for the signed-in person, if any. */
export function lastKnownStatus(raw: string | null, email: string): KnownStatus | null {
  try {
    const j = JSON.parse(raw || "null") as (KnownStatus & { email?: string }) | null;
    if (!j || !email || j.email !== email) return null;
    return {
      configured: !!j.configured,
      connected: !!j.connected,
      broken: !!j.broken,
      sharedLine: !!j.sharedLine,
      extension: j.connected ? j.extension ?? null : null,
    };
  } catch {
    return null;
  }
}

/**
 * A status read that FAILED is not an answer. ⚠️ Treating it as "not
 * connected" would put a connected person back on Katie's line — spending one
 * of her five, the thing this exists to stop. So a failure keeps what this
 * browser last heard for this person; only somebody it has never heard about
 * is treated as not connected (which is where everybody was before §5.13c).
 */
function onStatusFailure(): void {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(LINE_STATUS_KEY) ?? null;
  } catch {
    /* storage disabled */
  }
  const known = state.loaded ? null : lastKnownStatus(raw, myEmail());
  if (state.loaded) return; // keep the answer already on screen
  set({ loaded: true, ...(known ?? { connected: false, broken: false, sharedLine: false, extension: null }) });
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
        onStatusFailure();
        return;
      }
      const j = (await res.json()) as {
        configured?: boolean;
        connected?: boolean;
        broken?: boolean;
        sharedLine?: boolean;
        extension?: { number?: string; name?: string };
      };
      const st: KnownStatus = {
        configured: !!j.configured,
        connected: !!j.connected,
        broken: !!j.broken,
        sharedLine: !!j.connected && !!j.sharedLine,
        extension: j.connected ? { number: j.extension?.number || "", name: j.extension?.name || "" } : null,
      };
      rememberStatus(st);
      set({ loaded: true, ...st });
    } catch {
      onStatusFailure();
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
