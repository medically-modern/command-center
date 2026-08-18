/**
 * RingCentral — fax + SMS for the Command Center, via the server-side gateway.
 *
 * The RingCentral app credentials + JWT NO LONGER live in this bundle. Every
 * call goes through the monday-gateway Railway service at `${GATEWAY}/rc/<RC
 * REST path>`, which holds the creds server-side, JWT-authenticates, and
 * forwards to RingCentral (refreshing the RC token on 401). This module builds
 * the RC REST paths and attaches the signed-in user's Google token (X-MM-Auth)
 * so the gateway can authorize — fax/SMS are PHI.
 */

import { getIdToken } from "../shared/auth";
import {
  callLogPhoneParam,
  toPatientCalls,
  type PatientCall,
  type RcCallLogRecord,
} from "../callHistory/callHistory";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";
const RC_BASE = `${GATEWAY}/rc`;

/** Fetch a RingCentral REST path (or an absolute RC URL such as a fax
 *  attachment URI) through the gateway, attaching the Workspace token. The
 *  gateway injects the RingCentral bearer token and refreshes it on 401. */
async function rcFetch(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
  // Fax attachment content lives on media.ringcentral.com — a DIFFERENT host
  // from the platform API — so absolute URLs are passed whole to the gateway's
  // /rc/fetch (which forwards to that exact host). Relative paths hit the
  // platform API via /rc/<path>.
  const target = /^https?:\/\//.test(pathOrUrl)
    ? `${RC_BASE}/fetch?url=${encodeURIComponent(pathOrUrl)}`
    : `${RC_BASE}${pathOrUrl}`;
  const token = getIdToken();
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) };
  if (token) headers["X-MM-Auth"] = token;
  return fetch(target, { ...init, headers });
}

/** Number of unread faxes in the message store. Throws on failure — callers
 *  should keep the previous count rather than showing 0. */
export async function fetchUnreadFaxCount(): Promise<number> {
  const dateFrom = new Date(Date.now() - 180 * 24 * 60 * 60_000).toISOString();
  const path =
    `/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=Fax&readStatus=Unread&availability=Alive&direction=Inbound` +
    `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=1`;
  const res = await rcFetch(path);
  if (!res.ok) throw new Error(`RingCentral message-store failed (${res.status})`);
  const json = (await res.json()) as { paging?: { totalElements?: number }; records?: unknown[] };
  return json.paging?.totalElements ?? json.records?.length ?? 0;
}

export type FaxStatus = "Queued" | "Sent" | "Failed";
export interface OutboundFaxStatus {
  status: FaxStatus;
  creationTime: string;
  lastModifiedTime: string;
  id: number;
}

/** Real status of the outbound fax to `toNumber` around `sinceIso`. Matches by
 *  recipient (last 10 digits) + most-recent within a 12h window. */
export async function fetchOutboundFaxStatus(
  toNumber: string | undefined,
  sinceIso: string | undefined,
): Promise<OutboundFaxStatus | null> {
  const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
  const want = last10(toNumber || "");
  if (want.length < 10) return null;
  void sinceIso;
  const dateFrom = new Date(Date.now() - 12 * 60 * 60_000).toISOString();
  const path =
    `/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=Fax&direction=Outbound&dateFrom=${encodeURIComponent(dateFrom)}&perPage=50`;
  const res = await rcFetch(path);
  if (!res.ok) throw new Error(`RingCentral fax status failed (${res.status})`);
  const json = (await res.json()) as {
    records?: Array<{
      id: number;
      messageStatus?: string;
      creationTime?: string;
      lastModifiedTime?: string;
      to?: Array<{ phoneNumber?: string }>;
    }>;
  };
  const rec = (json.records ?? [])
    .filter((r) => (r.to ?? []).some((t) => last10(t.phoneNumber || "") === want))
    .filter((r) => !!r.creationTime)
    .sort((a, b) => new Date(b.creationTime!).getTime() - new Date(a.creationTime!).getTime())[0];
  if (!rec) return null;
  const raw = rec.messageStatus || "";
  const status: FaxStatus = /sent|delivered/i.test(raw)
    ? "Sent"
    : /fail|error/i.test(raw)
      ? "Failed"
      : "Queued";
  return {
    status,
    creationTime: rec.creationTime || sinceIso || "",
    lastModifiedTime: rec.lastModifiedTime || rec.creationTime || sinceIso || "",
    id: rec.id,
  };
}

const RC_SMS_FROM = (import.meta.env.VITE_RC_SMS_FROM as string | undefined) || "+13475037148";

