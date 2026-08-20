/**
 * Check-pack scenario suite.
 *
 * Converted from Brandon's standalone console harness (`checkPack.scenarios.ts`
 * in the 2026-08-03 package) so CI actually runs it — the harness printed PASS
 * lines nothing was watching. Same 25 cases, same names, same expectations, so
 * it still lines up finding-for-finding with `check-pack-playground.html`.
 *
 * The two SILENCE guards matter as much as the fires: "Split suppression" and
 * "Clean profile" must stay at zero. A check pack that cries wolf gets ignored,
 * and then the reds get ignored too.
 */
import { describe, it, expect } from "vitest";

import { runFinalChecks, droppedProducts } from "./checkPack";
import type { Patient } from "./workflow";

/** Every string field "", every index/nullable null, booleans false. */
export const basePatient = (): Patient => {
  const p = {} as Record<string, unknown>;
  const strings = [
    "id", "name", "dob", "phone", "email", "address", "gender",
    "primaryInsurance", "memberId1", "secondaryInsurance", "memberId2", "planName",
    "deductible", "deductibleRemaining", "coInsurance", "oopMax", "oopMaxRemaining",
    "doctorName", "doctorNpi", "doctorPhone", "doctorEmail", "doctorFax",
    "clinicName", "clinicalsMethod", "clinicAddress",
    "diagnosis", "cgmCoveragePath", "ipCoveragePath", "mrExpiryDate",
    "serving", "pumpType", "cgmType", "requestType", "referralType", "referralSource",
    "carecentrixIntakeId", "subscriptionType", "infusionSet1", "qtyInf1",
    "infusionSet2", "qtyInf2", "qtyCartridge", "monitorQty", "pumpQty",
    "medicarePriorPumpDate", "monitorPurchaseDate", "sosLastBillMonitor", "orderHandling", "pos",
    "sosMonitor", "sosSensors", "sosIp", "sosInfusionSet", "sosCartridge",
    "lastBillDateMonitor", "lastBillDateSensors", "lastBillDateIp",
    "lastBillDateInfusionSet", "lastBillDateCartridge",
    "nextOrderDateIp", "nextOrderDateSensors", "nextOrderDateSupplies",
    "cgmAuthResult", "sensorsAuthResult", "ipAuthResult", "infusionSetAuthResult",
    "cartridgeAuthResult",
    "monitorAuthId", "monitorAuthStart", "monitorAuthEnd", "monitorAuthUnits",
    "sensorsAuthId", "sensorsAuthStart", "sensorsAuthEnd", "sensorsAuthUnits",
    "ipAuthId", "ipAuthStart", "ipAuthEnd", "ipAuthUnits",
    "infusionSetAuthId", "infusionSetAuthStart", "infusionSetAuthEnd", "infusionSetAuthUnits",
    "cartridgeAuthId", "cartridgeAuthStart", "cartridgeAuthEnd", "cartridgeAuthUnits",
    "a4230Claim", "a4232Claim", "notes", "receivedAt", "lastUpdated", "dateOfStageStart",
  ];
  for (const s of strings) p[s] = "";
  const nullable = [
    "genderIndex", "primaryInsuranceIndex", "secondaryInsuranceIndex",
    "secondaryInsuranceEdited", "memberId2Edited", "clinicalsMethodIndex",
    "clinicAddressEdited", "clinicAddressLat", "clinicAddressLng", "diagnosisIndex",
    "cgmCoveragePathIndex", "ipCoveragePathIndex", "servingIndex", "pumpTypeIndex",
    "cgmTypeIndex", "requestTypeIndex", "referralTypeIndex", "referralSourceIndex",
    "subscriptionTypeIndex", "infusionSet1Index", "infusionSet2Index",
    "orderHandlingIndex", "posIndex",
    "addressEdited", "addressLat", "addressLng", "emailEdited", "phoneEdited",
  ];
  for (const n of nullable) p[n] = null;
  p.escalated = false;
  return p as unknown as Patient;
};

/** Assert a scenario fires `expected` and stays silent on `forbidden`. */
const scenario = (
  name: string,
  overrides: Partial<Patient>,
  expected: string[],
  forbidden: string[] = [],
) => {
  it(name, () => {
    const ids = runFinalChecks({ ...basePatient(), ...overrides }).map((f) => f.id);
    for (const e of expected) expect(ids, `${name} should fire ${e}`).toContain(e);
    for (const f of forbidden) expect(ids, `${name} must not fire ${f}`).not.toContain(f);
  });
};

