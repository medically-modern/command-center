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
  // Insurance (editable)
  primaryInsurance: string;
  primaryInsuranceIndex: number | null;
  primaryInsuranceEdited: string | null;
  primaryInsuranceIndexEdited: number | null;
  memberId1: string;
  memberId1Edited: string | null;
  secondaryInsurance: string;
  memberId2: string;
  // Read-only product/referral
  serving: string;
  servingIndex: number | null;
  servingEdited: string | null;
  servingIndexEdited: number | null;
  pumpType: string;
  pumpTypeIndex: number | null;
  cgmType: string;
  cgmTypeIndex: number | null;       // editable override
  requestType: string;
  doctorName: string;
  doctorNpi: string;
  referralSource: string;            // NEW: tandem, patient, doctor, etc.
  referralReceivedDate: string;      // NEW: date column
  diagnosis: string;
  notes: string;
  /** Read-only notes carried from earlier stages (Profile, Medical Necessity,
   *  Insurance), populated on the board by a Monday automation. Shown read-only
   *  here, oldest stage first, above the Welcome Call's own notes. */
  profileSendOffNotes?: string;
  mnWorkflowNotes?: string;
  insuranceNotes?: string;
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
  /** Cartridge quantity — UI defaults it to 3 for pump patients. */
  qtyCartridge: string;
  /** Medicare Prior Pump Date (MM/YYYY free text). Shown only for Original
   *  Medicare patients with Pump Qty 0. Board col text_mm58k9x9. */
  medicarePriorPumpDate: string;
  subscriptionType: string;
  subscriptionTypeIndex: number | null;
  welcomeCallText: string;
  welcomeCallTextIndex: number | null;
  orderHandling: string;
  orderHandlingIndex: number | null;
  // Call attempts
  callAttempts: string;
  // Follow up
  followUp: string;
  followUpDate: string;
  // Auth Results (read-only)
  cgmAuthResult: string;
  sensorsAuthResult: string;
  ipAuthResult: string;
  infusionSetAuthResult: string;
  cartridgeAuthResult: string;
  // Benefits (read-only)
  deductible: string;
  deductibleRemaining: string;
  oopMax: string;
  oopMaxRemaining: string;
  stediCoinsurance: string;
  stediQmb: string;
  // Last bill dates (read-only)
  cgmLastBillDate: string;
  sensorsLastBillDate: string;
  ipLastBillDate: string;
  infusionSetLastBillDate: string;
  cartridgeLastBillDate: string;
  // Next order dates
  ipNextOrderDate: string;
  sensorsNextOrderDate: string;
  suppliesNextOrderDate: string;
  // Editable order date overrides (YYYY-MM-DD or null if untouched)
  ipNextOrderDateEdited: string | null;
  sensorsNextOrderDateEdited: string | null;
  suppliesNextOrderDateEdited: string | null;
  // End-of-call decision: index 1 = Advance, index 2 = Don't Advance
  advanceDecision: string;
  advanceDecisionIndex: number | null;
  phoneEdited: string | null;   // local edit of phone
  addressEdited: string | null; // local edit of address
  addressLat: number | null;    // lat from Google Places geocode
  addressLng: number | null;    // lng from Google Places geocode
  escalated: boolean;
  receivedAt: string;
  lastUpdated: string;
  // Never Billed attestations (read-only, mirrored from Samantha board)
  neverBilledIsCar: boolean;
  neverBilledCgm: boolean;
}

// Infusion Set 1 / 2 options are NOT hardcoded here any more.
//
// They were `{ index, label }[]` tables written straight to Monday with
// `writeStatusIndex`. The index is the only binding — the label string never
// reaches Monday — so a deleted index writes a blank without erroring, and a
// label the board added is simply never offered (this table stopped at index
// 102, so it never showed QuickSet, AutoSoft XC 9 mm 43", AutoSoft 30 13 mm 43"
// or Luer after those were added).
//
// The forms now read both columns live via `useStatusOptions`
// (`lib/shared/statusOptions.ts`) and disable the control until they load.
// Do not reintroduce a hardcoded list here.

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

