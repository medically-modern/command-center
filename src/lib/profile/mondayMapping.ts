import type { Patient } from "./workflow";
import { formatPhone } from "./workflow";
import type { MondayItem, MondayColumnValue } from "./mondayApi";
import { COL } from "./mondayApi";
import { readEmailCell } from "../shared/emailCell";

/** Helper: get column text by ID, default to "" */
function col(item: MondayItem, colId: string): string {
  const cv = item.column_values.find((c: MondayColumnValue) => c.id === colId);
  return cv?.text ?? "";
}

/**
 * Asset IDs on a FILE column, comma-joined.
 *
 * A file column's `text` is a URL, and its `value` is
 * `{"files":[{"assetId":123,"name":"card.jpg",…}]}`. The ID is the only
 * reliable join to `fetchItemAssets` — matching on a name parsed out of the
 * URL works until a filename is re-encoded or duplicated, and matching on the
 * URL itself is worse: the column's `protected_static` link needs a Monday
 * session, where the asset's `public_url` is signed and just opens.
 */
function fileAssetIds(item: MondayItem, colId: string): string {
  const cv = item.column_values.find((c: MondayColumnValue) => c.id === colId);
  if (!cv?.value) return "";
  try {
    const parsed = JSON.parse(cv.value) as { files?: { assetId?: number | string }[] };
    return (parsed.files ?? [])
      .map((f) => String(f.assetId ?? "").trim())
      .filter(Boolean)
      .join(",");
  } catch {
    return "";
  }
}

/**
 * Convert a Monday board item into a Patient object.
 */