describe("checkPack — insurance", () => {
  scenario("CGM-only Medicaid", { serving: "CGM", primaryInsurance: "Fidelis Medicaid", cgmType: "Dexcom G7", address: "12 Main St, Albany, NY 12203" }, ["C11_CGM_ONLY_MEDICAID"]);
  scenario("JLJ x CGM", { serving: "Insulin Pump + CGM", primaryInsurance: "Anthem BCBS Medicaid (JLJ)", cgmType: "Dexcom G7", pumpType: "t:slim", memberId1: "JLJ123456" }, ["C12_JLJ_NO_CGM"], ["C10_JLJ_PREFIX"]);
  scenario("NY Medicaid no MID2", { secondaryInsurance: "NY Medicaid" }, ["C3_MEDICAID_NO_MID2"]);
  scenario("Medicare no secondary", { primaryInsurance: "Medicare A&B", secondaryInsurance: "None" }, ["C5_MEDICARE_NO_SECONDARY"]);
  scenario("MA as Medicare", { primaryInsurance: "Medicare A&B", planName: "Wellcare Dual Liberty Sync", secondaryInsurance: "NY Medicaid", memberId2: "AB12345C" }, ["C6_MA_AS_MEDICARE"]);
  scenario("MLTC routing", { primaryInsurance: "Anthem BCBS Medicaid (JLJ)", planName: "Fidelis Care at Home MLTC" }, ["C9_MLTC_ROUTING"]);
  scenario("Horizon + TX", { primaryInsurance: "Horizon BCBS", address: "500 Oak Dr, Dallas, TX 75001" }, ["C1_LABEL_STATE_MISMATCH", "C23_POS_11"]);
  scenario("NJ host", { primaryInsurance: "Anthem BCBS Commercial", address: "9 Elm St, Newark, NJ 07102" }, ["C1_HOST_STATE"], ["C23_POS_11"]);
});

describe("checkPack — serving & product", () => {
  scenario("Split suppression", { serving: "Insulin Pump", orderHandling: "Separate", cgmType: "Not Serving", cgmCoveragePath: "Not Serving", pumpType: "t:slim", infusionSet1: 'AutoSoft XC 6 mm 23"', infusionSet1Index: 0, qtyInf1: "10", subscriptionType: "Supplies", address: "1 Main St, Albany, NY 12203" }, [], ["C14_CGM_NOT_SERVING", "C16_CGM_PATH", "C13_SERVING_VS_REQUEST"]);
  scenario("t:slim x Mio", { serving: "Insulin Pump", pumpType: "t:slim", infusionSet1: 'Mio Advance Clear 9mm 23"', infusionSet1Index: 102, qtyInf1: "10" }, ["C24_SET_INCOMPATIBLE"]);
  scenario("iLet x AutoSoft", { serving: "Insulin Pump", pumpType: "iLet", infusionSet1: 'AutoSoft XC 6 mm 23"', infusionSet1Index: 0, qtyInf1: "10" }, ["C24_SET_INCOMPATIBLE"]);
  scenario("iLet + Contact ok", { serving: "Insulin Pump", pumpType: "iLet", infusionSet1: 'Contact 6mm 23"', infusionSet1Index: 13, qtyInf1: "10" }, [], ["C24_SET_INCOMPATIBLE"]);
  // The 5" rule is one-way: 5" implies Mobi, Mobi does NOT imply 5". Both
  // tubing lengths on a Mobi are silent (Brandon, 2026-08-10).
  scenario("Mobi + 23in ok", { serving: "Insulin Pump", pumpType: "Mobi", infusionSet1: 'AutoSoft XC 6 mm 23"', infusionSet1Index: 0, qtyInf1: "10" }, [], ["C24_MOBI_TUBING", "C24_FIVE_INCH_NOT_MOBI", "C24_SET_INCOMPATIBLE"]);
  scenario("Mobi + 5in ok", { serving: "Insulin Pump", pumpType: "Mobi", infusionSet1: 'AutoSoft XC 6 mm 5"', infusionSet1Index: 15, qtyInf1: "10" }, [], ["C24_MOBI_TUBING", "C24_SET_INCOMPATIBLE"]);
  scenario("t:slim x 5in", { serving: "Insulin Pump", pumpType: "t:slim", infusionSet1: 'AutoSoft XC 6 mm 5"', infusionSet1Index: 15, qtyInf1: "10" }, ["C24_FIVE_INCH_NOT_MOBI"], ["C24_SET_INCOMPATIBLE"]);
  scenario("780G x 5in", { serving: "Insulin Pump", pumpType: "Minimed 780G", infusionSet1: 'AutoSoft XC 6 mm 5"', infusionSet1Index: 15, qtyInf1: "10" }, ["C24_SET_INCOMPATIBLE"]);
  scenario("Sub mismatch", { cgmTypeIndex: 6, cgmType: "Dexcom G7", serving: "CGM", subscriptionType: "Supplies", primaryInsurance: "Cigna" }, ["C15_SUBSCRIPTION_MISMATCH"]);
});

