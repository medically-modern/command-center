/**
 * Subscription Board — Data Model & Options
 */

export interface Patient {
  id: string;
  name: string;

  // Subscription status
  status: string;                    // Active / Paused / Dead
  statusIndex: number | null;
  daysToOrder: string;
  daysToOrderIndex: number | null;
  orderingCycle: string;
  orderingCycleIndex: number | null;
  nextOrder: string;                 // date YYYY-MM-DD
  subscription: string;              // Sensors / Supplies / Sensors & Supplies
  subscriptionIndex: number | null;
  orderType: string;                 // First Order / Reorder
  orderTypeIndex: number | null;

  // Demographics
  dob: string;
  gender: string;
  phone: string;
  email: string;
  address: string;

  // Insurance
  primaryInsurance: string;
  primaryInsuranceIndex: number | null;
  memberId1: string;
  secondaryInsurance: string;
  secondaryInsuranceIndex: number | null;
  memberId2: string;

  // Financials (read-only)
  sensorsRevenue: string;
  sensorsCost: string;
  sensorsGP: string;
  suppliesRevenue: string;
  suppliesCost: string;
  suppliesGP: string;
  totalRevenue: string;
  totalCost: string;
  shippingCost: string;
  totalGP: string;
  arr: string;
  arp: string;

  // Medical Necessity
  cgmCoverage: string;
  mr: string;
  mnExpiry: string;
  diagnosis: string;

  // Prior Auth — Sensors
  sensorsAuthStatus: string;
  sensorsAuthStatusIndex: number | null;
  sensorsAuthId: string;
  sensorsUnits: string;
  sensorsStartAuth: string;
  sensorsEndAuth: string;
  sensorsId2: string;

  // Prior Auth — Supplies
  suppliesAuthStatus: string;
  suppliesAuthStatusIndex: number | null;
  infusionSetAuthId: string;
  cartridgeAuthId: string;
  suppliesUnits: string;
  suppliesStartAuth: string;
  suppliesEndAuth: string;

  // Order Details
  sensorsType: string;
  sensorsTypeIndex: number | null;
  suppliesType: string;
  suppliesTypeIndex: number | null;
  infusionSet1: string;
  infusionSet1Index: number | null;
  infQty1: string;
  infusionSet2: string;
  infusionSet2Index: number | null;
  infQty2: string;

  // Doctor
  doctor: string;
  npi: string;
  doctorAddress: string;
  doctorPhone: string;
  doctorFax: string;
  faxParachute: string;

  // Other
  orderCount: string;
  deadReason: string;
  pauseReason: string;
  referral: string;
  denialReason: string;

  // Stedi
  stediActive: string;
  stediDedRemaining: string;
  insuranceChange: string;
  priorAuthReq: string;
  primaryClaimPaid: string;

  // Claims
  claimsStatus: string;

  // Local UI state
  phoneEdited: string | null;
  addressEdited: string | null;
  addressLat: number | null;
  addressLng: number | null;
  memberId1Edited: string | null;
  memberId2Edited: string | null;
  notes: string;
  escalated: boolean;
  receivedAt: string;
  lastUpdated: string;
}

// ── Status Options ───────────────────────────────────────────────────

export const STATUS_OPTIONS = [
  { index: 0, label: "Paused" },
  { index: 1, label: "Active" },
  { index: 2, label: "Dead" },
];

export const DAYS_TO_ORDER_OPTIONS = [
  { index: 12, label: "Today" },
  { index: 11, label: "1 Week" },
  { index: 0, label: "10 Days" },
  { index: 1, label: "20 Days" },
  { index: 2, label: "30 Days" },
  { index: 4, label: "40 Days" },
  { index: 6, label: "50 Days" },
  { index: 7, label: "60 Days" },
  { index: 8, label: "70 Days" },
  { index: 9, label: "80 Days" },
  { index: 10, label: "90 Days" },
  { index: 3, label: "Order Day Passed" },
  { index: 16, label: "Very Late" },
  { index: 15, label: "Pause" },
  { index: 13, label: "Stopped Serving" },
  { index: 14, label: "Not Serving" },
  { index: 17, label: "Order Day Arrived" },
];

export const ORDERING_CYCLE_OPTIONS = [
  { index: 0, label: "Benefits" },
  { index: 9, label: "Submit Auth." },
  { index: 4, label: "Confirm Order" },
  { index: 6, label: "Last Order Review" },
  { index: 1, label: "Order" },
  { index: 2, label: "Next Order Awaiting" },
  { index: 3, label: "Not Serving" },
];

export const SUBSCRIPTION_OPTIONS = [
  { index: 0, label: "Supplies" },
  { index: 1, label: "Sensors" },
  { index: 2, label: "Sensors & Supplies" },
];

export const ORDER_TYPE_OPTIONS = [
  { index: 0, label: "First Order" },
  { index: 2, label: "Reorder" },
];

