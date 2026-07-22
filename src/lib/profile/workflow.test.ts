// CGM cross-sell gating (crossSellReason / canCrossSellCgm / deriveServing).
// The JLJ block is Brandon's 2026-07-15 rule: NO Anthem JLJ plan (Medicaid
// AND Low-Cost) can do CGM. Ships together with the "NY CHIP" → Low-Cost
// regex fix — the CHIP fix alone would move those members from "Medicaid"
// (incidentally blocked) to "Low-Cost (JLJ)" (previously eligible) and start
// wrongly cross-selling CGM. Run: npx vitest run src/lib/profile/workflow.test.ts
import { describe, it, expect } from "vitest";
import { crossSellReason, canCrossSellCgm, deriveServing } from "./workflow";

describe("crossSellReason", () => {
  it("blocks ALL Anthem JLJ plans — Low-Cost was previously eligible", () => {
    expect(crossSellReason("Anthem BCBS Low-Cost (JLJ)")).toBe("jlj");
    expect(crossSellReason("Anthem BCBS Medicaid (JLJ)")).toBe("jlj");
  });
  it("JLJ wins over the incidental medicaid-substring match", () => {
    // Before: "Anthem BCBS Medicaid (JLJ)" was blocked only because the label
    // contains "medicaid". The jlj check runs first so the reason is accurate.
    expect(crossSellReason("Anthem BCBS Medicaid (JLJ)")).not.toBe("medicaid");
  });
  it("existing blocks unchanged", () => {
    expect(crossSellReason("Medicaid")).toBe("medicaid");
    expect(crossSellReason("United Medicare")).toBe("united");
    expect(crossSellReason("Cigna")).toBe("cigna");
    expect(crossSellReason("")).toBe("no-primary");
  });
  it("non-JLJ plans stay eligible", () => {
    expect(crossSellReason("Anthem BCBS Commercial")).toBe("eligible");
    expect(crossSellReason("Fidelis Low-Cost")).toBe("eligible");
    expect(crossSellReason("Horizon BCBS")).toBe("eligible");
  });
});

describe("JLJ end state (trigger member JLJ730667355)", () => {
  it("Low-Cost (JLJ) + Supplies Only → no CGM added, serving stays as requested", () => {
    expect(canCrossSellCgm("Anthem BCBS Low-Cost (JLJ)")).toBe(false);
    // blocked → cgmCrossSell lands "Couldn't Cross-Sell" → serving = request
    expect(deriveServing("Couldn't Cross-Sell", "Supplies Only")).toBe("Supplies Only");
  });
  it("eligible commercial still auto-upgrades Supplies Only → Supplies + CGM", () => {
    expect(canCrossSellCgm("Anthem BCBS Commercial")).toBe(true);
    expect(deriveServing("Cross-Sell", "Supplies Only")).toBe("Supplies + CGM");
  });
});

describe("deriveServing strips CGM from a combined request when we can't serve CGM", () => {
  it("Fidelis Medicaid + 'Insulin Pump + CGM' → serve Insulin Pump only", () => {
    // Fidelis Medicaid is a Medicaid plan → can't cross-sell CGM.
    expect(canCrossSellCgm("Fidelis Medicaid")).toBe(false);
    // The bug: serving used to be suggested as "Insulin Pump + CGM" verbatim,
    // suggesting a CGM we can't provide. It must drop to "Insulin Pump".
    expect(deriveServing("Couldn't Cross-Sell", "Insulin Pump + CGM")).toBe("Insulin Pump");
  });
  it("Couldn't Cross-Sell + 'Supplies + CGM' → serve Supplies Only", () => {
    expect(deriveServing("Couldn't Cross-Sell", "Supplies + CGM")).toBe("Supplies Only");
  });
  it("applies to every can't-cross-sell reason, not just Medicaid", () => {
    for (const ins of ["Fidelis Medicaid", "Anthem BCBS Low-Cost (JLJ)", "United Medicare", "Cigna"]) {
      expect(canCrossSellCgm(ins)).toBe(false);
    }
    expect(deriveServing("Couldn't Cross-Sell", "Insulin Pump + CGM")).toBe("Insulin Pump");
  });
  it("eligible plans still cross-sell the combined product (Insulin Pump → +CGM)", () => {
    expect(deriveServing("Cross-Sell", "Insulin Pump")).toBe("Insulin Pump + CGM");
  });
  it("Already Serving CGM leaves the combined request unchanged", () => {
    // Patient already gets CGM through us — serving reflects the full request.
    expect(deriveServing("Already Serving CGM", "Insulin Pump + CGM")).toBe("Insulin Pump + CGM");
  });
  it("a non-combined request under Couldn't Cross-Sell is untouched", () => {
    expect(deriveServing("Couldn't Cross-Sell", "Insulin Pump")).toBe("Insulin Pump");
    expect(deriveServing("Couldn't Cross-Sell", "Supplies Only")).toBe("Supplies Only");
  });
});
