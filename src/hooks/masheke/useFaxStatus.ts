import { useEffect, useState } from "react";
import { fetchOutboundFaxStatus } from "@/lib/fax/ringcentralApi";

export type FaxStage = "processing" | "queued" | "sent" | "failed";
export interface FaxStatusState {
  stage: FaxStage;
  /** RingCentral timestamp for the current stage (creationTime when queued,
   *  lastModifiedTime when sent/failed; falls back to the send time). */
  at?: string;
}

const POLL_MS = 12_000;
const MAX_POLLS = 30; // ~6 minutes, then stop polling (keeps the last state shown)

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
          setState({ stage: "queued", at: r.creationTime });
        }
      } catch {
        // Transient network/RC hiccup — keep the last state and keep polling.
      }
      if (!cancelled && !terminal && polls < MAX_POLLS) {
        timer = setTimeout(tick, POLL_MS);
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
