/**
 * Google Workspace auth for the gateway.
 *
 * When GOOGLE_CLIENT_ID is set, the gateway verifies the Google ID token the
 * SPA sends (header `X-MM-Auth`): real signature, issued for our app, not
 * expired, and from the @AUTH_DOMAIN Workspace. The verified email becomes the
 * audit "actor", and writes (mutations + /send) REQUIRE a valid token.
 *
 * Unset → no enforcement (a token is still verified+logged if present). Deploy
 * the code first; switch enforcement on by setting GOOGLE_CLIENT_ID only after
 * the SPA login is live and tested — otherwise writes without a token 401.
 */
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const DOMAIN = (process.env.AUTH_DOMAIN || "medicallymodern.com").toLowerCase();
const client = CLIENT_ID ? new OAuth2Client(CLIENT_ID) : null;

export function authEnforced() {
  return !!CLIENT_ID;
}

/* ── Identity verification that ignores expiry ──────────────────────────────
 *
 * SIGN-IN IS A GATE, NOT A TICKING TOKEN (CLAUDE.md §5.4). The SPA keeps the
 * signed-in identity forever and has NO background refresh, so the Google ID
 * token it forwards is routinely hours or days past `exp`. verifyGoogleToken()
 * below uses google-auth-library's verifyIdToken, which enforces `exp` — fine
 * for best-effort attribution on /gql, fatal for any route that hard-blocks on
 * identity, because every rep 401s about an hour after signing in.
 *
 * This mirrors the worker's verifyIdToken (worker/src/index.js): verify the
 * RS256 signature against Google's published keys, check issuer / audience /
 * Workspace domain, and deliberately IGNORE `exp` and `iat`. The security
 * property is unchanged — the token still has to be a genuine, unmodified
 * Google token minted for this app, for a verified @DOMAIN account.
 *
 * ⚠️ Google rotates its signing keys every day or two and drops retired ones
 * from the published JWKS, so a token whose `kid` has aged out cannot be
 * verified at all — the failure the worker hit in Aug 2026. Every key we have
 * ever seen is therefore retained in memory and used as a fallback.
 * Limitation vs the worker: the worker persists these in the Cache API, so its
 * retention survives restarts. Ours is per-process, so a gateway redeploy drops
 * the retained set and a rep whose sign-in predates the current JWKS has to
 * sign in again. If that starts happening, persist this map.
 */
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_TTL_MS = 60 * 60_000;
let _jwks = { keys: [], fetchedAt: 0 };
const _retainedKeys = new Map(); // kid → jwk, never evicted

async function googleSigningKeys() {
  if (_jwks.keys.length && Date.now() - _jwks.fetchedAt < JWKS_TTL_MS) return _jwks.keys;
  try {
    const r = await fetch(JWKS_URL);
    if (!r.ok) return _jwks.keys;
    const j = await r.json();
    const keys = Array.isArray(j.keys) ? j.keys : [];
    if (keys.length) {
      _jwks = { keys, fetchedAt: Date.now() };
      for (const k of keys) if (k.kid) _retainedKeys.set(k.kid, k);
    }
  } catch {
    /* keep whatever we already have rather than going blind */
  }
  return _jwks.keys;
}

const b64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * Verified @DOMAIN email for a genuinely-Google-signed ID token, however old.
 * Returns null when the token is missing, forged, for another app, or from
 * another domain. Use this for routes that BLOCK on identity.
 */
export async function verifyGoogleIdentity(idToken) {
  if (!idToken) return null;
  try {
    const tok = String(idToken).replace(/^Bearer\s+/i, "");
    const [h, p, sig] = tok.split(".");
    if (!h || !p || !sig) return null;
    const header = JSON.parse(b64url(h).toString("utf8"));
    const claims = JSON.parse(b64url(p).toString("utf8"));

    const jwk = (await googleSigningKeys()).find((k) => k.kid === header.kid) || _retainedKeys.get(header.kid);
    if (!jwk) return null;
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, b64url(sig));
    if (!ok) return null;

    if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") return null;
    if (CLIENT_ID && claims.aud !== CLIENT_ID) return null;

    const email = String(claims.email || "").toLowerCase();
    const hd = String(claims.hd || "").toLowerCase();
    const verified = claims.email_verified === true || claims.email_verified === "true";
    if (!verified) return null;
    if (DOMAIN && hd !== DOMAIN && !email.endsWith("@" + DOMAIN)) return null;

    // `exp` / `iat` intentionally not checked — see the note above.
    return { email, name: claims.name || email, sub: claims.sub, picture: claims.picture };
  } catch {
    return null;
  }
}

/** Returns { email, name } for a valid @DOMAIN token, else null.
 *  ⚠️ Enforces `exp`. For anything that BLOCKS on identity use
 *  verifyGoogleIdentity() instead — see the note above. */
export async function verifyGoogleToken(idToken) {
  if (!client || !idToken) return null;
  const tok = String(idToken).replace(/^Bearer\s+/i, "");
  try {
    const ticket = await client.verifyIdToken({ idToken: tok, audience: CLIENT_ID });
    const p = ticket.getPayload();
    if (!p || p.email_verified === false) return null;
    const email = (p.email || "").toLowerCase();
    const hd = (p.hd || "").toLowerCase();
    if (DOMAIN && hd !== DOMAIN && !email.endsWith("@" + DOMAIN)) return null;
    return { email, name: p.name || email, sub: p.sub, picture: p.picture };
  } catch {
    return null;
  }
}
