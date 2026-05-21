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
  clinicAddress: string;
  clinicAddressEdited: string | null;
  clinicAddressLat: number | null;
  clinicAddressLng: number | null;

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
  carecentrixIntakeId: string;

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

  // SoS & Order Dates (per-product)
  sosMonitor: string;       // "Clear" | "Not Clear" | ""
  sosSensors: string;
  sosIp: string;
  sosInfusionSet: string;
  sosCartridge: string;
  lastBillDateMonitor: string;    // YYYY-MM-DD or ""
  lastBillDateSensors: string;
  lastBillDateIp: string;
  lastBillDateInfusionSet: string;
  lastBillDateCartridge: string;
  // Calculated next order dates (read-only display)
  nextOrderDateIp: string;
  nextOrderDateSensors: string;
  nextOrderDateSupplies: string;

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

  // Auth Details (read-only — ID, Start, End, Units per product)
  monitorAuthId: string;
  monitorAuthStart: string;
  monitorAuthEnd: string;
  monitorAuthUnits: string;
  sensorsAuthId: string;
  sensorsAuthStart: string;
  sensorsAuthEnd: string;
  sensorsAuthUnits: string;
  ipAuthId: string;
  ipAuthStart: string;
  ipAuthEnd: string;
  ipAuthUnits: string;
  infusionSetAuthId: string;
  infusionSetAuthStart: string;
  infusionSetAuthEnd: string;
  infusionSetAuthUnits: string;
  cartridgeAuthId: string;
  cartridgeAuthStart: string;
  cartridgeAuthEnd: string;
  cartridgeAuthUnits: string;

  // Claim Paid Amounts (read-only)
  a4230Claim: string;
  a4232Claim: string;

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

  // Transient session flag — true after Split Order has been run on this
  // profile. Used to flip the Split button into a "Split created" state.
  // Cleared on Send (via clearOverlay) and on refetch (default false).
  _splitCreated?: boolean;

  // Metadata
  receivedAt: string;
  lastUpdated: string;
  /** Date the current stage started (YYYY-MM-DD). Used to copy onto split
   *  duplicates so Days Since Stage Started matches the original. */
  dateOfStageStart: string;
}

/* ─── Status dropdown options (from Monday column settings) ─── */

export const GENDER_OPTIONS = [
  { index: 0, label: "Male" },
  { index: 1, label: "Female" },
  { index: 2, label: "Unknown" },
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
  { index: 108, label: "Fidelis Medicare" },
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
  { index: 0, label: 'AutoSoft XC 6 mm 23"' },
  { index: 1, label: 'AutoSoft XC 6 mm 32"' },
  { index: 2, label: 'AutoSoft XC 6 mm 43"' },
  { index: 3, label: 'AutoSoft XC 9 mm 23"' },
  { index: 4, label: 'AutoSoft 30 13 mm 23"' },
  { index: 6, label: 'TruSteel 6 mm 23"' },
  { index: 7, label: 'TruSteel 6 mm 32"' },
  { index: 8, label: 'TruSteel 8 mm 23"' },
  { index: 9, label: 'TruSteel 8 mm 32"' },
  { index: 10, label: 'VariSoft 13 mm 23"' },
  { index: 11, label: 'VariSoft 13 mm 32"' },
  { index: 12, label: 'VariSoft 17 mm 23"' },
  { index: 13, label: 'Contact 6mm 23"' },
  { index: 14, label: 'Inset 6mm 23"' },
  { index: 15, label: 'AutoSoft XC 6 mm 5"' },
  { index: 16, label: 'AutoSoft 90 6 mm 23"' },
  { index: 17, label: 'AutoSoft 90 6 mm 43"' },
  { index: 18, label: 'AutoSoft 90 9 mm 23"' },
  { index: 19, label: 'AutoSoft 90 9 mm 43"' },
  { index: 101, label: "Not Serving" },
  { index: 102, label: 'Mio Advance Clear 9mm 23"' },
];

