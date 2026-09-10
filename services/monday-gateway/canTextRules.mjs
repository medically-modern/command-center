/**
 * canTextRules.mjs — deciding "can this number receive texts?" from the texts
 * we have already exchanged with it.
 *
 * The pure half of the Can Text backfill (CLAUDE.md §5.31d). Split out for the
 * same reason `callRules`, `smsArchiveRules`, `callHistoryQuery` and
 * `patientDirectoryRules` are: the judgement is worth testing without a
 * database or a Monday token behind it.
 *
 * ── WHY THE ARCHIVE IS THE SOURCE ──
 * Brandon's handoff asks for the backfill to come from "a carrier line-type
 * lookup + RingCentral history (any inbound text from the number = Yes), not by
 * hand and not by DOB". The history half is free, is ours, and is already in
 * Postgres — `sms_archive` (§5.27), which on 2026-09-10 held 5,972 messages
 * back to 2026-08-01. It is also the STRONGER of the two signals: a carrier
 * says what kind of line a number is, while our own archive says whether a text
 * to that number actually worked.
 *
 * ⚠️⚠️ **THIS RULE ONLY EVER ANSWERS "yes" OR "unknown". It never answers "no".**
 * That is not timidity, it is the risk asymmetry stated in §5.31d:
 *   - A missing Yes costs a rep one question on a call they were making anyway.
 *   - A wrong No routes that patient's reorders to a call queue instead of the
 *     Day-20 text, silently, for as long as nobody notices.
 * And the evidence for "no" is genuinely weak here. A failed outbound text
 * looks the same whether the number is a landline, a disconnected mobile, a
 * typo, or a carrier having a bad afternoon — §5.5 records that
 * `SMS-CAR-104`/`-199` ("carrier never reported") ride on messages that were
 * fine. Deciding a patient cannot be texted on that is exactly the fabricated
 * negative `networkAnswer` (§5.20) and the blank secondary (§5.31c) each exist
 * to prevent.
 *
 * A real **line-type lookup** is what could answer "no", and nobody has bought
 * one. Until then the No side stays a rep's answer, asked on the call by the
 * send gate.
 */

/** Direction values the archive stores, as RingCentral spells them. */
const INBOUND = "Inbound";

/**
 * Outbound statuses that prove the text ARRIVED somewhere that accepts texts.
 *
 * ⚠️ `Queued` and `Sent` are deliberately absent. §5.5: an accepted text is not
 * a delivered text — RingCentral flips a doomed message to `SendingFailed`
 * seconds later, so treating "we sent it" as proof would mark landlines Yes,
 * which is the one direction of error this rule is built to avoid. Only
 * `Delivered` is a delivery.
 */
const DELIVERED = new Set(["delivered"]);

/**
 * The verdict for ONE number, from its archived messages.
 *
 * @param {Array<{direction?: string, message_status?: string|null}>} messages
 * @returns {"yes" | ""}  "" means unknown — leave the column blank.
 */
export function canTextFromMessages(messages) {
  for (const m of messages ?? []) {
    if (!m) continue;
    const dir = String(m.direction ?? "");
    /* An INBOUND text is the strongest evidence there is: the number sent us
     * one, so it is a texting line and somebody is reading it. This is the
     * handoff's own rule, verbatim. */
    if (dir === INBOUND) return "yes";
    /* An outbound one only counts once RingCentral says it actually landed. */
    if (DELIVERED.has(String(m.message_status ?? "").toLowerCase())) return "yes";
  }
  return "";
}

/**
 * Should this board row be touched at all?
 *
 * ⚠️ Blank-only, by design. A Can Text already on the board was answered by a
 * rep ON THE PHONE with the patient, which beats anything inferable from a
 * message log — and re-deriving it would let a stale archive overwrite a fresh
 * human answer. The same fill-when-blank contract `deriveMonitorPurchaseDate`
 * and `shouldDefaultPumpQty` carry.
 */
export function needsCanTextBackfill(row) {
  return !!(row?.phone ?? "").trim() && !String(row?.canText ?? "").trim();
}

/**
 * Roll a scan into the shape the summary prints.
 *
 * Kept pure so a DRY RUN and a real run report identically — a dry run whose
 * numbers are computed somewhere else is a dry run that proves nothing.
 */
export function summarise(decisions) {
  const out = { scanned: 0, eligible: 0, yes: 0, unknown: 0 };
  for (const d of decisions ?? []) {
    out.scanned += 1;
    if (!d.eligible) continue;
    out.eligible += 1;
    if (d.verdict === "yes") out.yes += 1;
    else out.unknown += 1;
  }
  return out;
}
