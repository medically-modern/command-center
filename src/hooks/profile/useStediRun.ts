/**
 * Runs a Stedi eligibility check and waits for it to settle.
 *
 * The sequencing here is NOT negotiable (HANDOFF §3) — it mirrors what
 * ProfilePage already does, extracted so the intake stage runs the identical
 * flow rather than a second, subtly different copy:
 *
 *   1. writePatientProfile   — Name / DOB / General Insurance / Member ID
 *   2. verifyProfileWritten  — up to 3 tries. If it fails, ABORT. Stedi must
 *                              never fire against data that didn't land, or it
 *                              checks the previous patient's identifiers.
 *   3. triggerStediRun       — clear the completion signals, force a real
 *                              status transition so the automation re-fires
 *   4. poll + settle         — the stedi-monday-integration service writes
 *                              results back ONE COLUMN AT A TIME, ~1/sec over
 *                              15–25s, and there is no "done" column. A single
 *                              new value is a PARTIAL result, so we fingerprint
 *                              the whole set and only finish once it has been
 *                              unchanged for STEDI_SETTLE_MS.
 *
 * This hook owns steps 1–3 and the settle bookkeeping; the caller drives
 * re-fetching (it already polls Monday) and feeds each fresh patient in.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { writePatientProfile, verifyProfileWritten, triggerStediRun } from "@/lib/profile/mondayWrite";

/** Poll Monday this often while a run is in flight. */
export const STEDI_POLL_MS = 4_000;
/** Results changed then went quiet this long → run complete. */
export const STEDI_SETTLE_MS = 10_000;
/** Nothing changed at all (re-run returned identical values) → finish anyway. */
export const STEDI_UNCHANGED_MS = 35_000;
/** Absolute cap — never spin past this. */
export const STEDI_TIMEOUT_MS = 95_000;

/** Fingerprint of every column the Stedi service writes. Any of them moving
 *  means the run is still streaming in. */
export function stediSignature(p: Patient): string {
  return [
    p.stediEligibilityActive, p.stediCoverageType, p.stediPayerName, p.stediPlanName,
    p.stediInNetwork, p.stediPriorAuthRequired, p.stediCoinsurance, p.stediCopay,
    p.stediIndividualDeductible, p.stediIndividualDeductibleRemaining,
    p.stediFamilyDeductible, p.stediFamilyDeductibleRemaining,
    p.stediIndividualOopMax, p.stediIndividualOopMaxRemaining,
    p.stediFamilyOopMax, p.stediFamilyOopMaxRemaining,
    p.stediPlanBeginDate, p.stediErrorDescription, p.stediPrimaryPayer,
    p.stediMedicareAdvantage, p.stediQmb, p.stediManagedMedicaid,
  ].join("|");
}

export type StediPhase = "idle" | "writing" | "verifying" | "running" | "done" | "error";

export interface StediRunState {
  phase: StediPhase;
  /** Which patient the run belongs to — so switching patients mid-run doesn't
   *  leak the spinner onto someone else. Cleared once the run ends. */
  runningId: string | null;
  /** The patient the latest run — or its failure, or its timeout — is about.
   *  Unlike `runningId` it survives the run ending, which is what lets the page
   *  print "didn't run: details didn't save" on THAT patient and not on the
   *  next one a rep opens (2026-09-24). */
  forId: string | null;
  /** When the rep pressed Run (ms since epoch), for the elapsed clock on the
   *  in-progress card. Null once the run has ended. */
  startedAt: number | null;
  message: string | null;
}

const IDLE: StediRunState = { phase: "idle", runningId: null, forId: null, startedAt: null, message: null };