export const SENSORS_TYPE_OPTIONS = [
  { index: 6, label: "FreeStyle Libre 3 Plus" },
  { index: 0, label: "FreeStyle Libre 2 Plus" },
  { index: 2, label: "FreeStyle Libre 2 Plus" },
  { index: 7, label: "FreeStyle Libre 14-Day" },
  { index: 4, label: "Dexcom G7" },
  { index: 8, label: "Dexcom G7 15-Day" },
  { index: 3, label: "Dexcom G6" },
  { index: 1, label: "Guardian 4" },
  { index: 9, label: "Instinct" },
  { index: 10, label: "Not Serving" },
];

export const SUPPLIES_TYPE_OPTIONS = [
  { index: 2, label: "iLet" },
  { index: 1, label: "t:slim" },
  { index: 0, label: "Mobi" },
  { index: 6, label: "Minimed 780G" },
  { index: 3, label: "Not Serving" },
];

export const INFUSION_SET_1_OPTIONS = [
  { index: 6, label: 'AutoSoft XC 6mm 23"' },
  { index: 107, label: 'AutoSoft XC 6mm 23"' },
  { index: 17, label: 'AutoSoft XC 6mm 32"' },
  { index: 108, label: 'AutoSoft XC 6mm 32"' },
  { index: 11, label: 'AutoSoft XC 6mm 43"' },
  { index: 110, label: 'AutoSoft XC 6mm 43"' },
  { index: 7, label: 'AutoSoft XC 6mm 5"' },
  { index: 151, label: 'AutoSoft XC 6mm 5"' },
  { index: 0, label: 'AutoSoft XC 9mm 23"' },
  { index: 153, label: 'AutoSoft XC 9mm 23"' },
  { index: 16, label: 'AutoSoft XC 9mm 43"' },
  { index: 8, label: 'AutoSoft 90 6mm 23"' },
  { index: 106, label: 'AutoSoft 90 6mm 23"' },
  { index: 13, label: 'AutoSoft 90 6mm 43"' },
  { index: 4, label: 'AutoSoft 90 9mm 23"' },
  { index: 15, label: 'AutoSoft 90 9mm 43"' },
  { index: 9, label: 'AutoSoft 30 13mm 23"' },
  { index: 105, label: 'AutoSoft 30 13mm 23"' },
  { index: 103, label: 'AutoSoft 30 13mm 43"' },
  { index: 10, label: 'TruSteel 6mm 23"' },
  { index: 154, label: 'TruSteel 6mm 23"' },
  { index: 2, label: 'TruSteel 6mm 32"' },
  { index: 155, label: 'TruSteel 6mm 32"' },
  { index: 3, label: 'TruSteel 8mm 23"' },
  { index: 18, label: 'TruSteel 8mm 32"' },
  { index: 14, label: 'VariSoft 13mm 23"' },
  { index: 109, label: 'VariSoft 13mm 23"' },
  { index: 12, label: 'VariSoft 13mm 32"' },
  { index: 1, label: 'VariSoft 17mm 23"' },
  { index: 19, label: 'Contact 6mm 23"' },
  { index: 101, label: 'Inset 6mm 23"' },
  { index: 102, label: 'Luer 6mm 32"' },
  { index: 152, label: 'Mio Advance Clear 9mm 23"' },
  { index: 104, label: "Not Serving" },
];

export const INFUSION_SET_2_OPTIONS = [
  { index: 4, label: 'AutoSoft XC 6mm 23"' },
  { index: 14, label: 'AutoSoft XC 6mm 23"' },
  { index: 11, label: 'AutoSoft XC 6mm 32"' },
  { index: 0, label: 'AutoSoft XC 6mm 43"' },
  { index: 2, label: 'AutoSoft XC 6mm 5"' },
  { index: 6, label: 'AutoSoft XC 9mm 23"' },
  { index: 9, label: 'AutoSoft 90 6mm 23"' },
  { index: 15, label: 'AutoSoft 90 6mm 23"' },
  { index: 3, label: 'AutoSoft 90 6mm 43"' },
  { index: 7, label: 'AutoSoft 90 9mm 23"' },
  { index: 8, label: 'VariSoft 13mm 32"' },
  { index: 10, label: 'AutoSoft 30 13mm 23"' },
  { index: 13, label: 'AutoSoft 30 13mm 23"' },
  { index: 1, label: 'TruSteel 6mm 23"' },
  { index: 12, label: "Not Serving" },
];

