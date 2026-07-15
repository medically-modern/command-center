import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  appendCallLog,
  composeCallLogLines,
  composeEscalationReason,
  deriveBenefitsPreview,
  deriveNeverBilled,
  derivedSos,
  isBlankCallRow,
  isValidUnits,
  patientHasMedicaidIns,
  sosCutoffYmd,
  sosEntryComplete,
  sosLookbackDays,
  validateBenefitsFactsForSubmit,
} from "./benefitsDerive";
import type { InsuranceState, Patient, ProductCodeState } from "./workflow";
import { EMPTY_INSURANCE } from "./workflow";

const TODAY = "2026-07-15";

const state = (p: Partial<ProductCodeState>): ProductCodeState => ({
  status: "pending",
  ...p,
});

function makePatient(overrides: Partial<Patient>): Patient {
  return {
    id: "1",
    name: "Test Patient",
    dob: "1970-01-01",
    product: "CGM",
    payer: "",
    doctorName: "",
    doctorClinic: "",
    contactMethod: "parachute",
    stage: "advanced",
    pillars: {},
    pathwayChecks: {},
    chaseStep: 0,
    faxPhase: 1,
    notes: "",
    receivedAt: "",
    lastUpdated: "",
    owner: "Samantha",
    insurance: structuredClone(EMPTY_INSURANCE),
    ...overrides,
  } as Patient;
}

describe("lookback windows (spec §1)", () => {
  it("pump and monitor use 4 years (1460 days, matching current production math)", () => {
    expect(sosLookbackDays("pump", false)).toBe(1460);
    expect(sosLookbackDays("cgm-monitor", true)).toBe(1460);
  });
  it("sensors/supplies use 90 days, tightened to 60 with Medicaid", () => {
    expect(sosLookbackDays("cgm-sensors", false)).toBe(90);
    expect(sosLookbackDays("cgm-sensors", true)).toBe(60);
    expect(sosLookbackDays("infusion-sets", true)).toBe(60);
    expect(sosLookbackDays("cartridges", false)).toBe(90);
  });
  it("Medicaid detection is a substring match on either insurance", () => {
    expect(patientHasMedicaidIns("Fidelis Medicaid", "")).toBe(true);
    expect(patientHasMedicaidIns("Medicare A&B", "NY Medicaid")).toBe(true);
    expect(patientHasMedicaidIns("Horizon BCBS", "None")).toBe(false);
  });
  it("cutoff is today minus the lookback", () => {
    expect(sosCutoffYmd("cgm-sensors", false, TODAY)).toBe("2026-04-16");
    expect(sosCutoffYmd("cgm-sensors", true, TODAY)).toBe("2026-05-16");
    expect(sosCutoffYmd("pump", false, TODAY)).toBe(addDaysYmd(TODAY, -1460));
  });
});

describe("derivedSos (spec §1) — the rep never picks Clear/Not Clear/Skip", () => {
  it("Auth = Required derives Skip unconditionally, ignoring entered facts", () => {
    expect(derivedSos(state({ auth: "required" }), "pump", false, TODAY)).toBe("skip");
    expect(
      derivedSos(
        state({ auth: "required", sosEntry: "billed", lastBillDate: "2026-07-01", units: "3" }),
        "cgm-sensors",
        false,
        TODAY,
      ),
    ).toBe("skip");
  });
  it("No Billing History derives Clear", () => {
    expect(derivedSos(state({ sosEntry: "never" }), "pump", false, TODAY)).toBe("clear");
  });
  it("a bill older than the lookback derives Clear; within it derives Not Clear", () => {
    expect(
      derivedSos(state({ sosEntry: "billed", lastBillDate: "2020-01-01" }), "pump", false, TODAY),
    ).toBe("clear");
    expect(
      derivedSos(state({ sosEntry: "billed", lastBillDate: "2024-01-01" }), "pump", false, TODAY),
    ).toBe("not-clear");
    // Sensors: 90-day window
    expect(
      derivedSos(state({ sosEntry: "billed", lastBillDate: "2026-06-01" }), "cgm-sensors", false, TODAY),
    ).toBe("not-clear");
    expect(
      derivedSos(state({ sosEntry: "billed", lastBillDate: "2026-01-01" }), "cgm-sensors", false, TODAY),
    ).toBe("clear");
  });
  it("a bill exactly ON the cutoff is NOT clear (strict <, open question 2b)", () => {
    const cutoff = sosCutoffYmd("cgm-sensors", false, TODAY);
    expect(
      derivedSos(state({ sosEntry: "billed", lastBillDate: cutoff }), "cgm-sensors", false, TODAY),
    ).toBe("not-clear");
    expect(
      derivedSos(
        state({ sosEntry: "billed", lastBillDate: addDaysYmd(cutoff, -1) }),
        "cgm-sensors",
        false,
        TODAY,
      ),
    ).toBe("clear");
  });
  it("the Medicaid 60-day window changes the verdict for the same date", () => {
    const d = "2026-04-20"; // 86 days before TODAY: inside 90, outside 60
    expect(derivedSos(state({ sosEntry: "billed", lastBillDate: d }), "cgm-sensors", false, TODAY)).toBe("not-clear");
    expect(derivedSos(state({ sosEntry: "billed", lastBillDate: d }), "cgm-sensors", true, TODAY)).toBe("clear");
  });
  it("incomplete facts derive nothing", () => {
    expect(derivedSos(state({}), "pump", false, TODAY)).toBe("");
    expect(derivedSos(state({ sosEntry: "billed" }), "pump", false, TODAY)).toBe("");
    expect(derivedSos(undefined, "pump", false, TODAY)).toBe("");
  });
});

