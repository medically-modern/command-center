/**
 * chaseMethods.ts — which Clinicals Methods share the Email, Parachute &
 * Dashboards chase role.
 *
 * One Monday stage ("Chase Clinicals" on the Masheke board) is sliced into two
 * app roles by Clinicals Method `color_mm1xw7y5` (§5.9). This module is that
 * list, in ONE place, because the split is applied in six and a value added to
 * one of them alone does not error — it silently routes the patient into the
 * other role.
 *
 * ⚠️ **The two roles are EXACT COMPLEMENTS.** `chaseParachute` is "method is in
 * this list"; `chaseFax` is "method is NOT in this list" (a blank method counts
 * as fax, so nobody falls through the cracks). A method added here therefore
 * leaves the fax role by construction — never add a value to one side only.
 *
 * ⚠️ **The two BASELINE GENERATORS cannot import this** — they are plain `.mjs`
 * run on Railway and in CI. They carry the same list as a literal, and the §5.8
 * counting contract says change them in the same commit:
 *   · `scripts/snapshot-baseline.mjs`    `countMashekeStages`
 *   · `services/baseline-cron/index.mjs` `countMashekeStages`
 * A drift there is silent: the burndown grows phantom +in/-out chips all day.
 *
 * ⚠️ **This decides the QUEUE, never the UI.** `Dashboard` rides with Parachute
 * and Email for routing, cadence and counting; everything that looks different
 * for those patients keys on the PATIENT's own
 * `clinicalsMethod === "Dashboard"`, never on the role — which is what keeps
 * the Fax, Parachute and Email screens byte-identical.
 */

/**
 * Clinicals Methods worked in the Email, Parachute & Dashboards chase role.
 * `Dashboard` joined 2026-09-17 (label id 3 on `color_mm1xw7y5`, every board).
 */
export const PARACHUTE_ROLE_METHODS: string[] = ["Parachute", "Email", "Dashboard"];

/** True when this Clinicals Method is worked in the Email, Parachute & Dashboards role. */
export function isParachuteRoleMethod(clinicalsMethod: string | null | undefined): boolean {
  return PARACHUTE_ROLE_METHODS.includes((clinicalsMethod ?? "").trim());
}
