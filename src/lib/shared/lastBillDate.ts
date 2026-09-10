/**
 * Same-or-Similar "Last Bill Date" — which of the TWO columns to believe.
 *
 * Both the Insurance board and the Welcome Call board carry **two** families of
 * per-product last-bill date columns, and they do not mean the same thing.
 * Reported by Brandon (2026-09-10) as "we have 2 diff columns for it
 * (date_mm59n1x1 and date_mm33jsyt) — noticing it the most with sensors".
 *
 *                        │ Insurance (18410601299) │ Welcome Call (18410804557)
 *  ──────────────────────┼─────────────────────────┼──────────────────────────
 *  LEGACY "Last Bill Date"                          (`COL.lastBillDate`)
 *    CGM / monitor       │ date_mm33h1qv           │ date_mm33vqa0
 *    Sensors             │ date_mm332rhq           │ date_mm33jsyt
 *    Insulin pump        │ date_mm33qnew           │ date_mm33kmz4
 *    Infusion sets       │ date_mm33gj86           │ date_mm33mw14
 *    Cartridges          │ date_mm33cd87           │ date_mm33rd8n
 *  NEW "<product> SoS Last Bill"                    (`COL.sosLastBill*`)
 *    CGM monitor         │ date_mm59tx2g           │ date_mm599gk8
 *    CGM sensors         │ date_mm59ejs2           │ date_mm59n1x1
 *    Insulin pump        │ date_mm59j483           │ date_mm593ghh
 *    Infusion sets       │ date_mm59bzfv           │ date_mm59jcf5
 *    Cartridges          │ date_mm598y8w           │ date_mm59mw5n
 *
 * ⚠️ **The hop is NOT the problem — all ten pairs copy correctly.** Board
 * automation 7918324247 (Insurance → Welcome Call, "when status changes,
 * create item in board") maps every one of these source→destination, plus the
 * Units and No-Billing-History siblings. Verified against the live workflow
 * definition 2026-09-10. Do not go looking for a broken mapping.
 *
 * **The divergence is created on the Insurance board, by the write rules**
 * (`samantha/mondayWrite.ts`), and it is deliberate on that side:
 *
 *  - The LEGACY column is written **only when SoS came back "Not Clear"** (or
 *    Auth = No Auth Needed), and is **actively CLEARED otherwise**. Its date
 *    PRESENCE encodes "Not Clear" downstream — `finalConfirm/mondayMapping`
 *    derives `sosMonitor`/`sosSensors`/… from exactly that, and the check
 *    pack's `authExpiryMoot` reads it. That contract is intact; leave it alone.
 *  - The NEW column is written for **every billed product**, Clear included —
 *    "the full record ... without disturbing the legacy lastBillDate contract".
 *
 * So for the common case — SoS came back Clear — the real last bill date lands
 * in the NEW column and the legacy one is blanked. Welcome Call read only the
 * legacy family, so the screen showed "—" and the next-order-date default had
 * nothing to compute from, while the true date sat one column over, unread.
 *
 * Measured on the live boards, 2026-09-10:
 *   Insurance, sensors — 46 items carry BOTH dates, **28 carry only the new
 *   one**, 5 only the legacy (records predating the new family).
 *   Welcome Call, new-only: **sensors 11**, insulin pump 1, infusion sets 1,
 *   cartridges 1, monitor 0 — which is why Brandon saw it "the most with
 *   sensors".
 *
 * ⚠️ This resolver is **additive and can only ever show MORE than before**: it
 * prefers the new column and falls back to the legacy one, so the 13 Welcome
 * Call records that carry only a legacy date (written before the new family
 * existed) keep rendering exactly as they did. When both are present they are
 * written from the same rep answer and agree — every "both present" pair in the
 * live sample is identical — so the preference only ever decides a tie.
 *
 * ⚠️ **Read-only surfaces only.** Do NOT wire this into a control that WRITES
 * a legacy column. Final Profile Confirmation's Last Bill Date fields are
 * editable and written back on send, so prefilling them from the new column
 * would flip that item's `sos*` derivation from "" to "Not Clear" for a product
 * that was Clear, and silence C18's auth-expiry warning through
 * `authExpiryMoot`. Welcome Call never writes these columns, which is what
 * makes the fix safe there.
 */

/** The last bill date to SHOW for one product: the SoS column, else the legacy one. */
export function resolveLastBill(sosLastBill: string, legacyLastBill: string): string {
  return (sosLastBill || "").trim() || (legacyLastBill || "").trim();
}

/**
 * Resolve a whole product line at once — pass `[sos, legacy]` pairs in the same
 * order the caller wants them back. Blank results are dropped, so the array can
 * be handed straight to `computeNextOrder` / `effectiveNextOrder`, which treat
 * an empty list as "no billing history".
 */
export function resolveLastBillDates(
  pairs: Array<{ sos: string; legacy: string }>,
): string[] {
  return pairs.map(({ sos, legacy }) => resolveLastBill(sos, legacy)).filter(Boolean);
}
