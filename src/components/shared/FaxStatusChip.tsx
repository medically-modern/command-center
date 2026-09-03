/**
 * Live RingCentral fax-status pill, and the "delivered" chip beside it.
 *
 * ⚠️ ONE component on every surface that sends a fax. Send Request and Confirm
 * Receipt both fax the same doctor about the same patient, and a status that
 * only one of them renders is the same gap one stage further along — the rule
 * `SmsDeliveryNote` already follows for texts (§5.5). These lived inside
 * ConfirmReceiptPanel until 2026-09-03, when Send Request stopped advancing on
 * send and needed to show the rep what actually happened to the fax.
 *
 * ⚠️ An ACCEPTED fax is not a DELIVERED fax. RingCentral answers the send
 * immediately and only reports `Sent` or `Failed` seconds later, which is the
 * whole reason these states exist: processing → submitted → sent | failed.
 * Feed it from `useFaxStatus`, which polls RC's message store.
 */
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { FaxStage } from "@/hooks/masheke/useFaxStatus";
import { formatSent } from "@/lib/shared/sentTime";

export function DeliveredChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
      style={{ background: "var(--mm-mint)" }}
    >
      <CheckCircle2 className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

/** Animated (spinner + pulse) while the fax is in flight, then settles to
 *  "Sent · <time>" (✓ mint) or "Fax failed" (✗ rose). Mirrors RingCentral's
 *  real Queued/Sent status. */
export function FaxStatusChip({ stage, at, sentAt }: { stage: FaxStage; at?: string; sentAt?: string }) {
  if (stage === "sent") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
        style={{ background: "var(--mm-mint)" }}
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> Sent · {formatSent(at || sentAt || "")}
      </span>
    );
  }
  if (stage === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
        style={{ background: "var(--mm-rose-soft)", color: "var(--mm-rose)", boxShadow: "inset 0 0 0 1px oklch(0.62 0.13 18 / 0.35)" }}
      >
        <XCircle className="h-3.5 w-3.5" /> Fax failed{at ? ` · ${formatSent(at)}` : ""} — re-send
      </span>
    );
  }
  if (stage === "submitted") {
    // RC has accepted the fax and it's in transit — no issues. Static (no
    // spinner/pulse) so the rep knows it's safely handed off and can move on.
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
        style={{ background: "oklch(0.95 0.05 240)", color: "oklch(0.45 0.13 250)", boxShadow: "inset 0 0 0 1px oklch(0.80 0.08 250)" }}
      >
        <Clock className="h-3.5 w-3.5" /> Submitted · {formatSent(at || sentAt || "")}
      </span>
    );
  }
  // processing — still waiting for RC to register the fax; keep it animated.
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold animate-pulse"
      style={{ background: "oklch(0.97 0.04 85)", color: "oklch(0.48 0.10 70)", boxShadow: "inset 0 0 0 1px oklch(0.82 0.10 80)" }}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing · {formatSent(sentAt || "")}
    </span>
  );
}
