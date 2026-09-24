/**
 * "We called N · They called M" — the top of the patient screen's Calls tab.
 *
 * Josh, 2026-09-24: *"see how many times total ever weve called and theyve
 * called us"*, read from our own call archive in Postgres through the route the
 * Care Coordinator cards already use (`lib/patient/callTotals.ts`). Nothing
 * here writes, and nothing reads RingCentral.
 *
 * ⚠️ **Only one of its states has numbers.** Counting, the numbers, the archive
 * being off, or the records not answering — never a 0 standing in for an
 * answer we did not get, because "we have never called this patient" is the
 * one reading a rep acts on.
 *
 * ⚠️ **The date says what "ever" means.** Our records begin at the archive's
 * oldest call (mid-June 2026, §5.47), so the heading carries that date, read
 * live from the same answer. Without it the total reads as the patient's whole
 * history.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatSinceDate, type CallTotalsState } from "@/lib/patient/callTotals";

/** How long "Counting calls…" may show before it says the records have not
 *  answered. The shared hook retries on its own every minute. */
export const SLOW_AFTER_MS = 15_000;

export function CallCountsCard({
  state,
  since,
  caregiverName = "",
}: {
  state: CallTotalsState;
  /** When the call archive begins (ISO), or null. */
  since: string | null;
  caregiverName?: string;
}) {
  const waiting = state.kind === "waiting";
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [waiting]);

  if (state.kind === "none") return null;
  const date = formatSinceDate(since);
  return (
    <div className="callcounts" data-testid="call-counts">
      <div className="eyebrow">Calls on record{date ? ` · since ${date}` : ""}</div>
      {state.kind === "ready" ? (
        <>
          <div className="cc-grid">
            <div className="fact">
              <div className="k">We called</div>
              <div className="v big">{state.totals.weCalled}</div>
              {state.totals.weCalled > 0 && (
                <div className={`xs ${state.totals.reached ? "good" : "muted"}`}>
                  {state.totals.reached ? "They've picked up" : "Never picked up yet"}
                </div>
              )}
            </div>
            <div className="fact">
              <div className="k">They called</div>
              <div className="v big">{state.totals.theyCalled}</div>
            </div>
          </div>
          {state.totals.altTotal > 0 && (
            <div className="xs muted">
              Includes {state.totals.altTotal} with the alternate number
              {caregiverName ? ` (${caregiverName})` : ""}.
            </div>
          )}
        </>
      ) : state.kind === "off" ? (
        <div className="xs muted">The call records aren&apos;t available right now, so there&apos;s nothing to count.</div>
      ) : slow ? (
        <div className="xs bad">The call records haven&apos;t answered yet — still trying.</div>
      ) : (
        <div className="xs muted row">
          <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} /> Counting calls…
        </div>
      )}
    </div>
  );
}
