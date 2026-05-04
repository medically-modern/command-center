/**
 * Welcome Call Checklist — Data Model
 */

export interface Patient {
  id: string;
  name: string;
  // Read-only demographics
  dob: string;
  phone: string;
  email: string;
  address: string;
  gender: string;
  // Read-only insurance
  primaryInsurance: string;
  memberId1: string;
  secondaryInsurance: string;
  memberId2: string;
  // Read-only product/referral
  serving: string;
  pumpType: string;
  pumpTypeIndex: number | null;
  cgmType: string;
  cgmTypeIndex: number | null;       // editable override
  requestType: string;
  doctorName: string;
  referralSource: string;            // NEW: tandem, patient, doctor, etc.
  referralReceivedDate: string;      // NEW: date column
  diagnosis: string;
  notes: string;
  // Secondary insurance & member ID 2 (editable when empty)
  secondaryInsuranceIndex: number | null;
  secondaryInsuranceEdited: string | null;
  memberId2Edited: string | null;
  // Editable welcome call fields
  monitorQty: string;
  pumpQty: string;
  qtyInf1: string;
  infusionSet1: string;
  infusionSet1Index: number | null;
  qtyInf2: string;
  infusionSet2: string;
  infusionSet2Index: number | null;
  subscriptionType: string;
  subscriptionTypeIndex: number | null;
  welcomeCallText: string;
  welcomeCallTextIndex: number | null;
  orderHandling: string;
  orderHandlingIndex: number | null;
  // End-of-call decision: index 1 = Advance, index 2 = Don't Advance
  advanceDecision: string;
  advanceDecisionIndex: number | null;
  addressEdited: string | null; // local edit of address
  addressLat: number | null;    // lat from Google Places geocode
  addressLng: number | null;    // lng from Google Places geocode
  escalated: boolean;
  receivedAt: string;
  lastUpdated: string;
}

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
  { index: 101, label: 'Not Serving' },
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
  { index: 101, label: 'Not Serving' },
];

export const SUBSCRIPTION_TYPE_OPTIONS = [
  { index: 0, label: 'Sensors' },
  { index: 1, label: 'Sensors & Supplies' },
  { index: 2, label: 'Supplies' },
];

export const WELCOME_CALL_TEXT_OPTIONS = [
  { index: 0, label: 'Send' },
];

export const ORDER_HANDLING_OPTIONS = [
  { index: 0, label: 'Separate' },
  { index: 1, label: 'Together' },
  { index: 2, label: 'Not Applicable' },
];

export const CGM_TYPE_OPTIONS = [
  { index: 0, label: 'FreeStyle Libre 14-Day' },
  { index: 1, label: 'Guardian 4' },
  { index: 2, label: 'Instinct' },
  { index: 3, label: 'FreeStyle Libre 3 Plus' },
  { index: 4, label: 'FreeStyle Libre 2 Plus' },
  { index: 6, label: 'Dexcom G7' },
  { index: 7, label: 'Dexcom G7 15-Day' },
  { index: 8, label: 'Dexcom G6' },
  { index: 9, label: 'Not Serving' },
];

export const SECONDARY_INSURANCE_OPTIONS = [
  { index: 0, label: 'None' },
  { index: 1, label: 'NY Medicaid' },
  { index: 2, label: 'Medicare Supplement' },
];

/* ─── Serving-based visibility helpers ─── */

/** Returns true if CGM section should default to visible based on serving value */
export function servingIncludesCgm(serving: string): boolean {
  const s = serving.toLowerCase();
  return s.includes('cgm');
}

/** Returns true if Pump/Infusion section should default to visible based on serving value */
export function servingIncludesPump(serving: string): boolean {
  const s = serving.toLowerCase();
  return s.includes('pump') || s.includes('supplies');
}

/* ─── Cross-Sell + Subscription consistency helpers ─── */

const CGM_NOT_SERVING_INDEX = 9;
const INFUSION_NOT_SERVING_INDEX = 101;

/** True when the agent is being asked to cross-sell CGM:
 *  serving includes CGM but the original request type does not. */
export function isCrossSell(p: { serving: string; requestType: string }): boolean {
  return servingIncludesCgm(p.serving) && !servingIncludesCgm(p.requestType);
}

/** True if the user has selected a "selling" CGM type (anything other than Not Serving). */
export function isCgmSelling(cgmTypeIndex: number | null): boolean {
  return cgmTypeIndex !== null && cgmTypeIndex !== CGM_NOT_SERVING_INDEX;
}

/** True if a single infusion set slot is "selling" (set selected, not Not Serving). */
export function isInfusionSelling(infusionSetIndex: number | null): boolean {
  return infusionSetIndex !== null && infusionSetIndex !== INFUSION_NOT_SERVING_INDEX;
}

/** What the Subscription Type SHOULD be based on CGM Type + Infusion Set selections.
 *  Returns null if neither CGM nor infusion is selling (no expectation). */
export function expectedSubscriptionType(p: {
  cgmTypeIndex: number | null;
  infusionSet1Index: number | null;
  infusionSet2Index: number | null;
}): string | null {
  const cgm = isCgmSelling(p.cgmTypeIndex);
  const infusion = isInfusionSelling(p.infusionSet1Index) || isInfusionSelling(p.infusionSet2Index);
  if (cgm && infusion) return 'Sensors & Supplies';
  if (cgm) return 'Sensors';
  if (infusion) return 'Supplies';
  return null;
}

/* ─── Phone formatting ─── */

export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw; // return as-is if not a standard US number
}

/* ─── Date formatting ─── */

export function formatDateMDY(raw: string): string {
  if (!raw) return '';
  // Monday date columns come as YYYY-MM-DD
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[2]}/${match[3]}/${match[1]}`;
  }
  return raw;
}

/* ─── Validation for Send to Monday ─── */

function hasZipCode(address: string): boolean {
  if (!address) return false;
  return /\b\d{5}(-\d{4})?\b/.test(address);
}

export function validatePatientForSend(p: Patient): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // End-of-call decision is required
  if (p.advanceDecisionIndex === null) {
    errors.push('Pick Advance or Don\'t Advance before sending');
  }

  // Subscription type is required
  if (p.subscriptionTypeIndex === null) {
    errors.push('Subscription Type is required');
  }

  // Address validation — either original must have zip or edited must
  const effectiveAddress = p.addressEdited ?? p.address;
  if (!effectiveAddress || !hasZipCode(effectiveAddress)) {
    errors.push('Address with zip code is required');
  }

  // CGM fields required if serving includes CGM
  if (servingIncludesCgm(p.serving)) {
    if (p.cgmTypeIndex === null) {
      errors.push('CGM Type is required (serving includes CGM)');
    }
  }

  // Pump/Infusion fields required if serving includes pump/supplies
  if (servingIncludesPump(p.serving)) {
    // Infusion set 1 — required unless qty is 0
    const qty1 = Number(p.qtyInf1) || 0;
    if (qty1 > 0 && p.infusionSet1Index === null) {
      errors.push('Infusion Set 1 type is required when quantity > 0');
    }
    if (qty1 === 0 && p.infusionSet1Index === null) {
      // Rare but allowed — both blank/0
    }
    // If infusion set is selected, qty must be > 0 (unless "Not Serving")
    if (p.infusionSet1Index !== null && p.infusionSet1Index !== 101 && qty1 === 0) {
      errors.push('Infusion Set 1 quantity required when set type is selected');
    }
  }

  return { valid: errors.length === 0, errors };
}
