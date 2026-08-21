/**
 * Serving ↔ order-line coherence — the one rule Welcome Call and Final Profile
 * Confirmation both read.
 *
 * Two incidents, one shape: the Serving label and the per-product columns are
 * allowed to disagree, and whichever one a downstream writer happens to key off
 * decides what the patient actually receives.
 *
 *  - **Bradan French, 2026-08-03.** Serving was `Supplies + CGM` — the patient
 *    already owns a pump, we ship him supplies. The Welcome Call save wrote
 *    **Pump Qty = 1** anyway, Final Confirm passed, and the next day Cardinal
 *    order 1119501795 shipped a t:slim at $3,787.83. Nothing flagged it: the
 *    only rule that looked at this (`C14_PUMP_QTY_ON_CGM`) fired on
 *    `serving === "CGM"` **exactly**, so the two `Supplies …` labels — the ones
 *    that mean "patient already has the pump" — were the precise blind spot.
 *    ⚠️ And `servingIncludesPump()` is true for anything containing
 *    **"supplies"**, so the Pump & Infusion section renders (correctly — infusion
 *    sets ARE pump supplies) with a live Pump Qty control on it. Selling a pump
 *    and shipping supplies for a pump the patient owns are different questions;
 *    `servingSellsPumpDevice` is the second one and must not be conflated with
 *    `servingIncludesPump`.
 *
 *  - **Leann Austin, 2026-08-10.** Serving said `Insulin Pump` (no CGM) while
 *    CGM Type was `Dexcom G7` and Subscription Type was `Sensors & Supplies` —
 *    she is on a sensors subscription. `resolveNextOrderWrite` keys off Serving
 *    alone, read "CGM not served", and **wrote blank** to Sensors Next Order
 *    Date. It carried to the Subscription board empty and her sensor order was
 *    missed. A board scan on 2026-08-21 found 28 patients on a Sensors
 *    subscription with a blank Sensors Next Order Date.
 *
 * So a line is "served" here on the UNION of the evidence, not on Serving
 * alone: Serving is one vote, and the product type, the Subscription Type and
 * the quantity each get a vote too. That is deliberately wider than what the
 * write paths use — the point is to notice when they disagree, which is exactly
 * what neither stage could see.
 *
 * Pure + unit-tested (`servingLines.test.ts`). No fetches, no writes.
 */

export type OrderLine = "insulinPump" | "sensors" | "supplies";

/** The label every product status column uses for "we are not selling this". */
const NOT_SERVING = "Not Serving";

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A product status column that names a real product (not blank, not Not Serving). */
function selling(label: string): boolean {
  const s = (label ?? "").trim();
  return s !== "" && s.toLowerCase() !== NOT_SERVING.toLowerCase();
}

/* ─── Pump DEVICE vs pump SUPPLIES ─── */

/**
 * True when Serving puts an actual insulin pump DEVICE on the order.
 *
 * The five Serving labels are `Insulin Pump · Supplies Only · CGM ·
 * Insulin Pump + CGM · Supplies + CGM`, so this is the two that name a pump.
 * ⚠️ NOT the same question as `servingIncludesPump()` (welcomeCall/workflow.ts),
 * which also returns true for `Supplies …` because infusion sets and cartridges
 * are pump supplies. Reading that one to gate Pump Qty is the Bradan French bug.
 */
export function servingSellsPumpDevice(serving: string): boolean {
  return /pump/i.test(serving ?? "");
}

/**
 * Whether the Pump Qty control applies at all.
 *
 * ⚠️ A BLANK serving is permissive, matching `needsPriorPumpDate` and
 * `needsMonitorPurchaseDate` (§5.14): a column that failed to read must never
 * silently disable a control the rep needs, or a real pump sale becomes
 * un-enterable with nothing on screen saying why.
 */
export function pumpQtyApplies(serving: string): boolean {
  return (serving ?? "").trim() === "" || servingSellsPumpDevice(serving);
}

/**
 * What Pump Qty should actually be written as, given Serving.
 *
 * The UI gate is the affordance; this is the guarantee. A value already on the
 * board (or set before Serving was corrected) still reaches the send otherwise —
 * which is how Bradan French's `1` survived a Welcome Call save AND a Final
 * Confirm send. Serving is trusted only when KNOWN, the same contract
 * `finalConfirm/mondayWrite` already uses for the next-order-date clears.
 */
export function coercePumpQty(pumpQty: string, serving: string): string {
  if (pumpQtyApplies(serving)) return pumpQty;
  return num(pumpQty) > 0 ? "0" : pumpQty;
}

/* ─── Which lines is this profile actually serving? ─── */

