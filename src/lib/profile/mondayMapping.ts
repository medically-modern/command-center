import type { Patient } from "./workflow";
import { formatPhone } from "./workflow";
import type { MondayItem, MondayColumnValue } from "./mondayApi";
import { COL } from "./mondayApi";

/** Helper: get column text by ID, default to "" */
function col(item: MondayItem, colId: string): string {
  const cv = item.column_values.find((c: MondayColumnValue) => c.id === colId);
  return cv?.text ?? "";
}

/**
 * Convert a Monday board item into a Patient object.
 */
export function mondayItemToPatient(item: MondayItem): Patient {
  return {
    id: item.id,
    name: item.name,

    // Demographics
    dob: col(item, COL.dob),
    ptPhone: formatPhone(col(item, COL.ptPhone)),
    email: col(item, COL.email),
    gender: col(item, COL.gender),
    dateOfIntake: col(item, COL.dateOfIntake),
    patientAddress: col(item, COL.patientAddress),
    patientAddressLat: null,
    patientAddressLng: null,

    // Status
    alreadyInSystem: col(item, COL.alreadyInSystem),
    moveToOnboarding: col(item, COL.moveToOnboarding),

    // Stedi
    runStediEligibility: col(item, COL.runStediEligibility),
    stediEligibilityActive: col(item, COL.stediEligibilityActive),
    stediCoverageType: col(item, COL.stediCoverageType),
    stediPayerName: col(item, COL.stediPayerName),
    stediMedicareAdvantage: col(item, COL.stediMedicareAdvantage),
    stediMedicareAdvantageCarrier: col(item, COL.stediMedicareAdvantageCarrier),
    stediMedicareAdvantageMemberId: col(item, COL.stediMedicareAdvantageMemberId),
    stediQmb: col(item, COL.stediQmb),
    stediMedicareJurisdiction: col(item, COL.stediMedicareJurisdiction),
    stediMedicaidMltc: col(item, COL.stediMedicaidMltc),
    stediManagedMedicaid: col(item, COL.stediManagedMedicaid),
    stediInNetwork: col(item, COL.stediInNetwork),
    stediPriorAuthRequired: col(item, COL.stediPriorAuthRequired),
    stediCoinsurance: col(item, COL.stediCoinsurance),
    stediCopay: col(item, COL.stediCopay),
    stediIndividualDeductible: col(item, COL.stediIndividualDeductible),
    stediIndividualDeductibleRemaining: col(item, COL.stediIndividualDeductibleRemaining),
    stediFamilyDeductible: col(item, COL.stediFamilyDeductible),
    stediFamilyDeductibleRemaining: col(item, COL.stediFamilyDeductibleRemaining),
    stediIndividualOopMax: col(item, COL.stediIndividualOopMax),
    stediIndividualOopMaxRemaining: col(item, COL.stediIndividualOopMaxRemaining),
    stediFamilyOopMax: col(item, COL.stediFamilyOopMax),
    stediFamilyOopMaxRemaining: col(item, COL.stediFamilyOopMaxRemaining),
    stediPlanBeginDate: col(item, COL.stediPlanBeginDate),
    stediErrorDescription: col(item, COL.stediErrorDescription),
    stediSecondaryMedicaidId: col(item, COL.stediSecondaryMedicaidId),
    stediPlanName: col(item, COL.stediPlanName),

    // Insurance
    primaryInsurance: col(item, COL.primaryInsurance),
    generalInsurance: col(item, COL.generalInsurance),
    memberId1: col(item, COL.memberId1),
    memberId2: col(item, COL.memberId2),
    secondaryInsurance: col(item, COL.secondaryInsurance),

    // Working cost-sharing
    workingCoinsurance: col(item, COL.workingCoinsurance),
    workingDeductible: col(item, COL.workingDeductible),
    workingDeductibleRemaining: col(item, COL.workingDeductibleRemaining),
    workingOopMax: col(item, COL.workingOopMax),
    workingOopMaxRemaining: col(item, COL.workingOopMaxRemaining),

    // Doctor
    doctorStatus: col(item, COL.doctorStatus),
    doctorName: col(item, COL.doctorName),
    doctorPhone: col(item, COL.doctorPhone),
    doctorNpi: col(item, COL.doctorNpi),
    clinicalsMethod: col(item, COL.clinicalsMethod),
    doctorEmail: col(item, COL.doctorEmail),
    doctorFax: col(item, COL.doctorFax),
    clinicName: col(item, COL.clinicName),
    clinicAddress: col(item, COL.clinicAddress),
    clinicAddressLat: null,
    clinicAddressLng: null,

    // Serving / Product
    referralType: col(item, COL.referralType),
    referralSource: col(item, COL.referralSource),
    pumpType: col(item, COL.pumpType),
    cgmType: col(item, COL.cgmType),
    requestType: col(item, COL.requestType),
    cgmCrossSell: col(item, COL.cgmCrossSell),
    serving: col(item, COL.serving),
    insulinPumpCoveragePath: col(item, COL.insulinPumpCoveragePath),
    cgmCoveragePath: col(item, COL.cgmCoveragePath),
  };
}

// ── Status index maps (for writing) ──

