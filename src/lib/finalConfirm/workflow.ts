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

  // Medical Necessity
  diagnosis: string;
  cgmCoveragePath: string;
  ipCoveragePath: string;
  mrExpiryDate: string;

  // Product / Referral
  serving: string;
  pumpType: string;
  cgmType: string;
  requestType: string;
  referralType: string;
  referralSource: string;

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

/* ─── Status dropdown options ─── */

export const GENDER_OPTIONS = [
  { index: 0, label: "Male" },
  { index: 1, label: "Female" },
];

export const SECONDARY_INSURANCE_OPTIONS = [
  { index: 0, label: "None" },
  { index: 1, label: "NY Medicaid" },
  { index: 2, label: "Medicare Supplement" },
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

function hasZipCode(address: string): boolean {
  if (!address) return false;
  return /\b\d{5}(-\d{4})?\b/.test(address);
}

/* ─── Validation ─── */

export function validatePatientForSend(p: Patient): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Demographics
  if (!p.dob) errors.push("DOB is required");
  const effectivePhone = p.phoneEdited ?? p.phone;
  if (!effectivePhone) errors.push("Phone number is required");
  const effectiveAddress = p.addressEdited ?? p.address;
  if (!effectiveAddress || !hasZipCode(effectiveAddress)) errors.push("Address with zip code is required");
  const effectiveEmail = p.emailEdited ?? p.email;
  if (!effectiveEmail) errors.push("Email is required");
  if (!p.gender && p.genderIndex === null) errors.push("Gender is required");

  // Insurance
  if (!p.primaryInsurance) errors.push("Primary Insurance is required");
  if (!p.memberId1) errors.push("Member ID 1 is required");

  // Doctor
  if (!p.doctorName) errors.push("Doctor Name is required");
  if (!p.doctorNpi) errors.push("Doctor NPI is required");

  // Product — subscription type needed if serving includes supplies
  if (p.serving && !p.subscriptionType && p.subscriptionTypeIndex === null) {
    errors.push("Subscription Type is required");
  }

  // Infusion set qty consistency
  if (p.serving?.toLowerCase().includes("pump") || p.serving?.toLowerCase().includes("supplies")) {
    const qty1 = Number(p.qtyInf1) || 0;
    if (qty1 > 0 && p.infusionSet1Index === null && !p.infusionSet1) {
      errors.push("Infusion Set 1 type required when quantity > 0");
    }
  }

  return { valid: errors.length === 0, errors };
}