/**
 * C13 fires on a DROP, never on a cross-sell (Brandon, 2026-08-20).
 *
 * The old rule was `requestType !== serving`, which fired on the single most
 * ordinary outcome of the intake stage — a referral for one product leaving
 * with CGM added — and that noise is what got the check complained about. A
 * check pack that cries wolf gets ignored, and then the reds get ignored too.
 */
describe("checkPack — C13 serving vs request", () => {
  const C13 = "C13_SERVING_VS_REQUEST";

  // Brandon's own example, both ways round: adding a product is a cross-sell.
  scenario("Cross-sell CGM onto a pump referral", { requestType: "Insulin Pump", serving: "Insulin Pump + CGM" }, [], [C13]);
  scenario("Cross-sell CGM onto a supplies referral", { requestType: "Supplies Only", serving: "Supplies + CGM" }, [], [C13]);
  scenario("Cross-sell pump onto a CGM referral", { requestType: "CGM", serving: "Insulin Pump + CGM" }, [], [C13]);
  scenario("Unchanged", { requestType: "Insulin Pump + CGM", serving: "Insulin Pump + CGM" }, [], [C13]);

  // The two concerns Brandon named: a requested product we stopped serving.
  scenario("CGM dropped", { requestType: "Insulin Pump + CGM", serving: "Insulin Pump" }, [C13]);
  scenario("CGM referral served pump only", { requestType: "CGM", serving: "Insulin Pump" }, [C13]);
  scenario("Pump dropped", { requestType: "Insulin Pump", serving: "CGM" }, [C13]);
  scenario("Supplies dropped", { requestType: "Supplies + CGM", serving: "CGM" }, [C13]);

  // Blank either side is a missing input, not evidence of a drop.
  scenario("No request type", { requestType: "", serving: "CGM" }, [], [C13]);
  scenario("No serving", { requestType: "Insulin Pump", serving: "" }, [], [C13]);

  // Pump and supplies are ONE family per Brandon's rule — a demotion inside it
  // is silent. Pinned so the choice is deliberate, not an accident of the
  // `servingIncludesPump` substring test.
  scenario("Pump → supplies stays silent", { requestType: "Insulin Pump", serving: "Supplies Only" }, [], [C13]);
  scenario("Supplies → pump stays silent", { requestType: "Supplies Only", serving: "Insulin Pump" }, [], [C13]);

  it("names every dropped product, not just the first", () => {
    expect(droppedProducts("Insulin Pump + CGM", "")).toEqual([]);
    expect(droppedProducts("Insulin Pump + CGM", "Insulin Pump")).toEqual(["CGM"]);
    expect(droppedProducts("Insulin Pump + CGM", "CGM")).toEqual(["pump/supplies"]);
  });

  it("says WHICH product was dropped", () => {
    const f = runFinalChecks({ ...basePatient(), requestType: "Insulin Pump + CGM", serving: "Insulin Pump" })
      .find((x) => x.id === C13);
    expect(f?.detail).toContain("CGM is no longer being served");
  });
});

describe("checkPack — auth & demographics", () => {
  scenario("Auth expired", { serving: "Insulin Pump", pumpType: "t:slim", ipAuthResult: "Auth Valid", ipAuthId: "A1", ipAuthEnd: "2026-01-01" }, ["C18_AUTH_EXPIRED"]);
  scenario("Auth denied", { serving: "Insulin Pump", pumpType: "t:slim", ipAuthResult: "Denied" }, ["C17_AUTH_DENIED"]);
  scenario("Caps address", { address: "123 MAIN ST, ALBANY, NY 12203", addressEdited: null }, ["C22_ADDRESS_CAPS"]);
});

