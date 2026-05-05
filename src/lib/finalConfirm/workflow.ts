/**
 * Final Profile Confirmation — Data Model & Validation
 */

export interface Patient {
  id: string;
  name: string;

  // Demographics
  dob: string;
  phone: string;
  email: string;
  address: string;
  gender: string;
  genderIndex: number | null;

  // Insurance
  primaryInsurance: string;
  primaryInsuranceIndex: number | null;
  memberId1: string;
  secondaryInsurance: string;
  secondaryInsuranceIndex: number | null;
  secondaryInsuranceEdited: string | null;
  memberId2: string;
  memberId2Edited: string | null;
  deductible: string;
  deductibleRemaining: string;
  oopMax: string;
  oopMaxRemaining: string;

  // Doctor
  doctorName: string;
  doctorNpi: string;
  doctorPhone: string;
  doctorEmail: string;
  doctorFax: string;
  clinicName: string;
  clinicalsMethod: string;
  clinicalsMethodIndex: number | null;

  // Medical Necessity
  diagnosis: string;
  diagnosisIndex: number | null;
  cgmCoveragePath: string;
  cgmCoveragePathIndex: number | null;
  ipCoveragePath: string;
  ipCoveragePathIndex: number | null;
  mrExpiryDate: string;

  // Product / Referral
  serving: string;
  servingIndex: number | null;
  pumpType: string;
  pumpTypeIndex: number | null;
  cgmType: string;
  cgmTypeIndex: number | null;
  requestType: string;
  requestTypeIndex: number | null;
  referralType: string;
  referralTypeIndex: number | null;
  referralSource: string;
  referralSourceIndex: number | null;

  // Welcome Call / Order
  subscriptionType: string;
  subscriptionTypeIndex: number | null;
  infusionSet1: string;
  infusionSet1Index: number | null;
  qtyInf1: string;
  infusionSet2: string;
  infusionSet2Index: number | null;
  qtyInf2: string;
  monitorQty: string;
  pumpQty: string;
  orderHandling: string;
  orderHandlingIndex: number | null;

  // Auth Results
  cgmAuthResult: string;
  cgmAuthResultIndex: number | null;
  sensorsAuthResult: string;
  sensorsAuthResultIndex: number | null;
  ipAuthResult: string;
  ipAuthResultIndex: number | null;
  infusionSetAuthResult: string;
  infusionSetAuthResultIndex: number | null;
  cartridgeAuthResult: string;
  cartridgeAuthResultIndex: number | null;

  // Notes
  notes: string;

  // Editable overrides
  addressEdited: string | null;
  addressLat: number | null;
  addressLng: number | null;
  emailEdited: string | null;
  phoneEdited: string | null;

  // Escalation
  escalated: boolean;

  // Metadata
  receivedAt: string;
  lastUpdated: string;
}

/* ─── Status dropdown options (from Monday column settings) ─── */

export const GENDER_OPTIONS = [
  { index: 0, label: "Male" },
  { index: 1, label: "Female" },
];

export const PRIMARY_INSURANCE_OPTIONS = [
  { index: 0, label: "BCBS TN" },
  { index: 1, label: "BCBS FL" },
  { index: 2, label: "BCBS WY" },
  { index: 3, label: "MagnaCare" },
  { index: 4, label: "Oregon Care" },
  { index: 6, label: "UMR" },
  { index: 7, label: "United Healthcare Commercial" },
  { index: 8, label: "Medicare A&B" },
  { index: 9, label: "NYSHIP" },
  { index: 10, label: "United Commercial" },
  { index: 11, label: "United Medicare" },
  { index: 12, label: "United Medicaid" },
  { index: 13, label: "Aetna Commercial" },
  { index: 14, label: "Aetna Medicare" },
  { index: 15, label: "Wellcare" },
  { index: 16, label: "Humana" },
  { index: 17, label: "Cigna" },
  { index: 18, label: "Medicaid" },
  { index: 19, label: "Midlands Choice" },
  { index: 101, label: "Horizon BCBS" },
  { index: 102, label: "Fidelis Low-Cost" },
  { index: 103, label: "Fidelis Medicaid" },
  { index: 104, label: "Anthem BCBS Medicaid (JLJ)" },
  { index: 105, label: "Anthem BCBS Commercial" },
  { index: 106, label: "Anthem BCBS Medicare" },
  { index: 107, label: "Fidelis Commercial" },
  { index: 109, label: "Anthem BCBS Low-Cost (JLJ)" },
  { index: 110, label: "Fidelis CHP" },
];

