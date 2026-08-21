import { describe, it, expect } from "vitest";
import {
  servingSellsPumpDevice,
  pumpQtyApplies,
  coercePumpQty,
  servedOrderLines,
  missingNextOrderDates,
  servingContradictions,
  type ServingLineInput,
} from "./servingLines";

/** The five live Serving labels (welcomeCall/workflow.ts SERVING_OPTIONS). */
const SERVING = {
  pump: "Insulin Pump",
  suppliesOnly: "Supplies Only",
  cgm: "CGM",
  pumpCgm: "Insulin Pump + CGM",
  suppliesCgm: "Supplies + CGM",
} as const;

const base: ServingLineInput = {
  serving: "",
  subscriptionType: "",
  cgmType: "",
  infusionSet1: "",
  infusionSet2: "",
  pumpQty: "",
  monitorQty: "",
  qtyInf1: "",
  qtyInf2: "",
};

const p = (over: Partial<ServingLineInput>): ServingLineInput => ({ ...base, ...over });

describe("servingSellsPumpDevice — pump DEVICE, not pump supplies", () => {
  it("is true only for the two labels naming a pump", () => {
    expect(servingSellsPumpDevice(SERVING.pump)).toBe(true);
    expect(servingSellsPumpDevice(SERVING.pumpCgm)).toBe(true);
  });

  it("is FALSE for both Supplies labels — the Bradan French blind spot", () => {
    // `servingIncludesPump()` returns TRUE for these (infusion sets are pump
    // supplies). Conflating the two is what shipped a $3,787.83 t:slim.
    expect(servingSellsPumpDevice(SERVING.suppliesOnly)).toBe(false);
    expect(servingSellsPumpDevice(SERVING.suppliesCgm)).toBe(false);
  });

  it("is false for CGM-only", () => {
    expect(servingSellsPumpDevice(SERVING.cgm)).toBe(false);
  });
});

describe("pumpQtyApplies", () => {
  it("blocks Pump Qty on every non-pump serving", () => {
    expect(pumpQtyApplies(SERVING.suppliesOnly)).toBe(false);
    expect(pumpQtyApplies(SERVING.suppliesCgm)).toBe(false);
    expect(pumpQtyApplies(SERVING.cgm)).toBe(false);
  });

  it("allows it when a pump is being sold", () => {
    expect(pumpQtyApplies(SERVING.pump)).toBe(true);
    expect(pumpQtyApplies(SERVING.pumpCgm)).toBe(true);
  });

  it("is PERMISSIVE on a blank serving", () => {
    // A column that failed to read must never silently disable the control —
    // same contract as needsPriorPumpDate / needsMonitorPurchaseDate.
    expect(pumpQtyApplies("")).toBe(true);
    expect(pumpQtyApplies("   ")).toBe(true);
  });
});

describe("coercePumpQty — the guarantee behind the UI gate", () => {
  it("zeroes a pump quantity that Serving does not support", () => {
    expect(coercePumpQty("1", SERVING.suppliesCgm)).toBe("0"); // Bradan French
    expect(coercePumpQty("1", SERVING.suppliesOnly)).toBe("0");
    expect(coercePumpQty("2", SERVING.cgm)).toBe("0");
  });

  it("leaves a real pump sale alone", () => {
    expect(coercePumpQty("1", SERVING.pump)).toBe("1");
    expect(coercePumpQty("1", SERVING.pumpCgm)).toBe("1");
  });

  it("never invents a 0 where the board holds blank", () => {
    // Writing "0" over a blank cell is a change; only an actual >0 is coerced.
    expect(coercePumpQty("", SERVING.suppliesCgm)).toBe("");
    expect(coercePumpQty("0", SERVING.suppliesCgm)).toBe("0");
  });

  it("does not touch anything when Serving is unknown", () => {
    expect(coercePumpQty("1", "")).toBe("1");
  });
});

describe("servedOrderLines — the union of the evidence", () => {
  it("Leann Austin: Serving says no CGM, everything else says sensors", () => {
    const leann = p({
      serving: SERVING.pump,
      cgmType: "Dexcom G7",
      subscriptionType: "Sensors & Supplies",
      infusionSet1: 'AutoSoft 90 9 mm 23"',
      pumpQty: "1",
      qtyInf1: "3",
    });
    expect(servedOrderLines(leann).sensors).toBe(true);
  });

  it("counts a line served on the product column alone", () => {
    expect(servedOrderLines(p({ serving: SERVING.pump, cgmType: "Dexcom G7" })).sensors).toBe(true);
  });

  it("counts a line served on Subscription Type alone", () => {
    // Chaya Dubrawsky: Serving `Insulin Pump`, CGM Type `Not Serving`,
    // Subscription Type `Sensors` — still a sensors subscription.
    expect(
      servedOrderLines(p({ serving: SERVING.pump, cgmType: "Not Serving", subscriptionType: "Sensors" })).sensors,
    ).toBe(true);
  });

  it("does not count a Not Serving product column as evidence", () => {
    expect(servedOrderLines(p({ serving: SERVING.pump, cgmType: "Not Serving" })).sensors).toBe(false);
  });

  it("keys the pump DEVICE line on quantity only", () => {
    // Serving `Supplies Only` = the patient already owns the pump: no device
    // line, so no device reorder date to chase.
    expect(servedOrderLines(p({ serving: SERVING.suppliesOnly, qtyInf1: "3" })).insulinPump).toBe(false);
    expect(servedOrderLines(p({ serving: SERVING.pump, pumpQty: "1" })).insulinPump).toBe(true);
  });

  it("ignoreSubscriptionType drops that one vote for split profiles", () => {
    const half = p({ serving: SERVING.suppliesOnly, cgmType: "Not Serving", subscriptionType: "Sensors & Supplies" });
    expect(servedOrderLines(half).sensors).toBe(true);
    expect(servedOrderLines(half, { ignoreSubscriptionType: true }).sensors).toBe(false);
  });
});

