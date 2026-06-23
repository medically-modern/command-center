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
 *       ?messageType=Fax&readStatus=Unread&availability=Alive
 * → paging.totalElements
 */

const RC_SERVER =
  (import.meta.env.VITE_RC_SERVER as string | undefined) ||
  "https://platform.ringcentral.com";
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
  const url =
    `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=Fax&readStatus=Unread&availability=Alive&direction=Inbound&perPage=1`;

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
  if (want.length < 10 || !sinceIso) return null;
  const since = new Date(sinceIso.replace(/\s+UTC$/, "Z").replace(" ", "T"));
  if (Number.isNaN(since.getTime())) return null;
  // Look back a few minutes for clock skew between our stamp and RingCentral's.
  const dateFrom = new Date(since.getTime() - 5 * 60_000).toISOString();
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
    .filter((r) => !!r.creationTime && new Date(r.creationTime!).getTime() >= since.getTime() - 5 * 60_000)
    .sort((a, b) => new Date(a.creationTime!).getTime() - new Date(b.creationTime!).getTime())[0];
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
 *  OAuth app carries the SMS scope). Throws with RingCentral's message on error. */
export async function sendSms(to: string, text: string): Promise<void> {
  const toNum = toE164(to);
  if (!toNum) throw new Error("No valid recipient number");
  if (!text.trim()) throw new Error("Message is empty");
  const body = JSON.stringify({
    from: { phoneNumber: RC_SMS_FROM },
    to: [{ phoneNumber: toNum }],
    text: text.trim(),
  });
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
  if (!res.ok) {
    let msg = `RingCentral SMS failed (${res.status})`;
    try {
      const e = (await res.json()) as { message?: string; errors?: Array<{ message?: string }> };
      msg = e.errors?.[0]?.message || e.message || msg;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
}
