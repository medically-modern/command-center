/**
 * Subscription Board — Data Model & Options
 */

export interface Patient {
  id: string;
  name: string;
  /** Board group the item sits in. Optional because hand-built test fixtures
   *  predate it. Profile Status reads it to report Stuck — that state is a
   *  GROUP, not a column (lib/shared/profileStatus.ts). */
  groupId?: string;
  /** Escalation status INDEX, read straight off the board — 0 manager, 1 done,
   *  2 final. ⚠️ Separate from `escalated`, which this stage hardcodes to false
   *  (CLAUDE.md §10). Profile Status is the only consumer; nothing about the
   *  stage's broken write path changes because this is read. */
  escalationIndex?: number | null;
  /** Escalation label TEXT, read alongside the index. Same §10 caveat as
   *  `escalationIndex`: read-only, Profile Status is the only consumer. */
  escalation?: string;

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
  visitDate: string;           // user-entered; +6 months → new mnExpiry on send
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
  carecentrixIntakeId: string;
  denialReason: string;

  // Stedi
  stediActive: string;
  stediDedRemaining: string;
  insuranceChange: string;
  priorAuthReq: string;
  primaryClaimPaid: string;

  // Claims
  claimsStatus: string;

  // Local UI state — edited overrides (null = not edited)
  phoneEdited: string | null;
  addressEdited: string | null;
  addressLat: number | null;
  addressLng: number | null;
  memberId1Edited: string | null;
  memberId2Edited: string | null;
  doctorEdited: string | null;
  npiEdited: string | null;
  doctorAddressEdited: string | null;
  doctorAddressLat: number | null;
  doctorAddressLng: number | null;
  doctorPhoneEdited: string | null;
  doctorFaxEdited: string | null;
  primaryInsuranceEdited: number | null;   // status index override
  secondaryInsuranceEdited: number | null; // status index override
  faxParachuteEdited: string | null;
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

// Infusion Set 1 / 2 options are NOT hardcoded here any more.
//
// They used to be `{ index, label }[]` tables written straight to Monday with
// `writeStatusIndex`. The index is the only binding — the label string never
// reaches Monday — so when the July 2026 dedup deleted this board's duplicate
// infusion-set labels, 17 of the 49 entries pointed at indexes that no longer
// existed and 10 more rendered as a second, identical-looking option next to a
// working one. Nothing surfaced it: the write "succeeded" and landed blank.
//
// `SubscriptionForm` now reads both columns live via `useStatusOptions`
// (`lib/shared/statusOptions.ts`) and disables the control until they load.
// Do not reintroduce a hardcoded list here — see CLAUDE.md and that module.

export const PRIMARY_INSURANCE_OPTIONS = [
  { index: 0, label: "Medicare A&B" },
  { index: 14, label: "Aetna Medicare" },
  { index: 13, label: "Aetna Commercial" },
  { index: 1, label: "Anthem BCBS Commercial" },
  { index: 17, label: "Anthem BCBS Medicare" },
  // Label + index read back from the live column 2026-08-10, not assumed.
  // Added to Subscription + Order only: CDPHP reaches this board via an
  // insurance CHANGE on an existing subscriber, not via a new referral.
  // See INSURANCE_LABEL_AUDIT.md §9.
  { index: 107, label: "CDPHP" },
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

  // Status is display-only — NOT required for send

  if (p.subscriptionIndex === null) {
    errors.push("Subscription type is required");
  }

  if (p.orderingCycleIndex === null) {
    errors.push("Ordering Cycle is required");
  }

  return { valid: errors.length === 0, errors };
}
