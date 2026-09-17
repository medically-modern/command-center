/**
 * lib/profile/doctorFaxRequired.ts — "the method is Fax, so there must be a fax
 * we can actually send to", as ONE rule for the whole Profile Send Off board.
 *
 * Brandon, 2026-09-17 (with Katie): *"fax number should be required if method is
 * fax - right now there's no thing blocking this"*. Josh, same day, narrowing
 * what "a fax number" means: *"@rcfax.com address, is what needs to be required
 * if doctor is a fax doctor"*.
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
 * ── WHY THE SHAPE IS CHECKED AND NOT JUST THE PRESENCE ──
 * A first cut of this rule was presence-only, on the §5.32b reasoning that C30
 * flags a BLANK doctor phone and deliberately does not judge its format. That
 * was wrong here, and the board says why: this column is not a phone number, it
 * is a **delivery address** (§5.5 — RingCentral turns `<digits>@rcfax.com` into
 * a fax), so a value in the wrong shape is not an untidy number, it is a fax
 * that goes nowhere. Seven of the ~581 live values are exactly that, and every
 * one of them satisfies a presence check — see `shared/faxAddress.isFaxAddress`,
 * which owns the test and records the whole exception set.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──
 * ⚠️ **A BLANK Clinicals Method is NOT caught**, and that is Brandon's wording
 * ("if method is fax") rather than an oversight. It is worth knowing that a
 * blank method is what §5.9 routes to the FAX chase queue, so those patients do
 * land in a queue whose whole job is faxing — `ProfilePage`'s own "Doctor
 * selected" note already records that gap. Widening this to blank is a
 * DECISION, not a tidy-up, and the numbers are why: of the Fax-method rows on
 * the live board (2026-09-17) **415 have no fax at all**, 359 of them in *New
 * Form — Partial Leads* — the 8/25 bulk import (§5.30). None of those is
 * blocked today, because Info Collection's own Advance is gated on
 * `unlock.unlocked` alone; they meet this rule when they reach Profile
 * Clean-Up, whose Advance to MN reads the checklist. Reading a blank method as
 * a fax would pull all 415 in at once.
 *
 * Pure + unit-tested (`doctorFaxRequired.test.ts`). No fetches, no writes.
 */

import { isFaxAddress } from "@/lib/shared/faxAddress";

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
 * Does this patient's Clinicals Method oblige us to hold a fax address?
 *
 * ⚠️ Exact match, trimmed. `Parachute` and `Email` are real methods that need no
 * fax, and a blank is unanswered — see the header for why an unanswered method
 * is left alone here rather than treated as a fax.
 */
export function faxMethodChosen(p: DoctorFaxSource): boolean {
  return (p.clinicalsMethod ?? "").trim() === FAX_METHOD;
}

/** Is a SENDABLE fax address on file — `<digits>@rcfax.com`, not merely
 *  something in the box? The shape test is `shared/faxAddress.isFaxAddress`. */
export function hasDoctorFax(p: DoctorFaxSource): boolean {
  return isFaxAddress(p.doctorFax ?? "");
}

/**
 * Why this patient is short a fax, for a banner that has to say something
 * useful: `"blank"` (nothing on file) vs `"malformed"` (something is there and
 * it is not a fax address) vs `null` (nothing to report).
 *
 * ⚠️ The two cannot share one sentence. "Add a fax" is wrong for Clara
 * Perlstein, whose field holds `smweissoffice@gmail.com` — a rep reading it
 * sees a filled box and a message asking them to fill it, and concludes the
 * page is broken. The fix for her is to REPLACE what is there.
 */
export function doctorFaxGap(p: DoctorFaxSource): "blank" | "malformed" | null {
  if (!faxMethodChosen(p)) return null;
  if (!(p.doctorFax ?? "").trim()) return "blank";
  return isFaxAddress(p.doctorFax ?? "") ? null : "malformed";
}

/**
 * The thing every surface actually asks: is this patient short a fax they need?
 *
 * Drives the readiness row on both send-off routes AND `DoctorSection`'s
 * cross-check banner, so the warning and the gate are the same sentence about
 * the same fact — the banner claims it blocks send-off, and now it does.
 */
export function doctorFaxMissing(p: DoctorFaxSource): boolean {
  return doctorFaxGap(p) !== null;
}
