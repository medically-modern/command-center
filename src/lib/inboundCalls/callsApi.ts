/**
 * Client for inbound calls on the shared line.
 *
 * The signal comes from the gateway, not from RingCentral directly: the browser
 * softphone is outbound-only (useWebPhone.ts), so a browser can never learn
 * about an incoming call by itself. The gateway holds ONE server-side
 * subscription and streams matching calls here — see
 * services/monday-gateway/inboundCalls.mjs.
 *
 * ⚠️ Every call that arrives here has already passed THIS user's rules,
 * server-side. There is deliberately no client-side filtering to add: a browser
 * filter would mean the gateway had already sent numbers the rules excluded.
 */
import { getIdToken } from "../shared/auth";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

export function inboundCallsConfigured(): boolean {
  return !!GATEWAY;
}

export type CallState = "ringing" | "answered" | "missed";

export interface InboundCall {
  id: string;
  /** Caller, E.164. */
  from: string;
  /** Which of our numbers they dialled. */
  to: string;
  /** RingCentral's caller-ID name, when the carrier supplied one. */
  callerName: string;
  startedAt: number;
  state: CallState;
  claimedBy: string | null;
}

export type RingMode = "all" | "list" | "off";

export interface AllowEntry {
  /** The HMAC. Removal keys on this, so the number never travels back. */
  id: string;
  last4: string;
  label: string;
}

export interface RingPrefs {
  mode: RingMode;
  /** Where RingCentral rings this person when they take a call. */
  forwardNumber: string;
  /** In `list` mode, the ONLY thing that rings you. Membership is explicit —
   *  texting a patient never adds them (see callRules.mjs `shouldNotify`). */
  allow: AllowEntry[];
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  if (!GATEWAY) throw new Error("Inbound calls need the Monday gateway (VITE_MONDAY_GATEWAY_URL).");
  const token = getIdToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (token) headers["X-MM-Auth"] = token;
  return fetch(`${GATEWAY}${path}`, { ...init, headers });
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let msg = `${what} failed (${res.status})`;
    try {
      const e = (await res.json()) as { error?: string };
      if (e?.error) msg = e.error;
    } catch {
      /* keep default */
    }
    const err = new Error(msg) as Error & { status?: number; needsForwardNumber?: boolean };
    err.status = res.status;
    // The one failure a rep can fix themselves, mid-call. Flagged rather than
    // string-matched so the UI can open the settings dialog for them.
    if (res.status === 400 && /ring you on/i.test(msg)) err.needsForwardNumber = true;
    throw err;
  }
  return (await res.json()) as T;
}

/** The SSE endpoint for this user's calls.
 *  EventSource cannot set headers, so identity rides in the query string —
 *  the gateway verifies it exactly as it would the X-MM-Auth header. */
export function streamUrl(): string {
  const token = getIdToken();
  return `${GATEWAY}/calls/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

/**
 * Take a ringing call — the gateway forwards it to this user's own number and
 * their phone rings.
 *
 * Throws with `status` set so the UI can tell the two ordinary failures apart:
 * 410 (the caller hung up, or somebody else got there first) is not an error
 * worth alarming anyone about; 400 means they haven't said where to ring them.
 */
export async function claimCall(callId: string): Promise<{ ringingAt: string }> {
  const res = await call("/calls/claim", { method: "POST", body: JSON.stringify({ callId }) });
  return json<{ ok: boolean; ringingAt: string }>(res, "Taking the call");
}

export async function fetchRingPrefs(): Promise<RingPrefs> {
  return json<RingPrefs>(await call("/calls/prefs"), "Loading call settings");
}

export async function saveRingPrefs(
  prefs: Pick<RingPrefs, "mode" | "forwardNumber">,
): Promise<void> {
  await json(await call("/calls/prefs", { method: "PUT", body: JSON.stringify(prefs) }), "Saving call settings");
}

export async function addAllowedNumber(phone: string, label: string): Promise<AllowEntry> {
  const res = await call("/calls/allow", { method: "POST", body: JSON.stringify({ phone, label }) });
  return json<AllowEntry>(res, "Adding the number");
}

/** Is this number on my ring list? The browser can't hash it itself — the
 *  pepper is server-side — so membership has to be asked for. */
export async function checkAllowedNumber(phone: string): Promise<{ pinned: boolean; id: string }> {
  const res = await call("/calls/allow/status", { method: "POST", body: JSON.stringify({ phone }) });
  return json<{ pinned: boolean; id: string }>(res, "Checking your ring list");
}

export async function removeAllowedNumber(id: string): Promise<void> {
  await json(await call("/calls/allow/remove", { method: "POST", body: JSON.stringify({ id }) }), "Removing the number");
}
