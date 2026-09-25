/**
 * The settings menu's **Calls** section (§5.52) — Brandon's `.sec` with the
 * status line, *Ring me for incoming patient calls*, *Which calls ring me* and a
 * third toggle, mapped onto the ring preferences that already exist (§5.13).
 *
 * ⚠️ **Nothing here is a new setting.** *Ring me* is `RingPrefs.mode !== "off"`
 * and *Which calls ring me* is `all` vs `list` — the same two facts
 * `RingPreferencesDialog` writes, through the same `saveRingPrefs`. His
 * "Only my patients" option is NOT offered: the Command Center deliberately
 * has no patient-to-person assignment (§5.13, Josh 2026-08-05), so there is
 * nothing to key it on. His third toggle, "Show a banner when a call comes
 * in", has no equivalent either — the card always shows — so the slot carries
 * the one per-browser call setting that does exist: the ringtone (§5.13b).
 *
 * ⚠️ **The status sentence is `useCallStatus`'s**, the ONE reading of the line
 * the badge uses; this file never asks `canAnswerCalls` itself
 * (`shellRemovals.test.ts`). A non-answerer sees the rows disabled with his
 * "Ask an admin to make you a call answerer" — nothing rings them and nothing
 * here can change that (§5.13b: the assignment is a manager's, on /access).
 *
 * ⚠️ Prefs are read when the section MOUNTS (the menu opens) and only for an
 * answerer; a save is fire-and-report, latest-wins, like the dialog's.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCallStatus } from "@/components/inboundCalls/CallConnectionBadge";
import RingPreferencesDialog from "@/components/inboundCalls/RingPreferencesDialog";
import { fetchRingPrefs, saveRingPrefs, type RingMode, type RingPrefs } from "@/lib/inboundCalls/callsApi";
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
  const [prefs, setPrefs] = useState<RingPrefs | null>(null);
  const [dialog, setDialog] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchRingPrefs()
      .then((p) => alive && setPrefs(p))
      .catch((e: Error) => toast.error(e.message));
    return () => {
      alive = false;
    };
  }, [enabled]);

  /** Latest-wins: a click that lands while an earlier save is out is what
   *  gets written, never the older snapshot (the dialog's own rule). */
  const persist = useCallback((next: RingPrefs) => {
    setPrefs(next);
    const mine = ++seq.current;
    saveRingPrefs({ mode: next.mode, forwardNumber: next.forwardNumber }).catch((e: Error) => {
      if (mine === seq.current) toast.error(e.message);
    });
  }, []);

  const ready = enabled && !!prefs;
  const mode: RingMode = prefs?.mode ?? "all";
  const ringing = mode !== "off";
  const tone = enabled ? (ringing ? call.tone : "amber") : "grey";

  return (
    <div className="sec">
      <div className="eyebrow">Calls</div>
      <div className="status">
        <span className={`dot ${tone}`} />
        {callStatusLine(enabled, ringing, call.detail ? `${call.label} — ${call.detail}` : call.label)}
      </div>
      <TogRow
        label="Ring me for incoming patient calls"
        sub="Calls ring in this browser tab (RingCentral)"
        on={ringing}
        disabled={!ready}
        onToggle={() => prefs && persist({ ...prefs, mode: ringing ? "off" : "all" })}
      />
      <label className="sel-row">
        <span>
          <b>Which calls ring me</b>
        </span>
        <select
          aria-label="Which calls ring me"
          disabled={!ready || !ringing}
          value={mode === "list" ? "list" : "all"}
          onChange={(e) => prefs && persist({ ...prefs, mode: e.target.value === "list" ? "list" : "all" })}
        >
          <option value="all">All patient calls</option>
          <option value="list">Pinned numbers only</option>
        </select>
      </label>
      <TogRow
        label="Play a ringtone in this browser"
        sub="Off, the card still shows — it just doesn't sound"
        on={!phone.ringMuted}
        disabled={!enabled}
        onToggle={() => phone.setRingMuted(!phone.ringMuted)}
      />
      {enabled && (
        <button type="button" className="opt" onClick={() => setDialog(true)}>
          Pinned numbers &amp; the number Take it forwards to…
        </button>
      )}
      <RingPreferencesDialog open={dialog} onOpenChange={setDialog} />
    </div>
  );
}
