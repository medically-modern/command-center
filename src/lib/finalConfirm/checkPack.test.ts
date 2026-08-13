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

import { runFinalChecks } from "./checkPack";
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

describe("checkPack — silence guards", () => {
  scenario("Clean profile", { primaryInsurance: "Anthem BCBS Commercial", address: "12 Cherry Ln, Albany, NY 12203", serving: "Insulin Pump + CGM", pumpType: "t:slim", cgmType: "Dexcom G7", requestType: "Insulin Pump + CGM", infusionSet1: 'AutoSoft XC 6 mm 23"', infusionSet1Index: 1, qtyInf1: "10", subscriptionType: "Sensors & Supplies", cgmTypeIndex: 6, cgmCoveragePath: "Insulin", ipCoveragePath: "1st Pump >6M Diagnosed", cgmAuthResult: "No Auth Needed", sensorsAuthResult: "No Auth Needed", ipAuthResult: "No Auth Needed", infusionSetAuthResult: "No Auth Needed", cartridgeAuthResult: "No Auth Needed", dob: "1990-01-01", phone: "5185551234", coInsurance: "20%", deductibleRemaining: "0", oopMaxRemaining: "1200", mrExpiryDate: "2027-06-01", secondaryInsurance: "None" }, [], ["C11_CGM_ONLY_MEDICAID", "C24_SET_INCOMPATIBLE", "C14_CGM_NOT_SERVING", "C15_SUBSCRIPTION_MISMATCH", "C1_HOST_STATE", "C22_ADDRESS_CAPS"]);

  it("a clean commercial profile produces no findings at all", () => {
    const clean: Partial<Patient> = { primaryInsurance: "Anthem BCBS Commercial", address: "12 Cherry Ln, Albany, NY 12203", serving: "Insulin Pump + CGM", pumpType: "t:slim", cgmType: "Dexcom G7", requestType: "Insulin Pump + CGM", infusionSet1: 'AutoSoft XC 6 mm 23"', infusionSet1Index: 1, qtyInf1: "10", subscriptionType: "Sensors & Supplies", cgmTypeIndex: 6, cgmCoveragePath: "Insulin", ipCoveragePath: "1st Pump >6M Diagnosed", cgmAuthResult: "No Auth Needed", sensorsAuthResult: "No Auth Needed", ipAuthResult: "No Auth Needed", infusionSetAuthResult: "No Auth Needed", cartridgeAuthResult: "No Auth Needed", dob: "1990-01-01", phone: "5185551234", coInsurance: "20%", deductibleRemaining: "0", oopMaxRemaining: "1200", mrExpiryDate: "2027-06-01", secondaryInsurance: "None", pos: "Home" };
    expect(runFinalChecks({ ...basePatient(), ...clean })).toEqual([]);
  });
});
