import { useEffect, useRef, useState } from "react";
import {
  authRequired,
  isAuthed,
  onAuthChange,
  loadGis,
  handleCredential,
  googleClientId,
  authDomain,
  getUser,
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
  if (authed)
    return (
      <>
        <SessionKeeper />
        {children}
      </>
    );
  return <LoginScreen />;
}

/**
 * Keeps the Google session alive so reps aren't kicked out ~hourly when the ID
 * token expires. Silently re-issues a fresh credential ~5 min before expiry (and
 * on window focus when close to expiry) via GIS auto-select. Best-effort and
 * additive: if a silent refresh can't happen, the session just expires as before
 * and the login screen returns — it never makes things worse.
 */
function SessionKeeper() {
  useEffect(() => {
    if (!authRequired()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inited = false;

    const ensureInit = async () => {
      await loadGis();
      if (cancelled || inited) return;
      const g = (window as unknown as { google: any }).google;
      g.accounts.id.initialize({
        client_id: googleClientId(),
        callback: (resp: { credential: string }) => {
          if (handleCredential(resp.credential)) schedule();
        },
        hd: authDomain(),
        auto_select: true,
        cancel_on_tap_outside: false,
      });
      inited = true;
    };

    const refresh = async () => {
      await ensureInit();
      if (cancelled) return;
      try {
        // Silent re-sign-in (auto_select) — fires the callback with a fresh
        // credential when the user's Google session is still alive.
        (window as unknown as { google: any }).google.accounts.id.prompt();
      } catch {
        /* GIS unavailable — session will expire as before */
      }
    };

    function schedule() {
      if (timer) clearTimeout(timer);
      const u = getUser();
      if (!u) return;
      const msLeft = u.exp * 1000 - Date.now();
      // 5 min before expiry; min 30s out so we never loop tightly.
      timer = setTimeout(() => void refresh(), Math.max(msLeft - 5 * 60_000, 30_000));
    }

    const onFocus = () => {
      const u = getUser();
      if (u && u.exp * 1000 - Date.now() < 10 * 60_000) void refresh();
    };

    void ensureInit().then(() => {
      if (!cancelled) schedule();
    });
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return null;
}

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
