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

/**
 * Referral Sources whose clinicals come through a partner dashboard.
 *
 * ⚠️ Both spellings. The board label was corrected from "District Endochrine"
 * to "District Endocrine" (Sept 2026) and a status column stores the label id,
 * so every live row renders the new text — but the partner dashboard matches
 * both for the same reason, and a label deleted and re-created would come back
 * under whichever spelling somebody typed. Matching both costs nothing; the
 * failure it guards is a doctor silently defaulting to Fax.
 */
const DASHBOARD_REFERRAL_SOURCES = ["District Endocrine", "District Endochrine"];

/**
 * The Clinicals Method a NEW doctor should default to for this patient, or
 * `null` to leave the caller's own default alone.
 *
 * The doctor form defaults to `Fax`, and for a practice we never fax that is
 * how a Dashboard doctor silently becomes a Fax one — the mistake a rep makes
 * by not touching the dropdown, which only surfaces at Advance to MN (§5.19b
 * records the same shape for Parachute doctors with no fax).
 *
 * ⚠️ Returns null rather than "Fax" so a caller with a better guess of its own
 * — the Parachute signature-count suggestion — keeps it. This only ever
 * overrides that guess for a partner whose requests genuinely go to a
 * dashboard, which is the one case where the signature count is beside the
 * point.
 */
export function dashboardDefaultMethod(referralSource: string | null | undefined): "Dashboard" | null {
  return DASHBOARD_REFERRAL_SOURCES.includes((referralSource ?? "").trim()) ? "Dashboard" : null;
}
