/**
 * "Already In System" for a DTC form lead — read from the duplicate check's
 * verdict, not from the Already In System column (Josh, 2026-08-19).
 *
 * ⚠️ WHY THIS ISN'T `alreadyInSystem`. The `duplicate-patient-check` Railway
 * automation now runs on both DTC form groups, but at two different depths:
 *
 *   New Form — Completed  → filed like any referral. It writes
 *     `Already In System` = Yes/No, which trips board automation 7922049614
 *     and MOVES the item into the Already In System group.
 *   New Form — Partial    → FLAG ONLY. It stamps `Dup Check Result` and
 *     deliberately never touches `Already In System`, because writing that
 *     column is what empties a rep's calling queue. An abandoned form is a
 *     lead to ring, not a filing decision.
 *
 * So for the population this flag exists to serve — partial leads sitting in
 * Info Collection — `alreadyInSystem` is blank by design, and the verdict
 * column is the only thing that knows. Reading `alreadyInSystem` here would
 * render a pill that is permanently absent for exactly the patients who need
 * it.
 *
 * The board column is written by Railway and never by this app.
 */

/** Verdicts that mean "we matched this person to an existing patient".
 *  Mirrors `RESULT_LABEL` in josh-monday-automations
 *  `automations/duplicate-analysis.js` — change the two together. */
const IN_SYSTEM_RESULTS = [
  "Duplicate",
  "Duplicate — updated info",
  "New order — different serving",
] as const;

/**
 * Verdicts that are deliberately NOT a flag:
 *   "New"           — checked, no match. The whole point of stamping it is that
 *                     a BLANK column keeps meaning "never checked".
 *   "Check failed"  — the automation errored; it knows nothing.
 *   "Needs review"  — an item somebody FILED as in-system that the matcher
 *                     could not corroborate. Those live in the Already In
 *                     System group with their own role and their own red
 *                     banner, so a pill here would be a second, weaker voice
 *                     on a question that queue already answers.
 */
export function isAlreadyInSystemResult(dupCheckResult: string | null | undefined): boolean {
  const v = (dupCheckResult ?? "").trim();
  return (IN_SYSTEM_RESULTS as readonly string[]).includes(v);
}
