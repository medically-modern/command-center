/**
 * The benefits check's warnings, on the two intake pages (§5.20b).
 *
 *  - `IntakeWarningsPanel` sits under the benefits results and stays: the
 *    "Check with patient" note, every BLOCK in red, every CONFIRM in amber with
 *    its checkbox. The checkboxes live HERE and only here — one place to tick,
 *    so the pop-up and the panel can never disagree about what is ticked.
 *  - `IntakeWarningsDialog` is the pop-up: what the check said, said once, on
 *    every open (see `useIntakeWarnings` for when).
 *
 * ⚠️ The panel renders INSIDE `.pf-root`, whose reset (`.pf-root button {
 * background:none … }`) out-specifies single-class Tailwind utilities (§9) —
 * so it uses the page's own classes (`.btn`, and `.iw*` in redesign.css). The
 * dialog portals to <body>, outside that reset, so it is ordinary Tailwind.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BLOCK_HINT, requiresReason, type IntakeWarning } from "@/lib/profile/intakeWarnings";
import { ANTHEM_NETWORK_HEADLINE } from "@/lib/profile/networkVerdict";
import type { IntakeWarningsState } from "@/hooks/profile/useIntakeWarnings";

export function IntakeWarningsPanel({ state, disabled, disabledReason }: {
  state: IntakeWarningsState;
  /** A check is streaming in, or the record is being reviewed. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { warnings, acks, anthem, busyKey, toggle } = state;
  // The reason box for an override tick. The caller keys this component by
  // patient, so a half-typed reason can never be saved onto the next patient.
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Deliberately NOT reported to the pending-note guard: that guard's refusal
  // says "press Add on your note", and this box has no Add — it is the reason
  // for a tick that has not been saved. Advance is gated on the tick itself.

  if (!anthem && warnings.length === 0) return null;

  const onCheck = (w: IntakeWarning, on: boolean) => {
    if (on && requiresReason(w)) {
      setReasonFor(w.key);
      setReason("");
      return;
    }
    void toggle(w, on);
  };
  const saveOverride = async (w: IntakeWarning) => {
    if (!reason.trim()) return;
    const ok = await toggle(w, true, reason.trim());
    if (ok) {
      setReasonFor(null);
      setReason("");
    }
  };

  const blocks = warnings.filter((w) => w.type === "block");
  const confirms = warnings.filter((w) => w.type === "confirm");
  const open = blocks.length + confirms.filter((w) => !acks.includes(w.key)).length;

  return (
    <div className="iw" data-testid="intake-warnings">
      {anthem && (
        <div className="iw-note" role="note">
          <AlertTriangle className="h-4 w-4" />
          <div>
            <div className="iw-note-head">In network only if they live in the right state</div>
            <div>{anthem.summary}</div>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="iw-list">
          <div className="iw-head">
            Benefits check warnings
            {open > 0
              ? <span className="iw-count">{open} open</span>
              : <span className="iw-count ok">all confirmed</span>}
          </div>

          {blocks.map((w) => (
            <div key={w.key} className="iw-row block">
              <div className="iw-top">
                <X className="h-4 w-4 shrink-0" aria-hidden />
                <span className="iw-msg">{w.message}</span>
              </div>
              <div className="iw-sub">{BLOCK_HINT}</div>
            </div>
          ))}

          {confirms.map((w) => {
            const acked = acks.includes(w.key);
            const busy = busyKey === w.key;
            const asking = reasonFor === w.key;
            return (
              <div key={w.key} className={`iw-row confirm ${acked ? "done" : ""}`}>
                <label className="iw-check" title={disabled ? disabledReason : undefined}>
                  <input
                    type="checkbox"
                    checked={acked}
                    disabled={disabled || busy || asking}
                    onChange={(e) => onCheck(w, e.target.checked)}
                  />
                  <span className="iw-label">{w.label}</span>
                  {busy && <span className="iw-busy">Saving…</span>}
                </label>
                <div className="iw-sub">{w.message}</div>
                {asking && (
                  <div className="iw-reason">
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why is this being overridden? It goes into the intake notes."
                      aria-label={`Reason for "${w.label}"`}
                      autoFocus
                    />
                    <div className="iw-reason-actions">
                      <button
                        type="button"
                        className="btn secondary sm"
                        onClick={() => { setReasonFor(null); setReason(""); }}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn primary sm"
                        onClick={() => { void saveOverride(w); }}
                        disabled={!reason.trim() || busy}
                      >
                        {busy ? "Saving…" : "Save and tick"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function IntakeWarningsDialog({ state, patientName }: {
  state: IntakeWarningsState;
  patientName?: string;
}) {
  const { anthem, warnings, acks, dialogOpen, setDialogOpen } = state;
  const blocks = warnings.filter((w) => w.type === "block");
  const confirms = warnings.filter((w) => w.type === "confirm");
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Before you move forward{patientName ? ` — ${patientName}` : ""}</DialogTitle>
          <DialogDescription>From the latest benefits check.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {anthem && (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
              <div className="flex items-start gap-2 font-semibold">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{ANTHEM_NETWORK_HEADLINE}</span>
              </div>
              <ol className="mt-2 list-decimal space-y-1 pl-9">
                {anthem.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </section>
          )}

          {blocks.length > 0 && (
            <section className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-rose-950 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
              <div className="font-semibold">Can't be advanced</div>
              <ul className="mt-1 space-y-1">
                {blocks.map((w) => (
                  <li key={w.key} className="flex items-start gap-2">
                    <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs opacity-80">{BLOCK_HINT}</div>
            </section>
          )}

          {confirms.length > 0 && (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
              <div className="font-semibold">Needs confirming</div>
              <ul className="mt-1 space-y-2">
                {confirms.map((w) => {
                  const acked = acks.includes(w.key);
                  return (
                    <li key={w.key} className="flex items-start gap-2">
                      {acked
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                      <span>
                        <b>{w.label}</b>{acked ? " — confirmed" : ""}
                        <span className="block text-xs opacity-80">{w.message}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 text-xs opacity-80">
                Tick each one under the benefits check results once you've confirmed it.
              </div>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => setDialogOpen(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
