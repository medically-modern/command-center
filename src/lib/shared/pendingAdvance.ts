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
 * every first press landed, every second press was refused by the advancer
 * no-op guard (§9) because the Sub-Stage already read "Send Request". Nothing
 * was lost — but nothing on screen had told her the first press worked, and
 * nothing told her the second one hadn't.
 *
 * The fix is to hide the patient the moment the send resolves. The hazard in
 * doing that is the mirror image: hide on a write that did NOT land and the
 * patient vanishes from the only queue that would have surfaced them, which is
 * the invisibility this codebase keeps paying for (§5.10, §5.12, §7).
 *
 * ⚠️ So the marker is a QUESTION, not a claim. It hides the patient while we
 * wait for the board to agree, and every poll re-asks: has the Stage Advancer
 * actually moved? The board's own answer decides.
 *   - moved (or the patient is out of this stage for any other reason) → the
 *     marker is spent; they're filtered out on their own merits from now on.
 *   - still sitting in this stage after TTL → the advance did not happen, so
 *     the patient COMES BACK and the rep can work them again.
 *
 * ⚠️ The TTL exists because the SPA cannot be told that a send failed after it
 * returned. `EvaluatePanel`'s send does not pass `requireDone`, so a gateway
 * job that is still running when `pollDone`'s 20s window closes resolves as
 * "submitted" and is treated as success — and it can still FAIL a few seconds
 * later (that is exactly what the three sends above did). Expiry is therefore
 * not a guess about why: it is a direct reading of the board, which is the only
 * thing that settles whether the patient still needs working.
 *
 * ⚠️ TTL must stay comfortably longer than a normal advance takes to show up —
 * a 30s poll plus Monday's indexing lag plus the gateway's ~26s of job retries.
 * Too short and a patient who really did advance flickers back into the queue,
 * which teaches reps to ignore the list.
 */

/** How long a patient stays hidden while the board has not yet confirmed the
 *  advance. Four polls' worth: long enough that indexing lag never bounces a
 *  real advance back, short enough that a failed one returns while the rep is
 *  still working the queue. */
export const PENDING_ADVANCE_TTL_MS = 120_000;

export type PendingAdvanceVerdict =
  /** Board hasn't confirmed yet and we're inside the window — keep them hidden. */
  | "hide"
  /** The patient is out of this stage — the advance landed. Drop the marker. */
  | "landed"
  /** Still in this stage past the window — the advance did not happen. Drop the
   *  marker so they reappear in the queue. */
  | "expired";

/**
 * Decide what to do with one optimistically-hidden patient on a poll.
 *
 * @param stillInStage does this queue's OWN filter still return the patient
 *   from the freshly-fetched board? A patient missing from the fetch entirely
 *   counts as NOT still in stage — they are not in this queue either way, so
 *   there is nothing left to hide.
 * @param markedAt when the send resolved (ms since epoch).
 * @param now current time (ms since epoch) — passed in so this is pure.
 */
export function pendingAdvanceVerdict(
  stillInStage: boolean,
  markedAt: number,
  now: number,
  ttlMs: number = PENDING_ADVANCE_TTL_MS,
): PendingAdvanceVerdict {
  if (!stillInStage) return "landed";
  if (now - markedAt >= ttlMs) return "expired";
  return "hide";
}


/**
 * Apply a queue's pending markers to the list it just built, and reconcile them
 * against it.
 *
 * ⚠️ `queue` must be the list AFTER the caller's own filter — the same
 * membership test the sidebar renders. That is the point of taking a list
 * rather than a predicate: every queue draws its boundary differently (masheke
 * matches a Stage Advancer, Insurance and Welcome Call fetch a GROUP and wait
 * on an automation to move the item, Patient Intake splits on referral type),
 * and a re-implementation of any of those here would drift from the real one
 * and hide the wrong patients — the §5.9/§5.10 keep-in-agreement trap. Passing
 * the built list makes agreement structural.
 *
 * Mutates `pending`: a marker is dropped as soon as the board settles it,
 * either way. What comes back is the list minus whoever is still hidden.
 */
export function applyPendingAdvances<T extends { id: string }>(
  queue: T[],
  pending: Map<string, number>,
  now: number = Date.now(),
  ttlMs: number = PENDING_ADVANCE_TTL_MS,
): T[] {
  if (pending.size === 0) return queue;
  const present = new Set(queue.map((p) => p.id));
  for (const [id, markedAt] of [...pending]) {
    if (pendingAdvanceVerdict(present.has(id), markedAt, now, ttlMs) !== "hide") {
      pending.delete(id);
    }
  }
  return pending.size === 0 ? queue : queue.filter((p) => !pending.has(p.id));
}