describe("missingNextOrderDates", () => {
  it("catches Leann Austin's blank Sensors Next Order Date", () => {
    const leann = p({
      serving: SERVING.pump,
      cgmType: "Dexcom G7",
      subscriptionType: "Sensors & Supplies",
      infusionSet1: 'AutoSoft 90 9 mm 23"',
      pumpQty: "1",
      qtyInf1: "3",
    });
    expect(
      missingNextOrderDates(leann, {
        insulinPump: "2026-08-10",
        supplies: "2026-08-10",
        sensors: "", // ← written blank because Serving excluded CGM
      }),
    ).toEqual(["sensors"]);
  });

  it("is silent when every served line has a date", () => {
    expect(
      missingNextOrderDates(p({ serving: SERVING.pumpCgm, cgmType: "Dexcom G7", pumpQty: "1", qtyInf1: "3" }), {
        insulinPump: "2026-08-10",
        sensors: "2026-08-10",
        supplies: "2026-08-10",
      }),
    ).toEqual([]);
  });

  it("never asks for a date on a line that is not served", () => {
    expect(
      missingNextOrderDates(p({ serving: SERVING.cgm, cgmType: "Dexcom G7", subscriptionType: "Sensors" }), {
        insulinPump: "",
        sensors: "2026-08-10",
        supplies: "",
      }),
    ).toEqual([]);
  });

  it("treats a whitespace-only date as blank", () => {
    expect(
      missingNextOrderDates(p({ serving: SERVING.cgm, cgmType: "Dexcom G7" }), {
        insulinPump: "",
        sensors: "   ",
        supplies: "",
      }),
    ).toEqual(["sensors"]);
  });
});

describe("servingContradictions", () => {
  it("flags Leann Austin — Serving excludes CGM, products say sensors", () => {
    const found = servingContradictions(
      p({ serving: SERVING.pump, cgmType: "Dexcom G7", subscriptionType: "Sensors & Supplies" }),
    );
    expect(found).toHaveLength(1);
    expect(found[0].family).toBe("CGM");
    expect(found[0].evidence).toEqual([
      "CGM Type is Dexcom G7",
      "Subscription Type is Sensors & Supplies",
    ]);
  });

  it("flags a sensors subscription on a Supplies Only serving", () => {
    // Patrick Moren.
    const found = servingContradictions(
      p({ serving: SERVING.suppliesOnly, cgmType: "Dexcom G7", subscriptionType: "Sensors & Supplies" }),
    );
    expect(found.map((f) => f.family)).toEqual(["CGM"]);
  });

  it("flags pump supplies excluded by a CGM-only serving", () => {
    const found = servingContradictions(
      p({ serving: SERVING.cgm, infusionSet1: 'AutoSoft XC 6 mm 43"', subscriptionType: "Sensors & Supplies" }),
    );
    expect(found.map((f) => f.family)).toEqual(["pump supplies"]);
  });

  it("is silent on Bradan French — his Serving was not the thing that lied", () => {
    // Serving `Supplies + CGM` genuinely matched his products; Pump Qty = 1 was
    // the defect, and that is coercePumpQty's job, not this one's.
    expect(
      servingContradictions(
        p({
          serving: SERVING.suppliesCgm,
          cgmType: "FreeStyle Libre 3 Plus",
          subscriptionType: "Sensors & Supplies",
          infusionSet1: 'AutoSoft XC 6 mm 43"',
          pumpQty: "1",
        }),
      ),
    ).toEqual([]);
  });

  it("does not fire the direction C14 already covers", () => {
    // Serving includes CGM but the type is missing / Not Serving is C14's.
    expect(servingContradictions(p({ serving: SERVING.pumpCgm, cgmType: "" }))).toEqual([]);
    expect(servingContradictions(p({ serving: SERVING.pumpCgm, cgmType: "Not Serving" }))).toEqual([]);
  });

  it("says nothing when Serving is unknown", () => {
    expect(servingContradictions(p({ serving: "", cgmType: "Dexcom G7" }))).toEqual([]);
  });
});
