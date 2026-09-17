/**
 * partnerDashboard.ts — where a `Dashboard`-method request is actually worked.
 *
 * Clinicals Method `Dashboard` (§5.9, label id 3) means the request is sent and
 * chased through the partner's own dashboard rather than by fax, email or
 * Parachute. There is nothing for the Command Center to dispatch, so the whole
 * affordance is a link out.
 *
 * ⚠️ **This is the ROSTER, deliberately — not a per-patient deep link.** The
 * dashboard serves patients at `/patient/:patientId`, where `patientId` is a
 * 64-bit hash of `uid_<Patient UID>`, kept opaque because it travels in URLs
 * and in email. Linking straight to a patient would cost two things we do not
 * want: the Patient UID added to the masheke read set, and a hand-copied
 * reimplementation of that hash — the §5.7/§5.17 mirror hazard, where a drift
 * 404s silently on exactly the patients who just advanced. The rep signs in and
 * searches the roster by name, which is on screen beside the button.
 *
 * ⚠️ **The href must stay a plain constant.** A browser only allows
 * `window.open` / a new tab during user activation, and an `await` before it
 * spends that activation — so an href that had to be fetched or resolved first
 * would be blocked by Safari and open a blank tab in Chrome. No lookup here.
 */

/** District Endocrine's partner dashboard. Opens in a new tab; rep signs in. */
export const DISTRICT_ENDOCRINE_DASHBOARD_URL = "https://district-endocrine.medicallymodern.com/";
