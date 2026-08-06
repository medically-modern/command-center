/**
 * The advance-unlock rule for the Unverified Referrals intake stage
 * (HANDOFF §2). All four conditions must pass before a rep can advance a
 * patient to Profile Clean-Up.
 *
 * Kept as a pure module so the checklist the rep sees and the guard on the
 * button are computed from the SAME function — a disabled button whose
 * explanation is derived separately is how the two drift apart.
 */

import type { Patient } from "./workflow";

export interface UnlockCondition {
  id: "authorised" | "stediRan" | "active" | "inNetwork";
  label: string;
  passed: boolean;
  /** Shown when the condition fails — what the rep should actually do. */
  hint: string;
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

export function inNetwork(p: Patient): boolean {
  const v = (p.stediInNetwork ?? "").trim().toLowerCase();
  return v === "yes" || v === "in network" || v === "in-network" || v === "true";
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
    {
      id: "inNetwork",
      label: "Plan is in-network",
      passed: inNetwork(p),
      hint: "Out-of-network — this needs escalation, not an advance.",
    },
  ];

  return { conditions, unlocked: conditions.every((c) => c.passed) };
}
