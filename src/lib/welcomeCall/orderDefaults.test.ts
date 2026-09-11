import { describe, it, expect } from "vitest";
import { shouldDefaultPumpQty, setTwoTransition, isSetChosen, shouldDefaultInfusionQty1 } from "./orderDefaults";
import { DEFAULT_INFUSION_QTY } from "./payerRules";

describe("shouldDefaultPumpQty", () => {
  it("defaults on a serving that sells a pump", () => {
    expect(shouldDefaultPumpQty("Insulin Pump", "")).toBe(true);
    expect(shouldDefaultPumpQty("Insulin Pump + CGM", "")).toBe(true);
  });

  /* ⚠️ THE $3,787 CASE (CLAUDE.md §5.22). `servingIncludesPump` is true for
     both of these — infusion sets ARE pump supplies — so defaulting on it would
     put Pump Qty 1 on the precise population that already owns a pump. */
  it("never defaults on a supplies-only serving", () => {
    expect(shouldDefaultPumpQty("Supplies", "")).toBe(false);
    expect(shouldDefaultPumpQty("Supplies + CGM", "")).toBe(false);
  });

  /* ⚠️ A blank Serving is trusted-as-served for ENABLING the control
     (`pumpQtyApplies`), because a column that failed to read must not disable a
     real sale. A DEFAULT is the opposite direction: absent data must not ship a
     device nobody chose. */
  it("never defaults on an unknown serving", () => {
    expect(shouldDefaultPumpQty("", "")).toBe(false);
    expect(shouldDefaultPumpQty("   ", "")).toBe(false);
  });

  it("never overwrites an answer the rep already gave", () => {
    expect(shouldDefaultPumpQty("Insulin Pump", "0")).toBe(false);
    expect(shouldDefaultPumpQty("Insulin Pump", "1")).toBe(false);
  });

  it("does not fire on CGM-only", () => {
    expect(shouldDefaultPumpQty("CGM", "")).toBe(false);
  });
});

describe("setTwoTransition", () => {
  it("clears both quantities when a second set arrives", () => {
    // Qty 1's default of 3 was the WHOLE order; leaving it silently proposes 6.
    expect(setTwoTransition(false, true)).toEqual({
      writes: { qtyInf1: "", qtyInf2: "" },
      clearSet2: false,
    });
  });

  it("restores Qty 1 and blanks Set 2 when the second set is removed", () => {
    const r = setTwoTransition(true, false);
    expect(r.writes.qtyInf1).toBe(String(DEFAULT_INFUSION_QTY));
    // ⚠️ The quantity AND the set — a quantity attached to no set is the §5.12
    // shape where a counter and its columns disagree, and Brandon's note is
    // explicit: "don't leave the old values on the board".
    expect(r.writes.qtyInf2).toBe("");
    expect(r.clearSet2).toBe(true);
  });

  it("does nothing when the answer has not changed", () => {
    expect(setTwoTransition(true, true)).toEqual({ writes: {}, clearSet2: false });
    expect(setTwoTransition(false, false)).toEqual({ writes: {}, clearSet2: false });
  });
});

describe("isSetChosen", () => {
  it("treats blank and Not Serving as no set", () => {
    expect(isSetChosen("")).toBe(false);
    expect(isSetChosen("   ")).toBe(false);
    // "Not Serving" is the empty state, not a product — both slots must be able
    // to hold it without counting as a split.
    expect(isSetChosen("Not Serving")).toBe(false);
  });

  it("treats a real set as chosen", () => {
    expect(isSetChosen('AutoSoft XC 6 mm 23"')).toBe(true);
  });
});

describe("shouldDefaultInfusionQty1", () => {
  const args = (over: Partial<Parameters<typeof shouldDefaultInfusionQty1>[0]> = {}) => ({
    showPump: true,
    qtyInf1: "",
    infusionSet2: "",
    ...over,
  });

  it("fills a blank quantity while the pump section applies", () => {
    expect(shouldDefaultInfusionQty1(args())).toBe(true);
  });

  it("leaves a quantity the rep already set", () => {
    expect(shouldDefaultInfusionQty1(args({ qtyInf1: "2" }))).toBe(false);
    expect(shouldDefaultInfusionQty1(args({ qtyInf1: "0" }))).toBe(false);
  });

  it("never stamps an infusion quantity on a CGM-only patient", () => {
    expect(shouldDefaultInfusionQty1(args({ showPump: false }))).toBe(false);
  });

  /* ⚠️ The carve-out that matters. `setTwoTransition` deliberately clears BOTH
     quantities when a second set arrives, because Qty 1's default WAS the whole
     order — re-filling it here would undo that within a render and silently
     propose 3 + 3 = six boxes. */
  it("stands down while a second set is chosen", () => {
    expect(shouldDefaultInfusionQty1(args({ infusionSet2: 'TruSteel 6 mm 23"' }))).toBe(false);
  });

  it('treats "Not Serving" as no second set', () => {
    expect(shouldDefaultInfusionQty1(args({ infusionSet2: "Not Serving" }))).toBe(true);
  });
});
