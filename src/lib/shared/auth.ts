/**
 * Google Workspace sign-in for the SPA (Google Identity Services).
 *
 * Active ONLY when VITE_GOOGLE_CLIENT_ID is set. Unset → the app behaves
 * exactly as before, no login gate (so this is safe to ship before you've set
 * up the OAuth client). On sign-in we keep the Google ID token (a JWT) and send
 * it to the gateway, which verifies it server-side and attributes every write.
 *
 * SIGN-IN IS A GATE, NOT A TICKING TOKEN. Google ID tokens always expire ~1h
 * after they're issued, that lifetime can't be extended, and there is NO
 * background refresh (see the note in AuthGate.tsx — it only popped One Tap). So
 * we treat the stored IDENTITY as the session: once a valid @domain account
 * signs in, it stays signed in until the user explicitly signs out. The (often
 * expired) ID token is still sent for best-effort gateway attribution, but
 * nothing blocks on its freshness: Monday writes fall back to the client path
 * (verifiedWrite.ts), and the worker /send-message verifies the token's
 * SIGNATURE + domain rather than its expiry (worker/src/index.js verifyIdToken),
 * so a signed-in rep can send all session without re-authenticating.
 */

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || "";
const DOMAIN = (import.meta.env.VITE_AUTH_DOMAIN as string | undefined) || "medicallymodern.com";
const LS_KEY = "mm-auth";

export function authRequired(): boolean {
  return CLIENT_ID.length > 0;
}
export function authDomain(): string {
  return DOMAIN;
}
export function googleClientId(): string {
  return CLIENT_ID;
}

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
  exp: number; // seconds since epoch
  token: string; // the Google ID token (JWT)
}

let current: AuthUser | null = loadStored();
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}
export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function loadStored(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as AuthUser;
    // The gate persists on IDENTITY, not on token freshness. As long as a valid
    // @domain account has signed in on this device, keep them signed in — an
    // expired ID token must never drop the session. (token/exp are still kept
    // for best-effort gateway attribution + background refresh.)
    if (!u?.email) return null;
    return u;
  } catch {
    return null;
  }
}
function store(u: AuthUser | null) {
  try {
    if (u) localStorage.setItem(LS_KEY, JSON.stringify(u));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* storage disabled */
  }
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
}

/** GIS credential callback. Validates the domain client-side (the gateway
 *  re-validates authoritatively) and stores the session. */
export function handleCredential(idToken: string): boolean {
  try {
    const p = decodeJwt(idToken) as { email?: string; name?: string; picture?: string; exp?: number; hd?: string };
    const email = String(p.email || "").toLowerCase();
    const okDomain = p.hd === DOMAIN || email.endsWith("@" + DOMAIN);
    if (!okDomain) {
      current = null;
      store(null);
      notify();
      return false;
    }
    current = { email, name: p.name || email, picture: p.picture, exp: p.exp || 0, token: idToken };
    store(current);
    notify();
    return true;
  } catch {
    return false;
  }
}

export function getUser(): AuthUser | null {
  // No expiry check: the signed-in identity IS the gate and never lapses on its
  // own — only signOut() (user-initiated) clears it. Token freshness is a
  // separate concern handled by tokenIsFresh() / the background SessionKeeper.
  return current;
}
/** Whether the stored ID token is still within its ~1h validity window. The
 *  session does NOT depend on this — it only tells callers whether the token
 *  is currently usable for server-side verification (gateway attribution). */
export function tokenIsFresh(): boolean {
  return !!current?.token && current.exp * 1000 > Date.now();
}
export function getIdToken(): string | null {
  return getUser()?.token ?? null;
}
export function isAuthed(): boolean {
  return !!getUser();
}
/** Initials of the signed-in user, from their Google display name (e.g.
 *  "Josh Hoffman" → "JH"). Empty when signed out. Read straight from the
 *  session so comments don't have to compute/store it each time. */
export function userInitials(): string {
  const name = (getUser()?.name || "").trim();
  if (!name) return "";
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const raw = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return raw.toUpperCase();
}
export function signOut(): void {
  current = null;
  store(null);
  try {
    (window as unknown as { google?: { accounts?: { id?: { disableAutoSelect?: () => void } } } })
      .google?.accounts?.id?.disableAutoSelect?.();
  } catch {
    /* ignore */
  }
  notify();
}

/** Load the Google Identity Services script once. */
let gisPromise: Promise<void> | null = null;
export function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if ((window as unknown as { google?: { accounts?: unknown } }).google?.accounts) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
  return gisPromise;
}
