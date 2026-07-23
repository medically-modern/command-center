import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  anyUniversalNegative,
  appendCallLog,
  composeCallLogLines,
  composeEscalationReason,
  deriveBenefitsPreview,
  deriveNeverBilled,
  derivedSos,
  failedUniversalChecks,
  isBlankCallRow,
  isValidUnits,
  patientHasMedicaidIns,
  sosCutoffYmd,
  sosEntryComplete,
  sosLookbackDays,
  validateBenefitsFactsForSubmit,
} from "./benefitsDerive";
import type { InsuranceState, Patient, ProductCodeState } from "./workflow";
import {
  EMPTY_INSURANCE,
  computeNextOrderDates,
  isNegUniversal,
  sensorsNextOrderOffsetDays,
} from "./workflow";

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

describe("failed-check gating (Medicare-not-Primary handoff §2–§3)", () => {
  it("isNegUniversal: not-confirmed and medicare-not-primary are negative", () => {
    expect(isNegUniversal("not-confirmed")).toBe(true);
    expect(isNegUniversal("medicare-not-primary")).toBe(true);
    expect(isNegUniversal("confirmed")).toBe(false);
    expect(isNegUniversal("")).toBe(false);
    expect(isNegUniversal(undefined)).toBe(false);
  });

  it("a negative check skips ALL per-product validation — only the 3 checks are required", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "not-confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        // step 2 untouched — products would normally be listed as missing
      },
    });
    expect(validateBenefitsFactsForSubmit(p)).toEqual([]);
  });

  it("medicare-not-primary behaves identically for submit gating", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Medicare A&B",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "medicare-not-primary", active: "confirmed", "dme-benefits": "confirmed" },
      },
    });
    expect(validateBenefitsFactsForSubmit(p)).toEqual([]);
  });

  it("unanswered checks still block on the failed-check path", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Medicare A&B",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "medicare-not-primary", active: "", "dme-benefits": "confirmed" },
      },
    });
    expect(validateBenefitsFactsForSubmit(p)).toEqual(["Insurance Active"]);
  });

  it("failedUniversalChecks labels the banner in check order", () => {
    const ins: InsuranceState = {
      ...structuredClone(EMPTY_INSURANCE),
      universal: { "in-network": "medicare-not-primary", active: "not-confirmed", "dme-benefits": "not-confirmed" },
    };
    expect(failedUniversalChecks(ins)).toEqual(["Medicare not Primary", "Not Active", "Not Covered"]);
    const oon: InsuranceState = {
      ...structuredClone(EMPTY_INSURANCE),
      universal: { "in-network": "not-confirmed", active: "confirmed", "dme-benefits": "confirmed" },
    };
    expect(failedUniversalChecks(oon)).toEqual(["Out-of-Network"]);
    expect(anyUniversalNegative(oon)).toBe(true);
    expect(anyUniversalNegative(structuredClone(EMPTY_INSURANCE))).toBe(false);
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
      "[2026-07-13] Benefits call · ref 4821-A: spoke with payer",
      "[2026-07-13] Benefits call: note only",
      "[2026-07-13] Benefits call · ref REF-2",
    ]);
  });
  it("tags section-2 rows as SoS/auth calls", () => {
    expect(composeCallLogLines([{ ref: "1", note: "x" }], "sos-auth", "2026-07-13")).toEqual([
      "[2026-07-13] SoS/auth call · ref 1: x",
    ]);
  });
  it("appends onto existing history without overwriting", () => {
    expect(appendCallLog("old line", ["new line"])).toBe("old line\nnew line");
    expect(appendCallLog("", ["a", "b"])).toBe("a\nb");
    expect(appendCallLog(null, [])).toBe("");
  });
  it("skips lines already in the history (double-send protection)", () => {
    const line = "[Benefits call · ref 1 · 2026-07-16] spoke with payer";
    const once = appendCallLog("", [line]);
    expect(appendCallLog(once, [line])).toBe(once); // re-send appends nothing
    expect(appendCallLog(once, [line, "new line"])).toBe(`${once}\nnew line`);
    // duplicates WITHIN one batch are kept
    expect(appendCallLog("", [line, line])).toBe(`${line}\n${line}`);
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
  it("Medicare not Primary gets its own reason line — distinguishable from Out-of-Network", () => {
    const ins: InsuranceState = {
      ...structuredClone(EMPTY_INSURANCE),
      universal: { "in-network": "medicare-not-primary", active: "confirmed", "dme-benefits": "confirmed" },
    };
    expect(composeEscalationReason(ins, "", undefined, "2026-07-20")).toBe(
      "[Auto-escalated · 2026-07-20] In-Network = Medicare not Primary",
    );
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
    expect(pv.escalation).toBe("Manager Escalation Required");
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

  describe("A4239 sensors next-order offset — 30/60 days for 1/2 units, standard 90 otherwise", () => {
    it("offset helper: 1 → 30, 2 → 60, 3+/blank/invalid → 90", () => {
      expect(sensorsNextOrderOffsetDays("1")).toBe(30);
      expect(sensorsNextOrderOffsetDays("2")).toBe(60);
      expect(sensorsNextOrderOffsetDays("3")).toBe(90);
      expect(sensorsNextOrderOffsetDays("12")).toBe(90);
      expect(sensorsNextOrderOffsetDays("")).toBe(90);
      expect(sensorsNextOrderOffsetDays(undefined)).toBe(90);
      expect(sensorsNextOrderOffsetDays("abc")).toBe(90);
    });

    const sensorsIns = (units: string): InsuranceState => ({
      ...structuredClone(EMPTY_INSURANCE),
      codes: {
        "cgm-sensors": state({ auth: "not-required", sosEntry: "billed", lastBillDate: "2026-04-11", units }),
      },
    });

    it("write path (computeNextOrderDates → Sensors Next Order Date column)", () => {
      expect(computeNextOrderDates(sensorsIns("1"), "Horizon BCBS", "").sensorsNextOrderDate).toBe("2026-05-11"); // +30d
      expect(computeNextOrderDates(sensorsIns("2"), "Horizon BCBS", "").sensorsNextOrderDate).toBe("2026-06-10"); // +60d
      expect(computeNextOrderDates(sensorsIns("3"), "Horizon BCBS", "").sensorsNextOrderDate).toBe("2026-07-10"); // +90d standard
      expect(computeNextOrderDates(sensorsIns(""), "Horizon BCBS", "").sensorsNextOrderDate).toBe("2026-07-10"); // blank units → 90
    });

    it("preview (drawer) stays in lockstep with the write path", () => {
      for (const [units, expected] of [
        ["1", "2026-05-11"],
        ["2", "2026-06-10"],
        ["3", "2026-07-10"],
      ] as const) {
        const p = makePatient({
          serving: "CGM",
          primaryInsurance: "Horizon BCBS",
          insurance: {
            ...structuredClone(EMPTY_INSURANCE),
            universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
            codes: {
              "cgm-monitor": state({ auth: "not-required", sosEntry: "never" }),
              "cgm-sensors": state({ auth: "not-required", sosEntry: "billed", lastBillDate: "2026-04-11", units }),
            },
          },
        });
        expect(deriveBenefitsPreview(p, TODAY).nextOrder.sensors).toBe(expected);
      }
    });

    it("units do NOT change the supplies offset — A4239 only", () => {
      const ins: InsuranceState = {
        ...structuredClone(EMPTY_INSURANCE),
        codes: {
          "infusion-sets": state({ auth: "not-required", sosEntry: "billed", lastBillDate: "2026-04-11", units: "1" }),
          cartridges: state({ auth: "not-required", sosEntry: "never" }),
        },
      };
      expect(computeNextOrderDates(ins, "Horizon BCBS", "").suppliesNextOrderDate).toBe("2026-07-10"); // still +90d
      expect(computeNextOrderDates(ins, "Fidelis Medicaid", "").suppliesNextOrderDate).toBe("2026-06-10"); // still +60d Medicaid
    });
  });

  it("failed universal check → Stuck, escalation, stage held, per-product output blanked", () => {
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
    expect(pv.escalation).toBe("Final Escalation Required");
    expect(pv.stage).toBe("Benefits / SoS");
    // handoff §4: step 2 never ran — the send leaves every per-product
    // column untouched, so the preview blanks them even when stale step-2
    // facts linger locally behind the gate.
    expect(pv.gated).toBe(true);
    expect(pv.auth).toBe("—");
    expect(pv.sos).toBe("—");
    expect(pv.notClearProducts).toEqual([]);
    expect(pv.skipProducts).toEqual([]);
    expect(pv.nextOrder).toEqual({ ip: "", sensors: "", supplies: "" });
    expect(pv.neverBilled).toEqual({ isCar: false, cgm: false, pumpDateTbd: false });
    expect(pv.authResults.monitor).toBe("—");
    expect(pv.authResults.insulin_pump).toBe("—");
  });

  it("medicare-not-primary behaves exactly like Out-of-Network in the preview", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Medicare A&B",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "medicare-not-primary", active: "confirmed", "dme-benefits": "confirmed" },
      },
    });
    const pv = deriveBenefitsPreview(p, TODAY);
    expect(pv.gated).toBe(true);
    expect(pv.activeNetwork).toBe("Stuck");
    expect(pv.dmeBenefits).toBe("Yes");
    expect(pv.escalation).toBe("Final Escalation Required");
    expect(pv.stage).toBe("Benefits / SoS");
  });

  it("the all-affirmative path is not gated", () => {
    const p = makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: {
        ...structuredClone(EMPTY_INSURANCE),
        universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
        codes: {
          "cgm-monitor": state({ auth: "not-required", sosEntry: "never" }),
          "cgm-sensors": state({ auth: "not-required", sosEntry: "never" }),
        },
      },
    });
    expect(deriveBenefitsPreview(p, TODAY).gated).toBe(false);
  });
});
