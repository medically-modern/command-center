/**
 * The "this text never landed" marker, under a message bubble.
 *
 * ONE renderer for all three texting surfaces — Patient Texting's
 * `ConversationThread`, the `Text` pop-up on every patient header
 * (`masheke/mmKit` `TextCompose`) and the intake page's `IntakeMessages`. A rep
 * can text a patient from any of them, so a failure that shows in one and not
 * the others is the same gap this fixes, one surface further along.
 *
 * Silent on anything that has not actually failed: a queued or delivered
 * message renders nothing at all, so a healthy thread looks exactly as it did.
 *
 * ⚠️ **`skin="page"` is REQUIRED inside `.pf-root`** (the intake page), for the
 * same reason `StageActionBar` carries the same prop. `redesign.css` resets
 * `.pf-root * { margin:0; padding:0; border-color:var(--border) }` — a class
 * plus the universal selector, which ties with a single-class Tailwind utility
 * and then wins on source order. The default skin would render there with no
 * padding, no spacing and a grey border: a warning that reads as a stray line
 * of text. `.pf-root .sms-fail` is two classes, so it wins.
 */
import { AlertTriangle } from "lucide-react";

import { smsDelivery } from "@/lib/shared/smsDelivery";
import { cn } from "@/lib/utils";

interface Props {
  direction: "Inbound" | "Outbound";
  messageStatus?: string;
  deliveryError?: string;
  /** `"page"` inside `.pf-root`; the Tailwind default everywhere else. */
  skin?: "tailwind" | "page";
  /** Sits under a coloured (outbound) bubble in some threads and on the page
   *  background in others — the caller picks the alignment. */
  className?: string;
}

export default function SmsDeliveryNote({
  direction,
  messageStatus,
  deliveryError,
  skin = "tailwind",
  className,
}: Props) {
  // Inbound messages carry a status too (`Received`); a delivery verdict on a
  // message the PATIENT sent us would be meaningless.
  if (direction !== "Outbound") return null;
  const { state, reason } = smsDelivery({ messageStatus, deliveryError });
  if (state !== "failed") return null;

  const body = (
    <>
      <AlertTriangle className={skin === "page" ? "sms-fail-icon" : "mt-[1px] h-3 w-3 shrink-0"} />
      <span>
        <strong>Not delivered.</strong> {reason}
      </span>
    </>
  );

  if (skin === "page") return <div className={cn("sms-fail", className)}>{body}</div>;

  return (
    <div
      className={cn(
        "mt-1 flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] leading-snug text-destructive",
        className,
      )}
    >
      {body}
    </div>
  );
}
