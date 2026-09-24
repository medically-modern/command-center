import { describe, it, expect } from "vitest";

import {
  BLANK_LABEL, EMPTY_SELECTION, FACET_KEYS, activeFacetCount, clearFacet, facetOptions,
  facetValue, isFiltering, matchesFacets, toggleFacetValue, type FacetSelection,
} from "./intakeFilter";
import type { IntakeLead } from "./workflow";

const GROUPS = { partial: "group_partial", completed: "group_completed" };

const lead = (over: Partial<IntakeLead> = {}): IntakeLead => ({
  id: "1", name: "Pat", groupId: GROUPS.completed, createdAt: "2026-09-01T10:00:00Z",
  phone: "5555550100", email: "pat@example.com",
  dropOffStep: "Completed", attemptCounter: "0", dropOffAttempt: "0",
  requestType: "Insulin Pump", pumpNeed: "", reasonForInquiry: "", proceedPreference: "",
  scheduledCallTime: "", bookingStatus: "", intakeCallComplete: "", intakeEscalation: "",
  referralType: "Patient", referralSource: "", alreadyInSystem: "", followUp: "", followUpDate: "",
  dupCheckResult: "", state: "NY", generalInsurance: "Aetna",
  insuranceProvidedVia: "", insuranceOther: "", calendlyEventUri: "",
  providedDoctorName: "", providedClinicPhone: "",
  ipCoveragePath: "OOW Pump", cgmCoveragePath: "Insulin",
  hasInsuranceCard: false, stediError: "", stediActive: "Yes", stediPlanName: "Test Plan", stediInNetwork: "", intakeWarnings: "", intakeWarningAcks: "",
  ...over,
});

describe("facetValue", () => {
  it("reads each facet the way the card's pill does", () => {
    const l = lead();
    expect(facetValue(l, "requestType", GROUPS)).toBe("Insulin Pump");
    expect(facetValue(l, "insurance", GROUPS)).toBe("Aetna");
    expect(facetValue(l, "ipPath", GROUPS)).toBe("OOW Pump");
    expect(facetValue(l, "cgmPath", GROUPS)).toBe("Insulin");
    expect(facetValue(l, "form", GROUPS)).toBe("Completed");
  });

  it('offers "Photo upload" as Brandon asked — under the name the card shows it', () => {
    // ⚠️ He asked for "Photo upload" as an insurance option. It is not a payer
    // and is not on the General Insurance column at all: it is Insurance
    // Provided Via = "Photo of card", which the card renders as "Photo upload"
    // because 18 of the 20 live rows that answered it have a blank carrier.
    // Deriving from `intakeInsurance` is what makes the option and the pill the
    // same string rather than two spellings of one idea.
    const l = lead({ generalInsurance: "", insuranceProvidedVia: "Photo of card" });
    expect(facetValue(l, "insurance", GROUPS)).toBe("Photo upload");
  });

  it('treats a "Not Serving" path as blank, exactly as the pill does', () => {
    const l = lead({ ipCoveragePath: "Not Serving", cgmCoveragePath: "Not Serving" });
    expect(facetValue(l, "ipPath", GROUPS)).toBe("");
    expect(facetValue(l, "cgmPath", GROUPS)).toBe("");
  });

  it("reads Form off the GROUP, and a row in neither form group is blank", () => {
    expect(facetValue(lead({ groupId: GROUPS.partial }), "form", GROUPS)).toBe("Partial");
    // A booked patient already advanced to Profile Clean-Up is neither.
    expect(facetValue(lead({ groupId: "group_cleanup" }), "form", GROUPS)).toBe("");
  });
});

describe("matchesFacets", () => {
  it("shows everything when nothing is selected", () => {
    // ⚠️ The rule that replaces the old toggle's "All". A filter that started
    // empty and therefore matched nothing would read as a broken page.
    expect(matchesFacets(lead(), EMPTY_SELECTION, GROUPS)).toBe(true);
    expect(isFiltering(EMPTY_SELECTION)).toBe(false);
  });

  it("ORs within one facet — which is the whole point of multi-select", () => {
    const sel: FacetSelection = { ...EMPTY_SELECTION, requestType: ["Insulin Pump", "CGM"] };
    expect(matchesFacets(lead({ requestType: "CGM" }), sel, GROUPS)).toBe(true);
    expect(matchesFacets(lead({ requestType: "Insulin Pump" }), sel, GROUPS)).toBe(true);
    expect(matchesFacets(lead({ requestType: "Supplies" }), sel, GROUPS)).toBe(false);
  });

  it("ANDs across facets", () => {
    const sel: FacetSelection = { ...EMPTY_SELECTION, requestType: ["CGM"], form: ["Partial"] };
    expect(matchesFacets(lead({ requestType: "CGM", groupId: GROUPS.partial }), sel, GROUPS)).toBe(true);
    expect(matchesFacets(lead({ requestType: "CGM", groupId: GROUPS.completed }), sel, GROUPS)).toBe(false);
  });

  it("can select BLANK, so rows with nothing on file stay reachable", () => {
    // The card shows these as an em dash; without a blank option there would be
    // no way to filter TO them through the control that exists to find rows.
    const sel: FacetSelection = { ...EMPTY_SELECTION, insurance: [""] };
    expect(matchesFacets(lead({ generalInsurance: "", insuranceProvidedVia: "" }), sel, GROUPS)).toBe(true);
    expect(matchesFacets(lead({ generalInsurance: "Aetna" }), sel, GROUPS)).toBe(false);
  });
});

describe("facetOptions", () => {
  const leads = [
    lead({ id: "1", generalInsurance: "Aetna" }),
    lead({ id: "2", generalInsurance: "Aetna" }),
    lead({ id: "3", generalInsurance: "Cigna" }),
    lead({ id: "4", generalInsurance: "", insuranceProvidedVia: "" }),
  ];

  it("counts every value in the population", () => {
    const opts = facetOptions(leads, "insurance", GROUPS);
    expect(opts.map((o) => [o.label, o.count])).toEqual([
      ["Aetna", 2], ["Cigna", 1], [BLANK_LABEL, 1],
    ]);
  });

  it("always sorts blank LAST, however common it is", () => {
    // It is the absence of an answer; a list whose first entry is "Not set"
    // buries the real ones.
    const blanky = [lead({ generalInsurance: "" }), lead({ generalInsurance: "" }), lead({ generalInsurance: "Cigna" })];
    expect(facetOptions(blanky, "insurance", GROUPS).map((o) => o.label)).toEqual(["Cigna", BLANK_LABEL]);
  });
});

describe("selection helpers", () => {
  it("toggles a value on and back off without mutating", () => {
    const one = toggleFacetValue(EMPTY_SELECTION, "requestType", "CGM");
    expect(one.requestType).toEqual(["CGM"]);
    expect(EMPTY_SELECTION.requestType).toEqual([]);
    expect(toggleFacetValue(one, "requestType", "CGM").requestType).toEqual([]);
  });

  it("counts and clears facets", () => {
    let sel = toggleFacetValue(EMPTY_SELECTION, "requestType", "CGM");
    sel = toggleFacetValue(sel, "form", "Partial");
    expect(activeFacetCount(sel)).toBe(2);
    expect(activeFacetCount(clearFacet(sel, "form"))).toBe(1);
  });

  it("covers all five of Brandon's columns and no more", () => {
    expect(FACET_KEYS).toEqual(["requestType", "insurance", "ipPath", "cgmPath", "form"]);
  });
});
