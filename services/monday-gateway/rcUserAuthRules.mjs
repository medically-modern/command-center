/**
 * rcUserAuthRules.mjs — the pure half of the per-person RingCentral sign-in
 * (rcUserAuth.mjs, §5.13c). Split out for the reason callRules.mjs is: the
 * route module imports express, pg and the Google verifier, and these are the
 * decisions worth testing on their own — the key derivation, the sealed token,
 * the signed state and the return-address check.
 */
import crypto from "node:crypto";

/** How long a Connect click has to come back through RingCentral's sign-in. */
export const STATE_TTL_MS = 15 * 60_000;

/** Refresh a person's RingCentral grant when this little of it is left. The
 *  browser caches its SIP credentials for 7 days (registration.ts) and so may
 *  not ask the gateway for anything all week — without a keep-alive the grant
 *  lapses and the person has to connect again every week. */
export const REFRESH_WHEN_LEFT_MS = 4 * 24 * 60 * 60_000;

/** An access token is renewed this long before it expires. */
export const ACCESS_SKEW_MS = 5 * 60_000;

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * A 32-byte key for one purpose, derived from the gateway's secret.
 *
 * ⚠️ One label per use. The sealing key and the state-signing key come from the
 * same secret, and HKDF with distinct labels is what keeps them independent.
 */
export function deriveKey(secret, label) {
  if (!secret) return null;
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(String(secret)), Buffer.alloc(0), Buffer.from(label), 32));
}

/** AES-256-GCM. `v1.<iv>.<tag>.<ciphertext>`, base64url. */
export function sealToken(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(String(plaintext), "utf8"), c.final()]);
  return `v1.${b64url(iv)}.${b64url(c.getAuthTag())}.${b64url(ct)}`;
}

/** The plaintext, or null when the value was not sealed with this key. */
export function openToken(key, sealed) {
  try {
    const [v, iv, tag, ct] = String(sealed || "").split(".");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key, fromB64url(iv));
    d.setAuthTag(fromB64url(tag));
    return Buffer.concat([d.update(fromB64url(ct)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * The `state` that rides through RingCentral's sign-in page.
 *
 * ⚠️ It carries WHO clicked Connect, because the callback arrives as a plain
 * browser redirect with no X-MM-Auth header. Signed so nobody can mint one
 * that attaches their RingCentral login to somebody else's email.
 */
export function signState(key, { email, returnTo, now }) {
  const payload = b64url(
    JSON.stringify({ e: String(email).toLowerCase(), r: returnTo, x: now + STATE_TTL_MS, n: b64url(crypto.randomBytes(9)) }),
  );
  const sig = b64url(crypto.createHmac("sha256", key).update(payload).digest());
  return `${payload}.${sig}`;
}

/** `{ email, returnTo }`, or null for a forged, altered or expired state. */
export function verifyState(key, state, now) {
  try {
    const [payload, sig] = String(state || "").split(".");
    if (!payload || !sig) return null;
    const want = crypto.createHmac("sha256", key).update(payload).digest();
    const got = fromB64url(sig);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    const j = JSON.parse(fromB64url(payload).toString("utf8"));
    if (typeof j.x !== "number" || now > j.x) return null;
    if (!j.e) return null;
    return { email: String(j.e), returnTo: typeof j.r === "string" ? j.r : "" };
  } catch {
    return null;
  }
}

/**
 * Where the callback may send the browser afterwards: a page of the app, and
 * nothing else. ⚠️ Without this the callback is an open redirect wearing our
 * domain.
 */
export function safeReturnTo(raw, allowedOrigins) {
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!allowedOrigins.includes(u.origin)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * The return address with the outcome on it, in the QUERY rather than the
 * hash: the app's router owns the hash, and `window.location.search` reads the
 * same under either router.
 */
export function withOutcome(returnTo, outcome, reason = "") {
  const u = new URL(returnTo);
  u.searchParams.delete("rc");
  u.searchParams.delete("rcReason");
  u.searchParams.set("rc", outcome);
  if (reason) u.searchParams.set("rcReason", reason.slice(0, 120));
  return u.toString();
}

export function authorizeUrl({ server, clientId, redirectUri, state }) {
  const u = new URL(`${server}/restapi/oauth/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

/** RingCentral's token response → what we keep. Throws on a response we
 *  cannot use, so a half-grant is never stored. */
export function parseTokenResponse(j, now) {
  if (!j || !j.access_token || !j.refresh_token) throw new Error("RingCentral returned no usable grant");
  const accessMs = Math.max(60, Number(j.expires_in) || 3600) * 1000;
  const refreshMs = Math.max(60, Number(j.refresh_token_expires_in) || 7 * 24 * 3600) * 1000;
  return {
    accessToken: String(j.access_token),
    accessExpiresAt: now + accessMs - ACCESS_SKEW_MS,
    refreshToken: String(j.refresh_token),
    refreshExpiresAt: now + refreshMs,
    ownerId: j.owner_id != null ? String(j.owner_id) : "",
  };
}

/** Does this refresh failure mean the grant is dead (the person must connect
 *  again), rather than RingCentral having a bad moment? */
export function grantIsDead(status, body) {
  if (status === 400 || status === 401) return true;
  const code = String((body && (body.error || body.errorCode)) || "");
  return /invalid_grant|OAU-2\d\d/i.test(code);
}

/** A grant due for the keep-alive. */
export function dueForKeepAlive(refreshExpiresAt, now) {
  const at = refreshExpiresAt instanceof Date ? refreshExpiresAt.getTime() : Number(refreshExpiresAt);
  return Number.isFinite(at) && at - now < REFRESH_WHEN_LEFT_MS;
}

/** The E.164 numbers on an extension's phone-number list. */
export function extensionNumbers(j) {
  const records = Array.isArray(j && j.records) ? j.records : [];
  return [...new Set(records.map((r) => String((r && r.phoneNumber) || "").trim()).filter((n) => /^\+\d{8,15}$/.test(n)))];
}