export const INFUSION_SET_2_OPTIONS = [
  { index: 0, label: 'AutoSoft 90 6 mm 23"' },
  { index: 1, label: 'AutoSoft XC 6 mm 23"' },
  { index: 2, label: 'AutoSoft 90 6 mm 43"' },
  { index: 3, label: 'AutoSoft 90 9 mm 23"' },
  { index: 4, label: 'AutoSoft 90 9 mm 43"' },
  { index: 6, label: 'AutoSoft XC 6 mm 5"' },
  { index: 7, label: 'AutoSoft XC 6 mm 32"' },
  { index: 8, label: 'AutoSoft XC 6 mm 43"' },
  { index: 9, label: 'AutoSoft XC 9 mm 23"' },
  { index: 10, label: 'AutoSoft 30 13 mm 23"' },
  { index: 11, label: 'TruSteel 6 mm 23"' },
  { index: 12, label: 'TruSteel 6 mm 32"' },
  { index: 13, label: 'TruSteel 8 mm 23"' },
  { index: 14, label: 'TruSteel 8 mm 32"' },
  { index: 15, label: 'VariSoft 13 mm 23"' },
  { index: 16, label: 'VariSoft 13 mm 32"' },
  { index: 17, label: 'VariSoft 17 mm 23"' },
  { index: 18, label: 'Contact 6 mm 23"' },
  { index: 19, label: 'Inset 6 mm 23"' },
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

export const SOS_OPTIONS = [
  { index: 0, label: "Clear" },
  { index: 1, label: "Not Clear" },
];

/** Clinic Name is a dropdown column — these IDs come from the board settings,
 *  NOT from status index numbers. Used for writing back via writeDropdownIds. */
export const CLINIC_NAME_OPTIONS = [
  { id: 1, label: "SUNY Upstate Pediatric - Joslin Diabetes Center" },
  { id: 2, label: "LAKEWOOD MEDICAL ASSOCIATES" },
  { id: 3, label: "Joslin Pediatric Educators" },
  { id: 4, label: "SUNY Upstate Pediatric Joslin Diabetes Center" },
  { id: 5, label: "NYU PEDIATRIC DIABETES CENTER" },
  { id: 6, label: "Albany Med Health System - AMC 220 Washington Community Endocrinology" },
  { id: 7, label: "NewYork-Presbyterian - Weill Greenberg Center" },
  { id: 8, label: "Diabetes and Endocrine Associates of Bridgewater Update Facility" },
  { id: 9, label: "Guthrie Endocrinology" },
  { id: 10, label: "NewYork-Presbyterian - Naomi Berrie Diabetes Center" },
  { id: 11, label: "ST. PETER'S HEALTH PARTNERS - ALBANY OFFICE" },
  { id: 12, label: "Upstate Medical University" },
  { id: 13, label: "NYU Langone - ACGC Endo 3rd FL" },
  { id: 14, label: "SUNY Upstate Joslin Diabetes Center" },
  { id: 15, label: "AMHS- SHMG Endocrinology" },
  { id: 16, label: "The Office Don Zwickler, MD" },
  { id: 17, label: "NYU Langone Great Neck" },
  { id: 18, label: "UPMC" },
  { id: 19, label: "Children's Hospital at Montefiore" },
  { id: 20, label: "RRH Diabetes and Endocrinology - Ridgeway Update Facility" },
  { id: 21, label: "Catholic Health Ronkonkoma" },
  { id: 22, label: "Grandview Medical Group" },
  { id: 23, label: "Montefiore - Medical ArtsPavillion" },
  { id: 24, label: "Mount St Marys Health Center" },
  { id: 25, label: "RRH Diabetes and" },
  { id: 26, label: "Endocrinology -" },
  { id: 27, label: "Ridgeway" },
  { id: 28, label: "NYU Langone" },
  { id: 29, label: "Primary Care of Western New York" },
  { id: 30, label: "Metropolitan Hospital Endocrinology" },
  { id: 31, label: "CVPH Endocrinology" },
  { id: 32, label: "Edward Condon Medical" },
  { id: 33, label: "Albany Med Health  System - 22 New  Scotland Division of  Pediatric Endocrinology" },
  { id: 34, label: "Catholic Health Ambulatory Care at West Babylon" },
  { id: 35, label: "NYU Diabetes and Endocrinology Associates" },
  { id: 36, label: "OPTUM Fishkill Westage Endocrinology" },
  { id: 37, label: "Atlantic Medical Group Endocrinology" },
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

/** Convert YYYY-MM-DD → MM/DD/YYYY for display */
export function formatDateMDY(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/* ─── Validation ─── */

/** No fields are required — user can send at any time */
export function validatePatientForSend(_p: Patient): { valid: boolean; errors: string[] } {
  return { valid: true, errors: [] };
}

/* ─── Split Order Helpers ───────────────────────────────────────
 *
 * A patient becomes "split eligible" when their order can plausibly
 * ship in two distinct shipments — one for IP/supplies, one for CGM/
 * sensors. The user presses Split Order, we duplicate the Monday item,
 * and apply opposite "Not Serving" overrides to each copy.
 *
 * The two halves are: SUPPLIES side (IP + infusion sets + cartridges)
 * and SENSORS side (CGM monitor + sensors).
 */

export type SplitSide = "supplies" | "sensors";

/** Status index for "Not Serving" on each column that supports it. */
const NOT_SERVING_INDEX = {
  cgmCoveragePath: 2,
  ipCoveragePath: 7,
  pumpType: 3,
  cgmType: 9,
  infusionSet: 101,
  authResult: 7,
} as const;

const ORDER_HANDLING_SEPARATE = 0;
const SUBSCRIPTION_SENSORS = 0;
const SUBSCRIPTION_SUPPLIES = 2;
const SERVING_INSULIN_PUMP = 0;
const SERVING_SUPPLIES_ONLY = 1;
const SERVING_CGM = 2;

/**
 * Returns true when the patient's order can be split into two profiles.
 * Eligibility requires Supplies Next Order Date to differ from Sensors
 * Next Order Date (both must be populated).
 *
 * IP Next Order Date is not part of this check — IP is on a 4-year cycle and
 * always rides along on the supplies side after the split.
 *
 * After a split, the sensor-side dates on the supplies profile are cleared,
 * which fails the date-difference half of the rule and prevents re-splitting.
 */
export function isSplitEligible(p: Patient): boolean {
  const sup = p.nextOrderDateSupplies;
  const sen = p.nextOrderDateSensors;
  return !!sup && !!sen && sup !== sen;
}

/**
 * Determines which side keeps the original Monday item. Convention:
 * the side with the EARLIER next-order-date is the original (because
 * its order is happening sooner). If dates are equal/blank, default to
 * supplies as the original.
 */
export function determineOriginalSide(p: Patient): SplitSide {
  const sup = p.nextOrderDateSupplies;
  const sen = p.nextOrderDateSensors;
  if (sup && sen && sup !== sen) return sup < sen ? "supplies" : "sensors";
  return "supplies";
}

/**
 * Helpful label for the user describing the reason the button is enabled
 * (or disabled). Returned as a short hint to render below the button.
 */
export function describeSplitEligibility(p: Patient): string {
  const sup = p.nextOrderDateSupplies;
  const sen = p.nextOrderDateSensors;
  const datesDiffer = !!sup && !!sen && sup !== sen;

  if (datesDiffer) {
    return `Sensors (${formatDateMDY(sen)}) vs Supplies (${formatDateMDY(sup)}) next order dates differ — split is available.`;
  }
  if (!sup && !sen) {
    return "Both Sensors and Supplies next order dates must be set (and differ) to enable Split.";
  }
  if (!sup || !sen) {
    return "Both Sensors and Supplies next order dates must be populated to enable Split.";
  }
  // dates are the same
  return "Sensors and Supplies next order dates must differ to enable Split.";
}

/**
 * Returns a partial Patient overlay representing the field changes for
 * one side of a split. Apply via `update(patient.id, getSplitOverrides(...))`.
 *
 * - "supplies" side: zero out everything sensor/CGM-related.
 * - "sensors"  side: zero out everything pump/supply-related.
 *
 * Order Handling is forced to "Separate" on BOTH sides — this is the
 * visual signal that the item is half of a split.
 */
export function getSplitOverrides(side: SplitSide, original: Patient): Partial<Patient> {
  if (side === "supplies") {
    // Original Serving "Insulin Pump + CGM" (3) → "Insulin Pump" (0)
    // Original Serving "Supplies + CGM" (4)   → "Supplies Only" (1)
    // Anything else → keep "Insulin Pump" as a safe default.
    let servingIdx = SERVING_INSULIN_PUMP;
    let servingLabel = "Insulin Pump";
    if (original.servingIndex === 4) {
      servingIdx = SERVING_SUPPLIES_ONLY;
      servingLabel = "Supplies Only";
    } else if (original.servingIndex === 0 || original.servingIndex === 1) {
      // Already pump/supplies-only — keep as is.
      servingIdx = original.servingIndex;
      servingLabel = original.serving;
    }
    return {
      // ── Sensor-side fields → Not Serving / blank ─────────────────────
      cgmCoveragePathIndex: NOT_SERVING_INDEX.cgmCoveragePath,
      cgmCoveragePath: "Not Serving",
      cgmTypeIndex: NOT_SERVING_INDEX.cgmType,
      cgmType: "Not Serving",
      cgmAuthResultIndex: NOT_SERVING_INDEX.authResult,
      cgmAuthResult: "Not Serving",
      sensorsAuthResultIndex: NOT_SERVING_INDEX.authResult,
      sensorsAuthResult: "Not Serving",
      // Clear (not zero) — Monday automations gated on "is empty" only fire
      // when the cell is cleared, not when it holds 0.
      monitorQty: "",
      lastBillDateSensors: "",
      lastBillDateMonitor: "",
      nextOrderDateSensors: "",
      // ── Pump/supplies-side fields → explicitly preserve from original
      //    (this profile IS the supplies order, so these keep the originals)
      //    Monday's duplicate_item doesn't always copy status-column
      //    indexes reliably; pinning them to the overlay guarantees the
      //    UI shows the right value after a refetch.
      pumpTypeIndex: original.pumpTypeIndex,
      pumpType: original.pumpType,
      ipCoveragePathIndex: original.ipCoveragePathIndex,
      ipCoveragePath: original.ipCoveragePath,
      infusionSet1Index: original.infusionSet1Index,
      infusionSet1: original.infusionSet1,
      infusionSet2Index: original.infusionSet2Index,
      infusionSet2: original.infusionSet2,
      qtyInf1: original.qtyInf1,
      qtyInf2: original.qtyInf2,
      pumpQty: original.pumpQty,
      ipAuthResultIndex: original.ipAuthResultIndex,
      ipAuthResult: original.ipAuthResult,
      infusionSetAuthResultIndex: original.infusionSetAuthResultIndex,
      infusionSetAuthResult: original.infusionSetAuthResult,
      cartridgeAuthResultIndex: original.cartridgeAuthResultIndex,
      cartridgeAuthResult: original.cartridgeAuthResult,
      // ── New side identity ─────────────────────────────────────────────
      servingIndex: servingIdx,
      serving: servingLabel,
      subscriptionTypeIndex: SUBSCRIPTION_SUPPLIES,
      subscriptionType: "Supplies",
      orderHandlingIndex: ORDER_HANDLING_SEPARATE,
      orderHandling: "Separate",
    };
  }

  // sensors side
  return {
    // ── Pump/supplies-side fields → Not Serving / 0 / blank ─────────
    ipCoveragePathIndex: NOT_SERVING_INDEX.ipCoveragePath,
    ipCoveragePath: "Not Serving",
    pumpTypeIndex: NOT_SERVING_INDEX.pumpType,
    pumpType: "Not Serving",
    infusionSet1Index: NOT_SERVING_INDEX.infusionSet,
    infusionSet1: "Not Serving",
    infusionSet2Index: NOT_SERVING_INDEX.infusionSet,
    infusionSet2: "Not Serving",
    // Clear (not zero) — Monday automations gated on "is empty" only fire
    // when the cell is cleared, not when it holds 0.
    qtyInf1: "",
    qtyInf2: "",
    pumpQty: "",
    ipAuthResultIndex: NOT_SERVING_INDEX.authResult,
    ipAuthResult: "Not Serving",
    infusionSetAuthResultIndex: NOT_SERVING_INDEX.authResult,
    infusionSetAuthResult: "Not Serving",
    cartridgeAuthResultIndex: NOT_SERVING_INDEX.authResult,
    cartridgeAuthResult: "Not Serving",
    lastBillDateIp: "",
    lastBillDateInfusionSet: "",
    lastBillDateCartridge: "",
    nextOrderDateIp: "",
    nextOrderDateSupplies: "",
    // ── Sensor-side fields → explicitly preserve from original ───────
    //    Pinned to the overlay so refetch from Monday cannot blank
    //    them out (Monday's duplicate_item is unreliable for status
    //    column indexes).
    cgmTypeIndex: original.cgmTypeIndex,
    cgmType: original.cgmType,
    cgmCoveragePathIndex: original.cgmCoveragePathIndex,
    cgmCoveragePath: original.cgmCoveragePath,
    monitorQty: original.monitorQty,
    cgmAuthResultIndex: original.cgmAuthResultIndex,
    cgmAuthResult: original.cgmAuthResult,
    sensorsAuthResultIndex: original.sensorsAuthResultIndex,
    sensorsAuthResult: original.sensorsAuthResult,
    lastBillDateSensors: original.lastBillDateSensors,
    lastBillDateMonitor: original.lastBillDateMonitor,
    nextOrderDateSensors: original.nextOrderDateSensors,
    // ── New side identity ────────────────────────────────────────────
    servingIndex: SERVING_CGM,
    serving: "CGM",
    subscriptionTypeIndex: SUBSCRIPTION_SENSORS,
    subscriptionType: "Sensors",
    orderHandlingIndex: ORDER_HANDLING_SEPARATE,
    orderHandling: "Separate",
  };
}
