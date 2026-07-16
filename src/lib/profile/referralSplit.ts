/**
 * Verified vs Unverified referral split for the Profile Send Off board —
 * one Monday group (1. Intake), two app roles, same pattern as the Chase
 * Clinicals fax/parachute split (CLAUDE.md §5.9):
 *
 *   unverifiedReferrals ("Unverified Referrals", /unverified-referrals) —
 *     Referral Type "Patient" OR Referral Source "CareCentrix".
 *   profile ("Verified Referrals", /profile) — everyone else.
 *
 * This function is the canonical rule for the SPA (ProfilePage + tests).
 * The SAME rule is duplicated where this module can't be imported —
 * change all of them together or the burndown/oversight counts drift
 * (§5.8 counting contract):
 *   1. src/hooks/useRoleCounts.ts        (profile board count task)
 *   2. scripts/snapshot-baseline.mjs     (build-time baseline, plain JS)
 *   3. services/baseline-cron/index.mjs  (9 AM Railway baseline, plain JS)
 *   4. src/lib/oversight/oversightApi.ts (CHART_FILTERS profile-send-off*)
 */

/** Live board labels the split keys on (see REFERRAL_TYPE_INDEX /
 *  REFERRAL_SOURCE_INDEX in mondayMapping.ts). Compared case-insensitively
 *  so a board label re-casing ("Carecentrix") can't silently move patients
 *  between roles. */
export const UNVERIFIED_REFERRAL_TYPE = "Patient";
export const UNVERIFIED_REFERRAL_SOURCE = "CareCentrix";

/**
 * True when a patient belongs to the Unverified Referrals role.
 *
 * NOTE: the Referral SOURCE column also has a "Patient" label — only the
 * Referral TYPE column routes "Patient" to Unverified. A patient-sourced
 * referral with, say, a Manufacturer type stays with Verified Referrals.
 */
export function isUnverifiedReferral(
  referralType: string | null | undefined,
  referralSource: string | null | undefined,
): boolean {
  const type = (referralType ?? "").trim().toLowerCase();
  const source = (referralSource ?? "").trim().toLowerCase();
  return (
    type === UNVERIFIED_REFERRAL_TYPE.toLowerCase() ||
    source === UNVERIFIED_REFERRAL_SOURCE.toLowerCase()
  );
}
