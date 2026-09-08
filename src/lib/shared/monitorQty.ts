/**
 * Monitor Qty is BINARY on the board — always "0" or "1", never blank.
 *
 * ⚠️ THE WELCOME CALL BOARD'S ORDER-CREATION AUTOMATIONS CANNOT READ A BLANK.
 * All four fire on Stage Advancer `color_mm1ws96t` → "Completed" (Final
 * Confirm's advancer) and branch into the New Order Board (18405457690).
 * Read the WHOLE chain — two of them open with an `is empty` guard, which is
 * the part that makes this column's blank load-bearing today:
 *
 *   7918341001  "pump only"        LIVE      Monitor Qty IS EMPTY → Pump Qty = 1
 *   7918341011  "monitor only"     LIVE      Pump Qty IS EMPTY    → Monitor Qty = 1
 *   7918340959  "pump and monitor" LIVE      Pump Qty = 1         → Monitor Qty = 1
 *   7921725444  "monitor = 0"      INACTIVE  Pump Qty = 1         → Monitor Qty = 0
 *
 * ⚠️⚠️ **THIS MODULE AND 7918341001 CANNOT BOTH BE LIVE.** "pump only" is the
 * automation that serves a pump patient with no monitor, and it identifies them
 * by Monitor Qty being EMPTY — the exact state this module abolishes. Ship the
 * coercion while "pump only" is still enabled and a pump-only order stops being
 * created AT ALL: the guard fails, and 7921725444, the branch built to catch
 * those patients as `Monitor Qty = 0`, was still switched off when this landed
 * (2026-09-08). Nothing errors either way — the board just goes quiet.
 * **The cutover is one move: enable 7921725444 and retire 7918341001 as this
 * deploys.** That is a Monday-side change and Josh's to make (CLAUDE.md §10 —
 * live-board edits are an off-hours job).
 *
 * The everyday failure this fixes is the mirror image. A blank matches neither
 * `= 0` nor `= 1`, so every branch that names the monitor by VALUE skips it
 * silently: "pump and monitor" cannot see a real monitor sale whose cell was
 * never written, and "monitor = 0" can never fire at all. A board scan on
 * 2026-09-08 found **379 of 449 items (84%) blank**, 118 of them carrying
 * Pump Qty 1 — exactly the population 7921725444 was built for. Only 52 read
 * "1" and 18 read "0".
 *
 * ⚠️ Note the SYMMETRIC trap next door: "monitor only" opens with `Pump Qty is
 * empty`. Nothing here touches Pump Qty (`coercePumpQty` leaves a blank blank),
 * but making that column binary the same way would silence 7918341011 in
 * exactly this fashion. Read the chain before coercing either one.
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
