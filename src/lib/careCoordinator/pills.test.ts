/**
 * The Care Coordinator card's pill row — Brandon's fixed grid (2026-09-16),
 * with his colours rather than the "all neutral gray" line his layout spec
 * ended on (Josh resolved the contradiction the same day: "take #6's layout
 * and #5's colours").
 */
import { describe, it, expect } from "vitest";

import {
  PILL_GRID_TEMPLATE, PILL_SLOTS, intakeInsurance, pillTone, shortLabel,
} from "./pills";

describe("PILL_SLOTS", () => {
  it("is in Brandon's order, with his captions", () => {
    expect(PILL_SLOTS.map((s) => s.key)).toEqual(["requestType", "insurance", "ipPath", "cgmPath", "status"]);
    expect(PILL_SLOTS.map((s) => s.caption)).toEqual(["Request type", "Insurance", "Pump path", "CGM path", "Form"]);
  });

  it("puts each slot on the track the template reserves for it", () => {
    // ⚠️ The columns are 1 · 3 · 5 · 6 · 8 because the template interleaves
    // fixed .5rem spacer tracks. Change one and the pills land in the gaps.
    expect(PILL_SLOTS.map((s) => s.column)).toEqual([1, 3, 5, 6, 8]);
    expect(PILL_GRID_TEMPLATE.split(" ").length).toBe(8);
  });
});

describe("shortLabel", () => {
  it("shortens the long board values Brandon listed", () => {
    expect(shortLabel("Insulin Pump + CGM")).toBe("Pump + CGM");
    expect(shortLabel("1st Pump >6M Diagnosed")).toBe("1st Pump >6M");
    expect(shortLabel("United Healthcare")).toBe("UHC");
    expect(shortLabel("Health Plans Inc (PHCS)")).toBe("PHCS");
    expect(shortLabel("Neither Applies")).toBe("Neither");
  });

  it("passes anything else through untouched", () => {
    expect(shortLabel("Cigna")).toBe("Cigna");
    expect(shortLabel("")).toBe("");
  });
});

describe("pillTone", () => {
  it("colours the form state: Completed green, Partial gray", () => {
    expect(pillTone("status", "Completed")).toBe("green");
    expect(pillTone("status", "Partial")).toBe("neutral");
  });

  it("colours the CGM path: Insulin green, Hypo yellow, Neither light red", () => {
    expect(pillTone("cgmPath", "Insulin")).toBe("green");
    expect(pillTone("cgmPath", "Hypo")).toBe("yellow");
    expect(pillTone("cgmPath", "Neither Applies")).toBe("red");
  });

  it("leaves the CGM column's fourth label NEUTRAL rather than guessing", () => {
    // ⚠️ "Not Serving" is a real live label Brandon gave no colour to. A wrong
    // colour reads as a judgement the app has not made.
    expect(pillTone("cgmPath", "Not Serving")).toBe("neutral");
  });

  it("leaves the PUMP path neutral — it is a different vocabulary", () => {
    // The Insulin/Hypo/Neither rule is about the CGM column; the pump column's
    // labels are Not Serving · IW New Insurance · Omnipod Switch · OOW Pump ·
    // 1st Pump >6M · 1st Pump <6M · Supplies Only.
    expect(pillTone("ipPath", "OOW Pump")).toBe("neutral");
    expect(pillTone("ipPath", "Supplies Only")).toBe("neutral");
  });

  it("greens ANY insurance that is listed, and nothing when it is blank", () => {
    expect(pillTone("insurance", "Cigna")).toBe("green");
    expect(pillTone("insurance", "Card on file")).toBe("green");
    expect(pillTone("insurance", "")).toBe("neutral");
    expect(pillTone("insurance", "   ")).toBe("neutral");
  });
});

describe("intakeInsurance", () => {
  const lead = (over: Partial<Parameters<typeof intakeInsurance>[0]> = {}) => ({
    generalInsurance: "", insuranceProvidedVia: "", insuranceOther: "", ...over,
  });

  it("says CARD ON FILE for a patient who sent a photo and has no carrier typed in", () => {
    // ⚠️ Debra Collins, 2026-09-16 — and 17 other live rows. General Insurance
    // is blank because the carrier is on the photo, so reading that column
    // alone rendered nothing for exactly the patients who supplied the most.
    expect(intakeInsurance(lead({ insuranceProvidedVia: "Photo of card" }))).toBe("Card on file");
  });

  it("prefers a real carrier over the photo note when both exist", () => {
    expect(intakeInsurance(lead({ generalInsurance: "Cigna", insuranceProvidedVia: "Photo of card" }))).toBe("Cigna");
  });

  it("stays BLANK for a patient who provided nothing", () => {
    // ⚠️ "Not provided" is a real answer and it is the one answer that is not
    // insurance information. A green pill on it would be a lie.
    expect(intakeInsurance(lead({ insuranceProvidedVia: "Not provided" }))).toBe("");
    expect(intakeInsurance(lead())).toBe("");
  });

  it("unwraps a General Insurance of 'Other' to the carrier behind it", () => {
    // Three live rows: Health partners, QualChoice, CHRISTUS HEALTH PLAN.
    expect(intakeInsurance(lead({
      generalInsurance: "Other", insuranceOther: "CHRISTUS HEALTH PLAN", insuranceProvidedVia: "Entered manually",
    }))).toBe("CHRISTUS HEALTH PLAN");
  });

  it("falls back to 'Other' when the free-text box is empty", () => {
    expect(intakeInsurance(lead({ generalInsurance: "Other" }))).toBe("Other");
  });
});
