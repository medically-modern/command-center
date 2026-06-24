import { useEffect, useRef, useState } from "react";
import {
  authRequired,
  isAuthed,
  onAuthChange,
  loadGis,
  handleCredential,
  googleClientId,
  authDomain,
} from "@/lib/shared/auth";

/**
 * Wraps the app. When VITE_GOOGLE_CLIENT_ID is unset, renders children
 * unchanged (no gate). When set, requires a signed-in @domain Google account.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  // Hooks run unconditionally (authRequired() is a build-time constant).
  const [authed, setAuthed] = useState(() => !authRequired() || isAuthed());
  useEffect(() => {
    if (!authRequired()) return;
    return onAuthChange(() => setAuthed(isAuthed()));
  }, []);

  if (!authRequired()) return <>{children}</>;
  if (authed) return <>{children}</>;
  return <LoginScreen />;
}

/**
 * NOTE: there is intentionally NO background token refresh / SessionKeeper.
 * The signed-in session is identity-based (see auth.ts) and never lapses on its
 * own, and the gateway no longer requires a fresh token (/send enforcement was
 * removed). A background `google.accounts.id.prompt()` only popped Google One
 * Tap every few minutes — disruptive (especially with multiple Google accounts
 * signed in) and of no real value. The ID token simply expires; gateway
 * attribution falls back to the X-MM-User email header. Only manual sign-out
 * ends a session.
 */

function LoginScreen() {
  const btn = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled) return;
        const g = (window as unknown as { google: any }).google;
        g.accounts.id.initialize({
          client_id: googleClientId(),
          callback: (resp: { credential: string }) => {
            if (!handleCredential(resp.credential)) {
              setErr(`Please sign in with your @${authDomain()} account.`);
            }
          },
          hd: authDomain(),
          auto_select: false,
          cancel_on_tap_outside: false,
        });
        if (btn.current) {
          g.accounts.id.renderButton(btn.current, { theme: "filled_blue", size: "large", text: "signin_with", shape: "pill" });
        }
        g.accounts.id.prompt();
      })
      .catch(() => setErr("Couldn't load Google sign-in. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f1115", color: "#e6e6e6", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 380, padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Medically Modern · Command Center</h1>
        <p style={{ color: "#9aa4b2", marginBottom: 22, fontSize: 14 }}>
          Sign in with your <b>@{authDomain()}</b> Google account to continue.
        </p>
        <div ref={btn} style={{ display: "inline-block" }} />
        {err && <p style={{ color: "#ff6b6b", marginTop: 16, fontSize: 13 }}>{err}</p>}
      </div>
    </div>
  );
}
