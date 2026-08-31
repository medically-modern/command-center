/**
 * "Fax Bad" badge — did the last fax to this doctor actually arrive?
 *
 * Sits beside the Profile Status chip on the masheke patient headers, so the
 * answer is on screen wherever a rep is working the patient. The rule is in
 * `lib/fax/faxOutcome.ts`; this file is only how it looks.
 *
 * ⚠️ **It renders NOTHING unless the last fax FAILED** — the same deliberate
 * silence `ProfileStatusBadge` keeps for a null status, and for the same reason:
 * a chip on every patient is a chip nobody reads. Roughly three quarters of
 * faxes go through, so a green "Fax sent" on all of them would bury the 23% that
 * didn't. Callers can therefore drop this into a header unconditionally.
 *
 * It is also silent while loading, when RingCentral can't be read, and for a
 * doctor whose number has had no fax inside the lookback window — in every one
 * of those cases we have not established that anything is wrong, and a badge
 * that overstates its evidence is the mistake this app has already made once
 * (INCIDENT_2026-08-20 §8, rule 4).
 *
 * ⚠️ **The reason is a real tooltip, not a `title` attribute.** It shipped as
 * `title` first and reps reported the reason "not showing on hover": the native
 * tooltip waits about a second, renders as a plain OS string, and is gone if the
 * pointer moves — so the one thing the badge exists to tell you (fix the number
 * vs. just re-send) was effectively invisible. Radix opens in 150ms and stays.
 * It brings its own `TooltipProvider` because the app mounts none globally —
 * `OversightTab` does the same — so this stays a one-line drop-in for a header.
 */
import { Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFaxOutcomes } from "@/hooks/useFaxOutcomes";
import {
  faxFailureLabel,
  faxFailureReason,
  faxOutcomeFor,
  isRetryableFaxFailure,
} from "@/lib/fax/faxOutcome";

/** `(919) 843-5515` from anything with ten digits in it. */
function prettyNumber(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}

function prettyWhen(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export function FaxStatusBadge({
  doctorFax,
  size = "md",
  className,
}: {
  /** The doctor's fax as Monday stores it (`<digits>@rcfax.com`). */
  doctorFax?: string;
  /** `sm` for dense rows, `md` for patient headers. */
  size?: "sm" | "md";
  className?: string;
}) {
  const { outcomes } = useFaxOutcomes();
  const outcome = faxOutcomeFor(outcomes, doctorFax);
  if (!outcome || outcome.state !== "failed") return null;

  const sm = size === "sm";
  const when = prettyWhen(outcome.at);
  const number = prettyNumber(outcome.number || doctorFax || "");
  const retryable = isRetryableFaxFailure(outcome.code);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              "inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border font-semibold leading-none whitespace-nowrap",
              "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-100 dark:border-rose-800",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400",
              sm ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
              className,
            )}
          >
            <Printer className={cn("shrink-0", sm ? "h-2.5 w-2.5" : "h-3.5 w-3.5")} aria-hidden />
            Fax Bad
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs px-3 py-2.5">
          <p className="font-semibold">{faxFailureLabel(outcome.code)}</p>
          <p className="mt-1 text-[0.8rem] leading-snug opacity-90">
            {faxFailureReason(outcome.code)}
          </p>
          <p className="mt-2 text-[0.8rem] font-medium leading-snug">
            {retryable
              ? "Re-send it."
              : "Check the fax number on the doctor record, then re-send."}
          </p>
          <p className="mt-2 border-t pt-1.5 text-[0.7rem] uppercase tracking-wide opacity-70">
            {number}
            {when ? ` · ${when} ET` : ""}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