describe("sosEntryComplete — units must be a positive whole number", () => {
  it("validates units", () => {
    expect(isValidUnits("3")).toBe(true);
    expect(isValidUnits("0")).toBe(false);
    expect(isValidUnits("-1")).toBe(false);
    expect(isValidUnits("2.5")).toBe(false);
    expect(isValidUnits("")).toBe(false);
    expect(isValidUnits(undefined)).toBe(false);
  });
  it("billed entries need BOTH date and valid units", () => {
    expect(sosEntryComplete(state({ sosEntry: "billed", lastBillDate: "2026-01-01", units: "2" }))).toBe(true);
    expect(sosEntryComplete(state({ sosEntry: "billed", lastBillDate: "2026-01-01" }))).toBe(false);
    expect(sosEntryComplete(state({ sosEntry: "billed", units: "2" }))).toBe(false);
    expect(sosEntryComplete(state({ sosEntry: "billed", lastBillDate: "2026-01-01", units: "-1" }))).toBe(false);
  });
  it("never-billed and auth-required entries are complete", () => {
    expect(sosEntryComplete(state({ sosEntry: "never" }))).toBe(true);
    expect(sosEntryComplete(state({ auth: "required" }))).toBe(true);
    expect(sosEntryComplete(state({}))).toBe(false);
  });
});

describe("deriveNeverBilled (spec §2)", () => {
  const insWith = (codes: InsuranceState["codes"]): InsuranceState => ({
    ...structuredClone(EMPTY_INSURANCE),
    codes,
  });

  it("requires primary EXACTLY 'Medicare A&B'", () => {
    const codes = {
      "infusion-sets": state({ sosEntry: "never" }),
      cartridges: state({ sosEntry: "never" }),
      "cgm-sensors": state({ sosEntry: "never" }),
    };
    expect(deriveNeverBilled(insWith(codes), "Medicare A&B")).toEqual({
      isCar: true,
      cgm: true,
      pumpDateTbd: true,
    });
    expect(deriveNeverBilled(insWith(codes), "Fidelis Medicare")).toEqual({
      isCar: false,
      cgm: false,
      pumpDateTbd: false,
    });
  });
  it("IS/Car needs BOTH infusion sets AND cartridges never billed", () => {
    const one = insWith({ "infusion-sets": state({ sosEntry: "never" }) });
    expect(deriveNeverBilled(one, "Medicare A&B").isCar).toBe(false);
    expect(deriveNeverBilled(one, "Medicare A&B").pumpDateTbd).toBe(false);
  });
  it("the pump's own entry is irrelevant to TBD (prototype behavior, open question 9)", () => {
    const ins = insWith({
      "infusion-sets": state({ sosEntry: "never" }),
      cartridges: state({ sosEntry: "never" }),
      pump: state({ sosEntry: "billed", lastBillDate: "2024-01-01", units: "1" }),
    });
    expect(deriveNeverBilled(ins, "Medicare A&B").pumpDateTbd).toBe(true);
  });
});

