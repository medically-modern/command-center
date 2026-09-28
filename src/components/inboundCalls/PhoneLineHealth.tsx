/**
 * "Is RingCentral actually connecting in everyone's browser?" — the readout
 * (Josh, 2026-09-28: *"i need a way to monitor if rc is correctly connecting in
 * everyones browsers"*).
 *
 * ⚠️ **Why a panel and not a log line.** Browser answering fails SILENTLY and
 * per person: an assigned answerer whose browser cannot register looks exactly
 * like a quiet afternoon from every other seat in the company, including the
 * gateway's (the SIP socket does not pass through it — §5.13b). The only way
 * anyone found out was a rep saying so. This puts all five in one place, next
 * to the assignment that put them there.
 *
 * ⚠️ **The verdicts are the GATEWAY's** (`phonePresenceRules.mjs`), never
 * re-derived here: a page that decided "healthy" for itself would eventually
 * disagree with the alert that wakes somebody. This renders what it is told.
 *
 * ⚠️ Read-only, deliberately. `callAnswerers` is edited by the "Answers calls"
 * chip on each person's Abilities row and nowhere else — the second control
 * onto that list was removed on 2026-09-23, and this is not it coming back.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, PhoneCall, PhoneOff, RefreshCw, TriangleAlert } from "lucide-react";
import { fetchPhoneHealth, inboundCallsConfigured, type PhoneHealth } from "@/lib/inboundCalls/callsApi";

/** Slow on purpose: this is a status board, not a live call path, and the
 *  browsers themselves only report once a minute. One timer. */
const POLL_MS = 30_000;

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)}h`;
}

/** One browser's machine, as far as we can honestly name it. */
function machine(ua: string | null): string {
  const s = ua || "";
  const os = /Windows/.test(s) ? "Windows" : /Mac OS X/.test(s) ? "Mac" : /CrOS/.test(s) ? "ChromeOS" : /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iOS" : "";
  // ⚠️ Edge and Chrome both say "Chrome"; Edge's own token comes last, so it
  // has to be tested first or every Edge browser is reported as Chrome — and
  // "they're on Chrome" is the kind of wrong detail that costs an hour.
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox/.test(s) ? "Firefox" : /Chrome/.test(s) ? "Chrome" : /Safari/.test(s) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(" · ") || "Unknown browser";
}

/**
 * ⚠️ `hsl(var(--token))`, never a bare `var(--token)` — §5.40's trap, and this
 * panel fell into it: the shadcn tokens hold HSL COMPONENTS ("215 16% 45%"),
 * not colours, so `background: var(--muted-foreground)` is an invalid value
 * that computes to `rgba(0,0,0,0)` — and the fallback in `var(…, #8b8b8b)`
 * never fires, because the variable is defined, just not a colour. Measured in
 * Chromium, not reasoned about: the "no browser open" dot was invisible in
 * both themes while the other three rendered fine.
 *
 * The three status colours are literals on purpose: red/amber/green here must
 * read the same as the badge and the call cards (§5.13b), which use the same
 * Tailwind values.
 */
const TONE: Record<string, string> = {
  connected: "#10b981",
  waiting: "#f59e0b",
  trouble: "#ef4444",
  gone: "hsl(var(--muted-foreground))",
};

export default function PhoneLineHealth({ answerers }: { answerers: string[] }) {
  const [health, setHealth] = useState<PhoneHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = answerers.join(",");

  const load = useCallback(async () => {
    if (!inboundCallsConfigured()) return;
    setLoading(true);
    try {
      setHealth(await fetchPhoneHealth(key ? key.split(",") : []));
      setError(null);
    } catch (e) {
      // ⚠️ A failed READ must say so rather than render an empty, healthy-
      // looking board — that is the same trap this panel exists to close.
      setError((e as Error).message || "Couldn't read the phone line's health");
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!inboundCallsConfigured()) return null;

  const people = health?.people ?? [];
  return (
    <section className="card pad">
      <div className="row small" style={{ fontWeight: 600, marginBottom: 4, alignItems: "center", gap: 8 }}>
        <PhoneCall style={{ width: 14, height: 14 }} /> Browser answering — live
        <span className="xs muted" style={{ fontWeight: 400 }}>
          {health ? `${health.connected} of ${health.assigned} connected` : ""}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="btn ghost sm"
          style={{ marginLeft: "auto" }}
          title="Check again now"
        >
          {loading ? (
            <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
          ) : (
            <RefreshCw style={{ width: 13, height: 13 }} />
          )}
        </button>
      </div>
      <div className="xs muted" style={{ marginBottom: 10 }}>
        Each browser reports once a minute. <b>No browser open</b> is normal — people go home; it is a browser that is
        open and <b>still can't ring</b> that needs looking at. RingCentral allows five registered devices in total,
        and the RingCentral desktop app counts against them.
      </div>

      {error && (
        <div className="xs" style={{ color: "#ef4444", marginBottom: 8 }}>
          <TriangleAlert style={{ width: 12, height: 12, verticalAlign: "-2px" }} /> {error}
        </div>
      )}

      {!error && people.length === 0 && (
        <p className="xs muted">
          Nobody is assigned to answer calls in the browser yet — turn on <b>Answers calls</b> on somebody's card below.
        </p>
      )}

      {people.map((p) => (
        <div key={p.email} className="row" style={{ alignItems: "flex-start", gap: 8, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: TONE[p.state] || TONE.gone,
              marginTop: 6,
              flex: "0 0 auto",
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="small" style={{ fontWeight: 600 }}>
              {p.email}
              {p.connected ? "" : p.state === "trouble" ? " — can't ring" : ""}
            </div>
            <div className="xs muted">
              {p.label}
              {p.state !== "gone" && p.heldFor > 0 ? ` · ${ago(p.heldFor)}` : ""}
            </div>
            {/* Every browser of theirs, because a second one that is registered
                is holding one of RingCentral's five whether or not anybody
                remembers it is open. */}
            {p.browsers.length > 1 &&
              p.browsers.map((b) => (
                <div key={b.instanceId} className="xs muted" style={{ paddingLeft: 10 }}>
                  · {machine(b.userAgent)} — {b.label}
                </div>
              ))}
          </div>
        </div>
      ))}

      {!!health?.unassigned && (
        <div className="xs muted" style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
          <PhoneOff style={{ width: 12, height: 12 }} />
          {health.unassigned} browser{health.unassigned === 1 ? "" : "s"} reporting from somebody who is no longer
          assigned. A registered one still takes a slot until that tab is closed.
        </div>
      )}
    </section>
  );
}
