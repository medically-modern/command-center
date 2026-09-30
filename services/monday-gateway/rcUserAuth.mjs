/**
 * rcUserAuth.mjs — each person's OWN RingCentral line in Command Center (§5.13c).
 *
 * Until this existed every browser provisioned its softphone with the gateway's
 * one JWT, which belongs to Katie's extension, so the whole team shared her
 * five SIP registrations (§5.13b). Here a person connects their own RingCentral
 * login once, and /messaging/sip-provision provisions THEIR extension instead.
 *
 *   POST /rc/user/connect     (signed in) → { url } of RingCentral's sign-in page
 *   GET  /rc/user/callback    RingCentral → here → back to the app
 *   GET  /rc/user/status      (signed in) → is this person connected, as whom
 *   POST /rc/user/disconnect  (signed in) → forget it
 *
 * ⚠️ A SECOND RingCentral app. The developer console allows ONE auth flow per
 * app, and the gateway's app is JWT — texting, faxing, the call webhook and
 * every archive sign in with it. Switching that app to the authorization-code
 * flow would take all of that down. This one is RC_USER_CLIENT_ID / _SECRET.
 *
 * ⚠️ Registered BEFORE registerRingCentral (index.mjs): that module's
 * `app.all(/^\/rc\/.+/)` proxy would otherwise answer /rc/user/* with "path not
 * allowed". The callback's address is registered on RingCentral's side, so the
 * path cannot simply move.
 *
 * ⚠️ Refresh tokens are sealed (AES-256-GCM) before they touch Postgres; access
 * tokens live in memory only. The key is RC_USER_TOKEN_KEY, or derived from
 * PHONE_HMAC_PEPPER under its own label so this needs no new secret.
 *
 * ⚠️ A connected person whose grant has died is NOT quietly put back on Katie's
 * line: that would spend one of her five registrations without anybody
 * knowing, which is the problem this module exists to end. Provisioning says
 * "connect again" instead, and the badge shows it.
 */
import { verifyGoogleIdentity } from "./auth.mjs";
import { rcApiFetch } from "./ringcentral.mjs";
import {
  authorizeUrl,
  deriveKey,
  dueForKeepAlive,
  extensionNumbers,
  grantIsDead,
  openToken,
  parseTokenResponse,
  safeReturnTo,
  sealToken,
  signState,
  verifyState,
  withOutcome,
} from "./rcUserAuthRules.mjs";

const RC_SERVER = (process.env.RC_SERVER || "https://platform.ringcentral.com").replace(/\/+$/, "");
const { RC_USER_CLIENT_ID, RC_USER_CLIENT_SECRET } = process.env;
const REDIRECT_URI =
  process.env.RC_USER_REDIRECT_URI ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/rc/user/callback` : "");
const SECRET = process.env.RC_USER_TOKEN_KEY || process.env.PHONE_HMAC_PEPPER || "";
const SEAL_KEY = deriveKey(SECRET, "mm-rc-user-token-v1");
const STATE_KEY = deriveKey(SECRET, "mm-rc-user-state-v1");
const KEEPALIVE_EVERY_MS = 6 * 60 * 60_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rc_user_links (
  email             TEXT PRIMARY KEY,        -- verified Google identity
  account_id        TEXT NOT NULL,
  extension_id      TEXT NOT NULL,
  extension_number  TEXT,
  extension_name    TEXT,
  staff_numbers     TEXT[] NOT NULL DEFAULT '{}', -- the extension's own DIDs (staff, not patients)
  refresh_sealed    TEXT NOT NULL,           -- AES-GCM; never the plain token
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  broken_at         TIMESTAMPTZ,             -- the grant died; the person must connect again
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** Thrown when a connected person's grant is gone. */
export class ReconnectNeeded extends Error {}

let _pool = null;
const _access = new Map(); // email → { token, expiresAt }
const _refreshing = new Map(); // email → Promise<string>
let _staffNumbers = new Set();

export function rcUserConfigured() {
  return !!(_pool && RC_USER_CLIENT_ID && RC_USER_CLIENT_SECRET && REDIRECT_URI && SEAL_KEY && STATE_KEY);
}

/** Every connected person's own numbers. inboundCalls.mjs treats a call FROM
 *  one of these as ours, as it does the main line — a rep dialling out from
 *  their own extension must not pop a card on everybody's screen. */
export function staffNumbers() {
  return [..._staffNumbers];
}

async function loadStaffNumbers() {
  if (!_pool) return;
  const r = await _pool.query(`SELECT staff_numbers FROM rc_user_links`);
  _staffNumbers = new Set(r.rows.flatMap((row) => row.staff_numbers || []));
}

function basicAuth() {
  return `Basic ${Buffer.from(`${RC_USER_CLIENT_ID}:${RC_USER_CLIENT_SECRET}`).toString("base64")}`;
}

async function tokenCall(params) {
  const r = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* not JSON */
  }
  return { status: r.status, ok: r.ok, body };
}

async function rcAs(token, path, init = {}) {
  return fetch(`${RC_SERVER}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
}