describe("submit gating (spec §5)", () => {
  it("lists unanswered universal checks and incomplete products by HCPC", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
    });
    const missing = validateBenefitsFactsForSubmit(p);
    expect(missing).toContain("In-Network");
    expect(missing).toContain("Insurance Active");
    expect(missing).toContain("DME Benefits");
    expect(missing).toContain("E2103 · Auth Requirements");
    expect(missing).toContain("A4239 · Auth Requirements");
  });
  it("a Not-Confirmed universal answer passes gating (it escalates instead)", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "not-confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          "cgm-monitor": state({ auth: "not-required", sosEntry: "never" }),
          "cgm-sensors": state({ auth: "not-required", sosEntry: "billed", lastBillDate: "2026-01-01", units: "3" }),
        },
      },
    });
    expect(validateBenefitsFactsForSubmit(p)).toEqual([]);
  });
  it("billed entries missing units block send", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          "cgm-monitor": state({ auth: "not-required", sosEntry: "never" }),
          "cgm-sensors": state({ auth: "not-required", sosEntry: "billed", lastBillDate: "2026-01-01" }),
        },
      },
    });
    expect(validateBenefitsFactsForSubmit(p)).toEqual([
      "A4239 · Last Bill Date + Units, or No Billing History",
    ]);
  });
  it("hidden Medicaid-routed supplies are exempt from gating", () => {
    const p = makePatient({
      serving: "Supplies Only",
      primaryInsurance: "Medicaid",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
      },
    });
    expect(validateBenefitsFactsForSubmit(p)).toEqual([]);
  });
});

describe("call logs (spec §4, D8)", () => {
  it("discards fully-blank rows and formats one line per call", () => {
    const lines = composeCallLogLines(
      [
        { ref: "4821-A", note: "spoke with payer" },
        { ref: "", note: "" },
        { ref: "  ", note: "  " },
        { ref: "", note: "note only" },
        { ref: "REF-2", note: "" },
      ],
      "benefits",
      "2026-07-13",
    );
    expect(lines).toEqual([
      "[Benefits call · ref 4821-A · 2026-07-13] spoke with payer",
      "[Benefits call · 2026-07-13] note only",
      "[Benefits call · ref REF-2 · 2026-07-13]",
    ]);
  });
  it("tags section-2 rows as SoS/auth calls", () => {
    expect(composeCallLogLines([{ ref: "1", note: "x" }], "sos-auth", "2026-07-13")).toEqual([
      "[SoS/auth call · ref 1 · 2026-07-13] x",
    ]);
  });
  it("appends onto existing history without overwriting", () => {
    expect(appendCallLog("old line", ["new line"])).toBe("old line\nnew line");
    expect(appendCallLog("", ["a", "b"])).toBe("a\nb");
    expect(appendCallLog(null, [])).toBe("");
  });
  it("isBlankCallRow", () => {
    expect(isBlankCallRow({ ref: "", note: " " })).toBe(true);
    expect(isBlankCallRow({ ref: "x", note: "" })).toBe(false);
  });
});

describe("escalation reason (D4)", () => {
  it("composes reasons for failed checks and pump not-clear", () => {
    const ins: InsuranceState = {
      ...structuredClone(EMPTY_INSURANCE),
      universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "not-confirmed" },
    };
    expect(composeEscalationReason(ins, "not-clear", "2024-11-02", "2026-07-15")).toBe(
      "[Auto-escalated · 2026-07-15] DME Benefits = Not Covered; Insulin Pump SoS Not Clear (last billed 2024-11-02, within the 4-yr window)",
    );
  });
  it("returns empty when nothing escalates", () => {
    expect(composeEscalationReason(structuredClone(EMPTY_INSURANCE), "clear", undefined)).toBe("");
  });
});