export function mondayItemToPatient(item: MondayItem): Patient {
  return {
    id: item.id,
    name: item.name,
    // Which board group the item is in. Already In System is a group as well as
    // a status column, and items land there with the column sometimes still
    // blank — so the queue split needs the group, not just the flag (§5.10).
    groupId: item.group?.id ?? "",

    // Demographics
    dob: col(item, COL.dob),
    ptPhone: formatPhone(col(item, COL.ptPhone)),
    email: col(item, COL.email),
    gender: col(item, COL.gender),
    dateOfIntake: col(item, COL.dateOfIntake),
    patientAddress: col(item, COL.patientAddress),
    patientAddressLat: null,
    patientAddressLng: null,

    // DTC intake form
    formReasonForInquiry: col(item, COL.formReasonForInquiry),
    formState: col(item, COL.formState),
    formDropOffStep: col(item, COL.formDropOffStep),
    formSessionId: col(item, COL.formSessionId),
    formPumpNeed: col(item, COL.formPumpNeed),
    formCgmPreference: col(item, COL.formCgmPreference),
    formPumpPreference: col(item, COL.formPumpPreference),
    formProvidedDoctorName: col(item, COL.formProvidedDoctorName),
    formProvidedClinicPhone: col(item, COL.formProvidedClinicPhone),
    // File columns. `text` on a Monday file column is the filename(s) — enough
    // to name the row; the UI matches it against the item's assets to get a
    // URL for the viewer. Read but unmapped until now, which is why the rep
    // could not see the card photo the patient uploaded.
    formCardPhoto: col(item, COL.formCardPhoto),
    cgmDataFile: col(item, COL.cgmDataFile),
    formCardPhotoIds: fileAssetIds(item, COL.formCardPhoto),
    cgmDataFileIds: fileAssetIds(item, COL.cgmDataFile),
    formInsuranceVia: col(item, COL.formInsuranceVia),
    formInsuranceOther: col(item, COL.formInsuranceOther),
    formSecondaryProvided: col(item, COL.formSecondaryProvided),
    formSecondaryMemberId: col(item, COL.formSecondaryMemberId),
    formProceedPreference: col(item, COL.formProceedPreference),
    formCallSlot: col(item, COL.formCallSlot),
    formBookingStatus: col(item, COL.formBookingStatus),
    scheduledCallTime: col(item, COL.scheduledCallTime),

    // Rep-entered on the intake call
    selfAdvocacy: col(item, COL.selfAdvocacy),
    currentOopCost: col(item, COL.currentOopCost),
    cgmDataAwareness: col(item, COL.cgmDataAwareness),
    attemptCounter: col(item, COL.attemptCounter),
    intakeCallComplete: col(item, COL.intakeCallComplete),
    intakeEscalation: col(item, COL.intakeEscalation),
    intakeSubStage: col(item, COL.intakeSubStage),
    dupCheckResult: col(item, COL.dupCheckResult),

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
    stediPrimaryPayer: col(item, COL.stediPrimaryPayer),
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
    stediGender: col(item, COL.stediGender),
    stediMedicaidId: col(item, COL.stediMedicaidId),
    stediHomePlan: col(item, COL.stediHomePlan),
    stediAddress: col(item, COL.stediAddress),
    stediFacilityFlags: col(item, COL.stediFacilityFlags),

    // Notes
    notes: col(item, COL.notes),

    // Follow Up
    followUp: col(item, COL.followUp),
    followUpDate: col(item, COL.followUpDate),

    // Insurance
    primaryInsurance: col(item, COL.primaryInsurance),
    generalInsurance: col(item, COL.generalInsurance),
    workingMemberId: col(item, COL.memberIdWorking),
    memberId1: col(item, COL.memberId1),
    memberId2: col(item, COL.memberId2),
    secondaryInsurance: col(item, COL.secondaryInsurance),

    // OOP estimate
    oopFirst: col(item, COL.oopFirst),
    oopRecurring: col(item, COL.oopRecurring),

    // Working cost-sharing
    workingCoinsurance: col(item, COL.workingCoinsurance),
    workingDeductible: col(item, COL.workingDeductible),
    workingDeductibleRemaining: col(item, COL.workingDeductibleRemaining),
    workingOopMax: col(item, COL.workingOopMax),
    workingOopMaxRemaining: col(item, COL.workingOopMaxRemaining),

    // Doctor
    doctorStatus: col(item, COL.doctorStatus),
    doctorName: col(item, COL.doctorName),
    doctorPhone: formatPhone(col(item, COL.doctorPhone)),
    doctorNpi: col(item, COL.doctorNpi),
    clinicalsMethod: col(item, COL.clinicalsMethod),
    // Email columns render as "<label> - <address>" when the two differ, so
    // col()'s display text is NOT an address. See shared/emailCell.ts.
    doctorEmail: readEmailCell(item.column_values.find((c) => c.id === COL.doctorEmail)),
    doctorFax: readEmailCell(item.column_values.find((c) => c.id === COL.doctorFax)),
    clinicName: col(item, COL.clinicName),
    clinicAddress: col(item, COL.clinicAddress),
    clinicAddressLat: null,
    clinicAddressLng: null,
    prescriberRequirements: col(item, COL.prescriberRequirements),

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
  // "Anthem / BCBS" replaced the old "Horizon BCBS" (15) and "Anthem BCBS"
  // labels — front-end rename only, still writes index 0 to the same
  // General Insurance column (Monday label 0 = "Anthem / BCBS").
  "Anthem / BCBS": 0, "Aetna": 1, "Cigna": 2, "Fidelis": 3, "Medicare A&B": 4,
  "Medicaid": 6, "NYSHIP Empire": 7, "UMR": 8, "Wellcare": 9,
  "United Healthcare": 10, "Humana": 11, "MagnaCare": 12, "Midlands Choice": 13,
  // "Stedi" (14) is our ELIGIBILITY VENDOR, not a payer — it was being offered
  // to reps as if it were a health plan (Katie, 2026-08-13). Index 15 is the
  // board's "Other" label (the slot the old "Horizon BCBS" was renamed into),
  // so this is a picker change only: no board edit, and no patient to migrate
  // — nothing on the board was set to Stedi when this was swapped.
  "Other": 15,
};

// Live board labels (checked 2026-07): 0=NY Medicaid, 1=Medicare Supplement, 3=None.
export const SECONDARY_INSURANCE_INDEX: Record<string, number> = {
  "NY Medicaid": 0, "Medicare Supplement": 1, "None": 3,
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

// Follow Up status indices
export const FOLLOW_UP_INDEX = {
  followUp: 1,
} as const;

/**
 * Intake Sub-Stage (`color_mm6ct431`) — the Info Collection / Profile Clean-Up
 * advancer.
 *
 * ⚠️ THESE ARE NOT 0 AND 1, and the reason is CLAUDE.md §5.12's: Monday assigns
 * a status index when the LABEL IS CREATED and picks its own slot, not the
 * display order you asked for. The column was created with the two labels in
 * this order and Monday returned `{"1":"Profile Clean-Up","7":"Info Collection"}`
 * — read back from `settings_str`, not assumed. Writing index 0 here would set
 * a label that does not exist.
 */
export const INTAKE_SUB_STAGE_INDEX: Record<string, number> = {
  "Info Collection": 7, "Profile Clean-Up": 1,
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

