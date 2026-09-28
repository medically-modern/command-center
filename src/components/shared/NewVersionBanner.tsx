/**
 * "A new version of the Command Center is ready" — the reload nudge (§5.54).
 *
 * A deploy never reaches an open tab (buildVersion.ts says why, and what it
 * cost on 2026-09-28). This asks the deployment every few minutes — and the
 * moment a rep comes back to the tab — whether a newer build is live, and if
 * so offers the reload.
 *
 * ⚠️ **It never reloads by itself.** An automatic reload would drop a live
 * call (the audio is in the page, §5.13b) and throw away whatever a rep is
 * halfway through typing. It asks, and it keeps asking: "Later" snoozes for
 * half an hour and then the nudge comes back, because the entire failure it
 * exists for is a tab nobody reloads for days.
 *
 * ⚠️ **Reload is refused during a call** in this browser — reloading the tab
 * that holds the phone ends the call for the patient on the line.
 *
 * Bottom-centre, deliberately: toasts own top-centre and a nudge that sat
 * there for half an hour would cover the search box; the call cards own
 * top-right, the call overlay bottom-right, and the line-status notes
 * bottom-left.
 */
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSoftphone } from "@/hooks/softphone/useSoftphone";
import { CHECK_EVERY_MS, SNOOZE_MS, fetchDeployedEntry, isNewerBuild, runningEntry } from "@/lib/shared/buildVersion";

/** A burst of tab switches must not become a burst of fetches. */
const MIN_GAP_MS = 60_000;

export default function NewVersionBanner() {
  const phone = useSoftphone();
  const [newer, setNewer] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [, wake] = useState(0);
  const lastCheck = useRef(0);
  // Read once: which build THIS document loaded never changes for its life.
  const [running] = useState(() => (typeof document === "undefined" ? null : runningEntry(document)));

  useEffect(() => {
    // Dev server, tests, or already known to be stale: nothing to ask.
    if (!running || newer) return;
    let stopped = false;
    const check = async () => {
      const now = Date.now();
      if (now - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = now;
      const deployed = await fetchDeployedEntry(import.meta.env.BASE_URL, now);
      if (!stopped && isNewerBuild(running, deployed)) setNewer(true);
    };
    // ONE timer (INCIDENT_2026-08-20's rule), plus the moment the rep comes
    // back to the tab — which is exactly when a days-old tab matters.
    const id = setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, newer]);

  // Bring the nudge back when the snooze runs out — one timer, only while
  // a snooze is actually pending.
  useEffect(() => {
    const left = snoozedUntil - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => wake((n) => n + 1), left + 50);
    return () => clearTimeout(id);
  }, [snoozedUntil]);

  if (!newer || Date.now() < snoozedUntil) return null;
  const onCall = !!phone.call;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] pointer-events-none" role="status" aria-live="polite">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-xl text-sm text-foreground">
        <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
        <span className="whitespace-nowrap">A new version is ready</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          disabled={onCall}
          title={onCall ? "Finish your call first — reloading this tab would end it" : "Reload to get the latest version"}
          className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}
          title="Remind me in 30 minutes"
          className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          Later
        </button>
      </div>
    </div>
  );
}