describe("deriveBenefitsPreview — full board output", () => {
  it("all-clear commercial CGM patient goes to Complete", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          "cgm-monitor": state({ auth: "not-required", sosEntry: "never" }),
          "cgm-sensors": state({ auth: "not-required", sosEntry: "billed", lastBillDate: "2026-01-01", units: "3" }),
        },
      },
    });
    const pv = deriveBenefitsPreview(p, TODAY);
    expect(pv.activeNetwork).toBe("Active/In-network");
    expect(pv.dmeBenefits).toBe("Yes");
    expect(pv.auth).toBe("No Auths Required");
    expect(pv.sos).toBe("All Clear");
    expect(pv.stage).toBe("Complete");
    expect(pv.escalation).toBe("Done");
    expect(pv.nextOrder.sensors).toBe("2026-04-01"); // +90d
  });

  it("pump not-clear escalates and holds the stage", () => {
    const p = makePatient({
      serving: "Insulin Pump",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          pump: state({ auth: "not-required", sosEntry: "billed", lastBillDate: "2024-01-01", units: "1" }),
          "infusion-sets": state({ auth: "not-required", sosEntry: "never" }),
          cartridges: state({ auth: "not-required", sosEntry: "never" }),
        },
      },
    });
    const pv = deriveBenefitsPreview(p, TODAY);
    expect(pv.sos).toBe("Partial / Not Clear");
    expect(pv.notClearProducts).toEqual(["Insulin Pump"]);
    expect(pv.stage).toBe("Benefits / SoS");
    expect(pv.escalation).toBe("Escalation Required");
  });

  it("a NON-pump not-clear product does NOT escalate (matches current behavior)", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          "cgm-monitor": state({ auth: "not-required", sosEntry: "never" }),
          "cgm-sensors": state({ auth: "not-required", sosEntry: "billed", lastBillDate: "2026-07-01", units: "3" }),
        },
      },
    });
    const pv = deriveBenefitsPreview(p, TODAY);
    expect(pv.sos).toBe("Partial / Not Clear");
    expect(pv.escalation).toBe("Done");
    expect(pv.stage).toBe("Complete");
  });

  it("any auth required advances to Submit Auth. and derives Skip for that product", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          "cgm-monitor": state({ auth: "required" }),
          "cgm-sensors": state({ auth: "not-required", sosEntry: "never" }),
        },
      },
    });
    const pv = deriveBenefitsPreview(p, TODAY);
    expect(pv.auth).toBe("Auths Required");
    expect(pv.sos).toBe("Skip");
    expect(pv.skipProducts).toEqual(["CGM Monitor"]);
    expect(pv.stage).toBe("Submit Auth.");
    expect(pv.authResults.monitor).toBe("Required");
    expect(pv.authResults.sensors).toBe("No Auth Needed");
    expect(pv.authResults.insulin_pump).toBe("Not Serving");
  });

  it("hidden Medicaid supplies force Auths Required + Submit Auth., never Complete", () => {
    const p = makePatient({
      serving: "Insulin Pump",
      primaryInsurance: "Medicaid",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          pump: state({ auth: "not-required", sosEntry: "never" }),
        },
      },
    });
    const pv = deriveBenefitsPreview(p, TODAY);
    expect(pv.auth).toBe("Auths Required");
    expect(pv.stage).toBe("Submit Auth.");
    expect(pv.authResults.infusion_set).toBe("Required");
    expect(pv.authResults.cartridge).toBe("Required");
    // hidden supplies are Clear, not Skip
    expect(pv.skipProducts).toEqual([]);
  });

  it("Medicaid pump with auth required lands in Skip SoS Products (D5: intended)", () => {
    const p = makePatient({
      serving: "Insulin Pump",
      primaryInsurance: "Medicaid",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          pump: state({ auth: "required" }),
        },
      },
    });
    const pv = deriveBenefitsPreview(p, TODAY);
    expect(pv.skipProducts).toEqual(["Insulin Pump"]);
    expect(pv.stage).toBe("Submit Auth.");
  });

  it("skip products contribute nothing to next-order dates (spec §1)", () => {
    const p = makePatient({
      serving: "Insulin Pump",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          // date entered BEFORE auth flipped to Required — must be ignored
          pump: state({ auth: "required", sosEntry: "billed", lastBillDate: "2020-01-01", units: "1" }),
          "infusion-sets": state({ auth: "not-required", sosEntry: "billed", lastBillDate: "2026-06-01", units: "4" }),
          cartridges: state({ auth: "not-required", sosEntry: "never" }),
        },
      },
    });
    const pv = deriveBenefitsPreview(p, TODAY);
    expect(pv.nextOrder.ip).toBe("");
    expect(pv.nextOrder.supplies).toBe("2026-08-30"); // +90d from 2026-06-01
  });

  it("failed universal check → Stuck, escalation, stage held", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "not-confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          "cgm-monitor": state({ auth: "not-required", sosEntry: "never" }),
          "cgm-sensors": state({ auth: "not-required", sosEntry: "never" }),
        },
      },
    });
    const pv = deriveBenefitsPreview(p, TODAY);
    expect(pv.activeNetwork).toBe("Stuck");
    expect(pv.escalation).toBe("Escalation Required");
    expect(pv.stage).toBe("Benefits / SoS");
  });
});
