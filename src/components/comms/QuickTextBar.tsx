/**
 * The suggested-text buttons under the Communications text box (Brandon,
 * 2026-10-02). Which buttons, and on which board, is `lib/comms/quickTexts` —
 * this only draws them. Rendered only when the panel's caller passed a
 * `QuickTextsContext`, which today is the Care Coordinator card alone.
 *
 * A fill button puts words in the box and stops there: the rep presses Send.
 * Copy booking link puts the patient's prefilled Calendly link on the
 * clipboard — the same link that card's Booking link dialog would send.
 */
import { useEffect, useState } from "react";
import { Check, Link2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { applyQuickText, quickTextsFor, type QuickTextsContext } from "@/lib/comms/quickTexts";
import { fetchSchedulingConfig, patientBookingLink } from "@/lib/scheduledCalls/schedulingConfig";

export default function QuickTextBar({
  context,
  draft,
  onDraftChange,
}: {
  context: QuickTextsContext;
  draft: string;
  onDraftChange: (text: string) => void;
}) {
  const actions = quickTextsFor(context.board);
  const [copied, setCopied] = useState(false);
  const hasCopy = actions.some((a) => a.kind === "copyBookingLink");

  // Warm the link's source while the panel is open, so the click copies at
  // once — a clipboard write that waits too long on a network read can lose
  // the click's permission in some browsers.
  useEffect(() => {
    if (hasCopy) void fetchSchedulingConfig();
  }, [hasCopy]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (!actions.length) return null;

  const copyLink = async () => {
    try {
      const link = await patientBookingLink(context.bookingKind ?? "intake", context.patient);
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Booking link copied — paste it into your text");
    } catch {
      toast.error("Couldn't copy the booking link. Use the card's Booking link button instead.");
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 bg-card px-3 pb-3" data-testid="quick-text-bar">
      {actions.map((a) =>
        a.kind === "fill" ? (
          <button
            key={a.id}
            type="button"
            title={a.title}
            onClick={() => onDraftChange(applyQuickText(draft, a.text(context.patient)))}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {a.label}
          </button>
        ) : (
          <button
            key={a.id}
            type="button"
            title={a.title}
            onClick={() => void copyLink()}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            )}
            {copied ? "Copied" : a.label}
          </button>
        ),
      )}
    </div>
  );
}
