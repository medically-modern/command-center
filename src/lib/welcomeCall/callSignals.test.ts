/**
 * The two call-shaping rules ported from the ops prototype. Both only ever
 * produce a prompt, so the tests pin the vocabulary they key on rather than any
 * write behaviour.
 */
import { describe, it, expect } from "vitest";
import {
  isCrossSell,
  isFirstTimePumpUser,
  secondaryAsk,
  secondaryAskNote,
  FIRST_PUMP_CHIP_LABEL,
} from "./workflow";

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

  it("treats the board's 'Done' status artifact as no secondary, not a payer", () => {
    // Secondary Insurance carries a 4th label, "Done", which is not an insurer.
    // The app dropdown offers only the three real values, but the board holds
    // this one and we read it.
    expect(secondaryAsk("Medicare A&B", "Done")).toBe("none");
    expect(secondaryAsk("Humana", "Done")).toBe("none");
  });

  it("covers every label on the live Secondary Insurance column", () => {
    // The regression guard for the class of miss that produced this test.
    const BOARD_SECONDARY = ["None", "NY Medicaid", "Medicare Supplement", "Done"];
    const asks = BOARD_SECONDARY.map((s) => secondaryAsk("Medicare A&B", s));
    expect(asks).toEqual(["none", "medicaid", "medicare-supplement", "none"]);
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

describe("isCrossSell — a blank Request Type is UNKNOWN, not a no", () => {
  it("fires on a real request that excluded CGM", () => {
    // Every genuine cross-sell on the live board 2026-09-17 has this shape.
    expect(isCrossSell({ serving: "Insulin Pump + CGM", requestType: "Insulin Pump" })).toBe(true);
    expect(isCrossSell({ serving: "Supplies + CGM", requestType: "Supplies Only" })).toBe(true);
  });

  it("does not fire when the patient asked for CGM themselves", () => {
    expect(isCrossSell({ serving: "CGM", requestType: "CGM" })).toBe(false);
    expect(isCrossSell({ serving: "Insulin Pump + CGM", requestType: "Insulin Pump + CGM" })).toBe(false);
  });

  it("does not fire on a BLANK Request Type", () => {
    /* Katie, 2026-09-17: "we get flagged on cross sell even if patient has
       already selected CGM (ex: order is CGM only)". 7 of the 39 live rows that
       day carried a blank Request Type with Serving CGM — all SNJ reactivation
       imports — and every one of them wore the chip. */
    expect(isCrossSell({ serving: "CGM", requestType: "" })).toBe(false);
    expect(isCrossSell({ serving: "CGM", requestType: "   " })).toBe(false);
    expect(isCrossSell({ serving: "Insulin Pump + CGM", requestType: "" })).toBe(false);
  });

  it("stays quiet when serving has no CGM at all", () => {
    expect(isCrossSell({ serving: "Insulin Pump", requestType: "Insulin Pump" })).toBe(false);
    expect(isCrossSell({ serving: "Supplies Only", requestType: "" })).toBe(false);
  });
});

describe("the first-pump chip's words", () => {
  it("claims an insurance fact, never a biography", () => {
    /* Brandon, 2026-09-17: "this is from insurance perspective… doesn't
       necessarily mean patient never has used pump before". The rule is
       unchanged; the label was what was wrong, and Charmaine Brooks — who owns
       a pump — still matches it. */
    expect(isFirstTimePumpUser(base)).toBe(true);
    expect(FIRST_PUMP_CHIP_LABEL).toBe("First pump on this insurance");
    expect(FIRST_PUMP_CHIP_LABEL).not.toMatch(/first[- ]time/i);
    expect(FIRST_PUMP_CHIP_LABEL).not.toMatch(/user/i);
  });
});
