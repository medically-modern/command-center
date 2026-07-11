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

const RC_SERVER = (process.env.RC_SERVER || "https://platform.ringcentral.com").replace(/\/+$/, "");
const { RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT } = process.env;

const rcConfigured = () => !!(RC_CLIENT_ID && RC_CLIENT_SECRET && RC_JWT);

// Only the RingCentral paths the SPA actually uses (message-store reads/writes,
// fax PDF content, SMS send). Keeps this from becoming an open proxy to the
// rest of the account's RingCentral API.
const ALLOWED_PATH =
  /^\/restapi\/v1\.0\/account\/[^/]+\/extension\/[^/]+\/(message-store|sms)(\/|\?|$)/;

let _token = { value: null, expiresAt: 0 };
async function rcAccessToken(force = false) {
  if (!force && _token.value && Date.now() < _token.expiresAt) return _token.value;
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
}

export function registerRingCentral({ app }) {
  app.all(/^\/rc\/.+/, async (req, res) => {
    const gUser = await verifyGoogleToken(req.headers["x-mm-auth"]);
    if (authEnforced() && !gUser) {
      return res.status(401).json({ error: "Sign in with your medicallymodern.com account is required." });
    }
    if (!rcConfigured()) {
      return res.status(503).json({ error: "RingCentral is not configured on the gateway (missing RC_* env vars)." });
    }
    const rcPath = req.originalUrl.replace(/^\/rc/, "");
    if (!ALLOWED_PATH.test(rcPath.split("?")[0])) {
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
