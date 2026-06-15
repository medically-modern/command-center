/**
 * Google Workspace sign-in for the SPA (Google Identity Services).
 *
 * Active ONLY when VITE_GOOGLE_CLIENT_ID is set. Unset → the app behaves
 * exactly as before, no login gate (so this is safe to ship before you've set
 * up the OAuth client). On sign-in we keep the Google ID token (a JWT) and send
 * it to the gateway, which verifies it server-side and attributes every write.
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
    if (!u?.token || !u.exp || u.exp * 1000 < Date.now()) return null;
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
  if (current && current.exp * 1000 < Date.now()) {
    current = null;
    store(null);
  }
  return current;
}
export function getIdToken(): string | null {
  return getUser()?.token ?? null;
}
export function isAuthed(): boolean {
  return !!getUser();
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
