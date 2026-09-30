/**
 * Expedited — a manager's "work this patient the same day" mark (§5.56).
 *
 * Brandon, 2026-09-30: *"katie has the ability to make a patient 'Expedited'…
 * Instead of when going to a new board and making the next action date the
 * following date, it makes it the same date"*. Josh: managers only, set from
 * the two intake stages (Referral Intake, Info Collection) and Profile Clean-Up;
 * same day for Auth Outstanding too; Benefits left alone (it is already same
 * day — nothing dates a Benefits arrival).
 *
 * ONE status column per board, all titled "Expedited" with ONE label, created
 * 2026-09-30 and read back the same day (`settings_str`: `{"2":"Expedited"}` on
 * all four). The mark is SET on Profile Send Off only; the other three are
 * filled by the create-item hops that copy it forward — which a person maps in
 * Monday's UI:
 *   7917676280  Profile Send Off → Medical Evaluation   (Advance to MN)
 *   7923595946  Profile Send Off → Welcome Call         (cash pay, §5.48)
 *   7918295320  Medical Evaluation → Insurance
 *   7918324247  Insurance → Welcome Call
 * The hops copy a status by LABEL TEXT, so the label must read exactly
 * "Expedited" on every board.
 *
 * ⚠️ BLANK MEANS NORMAL here, deliberately — the one place §9's "a blank is
 * unknown, not no" does not bite: unknown and normal lead to the same thing
 * (the next-business-day date every arrival already gets), so nobody is sold
 * or skipped anything because a value was missing.
 */

/** Column ids, per board. Created 2026-09-30. */
export const EXPEDITED_COL = {
  /** Profile Send Off (18406352652) — the only one the app WRITES. */
  profileSendOff: "color_mm7pywyh",
  /** Medical Evaluation (18406060017) — read by the Evaluate arrival stamp. */
  medicalEvaluation: "color_mm7pkb92",
  /** Insurance (18410601299) — read by the Submit Auth send. */
  insurance: "color_mm7ppqbn",
  /** Welcome Call (18410804557) — read by the Welcome Call arrival stamp. */
  welcomeCall: "color_mm7p9hm0",
} as const;

/** The column's only label. The hops copy by this text — never rename it on
 *  one board alone. */
export const EXPEDITED_LABEL = "Expedited";

/** Its id on Profile Send Off, read back from `settings_str` after the column
 *  was created — Monday picks label ids (§9), this one was never inferred. */
export const EXPEDITED_INDEX = 2;

/** Does a column's text say Expedited? Blank (and anything else) = normal. */
export function isExpedited(text: string | null | undefined): boolean {
  return (text ?? "").trim().toLowerCase() === EXPEDITED_LABEL.toLowerCase();
}
