import { describe, it, expect } from "vitest";
import {
  compatibleSetOptions,
  setsInvalidatedByPump,
  infusionQtyPlan,
  NOT_SERVING,
  type SetOption,
  withCurrentSelection,
} from "./infusionSelection";
import { DEFAULT_INFUSION_QTY } from "./payerRules";

/** The live Infusion Set 1 vocabulary (color_mm1x9paw), read 2026-09-09. */
const BOARD: SetOption[] = [
  'AutoSoft XC 6 mm 23"', 'AutoSoft XC 6 mm 32"', 'AutoSoft XC 6 mm 43"',
  'AutoSoft XC 9 mm 23"', 'AutoSoft XC 9 mm 43"', 'AutoSoft XC 6 mm 5"',
  'AutoSoft 30 13 mm 23"', 'AutoSoft 30 13 mm 43"',
  'AutoSoft 90 6 mm 23"', 'AutoSoft 90 6 mm 43"', 'AutoSoft 90 9 mm 23"', 'AutoSoft 90 9 mm 43"',
  'TruSteel 6 mm 23"', 'TruSteel 6 mm 32"', 'TruSteel 8 mm 23"', 'TruSteel 8 mm 32"',
  'VariSoft 13 mm 23"', 'VariSoft 13 mm 32"', 'VariSoft 17 mm 23"',
  'Contact 6 mm 23"', 'Inset 6 mm 23"',
  'Mio Advance Clear 9 mm 23"', 'QuickSet 18"', 'Luer 6 mm 32"',
  NOT_SERVING,
].map((label, index) => ({ index, label }));

const labels = (o: SetOption[]) => o.map((x) => x.label);

describe("options are filtered by pump compatibility", () => {
  it("drops Luer from a t:lock pump — it physically cannot attach", () => {
    expect(labels(compatibleSetOptions("t:slim", BOARD))).not.toContain('Luer 6 mm 32"');
    expect(labels(compatibleSetOptions("Mobi", BOARD))).not.toContain('Luer 6 mm 32"');
  });

  it('keeps 5" tubing for Mobi and drops it everywhere else', () => {
    expect(labels(compatibleSetOptions("Mobi", BOARD))).toContain('AutoSoft XC 6 mm 5"');
    expect(labels(compatibleSetOptions("t:slim", BOARD))).not.toContain('AutoSoft XC 6 mm 5"');
  });

  it("drops another family's sets", () => {
    // Contact/Inset are iLet; Mio/QuickSet are Medtronic.
    const tslim = labels(compatibleSetOptions("t:slim", BOARD));
    expect(tslim).not.toContain('Contact 6 mm 23"');
    expect(tslim).not.toContain('QuickSet 18"');
    expect(tslim).toContain('TruSteel 6 mm 23"');
  });

  it("⚠️ KEEPS an unverified pairing rather than hiding it", () => {
    // infusionCompat deliberately reports unknown sets as amber rather than
    // silent. Filtering them out here would remove a real, orderable set from
    // the rep's list with no explanation — re-introducing the silence that
    // module was rewritten to end.
    const ilet = labels(compatibleSetOptions("iLet", BOARD));
    expect(ilet).toContain('Luer 6 mm 32"');
  });

  it("leaves the list alone when no pump is set", () => {
    expect(labels(compatibleSetOptions("", BOARD))).toHaveLength(BOARD.length);
  });
});

describe("ordering", () => {
  const tslim = labels(compatibleSetOptions("t:slim", BOARD));

  it("is alphabetical", () => {
    const products = tslim.filter((l) => l !== NOT_SERVING);
    const sorted = [...products].sort((a, b) =>
      a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }),
    );
    expect(products).toEqual(sorted);
  });

  it("⚠️ sorts sizes numerically, so 6 mm comes before 9 mm and 13 mm", () => {
    // A plain string sort puts "13" before "6", which is not how anyone hunts
    // for a size.
    const xc = tslim.filter((l) => l.startsWith("AutoSoft XC"));
    expect(xc.indexOf('AutoSoft XC 6 mm 23"')).toBeLessThan(xc.indexOf('AutoSoft XC 9 mm 23"'));
  });

  it("⚠️ pins Not Serving LAST rather than sorting it into the N's", () => {
    expect(tslim[tslim.length - 1]).toBe(NOT_SERVING);
  });
});

describe("Set 2 cannot repeat Set 1", () => {
  it("excludes the chosen set from the other slot", () => {
    const opts = labels(compatibleSetOptions("t:slim", BOARD, { exclude: 'TruSteel 6 mm 23"' }));
    expect(opts).not.toContain('TruSteel 6 mm 23"');
    expect(opts).toContain('TruSteel 6 mm 32"');
  });

  it("⚠️ never excludes Not Serving — both slots must be able to hold it", () => {
    const opts = labels(compatibleSetOptions("t:slim", BOARD, { exclude: NOT_SERVING }));
    expect(opts).toContain(NOT_SERVING);
  });
});

