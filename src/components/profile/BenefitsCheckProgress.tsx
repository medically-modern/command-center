/**
 * The benefits check, in progress — the card that replaces a bare
 * "Running benefits check…" line on the intake page.
 *
 * Brandon, 2026-09-24: *"Can we make the 'Running benefits check…' on the
 * profile page a little sexier looking - it looks like 1990's arial font with
 * poor spacing"*. The line was a Tailwind `mt-2 text-xs` paragraph, and inside
 * `.pf-root` the page's own reset (`.pf-root * { margin:0 }`) out-specifies
 * that `mt-2`, so it sat flush against the button row in 12px grey. This is
 * the page's own design language instead — the `.stedi-running` card
 * `/profile` already draws for the same check — plus the three steps the run
 * really goes through, because that is what a rep watching it wants to know:
 * is it moving, and where is it.
 *
 * ⚠️ The steps are the hook's own PHASES (`useStediRun`), never a timer
 * pretending to be progress: saving to Monday, confirming it landed, then
 * asking the payer. A bar that crept forward on a clock would say "almost
 * done" about a check that has not reached the payer yet.
 *
 * ⚠️ Page classes only, no Tailwind spacing — the same `.pf-root` reset that
 * caused the original complaint would zero it (§9).
 */
import { useEffect, useState } from "react";
import type { StediPhase } from "@/hooks/profile/useStediRun";

/** The three things a run does, in order, keyed by the hook's phase. */
export const BENEFITS_CHECK_STEPS = [
  {
    phase: "writing",
    label: "Save details",
    title: "Saving details to Monday…",
    note: "Name, date of birth, insurance and Member ID are saved first — the payer is asked about what is on Monday, not what is on this screen.",
  },
  {
    phase: "verifying",
    label: "Confirm they saved",
    title: "Confirming they saved…",
    note: "If anything didn't land, the check stops here rather than asking the payer about the wrong details.",
  },
  {
    phase: "running",
    label: "Ask the payer",
    title: "Asking the payer…",
    note: "Results appear all at once when the payer answers — usually 20 to 40 seconds.",
  },
] as const;

/** Past this, the running step says it is taking longer than usual. */
export const SLOW_AFTER_SECONDS = 45;

/** `0:07`, `1:12` — the elapsed clock. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Seconds since `startedAt`, ticking once a second.
 *
 * ⚠️ Kept inside this small component on purpose: the intake page is several
 * thousand lines, and a one-second tick there would re-render all of it for
 * the length of every check.
 */
function useElapsed(startedAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return startedAt == null ? null : Math.max(0, (now - startedAt) / 1000);
}

export function BenefitsCheckProgress({
  phase,
  startedAt,
}: {
  phase: StediPhase;
  startedAt: number | null;
}) {
  const elapsed = useElapsed(startedAt);
  const at = BENEFITS_CHECK_STEPS.findIndex((s) => s.phase === phase);
  // A phase this card does not draw (idle, done, error) renders nothing: the
  // page mounts it only while this patient's check is running.
  if (at < 0) return null;
  const step = BENEFITS_CHECK_STEPS[at];
  const slow = phase === "running" && elapsed != null && elapsed >= SLOW_AFTER_SECONDS;

  return (
    <div className="stedi-running bcp">
      <span className="stedi-spinner" aria-hidden />
      <div className="bcp-body">
        <div className="bcp-top">
          {/* The live region is the title alone: the clock below changes every
              second, and a screen reader would read every one of them out. */}
          <div className="sr-title" role="status" aria-live="polite">{step.title}</div>
          {elapsed != null && (
            <span className="bcp-clock" aria-hidden>{formatElapsed(elapsed)}</span>
          )}
        </div>
        <ol className="bcp-steps" aria-label="Benefits check steps">
          {BENEFITS_CHECK_STEPS.map((s, i) => {
            const state = i < at ? "done" : i === at ? "now" : "todo";
            return (
              <li key={s.phase} className={`bcp-step ${state}`} aria-current={state === "now" ? "step" : undefined}>
                <span className="bcp-dot" aria-hidden>{state === "done" ? "✓" : i + 1}</span>
                <span>{s.label}</span>
              </li>
            );
          })}
        </ol>
        <div className="sugg-note">
          {slow
            ? "Taking longer than usual. If the payer hasn't answered after about a minute and a half, it stops waiting and shows whatever came back."
            : step.note}
        </div>
      </div>
    </div>
  );
}
