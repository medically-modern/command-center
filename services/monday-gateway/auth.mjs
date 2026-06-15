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
import { OAuth2Client } from "google-auth-library";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const DOMAIN = (process.env.AUTH_DOMAIN || "medicallymodern.com").toLowerCase();
const client = CLIENT_ID ? new OAuth2Client(CLIENT_ID) : null;

export function authEnforced() {
  return !!CLIENT_ID;
}

/** Returns { email, name } for a valid @DOMAIN token, else null. */
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