export function toE164(raw: string): string {
  const t = String(raw ?? "").trim();
  const d = t.replace(/[^0-9]/g, "");
  // US/NANP, the only shape we can infer a country code for.
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  // Already-international input is trusted only if it is a plausible E.164
  // length (ITU caps country+national digits at 15).
  if (t.startsWith("+") && d.length >= 11 && d.length <= 15) return "+" + d;
  // WARN: anything else is UNUSABLE - return empty rather than guessing.
  // This used to fall through to "+" + digits, fabricating a valid-LOOKING
  // number from partial data: a short Monday value became "+310213829", which
  // RingCentral parsed as a Netherlands number and rejected on send, and which
  // matched no conversation on read, so the thread looked empty. A number we
  // cannot normalise must be reported as MISSING, not invented.
  return "";
}


async function confirmSmsAccepted(toNum: string, text: string, sentAtMs: number): Promise<boolean> {
  const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
  const want = last10(toNum);
  const dateFrom = new Date(sentAtMs - 60_000).toISOString();
  const path =
    `/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=SMS&direction=Outbound&phoneNumber=${encodeURIComponent(toNum)}` +
    `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=20`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await rcFetch(path);
      if (!res.ok) continue;
      const json = (await res.json()) as {
        records?: Array<{ subject?: string; to?: Array<{ phoneNumber?: string }> }>;
      };
      const hit = (json.records ?? []).some(
        (r) =>
          (r.subject ?? "") === text &&
          (r.to ?? []).some((t) => last10(t.phoneNumber || "") === want),
      );
      if (hit) return true;
    } catch {
      /* transient read failure — retry, then give up */
    }
  }
  return false;
}

export interface SmsMessage {
  id: number;
  direction: "Inbound" | "Outbound";
  text: string;
  time: string;
  from: string;
  to: string;
}

export interface SmsConversation {
  messages: SmsMessage[];
  /**
   * We reached the end of the history rather than stopping at the page cap.
   *
   * ⚠️ Load-bearing for the opt-out guard. Consent is derived by scanning the
   * conversation for an inbound STOP, so a PARTIAL history can only ever prove
   * the absence of one within the part we fetched — and "we didn't see a STOP"
   * would otherwise re-enable the composer for a patient who is still opted
   * out. Callers must treat `complete: false` as "consent unknown", not "opted
   * in". See lib/assignedPatients/optOut.ts.
   */
  complete: boolean;
}

const CONVERSATION_PAGE_SIZE = 250;
/** 2,500 messages with one patient. Far beyond any real conversation, so
 *  hitting this means something is wrong rather than someone being chatty. */
const CONVERSATION_MAX_PAGES = 10;

/**
 * Full SMS conversation with one number, oldest → newest, following pagination
 * to the end of the history.
 *
 * It pages rather than taking the first N because the whole thread — not its
 * most recent page — is what the opt-out guard reads.
 */
export async function fetchSmsThread(phone: string): Promise<SmsConversation> {
  const num = toE164(phone);
  if (!num) return { messages: [], complete: true };
  const dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();
  const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
  const want = last10(num);

  const out: SmsMessage[] = [];
  let complete = false;
  for (let page = 1; page <= CONVERSATION_MAX_PAGES; page++) {
    const path =
      `/restapi/v1.0/account/~/extension/~/message-store` +
      `?messageType=SMS&phoneNumber=${encodeURIComponent(num)}&dateFrom=${encodeURIComponent(dateFrom)}` +
      `&perPage=${CONVERSATION_PAGE_SIZE}&page=${page}`;
    const res = await rcFetch(path);
    if (!res.ok) throw new Error(`RingCentral SMS history failed (${res.status})`);
    const json = (await res.json()) as {
      records?: Array<{
        id: number;
        direction?: string;
        subject?: string;
        text?: string;
        creationTime?: string;
        from?: { phoneNumber?: string };
        to?: Array<{ phoneNumber?: string }>;
      }>;
    };
    const records = json.records ?? [];
    out.push(
      ...records
        .filter(
          (r) =>
            last10(r.from?.phoneNumber || "") === want ||
            (r.to ?? []).some((t) => last10(t.phoneNumber || "") === want),
        )
        .map((r) => ({
          id: r.id,
          direction: (r.direction === "Outbound" ? "Outbound" : "Inbound") as "Inbound" | "Outbound",
          text: r.subject ?? r.text ?? "",
          time: r.creationTime ?? "",
          from: r.from?.phoneNumber ?? "",
          to: (r.to ?? [])[0]?.phoneNumber ?? "",
        })),
    );
    // A short page is the last page.
    if (records.length < CONVERSATION_PAGE_SIZE) {
      complete = true;
      break;
    }
  }

  out.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return { messages: out, complete };
}

