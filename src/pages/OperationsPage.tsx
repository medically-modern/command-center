import { useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3 } from "lucide-react";
import SlaCard from "@/components/commsInbox/SlaCard";
import { useCommsConfig } from "@/hooks/commsInbox/useInbox";

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
 * ⚠️⚠️ **OPERATIONS KEPT ITS TOOL, NOT ITS DOOR, and that was checked rather
 * than assumed.** §5.44 took System Management off the settings menu ("the
 * full top bar now handles that"), so this tab was the ONLY route to it. A
 * **Daily operations** entry went onto the settings menu the same afternoon
 * and was withdrawn an hour later (*"daily op[erations doesnt need to be in ui,
 * just comment it out"*), so what is left is `/system-mgmt?tab=operations` and
 * System Management's own Operations tab. `lossless.test.ts` records that
 * narrowing, and fails if the entry quietly returns (§5.46b).
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
 *
 * **The one report that exists: Communications SLA · 24 hours** (Josh's D8,
 * 2026-09-23: *"4A"* — COMMS_INBOX_PLAN.md §1.2). It renders only while the
 * Inbox is switched on (`COMMS_INBOX_UI`), because it is built from the Inbox's
 * resolve log; off — and while the switch is being read — this page is exactly
 * the blank page above, which is the Inbox's standing "additive first" rule.
 * ⚠️ It is NOT the handoff's Reports page and does not pretend to be: Katie's
 * tracker and the pipeline numbers stay unbuilt, and it borrows nothing —
 * still not `OperationsTab`, which `lossless.test.ts` pins.
 */
export default function OperationsPage() {
  const navigate = useNavigate();
  const comms = useCommsConfig();
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
        {comms.ui ? (
          <div className="mx-auto max-w-6xl">
            <SlaCard />
          </div>
        ) : (
          <div className="mx-auto max-w-lg py-24 text-center">
            <BarChart3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            <p className="text-base font-semibold text-foreground">No reports available yet</p>
          </div>
        )}
      </main>
    </div>
  );
}
