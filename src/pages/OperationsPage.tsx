import { useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3 } from "lucide-react";

/**
 * Reports & Metrics — deliberately EMPTY (§5.46b).
 *
 * Josh, 2026-09-22: *"Reports and metrics - just say No reports available yet -
 * and have a blank screen"*.
 *
 * ⚠️ **It was borrowing another tool.** Until today this route rendered
 * `OperationsTab` — the baseline-vs-live burndown — under the name "Reports &
 * Metrics", which is §5.39b's own recorded compromise: *"a tab opening a real
 * page under a borrowed name beats one opening an empty shell"*. That reads as
 * a finished feature to anybody who has not read this file, so nobody ever asks
 * for the real one, and a rep looking for operations finds it under a name it
 * does not have. An honest empty page is the smaller lie.
 *
 * ⚠️⚠️ **OPERATIONS DID NOT LOSE ITS DOOR, and checking that was the whole risk
 * in this change.** §5.44 took System Management off the settings menu ("the
 * full top bar now handles that"), so this tab was the ONLY route to it —
 * blanking the page alone would have taken "today's baseline vs live" out of
 * the product exactly as §5.39f records happening to Stage Manager, and
 * silently, because the route keeps answering. **Daily operations** is back on
 * the header's settings menu, pointing at `/system-mgmt?tab=operations`, and
 * `lossless.test.ts` pins it.
 *
 * ⚠️ **What the real page is is WRITTEN DOWN, not an open question** — Brandon's
 * handoff specifies it: Katie's Patient Pipeline Tracker embedded (board
 * `18425649613`, app feature `121528191`), and under it numbers computed from
 * the Command Center's own data — onboarding pipeline per stage with average
 * days in stage, stuck and escalated counts, web-form leads by drop-off step,
 * active/paused subscriptions, patients late for an order, MR expired, open
 * orders with Cardinal problems, and one line per queue.
 * ⚠️⚠️ **Every one of those is a §5.8 counting-contract number**: whatever
 * computes them must mirror `useRoleCounts` AND both baseline generators, or
 * this page disagrees with the burndown all day. Read the handoff before
 * building it, not this paragraph.
 *
 * ⚠️ The `reports` ability is enforced at the ROUTE in `App.tsx`, not here: a
 * gate on the tab is not a gate on the page (§5.39h), and this URL is
 * bookmarkable.
 */
export default function OperationsPage() {
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center gap-3 sticky top-0 z-20">
        <button onClick={goBack} className="p-2 rounded-lg hover:bg-muted/50" title="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold text-foreground">Reports &amp; Metrics</h1>
      </header>
      <main className="p-4 sm:p-6">
        <div className="mx-auto max-w-lg py-24 text-center">
          <BarChart3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
          <p className="text-base font-semibold text-foreground">No reports available yet</p>
        </div>
      </main>
    </div>
  );
}