export function useStediRun() {
  const [state, setState] = useState<StediRunState>(IDLE);

  const startSigRef = useRef("");
  const settleRef = useRef<{ sig: string; at: number } | null>(null);
  const snapshotRef = useRef({ eligibilityActive: "" });
  const deadlineRef = useRef(0);

  const reset = useCallback(() => {
    startSigRef.current = "";
    settleRef.current = null;
    deadlineRef.current = 0;
    setState(IDLE);
  }, []);

  /** Steps 1–3. Resolves true when the run was actually triggered. */
  const start = useCallback(async (p: Patient): Promise<boolean> => {
    const startedAt = Date.now();
    /** A run that ended without reaching the payer — named against its own patient. */
    const failed = (message: string): false => {
      setState({ phase: "error", runningId: null, forId: p.id, startedAt: null, message });
      return false;
    };

    setState({ phase: "writing", runningId: p.id, forId: p.id, startedAt, message: "Saving patient details…" });
    try {
      await writePatientProfile(p);
    } catch (e) {
      return failed(e instanceof Error ? e.message : "Could not save to Monday.");
    }

    setState({ phase: "verifying", runningId: p.id, forId: p.id, startedAt, message: "Confirming the details landed…" });
    const expected = {
      name: p.name,
      dob: p.dob ?? "",
      generalInsurance: p.generalInsurance ?? "",
      workingMemberId: p.workingMemberId ?? "",
    };

    let verified: { ok: boolean; mismatches: string[] } = { ok: false, mismatches: ["not attempted"] };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        verified = await verifyProfileWritten(p.id, expected);
      } catch (e) {
        verified = { ok: false, mismatches: [e instanceof Error ? e.message : "verify failed"] };
      }
      if (verified.ok) break;
      // Monday read replicas lag a write by a beat; give it one.
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }

    if (!verified.ok) {
      // Hard stop. Running Stedi now would check whatever IS on the board,
      // which is a different patient's answer — a wrong result is worse than
      // no result.
      return failed(`Not run — details didn't save: ${verified.mismatches.join("; ")}`);
    }

    startSigRef.current = stediSignature(p);
    snapshotRef.current = { eligibilityActive: p.stediEligibilityActive ?? "" };
    settleRef.current = null;
    deadlineRef.current = Date.now() + STEDI_TIMEOUT_MS;

    try {
      await triggerStediRun(p.id);
    } catch (e) {
      return failed(e instanceof Error ? e.message : "Could not start the check.");
    }

    setState({ phase: "running", runningId: p.id, forId: p.id, startedAt, message: "Running benefits check…" });
    return true;
  }, []);

  /**
   * Step 4. Feed every fresh copy of the patient in; returns true once the run
   * has settled. Safe to call on each poll.
   */
  const observe = useCallback((p: Patient | null | undefined): boolean => {
    if (state.phase !== "running") return false;

    // ⚠️ The deadline is checked BEFORE the patient match, and that order is the
    // fix (2026-09-24). It used to sit behind `state.runningId !== p.id`, so a
    // rep who pressed Run and then opened another patient left this hook
    // "running" for good: no poll of the other patient could ever match, the
    // deadline was never reached, and Run stayed greyed out on every patient
    // until they went back to the first. Ending the wait here costs nothing —
    // the service writes its answer onto the first patient's row whatever this
    // page is showing, and opening them reads it fresh.
    const now = Date.now();
    if (now > deadlineRef.current) {
      setState({
        phase: "done", runningId: null, forId: state.runningId, startedAt: null,
        message: "Check timed out — showing whatever came back.",
      });
      return true;
    }
    if (!p || state.runningId !== p.id) return false;

    const sig = stediSignature(p);
    const settle = settleRef.current;
    if (!settle || settle.sig !== sig) {
      settleRef.current = { sig, at: now };
      return false;
    }

    const stableFor = now - settle.at;
    const changedSinceRun = sig !== startSigRef.current;
    // A terminal signal must be present, so the trigger's own clearing of the
    // completion columns can't be mistaken for a finished (empty) run.
    const terminal =
      !!p.stediPlanName ||
      !!p.stediErrorDescription ||
      (!!p.stediEligibilityActive && p.stediEligibilityActive !== snapshotRef.current.eligibilityActive);

    if (terminal && changedSinceRun && stableFor >= STEDI_SETTLE_MS) {
      setState({ phase: "done", runningId: null, forId: p.id, startedAt: null, message: null });
      return true;
    }
    // A re-run that returned byte-identical values never "changes" — reveal
    // after a longer quiet window rather than spinning to the timeout.
    if (!changedSinceRun && stableFor >= STEDI_UNCHANGED_MS) {
      setState({ phase: "done", runningId: null, forId: p.id, startedAt: null, message: null });
      return true;
    }
    return false;
  }, [state.phase, state.runningId]);

  // ⚠️ Memoized. A hook that hands back a fresh object every render is a render
  // loop waiting for a caller to (correctly) list it in an effect's dependency
  // array — see src/hooks/useDeliveryRecheck.ts for the 2026-08-20 incident
  // where exactly that sent ~1,166 requests/sec at a production phone system.
  // UnverifiedReferralsPage does exactly that: `useEffect(… , [selected, stedi])`.
  // It does not loop today only because `observe` returns before any setState
  // unless a check is running — one line of change away from the same outage.
  return useMemo(
    () => ({
      state, start, observe, reset,
      isRunning: state.phase === "writing" || state.phase === "verifying" || state.phase === "running",
    }),
    [state, start, observe, reset],
  );
}