describe("a pump change invalidates sets that no longer fit", () => {
  it("names both slots when both became incompatible", () => {
    // Two Medtronic sets, then the rep corrects the pump to t:slim.
    expect(setsInvalidatedByPump("t:slim", 'QuickSet 18"', 'Mio Advance Clear 9 mm 23"'))
      .toEqual({ clearSet1: true, clearSet2: true });
  });

  it("leaves compatible sets alone", () => {
    expect(setsInvalidatedByPump("t:slim", 'TruSteel 6 mm 23"', NOT_SERVING))
      .toEqual({ clearSet1: false, clearSet2: false });
  });

  it("never flags a blank or Not Serving slot", () => {
    expect(setsInvalidatedByPump("t:slim", "", NOT_SERVING))
      .toEqual({ clearSet1: false, clearSet2: false });
  });
});

describe("quantities across the two slots", () => {
  const plan = (o: Partial<Parameters<typeof infusionQtyPlan>[0]>) =>
    infusionQtyPlan({
      set1: 'TruSteel 6 mm 23"', set2: NOT_SERVING, qty1: "3", qty2: "",
      orderTotal: DEFAULT_INFUSION_QTY, ...o,
    });

  it("is happy with one set at the full order", () => {
    const r = plan({});
    expect(r.split).toBe(false);
    expect(r.error).toBeNull();
  });

  it("asks for a quantity once a set is picked", () => {
    expect(plan({ qty1: "0" }).error).toMatch(/choose a quantity/i);
  });

  it("requires BOTH quantities once a second set is added", () => {
    const r = plan({ set2: 'TruSteel 6 mm 32"', qty1: "3", qty2: "" });
    expect(r.split).toBe(true);
    expect(r.error).toMatch(/both quantities are required/i);
  });

  it("accepts a split that sums to the order total", () => {
    const r = plan({ set2: 'TruSteel 6 mm 32"', qty1: "2", qty2: "1" });
    expect(r.error).toBeNull();
    expect(r.warning).toBeNull();
  });

  it("WARNS and never blocks when the split misses the order total", () => {
    // Brandon: "Qty 1 + Qty 2 must equal the order total (warn if over)."
    // The parenthetical sets the enforcement level, in both directions.
    for (const [q1, q2] of [["3", "2"], ["1", "1"]]) {
      const r = plan({ set2: 'TruSteel 6 mm 32"', qty1: q1, qty2: q2 });
      expect(r.error, `${q1}+${q2}`).toBeNull();
      expect(r.warning, `${q1}+${q2}`).toMatch(/not the 3-box order/);
    }
  });

  it("refuses the same set in both slots", () => {
    const r = plan({ set2: 'TruSteel 6 mm 23"', qty1: "2", qty2: "1" });
    expect(r.error).toMatch(/must be a different set/i);
  });

  it("refuses a second set with no first set", () => {
    const r = plan({ set1: NOT_SERVING, set2: 'TruSteel 6 mm 32"' });
    expect(r.error).toMatch(/pick infusion set 1 first|before adding a second/i);
  });

  it("says nothing at all when no set is chosen", () => {
    const r = plan({ set1: NOT_SERVING, set2: NOT_SERVING, qty1: "" });
    expect(r).toEqual({ split: false, error: null, warning: null });
  });
});

describe("withCurrentSelection", () => {
  const A = { index: 0, label: 'AutoSoft XC 6 mm 23"' };
  const B = { index: 1, label: 'TruSteel 6 mm 23"' };
  const all = [A, B];

  it("leaves a list that already contains the selection alone", () => {
    expect(withCurrentSelection([A, B], all, 0)).toEqual([A, B]);
  });

  it("passes through when nothing is selected", () => {
    expect(withCurrentSelection([A], all, null)).toEqual([A]);
  });

  /* The point of the guard: `InfusionSetCombobox` renders from the options
     list, so a selection the filter removed would show the PLACEHOLDER while
     the board holds a real value — a column reading empty with nothing
     erroring (§5.11). Both live routes to it are covered below. */
  it("re-admits a selection the compatibility filter removed", () => {
    // A t:slim patient whose board row holds a Mobi-only set: the filtered
    // list drops it, but the rep must still see what is on the item.
    expect(withCurrentSelection([B], all, 0)).toEqual([A, B]);
  });

  it("re-admits a Set 2 selection that duplicates Set 1", () => {
    // `compatibleSetOptions(..., { exclude: set1 })` removes it; the duplicate
    // is already reported by `infusionQtyPlan`, so showing it is strictly more
    // honest than blanking the control.
    expect(withCurrentSelection([B], all, 0)[0]).toEqual(A);
  });

  it("does not invent an option when the index is on no list at all", () => {
    // A label deleted from the board: nothing can be re-admitted, and guessing
    // one would put a name on screen the board no longer has.
    expect(withCurrentSelection([A], all, 99)).toEqual([A]);
  });
});
