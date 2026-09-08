/**
 * Monitor Qty is BINARY on the board — always "0" or "1", never blank.
 *
 * ⚠️ THE WELCOME CALL BOARD'S ORDER-CREATION AUTOMATIONS COMPARE IT WITH
 * `is equal to`, SO A BLANK CELL MATCHES NOTHING. All four fire on Stage
 * Advancer `color_mm1ws96t` → "Completed" (Final Confirm's advancer) and then
 * branch on exact numeric equality into the New Order Board (18405457690):
 *
 *   7918341001  "pump only"          Pump Qty = 1
 *   7918341011  "monitor only"                          Monitor Qty = 1
 *   7918340959  "pump and monitor"   Pump Qty = 1  AND  Monitor Qty = 1
 *   7921725444  "monitor = 0"        Pump Qty = 1  AND  Monitor Qty = 0
 *
 * An empty cell is not 0 and not 1, so it silently falls out of every branch
 * that names the monitor. Nothing errors — the order is simply classified as
 * though the question had never been asked. A board scan on 2026-09-08 found
 * **379 of 449 items (84%) with Monitor Qty blank**, 118 of them carrying
 * Pump Qty 1: exactly the population the "monitor = 0" branch was built for
 * and the one it could never match.
 *
 * The blanks came from the app. Welcome Call SKIPPED the write when the field
 * was empty (`if (p.monitorQty !== "")`) while its own toggle rendered a blank
 * as "0 — No", so the screen said 0 and the board stayed empty; Final Confirm
 * went further and wrote a literal `""`, clearing the cell outright.
 *
 * Josh, 2026-09-08: *"we need to make this binary — if nothing in that area?
 * send 0 value. if 1 we send 1."*
 *
 * ⚠️ ANYTHING ABOVE ZERO IS "1", not just a literal 1. Final Confirm's control
 * is a free `type="number"` input, so a typed 2 is reachable — and 2 matches
 * none of the four equality gates either, reproducing the same silent
 * misclassification this module exists to end. `> 0` is also how the rest of
 * the app already reads this column (`shared/servingLines.ts` treats
 * `num(monitorQty) > 0` as "a monitor is being served"), so the two agree.
 *
 * ⚠️ AND ANYTHING UNREADABLE IS "0". Blank, whitespace, "NaN", "abc", a
 * negative — none of them is evidence that a monitor is going out, and 0 is
 * the answer that puts the item in a real branch. Guessing "1" would ship a
 * monitor nobody ordered; 0 at worst under-reports a value that was never
 * legible in the first place.
 */
export function coerceMonitorQty(raw: string | null | undefined): "0" | "1" {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? "1" : "0";
}
