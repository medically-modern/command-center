/**
 * The hover on an "Already in System" pill — the duplicate check's conclusion
 * in one sentence (Brandon, 2026-09-29), picked out of Claude's write-up in
 * Profile Send Off Notes by `lib/profile/dupCheckSummary`.
 *
 * ⚠️ A real tooltip, not a `title` attribute: reps reported the native one
 * "not showing" on the fax badge (it waits ~1s and vanishes if the pointer
 * moves) — see `FaxStatusBadge`. Radix opens in 150ms and stays. It brings
 * its own provider because the app mounts none, and PORTALS its content, so a
 * card's `overflow: hidden` can never clip it.
 *
 * ⚠️ The pill passed in must take a ref and be focusable (`tabIndex={0}`), so
 * a keyboard user reaches the sentence too; and it must drop its own `title`,
 * or two tooltips race.
 */
import type { ReactElement } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dupCheckSummary, inSystemHover } from "@/lib/profile/dupCheckSummary";

export function InSystemTooltip({
  notes,
  verdict = "",
  pending = "",
  children,
}: {
  /** Profile Send Off Notes (`text_mm389fs`). `undefined` = not read yet. */
  notes: string | null | undefined;
  /** Dup Check Result, when the caller holds it. */
  verdict?: string;
  /** What to say while `notes` has not been read. */
  pending?: string;
  children: ReactElement;
}) {
  const summary = notes === undefined ? null : dupCheckSummary(notes);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipPrimitive.Portal>
          <TooltipContent side="bottom" className="z-[60] max-w-sm px-3 py-2.5" data-in-system-hint>
            {summary?.sentence ? (
              <>
                <p className="font-semibold">{summary.label}</p>
                <p className="mt-1 text-[0.8rem] leading-snug opacity-90">{summary.sentence}</p>
                <p className="mt-2 border-t pt-1.5 text-[0.7rem] uppercase tracking-wide opacity-70">
                  Claude&apos;s duplicate check · full write-up in Profile Send Off Notes
                </p>
              </>
            ) : (
              <p className="text-[0.8rem] leading-snug">{inSystemHover(notes, verdict, pending)}</p>
            )}
          </TooltipContent>
        </TooltipPrimitive.Portal>
      </Tooltip>
    </TooltipProvider>
  );
}