async function markBroken(email) {
  _access.delete(email);
  await _pool.query(`UPDATE rc_user_links SET broken_at = now(), updated_at = now() WHERE email = $1`, [email]);
}

/** Refresh one person's grant. One at a time per person: RingCentral ROTATES
 *  the refresh token, so two refreshes racing would leave one of them holding
 *  a token that no longer works. */
function refreshGrant(email, row) {
  const running = _refreshing.get(email);
  if (running) return running;
  const p = (async () => {
    const refreshToken = openToken(SEAL_KEY, row.refresh_sealed);
    if (!refreshToken) {
      await markBroken(email);
      throw new ReconnectNeeded("Your RingCentral connection can't be read — connect again");
    }
    const r = await tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (!r.ok) {
      if (grantIsDead(r.status, r.body)) {
        await markBroken(email);
        throw new ReconnectNeeded("Your RingCentral connection has expired — connect again");
      }
      throw new Error(`RingCentral sign-in refresh failed (${r.status})`);
    }
    const g = parseTokenResponse(r.body, Date.now());
    await _pool.query(
      `UPDATE rc_user_links SET refresh_sealed = $2, refresh_expires_at = $3, broken_at = NULL, updated_at = now()
        WHERE email = $1`,
      [email, sealToken(SEAL_KEY, g.refreshToken), new Date(g.refreshExpiresAt)],
    );
    _access.set(email, { token: g.accessToken, expiresAt: g.accessExpiresAt });
    return g.accessToken;
  })();
  _refreshing.set(email, p);
  return p.finally(() => _refreshing.delete(email));
}

/** This person's access token; null when they have not connected. */
async function accessTokenFor(email) {
  const cached = _access.get(email);
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const r = await _pool.query(`SELECT * FROM rc_user_links WHERE email = $1`, [email]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.broken_at) throw new ReconnectNeeded("Your RingCentral connection has expired — connect again");
  return refreshGrant(email, row);
}

/**
 * SIP credentials for a connected person's own extension.
 *
 * @returns {Promise<null | {status: number, body: object}>} null when this
 *   person has not connected (the caller provisions the shared line as before).
 */
export async function provisionOwnLine(email) {
  if (!rcUserConfigured() || !email) return null;
  let token;
  try {
    token = await accessTokenFor(email);
  } catch (e) {
    if (e instanceof ReconnectNeeded) return { status: 409, body: { error: e.message, reconnect: true } };
    throw e;
  }
  if (!token) return null;
  const go = (t) =>
    rcAs(t, "/restapi/v1.0/client-info/sip-provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sipInfo: [{ transport: "WSS" }] }),
    });
  let up = await go(token);
  if (up.status === 401) {
    _access.delete(email);
    const r = await _pool.query(`SELECT * FROM rc_user_links WHERE email = $1`, [email]);
    if (!r.rows[0]) return null;
    try {
      up = await go(await refreshGrant(email, r.rows[0]));
    } catch (e) {
      if (e instanceof ReconnectNeeded) return { status: 409, body: { error: e.message, reconnect: true } };
      throw e;
    }
  }
  let body = null;
  try {
    body = await up.json();
  } catch {
    body = { error: `RingCentral answered ${up.status}` };
  }
  return { status: up.ok ? 200 : up.status, body };
}

