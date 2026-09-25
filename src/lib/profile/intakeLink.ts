/**
 * The ONE builder for a deep link into the intake profile pages, routed by the
 * item's GROUP (Josh, 2026-09-25, on Jason Ortiz-Troxell: *"in the intake his
 * item says its a partial but when i hyperlink it opens as a successful full
 * form fillout … look for anywhere else this is the case"*).
 *
 * ⚠️ `UnverifiedReferralsPage` reads `?source=` and DEFAULTS TO **completed**
 * when it is absent, and a deep-linked `?patientId=` is injected into the
 * sidebar whatever group the item sits in (§5.10) — so a Partial Leads patient
 * linked without the param opened under the Completed selector and the page
 * chrome called an abandoned form a successful one. Same class one step
 * further: a Profile Clean-Up patient linked to `/unverified-referrals` opened
 * under Info Collection. Every link built from a place that KNOWS the group
 * goes through here; a caller that genuinely does not know passes nothing and
 * gets today's behaviour (the completed default), never a guess.
 */
import { GROUPS } from "./mondayApi";

export function intakeProfileHref(
  itemId: string,
  groupId?: string | null,
  extraQuery = "",
): string {
  const id = encodeURIComponent(itemId);
  const tail = extraQuery ? `&${extraQuery}` : "";
  if (groupId === GROUPS.profileCleanUp) return `/profile-cleanup?patientId=${id}${tail}`;
  if (groupId === GROUPS.newFormPartial) return `/unverified-referrals?source=partial&patientId=${id}${tail}`;
  return `/unverified-referrals?patientId=${id}${tail}`;
}
