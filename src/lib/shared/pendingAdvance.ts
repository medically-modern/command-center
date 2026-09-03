/**
 * Optimistic stage-advance hiding — "it went through, get them off my screen".
 *
 * Shared by every role queue (masheke · Insurance · Welcome Call · Final
 * Confirm · the four Profile Send Off queues). A successful send flips a Stage
 * Advancer, but the queue only learns about it on the next poll (15-30s), and
 * on the group-fetch boards it must additionally wait for the Monday
 * automation to MOVE the item. So for up to half a minute after a send that
 * WORKED, the patient sat in the sidebar with the panel still rendering them
 * and the Send button re-enabled — a screen indistinguishable from "the send
 * didn't happen".
 *
 * Reps re-pressed. Masheke did it on three patients on 2026-09-03 (Joseph
 * Bowser 12936243860, Robert Bianco 12936759879, Frank Fuller 12937936786):
 * every first press landed, every second was refused by the advancer no-op
 * guard (§9). Nothing was lost — but nothing on screen had told her either way.
 *
 * The fix is to hide the patient the moment the send resolves. The hazard in
 * doing that is the mirror image: hide a patient whose write did NOT land and
 * they vanish from the only queue that would surface them, which is the
 * invisibility this codebase keeps paying for (§5.10, §5.12, §7).
 *
 * ⚠️ So a marker is a CLAIM WITH AN EXPIRY, never a permanent verdict. It hides
 * the patient for `PENDING_ADVANCE_TTL_MS` and then lapses. If the advance
 * landed, the board has long since stopped returning them and the lapse changes
 * nothing. If it did not, the patient is back in the rep's queue, on the board's
 * say-so rather than ours.
 *
 * ⚠️ **A marker is never spent on ABSENCE, and that is the point** (Greptile,
 * PR #54). The obvious optimisation — "the patient is no longer in the fetched
 * queue, so the advance landed, drop the marker" — reads a missing row as
 * evidence, and on these boards it is not: every `fetchGroupItems` swallows a
 * pagination error and RETURNS THE PAGES IT GOT (`catch { break }`), so a
 * patient still sitting in the stage can simply be missing from a poll. Spending
 * the marker there un-hides them early, with a live Send button, which is the
 * re-send window this exists to close. Same rule, same reason, as the patient
 * directory's `isOrphanRow` (§5.29): act on positive evidence, and let absence
 * mean nothing. The cost is one lost nicety — a patient a manager returns to the
 * queue inside the TTL stays hidden until it lapses.
 *
 * ⚠️ Which is also why hiding is applied at COMMIT time, not when the list is
 * built (Greptile, same review). A poll that computed its list, then awaited a
 * deep-link fetch, would otherwise commit an array assembled before the marker
 * existed and put the patient — Send button and all — straight back on screen.
 */

/** How long a patient stays hidden before the claim lapses. Four polls' worth:
 *  long enough that no reasonable indexing or automation lag brings a real
 *  advance back, short enough that a failed one returns while the rep is still
 *  working the queue. */
export const PENDING_ADVANCE_TTL_MS = 120_000;

export type PendingAdvanceVerdict =
  /** Inside the window — keep hiding them. */
  | "hide"
  /** The window has passed. Drop the marker; whether the patient reappears is
   *  the board's call, not ours. */
  | "expired";

/**
 * Decide whether one optimistic marker still applies.
 *
 * @param markedAt when the send resolved (ms since epoch).
 * @param now current time (ms since epoch) — passed in so this is pure.
 */
export function pendingAdvanceVerdict(
  markedAt: number,
  now: number,
  ttlMs: number = PENDING_ADVANCE_TTL_MS,
): PendingAdvanceVerdict {
  return now - markedAt >= ttlMs ? "expired" : "hide";
}

/**
 * Drop lapsed markers, then hide whoever is still marked.
 *
 * ⚠️ Call this AT THE POINT OF COMMIT — `setPatients(applyPendingAdvances(...))`
 * — not where the list is assembled. Everything between the two is an await
 * during which a send can resolve, and a list filtered before that would put
 * the patient back on screen.
 *
 * ⚠️ Pass the list the sidebar actually renders. Every queue draws its boundary
 * differently (masheke matches a Stage Advancer, Insurance and Welcome Call
 * fetch a GROUP and wait on an automation, Patient Intake splits on referral
 * type), and re-implementing any of those here would drift from the real one —
 * the §5.9/§5.10 keep-in-agreement trap. Taking the built list makes agreement
 * structural.
 *
 * Mutates `pending` only to drop lapsed markers. A patient's absence from
 * `list` is deliberately NOT treated as evidence of anything (see above).
 */
export function applyPendingAdvances<T extends { id: string }>(
  list: T[],
  pending: Map<string, number>,
  now: number = Date.now(),
  ttlMs: number = PENDING_ADVANCE_TTL_MS,
): T[] {
  if (pending.size === 0) return list;
  for (const [id, markedAt] of [...pending]) {
    if (pendingAdvanceVerdict(markedAt, now, ttlMs) === "expired") pending.delete(id);
  }
  return pending.size === 0 ? list : list.filter((p) => !pending.has(p.id));
}