/** Keep every grant alive while nobody is asking — see REFRESH_WHEN_LEFT_MS. */
async function keepAlive() {
  if (!rcUserConfigured()) return;
  try {
    const r = await _pool.query(`SELECT * FROM rc_user_links WHERE broken_at IS NULL`);
    for (const row of r.rows) {
      if (!dueForKeepAlive(row.refresh_expires_at, Date.now())) continue;
      await refreshGrant(row.email, row).catch((e) =>
        console.warn(`rc_user keep-alive: ${row.email}: ${(e && e.message) || e}`),
      );
    }
  } catch (e) {
    console.warn("rc_user keep-alive failed:", (e && e.message) || e);
  }
}

/** The account the gateway's JWT belongs to — a person may only connect a
 *  login from the SAME RingCentral account. */
async function companyAccountId() {
  const res = await rcApiFetch("/restapi/v1.0/account/~/extension/~", {}, { caller: "rc-user-connect" });
  if (!res.ok) throw new Error(`could not read the company account (${res.status})`);
  const j = await res.json();
  return String((j.account && j.account.id) || "");
}

export function registerRcUserAuth({ app, pool, allowedOrigins }) {
  _pool = pool;
  if (!pool) {
    console.warn("WARN: rc_user links need ASSIGNMENTS_DATABASE_URL — per-person RingCentral lines are DISABLED");
  } else {
    pool
      .query(SCHEMA)
      .then(loadStaffNumbers)
      .catch((e) => console.error("rc_user_links schema failed:", e.message));
    if (!RC_USER_CLIENT_ID || !RC_USER_CLIENT_SECRET) {
      console.warn("WARN: RC_USER_CLIENT_ID / RC_USER_CLIENT_SECRET not set — per-person RingCentral lines are OFF");
    }
    setTimeout(() => void keepAlive(), 60_000).unref?.();
    setInterval(() => void keepAlive(), KEEPALIVE_EVERY_MS).unref?.();
  }

  async function who(req, res) {
    const u = await verifyGoogleIdentity(req.headers["x-mm-auth"]);
    const email = u ? String(u.email || "").toLowerCase() : "";
    if (!email) {
      res.status(401).json({ error: "Sign in required" });
      return null;
    }
    return email;
  }

  app.post("/rc/user/connect", async (req, res) => {
    const email = await who(req, res);
    if (!email) return;
    if (!rcUserConfigured()) return res.status(503).json({ error: "Per-person RingCentral lines are not set up on the gateway yet." });
    const returnTo = safeReturnTo(req.body && req.body.returnTo, allowedOrigins);
    if (!returnTo) return res.status(400).json({ error: "returnTo must be a page of the app" });
    const state = signState(STATE_KEY, { email, returnTo, now: Date.now() });
    res.json({ url: authorizeUrl({ server: RC_SERVER, clientId: RC_USER_CLIENT_ID, redirectUri: REDIRECT_URI, state }) });
  });

  app.get("/rc/user/callback", async (req, res) => {
    const st = verifyState(STATE_KEY, req.query && req.query.state, Date.now());
    const back = st && safeReturnTo(st.returnTo, allowedOrigins);
    if (!st || !back) return res.status(400).type("text/plain").send("This sign-in link has expired. Go back to Command Center and click Connect again.");
    const fail = (reason) => res.redirect(302, withOutcome(back, "error", reason));
    if (req.query.error) return fail(String(req.query.error_description || req.query.error));
    if (!rcUserConfigured()) return fail("Per-person lines are not set up on the gateway");
    try {
      const t = await tokenCall({ grant_type: "authorization_code", code: String(req.query.code || ""), redirect_uri: REDIRECT_URI });
      if (!t.ok) return fail(`RingCentral refused the sign-in (${t.status})`);
      const g = parseTokenResponse(t.body, Date.now());

      const extRes = await rcAs(g.accessToken, "/restapi/v1.0/account/~/extension/~");
      if (!extRes.ok) return fail(`Couldn't read your RingCentral extension (${extRes.status})`);
      const ext = await extRes.json();
      const accountId = String((ext.account && ext.account.id) || "");
      // ⚠️ Fail closed: a login from some other RingCentral account must never
      // become a line in ours.
      if (!accountId || accountId !== (await companyAccountId())) {
        return fail("That RingCentral login belongs to a different company account");
      }
      let numbers = [];
      try {
        const nr = await rcAs(g.accessToken, "/restapi/v1.0/account/~/extension/~/phone-number?perPage=100");
        if (nr.ok) numbers = extensionNumbers(await nr.json());
      } catch {
        /* best effort — only used to recognise our own outbound calls */
      }
      await _pool.query(
        `INSERT INTO rc_user_links
           (email, account_id, extension_id, extension_number, extension_name, staff_numbers, refresh_sealed, refresh_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (email) DO UPDATE SET
           account_id = EXCLUDED.account_id, extension_id = EXCLUDED.extension_id,
           extension_number = EXCLUDED.extension_number, extension_name = EXCLUDED.extension_name,
           staff_numbers = EXCLUDED.staff_numbers, refresh_sealed = EXCLUDED.refresh_sealed,
           refresh_expires_at = EXCLUDED.refresh_expires_at, broken_at = NULL,
           connected_at = now(), updated_at = now()`,
        [
          st.email,
          accountId,
          String(ext.id || g.ownerId),
          String(ext.extensionNumber || ""),
          String(ext.name || ""),
          numbers,
          sealToken(SEAL_KEY, g.refreshToken),
          new Date(g.refreshExpiresAt),
        ],
      );
      _access.set(st.email, { token: g.accessToken, expiresAt: g.accessExpiresAt });
      await loadStaffNumbers().catch(() => {});
      console.log(`rc_user connected: ${st.email} → ext ${ext.extensionNumber || "?"}`);
      res.redirect(302, withOutcome(back, "connected"));
    } catch (e) {
      console.error("rc_user callback failed:", (e && e.message) || e);
      fail("Something went wrong connecting RingCentral");
    }
  });

  app.get("/rc/user/status", async (req, res) => {
    const email = await who(req, res);
    if (!email) return;
    if (!rcUserConfigured()) return res.json({ configured: false, connected: false });
    try {
      const r = await _pool.query(
        `SELECT extension_number, extension_name, broken_at, connected_at FROM rc_user_links WHERE email = $1`,
        [email],
      );
      const row = r.rows[0];
      if (!row) return res.json({ configured: true, connected: false });
      res.json({
        configured: true,
        connected: true,
        broken: !!row.broken_at,
        extension: { number: row.extension_number || "", name: row.extension_name || "" },
      });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  app.post("/rc/user/disconnect", async (req, res) => {
    const email = await who(req, res);
    if (!email) return;
    if (!_pool) return res.json({ ok: true });
    try {
      const r = await _pool.query(`DELETE FROM rc_user_links WHERE email = $1 RETURNING refresh_sealed`, [email]);
      _access.delete(email);
      await loadStaffNumbers().catch(() => {});
      const token = r.rows[0] && openToken(SEAL_KEY, r.rows[0].refresh_sealed);
      // Best effort: the row is already gone, which is what stops us using it.
      if (token && RC_USER_CLIENT_ID) {
        void fetch(`${RC_SERVER}/restapi/oauth/revoke`, {
          method: "POST",
          headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
        }).catch(() => {});
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });
}
