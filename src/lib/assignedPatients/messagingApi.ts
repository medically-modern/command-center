/**
 * Client for patient texting + calling.
 *
 * Sends go through the GATEWAY rather than straight to RingCentral, so the
 * sender is taken from the verified Google token server-side. A browser-supplied
 * sender would be self-reported and trivially spoofable, and "who texted this
 * patient" is the whole point of the record.
 */
import { getIdToken } from "../shared/auth";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

export function messagingConfigured(): boolean {
  return !!GATEWAY;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  if (!GATEWAY) throw new Error("Patient texting needs the Monday gateway (VITE_MONDAY_GATEWAY_URL).");
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
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/** A media part of an MMS — a photo the patient texted back, a PDF, etc. The
 *  uri needs the RC bearer token, so the browser fetches it through the
 *  gateway's /rc/fetch proxy (see MessageAttachments). */
export interface MessageAttachment {
  id: number;
  contentType: string;
  uri: string;
}

export interface ConversationMessage {
  id: number;
  direction: "Inbound" | "Outbound";
  text: string;
  time: string;
  /** Which employee sent it. Absent for inbound, and for outbound messages sent
   *  before this tracking existed or from outside the Command Center. */
  sentBy?: string;
  /** Present on MMS — the message's media parts. */
  attachments?: MessageAttachment[];
}

/**
 * Full history for one number, oldest → newest, with sender attribution.
 *
 * `complete` reports whether the whole history was read. The opt-out guard
 * treats an incomplete history as consent UNKNOWN, never as consent given.
 */
export async function fetchConversation(
  phone: string,
): Promise<{ messages: ConversationMessage[]; complete: boolean }> {
  const res = await call("/messaging/conversation", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  return json<{ messages: ConversationMessage[]; complete: boolean }>(res, "Loading conversation");
}

/** Send a text from the MM number, recording who sent it. */
export async function sendMessage(opts: {
  to: string;
  text: string;
  mondayItemId?: string;
}): Promise<void> {
  const res = await call("/messaging/send", { method: "POST", body: JSON.stringify(opts) });
  await json<{ ok: boolean }>(res, "Sending message");
}
