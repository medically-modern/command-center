import { useEffect, useState } from "react";
import { fetchOutboundFaxStatus } from "@/lib/fax/ringcentralApi";
import { faxPollDelayMs } from "@/lib/fax/faxPoll";

export type FaxStage = "processing" | "submitted" | "sent" | "failed";
export interface FaxStatusState {
  stage: FaxStage;
  /** RingCentral timestamp for the current stage (creationTime when queued,
   *  lastModifiedTime when sent/failed; falls back to the send time). */
  at?: string;
}

// Backoff schedule + horizon live in lib/fax/faxPoll (pure, tested). The flat
// 40 × 12s this replaced covered exactly 8 minutes, and a measurement of the
// live account found five of twelve faxes — three of the four FAILURES —
// settling after that, leaving the chip on "Processing" for ever.

/** Live RingCentral status of the outbound fax to `recipient` sent at
 *  `sentAtIso`: processing → queued → sent (or failed), updating without a
 *  refresh. Pass `active = true` only for a fax sent today. Returns null when
 *  inactive. The send path is unchanged — this only READS RC's message store. */
export function useFaxStatus(
  recipient: string | undefined,
  sentAtIso: string | undefined,
  active: boolean,
): FaxStatusState | null {
  const [state, setState] = useState<FaxStatusState | null>(
    active && sentAtIso ? { stage: "processing", at: sentAtIso } : null,
  );

  useEffect(() => {
    if (!active || !sentAtIso || !recipient) {
      setState(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    setState((s) => s ?? { stage: "processing", at: sentAtIso });

    const tick = async () => {
      polls += 1;
      let terminal = false;
      try {
        const r = await fetchOutboundFaxStatus(recipient, sentAtIso);
        if (cancelled) return;
        if (!r) {
          setState({ stage: "processing", at: sentAtIso });
        } else if (r.status === "Sent") {
          setState({ stage: "sent", at: r.lastModifiedTime });
          terminal = true;
        } else if (r.status === "Failed") {
          setState({ stage: "failed", at: r.lastModifiedTime });
          terminal = true;
        } else {
          // RC messageStatus "Queued" is shown as "Submitted" in RC's own UI
          // (and matches Brandon's stage name).
          setState({ stage: "submitted", at: r.creationTime });
        }
      } catch {
        // Transient network/RC hiccup — keep the last state and keep polling.
      }
      const delay = terminal ? null : faxPollDelayMs(polls);
      if (!cancelled && delay !== null) {
        timer = setTimeout(tick, delay);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [recipient, sentAtIso, active]);

  return state;
}