export const PRIMARY_INSURANCE_OPTIONS = [
  { index: 0, label: "Medicare A&B" },
  { index: 14, label: "Aetna Medicare" },
  { index: 13, label: "Aetna Commercial" },
  { index: 1, label: "Anthem BCBS Commercial" },
  { index: 17, label: "Anthem BCBS Medicare" },
  { index: 2, label: "Cigna" },
  { index: 3, label: "Fidelis Medicaid" },
  { index: 15, label: "Fidelis Commercial" },
  { index: 102, label: "Fidelis Medicare" },
  { index: 11, label: "Horizon BCBS" },
  { index: 18, label: "Humana" },
  { index: 6, label: "Medicaid" },
  { index: 10, label: "NYSHIP" },
  { index: 12, label: "United Commercial" },
  { index: 4, label: "United Medicaid" },
  { index: 104, label: "United Medicare" },
  { index: 16, label: "Wellcare" },
  { index: 19, label: "BCBS Wyoming" },
  { index: 101, label: "Midlands Choice" },
  { index: 103, label: "Magnacare" },
  { index: 105, label: "BCBS TN" },
  { index: 7, label: "Fidelis Low-Cost" },
  { index: 8, label: "Anthem BCBS Medicaid (JLJ)" },
  { index: 9, label: "Anthem BCBS Low-Cost (JLJ)" },
];

export const SECONDARY_INSURANCE_OPTIONS = [
  { index: 0, label: "None" },
  { index: 1, label: "NY Medicaid" },
  { index: 3, label: "Medicare Supplement" },
];

export const SENSORS_AUTH_STATUS_OPTIONS = [
  { index: 0, label: "No Auth Needed" },
  { index: 1, label: "Auth Valid" },
  { index: 2, label: "Auth. Expired" },
  { index: 3, label: "Auth. Expiring" },
  { index: 4, label: "Not Serving" },
  { index: 6, label: "Evaluate" },
  { index: 7, label: "Denied" },
  { index: 8, label: "Submitted" },
  { index: 9, label: "Required" },
];

export const SUPPLIES_AUTH_STATUS_OPTIONS = [
  { index: 0, label: "No Auth Needed" },
  { index: 1, label: "Required" },
  { index: 2, label: "Auth. Expired" },
  { index: 3, label: "Auth. Expiring" },
  { index: 4, label: "Not Serving" },
  { index: 6, label: "Auth Valid" },
  { index: 7, label: "Submitted" },
  { index: 8, label: "Denied" },
];

export const DEAD_REASON_OPTIONS = [
  { id: 1, label: "Out-of-network insurance" },
  { id: 2, label: "Stopped using" },
];

export const PAUSE_REASON_OPTIONS = [
  { id: 1, label: "Collect new insurance" },
  { id: 2, label: "Has enough supplies" },
  { id: 3, label: "Hasn't received pump yet" },
  { id: 4, label: "No confirmation" },
  { id: 5, label: "Last claim denied" },
  { id: 6, label: "Need new auth" },
  { id: 7, label: "Patient needs dr appt" },
  { id: 8, label: "Still owes last invoice" },
  { id: 9, label: "Other supplier has auth" },
  { id: 10, label: "OOP too expensive" },
];

export const FAX_PARACHUTE_OPTIONS = [
  { index: 0, label: "Fax" },
  { index: 1, label: "Parachute" },
];

export const MR_STATUS_OPTIONS = [
  { index: 1, label: "MR Valid" },
  { index: 0, label: "MR <30 Days" },
  { index: 3, label: "MR <20 Days" },
  { index: 4, label: "MR <10 Days" },
  { index: 6, label: "MR <5 Days" },
  { index: 2, label: "MR Expired" },
  { index: 7, label: "MR Invalid" },
];

// ── Helpers ──────────────────────────────────────────────────────────

export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

export function formatDateMDY(raw: string): string {
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}/${match[3]}/${match[1]}`;
  return raw;
}

export function formatCurrency(raw: string): string {
  if (!raw) return "";
  const n = Number(raw);
  if (isNaN(n)) return raw;
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Returns true if the subscription includes sensor products. */
export function subscriptionIncludesSensors(sub: string): boolean {
  const s = sub.toLowerCase();
  return s.includes("sensor");
}

/** Returns true if the subscription includes supply products. */
export function subscriptionIncludesSupplies(sub: string): boolean {
  const s = sub.toLowerCase();
  return s.includes("suppli");
}

// ── Validation for Send to Monday ────────────────────────────────────

export function validatePatientForSend(p: Patient): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (p.statusIndex === null) {
    errors.push("Status is required");
  }

  if (p.subscriptionIndex === null) {
    errors.push("Subscription type is required");
  }

  if (p.orderingCycleIndex === null) {
    errors.push("Ordering Cycle is required");
  }

  // If status is Paused, require pause reason
  if (p.statusIndex === 0 && !p.pauseReason) {
    errors.push("Pause Reason is required when status is Paused");
  }

  // If status is Dead, require dead reason
  if (p.statusIndex === 2 && !p.deadReason) {
    errors.push("Dead Reason is required when status is Dead");
  }

  return { valid: errors.length === 0, errors };
}
