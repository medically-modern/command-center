/**
 * lib/profile/doctorFaxRequired.ts — "the method is Fax, so there must be a fax
 * number", as ONE rule for the whole Profile Send Off board.
 *
 * Brandon, 2026-09-17 (with Katie): *"fax number should be required if method is
 * fax - right now there's no thing blocking this"*.
 *
 * ⚠️ **It was blocking on ONE of this board's two send-off routes and not the
 * other, and the screen said otherwise on both.** `ProfilePage` (Referral Intake
 * / Already In System) has carried a "Doctor Fax" readiness row for a while, and
 * its Advance to MN is gated on the checklist — so there it really did block.
 * The intake page (`UnverifiedReferralsPage`, Info Collection + Profile
 * Clean-Up) reaches the same Advance to MN through its own `readiness` list, and
 * that list had no such row: a patient whose Clinicals Method read `Fax` with an
 * empty Doctor Fax advanced straight through.
 * ⚠️ Worse than merely absent — `DoctorSection` renders on BOTH pages and its
 * cross-check banner ends *"it blocks send-off"*. On the intake page that
 * sentence was simply false, which is the one thing a warning must never be.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──
 * ⚠️ **A BLANK Clinicals Method is NOT caught**, and that is Brandon's wording
 * ("if method is fax") rather than an oversight. It is worth knowing that a
 * blank method is what §5.9 routes to the FAX chase queue, so those patients do
 * land in a queue whose whole job is faxing — `ProfilePage`'s own "Doctor
 * selected" note already records that gap. Widening this to blank is a
 * DECISION, not a tidy-up: measured on the live board 2026-09-17 across the
 * four live groups (78 rows), **3** carry `Fax` and every one of them already
 * has a fax number, while **~36** carry a blank method — so the ask blocks
 * nobody today and the widening would block three dozen patients at once.
 * ⚠️ **Presence, never FORMAT.** The column is an EMAIL column holding
 * `<digits>@rcfax.com` (§5.28), and judging the shape needs the live-board audit
 * `cardinalAddress` got before anyone could pick a severity — the same line
 * §5.32b draws for the blank doctor phone.
 *
 * Pure + unit-tested (`doctorFaxRequired.test.ts`). No fetches, no writes.
 */

/** The label the readiness row carries on both pages — one string, so the two
 *  checklists cannot describe the same requirement differently. */
export const DOCTOR_FAX_ROW_LABEL = "Doctor Fax";

/** Board label for the fax method, matched EXACTLY (`color_mm1xw7y5`). */
const FAX_METHOD = "Fax";

type DoctorFaxSource = {
  clinicalsMethod?: string | null;
  doctorFax?: string | null;
};

/**
 * Does this patient's Clinicals Method oblige us to hold a fax number?
 *
 * ⚠️ Exact match, trimmed. `Parachute` and `Email` are real methods that need no
 * fax, and a blank is unanswered — see the header for why an unanswered method
 * is left alone here rather than treated as a fax.
 */
export function faxMethodChosen(p: DoctorFaxSource): boolean {
  return (p.clinicalsMethod ?? "").trim() === FAX_METHOD;
}

/** Is a fax number on file at all? Presence only, deliberately. */
export function hasDoctorFax(p: DoctorFaxSource): boolean {
  return !!(p.doctorFax ?? "").trim();
}

/**
 * The thing every surface actually asks: is this patient short a fax they need?
 *
 * Drives the readiness row on both send-off routes AND `DoctorSection`'s
 * cross-check banner, so the warning and the gate are the same sentence about
 * the same fact — the banner claims it blocks send-off, and now it does.
 */
export function doctorFaxMissing(p: DoctorFaxSource): boolean {
  return faxMethodChosen(p) && !hasDoctorFax(p);
}
