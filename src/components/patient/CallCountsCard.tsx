/**
 * "We called N · They called M" — the top of the patient screen's Calls tab.
 *
 * Josh, 2026-09-24: *"see how many times total ever weve called and theyve
 * called us"*, read from our own call archive in Postgres
 * (`hooks/callHistory/useCallCounts`). Nothing here writes, and nothing reads
 * RingCentral.
 *
 * ⚠️ **Three states, and only one of them has numbers.** Counting, the numbers,
 * or "couldn't read" — never a 0 standing in for an answer we did not get,
 * because "we have never called this patient" is the one reading a rep acts on.
 *
 * ⚠️ **The date says what "ever" means.** Our records begin when the archive's
 * oldest call does (mid-June 2026 — §5.47), so the heading carries that date,
 * read live. Without it the total reads as the patient's whole history.
 */
import { Loader2 } from "lucide-react";
import type { CallCountsView } from "@/hooks/callHistory/useCallCounts";
import { countLabel, formatSinceDate } from "@/lib/callHistory/callCounts";

export function CallCountsCard({
  view,
  caregiverName = "",
}: {
  view: CallCountsView;
  caregiverName?: string;
}) {
  if (!view.available) return null;
  const { counts, since } = view;
  const date = formatSinceDate(since);
  return (
    <div className="callcounts" data-testid="call-counts">
      <div className="eyebrow">Calls on record{date ? ` · since ${date}` : ""}</div>
      {counts ? (
        <>
          <div className="cc-grid">
            <div className="fact">
              <div className="k">We called</div>
              <div className="v big">{countLabel(counts.weCalled, counts.capped)}</div>
              {counts.weCalled > 0 && <div className="xs muted">{counts.weReached} answered</div>}
            </div>
            <div className="fact">
              <div className="k">They called</div>
              <div className="v big">{countLabel(counts.theyCalled, counts.capped)}</div>
              {counts.theyCalled > 0 && (
                <div className="xs muted">
                  {counts.theyMissed} missed
                  {counts.theyVoicemail > 0
                    ? ` (${counts.theyVoicemail} left a voicemail)`
                    : ""}
                </div>
              )}
            </div>
          </div>
          {view.altTotal > 0 && (
            <div className="xs muted">
              Includes {view.altTotal} with the alternate number
              {caregiverName ? ` (${caregiverName})` : ""}.
            </div>
          )}
          {counts.capped && (
            <div className="xs muted">More than 1,000 calls on record — these are the newest 1,000.</div>
          )}
        </>
      ) : view.failed ? (
        <div className="xs bad">Couldn&apos;t read the call records. Open the patient again to retry.</div>
      ) : (
        <div className="xs muted row">
          <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} /> Counting calls…
        </div>
      )}
    </div>
  );
}
