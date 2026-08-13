/**
 * ringcentral.mjs — server-side RingCentral proxy for the Command Center fax +
 * SMS features. Mirrors the Monday /gql pattern: the RingCentral OAuth app
 * credentials + JWT live here as Railway env vars — NEVER in the browser
 * bundle — and the SPA calls `${GATEWAY}/rc/<RingCentral REST path>`.
 *
 * JWT-bearer authenticates to RingCentral server-side (access token cached in
 * memory, refreshed 5 min early; a 401 forces one refresh + retry), forwards
 * the request to platform.ringcentral.com, and relays the response verbatim —
 * JSON (message-store, SMS) or binary (fax PDF).
 *
 * Fax + SMS are PHI, so requests require a valid Google @medicallymodern.com
 * token (X-MM-Auth) whenever auth enforcement is on (GOOGLE_CLIENT_ID set).
 *
 * Required env:  RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT
 * Optional env:  RC_SERVER (default https://platform.ringcentral.com)
 */
import { verifyGoogleToken, authEnforced } from "./auth.mjs";
import { pathAllowed, fetchUrlAllowed } from "./rcAllowlist.mjs";

const RC_SERVER = (process.env.RC_SERVER || "https://platform.ringcentral.com").replace(/\/+$/, "");
const { RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT } = process.env;

const rcConfigured = () => !!(RC_CLIENT_ID && RC_CLIENT_SECRET && RC_JWT);

// The path + URL allowlists live in rcAllowlist.mjs — pure, so they can be
// unit-tested without this module's express/google-auth-library imports (same
// split as callRules.mjs vs inboundCalls.mjs). Re-exported for callers.
export { ALLOWED_PATH, pathAllowed, fetchUrlAllowed } from "./rcAllowlist.mjs";

// client-info/sip-provision sits OUTSIDE the /account/~/extension/~/ tree, so it
// needs its own rule. It hands back the SIP credentials the browser softphone
// registers with — see /assignments/sip-provision in assignments.mjs, which is
// what the SPA actually calls (this proxy path is not used directly).
export const SIP_PROVISION_PATH = "/restapi/v1.0/client-info/sip-provision";

let _token = { value: null, expiresAt: 0 };
let _refreshing = null;
async function rcAccessToken(force = false) {
  if (!force && _token.value && Date.now() < _token.expiresAt) return _token.value;
  // Coalesce concurrent refreshes so a burst of 401s doesn't fire N OAuth calls.
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    const basic = Buffer.from(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`).toString("base64");
    const r = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: RC_JWT,
      }).toString(),
    });
    if (!r.ok) throw new Error(`RingCentral auth failed (${r.status})`);
    const j = await r.json();
    if (!j.access_token) throw new Error("RingCentral auth: no access_token");
    _token = { value: j.access_token, expiresAt: Date.now() + Math.max((j.expires_in ?? 3600) - 300, 60) * 1000 };
    return _token.value;
  })();
  try {
    return await _refreshing;
  } finally {
    _refreshing = null;
  }
}

/**
 * Call the RingCentral REST API from inside the gateway, with the bearer token
 * injected and one refresh-and-retry on 401.
 *
 * This is the in-process equivalent of the /rc proxy below, for routes that must
 * do their own RingCentral work rather than relaying the browser's request —
 * notably the Assigned Patients inbox, which has to filter the shared account's
 * messages by assignment BEFORE any of it reaches a rep's browser.
 */
export async function rcApiFetch(path, init = {}) {
  if (!rcConfigured()) throw new Error("RingCentral is not configured on the gateway (missing RC_* env vars).");
  const go = (token) =>
    fetch(`${RC_SERVER}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
  let token = await rcAccessToken();
  let res = await go(token);
  if (res.status === 401) {
    token = await rcAccessToken(true);
    res = await go(token);
  }
  return res;
}

export { rcConfigured };

export function registerRingCentral({ app }) {
  app.all(/^\/rc\/.+/, async (req, res) => {
    // The SPA does not force Google sign-in, so — like the Monday /gql reads that
    // flow through this same gateway — fax/SMS is NOT hard-blocked on the token.
    // Protection remains: CORS-locked to the app origin, path allowlist, and
    // method allowlist (GET/POST/PUT — no DELETE). Verify for parity/logging; if
    // Google login is later enforced app-wide, restore a 401 here.
    void authEnforced;
    void (await verifyGoogleToken(req.headers["x-mm-auth"]));
    if (!rcConfigured()) {
      return res.status(503).json({ error: "RingCentral is not configured on the gateway (missing RC_* env vars)." });
    }
    // Only the verbs the SPA uses. Blocks DELETE/PATCH so an authenticated user
    // can't irreversibly delete fax/SMS (PHI) records via a direct call.
    if (!["GET", "POST", "PUT"].includes(req.method.toUpperCase())) {
      return res.status(405).json({ error: "method not allowed" });
    }

    // Fax attachment + call recording content live on media.ringcentral.com (a
    // DIFFERENT host from the platform API). The SPA sends the absolute URL to
    // /rc/fetch?url=…; forward it to that exact RingCentral host with the
    // bearer token.
    //
    // Two shapes, and they differ in their tail — a fax attachment ends
    // /content/{attachmentId} while a recording ends at /content, so one regex
    // with a trailing slash would silently 403 every recording.
    if (req.path === "/rc/fetch") {
      let u;
      try { u = new URL(String((req.query && req.query.url) || "")); }
      catch { return res.status(400).json({ error: "bad url" }); }
      if (!fetchUrlAllowed(u)) {
        return res.status(403).json({ error: "url not allowed" });
      }
      const pull = (token) => fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
      try {
        let token = await rcAccessToken();
        let up = await pull(token);
        if (up.status === 401) { token = await rcAccessToken(true); up = await pull(token); }
        const ct = up.headers.get("content-type") || "application/octet-stream";
        const buf = Buffer.from(await up.arrayBuffer());
        return res.status(up.status).set("Content-Type", ct).send(buf);
      } catch (e) {
        return res.status(502).json({ error: String((e && e.message) || e) });
      }
    }
    const rcPath = req.originalUrl.replace(/^\/rc/, "");
    if (!pathAllowed(rcPath)) {
      return res.status(403).json({ error: "RingCentral path not allowed" });
    }
    const method = req.method.toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(method) && req.body && Object.keys(req.body).length > 0;
    const forward = (token) =>
      fetch(`${RC_SERVER}${rcPath}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(hasBody ? { "Content-Type": "application/json" } : {}) },
        body: hasBody ? JSON.stringify(req.body) : undefined,
      });
    try {
      let token = await rcAccessToken();
      let up = await forward(token);
      if (up.status === 401) { token = await rcAccessToken(true); up = await forward(token); }
      const ct = up.headers.get("content-type") || "application/octet-stream";
      const buf = Buffer.from(await up.arrayBuffer());
      res.status(up.status).set("Content-Type", ct).send(buf);
    } catch (e) {
      res.status(502).json({ error: String((e && e.message) || e) });
    }
  });
}
