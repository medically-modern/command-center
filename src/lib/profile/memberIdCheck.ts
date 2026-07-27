/**
 * Member ID re-entry check.
 *
 * The Benefits Check flow deliberately asks the rep to re-enter the Member ID
 * AFTER the Stedi check has run, as a confirmation that the ID the check passed
 * on is really the right one. That re-entry lands in `memberId1`, while the ID
 * Stedi actually ran against stays in `workingMemberId` (text_mm4t8gbq).
 *
 * A double-entry confirmation only confirms anything if the two entries are
 * COMPARED. Until 2026-07, they weren't: `buildDataTasks` wrote both columns
 * unconditionally, so a wrong re-entry silently replaced a verified ID on the
 * way into the onboarding pipeline.
 *
 * Catherine Raska (item 12624053600, 2026-07-24): the referral webhook
 * extracted policy number 743735619, Stedi confirmed coverage active on it,
 * and the re-entry field then received the prescriber's name — "LINDSAY
 * GAETANI" — which advanced to Medical Evaluation as the member ID while the
 * correct value existed nowhere on that item. Both values were sitting in the
 * same patient object at the moment of the write.
 *
 * This module is the comparison that was missing. It is advisory, not a hard
 * block: there is one legitimate divergence (the Fidelis supplies-only →
 * NY Medicaid case noted on COL.memberId1), so the caller confirms rather
 * than refuses.
 */

/**
 * Normalize a member ID for comparison only — never for writing.
 *
 * Upper-cases and drops spaces, dashes and dots so cosmetic formatting
 * ("74373-5619" vs "743735619") doesn't read as a real divergence. Anything
 * beyond formatting still differs.
 */
export function normalizeMemberId(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[\s.-]/g, "");
}

export interface MemberIdReentryCheck {
  /** True when the re-entered ID is a real divergence from the verified one. */
  mismatch: boolean;
  /** The re-entered value, as the rep left it (for display). */
  entered: string;
  /** The value Stedi ran against, as stored (for display). */
  verified: string;
}

/**
 * Compare the re-entered Member ID 1 against the working Member ID that Stedi
 * ran against.
 *
 * Returns `mismatch: false` when either side is blank — a missing working ID
 * means the item predates the Benefits Check redesign and there is nothing
 * authoritative to compare against, and a blank re-entry is already caught by
 * the send-off checklist. Only two present-and-different values are flagged.
 */
export function checkMemberIdReentry(p: {
  memberId1?: string | null;
  workingMemberId?: string | null;
}): MemberIdReentryCheck {
  const entered = (p.memberId1 ?? "").trim();
  const verified = (p.workingMemberId ?? "").trim();

  if (!entered || !verified) {
    return { mismatch: false, entered, verified };
  }

  return {
    mismatch: normalizeMemberId(entered) !== normalizeMemberId(verified),
    entered,
    verified,
  };
}
