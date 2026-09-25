/**
 * The benefits check's warnings, on the two intake pages (§5.20b).
 *
 * `IntakeWarningsPanel` sits under the benefits results: the "Check with
 * patient" note — its heading NAMES the in-network states (Brandon,
 * 2026-09-25) — every BLOCK in red, every CONFIRM in amber with its checkbox.
 * The checkboxes live HERE and only here.
 *
 * ⚠️ **The "Before you move forward" POP-UP was deleted on 2026-09-25**
 * (Brandon: *"get rid of that big pop-up that comes up when you click into
 * their profile"* — it reversed Josh's 2026-09-24 "it should pop up every
 * time"). Everything it said is on this panel, which is where the ticks
 * always lived, and the Advance gate is unchanged.
 *
 * ⚠️ The panel renders INSIDE `.pf-root`, whose reset (`.pf-root button {
 * background:none … }`) out-specifies single-class Tailwind utilities (§9) —
 * so it uses the page's own classes (`.btn`, and `.iw*` in redesign.css).
 */

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { BLOCK_HINT, requiresReason, type IntakeWarning } from "@/lib/profile/intakeWarnings";
import { ANTHEM_PANEL_HEADLINE } from "@/lib/profile/networkVerdict";
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
            <div className="iw-note-head">{ANTHEM_PANEL_HEADLINE}</div>
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

