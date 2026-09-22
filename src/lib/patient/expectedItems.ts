/**
 * "Expected items" — what the next order is expected to carry, read off the
 * patient's Subscription profile (§5.46d).
 *
 * Brandon's handoff, on the Orders tab's Upcoming order strip: *"Expected
 * items (sets, cartridges, sensors with quantities from the profile)"*. His
 * `upcomingOrder` builds it from four lines — infusion set 1, infusion set 2,
 * cartridges, sensors — and that is what this reproduces.
 *
 * ⚠️ **It is NOT `lib/orders/skuJoin.orderLines`, and reusing that would be
 * wrong twice over.** That one reads the NEW ORDER BOARD's own columns, which
 * this board does not have, and it answers a different question: what a PLACED
 * order carries. This answers what the profile says we are set up to ship, on
 * an order that does not exist yet — so a named product whose quantity nobody
 * has filled in is still an expected item, where on a placed order it is not a
 * line at all.
 *
 * ⚠️ **The quantities are mostly absent and that shaped the rule.** Measured
 * over 60 live Subscription rows on 2026-09-22: of the 22 serving a CGM,
 * **18 carry a blank CGM Qty** — 82%. Brandon's `${qty||'—'} × ${product}`
 * would therefore print *"— × Dexcom G7 sensors"* on four patients in five,
 * which reads as a data problem a rep cannot fix, on a board where the orders
 * go out regardless. A blank quantity renders the PRODUCT ALONE instead: the
 * fact we hold is what ships, and showing nothing is not showing a wrong
 * number (§5.31f · §5.31g — missing and empty are different facts).
 *
 * ⚠️ **A quantity of exactly 0 IS a statement, and drops the line.** Inf. Qty
 * 2 reads `"0"` on essentially every live row (paired with a blank or "Not
 * Serving" second set), so a zero here means "none of this ship", not "nobody
 * has said". Blank and 0 must not be collapsed in either direction.
 */

/** The Subscription board. Every other board has no expected-items columns. */
const SUBSCRIPTION_BOARD_ID = 18407459988;

/**
 * Column ids on that board.
 *
 * ⚠️ Three of these (`sensorsType`, `infusionSet1`, `infQty1`) are ALSO named
 * by `stageDetail`'s SUBSCRIPTION map, so they already ride the dossier read.
 * They are declared here anyway and `dossierCols` de-duplicates: keying this
 * module on what another map happens to fetch is a coupling that fails
 * silently — trim that section and every line here goes blank with nothing
 * erroring (§5.11's trap).
 */
export const EXPECTED_COL = {
  sensorsType: "color_mkxmdscr",
  cgmQty: "numeric_mm3sr332",
  infusionSet1: "color_mkxm50f9",
  infQty1: "numeric_mkw839ks",
  infusionSet2: "color_mkxmx5wk",
  infQty2: "numeric_mkwac234",
  cartridgeQty: "numeric_mm3sfe56",
} as const;

const COLS = Object.values(EXPECTED_COL);

/** The ids to fetch for a board — empty for everything but Subscription. */
export function expectedItemsColumns(boardId: number): string[] {
  return boardId === SUBSCRIPTION_BOARD_ID ? [...COLS] : [];
}

/**
 * A product label that names something we ship.
 *
 * ⚠️ **"Not Serving" is the common value, not an edge case** — 37 of the 60
 * rows measured read it on Sensors Type alone. Without this filter the strip
 * would list "Not Serving" as an item on most patients.
 */
function served(label: string): string {
  const l = (label ?? "").trim();
  return l && l.toLowerCase() !== "not serving" ? l : "";
}

/** `""` → null (nobody said); a number → that number, 0 and negatives included. */
function qty(raw: string): number | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** `3 × Dexcom G7 sensors` · `Dexcom G7 sensors` when the quantity is blank. */
function line(product: string, n: number | null, suffix = ""): string {
  const name = suffix ? `${product} ${suffix}` : product;
  return n === null ? name : `${n} × ${name}`;
}

/**
 * The expected lines, in Brandon's order: infusion sets, cartridges, sensors.
 *
 * Returns `[]` for a board with no such columns and for a profile that names
 * nothing — the caller renders the slot's own "—" rather than a fake line.
 */
export function expectedItems(
  boardId: number,
  cols: Record<string, string> | undefined,
): string[] {
  if (boardId !== SUBSCRIPTION_BOARD_ID) return [];
  const col = (id: string) => (cols?.[id] ?? "").trim();

  const out: string[] = [];
  const push = (product: string, raw: string, suffix = "") => {
    if (!product) return;
    const n = qty(raw);
    if (n !== null && n <= 0) return; // a stated zero: none of this ships
    out.push(line(product, n, suffix));
  };

  push(served(col(EXPECTED_COL.infusionSet1)), col(EXPECTED_COL.infQty1));
  push(served(col(EXPECTED_COL.infusionSet2)), col(EXPECTED_COL.infQty2));

  /* ⚠️ Cartridges have NO product column on this board — Supplies Type is the
     PUMP (t:slim · Mobi · iLet), which the profile card already names. So the
     line is the bare word Brandon writes, and a quantity with nothing to count
     is not a line. */
  const cartridges = qty(col(EXPECTED_COL.cartridgeQty));
  if (cartridges !== null && cartridges > 0) out.push(`${cartridges} × cartridges`);

  push(served(col(EXPECTED_COL.sensorsType)), col(EXPECTED_COL.cgmQty), "sensors");

  return out;
}
