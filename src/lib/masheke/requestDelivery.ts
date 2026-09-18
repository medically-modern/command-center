/**
 * requestDelivery.ts — who actually carries the request out of Send Request.
 *
 * ⚠️⚠️ **THIS IS NOT `chaseMethods.ts`, AND THE TWO SETS DIFFER BY `Email`.**
 * That file answers "which chase QUEUE owns this patient" and says so: it
 * decides routing, cadence and counting, never the screen. This one answers a
 * different question — "do WE send the request, or does a portal?" — and it is
 * the one the Send Request page keys off.
 *
 * | | Fax | Email | Parachute | Dashboard |
 * |---|---|---|---|---|
 * | `isParachuteRoleMethod` (chaseMethods) — the QUEUE | no | **yes** | yes | **yes** |
 * | `isPortalMethod` (here) — Send Request BEHAVIOUR | no | **no** | yes | **yes** |
 *
 * `Email` is in the queue set and not this one: it rides with Parachute for
 * cadence and manager reporting but is still **sent by us**, so it keeps the
 * Generate Scripts step, the open composer and the hop through Confirm
 * Receipt. ⚠️ **Merging the two sets would silently stop every Email patient's
 * receipt being confirmed** — no error, just a stage nobody passes through.
 *
 * A portal method (Parachute, Dashboard) has nothing for us to dispatch, so:
 *   · no Generate Scripts step — the template is optional, inside the composer
 *   · the composer starts collapsed
 *   · **Request Sent** is the primary action: the rep presses it to confirm
 *     they sent it in the portal, and it advances straight to Chase Clinicals
 *     (+3 business days) rather than through Confirm Receipt, because there is
 *     no fax or email whose arrival anybody here could confirm.
 *
 * Dashboard is Parachute in every one of those respects (Josh, 2026-09-18:
 * *"however we treat a parachute method is how we are treating dashboard
 * methods"*) — there is deliberately no auto-advance and no Monday column
 * gating the button.
 */

/** Clinicals Methods whose request is carried by a portal, not sent by us. */
export const PORTAL_METHODS: string[] = ["Parachute", "Dashboard"];

/** True when the request is delivered through a portal rather than by us. */
export function isPortalMethod(clinicalsMethod: string | null | undefined): boolean {
  return PORTAL_METHODS.includes((clinicalsMethod ?? "").trim());
}
