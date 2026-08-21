/**
 * "Provided Doctor Info" for referrals that never went through the DTC form.
 *
 * The intake page's Provided Doctor Info card reads two columns the **DTC web
 * form** owns — Provided Doctor Name `text_mm5z586h` and Provided Clinic Phone
 * `text_mm5zjh88` (`lib/profile/mondayApi.ts` COL). A patient who filled that
 * form in typed those answers themselves, so the card is a faithful record of
 * what they told us.
 *
 * A **CareCentrix** patient never touches that form. They arrive through the
 * Manual Patient Intake Form on the DTC Intake board (18392794310, view
 * 231897594), and its create-item automation copies the doctor details into the
 * board's VERIFIED doctor columns instead — Doctor Name `text_mm1x46et`, Doctor
 * Phone `phone_mm1xz8c0` — leaving both Provided columns blank. So the card
 * rendered empty for exactly the patients whose doctor we already knew, while
 * the same values sat one column over on the same item (Josh, 2026-08-21).
 *
 * This fills the gap from the referral, CareCentrix only. Two rules make it
 * safe rather than merely convenient:
 *
 *  1. **A real provided answer always wins.** The fallback only ever fills a
 *     BLANK slot, so a DTC patient's own words can never be shadowed by a
 *     verified value — and the two populations are disjoint today anyway (every
 *     other item in the form groups is Referral Source "Patient").
 *  2. **It is a DISPLAY projection, never a write.** `Patient` is left exactly
 *     as the board has it, so `intakeEditsFor` still sends a blank Provided
 *     column and Save is a no-op. That matters: Select Correct Provider can
 *     change the verified doctor later, and writing the fallback back would let
 *     a corrected name overwrite the "as provided" record — losing the very
 *     discrepancy the two column sets exist to show (`unverifiedWrite.ts` §2,
 *     "Provided ≠ verified"). If the rep types over the value, that IS a
 *     provided answer and saves normally.
 *
 * ⚠️ The clinic slot falls back to Clinic Address **and then Doctor Phone**,
 * not Clinic Address alone. The manual form asks for a clinic address, but its
 * create-item automation does not copy it — of the doctor block only Name and
 * Phone survive the board hop (verified on item 12866837152, 2026-08-21). Clinic
 * Address is filled in later, by Select Correct Provider on the right pane. So
 * Clinic Address alone would leave the field blank on precisely the fresh
 * referral it was added for. The column is labelled "Clinic Phone / Location";
 * both answers belong in it.
 */

import { UNVERIFIED_REFERRAL_SOURCE } from "./referralSplit";

/** Just the fields the rule reads — a `Patient` satisfies it. */
export interface ReferralDoctorInput {
  referralSource?: string | null;
  formProvidedDoctorName?: string | null;
  formProvidedClinicPhone?: string | null;
  doctorName?: string | null;
  doctorPhone?: string | null;
  clinicAddress?: string | null;
}

export interface ReferralDoctorInfo {
  /** What to show in "Provided Doctor Name". */
  doctorName: string;
  /** What to show in "Provided Clinic Phone / Location". */
  clinicPhoneOrLocation: string;
  /** True when at least one slot was filled from the referral rather than from
   *  the patient's own form answer — the card prints a note when it is, so a
   *  rep never reads a referral fact as something the patient said. */
  fromReferral: boolean;
}

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/** Referral Source `color_mm1w5wxr` is "CareCentrix". Case-insensitive for the
 *  same reason `referralSplit` compares that way: a board re-casing must not
 *  silently change behaviour. */
export function isCareCentrixReferral(referralSource: string | null | undefined): boolean {
  return clean(referralSource).toLowerCase() === UNVERIFIED_REFERRAL_SOURCE.toLowerCase();
}

/**
 * What the Provided Doctor Info card should DISPLAY. Never write the result
 * back to Monday — see rule 2 above.
 */
export function referralDoctorInfo(p: ReferralDoctorInput): ReferralDoctorInfo {
  const provided = clean(p.formProvidedDoctorName);
  const providedClinic = clean(p.formProvidedClinicPhone);

  if (!isCareCentrixReferral(p.referralSource)) {
    return { doctorName: provided, clinicPhoneOrLocation: providedClinic, fromReferral: false };
  }

  const referralName = clean(p.doctorName);
  const referralClinic = clean(p.clinicAddress) || clean(p.doctorPhone);

  const doctorName = provided || referralName;
  const clinicPhoneOrLocation = providedClinic || referralClinic;

  return {
    doctorName,
    clinicPhoneOrLocation,
    fromReferral: (!provided && !!referralName) || (!providedClinic && !!referralClinic),
  };
}