describe("checkPack — POS (C23)", () => {
  scenario("POS stale", { primaryInsurance: "Anthem BCBS Commercial", address: "500 Oak Dr, Dallas, TX 75001", pos: "Home" }, ["C23_POS_STALE"], ["C23_POS_11"]);
  scenario("POS correct", { primaryInsurance: "Anthem BCBS Commercial", address: "500 Oak Dr, Dallas, TX 75001", pos: "Office" }, [], ["C23_POS_STALE", "C23_POS_11"]);
  scenario("POS stale reverse", { primaryInsurance: "Anthem BCBS Commercial", address: "1 Main St, Albany, NY 12203", pos: "Office" }, ["C23_POS_STALE"]);
  scenario("POS info fallback", { primaryInsurance: "Horizon BCBS", address: "500 Oak Dr, Dallas, TX 75001" }, ["C23_POS_11"]);
});

describe("checkPack — C25/C26 Cardinal address format", () => {
  const GOOD_CLINIC = "9 Medical Park Dr, Albany, NY 12203";
  const run = (over: Partial<Patient>) => runFinalChecks({ ...basePatient(), ...over });
  const ids = (over: Partial<Patient>) => run(over).map((f) => f.id);

  // The rule itself is pinned in lib/shared/cardinalAddress.test.ts (the parity
  // suite against Cardinal-api). These cases pin the WIRING: which severity,
  // which field anchor, which value wins, and that a good address is silent.

  it("a malformed patient address is RED and carries the format hint", () => {
    const f = run({ address: "135 E 31st St New York, NY 10016", clinicAddress: GOOD_CLINIC })
      .find((x) => x.id === "C25_ADDRESS_FORMAT");
    expect(f?.severity).toBe("red");
    expect(f?.field).toBe("address");
    expect(f?.formatHint).toContain("Street + Apt/Suite on ONE line, City, ST ZIP");
    expect(f?.detail).toContain("comma");
  });

  it("a malformed CLINIC address is RED too — the second address on every order", () => {
    const f = run({ address: "12 Cherry Ln, Albany, NY 12203", clinicAddress: "Presbyterian Physicians Care, 1 Park Rd, Parkville, NY 11040" })
      .find((x) => x.id === "C26_CLINIC_ADDRESS_FORMAT");
    expect(f?.severity).toBe("red");
    expect(f?.field).toBe("clinicAddress");
    expect(f?.formatHint).toBeTruthy();
  });

  it("a blank address is AMBER, not red — missing input, not evidence of a wrong one", () => {
    expect(ids({ address: "12 Cherry Ln, Albany, NY 12203", clinicAddress: "" }))
      .toContain("C26_CLINIC_ADDRESS_MISSING");
    expect(run({ clinicAddress: "" }).find((f) => f.id === "C26_CLINIC_ADDRESS_MISSING")?.severity)
      .toBe("amber");
    expect(ids({ address: "", clinicAddress: GOOD_CLINIC })).toContain("C25_ADDRESS_MISSING");
  });

  it("a PO Box warns but never blocks (Cardinal ships it)", () => {
    const got = ids({ address: "278 Main Street, PO Box 562, Richmondville, NY 12149, US", clinicAddress: GOOD_CLINIC });
    expect(got).toContain("C25_ADDRESS_PO_BOX");
    expect(got).not.toContain("C25_ADDRESS_FORMAT");
    expect(run({ address: "278 Main Street, PO Box 562, Richmondville, NY 12149, US" })
      .find((f) => f.id === "C25_ADDRESS_PO_BOX")?.severity).toBe("amber");
  });

  it("a C/O line warns on the right field and stays out of the other one", () => {
    const got = ids({ address: "12 Cherry Ln, Albany, NY 12203", clinicAddress: "49 Hamilton Ave, C/O Billing Office, Auburn, NY 13021" });
    expect(got).toContain("C26_CLINIC_ADDRESS_EXTRA_SEGMENT");
    expect(got).not.toContain("C25_ADDRESS_EXTRA_SEGMENT");
  });

  it("the EDITED value is what gets checked — a rep's fix clears it without saving", () => {
    const broken = { address: "135 E 31st St New York, NY 10016", clinicAddress: "135 E 31st St New York, NY 10016" };
    expect(ids(broken)).toEqual(expect.arrayContaining(["C25_ADDRESS_FORMAT", "C26_CLINIC_ADDRESS_FORMAT"]));
    const fixed = ids({
      ...broken,
      addressEdited: "135 E 31st St, New York, NY 10016",
      clinicAddressEdited: GOOD_CLINIC,
    });
    expect(fixed).not.toContain("C25_ADDRESS_FORMAT");
    expect(fixed).not.toContain("C26_CLINIC_ADDRESS_FORMAT");
  });

  it("well-formed addresses are silent on both", () => {
    const got = ids({ address: "12 Cherry Ln, Albany, NY 12203", clinicAddress: GOOD_CLINIC });
    expect(got.filter((i) => i.startsWith("C25_") || i.startsWith("C26_"))).toEqual([]);
  });

  it("C22_ZIP_MISSING is retired — a missing ZIP is now C25, red, with the reason", () => {
    const got = run({ address: "49 Hamilton Avenue, Auburn, NY", clinicAddress: GOOD_CLINIC });
    expect(got.map((f) => f.id)).not.toContain("C22_ZIP_MISSING");
    const f = got.find((x) => x.id === "C25_ADDRESS_FORMAT");
    expect(f?.severity).toBe("red");
    expect(f?.detail).toContain("ZIP");
  });
});