export const SECONDARY_INSURANCE_OPTIONS = [
  { index: 0, label: "None" },
  { index: 1, label: "NY Medicaid" },
  { index: 2, label: "Medicare Supplement" },
];

export const SERVING_OPTIONS = [
  { index: 0, label: "Insulin Pump" },
  { index: 1, label: "Supplies Only" },
  { index: 2, label: "CGM" },
  { index: 3, label: "Insulin Pump + CGM" },
  { index: 4, label: "Supplies + CGM" },
];

export const PUMP_TYPE_OPTIONS = [
  { index: 0, label: "iLet" },
  { index: 1, label: "Mobi" },
  { index: 2, label: "t:slim" },
  { index: 3, label: "Not Serving" },
  { index: 4, label: "Minimed 780G" },
];

export const CGM_TYPE_OPTIONS = [
  { index: 0, label: "FreeStyle Libre 14-Day" },
  { index: 1, label: "Guardian 4" },
  { index: 2, label: "Instinct" },
  { index: 3, label: "FreeStyle Libre 3 Plus" },
  { index: 4, label: "FreeStyle Libre 2 Plus" },
  { index: 6, label: "Dexcom G7" },
  { index: 7, label: "Dexcom G7 15-Day" },
  { index: 8, label: "Dexcom G6" },
  { index: 9, label: "Not Serving" },
];

export const REQUEST_TYPE_OPTIONS = [
  { index: 0, label: "Insulin Pump" },
  { index: 1, label: "Supplies Only" },
  { index: 2, label: "CGM" },
  { index: 3, label: "Insulin Pump + CGM" },
  { index: 4, label: "Supplies + CGM" },
];

export const DIAGNOSIS_OPTIONS = [
  { index: 0, label: "E08.43" },
  { index: 1, label: "E10.10" },
  { index: 2, label: "E10.22" },
  { index: 3, label: "E10.29" },
  { index: 4, label: "E10.3559" },
  { index: 6, label: "E10.42" },
  { index: 7, label: "E10.649" },
  { index: 8, label: "E10.65" },
  { index: 9, label: "E10.69" },
  { index: 10, label: "E10.8" },
  { index: 11, label: "E10.9" },
  { index: 12, label: "E11.21" },
  { index: 13, label: "E11.22" },
  { index: 14, label: "E11.3292" },
  { index: 15, label: "E11.40" },
  { index: 16, label: "E11.42" },
  { index: 17, label: "E11.45" },
  { index: 18, label: "E11.59" },
  { index: 19, label: "E11.65" },
  { index: 101, label: "E11.69" },
  { index: 102, label: "E11.8" },
  { index: 103, label: "E11.9" },
  { index: 104, label: "E13.65" },
  { index: 105, label: "E13.9" },
  { index: 106, label: "O24.111" },
  { index: 107, label: "Evaluate" },
  { index: 108, label: "Collect" },
  { index: 109, label: "E10.3393" },
  { index: 110, label: "E024.414" },
  { index: 151, label: "E11.64" },
  { index: 152, label: "E10.311" },
  { index: 153, label: "E11.649" },
  { index: 154, label: "E11.29" },
];

export const CGM_COVERAGE_PATH_OPTIONS = [
  { index: 0, label: "Hypo" },
  { index: 1, label: "Insulin" },
  { index: 2, label: "Not Serving" },
];

export const IP_COVERAGE_PATH_OPTIONS = [
  { index: 0, label: "Omnipod Switch" },
  { index: 1, label: "IW New Insurance" },
  { index: 2, label: "OOW Pump" },
  { index: 3, label: "1st Pump >6M Diagnosed" },
  { index: 4, label: "1st Pump <6M Diagnosed" },
  { index: 6, label: "Supplies Only" },
  { index: 7, label: "Not Serving" },
];

export const CLINICALS_METHOD_OPTIONS = [
  { index: 0, label: "Fax" },
  { index: 1, label: "Parachute" },
  { index: 2, label: "Email" },
];

export const REFERRAL_TYPE_OPTIONS = [
  { index: 0, label: "Manufacturer" },
  { index: 1, label: "Payor" },
  { index: 2, label: "Patient" },
  { index: 3, label: "Doctor" },
  { index: 4, label: "Advocacy Group" },
];

