/**
 * Single source of truth for WHERE Monday GraphQL requests go.
 *
 * Phase 1 (transparent gateway):
 *   Set VITE_MONDAY_GATEWAY_URL to the Railway gateway base URL. Every gql()
 *   in the app then POSTs to `${gateway}/gql`; the gateway injects the Monday
 *   token server-side, logs the request to Postgres, and forwards to Monday
 *   unchanged.
 *
 * Unset (default):
 *   The app calls api.monday.com directly with the bundled VITE_MONDAY_API_TOKEN,
 *   exactly as before. This makes the gateway opt-in and instantly reversible —
 *   flip one env var and rebuild, with zero code changes.
 *
 * Why this is one file: the frontend changes constantly. Routing/auth live here
 * so a query/column/board change never has to think about the gateway, and a
 * cutover or rollback is a single switch instead of a sweep across modules.
 */

import { getIdToken, getUser } from "./auth";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

/** True when traffic is routed through our gateway instead of api.monday.com. */
export const MONDAY_VIA_GATEWAY = GATEWAY.length > 0;

/** The GraphQL endpoint every module's gql() should fetch.
 *  Gateway mode → `${gateway}/gql`; otherwise Monday directly. */
export const MONDAY_API_URL = MONDAY_VIA_GATEWAY
  ? `${GATEWAY}/gql`
  : "https://api.monday.com/v2";

/** Best-effort identity of the person on this device, for the audit log.
 *  There is no auth today, so this is whatever the UI has stored. It stays
 *  empty until a name picker writes localStorage["mm-actor"]. */
export function mondayActor(): string {
  try {
    return localStorage.getItem("mm-actor") || "";
  } catch {
    return "";
  }
}

/**
 * Identity headers for a gateway request: WHO is making this call. In gateway
 * mode, attaches the signed-in user's email (X-MM-User) and their Google ID
 * token (X-MM-Auth, which the gateway verifies server-side). Falls back to the
 * stored actor. Empty in direct mode.
 *
 * Spread `...mondayIdentityHeaders()` into every module's gql() headers so the
 * audit log attributes EVERY write — inline notes, attempts, status saves —
 * not just the main /send flow.
 */
export function mondayIdentityHeaders(): Record<string, string> {
  if (!MONDAY_VIA_GATEWAY) return {};
  const h: Record<string, string> = {};
  const token = getIdToken();
  if (token) h["X-MM-Auth"] = token;
  const email = getUser()?.email || mondayActor();
  if (email) h["X-MM-User"] = email;
  return h;
}

/**
 * Auth/identity headers for a Monday GraphQL request.
 *
 * Phase 1 keeps sending the bundled token in BOTH modes (the gateway ignores
 * it), so adopting the gateway is a pure endpoint switch. In gateway mode it
 * also attaches the actor so writes can be attributed in the audit log.
 *
 * Phase 1b (full secret removal) = stop including the token below and drop the
 * VITE_MONDAY_API_TOKEN build secret. Nothing else changes.
 */
export function mondayAuthHeaders(): Record<string, string> {
  const token = (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = token;
  if (MONDAY_VIA_GATEWAY) {
    const actor = mondayActor();
    if (actor) headers["X-MM-User"] = actor;
  }
  return headers;
}

/** Whether the app has a usable path to Monday (gateway configured, or a token). */
export function hasMondayAuth(): boolean {
  const token = (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
  return MONDAY_VIA_GATEWAY || !!token;
}
