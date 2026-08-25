/**
 * The advance-unlock rule for the Unverified Referrals intake stage
 * (HANDOFF §2). Every condition must pass before a rep can advance a
 * patient to Profile Clean-Up.
 *
 * Kept as a pure module so the checklist the rep sees and the guard on the
 * button are computed from the SAME function — a disabled button whose
 * explanation is derived separately is how the two drift apart.
 */

import type { Patient } from "./workflow";

export interface UnlockCondition {
  id: "authorised" | "stediRan" | "active" | "cgmPath" | "pumpPath";
  label: string;
  passed: boolean;
  /** Shown when the condition fails — what the rep should actually do. */
  hint: string;
}

/**
 * Is a product category in play for this patient? Mirrors the page's own
 * category seeding: any value in that product's column group, or the request
 * type naming it. A category with nothing behind it doesn't demand a path —
 * but the moment anything CGM/pump-shaped exists, its coverage path becomes a
 * blocker (Josh, 2026-08-18).
 */
export function cgmInPlay(p: Patient): boolean {
  return Boolean(
    (p.cgmCoveragePath ?? "").trim() || (p.formCgmPreference ?? "").trim() ||
    (p.cgmDataAwareness ?? "").trim() || /cgm|monitor/i.test(p.requestType ?? ""),
  );
}
export function pumpInPlay(p: Patient): boolean {
  return Boolean(
    (p.insulinPumpCoveragePath ?? "").trim() || (p.formPumpPreference ?? "").trim() ||
    (p.formPumpNeed ?? "").trim() || /pump/i.test(p.requestType ?? ""),
  );
}

export interface UnlockState {
  conditions: UnlockCondition[];
  unlocked: boolean;
}

const yes = (v: string | undefined) => (v ?? "").trim().toLowerCase() === "yes";
const truthy = (v: string | undefined) => (v ?? "").trim() !== "";

/** Did the eligibility check run and come back without erroring?
 *  A failed check can never advance — it means the identifiers didn't match,
 *  not that the patient is ineligible. */
export function stediRanCleanly(p: Patient): boolean {
  if (truthy(p.stediErrorDescription)) return false;
  // Something has to have come back. Plan name or an active flag is the
  // cheapest evidence the run actually produced a result.
  return truthy(p.stediEligibilityActive) || truthy(p.stediPlanName);
}

export function coverageActive(p: Patient): boolean {
  const v = (p.stediEligibilityActive ?? "").trim().toLowerCase();
  return v === "yes" || v === "active" || v === "true";
}

/**
 * The network answer has FOUR states, and collapsing them to two is the bug
 * this replaces (Thomas Swan, 2026-08-25).
 *
 * `In Network?` (`text_mm1xehx8`) is written by the `stedi-monday-integration`
 * service, and it does not always carry an answer: a 271 for Original Medicare
 * A&B has no network indicator at all — fee-for-service Medicare has no
 * network, only supplier participation — so the column comes back the literal
 * string `Unknown`. The old boolean read anything-that-isn't-Yes as a No, so
 * the page told the rep the patient was OUT-of-network, which is a different
 * and false statement, and the advance gate then stranded them on a condition
 * that could never come back Yes.
 *
 * ⚠️ An UNRECOGNISED value is `unknown`, never `no`. A string we have no rule
 * for is a missing answer; reporting it as a negative is exactly what went
 * wrong. On the live board (2026-08-25) this column held Yes x2 and Unknown x9
 * across 500 rows — not one real negative had ever been written.
 */
export type NetworkAnswer = "yes" | "no" | "unknown" | "none";

const NETWORK_YES = new Set(["yes", "in network", "in-network", "true"]);
const NETWORK_NO = new Set([
  "no", "out of network", "out-of-network", "not in network", "oon", "false",
]);

export function networkAnswer(p: Patient | null | undefined): NetworkAnswer {
  const v = (p?.stediInNetwork ?? "").trim().toLowerCase();
  if (!v) return "none";
  if (NETWORK_YES.has(v)) return "yes";
  if (NETWORK_NO.has(v)) return "no";
  return "unknown";
}

/** Positively confirmed in-network. Drives the readout's green Yes ONLY — it
 *  is deliberately not a gate any more (see `evaluateUnlock`). */
export function inNetwork(p: Patient): boolean {
  return networkAnswer(p) === "yes";
}

/** Condition 1: the patient authorised us to send, or the rep completed the
 *  intake call in their place. A patient who asked for a call has NOT
 *  authorised us yet — that is the whole reason this condition exists. */
export function patientAuthorised(p: Patient): boolean {
  if ((p.formProceedPreference ?? "").trim() === "Send request now") return true;
  return yes(p.intakeCallComplete);
}

export function evaluateUnlock(p: Patient | null | undefined): UnlockState {
  if (!p) {
    return {
      unlocked: false,
      conditions: [],
    };
  }

  const conditions: UnlockCondition[] = [
    {
      id: "authorised",
      label: "Patient authorised the request",
      passed: patientAuthorised(p),
      hint: 'Patient asked for a call first — complete it, then tick "Intake Call Complete".',
    },
    {
      id: "stediRan",
      label: "Benefits check ran without error",
      passed: stediRanCleanly(p),
      hint: truthy(p.stediErrorDescription)
        ? `Check failed: ${p.stediErrorDescription}. Usually a name / DOB / Member ID mismatch — correct it on the left and re-run.`
        : "Run the benefits check from the insurance block.",
    },
    {
      id: "active",
      label: "Coverage is active",
      passed: coverageActive(p),
      hint: "Coverage came back inactive — call the patient and confirm their plan.",
    },
  ];

  /* ⚠️ THE NETWORK ANSWER NO LONGER GATES THE ADVANCE (Josh, 2026-08-25).
     There used to be a fourth condition here — "Plan is in-network", hinting
     "Out-of-network — this needs escalation, not an advance" — and it was
     unpassable for whole populations: Original Medicare returns `Unknown` for
     network (see `networkAnswer`), which the old boolean read as a No, so
     those patients sat in the queue with a greyed-out Advance and no route
     out. That is the same dead end §5.10 records reversing for Verified
     Referrals. The answer is still SHOWN in the benefits readout, where a rep
     can act on a genuine Out-of-Network; this stage warns, it does not block.
     Coverage being INACTIVE still blocks — that is a real, answerable fact
     about the patient, and re-running the check is what clears it. */

  // Coverage paths block the advance (Josh, 2026-08-18) — but only for the
  // product categories actually in play, so a CGM-only patient is never asked
  // for a pump path. A category whose only signal IS its path trivially
  // passes, which is the right degenerate case.
  if (cgmInPlay(p)) {
    conditions.push({
      id: "cgmPath",
      label: "CGM Coverage Path chosen",
      passed: truthy(p.cgmCoveragePath),
      hint: "Pick the CGM Coverage Path in What They Need.",
    });
  }
  if (pumpInPlay(p)) {
    conditions.push({
      id: "pumpPath",
      label: "Insulin Pump Coverage Path chosen",
      passed: truthy(p.insulinPumpCoveragePath),
      hint: "Pick the Insulin Pump Coverage Path in What They Need.",
    });
  }

  return { conditions, unlocked: conditions.every((c) => c.passed) };
}
