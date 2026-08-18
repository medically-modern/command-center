/**
 * Send to Monday with check-pack review — drop-in replacement for
 * SendToMondayButton on the Final Profile Confirmation page.
 *
 * Behavior (warnings-only, full manual override):
 *  - No red/amber findings → sends immediately, same as before.
 *  - Red/amber findings   → opens a review dialog listing them with
 *    per-finding "reviewed" checkboxes. "Send anyway" enables once every
 *    listed finding is checked. Info findings never appear here.
 *  - On confirmed send, the checked findings are passed to onSend so the
 *    page can append the [FPC override] audit lines to Notes.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { CheckFinding } from "@/lib/finalConfirm/checkPack";
import { AlertOctagon, AlertTriangle, CheckCircle, Loader2, Send } from "lucide-react";

interface Props {
  findings: CheckFinding[];
  /** overridden = the red/amber findings the rep reviewed and sent through anyway. */
  onSend: (overridden: CheckFinding[]) => Promise<void>;
  disabled?: boolean;
}

export function SendWithChecksButton({ findings, onSend, disabled }: Props) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [acked, setAcked] = useState<Record<string, boolean>>({});

  // Only red/amber require review; info is panel-only.
  const actionable = useMemo(
    () => findings.filter((f) => f.severity !== "info"),
    [findings],
  );
  const allAcked = actionable.every((_, i) => acked[i]);

  const doSend = async (overridden: CheckFinding[]) => {
    setSending(true);
    try {
      await onSend(overridden);
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch {
      // error surfaced by parent via toast
    } finally {
      setSending(false);
    }
  };

  const handleClick = async () => {
    if (actionable.length > 0) {
      setAcked({});
      setDialogOpen(true);
      return;
    }
    await doSend([]);
  };

  const handleConfirm = async () => {
    setDialogOpen(false);
    await doSend(actionable);
  };

  return (
    <div className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={disabled || sending}
        className="w-full gap-2 h-12 text-base font-semibold bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white shadow-lg"
      >
        {sending ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> Sending…
          </>
        ) : sent ? (
          <>
            <CheckCircle className="h-5 w-5" /> Confirmed & Sent!
          </>
        ) : (
          <>
            <Send className="h-5 w-5" /> Confirm Profile & Send to Monday
            {actionable.length > 0 && (
              <span className="ml-1 rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">
                {actionable.length} to review
              </span>
            )}
          </>
        )}
      </Button>

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionable.length} warning{actionable.length === 1 ? "" : "s"} on this profile
            </AlertDialogTitle>
            <AlertDialogDescription>
              Nothing blocks you — check each item to confirm you've reviewed it,
              then send. Overrides are recorded in the patient's Notes.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-72 overflow-y-auto space-y-2 py-1">
            {actionable.map((f, i) => (
              <label
                key={`${f.id}-${i}`}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                  f.severity === "red"
                    ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40"
                    : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40",
                  acked[i] && "opacity-70",
                )}
              >
                <Checkbox
                  checked={!!acked[i]}
                  onCheckedChange={(v) => setAcked((a) => ({ ...a, [i]: v === true }))}
                  className="mt-0.5"
                />
                {f.severity === "red" ? (
                  <AlertOctagon className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                )}
                <span className="min-w-0">
                  <span className="block text-xs font-bold leading-tight">{f.title}</span>
                  <span className="block text-xs mt-0.5 opacity-90">{f.detail}</span>
                  {f.formatHint && (
                    <span className="block text-xs mt-1 font-mono font-semibold">{f.formatHint}</span>
                  )}
                </span>
              </label>
            ))}
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Go back & fix
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!allAcked}
              className="bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white"
            >
              {allAcked ? "Send anyway" : "Review all items to send"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