/** Full SMS conversation with one number, oldest → newest.
 *  Prefer `fetchSmsThread` where consent matters — this drops the
 *  completeness signal the opt-out guard needs. */
export async function fetchSmsConversation(phone: string): Promise<SmsMessage[]> {
  return (await fetchSmsThread(phone)).messages;
}

/*
 * NOTE: the Assigned Patients inbox is deliberately NOT here.
 *
 * The MM number is one shared RingCentral inbox holding every patient
 * conversation, so anything in this file — which runs in the browser — would
 * hand a rep the whole thing and filter afterwards. Client-side filtering is a
 * UI convention, not a boundary. The inbox and the per-conversation history are
 * assembled and authorized on the gateway instead:
 * `lib/assignedPatients/assignmentsApi.ts` → `/assignments/inbox`,
 * `/assignments/conversation`.
 */

/**
 * Start an outbound call via RingOut (two-legged): RingCentral rings `from`
 * first, and once the rep picks up it dials the patient and bridges them.
 *
 * Deliberately NOT WebRTC. RingOut needs no browser softphone, no VoipCalling
 * scope, no per-rep RingCentral login and no Digital Line — so click-to-call
 * rides entirely on the gateway's existing JWT.
 *
 * ⚠️ `from` is the number RINGCENTRAL CALLS to reach the rep — it is NOT what
 * the patient sees. The patient sees `callerId`, which is always the MM number.
 * Passing the MM main number as `from` therefore rings the main line, and
 * whoever answers there gets bridged rather than the rep who clicked.
 *
 * There is no cancel: DELETE is excluded by both the gateway's method allowlist
 * and its CORS layer.
 */