export const REFERRAL_SOURCE_OPTIONS = [
  { index: 0, label: "Patient" },
  { index: 1, label: "Tandem" },
  { index: 2, label: "Beta Bionics" },
  { index: 3, label: "CareCentrix" },
  { index: 4, label: "Doctor" },
  { index: 6, label: "Solace Advocates" },
];

export const INFUSION_SET_1_OPTIONS = [
  { index: 0, label: 'AutoSoft XC 6mm 23"' },
  { index: 1, label: 'AutoSoft XC 6mm 32"' },
  { index: 2, label: 'AutoSoft XC 6mm 43"' },
  { index: 3, label: 'AutoSoft XC 9mm 23"' },
  { index: 4, label: 'AutoSoft 30 13mm 23"' },
  { index: 6, label: 'TruSteel 6mm 23"' },
  { index: 7, label: 'TruSteel 6mm 32"' },
  { index: 8, label: 'TruSteel 8mm 23"' },
  { index: 9, label: 'TruSteel 8mm 32"' },
  { index: 10, label: 'VariSoft 13mm 23"' },
  { index: 11, label: 'VariSoft 13mm 32"' },
  { index: 12, label: 'VariSoft 17mm 23"' },
  { index: 13, label: 'Contact 6mm 23"' },
  { index: 14, label: 'Inset 6mm 23"' },
  { index: 15, label: 'AutoSoft XC 6mm 5"' },
  { index: 16, label: 'AutoSoft 90 6mm 23"' },
  { index: 17, label: 'AutoSoft 90 6mm 43"' },
  { index: 18, label: 'AutoSoft 90 9mm 23"' },
  { index: 19, label: 'AutoSoft 90 9mm 43"' },
  { index: 101, label: "Not Serving" },
  { index: 102, label: 'Mio Advance Clear 9mm 23"' },
];

export const INFUSION_SET_2_OPTIONS = [
  { index: 0, label: 'AutoSoft 90 6mm 23"' },
  { index: 1, label: 'AutoSoft XC 6mm 23"' },
  { index: 2, label: 'AutoSoft 90 6mm 43"' },
  { index: 3, label: 'AutoSoft 90 9mm 23"' },
  { index: 4, label: 'AutoSoft 90 9mm 43"' },
  { index: 6, label: 'AutoSoft XC 6mm 5"' },
  { index: 7, label: 'AutoSoft XC 6mm 32"' },
  { index: 8, label: 'AutoSoft XC 6mm 43"' },
  { index: 9, label: 'AutoSoft XC 9mm 23"' },
  { index: 10, label: 'AutoSoft 30 13mm 23"' },
  { index: 11, label: 'TruSteel 6mm 23"' },
  { index: 12, label: 'TruSteel 6mm 32"' },
  { index: 13, label: 'TruSteel 8mm 23"' },
  { index: 14, label: 'TruSteel 8mm 32"' },
  { index: 15, label: 'VariSoft 13mm 23"' },
  { index: 16, label: 'VariSoft 13mm 32"' },
  { index: 17, label: 'VariSoft 17mm 23"' },
  { index: 18, label: 'Contact 6mm 23"' },
  { index: 19, label: 'Inset 6mm 23"' },
  { index: 101, label: "Not Serving" },
];

export const SUBSCRIPTION_TYPE_OPTIONS = [
  { index: 0, label: "Sensors" },
  { index: 1, label: "Sensors & Supplies" },
  { index: 2, label: "Supplies" },
];

export const ORDER_HANDLING_OPTIONS = [
  { index: 0, label: "Separate" },
  { index: 1, label: "Together" },
  { index: 2, label: "Not Applicable" },
];

export const AUTH_RESULT_OPTIONS = [
  { index: 0, label: "Evaluate" },
  { index: 1, label: "Auth Valid" },
  { index: 2, label: "Denied" },
  { index: 3, label: "No Auth Needed" },
  { index: 4, label: "Submitted" },
  { index: 6, label: "Required" },
  { index: 7, label: "Not Serving" },
];

/* ─── Helpers ─── */

export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

/* ─── Validation ─── */

/** No fields are required — user can send at any time */
export function validatePatientForSend(_p: Patient): { valid: boolean; errors: string[] } {
  return { valid: true, errors: [] };
}
