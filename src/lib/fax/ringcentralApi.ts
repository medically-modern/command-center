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
import type { RcFaxRecord } from "./faxOutcome";
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

/** Is RingCentral reachable at all? Every RC call goes through the gateway, so
 *  a build without one (local dev, direct mode) must not even try. */
export const RC_VIA_GATEWAY = GATEWAY.length > 0;

/**
 * Recent OUTBOUND faxes, newest first — the input to the "Fax Bad" badge.
 *
 * ⚠️ **One call for every patient on screen, not one call per patient.** The
 * badge renders on every masheke header, and a per-patient status lookup is the
 * shape that took the phone system down on 2026-08-20 (see
 * INCIDENT_2026-08-20_RINGCENTRAL.md). Callers fold this into a number→outcome
 * map once (`buildFaxOutcomes`) and every patient looks themselves up locally.
 *
 * Bounded on purpose: at most `maxPages` requests per refresh, and it stops
 * early on a short page. `dateFrom` is explicit because RingCentral's message
 * store otherwise defaults to roughly the last 24 hours — the same gotcha
 * `fetchUnreadFaxCount` documents.
 */
export async function fetchRecentOutboundFaxes({
  days = 14,
  maxPages = 3,
  perPage = 100,
}: { days?: number; maxPages?: number; perPage?: number } = {}): Promise<RcFaxRecord[]> {
  const dateFrom = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
  const out: RcFaxRecord[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const path =
      `/restapi/v1.0/account/~/extension/~/message-store` +
      `?messageType=Fax&direction=Outbound&dateFrom=${encodeURIComponent(dateFrom)}` +
      `&perPage=${perPage}&page=${page}`;
    const res = await rcFetch(path);
    if (!res.ok) throw new Error(`RingCentral outbound fax list failed (${res.status})`);
    const json = (await res.json()) as { records?: RcFaxRecord[] };
    const records = json.records ?? [];
    out.push(...records);
    if (records.length < perPage) break;
  }
  return out;
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

/** Mark a fax Read or Unread. Same write as `setMessageRead` below, which the
 *  text inbox uses — the message store does not distinguish by type here. */
export async function setFaxRead(id: number, read: boolean): Promise<void> {
  return setMessageRead(id, read);
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

/* ────────────────────────────────────────────────────────────────────────────
 * Account-wide activity, for the manager sidebars' contact marks.
 *
 * ⚠️ **These are the ONLY reads behind those marks, and that is the design.**
 * The marks render on every row of every patient sidebar; a lookup per patient
 * is precisely INCIDENT_2026-08-20_RINGCENTRAL.md. Callers fold one window of
 * activity into a number→state map once (`buildContactStates`) and every row
 * looks itself up locally — the same shape as `fetchRecentOutboundFaxes` and
 * the "Fax Bad" badge.
 * ──────────────────────────────────────────────────────────────────────────── */

/** How many pages of each read to take before giving up. Bounded on purpose:
 *  a window that keeps growing is a window that eventually costs a rep their
 *  RingCentral account. */
const ACTIVITY_MAX_PAGES = 6;

async function messageStorePage(
  messageType: string,
  dateFrom: string,
  perPage: number,
  page: number,
): Promise<Array<Record<string, unknown>>> {
  const path =
    `/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=${encodeURIComponent(messageType)}&dateFrom=${encodeURIComponent(dateFrom)}` +
    `&perPage=${perPage}&page=${page}`;
  const res = await rcFetch(path);
  if (!res.ok) throw new Error(`RingCentral ${messageType} activity failed (${res.status})`);
  const json = (await res.json()) as { records?: Array<Record<string, unknown>> };
  return json.records ?? [];
}

/**
 * Every inbound fax in the window, paged — what the Communications Hub's Fax
 * tab lists.
 *
 * ⚠️ Distinct from `fetchInboundFaxes`, which returns ONE page and a total for
 * the paginated `/fax-inbox` screen. The hub's list has no pager, so a single
 * page silently truncated it: reps saw exactly the newest 50 faxes and nothing
 * older, with no indication there was more (Josh, 2026-09-02). Paged the same
 * way the call and text activity reads are, and bounded by the same
 * `ACTIVITY_MAX_PAGES` so a busy line cannot turn one list into an unbounded
 * crawl.
 *
 * A short page is the last page — the same termination the other readers use,
 * so this needs no `totalElements` and cannot loop on a miscounted total.
 *
 * ⚠️ **30 days is not a choice, it is everything there is.** RingCentral's
 * message store is a rolling ~30-day window on this account (§5.27; confirmed
 * again 2026-09-02, when the oldest fax it held was 8/2). Asking for more costs
 * requests and returns nothing, and a fax older than that is gone from the
 * vendor — the archive covers texts, not fax pages.
 *
 * Its own page cap rather than `ACTIVITY_MAX_PAGES`: that one bounds a 7-14 day
 * activity read, and this is a 30-day window on a line that handles a great
 * many faxes. 12 × 250 is ~100 faxes a day for a month, and a normal day
 * finishes in one or two requests because a short page ends the loop.
 */
const FAX_MAX_PAGES = 12;

export async function fetchInboundFaxesAll(
  { sinceDays = 30, perPage = 250 }: { sinceDays?: number; perPage?: number } = {},
): Promise<InboundFax[]> {
  const out: InboundFax[] = [];
  for (let page = 1; page <= FAX_MAX_PAGES; page++) {
    const { faxes } = await fetchInboundFaxes({ page, perPage, sinceDays });
    out.push(...faxes);
    if (faxes.length < perPage) break;
  }
  return out;
}

async function messageStoreAll(
  messageType: string,
  days: number,
  perPage: number,
): Promise<Array<Record<string, unknown>>> {
  const dateFrom = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
  const out: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= ACTIVITY_MAX_PAGES; page++) {
    const records = await messageStorePage(messageType, dateFrom, perPage, page);
    out.push(...records);
    if (records.length < perPage) break; // a short page is the last page
  }
  return out;
}

/**
 * Every text on the MM line in the last `days` days, both directions.
 *
 * ⚠️ **Two requests, not one, and never the multi-value filter.** The
 * documented `messageType=SMS&messageType=MMS` syntax comes back **400 on this
 * account** — the same quirk the gateway's `/messaging/conversation` route
 * documents, where it broke the whole thread load. Omitting `messageType`
 * altogether works but drags in every Fax and VoiceMail row on a line that
 * handles a great many faxes, so the window is fetched one single-valued type
 * at a time instead.
 *
 * ⚠️ **MMS is best-effort and its failure is swallowed.** A patient who
 * answers with a photo sends an MMS, so dropping the type would report them as
 * never having replied — but if that read fails, degrading to "we missed one
 * photo reply" is strictly better than the whole column going blank.
 */
export async function fetchRecentMessageActivity({
  days = 7,
  perPage = 250,
}: { days?: number; perPage?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const sms = await messageStoreAll("SMS", days, perPage);
  let mms: Array<Record<string, unknown>> = [];
  try {
    mms = await messageStoreAll("MMS", days, perPage);
  } catch {
    /* see the header — a missing MMS page must not blank the whole column */
  }
  return [...sms, ...mms];
}

/**
 * Every voice call on the MM line in the last `days` days, both directions.
 *
 * `view=Detailed` is NOT optional — it is what returns `legs`, and the legs are
 * the only way to tell that a claimed (forwarded) call was answered rather than
 * missed (CLAUDE.md §5.13). Without it a call a rep actually took would show a
 * rose "they called and nobody picked up" mark.
 *
 * No `phoneNumber` filter: this read is deliberately account-wide, because the
 * alternative is one request per patient on screen.
 */
export async function fetchRecentCallActivity({
  days = 7,
  perPage = 100,
}: { days?: number; perPage?: number } = {}): Promise<RcCallLogRecord[]> {
  const dateFrom = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
  const out: RcCallLogRecord[] = [];
  for (let page = 1; page <= ACTIVITY_MAX_PAGES; page++) {
    const path =
      `/restapi/v1.0/account/~/extension/~/call-log` +
      `?type=Voice&view=Detailed&dateFrom=${encodeURIComponent(dateFrom)}` +
      `&perPage=${perPage}&page=${page}`;
    const res = await rcFetch(path);
    if (!res.ok) {
      // Same diagnosis as fetchPatientCallHistory: a 403 here is nearly always
      // the app record missing ReadCallLog, not the request.
      if (res.status === 403) {
        throw new Error(
          "RingCentral rejected the call-log read (403). The app record is probably missing the ReadCallLog permission.",
        );
      }
      throw new Error(`RingCentral call activity failed (${res.status})`);
    }
    const json = (await res.json()) as { records?: RcCallLogRecord[] };
    const records = json.records ?? [];
    out.push(...records);
    if (records.length < perPage) break;
  }
  return out;
}

async function putMessageRead(id: number, read: boolean): Promise<void> {
  const res = await rcFetch(`/restapi/v1.0/account/~/extension/~/message-store/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ readStatus: read ? "Read" : "Unread" }),
  });
  if (!res.ok) throw new Error(`RingCentral mark ${read ? "read" : "unread"} failed (${res.status})`);
}

/**
 * In-flight read-state write per message id — see `setMessageRead`.
 *
 * Bounded: an entry is deleted as soon as its own chain settles and nothing
 * newer has claimed the id.
 */
const readWrites = new Map<number, Promise<void>>();

/**
 * Mark any message-store record Read or Unread.
 *
 * The Communications Hub's text and fax lists use RingCentral's own
 * `readStatus` rather than a local flag, because reps also work this line in
 * the RingCentral desktop app — a locally-invented read state would disagree
 * with what they see there within a day.
 *
 * ⚠️ **Writes to the SAME message id are serialised, so the rep's last click
 * wins.** Two writes for one id are one click apart in the UI: mark a fax
 * unread and then open it (Greptile, PR #52), or mark a conversation unread and
 * then read it. Fired concurrently they race, and the loser can land LAST —
 * RingCentral ends up holding Unread while the optimistic override says Read,
 * so the row is hidden from the Unread filter and the override never retires,
 * because pruning keeps exactly the entries RingCentral disagrees with. That is
 * a permanent local lie, which is the one thing reading `readStatus` instead of
 * a local flag exists to prevent.
 *
 * ⚠️ A failed write does NOT block the next one (`.catch` before the chain
 * continues) — the rep's newer intent must still reach RingCentral. Different
 * ids are untouched and still go in parallel, which is what keeps
 * `Promise.all(unreadIds.map(...))` a single round of requests.
 */
export function setMessageRead(id: number, read: boolean): Promise<void> {
  const prev = readWrites.get(id);
  const next: Promise<void> = prev
    ? prev.then(
        () => putMessageRead(id, read),
        () => putMessageRead(id, read),
      )
    : putMessageRead(id, read);
  readWrites.set(id, next);
  // Cleanup rides its OWN chain so it can't turn the caller's rejection into an
  // unhandled one, and only the newest write may release the id.
  void next.catch(() => {}).then(() => {
    if (readWrites.get(id) === next) readWrites.delete(id);
  });
  return next;
}

export interface VoicemailRecord {
  id: number;
  fromNumber: string;
  fromName: string;
  creationTime: string;
  read: boolean;
  /** Seconds, from the audio attachment. 0 when RingCentral didn't say. */
  durationSec: number;
  /** Audio, for the player. Fetched through /rc/fetch like a fax page. */
  audioUri: string;
  /**
   * RingCentral's transcription state — `Completed`, `CompletedPartially`,
   * `InProgress`, `NotAvailable`, `Failed`, `TimedOut`, or "" when the account
   * returns nothing at all.
   */
  transcriptionStatus: string;
  /** Attachment holding the transcript text, when RingCentral produced one. */
  transcriptUri: string;
}

/**
 * Inbound voicemails, newest first.
 *
 * ⚠️ **The transcription half is written defensively and has NOT been verified
 * against this account.** RingCentral returns voicemail transcripts as a
 * `text/plain` attachment alongside the audio, with `vmTranscriptionStatus` on
 * the record saying whether one exists — but transcription is a per-account
 * feature that may simply be off here, in which case the status comes back
 * `NotAvailable` and there is no text attachment. That degrades to "no
 * transcript" in the UI rather than erroring, which is the same posture
 * `fetchPatientCallHistory` takes for absent recordings: an account that
 * doesn't produce them is the NORMAL case, not a fault.
 *
 * `dateFrom` is explicit for the reason `fetchUnreadFaxCount` documents — the
 * message store otherwise defaults to roughly the last day.
 */
export async function fetchVoicemails(
  opts: { perPage?: number; sinceDays?: number } = {},
): Promise<VoicemailRecord[]> {
  const perPage = opts.perPage ?? 50;
  const dateFrom = new Date(Date.now() - (opts.sinceDays ?? 30) * 24 * 60 * 60_000).toISOString();
  const path =
    `/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=VoiceMail&direction=Inbound&perPage=${perPage}&dateFrom=${encodeURIComponent(dateFrom)}`;
  const res = await rcFetch(path);
  if (!res.ok) throw new Error(`RingCentral voicemail list failed (${res.status})`);
  const json = (await res.json()) as {
    records?: Array<{
      id: number;
      creationTime?: string;
      readStatus?: string;
      vmTranscriptionStatus?: string;
      from?: { phoneNumber?: string; name?: string };
      attachments?: Array<{ id?: number; type?: string; contentType?: string; uri?: string; vmDuration?: number }>;
    }>;
  };
  return (json.records ?? [])
    .map((r) => {
      const atts = r.attachments ?? [];
      const audio = atts.find((a) => /^audio\//i.test(a.contentType || "") || a.type === "AudioRecording");
      // The transcript is the text part. Matched on contentType rather than on
      // `type`, whose value for a transcript we have not seen on this account.
      const transcript = atts.find((a) => /^text\//i.test(a.contentType || ""));
      return {
        id: r.id,
        fromNumber: r.from?.phoneNumber ?? "",
        fromName: (r.from?.name ?? "").trim(),
        creationTime: r.creationTime ?? "",
        read: r.readStatus === "Read",
        durationSec: Number(audio?.vmDuration ?? 0),
        audioUri: audio?.uri ?? "",
        transcriptionStatus: String(r.vmTranscriptionStatus ?? ""),
        transcriptUri: transcript?.uri ?? "",
      };
    })
    .sort((a, b) => new Date(b.creationTime).getTime() - new Date(a.creationTime).getTime());
}

/**
 * The text of a voicemail transcript.
 *
 * Returns "" rather than throwing when the account produced none — see
 * `fetchVoicemails`. The attachment URI is the allowlisted
 * `/message-store/{id}/content/{attachmentId}` shape, so it needs no gateway
 * change (`rcAllowlist.fetchUrlAllowed`).
 */
export async function fetchVoicemailTranscript(transcriptUri: string): Promise<string> {
  if (!transcriptUri) return "";
  try {
    const res = await rcFetch(transcriptUri);
    if (!res.ok) return "";
    return (await res.text()).trim();
  } catch {
    return "";
  }
}
