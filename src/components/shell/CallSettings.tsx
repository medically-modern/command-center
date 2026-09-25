/**
 * The settings menu's **Calls** section (§5.52) — the status line, the
 * per-browser ringtone toggle, and the way to the number "Take it" forwards to.
 *
 * ⚠️ **The ring-mode controls are GONE** (Josh, 2026-09-25: *"remove the
 * ability to select which call rings them and the pinned numbers, play a ring
 * tone in browser stays"*). *Ring me for incoming patient calls* and *Which
 * calls ring me* wrote `RingPrefs.mode`, which no longer exists — every
 * connected answerer sees every inbound call, server-side. What survives:
 * the ringtone mute (per BROWSER, §5.13b — it never left), and the dialog
 * holding the "Take it" forward number, which claiming a call still needs.
 *
 * ⚠️ **The status sentence is `useCallStatus`'s**, the ONE reading of the line
 * the badge uses; this file never asks `canAnswerCalls` itself
 * (`shellRemovals.test.ts`). A non-answerer sees the ringtone row disabled
 * with "Ask an admin to make you a call answerer" — nothing rings them and
 * nothing here can change that (§5.13b: the assignment is a manager's, on
 * /access).
 */
import { useState } from "react";
import { useCallStatus } from "@/components/inboundCalls/CallConnectionBadge";
import RingPreferencesDialog from "@/components/inboundCalls/RingPreferencesDialog";
import { callStatusLine } from "@/lib/shell/callStatusLine";

function TogRow({
  label,
  sub,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  sub?: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`tog-row${disabled ? " off" : ""}`}
      role="switch"
      aria-checked={on && !disabled}
      aria-disabled={disabled || undefined}
      title={disabled ? "Ask an admin to make you a call answerer" : undefined}
      onClick={disabled ? undefined : onToggle}
    >
      <span>
        <b>{label}</b>
        {sub && <div className="xs muted">{sub}</div>}
      </span>
      <span className={`tog${on && !disabled ? " on" : ""}`} />
    </button>
  );
}

export function CallSettings() {
  const call = useCallStatus();
  const { phone, enabled } = call;
  const [dialog, setDialog] = useState(false);

  return (
    <div className="sec">
      <div className="eyebrow">Calls</div>
      <div className="status">
        <span className={`dot ${enabled ? call.tone : "grey"}`} />
        {callStatusLine(enabled, true, call.detail ? `${call.label} — ${call.detail}` : call.label)}
      </div>
      <TogRow
        label="Play a ringtone in this browser"
        sub="Off, the card still shows — it just doesn't sound"
        on={!phone.ringMuted}
        disabled={!enabled}
        onToggle={() => phone.setRingMuted(!phone.ringMuted)}
      />
      {enabled && (
        <button type="button" className="opt" onClick={() => setDialog(true)}>
          The number Take it forwards to…
        </button>
      )}
      <RingPreferencesDialog open={dialog} onOpenChange={setDialog} />
    </div>
  );
}
