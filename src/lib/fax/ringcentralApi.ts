/**
 * RingCentral — unread fax count for the FAX dashboard role.
 *
 * Auth: JWT bearer grant (client id/secret + JWT credential), same
 * client-side credential pattern the app uses for Monday/GitHub tokens.
 * Access tokens (~1h) are cached in localStorage and refreshed 5 minutes
 * before expiry; a 401 clears the cache and retries once.
 *
 * The count is the JWT user's extension message store:
 *   GET /restapi/v1.0/account/~/extension/~/message-store
 *       ?messageType=Fax&readStatus=Unread&availability=Alive&dateFrom=<180d ago>
 * → paging.totalElements (dateFrom is required — the API defaults to ~24h)
 */

const RC_SERVER =
  (import.meta.env.VITE_RC_SERVER as string | undefined) ||
  "https://platform.ringcentral.com";
// Prefer VITE_RC_* (injected by deploy.yml from Actions secrets — the clean
// path for the new RC app's credentials, which must NOT be committed here).
// The hardcoded fallbacks are the original app's, long since public in git
// history (see CLAUDE.md §10) and kept only so local dev works out of the box.
const RC_CLIENT_ID =
  (import.meta.env.VITE_RC_CLIENT_ID as string | undefined) ||
  "c2Fi3EZsRLPdAwT6F2bqzI";
const RC_CLIENT_SECRET =
  (import.meta.env.VITE_RC_CLIENT_SECRET as string | undefined) ||
  "5W9jWwnFCmYfnsUT7br4dN3LYVP8dDodGfsqHjTiuAXo";
const RC_JWT =
  (import.meta.env.VITE_RC_JWT as string | undefined) ||
  "eyJraWQiOiI4NzYyZjU5OGQwNTk0NGRiODZiZjVjYTk3ODA0NzYwOCIsInR5cCI6IkpXVCIsImFsZyI6IlJTMjU2In0.eyJhdWQiOiJodHRwczovL3BsYXRmb3JtLnJpbmdjZW50cmFsLmNvbS9yZXN0YXBpL29hdXRoL3Rva2VuIiwic3ViIjoiNjMwMDcyMTQwMTIiLCJpc3MiOiJodHRwczovL3BsYXRmb3JtLnJpbmdjZW50cmFsLmNvbSIsImV4cCI6MzkyMzg1MzEzOSwiaWF0IjoxNzc2MzY5NDkyLCJqdGkiOiJPV1c3eDFwb1JmQ1ZWTUQzbW5YTkVnIn0.OTfHaduIt0OfZKmG9lU61aZmUGQY-_YJ2myd4uEFHuLHFRsZjyHaEGZT-BBgmY1ubAGfUMTqMTOa9o9ZcwcjNdo1Y2XL-YddrWbsmKSfH-aOsXemQaX34AkS-6QX9-6sehLge_d1eN8S4Z_spR_NhvT6zhNWcCtDdh0hAMEP9ZulkO5Q9BSJb-qNhwBEefrbFxEHKd6C-DcO_bLq2g-nt6mo3w-EYlgDA8TO-0zRE-iR63mVVURXwnQ0Ie8qoseEN55yZO-p78nPw2_xRiBDtmcTf87f6gdwjlGf37yfej-JpPZzj9jwkI2h3pvBQCJYYgh7eU-hRiVRkvRh-_ppng";

const LS_TOKEN_KEY = "rc-token-cache";

interface CachedToken {
  token: string;
  /** epoch ms after which the token must be refreshed */
  expiresAt: number;
}

