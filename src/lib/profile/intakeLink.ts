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
 *
 * ⚠️ **Every group that HAS a queue is listed — not just the form groups**
 * (Josh, 2026-10-02: *"it should always open them in the place they actually
 * are"*). The map used to know Partial Leads and Clean-Up only, so everything
 * else fell to the Info Collection default — including **1. Intake** and
 * **Already In System**. The patient screen's "Open Profile Send Off" button
 * builds its link here for every live Profile Send Off record
 * (`patientScreen.itemOpenHref`), so a doctor referral sitting in 1. Intake
 * (reported 2026-10-02) opened on Info Collection — injected there
 * as a deep link, offering that page's exits — while Monday, Search and the
 * Referral Intake sidebar all had him in Referral Intake. The routes are
 * Search's `groupRoutes` for the same groups (`systemMgmt/mondayApi.ts`), so
 * the two doors agree. A group with no queue (Stuck, Patient Intake, Tests)
 * keeps the default here; the patient screen and the Communications panel
 * use `intakeQueueHref` instead and fall back to the record's own route, so a
 * Stuck patient opens on Referral Intake there, the page Search opens.
 */
import { GROUPS } from "./mondayApi";

/** The page each Profile Send Off group with a queue is worked on. */
const QUEUE_ROUTE: ReadonlyMap<string, string> = new Map([
  [GROUPS.intake, "/profile"],
  [GROUPS.alreadyInSystem, "/in-system-referrals"],
  [GROUPS.newFormPartial, "/unverified-referrals"],
  [GROUPS.newFormCompleted, "/unverified-referrals"],
  [GROUPS.profileCleanUp, "/profile-cleanup"],
]);

/**
 * The link for an item in a group that HAS a queue, or null for any other
 * group (Stuck, Patient Intake, Tests, Completed, unknown). Callers that have
 * their own answer for a parked record (the record's `route`, as every other
 * board uses) fall back to it on null — see `patientScreen.itemOpenHref` and
 * `commsHub/dossier.liveRecordHref`.
 */
export function intakeQueueHref(
  itemId: string,
  groupId?: string | null,
  extraQuery = "",
): string | null {
  const route = groupId ? QUEUE_ROUTE.get(groupId) : undefined;
  if (!route) return null;
  const id = encodeURIComponent(itemId);
  const tail = extraQuery ? `&${extraQuery}` : "";
  if (groupId === GROUPS.newFormPartial) return `${route}?source=partial&patientId=${id}${tail}`;
  return `${route}?patientId=${id}${tail}`;
}

export function intakeProfileHref(
  itemId: string,
  groupId?: string | null,
  extraQuery = "",
): string {
  const tail = extraQuery ? `&${extraQuery}` : "";
  return (
    intakeQueueHref(itemId, groupId, extraQuery) ??
    `/unverified-referrals?patientId=${encodeURIComponent(itemId)}${tail}`
  );
}