export interface ServingLineInput {
  serving: string;
  subscriptionType: string;
  cgmType: string;
  infusionSet1: string;
  infusionSet2: string;
  pumpQty: string;
  monitorQty: string;
  qtyInf1: string;
  qtyInf2: string;
}

export interface ServedLinesOptions {
  /**
   * Drop Subscription Type from the evidence. Set on a SPLIT profile, where the
   * off-side half legitimately keeps a Subscription Type covering products this
   * half no longer serves — counting it would fire on every split order.
   */
  ignoreSubscriptionType?: boolean;
}

/**
 * Which of the three Next Order Date lines this profile is serving, on the
 * union of every signal available. Any ONE of them is enough — the whole point
 * is to catch the case where they disagree.
 */
export function servedOrderLines(
  p: ServingLineInput,
  opts: ServedLinesOptions = {},
): Record<OrderLine, boolean> {
  const sub = opts.ignoreSubscriptionType ? "" : (p.subscriptionType ?? "");

  return {
    // The pump DEVICE line is quantity-only on purpose. Serving `Supplies …`
    // means the patient already owns the pump, so a pump reorder date is
    // meaningless there — only an actual unit being sold needs one.
    insulinPump: num(p.pumpQty) > 0,

    sensors:
      /cgm/i.test(p.serving ?? "") ||
      selling(p.cgmType) ||
      /sensor/i.test(sub) ||
      num(p.monitorQty) > 0,

    supplies:
      /pump|supplies/i.test(p.serving ?? "") ||
      selling(p.infusionSet1) ||
      selling(p.infusionSet2) ||
      /suppl/i.test(sub) ||
      num(p.qtyInf1) > 0 ||
      num(p.qtyInf2) > 0,
  };
}

/* ─── The two things that go wrong ─── */

export const ORDER_LINE_LABEL: Record<OrderLine, string> = {
  insulinPump: "IP Next Order Date",
  sensors: "Sensors Next Order Date",
  supplies: "Supplies Next Order Date",
};

export interface NextOrderDates {
  insulinPump: string;
  sensors: string;
  supplies: string;
}

/**
 * Lines this profile is serving whose Next Order Date is blank — i.e. a product
 * that will reach the Subscription board with nothing scheduling its reorder.
 */
export function missingNextOrderDates(
  p: ServingLineInput,
  dates: NextOrderDates,
  opts: ServedLinesOptions = {},
): OrderLine[] {
  const served = servedOrderLines(p, opts);
  return (Object.keys(served) as OrderLine[]).filter(
    (line) => served[line] && (dates[line] ?? "").trim() === "",
  );
}

export interface ServingContradiction {
  /** Product family Serving leaves out. */
  family: "CGM" | "pump supplies";
  /** The columns that say we ARE serving it, for the finding's detail line. */
  evidence: string[];
}

/**
 * Product families the profile is serving that its Serving label EXCLUDES.
 *
 * Deliberately one-directional. The opposite case — Serving includes a family
 * whose product column is blank or Not Serving — is already C14
 * (`C14_CGM_TYPE_MISSING` / `C14_CGM_NOT_SERVING` and the pump pair). This is
 * the half nothing looked at, and it is the half that silently REMOVES a
 * product: every downstream writer keyed on Serving (next order dates, the
 * Welcome Call section gates) treats the family as not served.
 */
export function servingContradictions(p: ServingLineInput): ServingContradiction[] {
  const out: ServingContradiction[] = [];
  const serving = p.serving ?? "";
  if (!serving.trim()) return out; // no positive evidence with Serving unknown

  if (!/cgm/i.test(serving)) {
    const evidence: string[] = [];
    if (selling(p.cgmType)) evidence.push(`CGM Type is ${p.cgmType}`);
    if (/sensor/i.test(p.subscriptionType ?? ""))
      evidence.push(`Subscription Type is ${p.subscriptionType}`);
    if (num(p.monitorQty) > 0) evidence.push(`Monitor Qty is ${p.monitorQty}`);
    if (evidence.length) out.push({ family: "CGM", evidence });
  }

  if (!/pump|supplies/i.test(serving)) {
    const evidence: string[] = [];
    if (selling(p.infusionSet1)) evidence.push(`Infusion Set 1 is ${p.infusionSet1}`);
    if (selling(p.infusionSet2)) evidence.push(`Infusion Set 2 is ${p.infusionSet2}`);
    if (/suppl/i.test(p.subscriptionType ?? ""))
      evidence.push(`Subscription Type is ${p.subscriptionType}`);
    if (evidence.length) out.push({ family: "pump supplies", evidence });
  }

  return out;
}
