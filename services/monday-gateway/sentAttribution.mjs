/**
 * sentAttribution.mjs — which employee sent an outbound text.
 *
 * Extracted from `/messaging/conversation` (messaging.mjs) so the Communications
 * inbox (commsInbox.mjs) can answer the same question the same way. Two readers
 * with two copies of this rule would, sooner or later, disagree about who sent a
 * message — and the inbox uses the answer to decide whether a text may SUGGEST
 * "Texted" (COMMS_INBOX_PLAN.md §4.4), so a drifted copy would light up a
 * suggestion off a robot's reorder link. One rule, two callers.
 *
 * Pure: no `pg`, no network. `sent_messages` rows go in, a sender comes out.
 */

/** A send logged without RingCentral's id (the SMS-500 quirk, CLAUDE.md §5.5, or
 *  a row from before ids were captured) still resolves to the nearest message to
 *  the same number inside this window. */
export const LOOSE_MATCH_MS = 120_000;

/**
 * Index `sent_messages` rows for lookup.
 *
 * @param {Array<{rc_message_id?: string|null, sender_email: string, sent_at: string|Date}>} rows
 *   ⚠️ In `sent_at` order — the loose match takes the FIRST row inside the
 *   window, exactly as the conversation route always has.
 */
export function senderIndex(rows) {
  const byId = new Map();
  const loose = [];
  for (const r of rows ?? []) {
    if (!r) continue;
    if (r.rc_message_id) byId.set(String(r.rc_message_id), r.sender_email);
    else loose.push(r);
  }
  return { byId, loose };
}

/**
 * Who sent this outbound message, or "" when nobody in the Command Center did.
 *
 * "" is a real answer and the common one: the Day-20 reorder text, the intake
 * drop-off nudges and anything typed into the RingCentral desktop app all leave
 * the same line with no `sent_messages` row.
 *
 * @param {{id: string|number, at: number|string|Date}} message
 */
export function senderFor(message, index) {
  if (!message || !index) return "";
  const exact = index.byId.get(String(message.id));
  if (exact) return exact;
  const t = new Date(message.at).getTime();
  if (!Number.isFinite(t)) return "";
  const near = index.loose.find((r) => Math.abs(new Date(r.sent_at).getTime() - t) < LOOSE_MATCH_MS);
  return near ? near.sender_email : "";
}

/**
 * The conversation route's shape: stamp `sentBy` onto every outbound message in
 * place. Kept byte-for-byte equivalent to the loop it replaced.
 */
export function attributeSenders(messages, rows) {
  const index = senderIndex(rows);
  for (const m of messages ?? []) {
    if (m.direction !== "Outbound") continue;
    const who = senderFor({ id: m.id, at: m.time }, index);
    if (who) m.sentBy = who;
  }
  return messages;
}
