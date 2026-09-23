/**
 * The inbox's two bits of colour, drawn one way everywhere (the list, the item
 * header, the patient screen's bar):
 *
 *  · the STAGE pill — the four onboarding stages light green, Subscription
 *    dark green, Inactive red, Unmatched grey (Brandon's mockup). The name is
 *    the patient screen's: *Medical Necessity*, not the mockup's *Medical
 *    Evaluation* (COMMS_INBOX_PLAN.md §9.3).
 *  · the KIND edge — what opened the item: a text blue, a missed call orange, a
 *    voicemail purple.
 */
import type { StagePill as Stage } from "@/lib/commsInbox/rules";
import { cn } from "@/lib/utils";

const ONBOARDING = new Set<Stage>(["Intake", "Medical Necessity", "Insurance", "Welcome Call"]);

export function StagePill({ stage, className }: { stage: Stage; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold leading-4",
        ONBOARDING.has(stage)
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : stage === "Subscription"
            ? "bg-[color:var(--mm-green)] text-white"
            : stage === "Inactive"
              ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200"
              : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {stage}
    </span>
  );
}
