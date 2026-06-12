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
