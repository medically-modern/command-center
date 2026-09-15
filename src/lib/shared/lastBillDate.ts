/**
 * Same-or-Similar "Last Bill Date" — ONE column family, since 2026-09-15.
 *
 * Until that day the Insurance board and the Welcome Call board each carried
 * TWO per-product last-bill families, and they did not mean the same thing:
 *
 *   - the LEGACY "<product> Last Bill Date" columns (`date_mm33…`) were written
 *     by Benefits ONLY when Same-or-Similar came back "Not Clear" (or Auth = No
 *     Auth Needed) and actively CLEARED otherwise — their date-PRESENCE was a
 *     Not-Clear flag, not a billing record;
 *   - the "<product> SoS Last Bill" columns (`date_mm59…`) were written for
 *     EVERY billed product, Clear included — the actual record.
 *
 *                        │ Insurance (18410601299) │ Welcome Call (18410804557)
 *  ──────────────────────┼─────────────────────────┼──────────────────────────
 *  RETIRED legacy "Last Bill Date"
 *    CGM / monitor       │ date_mm33h1qv           │ date_mm33vqa0
 *    Sensors             │ date_mm332rhq           │ date_mm33jsyt
 *    Insulin pump        │ date_mm33qnew           │ date_mm33kmz4
 *    Infusion sets       │ date_mm33gj86           │ date_mm33mw14
 *    Cartridges          │ date_mm33cd87           │ date_mm33rd8n
 *  "<product> SoS Last Bill" — the one family the app reads and writes
 *    CGM monitor         │ date_mm59tx2g           │ date_mm599gk8
 *    CGM sensors         │ date_mm59ejs2           │ date_mm59n1x1
 *    Insulin pump        │ date_mm59j483           │ date_mm593ghh
 *    Infusion sets       │ date_mm59bzfv           │ date_mm59jcf5
 *    Cartridges          │ date_mm598y8w           │ date_mm59mw5n
 *
 * Welcome Call read only the legacy family, so a Clear product showed "—" while
 * the true date sat one column over (Brandon, 2026-09-10 — CLAUDE.md §5.32).
 * The first fix resolved the pair here, SoS first with legacy as a fallback.
 * Josh, 2026-09-15: "make it obsolete so the new column does everything the
 * old one was doing so we can get rid of it — it causes confusion." The audit
 * that day, run against every row of both boards, found the legacy column had
 * exactly two live consumers and neither needed it:
 *
 *   1. `finalConfirm/checkPack.authExpiryMoot` — Medicaid + a non-blank last
 *      bill silences C18's auth-expiry row. Pointed at the SoS family, ZERO
 *      patients change verdict: of 324 Medicaid × Auth-Valid × has-end-date
 *      product-rows on Welcome Call, not one carried a date in EITHER column
 *      (Medicaid supplies auto-clear and never get an SoS entry) — so the
 *      silence has never fired, and the swap is a no-op today and more
 *      correct in principle ("have we billed this" is what the SoS family is).
 *   2. Final Confirm's five editable Last Bill boxes — they wrote the legacy
 *      column, which the resolver here then displayed OVER, so a rep's
 *      correction was invisible. The only four both-set-and-differ rows on
 *      either board were exactly that (all Welcome Call sensors, all
 *      Completed, none on Insurance — written on Welcome Call after the hop).
 *      The boxes now read and write the SoS column.
 *
 * The derived `sosMonitor`/`sosSensors`/… = "Not Clear" quintet — the thing
 * the presence flag existed to feed — was declared, mapped and read by NOTHING.
 * A first delta measured against it counted 179 verdict changes; measured
 * against what is actually read, the number is zero. Find the consumer first.
 *
 * So: every legacy value was copied into its SoS twin (35 items, then verified
 * legacy-only = 0 on both boards for all five products — the insulin-pump
 * legacy column held zero rows anywhere), every reader and writer moved to the
 * SoS family, and the ten legacy ids left the code. ⚠️ Do not bring them back
 * as a fallback: "13 rows only have legacy" was true on 9/10 and false since
 * the backfill. On the boards they are to be retitled "(retired)" and hidden,
 * never deleted — the notes-column precedent (§10). Hop automation 7918324247
 * still copies them legacy→legacy, harmlessly, until its rows are cleared in
 * Monday's UI.
 *
 * What remains here is the one display helper.
 */

/**
 * `2024-01-01` → `01/01/2024`, for display only.
 *
 * Josh, 2026-09-14: *"'last bill 2024-01-01' should be in normal format we use
 * (MM/DD/YYYY)"*.
 *
 * ⚠️ **String surgery, never `new Date(...)`.** Monday's date columns are
 * timezone-naive ET and the browser (and the CI container) are not, so parsing
 * one into a Date and formatting it back renders the day BEFORE for anyone west
 * of ET — CLAUDE.md §9's standing trap, and a wrong date here reads as
 * authoritative rather than as a bug. `authChips.shortDate` exists for the same
 * reason; this is its zero-padded four-digit sibling, which is the form the
 * rest of the app shows a rep.
 *
 * Anything that is not a leading `YYYY-MM-DD` comes back "" — the caller
 * decides what an absent date looks like.
 */
export function formatLastBill(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((ymd ?? "").trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}
