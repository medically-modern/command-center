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

/**
 * How long a patient stays hidden before the claim lapses.
 *
 * ⚠️ **Fifteen minutes since 2026-09-25, measured, not chosen** (Keith Dye,
 * item 13133155597): the intake advance's Monday automation moved him to
 * Profile Clean-Up **1.7 seconds** after the advancer flipped — the activity
 * log shows it — yet the group-filtered `items_page` reads this app polls
 * with kept RETURNING him for close to ten minutes. Monday's query index
 * lags its own activity log (§5.2's indexing gap, on the read side). The old
 * two-minute TTL ("four polls' worth") assumed the poll was the only lag, so
 * a really-advanced patient reappeared with a live Send button for the
 * several minutes between the lapse and the index catching up — and Masani
 * re-pressed Advance, exactly the 2026-09-03 shape this module exists to
 * close (the noop guard refused it; nothing was lost).
 *
 * The cost of the longer window is unchanged in kind, just longer: a send
 * that RESOLVED (which, through `executeWritesWithVerification`, means the
 * data verified and Monday accepted the advancer) but somehow did not land
 * stays hidden this long, and a patient a manager returns to the queue
 * inside the window stays hidden until it lapses.
 */
export const PENDING_ADVANCE_TTL_MS = 900_000;

/**
 * ⚠️⚠️ **THE CLAIMS ARE MODULE STATE, SHARED BY EVERY QUEUE AND SCREEN** —
 * since 2026-09-25. They were a `useRef(new Map())` inside each queue hook,
 * which had two silent holes, both found in Keith Dye's ten minutes:
 *   1. leaving the page THREW THE CLAIM AWAY — the ref died with the hook, so
 *      going back to the Care Coordinator dashboard forgot the advance ever
 *      happened;
 *   2. no other screen could consult it — the dashboard's columns went on
 *      showing the advanced patient however fresh its poll was.
 * The hooks keep their `pendingAdvanceRef` name (the coverage scan pins it);
 * the ref simply points HERE now. Expiry still prunes lazily in
 * `applyPendingAdvances`.
 *
 * ⚠️⚠️ **A CLAIM IS SCOPED TO THE QUEUE THE PATIENT LEFT** (2026-09-28). Keyed
 * by item id alone, the claim meant to take a patient OUT of one queue also
 * hid them from the NEXT one: Evaluate → Send Request, Benefits → Submit
 * Auth, Welcome Call → Final Confirm and Info Collection → Profile Clean-Up
 * all keep the SAME item id on the same board, so the patient vanished from
 * the queue they had just arrived in for the whole fifteen minutes — and a
 * rep who "fixes" a missing patient by clearing the advancer creates a
 * duplicate downstream item (§9). So every claim is stored under
 * `(scope, item id)`, where the scope names the population the patient left:
 * `groupScope(<Monday group>)` for the queues that are a group, and
 * `stageScope(...)` for Medical Evaluation, whose live sub-stages share one
 * group. A queue honours only its own scope; the Care Coordinator columns
 * honour a claim only while a card still reports the group it left
 * (`columnScopes`). Keys are private — go through `markPendingAdvance`,
 * `hasPendingAdvance` and `applyPendingAdvances`.
 */
export const sharedPendingAdvances = new Map<string, number>();

/** The scope of a queue that IS one Monday group, or several (Already In
 *  System reads two). Group ids are globally unique, so no board prefix. */
export function groupScope(groupId: string | readonly string[]): string {
  return `group:${typeof groupId === "string" ? groupId : groupId.join(",")}`;
}

/** The scope of a queue defined by a stage VALUE rather than a group —
 *  Medical Evaluation keeps Evaluate, Send Request, Confirm Receipt, Chase and
 *  Doctor Appointments in one live group, told apart by Sub-Stage. */
export function stageScope(board: string, stage: string): string {
  return `stage:${board}:${stage}`;
}

/** A character no scope or Monday item id contains. */
const SEP = "\u241f";
const claimKey = (scope: string, id: string): string => `${scope}${SEP}${id}`;
const claimId = (key: string): string => key.slice(key.indexOf(SEP) + 1);

/** Record that `id` just left the queue `scope` names. */
export function markPendingAdvance(
  pending: Map<string, number>,
  scope: string,
  id: string,
  now: number = Date.now(),
): void {
  pending.set(claimKey(scope, id), now);
}

/** Is there a live claim that `id` left `scope`? Expired claims answer no. */
export function hasPendingAdvance(
  pending: Map<string, number>,
  scope: string,
  id: string,
  now: number = Date.now(),
  ttlMs: number = PENDING_ADVANCE_TTL_MS,
): boolean {
  const at = pending.get(claimKey(scope, id));
  return at !== undefined && pendingAdvanceVerdict(at, now, ttlMs) === "hide";
}

/** Every item id with a live claim in any scope — for tests and debugging. */
export function pendingAdvanceIds(pending: Map<string, number>): string[] {
  return [...new Set([...pending.keys()].map(claimId))];
}

/**
 * Which claims a Care Coordinator column row answers to.
 *
 * A column shows several groups (Patient Intake = both form groups + Profile
 * Clean-Up), so a claim made in ONE of them must not hide a card that has
 * moved to ANOTHER of them — Info Collection → Clean-Up is a move within the
 * column, and the card has to move, not vanish. So:
 *   · the row reports a group IN the column → only a claim from that group;
 *   · the row reports a group OUTSIDE the column → Monday already moved it and
 *     the read returned it on a lagging index, so any claim from the column's
 *     groups applies;
 *   · the row reports no group → unknown, so any claim from the column's groups
 *     applies (the pre-2026-09-28 behaviour, never less hiding than that).
 */
export function columnScopes(groupId: string, columnGroups: readonly string[]): string[] {
  if (groupId && columnGroups.includes(groupId)) return [groupScope(groupId)];
  return columnGroups.map((g) => groupScope(g));
}

/** Test seam — module state must not leak between tests. */
export function resetPendingAdvances(): void {
  sharedPendingAdvances.clear();
}

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
 * Drop lapsed markers, then hide whoever is still marked IN THIS SCOPE.
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
 * `scope` is the queue's own scope (a string), or — for a screen that shows
 * several populations, like a Care Coordinator column — a function giving the
 * scopes each row answers to (`columnScopes`). Required, so a new caller has to
 * decide which queue it is rather than hiding everybody's claims.
 *
 * Mutates `pending` only to drop lapsed markers. A patient's absence from
 * `list` is deliberately NOT treated as evidence of anything (see above).
 */
export function applyPendingAdvances<T extends { id: string }>(
  list: T[],
  pending: Map<string, number>,
  scope: string | ((row: T) => string | readonly string[]),
  now: number = Date.now(),
  ttlMs: number = PENDING_ADVANCE_TTL_MS,
): T[] {
  if (pending.size === 0) return list;
  for (const [key, markedAt] of [...pending]) {
    if (pendingAdvanceVerdict(markedAt, now, ttlMs) === "expired") pending.delete(key);
  }
  if (pending.size === 0) return list;
  const scopesOf = typeof scope === "function" ? scope : () => scope;
  return list.filter((p) => {
    const s = scopesOf(p);
    const scopes = typeof s === "string" ? [s] : s;
    return !scopes.some((sc) => pending.has(claimKey(sc, p.id)));
  });
}
