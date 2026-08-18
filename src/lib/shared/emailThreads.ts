/**
 * emailThreads — the records@ mailbox's email history with ONE patient, and
 * threaded replies into it. Talks to the Cloudflare worker's /email-threads,
 * /email-thread and /email-reply routes (worker/src/index.js), which hold the
 * Gmail OAuth credentials server-side; the browser only ever sends the
 * signed-in rep's Google ID token — the same gate as sendViaWorker.
 *
 * READING requires the mailbox's refresh token to carry gmail.readonly. Until
 * that one-time re-consent is done the worker answers { needsScope: true } and
 * these helpers throw GmailScopeMissingError, so the UI renders setup guidance
 * instead of an error. Replies ride the already-granted gmail.send scope.
 */
import { getIdToken } from "@/lib/shared/auth";
import { FILE_PROXY_URL } from "@/lib/shared/mondayAssets";

export interface EmailThreadSummary {
  id: string;
  subject: string;
  /** Raw From header of the latest message (display name + address). */
  from: string;
  /** Epoch ms of the latest message. */
  lastAt: number;
  count: number;
  snippet: string;
}

export interface EmailThreadMessage {
  id: string;
  from: string;
  to: string;
  /** Epoch ms. */
  date: number;
  subject: string;
  body: string;
  /** Message-ID header — what a reply's In-Reply-To must point at. */
  messageId: string;
  /** References header — the chain a reply appends its target to. */
  references: string;
  /** Sent by the Medically Modern mailbox (vs the patient/anyone else). */
  mine: boolean;
}

/** The mailbox can't be READ yet — the refresh token lacks gmail.readonly.
 *  Not a failure: callers show the one-time-authorization note. */
export class GmailScopeMissingError extends Error {
  constructor() {
    super("Email history isn't authorized yet.");
    this.name = "GmailScopeMissingError";
  }
}

async function workerPost<T>(path: string, payload: unknown): Promise<T> {
  const idToken = getIdToken();
  if (!idToken) {
    throw new Error("Sign in with your medicallymodern.com account to use email history.");
  }
  const res = await fetch(`${FILE_PROXY_URL}${path}`, {
    method: "POST",
    headers: { "X-MM-Auth": idToken, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    needsScope?: boolean;
    error?: string;
  };
  if (data?.needsScope) throw new GmailScopeMissingError();
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

/** Threads in the MM mailbox that involve this address (newest first, ≤10). */
export async function fetchEmailThreads(email: string): Promise<EmailThreadSummary[]> {
  const d = await workerPost<{ threads?: EmailThreadSummary[] }>("/email-threads", { email });
  return d.threads ?? [];
}

/** One thread's messages, oldest first, bodies as readable text. */
export async function fetchEmailThread(id: string): Promise<EmailThreadMessage[]> {
  const d = await workerPost<{ messages?: EmailThreadMessage[] }>("/email-thread", { id });
  return d.messages ?? [];
}

/** Send a text-only reply INTO an existing thread as the MM mailbox. */
export async function sendEmailReply(args: {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): Promise<void> {
  await workerPost("/email-reply", args);
}

/**
 * The headers a reply needs, derived from the thread: it answers the LAST
 * message. Subject gains a single "Re: " (never stacked, case-insensitive);
 * References chains the last message's own References plus its Message-ID —
 * the RFC 5322 rule that keeps the patient's mail client threading it.
 */
export function replyHeadersFor(messages: EmailThreadMessage[]): {
  subject: string;
  inReplyTo: string;
  references: string;
} {
  const last = messages[messages.length - 1];
  if (!last) return { subject: "", inReplyTo: "", references: "" };
  const base = (last.subject || "").trim();
  const subject = !base ? "" : /^re:/i.test(base) ? base : `Re: ${base}`;
  const inReplyTo = last.messageId || "";
  const references = [last.references, last.messageId].filter(Boolean).join(" ").trim();
  return { subject, inReplyTo, references };
}
