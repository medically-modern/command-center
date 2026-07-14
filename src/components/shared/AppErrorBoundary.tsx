/**
 * Last-resort error boundary around the WHOLE app (mounted in main.tsx).
 *
 * Without it, any uncaught render error unmounts the React root and the user
 * gets a silent blank white page (the 2026-07-14 incident: a stale tab's
 * lazy-chunk 404 took the entire app down with no message). chunkReload.ts
 * auto-reloads the first chunk failure; everything else — including a second
 * consecutive chunk failure — lands here and gets a visible Reload screen.
 *
 * Inline styles on purpose (matching AuthGate's LoginScreen): this screen must
 * render even when the app is too broken to rely on anything else.
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Console only — never ship render errors anywhere that could log PHI.
    console.error("AppErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || String(this.state.error);
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f1115", color: "#e6e6e6", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Command Center hit an error</h1>
          <p style={{ color: "#9aa4b2", marginBottom: 8, fontSize: 14 }}>
            This usually happens when a new version was deployed while this tab
            was open. Reloading almost always fixes it.
          </p>
          <p style={{ color: "#6b7482", marginBottom: 22, fontSize: 12, wordBreak: "break-word" }}>{message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: "#2563eb", color: "#fff", border: 0, borderRadius: 999, padding: "10px 28px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