describe("checkPack — silence guards", () => {
  // Both clean fixtures carry a CLINIC address as well as the patient's: C26
  // (added 2026-08-18) reads a blank clinic address as an amber, because
  // Cardinal validates doctorInfo.address on every order and blocks a blank
  // one at submit. "Clean" has to mean clean for the order too.
  scenario("Clean profile", { primaryInsurance: "Anthem BCBS Commercial", address: "12 Cherry Ln, Albany, NY 12203", clinicAddress: "9 Medical Park Dr, Albany, NY 12203", serving: "Insulin Pump + CGM", pumpType: "t:slim", cgmType: "Dexcom G7", requestType: "Insulin Pump + CGM", infusionSet1: 'AutoSoft XC 6 mm 23"', infusionSet1Index: 1, qtyInf1: "10", subscriptionType: "Sensors & Supplies", cgmTypeIndex: 6, cgmCoveragePath: "Insulin", ipCoveragePath: "1st Pump >6M Diagnosed", cgmAuthResult: "No Auth Needed", sensorsAuthResult: "No Auth Needed", ipAuthResult: "No Auth Needed", infusionSetAuthResult: "No Auth Needed", cartridgeAuthResult: "No Auth Needed", dob: "1990-01-01", phone: "5185551234", coInsurance: "20%", deductibleRemaining: "0", oopMaxRemaining: "1200", mrExpiryDate: "2027-06-01", secondaryInsurance: "None" }, [], ["C11_CGM_ONLY_MEDICAID", "C24_SET_INCOMPATIBLE", "C14_CGM_NOT_SERVING", "C15_SUBSCRIPTION_MISMATCH", "C1_HOST_STATE", "C22_ADDRESS_CAPS"]);

  it("a clean commercial profile produces no findings at all", () => {
    const clean: Partial<Patient> = { primaryInsurance: "Anthem BCBS Commercial", address: "12 Cherry Ln, Albany, NY 12203", clinicAddress: "9 Medical Park Dr, Albany, NY 12203", serving: "Insulin Pump + CGM", pumpType: "t:slim", cgmType: "Dexcom G7", requestType: "Insulin Pump + CGM", infusionSet1: 'AutoSoft XC 6 mm 23"', infusionSet1Index: 1, qtyInf1: "10", subscriptionType: "Sensors & Supplies", cgmTypeIndex: 6, cgmCoveragePath: "Insulin", ipCoveragePath: "1st Pump >6M Diagnosed", cgmAuthResult: "No Auth Needed", sensorsAuthResult: "No Auth Needed", ipAuthResult: "No Auth Needed", infusionSetAuthResult: "No Auth Needed", cartridgeAuthResult: "No Auth Needed", dob: "1990-01-01", phone: "5185551234", coInsurance: "20%", deductibleRemaining: "0", oopMaxRemaining: "1200", mrExpiryDate: "2027-06-01", secondaryInsurance: "None", pos: "Home" };
    expect(runFinalChecks({ ...basePatient(), ...clean })).toEqual([]);
  });
});