export async function startRingOut(opts: { from: string; to: string; callerId?: string }): Promise<void> {
  const from = toE164(opts.from);
  const to = toE164(opts.to);
  if (!from) throw new Error("No valid number to ring you on");
  if (!to) throw new Error("No valid number to call");
  const body = JSON.stringify({
    from: { phoneNumber: from },
    to: { phoneNumber: to },
    callerId: { phoneNumber: toE164(opts.callerId || RC_SMS_FROM) },
    playPrompt: false,
  });
  const res = await rcFetch(`/restapi/v1.0/account/~/extension/~/ring-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res.ok) return;
  let msg = `RingCentral call failed (${res.status})`;
  try {
    const e = (await res.json()) as { message?: string; errors?: Array<{ message?: string }> };
    msg = e.errors?.[0]?.message || e.message || msg;
  } catch {
    /* keep default */
  }
  throw new Error(msg);
}

/** The number patients see on texts and calls from the Command Center. */
export function mmPhoneNumber(): string {
  return RC_SMS_FROM;
}

/**
 * Every call between the MM line and one patient, newest first.
 *
 * `view=Detailed` is NOT optional — it is what returns `legs`, and the legs are
 * the only way to tell that a claimed (forwarded) call was answered rather than
 * missed. See `callConnected` in lib/callHistory.
 *
 * ⚠️ `dateFrom` is explicit for the same reason `fetchUnreadFaxCount` sets it:
 * RingCentral's default window is roughly the last day, so without it a
 * patient's call history silently starts at "yesterday" (CLAUDE.md §5.5).
 */
export async function fetchPatientCallHistory(
  phone: string,
  opts: { sinceDays?: number; perPage?: number } = {},
): Promise<PatientCall[]> {
  const num = toE164(phone);
  if (!num) return [];
  const dateFrom = new Date(Date.now() - (opts.sinceDays ?? 365) * 24 * 60 * 60_000).toISOString();
  const path =
    `/restapi/v1.0/account/~/extension/~/call-log` +
    // ⚠️ DIGITS, not E.164 — a leading "+" makes this filter return an empty
    // list with a 200. See callLogPhoneParam. (`num` stays E.164 for the local
    // re-match below, which is what actually guarantees one patient's calls.)
    `?phoneNumber=${encodeURIComponent(callLogPhoneParam(num))}&type=Voice&view=Detailed` +
    // No `direction` filter: both directions is the default, and the history
    // wants both. Passing it twice worked but bought nothing.
    `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=${opts.perPage ?? 100}`;
  const res = await rcFetch(path);
  if (!res.ok) {
    // A 403 here is nearly always the app record, not the request: reading the
    // call log needs the ReadCallLog permission on the RingCentral OAuth app,
    // and RingCentral's own message for it is opaque. Name it, or this looks
    // like a bug in the app (CLAUDE.md §5.13 — RC permissions fail one at a
    // time and each one needs its own diagnosis).
    if (res.status === 403) {
      throw new Error(
        "RingCentral rejected the call-log read (403). The app record is probably missing the ReadCallLog permission.",
      );
    }
    throw new Error(`RingCentral call history failed (${res.status})`);
  }
  const json = (await res.json()) as { records?: RcCallLogRecord[] };
  return toPatientCalls(json.records ?? [], num);
}

/**
 * Download a call recording (through the gateway) and return a blob: URL.
 * Caller should URL.revokeObjectURL when done.
 *
 * Recordings are best-effort by design: the account has to actually record
 * calls, and the OAuth app needs ReadCallRecording. When either is missing the
 * call-log simply carries no `recording` and no button is drawn, so this only
 * runs for audio RingCentral has already told us exists.
 */
/** Bytes for any allowlisted RingCentral content URL — an MMS attachment, a
 *  fax page — as a blob URL the browser can render. The generic sibling of
 *  fetchRecordingBlobUrl below: same /rc/fetch proxy, none of the
 *  recording-specific error copy. Callers own revoking the URL. */
export async function fetchRcContentBlobUrl(contentUri: string): Promise<string> {
  if (!contentUri) throw new Error("No attachment content URL");
  const res = await rcFetch(contentUri);
  if (!res.ok) throw new Error(`RingCentral attachment download failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function fetchRecordingBlobUrl(contentUri: string): Promise<string> {
  if (!contentUri) throw new Error("No recording attached to this call");
  const res = await rcFetch(contentUri);
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        "RingCentral rejected the recording download (403). The app record is probably missing the ReadCallRecording permission.",
      );
    }
    throw new Error(`RingCentral recording download failed (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export interface InboundFax {
  id: number;
  fromNumber: string;
  fromName: string;
  fromLocation: string;
  creationTime: string;
  pages: number;
  read: boolean;
  attachmentUri: string;
  contentType: string;
}

export interface FaxPage {
  faxes: InboundFax[];
  hasMore: boolean;
  total: number;
}

/** List inbound faxes (newest first), paginated, looking back `sinceDays`. */
export async function fetchInboundFaxes(
  opts: { page?: number; perPage?: number; sinceDays?: number } = {},
): Promise<FaxPage> {
  const page = opts.page ?? 1;
  const perPage = opts.perPage ?? 50;
  const sinceDays = opts.sinceDays ?? 180;
  const dateFrom = new Date(Date.now() - sinceDays * 24 * 60 * 60_000).toISOString();
  const path =
    `/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=Fax&direction=Inbound&perPage=${perPage}&page=${page}&dateFrom=${encodeURIComponent(dateFrom)}`;
  const res = await rcFetch(path);
  if (!res.ok) throw new Error(`RingCentral fax inbox failed (${res.status})`);
  const json = (await res.json()) as {
    records?: Array<{
      id: number;
      creationTime?: string;
      readStatus?: string;
      faxPageCount?: number;
      from?: { phoneNumber?: string; name?: string; location?: string };
      attachments?: Array<{ uri?: string; contentType?: string }>;
    }>;
    paging?: { totalElements?: number };
  };
  const faxes = (json.records ?? [])
    .map((r) => ({
      id: r.id,
      fromNumber: r.from?.phoneNumber ?? "",
      fromName: (r.from?.name ?? "").trim(),
      fromLocation: (r.from?.location ?? "").trim(),
      creationTime: r.creationTime ?? "",
      pages: r.faxPageCount ?? 0,
      read: r.readStatus === "Read",
      attachmentUri: r.attachments?.[0]?.uri ?? "",
      contentType: r.attachments?.[0]?.contentType ?? "application/pdf",
    }))
    .sort((a, b) => new Date(b.creationTime).getTime() - new Date(a.creationTime).getTime());
  const total = json.paging?.totalElements ?? faxes.length;
  return { faxes, hasMore: page * perPage < total, total };
}

/** Mark a fax Read or Unread. */
export async function setFaxRead(id: number, read: boolean): Promise<void> {
  const res = await rcFetch(`/restapi/v1.0/account/~/extension/~/message-store/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ readStatus: read ? "Read" : "Unread" }),
  });
  if (!res.ok) throw new Error(`RingCentral mark ${read ? "read" : "unread"} failed (${res.status})`);
}

/** Download a fax PDF (through the gateway) and return a blob: URL. Caller
 *  should URL.revokeObjectURL when done. */
export async function fetchFaxBlobUrl(attachmentUri: string): Promise<string> {
  if (!attachmentUri) throw new Error("No fax document attached");
  const res = await rcFetch(attachmentUri);
  if (!res.ok) throw new Error(`RingCentral fax download failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
