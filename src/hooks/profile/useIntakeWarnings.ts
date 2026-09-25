/**
 * Everything the intake pages need about the benefits check's In Network
 * verdict and its Intake Warnings, for the patient on screen (§5.20b):
 * the parsed warnings, the ticks as the SCREEN should show them, the
 * "Check with patient" guidance, the pop-up's open state, and the tick action.
 *
 * Used by both routes to Advance on the Profile Send Off board —
 * UnverifiedReferralsPage (Info Collection + Profile Clean-Up) and ProfilePage
 * (Referral Intake · Already In System) — so the two cannot drift (Josh,
 * 2026-09-24: "this should apply to that intake page too"; §5.19b records what
 * a rule on one of two routes costs).
 *
 * ⚠️ TICKS ARE AN OVERRIDE WITH AN EXPIRY, never an edit in the page overlay.
 * The overlay is what lights "unsaved changes" and it would mask the board for
 * good; a tick is already durably written by the time it shows. The override
 * only covers the seconds before the next poll, retires as soon as the board
 * agrees, and lapses after `OVERRIDE_TTL_MS` whatever happens (§5.28's
 * read-override rule, §9's pending-advance rule).
 *
 * ⚠️ **The pop-up is GONE since 2026-09-25** (Brandon: *"get rid of that big
 * pop-up that comes up when you click into their profile"*, reversing Josh's
 * 2026-09-24 open-on-every-open). The panel under the results carries
 * everything it said, with the in-network states named in its heading.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Patient } from "@/lib/profile/workflow";
import { parseAcks, parseIntakeWarnings, type IntakeWarning } from "@/lib/profile/intakeWarnings";
import {
  anthemNetworkGuidance, networkVerdictOf, type AnthemGuidance, type NetworkVerdict,
} from "@/lib/profile/networkVerdict";
import { setIntakeWarningAck } from "@/lib/profile/intakeWarningAck";

/** How long a tick shown on screen may disagree with the board. */
export const OVERRIDE_TTL_MS = 120_000;

export interface IntakeWarningsState {
  warnings: IntakeWarning[];
  /** The ticked KEYs the screen shows (the optimistic copy when one is live). */
  acks: string[];
  verdict: NetworkVerdict;
  /** Set only for a "Check with patient" verdict. */
  anthem: AnthemGuidance | null;
  /** The patient with `intakeWarningAcks` as the screen shows it — hand THIS
   *  to the advance gate, or a fresh tick leaves Advance grey until the poll. */
  gatePatient: Patient | null;
  /** KEY of the tick being written, if any. */
  busyKey: string | null;
  toggle: (w: IntakeWarning, on: boolean, reason?: string) => Promise<boolean>;
  /** Call once a check has actually been started from this page: its ticks
   *  were just cleared on the board (`triggerStediRun`), so clear them here. */
  markCheckStarted: () => void;
}

export function useIntakeWarnings(
  patient: Patient | null | undefined,
  opts: {
    /** A benefits check is streaming in for THIS patient. */
    running: boolean;
    /** The note stamp's stage label. */
    stage: string;
    /** False on a finished record being reviewed: no pop-up, no ticking. */
    enabled?: boolean;
    /** After a tick lands — refetch, so the notes log shows the new line. */
    onWritten?: () => void;
  },
): IntakeWarningsState {
  const enabled = opts.enabled ?? true;
  const p = patient ?? null;
  const id = p?.id ?? null;
  const boardAcks = p?.intakeWarningAcks ?? "";

  const [overrides, setOverrides] = useState<Record<string, { value: string; at: number }>>({});
  const ov = id ? overrides[id] : undefined;
  const live = ov && Date.now() - ov.at < OVERRIDE_TTL_MS ? ov : undefined;
  const acksRaw = live ? live.value : boardAcks;

  // Retire an override the moment the board agrees with it.
  useEffect(() => {
    if (!id || !ov || ov.value !== boardAcks) return;
    setOverrides((o) => {
      if (!o[id]) return o;
      const next = { ...o };
      delete next[id];
      return next;
    });
  }, [id, ov, boardAcks]);

  const warnings = useMemo(() => parseIntakeWarnings(p?.intakeWarnings), [p?.intakeWarnings]);
  const acks = useMemo(() => parseAcks(acksRaw), [acksRaw]);
  const verdict = networkVerdictOf(p?.stediInNetwork);
  const stediAddress = p?.stediAddress;
  const patientAddress = p?.patientAddress;
  const formState = p?.formState;
  const anthem = useMemo(
    () => (verdict === "checkWithPatient"
      ? anthemNetworkGuidance({ stediAddress, patientAddress, formState })
      : null),
    [verdict, stediAddress, patientAddress, formState],
  );
  const gatePatient = useMemo(
    () => (p && acksRaw !== p.intakeWarningAcks ? { ...p, intakeWarningAcks: acksRaw } : p),
    [p, acksRaw],
  );

  /* ── Ticking ── */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { stage, onWritten } = opts;
  const toggle = useCallback(async (w: IntakeWarning, on: boolean, reason?: string): Promise<boolean> => {
    // Captured at the click: a sidebar click during the write must not move
    // the result onto whoever is open by the time it lands.
    const itemId = id;
    if (!itemId || !enabled) return false;
    setBusyKey(w.key);
    try {
      const next = await setIntakeWarningAck(itemId, w, on, { stage, reason });
      setOverrides((o) => ({ ...o, [itemId]: { value: next, at: Date.now() } }));
      toast.success(on ? `Confirmed: ${w.label}` : `Un-ticked: ${w.label}`, {
        description: "Added to the intake notes.",
      });
      onWritten?.();
      return true;
    } catch (e) {
      toast.error("Couldn't save that tick", { description: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusyKey(null);
    }
  }, [id, enabled, stage, onWritten]);

  const markCheckStarted = useCallback(() => {
    if (!id) return;
    setOverrides((o) => ({ ...o, [id]: { value: "", at: Date.now() } }));
  }, [id]);

  return useMemo(() => ({
    warnings, acks, verdict, anthem, gatePatient,
    busyKey, toggle, markCheckStarted,
  }), [
    warnings, acks, verdict, anthem, gatePatient,
    busyKey, toggle, markCheckStarted,
  ]);
}