function loadCachedToken(): CachedToken | null {
  try {
    const raw = localStorage.getItem(LS_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    if (!parsed.token || Date.now() >= parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistToken(token: string, expiresInSec: number): void {
  try {
    const cached: CachedToken = {
      token,
      // refresh 5 minutes before RingCentral expires it
      expiresAt: Date.now() + Math.max(expiresInSec - 300, 60) * 1000,
    };
    localStorage.setItem(LS_TOKEN_KEY, JSON.stringify(cached));
  } catch {
    /* private browsing / quota — fall back to per-call tokens */
  }
}

function clearCachedToken(): void {
  try {
    localStorage.removeItem(LS_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function getAccessToken(): Promise<string> {
  const cached = loadCachedToken();
  if (cached) return cached.token;

  const res = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: RC_JWT,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`RingCentral auth failed (${res.status})`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("RingCentral auth: no access token in response");
  persistToken(json.access_token, json.expires_in ?? 3600);
  return json.access_token;
}

/** Number of unread faxes in the message store. Throws on failure —
 *  callers should keep the previous count rather than showing 0. */
export async function fetchUnreadFaxCount(): Promise<number> {
  // RingCentral's message store defaults to ~the last 24h when no dateFrom is
  // given, so unread faxes older than a day (e.g. over a weekend) get dropped
  // and the bar under-counts. Look back the same window as the Fax Inbox
  // (fetchInboundFaxes, 180 days) so the count reflects every unread fax.
  const dateFrom = new Date(Date.now() - 180 * 24 * 60 * 60_000).toISOString();
  const url =
    `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=Fax&readStatus=Unread&availability=Alive&direction=Inbound` +
    `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=1`;

  const call = async (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  let res = await call(await getAccessToken());
  if (res.status === 401) {
    // Stale/revoked token — refresh once and retry.
    clearCachedToken();
    res = await call(await getAccessToken());
  }
  if (!res.ok) throw new Error(`RingCentral message-store failed (${res.status})`);

  const json = (await res.json()) as {
    paging?: { totalElements?: number };
    records?: unknown[];
  };
  return json.paging?.totalElements ?? json.records?.length ?? 0;
}

export type FaxStatus = "Queued" | "Sent" | "Failed";
export interface OutboundFaxStatus {
  status: FaxStatus;
  /** When RC queued the fax (ISO). */
  creationTime: string;
  /** When the status last changed — i.e. when it became Sent (ISO). */
  lastModifiedTime: string;
  id: number;
}

/** Real status of the outbound fax we sent to `toNumber` at/around `sinceIso`.
 *  Our faxes go email → <number>@rcfax.com → RingCentral, which lands them in
 *  this extension's message store as an Outbound Fax, so we can read the true
 *  Queued → Sent (or SendingFailed) status without changing how we send.
 *  Returns null when RC hasn't registered the fax yet (caller treats as
 *  "processing"). Matches by recipient (last 10 digits) + send time. */
export async function fetchOutboundFaxStatus(
  toNumber: string | undefined,
  sinceIso: string | undefined,
): Promise<OutboundFaxStatus | null> {
  const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
  const want = last10(toNumber || "");
  if (want.length < 10) return null;
  // The window is based on real UTC "now", NOT the stored send time. Monday
  // returns requestSentAt as a TIMEZONE-NAIVE local (ET) string (e.g.
  // "2026-06-23 17:21"), so new Date() on it is hours off in a non-ET browser —
  // which previously pushed the window past the fax's creationTime and left the
  // pill stuck on "Processing". We poll within minutes of sending, so the most
  // recent outbound fax to this recipient in the last 12h is the one we sent.
  void sinceIso;
  const dateFrom = new Date(Date.now() - 12 * 60 * 60_000).toISOString();
  const url =
    `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=Fax&direction=Outbound&dateFrom=${encodeURIComponent(dateFrom)}&perPage=50`;

  const call = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  let res = await call(await getAccessToken());
  if (res.status === 401) {
    clearCachedToken();
    res = await call(await getAccessToken());
  }
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
    .sort((a, b) => new Date(b.creationTime!).getTime() - new Date(a.creationTime!).getTime())[0]; // most recent
  if (!rec) return null;

  const raw = rec.messageStatus || "";
  const status: FaxStatus = /sent|delivered/i.test(raw)
    ? "Sent"
    : /fail|error/i.test(raw)
      ? "Failed"
      : "Queued";
  return {
    status,
    creationTime: rec.creationTime || sinceIso,
    lastModifiedTime: rec.lastModifiedTime || rec.creationTime || sinceIso,
    id: rec.id,
  };
}

const RC_SMS_FROM = (import.meta.env.VITE_RC_SMS_FROM as string | undefined) || "+13475037148";

function toE164(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  if (d.length === 10) return "+1" + d;
  return (raw || "").trim().startsWith("+") ? (raw || "").trim() : d ? "+" + d : "";
}

/** Send an SMS via RingCentral from the MM SMS number — replaces the old sms:
 *  link that opened iMessage. Client-side (same JWT auth as the fax reads; the
 *  OAuth app carries the SMS scope). Throws with RingCentral's message on error.
 *
 *  Gotcha — RC 500s on sends that actually go out: this account's send API
 *  returns a bare `500 Internal Server Error. Consult RC Support.` while STILL
 *  accepting the message (it lands in the message store as Queued and delivers
 *  ~30s later). Reproduced identically on two separate OAuth apps (2026-07), so
 *  it isn't app-record specific. If we surfaced that 500 as a failure, the rep
 *  would hit Send again and double-text the patient — so on a 5xx we read the
 *  message store back and treat a matching just-created outbound SMS as success. */
export async function sendSms(to: string, text: string): Promise<void> {
  const toNum = toE164(to);
  if (!toNum) throw new Error("No valid recipient number");
  if (!text.trim()) throw new Error("Message is empty");
  const body = JSON.stringify({
    from: { phoneNumber: RC_SMS_FROM },
    to: [{ phoneNumber: toNum }],
    text: text.trim(),
  });
  const sentAt = Date.now();
  const call = (token: string) =>
    fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/sms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    });
  let res = await call(await getAccessToken());
  if (res.status === 401) {
    clearCachedToken();
    res = await call(await getAccessToken());
  }
  if (res.ok) return;
  // Only server errors get the read-back check — a 4xx means RC rejected the
  // request outright and no message was created.
  if (res.status >= 500 && (await confirmSmsAccepted(toNum, text.trim(), sentAt))) return;
  let msg = `RingCentral SMS failed (${res.status})`;
  try {
    const e = (await res.json()) as { message?: string; errors?: Array<{ message?: string }> };
    msg = e.errors?.[0]?.message || e.message || msg;
  } catch {
    /* keep default */
  }
  throw new Error(msg);
}

/** After a 5xx from the send endpoint, check whether RC accepted the message
 *  anyway: look for an outbound SMS to this recipient with this exact text
 *  created since just before our POST. The store indexes within a few seconds,
 *  so poll briefly. Any read failure counts as "not confirmed" — the caller
 *  then surfaces the original send error. */
async function confirmSmsAccepted(toNum: string, text: string, sentAtMs: number): Promise<boolean> {
  const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
  const want = last10(toNum);
  // 60s of slack absorbs clock skew between the browser and RC's servers.
  const dateFrom = new Date(sentAtMs - 60_000).toISOString();
  const url =
    `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=SMS&direction=Outbound&phoneNumber=${encodeURIComponent(toNum)}` +
    `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=20`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
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
  /** Message body (RC stores SMS text in the message-store `subject` field). */
  text: string;
  /** ISO creation time. */
  time: string;
  from: string;
  to: string;
}

/** Fetch the full SMS conversation with one phone number, oldest → newest (for
 *  chat display). Same message-store endpoint + JWT auth as the fax reads. */
export async function fetchSmsConversation(phone: string, perPage = 100): Promise<SmsMessage[]> {
  const num = toE164(phone);
  if (!num) return [];
  const dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();
  const url =
    `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=SMS&phoneNumber=${encodeURIComponent(num)}&dateFrom=${encodeURIComponent(dateFrom)}&perPage=${perPage}`;

  const call = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  let res = await call(await getAccessToken());
  if (res.status === 401) {
    clearCachedToken();
    res = await call(await getAccessToken());
  }
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
  const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
  const want = last10(num);
  return (json.records ?? [])
    // The phoneNumber filter is broad; keep only messages with this number on
    // either side.
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
    }))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

export interface InboundFax {
  id: number;
  /** Sender fax number (E.164). */
  fromNumber: string;
  /** Caller-ID / sending office name when RingCentral has it (often the
   *  doctor office; sometimes "Possible spam call"). */
  fromName: string;
  /** Sender geographic location, when present. */
  fromLocation: string;
  /** ISO received time. */
  creationTime: string;
  pages: number;
  read: boolean;
  /** RC content URL for the fax PDF (needs the Bearer token to download). */
  attachmentUri: string;
  contentType: string;
}

export interface FaxPage {
  faxes: InboundFax[];
  hasMore: boolean;
  total: number;
}

/** List inbound faxes (newest first), paginated. RingCentral's message store
 *  defaults to ~the last 24h when no dateFrom is given (why only ~today showed),
 *  so we explicitly look back `sinceDays` (default 180) and page through. */
export async function fetchInboundFaxes(
  opts: { page?: number; perPage?: number; sinceDays?: number } = {},
): Promise<FaxPage> {
  const page = opts.page ?? 1;
  const perPage = opts.perPage ?? 50;
  const sinceDays = opts.sinceDays ?? 180;
  const dateFrom = new Date(Date.now() - sinceDays * 24 * 60 * 60_000).toISOString();
  const url =
    `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=Fax&direction=Inbound&perPage=${perPage}&page=${page}&dateFrom=${encodeURIComponent(dateFrom)}`;
  const call = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  let res = await call(await getAccessToken());
  if (res.status === 401) {
    clearCachedToken();
    res = await call(await getAccessToken());
  }
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

/** Mark a fax Read or Unread in the RingCentral message store. */
export async function setFaxRead(id: number, read: boolean): Promise<void> {
  const url = `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store/${id}`;
  const call = (token: string) =>
    fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ readStatus: read ? "Read" : "Unread" }),
    });
  let res = await call(await getAccessToken());
  if (res.status === 401) {
    clearCachedToken();
    res = await call(await getAccessToken());
  }
  if (!res.ok) throw new Error(`RingCentral mark ${read ? "read" : "unread"} failed (${res.status})`);
}

/** Download a fax's PDF (auth required) and return a blob: URL for in-app
 *  viewing/download. The caller should URL.revokeObjectURL when done. */
export async function fetchFaxBlobUrl(attachmentUri: string): Promise<string> {
  if (!attachmentUri) throw new Error("No fax document attached");
  const call = (token: string) => fetch(attachmentUri, { headers: { Authorization: `Bearer ${token}` } });
  let res = await call(await getAccessToken());
  if (res.status === 401) {
    clearCachedToken();
    res = await call(await getAccessToken());
  }
  if (!res.ok) throw new Error(`RingCentral fax download failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
