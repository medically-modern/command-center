/**
 * Verified / Unverified / Already-In-System split for the Profile Send Off
 * board — one Monday group (1. Intake), THREE app roles, same pattern as the
 * Chase Clinicals fax/parachute split (CLAUDE.md §5.9):
 *
 *   inSystemReferrals ("Already In System", /in-system-referrals) —
 *     Already In System = "Yes". Checked FIRST, so an already-in-system
 *     patient works out of this queue no matter what referral type/source
 *     they carry.
 *   unverifiedReferrals ("Unverified Referrals", /unverified-referrals) —
 *     Referral Type "Patient" OR Referral Source "CareCentrix".
 *   profile ("Verified Referrals", /profile) — everyone else.
 *
 * The three are MUTUALLY EXCLUSIVE and cover the whole group: every active
 * intake patient lands in exactly one queue, so the role counts still sum to
 * the group total (§5.8 counting contract) and no patient is worked twice.
 *
 * `profileReferralRole` is the canonical rule for the SPA (ProfilePage +
 * tests). The SAME rule is duplicated where this module can't be imported —
 * change all of them together or the burndown/oversight counts drift:
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
/** Already In System (color_mm2xe7r8) labels: "Yes" / "No" (blank = unset). */
export const IN_SYSTEM_YES = "Yes";

/** Which of the three intake roles a patient belongs to. */
export type ProfileReferralRole = "inSystem" | "unverified" | "verified";

/**
 * True when a patient belongs to the Unverified Referrals role.
 *
 * NOTE: the Referral SOURCE column also has a "Patient" label — only the
 * Referral TYPE column routes "Patient" to Unverified. A patient-sourced
 * referral with, say, a Manufacturer type stays with Verified Referrals.
 *
 * This ignores Already In System — use `profileReferralRole` for the actual
 * queue a patient lands in.
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

/** True when the Already In System status column says "Yes" (blank/"No"/any
 *  other value = not in system, so an unset column can never hide a patient
 *  from the verified/unverified queues). */
export function isAlreadyInSystem(alreadyInSystem: string | null | undefined): boolean {
  return (alreadyInSystem ?? "").trim().toLowerCase() === IN_SYSTEM_YES.toLowerCase();
}

/**
 * The one queue a Profile Send Off intake patient belongs to.
 * Already In System wins over the referral type/source split.
 */
export function profileReferralRole(
  referralType: string | null | undefined,
  referralSource: string | null | undefined,
  alreadyInSystem: string | null | undefined,
): ProfileReferralRole {
  if (isAlreadyInSystem(alreadyInSystem)) return "inSystem";
  // ⚠️ 1. Intake NO LONGER SPLITS on referral type/source (Josh, 2026-08-10).
  // Patient Intake is the DTC form's own two GROUPS and nothing else, so
  // everything left in 1. Intake that isn't already in the system is Verified
  // Referrals. Routing "unverified" from here would filter those patients off
  // /profile's list while the role count and profile-send-off chart still
  // included them — counted and charted, but unopenable.
  //
  // `isUnverifiedReferral` is kept: it is still the right question to ask
  // ABOUT a referral, and Oversight labels by Referral Type / Source. It just
  // no longer decides the queue.
  void referralType; void referralSource;
  return "verified";
}
