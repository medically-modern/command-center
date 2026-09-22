import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Phone, Plus, Loader2 } from "lucide-react";
import { sendCallAttemptsToMonday, sendFollowUpToMonday } from "@/lib/welcomeCall/mondayWrite";
import { defaultFollowUpDate } from "@/lib/careCoordinator/followUp";
import { etToday } from "@/lib/masheke/etDate";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * The follow-up an attempt writes: the NEXT CALENDAR DAY in Eastern time.
 * One helper for this button and Patient Intake's attempt logger, so the two
 * stages push the same amount (Brandon, 2026-09-14 — "do exactly how it's
 * being done for welcome call"). No weekend clamp, as this button never had.
 */
function getTomorrow(): string {
  return defaultFollowUpDate(etToday());
}

/** "9/23" — the day the patient comes back, said on the button itself. */
function shortEt(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

interface Props {
  itemId: string;
  callAttempts: string;
  /** Optimistic local patch. Optional: the sidebar has no per-patient setter
   *  and relies on `onFollowUp` (a refetch) to bring the new count back. */
  onUpdate?: (count: string) => void;
  onFollowUp?: () => void;
  /**
   * `panel` — the card at the FOOT of the call form, where the rep is when the
   * call ends (Josh, 2026-09-22: "log attempts should be at bottom").
   * `row` — a compact pill for a sidebar row, so a rep working down the list
   * can log an unanswered call without opening the patient ("should be
   * available on the list view too, not just the profile view").
   */
  variant?: "panel" | "row";
}

/**
 * Log a call attempt: +1 on the counter, and the Follow Up Date moves to
 * tomorrow.
 *
 * ⚠️ THE DATE IS THE WHOLE POINT, AND IT ONLY STARTED WORKING ON 2026-09-22.
 * This button has always written both columns, but the Welcome Call queue
 * bucketed on the STATUS label, and nothing on the board ever read the date
 * back — so pressing +1 removed the patient from the sidebar and the role bar
 * and the day they were promised back on passed with nothing to wake them.
 * The queue is a pure date bucket now (welcomeCall/sidebarList
 * .isWelcomeCallSnoozed), so "press when attempted, and then move next action
 * date" finally means what it says. Do not re-point either write at the status
 * column alone.
 */
export function CallAttemptsCounter({
  itemId,
  callAttempts,
  onUpdate,
  onFollowUp,
  variant = "panel",
}: Props) {
  const [saving, setSaving] = useState(false);
  const count = Number(callAttempts) || 0;

  const handleIncrement = async () => {
    const newCount = count + 1;
    onUpdate?.(String(newCount));
    setSaving(true);
    try {
      const tomorrow = getTomorrow();
      // Write call attempts + follow-up in parallel
      await Promise.all([
        sendCallAttemptsToMonday(itemId, newCount),
        sendFollowUpToMonday(itemId, tomorrow),
      ]);
      toast.success(`Call attempt #${newCount} logged — follow up ${tomorrow}`);
      onFollowUp?.();
    } catch (e) {
      toast.error("Failed to save call attempt", {
        description: e instanceof Error ? e.message : String(e),
      });
      // revert
      onUpdate?.(String(count));
    } finally {
      setSaving(false);
    }
  };

  // ⚠️⚠️ A SIBLING OF THE ROW BUTTON, NEVER A CHILD OF IT. `SidebarMenuButton`
  // is itself a <button>, and a nested button is invalid HTML — browsers are
  // free to re-parent it, and a screen reader has no way to announce the inner
  // control at all. So the caller renders this inside the `relative`
  // `SidebarMenuItem`, beside the row button, and it positions itself.
  //
  // ⚠️ BOTTOM-right, because the TOP-right is taken. `ContactStateMarks` sits
  // at `right-1 top-1.5` inside the 32px (`pr-8`) gutter shadcn reserves for a
  // row action, and it renders in the manager `?mv=` view only — so anything
  // else in that corner collides for exactly the people who use both. The two
  // lanes never meet vertically: the marks are ~12px at y6, this pill is at the
  // foot of a two-line row.
  //
  // ⚠️ It deliberately does NOT carry `data-sidebar="menu-action"`. That
  // attribute buys the top gutter (and `ContactStateMarks` borrows it for
  // exactly that), which is not what this needs: the line it must stay clear of
  // is the SUBTITLE, and the caller gives that its own right padding. Taking
  // the top gutter here would indent the patient's NAME on every row in the
  // processor view for no reason.
  if (variant === "row") {
    return (
      <button
        type="button"
        title={`Log a call attempt — follow up ${getTomorrow()}`}
        aria-label={`Log call attempt for this patient (currently ${count})`}
        // The row underneath is a button too: without this, pressing +1 would
        // also select the patient and navigate the pane out from under the rep.
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void handleIncrement();
        }}
        disabled={saving}
        className={cn(
          "absolute bottom-1 right-1 z-10",
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
          "text-[11px] font-semibold tabular-nums",
          "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent",
          "transition-colors disabled:opacity-50",
        )}
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Phone className="h-3 w-3" />
        )}
        {count}
        <Plus className="h-2.5 w-2.5" />
      </button>
    );
  }

  const tomorrow = getTomorrow();
  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{ borderColor: "var(--mm-card-border)" }}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Call attempts
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Phone className="h-4 w-4" />
          Logged so far
        </span>
        <span className="text-lg font-bold tabular-nums min-w-[2ch] text-center">{count}</span>
        <Button
          onClick={handleIncrement}
          disabled={saving}
          className="gap-2 text-white shadow-sm bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Log call attempt
            </>
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Press this when you tried and could not reach them — it moves the follow-up to{" "}
        <b>{shortEt(tomorrow)}</b>, so they leave today's list and come back then.
      </p>
    </div>
  );
}