export const PUMP_TYPE_OPTIONS = [
  { index: 0, label: 'iLet' },
  { index: 1, label: 'Mobi' },
  { index: 2, label: 't:slim' },
  { index: 3, label: 'Not Serving' },
  { index: 4, label: 'Minimed 780G' },
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

export const SERVING_OPTIONS = [
  { index: 0, label: 'Insulin Pump' },
  { index: 1, label: 'Supplies Only' },
  { index: 2, label: 'CGM' },
  { index: 3, label: 'Insulin Pump + CGM' },
  { index: 4, label: 'Supplies + CGM' },
];

export const SECONDARY_INSURANCE_OPTIONS = [
  { index: 0, label: 'None' },
  { index: 1, label: 'NY Medicaid' },
  { index: 2, label: 'Medicare Supplement' },
];

export const PRIMARY_INSURANCE_OPTIONS = [
  { index: 0, label: 'BCBS TN' },
  { index: 1, label: 'BCBS FL' },
  { index: 2, label: 'BCBS WY' },
  { index: 3, label: 'MagnaCare' },
  { index: 4, label: 'Oregon Care' },
  { index: 6, label: 'UMR' },
  { index: 7, label: 'United Healthcare Commercial' },
  { index: 8, label: 'Medicare A&B' },
  { index: 9, label: 'NYSHIP' },
  { index: 10, label: 'United Commercial' },
  { index: 11, label: 'United Medicare' },
  { index: 12, label: 'United Medicaid' },
  { index: 13, label: 'Aetna Commercial' },
  { index: 14, label: 'Aetna Medicare' },
  { index: 15, label: 'Wellcare' },
  { index: 16, label: 'Humana' },
  { index: 17, label: 'Cigna' },
  { index: 18, label: 'Medicaid' },
  { index: 19, label: 'Midlands Choice' },
  { index: 101, label: 'Horizon BCBS' },
  { index: 102, label: 'Fidelis Low-Cost' },
  { index: 103, label: 'Fidelis Medicaid' },
  { index: 104, label: 'Anthem BCBS Medicaid (JLJ)' },
  { index: 105, label: 'Anthem BCBS Commercial' },
  { index: 106, label: 'Anthem BCBS Medicare' },
  { index: 107, label: 'Fidelis Commercial' },
  { index: 108, label: 'Fidelis Medicare' },
  { index: 109, label: 'Anthem BCBS Low-Cost (JLJ)' },
  { index: 110, label: 'Fidelis CHP' },
];

/** Original ("traditional") Medicare = primary insurance "Medicare A&B".
 *  Medicare Advantage plans (United/Aetna/Anthem/Fidelis Medicare, Wellcare,
 *  Humana) are private Part C plans and are NOT Original Medicare. */
export function isOriginalMedicare(primaryInsuranceLabel: string): boolean {
  return primaryInsuranceLabel.trim() === "Medicare A&B";
}

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

/** Prior Pump Purchase Date is collected so Medicare can bill pump supplies
 *  against a patient-owned pump. It applies only when all three hold:
 *  Original Medicare (Medicare A&B), no pump being sold (Pump Qty 0), AND
 *  serving includes pump/supplies — a CGM-only patient is never asked for it.
 *  Unknown (blank) serving is trusted as pump-served so a missing column
 *  can't hide the field and wipe an already-collected date.
 *  Must stay in agreement with finalConfirm/workflow.ts needsPriorPumpDate
 *  (priorPumpDate.test.ts guards both). */
export function needsPriorPumpDate(primaryInsurance: string, pumpQty: string, serving: string): boolean {
  if (!isOriginalMedicare(primaryInsurance) || pumpQty === '1') return false;
  return serving.trim() === '' || servingIncludesPump(serving);
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

/* ─── Next order dates ─── */

/** Format a Date as YYYY-MM-DD from its LOCAL calendar parts. Monday dates are
 *  timezone-naive ET, so we must not round-trip through toISOString() (UTC) —
 *  that rolls the day back in east-of-UTC runtimes and diverges from the board. */
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compute a product's next order date the way the Welcome Call UI shows it:
 * the latest last-bill date + 90 days, or today when there is no last-bill date.
 * Lives here (not in the component) so the display and the send path share one
 * source of truth — the value on screen is exactly what gets written to Monday.
 */
export function computeNextOrder(lastBillDates: string[]): string {
  const dates = lastBillDates
    .filter(Boolean)
    .map((d) => {
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    })
    .filter((d): d is Date => d !== null);

  if (dates.length === 0) return ymdLocal(new Date());

  // Use the latest last bill date
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  latest.setDate(latest.getDate() + 90);
  return ymdLocal(latest);
}

/**
 * The next order date the UI is actually displaying for a product:
 *   explicit edit → existing Monday value → computed default.
 * Mirrors SmartNextOrderField's `effectiveDate`, so the send path writes the
 * same date the rep sees on screen. Uses `||` (not `??`) for the edit so a
 * cleared field ("") falls back to the Monday value / computed default rather
 * than resolving to an empty string.
 */
export function effectiveNextOrder(
  edited: string | null,
  mondayDate: string,
  lastBillDates: string[],
): string {
  return (edited || mondayDate || computeNextOrder(lastBillDates)).slice(0, 10);
}

/**
 * Decide what to write to one product's Next Order Date column on Send, or
 * `null` to skip the write.
 *
 * MM-1042: a product that is NOT being served must never receive the
 * "today" default that `computeNextOrder([])` produces for an empty
 * last-bill history. When a line isn't served its date must be empty, so we
 * honor an explicit rep edit if there is one and otherwise clear a stale
 * board value (skipping the write when the board is already empty). Served
 * lines keep the existing edit → Monday value → computed-default resolution.
 */
export function resolveNextOrderWrite(args: {
  served: boolean;
  edited: string | null;
  mondayDate: string;
  lastBillDates: string[];
}): string | null {
  const current = args.mondayDate.slice(0, 10);
  if (!args.served) {
    const target = (args.edited ?? "").slice(0, 10);
    return target !== current ? target : null;
  }
  const effective = effectiveNextOrder(args.edited, args.mondayDate, args.lastBillDates);
  return effective && effective !== current ? effective : null;
}

/* ─── Validation for Send to Monday ─── */

function hasZipCode(address: string): boolean {
  if (!address) return false;
  return /\b\d{5}(-\d{4})?\b/.test(address);
}

export function validatePatientForSend(p: Patient): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // End-of-call decision is always required
  if (p.advanceDecisionIndex === null) {
    errors.push('Pick Advance or Don\'t Advance before sending');
  }

  // If escalated + Don't Advance (index 2), skip remaining validation — allow send
  const isDontAdvance = p.advanceDecisionIndex === 2;
  if (p.escalated && isDontAdvance) {
    return { valid: errors.length === 0, errors };
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
  const effectiveServing = p.servingEdited ?? p.serving;
  if (servingIncludesCgm(effectiveServing)) {
    if (p.cgmTypeIndex === null) {
      errors.push('CGM Type is required (serving includes CGM)');
    }
  }

  // Pump/Infusion fields required if serving includes pump/supplies
  if (servingIncludesPump(effectiveServing)) {
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
