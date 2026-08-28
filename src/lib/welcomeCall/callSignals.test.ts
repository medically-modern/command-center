/**
 * The two call-shaping rules ported from the ops prototype. Both only ever
 * produce a prompt, so the tests pin the vocabulary they key on rather than any
 * write behaviour.
 */
import { describe, it, expect } from "vitest";
import { isFirstTimePumpUser, secondaryAsk, secondaryAskNote } from "./workflow";

const base = { serving: "Insulin Pump", pumpQty: "1", ipLastBillDate: "", medicarePriorPumpDate: "" };

describe("isFirstTimePumpUser", () => {
  it("fires when we are shipping a pump and there is no prior-pump evidence", () => {
    expect(isFirstTimePumpUser(base)).toBe(true);
    expect(isFirstTimePumpUser({ ...base, serving: "Insulin Pump + CGM" })).toBe(true);
  });

  it("does not fire when a prior pump bill is on file", () => {
    expect(isFirstTimePumpUser({ ...base, ipLastBillDate: "2024-03-01" })).toBe(false);
  });

  it("does not fire when a Medicare prior-pump date was collected", () => {
    expect(isFirstTimePumpUser({ ...base, medicarePriorPumpDate: "05/2024" })).toBe(false);
  });

  it("keys on QUANTITY, not on serving a pump family", () => {
    // A supplies patient already owns a pump: serving contains "supplies", so
    // servingIncludesPump is true, but no device is shipping.
    expect(isFirstTimePumpUser({ ...base, serving: "Supplies Only", pumpQty: "0" })).toBe(false);
    expect(isFirstTimePumpUser({ ...base, pumpQty: "0" })).toBe(false);
    expect(isFirstTimePumpUser({ ...base, pumpQty: "" })).toBe(false);
  });

  it("does not fire when no pump is served at all", () => {
    expect(isFirstTimePumpUser({ ...base, serving: "CGM" })).toBe(false);
  });

  it("treats whitespace-only dates as absent", () => {
    expect(isFirstTimePumpUser({ ...base, ipLastBillDate: "   " })).toBe(true);
  });
});

describe("secondaryAsk", () => {
  it("stays quiet when there is no secondary on file", () => {
    // The page already warns about a likely-missing secondary; a third line
    // under the same field would be noise.
    expect(secondaryAsk("Medicare A&B", "")).toBe("none");
    expect(secondaryAsk("Medicare A&B", "None")).toBe("none");
    expect(secondaryAskNote("none")).toBe("");
  });

  it("shortcuts a Medicare supplement — the board label and a Medigap name", () => {
    expect(secondaryAsk("Medicare A&B", "Medicare Supplement")).toBe("medicare-supplement");
    expect(secondaryAsk("Medicare A&B", "Excellus BCBS Medigap Plan G")).toBe("medicare-supplement");
    expect(secondaryAskNote("medicare-supplement")).toContain("No details needed");
  });

  it("asks only for the member ID on a Medicaid secondary", () => {
    expect(secondaryAsk("Medicare A&B", "NY Medicaid")).toBe("medicaid");
    expect(secondaryAskNote("medicaid")).toContain("member ID");
  });

  it("splits the remaining case on whether the primary is Original Medicare", () => {
    expect(secondaryAsk("Medicare A&B", "Aetna Commercial")).toBe("member-id");
    expect(secondaryAsk("Humana", "Aetna Commercial")).toBe("full-details");
    expect(secondaryAskNote("full-details")).toContain("not Medicare");
  });

  it("does not treat a Medicare Advantage primary as Original Medicare", () => {
    // isOriginalMedicare is an exact "Medicare A&B" match — Advantage plans are
    // a different product and get the full-details ask.
    expect(secondaryAsk("Aetna Medicare", "Cigna")).toBe("full-details");
    expect(secondaryAsk("United Medicare", "Cigna")).toBe("full-details");
  });

  it("returns a sentence for every ask that renders", () => {
    for (const ask of ["medicare-supplement", "medicaid", "member-id", "full-details"] as const) {
      expect(secondaryAskNote(ask).length).toBeGreaterThan(0);
    }
  });
});