export const PRIMARY_INSURANCE_INDEX: Record<string, number> = {
  "Fidelis Medicaid": 0, "Fidelis Low-Cost": 1, "Medicare A&B": 2, "NYSHIP": 3,
  "United Commercial": 4, "United Medicare": 6, "United Medicaid": 7,
  "Aetna Commercial": 8, "Aetna Medicare": 9, "Wellcare": 10, "Humana": 11,
  "Cigna": 12, "Medicaid": 13, "Midlands Choice": 14, "Horizon BCBS": 15,
  "BCBS TN": 16, "BCBS FL": 17, "BCBS WY": 18, "MagnaCare": 19,
  "Oregon Care": 101, "UMR": 102, "Anthem BCBS Medicaid (JLJ)": 103,
  "Fidelis Commercial": 104, "Anthem BCBS Commercial": 105,
  "Anthem BCBS Medicare": 106, "Stedi": 107, "Anthem BCBS Low-Cost (JLJ)": 108,
  "United Low-Cost": 109, "Fidelis Medicare": 110,
};

export const GENERAL_INSURANCE_INDEX: Record<string, number> = {
  "Anthem BCBS": 0, "Aetna": 1, "Cigna": 2, "Fidelis": 3, "Medicare A&B": 4,
  "Medicaid": 6, "NYSHIP Empire": 7, "UMR": 8, "Wellcare": 9,
  "United Healthcare": 10, "Humana": 11, "MagnaCare": 12, "Midlands Choice": 13,
  "Stedi": 14, "Horizon BCBS": 15,
};

export const SECONDARY_INSURANCE_INDEX: Record<string, number> = {
  "NY Medicaid": 0, "Done": 1, "Stuck": 2, "None": 3,
};

export const DOCTOR_STATUS_INDEX: Record<string, number> = {
  "New": 0, "Existing": 1, "Failed Search": 2,
};

export const CLINICALS_METHOD_INDEX: Record<string, number> = {
  "Fax": 0, "Parachute": 1, "Email": 2,
};

export const REFERRAL_TYPE_INDEX: Record<string, number> = {
  "Manufacturer": 0, "Payor": 1, "Patient": 2, "Doctor": 3, "Advocacy Group": 7,
};

export const REFERRAL_SOURCE_INDEX: Record<string, number> = {
  "Patient": 0, "Tandem": 1, "Beta Bionics": 2, "CareCentrix": 3, "Doctor": 4,
  "Solace Advocates": 7,
};

export const PUMP_TYPE_INDEX: Record<string, number> = {
  "iLet": 0, "Mobi": 1, "t:slim": 2, "Not Serving": 3, "Minimed 780G": 4,
};

export const CGM_TYPE_INDEX: Record<string, number> = {
  "FreeStyle Libre 14-Day": 0, "Guardian 4": 1, "Instinct": 2,
  "FreeStyle Libre 3 Plus": 3, "FreeStyle Libre 2 Plus": 4,
  "Dexcom G7": 6, "Dexcom G7 15-Day": 7, "Dexcom G6": 8, "Not Serving": 9,
};

export const REQUEST_TYPE_INDEX: Record<string, number> = {
  "Insulin Pump": 0, "Supplies Only": 1, "CGM": 2, "Insulin Pump + CGM": 3, "Supplies + CGM": 4,
};

export const CGM_CROSS_SELL_INDEX: Record<string, number> = {
  "Evaluate": 0, "Cross-Sell": 1, "Couldn't Cross-Sell": 2, "Already Serving CGM": 4,
};

export const SERVING_INDEX: Record<string, number> = {
  "Insulin Pump": 0, "Supplies Only": 1, "CGM": 2, "Insulin Pump + CGM": 3, "Supplies + CGM": 4,
};

export const INSULIN_PUMP_COVERAGE_PATH_INDEX: Record<string, number> = {
  "Not Serving": 0, "IW New Insurance": 1, "Omnipod Switch": 2, "OOW Pump": 3,
  "1st Pump >6M Diagnosed": 4, "1st Pump <6M Diagnosed": 6, "Supplies Only": 7,
};

export const CGM_COVERAGE_PATH_INDEX: Record<string, number> = {
  "Insulin": 0, "Hypoglycemia": 1, "Not Serving": 2,
};

export const GENDER_INDEX: Record<string, number> = {
  "Male": 0, "Female": 1, "Unknown": 4,
};

export const RUN_STEDI_INDEX: Record<string, number> = {
  "Failed": 0, "Run": 1,
};

export const ALREADY_IN_SYSTEM_INDEX: Record<string, number> = {
  "Yes": 0, "No": 1,
};

export const MOVE_TO_ONBOARDING_INDEX: Record<string, number> = {
  "Already Serving": 0, "Advance to MN": 1, "Send Back To Referral": 2, "Need More Info.": 3,
};

/**
 * Group Primary Insurance labels into carrier-based sections for the
 * grouped dropdown on the Stedi tab. Empty groups are filtered out.
 */
export function groupPrimaryInsuranceLabels(): { group: string; labels: string[] }[] {
  const labels = Object.keys(PRIMARY_INSURANCE_INDEX);
  const groups: Record<string, string[]> = {
    "Fidelis": [],
    "Anthem / BCBS": [],
    "United": [],
    "Aetna": [],
    "Medicare / Medicaid": [],
    "Other": [],
  };
  for (const label of labels) {
    if (label.startsWith("Fidelis")) groups["Fidelis"].push(label);
    else if (label.startsWith("Anthem BCBS") || label === "Horizon BCBS" || label.startsWith("BCBS ")) {
      groups["Anthem / BCBS"].push(label);
    }
    else if (label.startsWith("United")) groups["United"].push(label);
    else if (label.startsWith("Aetna")) groups["Aetna"].push(label);
    else if (label === "Medicare A&B" || label === "Medicaid") groups["Medicare / Medicaid"].push(label);
    else groups["Other"].push(label);
  }
  return Object.entries(groups)
    .filter(([, vals]) => vals.length > 0)
    .map(([group, ls]) => ({ group, labels: ls.sort() }));
}

