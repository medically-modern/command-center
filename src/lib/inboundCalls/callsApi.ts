/**
 * Client for inbound calls on the shared line.
 *
 * The signal comes from the gateway, not from RingCentral directly: the browser
 * softphone is outbound-only (useWebPhone.ts), so a browser can never learn
 * about an incoming call by itself. The gateway holds ONE server-side
 * subscription and streams matching calls here — see
 * services/monday-gateway/inboundCalls.mjs.
 *
 * ⚠️ Every connected answerer gets every inbound call (Josh, 2026-09-25 —
 * the ring modes and the pinned-number list are gone; the browser ringtone
 * and its mute stay). There is deliberately no client-side filtering to add.
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
  /** RingCentral is receiving a FAX on this call: drop the card at once (§5.13c). */
  fax?: boolean;
  /** This number has sent us a fax before — the card says "Probably a fax". */
  faxLikely?: boolean;
}

export interface RingPrefs {
  /** Where RingCentral rings this person when they take a call. ⚠️ The EDITOR
   *  for this is gone (2026-09-25 — "we dont do call forwarding anymore,
   *  everyone answers in the browser"); the gateway still stores and reads the
   *  numbers people saved while it existed, so "Take it" keeps working for
   *  them, and this type still describes the SSE prefs payload. */
  forwardNumber: string;
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
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
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

/* ⚠️ `claimCall` ("Take it") left this file on 2026-09-28 with the button —
 * calls are answered in the browser, never forwarded to a personal phone. The
 * gateway keeps POST /calls/claim (the §5.13 precedent: routes stay, UI goes),
 * so a rollback is a client change only. */


/* ── is everyone's browser actually on the line? (§5.13b) ─────────────────── */

/**
 * ⚠️ **The gateway cannot see this for itself.** The SIP socket goes browser →
 * RingCentral directly, and a healthy browser asks for credentials about once
 * a week, so nothing server-side can tell "registered and ringing" from
 * "silently unable to register since Tuesday". Each leader tab reports its own
 * state; these two calls are that report and its readout.
 */
export interface PhoneStateReport {
  registration: string;
  detail: string | null;
  leader: boolean;
  instanceId: string;
  userAgent: string;
}

/** One browser's verdict, as the gateway's phonePresenceRules decided it. */
export interface PhoneBrowser {
  email: string;
  instanceId: string;
  registration: string;
  detail: string | null;
  leader: boolean;
  userAgent: string | null;
  since: number;
  at: number;
  state: "connected" | "waiting" | "trouble" | "gone";
  label: string;
  heldFor: number;
}

export interface PhoneHealth {
  configured: boolean;
  now: number;
  browsers: PhoneBrowser[];
  assigned: number;
  connected: number;
  unassigned: number;
  people: {
    email: string;
    connected: boolean;
    state: PhoneBrowser["state"];
    label: string;
    heldFor: number;
    browsers: PhoneBrowser[];
  }[];
  faults: string[];
}

/**
 * Tell the gateway how this browser's registration is going.
 *
 * ⚠️ Never throws into the phone. A monitoring write that could break calling
 * would be worse than the blind spot it closes, so the caller ignores the
 * result and this swallows everything.
 */
export async function reportPhoneState(report: PhoneStateReport): Promise<void> {
  if (!GATEWAY) return;
  try {
    await call("/calls/phone-state", { method: "POST", body: JSON.stringify(report) });
  } catch {
    /* monitoring is never worth a failed call */
  }
}

/** Every browser's registration state, rolled up per assigned answerer. */
export async function fetchPhoneHealth(answerers: string[]): Promise<PhoneHealth> {
  const q = answerers.length ? `?answerers=${encodeURIComponent(answerers.join(","))}` : "";
  const res = await call(`/calls/phone-health${q}`);
  return json<PhoneHealth>(res, "Reading the phone line's health");
}
