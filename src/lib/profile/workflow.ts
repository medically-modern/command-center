/**
 * Jenelle Profile Checklist — Data Model
 */

export interface Patient {
  id: string;
  name: string;

  // ── Demographics ──
  dob: string;
  ptPhone: string;
  email: string;
  gender: string;
  dateOfIntake: string;
  patientAddress: string;
  patientAddressLat: number | null;
  patientAddressLng: number | null;

  // ── Status / Workflow ──
  alreadyInSystem: string;
  moveToOnboarding: string;

  // ── Notes ──
  notes: string;

  // ── Follow Up ──
  followUp: string;
  followUpDate: string;

  // ── Stedi ──
  runStediEligibility: string;
  stediEligibilityActive: string;
  stediCoverageType: string;
  stediPayerName: string;
  stediMedicareAdvantage: string;
  stediMedicareAdvantageCarrier: string;
  stediMedicareAdvantageMemberId: string;
  stediQmb: string;
  stediMedicareJurisdiction: string;
  stediMedicaidMltc: string;
  stediManagedMedicaid: string;
  stediInNetwork: string;
  stediPriorAuthRequired: string;
  stediCoinsurance: string;
  stediCopay: string;
  stediIndividualDeductible: string;
  stediIndividualDeductibleRemaining: string;
  stediFamilyDeductible: string;
  stediFamilyDeductibleRemaining: string;
  stediIndividualOopMax: string;
  stediIndividualOopMaxRemaining: string;
  stediFamilyOopMax: string;
  stediFamilyOopMaxRemaining: string;
  stediPlanBeginDate: string;
  stediErrorDescription: string;
  stediSecondaryMedicaidId: string;
  stediPlanName: string;
  stediGender: string;
  stediMedicaidId: string;
  stediHomePlan: string;

  // ── Insurance ──
  primaryInsurance: string;
  generalInsurance: string;
  /** Working Member ID (Benefits Check) — the column Stedi reads (text_mm4t8gbq). */
  workingMemberId: string;
  memberId1: string;
  memberId2: string;
  secondaryInsurance: string;

  // ── OOP estimate (computed + written by the SPA) ──
  oopFirst: string;
  oopRecurring: string;

  // ── Working cost-sharing (editable by user, default from individual) ──
  workingCoinsurance: string;
  workingDeductible: string;
  workingDeductibleRemaining: string;
  workingOopMax: string;
  workingOopMaxRemaining: string;

  // ── Doctor ──
  doctorStatus: string;
  doctorName: string;
  doctorPhone: string;
  doctorNpi: string;
  clinicalsMethod: string;
  doctorEmail: string;
  doctorFax: string;
  clinicName: string;
  clinicAddress: string;
  clinicAddressLat: number | null;
  clinicAddressLng: number | null;
  prescriberRequirements: string;

  // ── Serving / Product ──
  referralType: string;
  referralSource: string;
  pumpType: string;
  cgmType: string;
  requestType: string;
  cgmCrossSell: string;
  serving: string;
  insulinPumpCoveragePath: string;
  cgmCoveragePath: string;
}

/**
 * Cross-sell exclusions:
 *   - Medicaid plans: not eligible (rule)
 *   - United plans: business decision — we choose not to cross-sell United patients
 *   - Cigna: business decision — we choose not to cross-sell Cigna patients
 */
export type CrossSellReason =
  | "no-primary"   // Primary insurance not yet selected
  | "eligible"     // Allowed → auto Cross-Sell
  | "medicaid"     // Blocked: Medicaid plan
  | "united"       // Blocked: United business rule
  | "cigna";       // Blocked: Cigna business rule

export function crossSellReason(primaryInsurance: string): CrossSellReason {
  if (!primaryInsurance) return "no-primary";
  const lower = primaryInsurance.toLowerCase();
  if (lower.includes("medicaid")) return "medicaid";
  if (lower.includes("united")) return "united";
  if (lower.includes("cigna")) return "cigna";
  return "eligible";
}

/**
 * Cross-sell logic: determines if we can cross-sell CGM based on primary insurance.
 * See crossSellReason() for the categorical reason (used to drive UI explanations).
 */
export function canCrossSellCgm(primaryInsurance: string): boolean {
  return crossSellReason(primaryInsurance) === "eligible";
}

/**
 * Derive the Serving value based on cross-sell status and request type.
 */
export function deriveServing(cgmCrossSell: string, requestType: string): string | null {
  if (cgmCrossSell === "Cross-Sell") {
    if (requestType === "Supplies Only") return "Supplies + CGM";
    if (requestType === "Insulin Pump") return "Insulin Pump + CGM";
  }
  if (cgmCrossSell === "Couldn't Cross-Sell" || cgmCrossSell === "Already Serving CGM") {
    // Serving stays same as request type
    return requestType || null;
  }
  return null;
}

/**
 * Strip non-digits and drop a leading "1" country code so an E.164
 * input like "+19142202922" normalizes to the same 10-digit US number
 * the rest of the app expects.
 */
function normalizePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Phone number formatting: (xxx) xxx-xxxx
 */
export function formatPhone(raw: string): string {
  const digits = normalizePhoneDigits(raw);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

/**
 * Extract raw digits from formatted phone (10-digit US number).
 */
export function phoneDigits(formatted: string): string {
  return normalizePhoneDigits(formatted).slice(0, 10);
}

/**
 * Extract the 5-digit zip code from an address string. Rejects ZIP+4 — we
 * never store the dash-extension form in this app.
 */
export function extractZip(address: string): string | null {
  // Reject explicit ZIP+4: "12345-6789" should never pass validation.
  if (/\b\d{5}-\d{4}\b/.test(address)) return null;
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

export function hasValidZip(address: string): boolean {
  if (!address.trim()) return true; // empty is ok
  return extractZip(address) !== null;
}

/**
 * Inline warning for an address field, or undefined when it looks fine.
 * Flags: ZIP+4 ("12345-6789" — must be plain 5 digits), a missing/short zip,
 * and ALL-CAPS addresses (should be retyped in normal casing).
 */
export function addressWarning(address: string): string | undefined {
  const a = (address || "").trim();
  if (!a) return undefined;
  if (/\b\d{5}-\d{4}\b/.test(a)) return "Zip is in XXXXX-XXXX format — use the plain 5-digit zip";
  if (!/\b\d{5}\b/.test(a)) return "Address must include a 5-digit zip code (XXXXX)";
  const letters = a.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 8 && letters === letters.toUpperCase()) return "Address is ALL CAPS — retype it in normal casing";
  return undefined;
}

/**
 * Normalize a DOB to MM/DD/YYYY. Pads month and day to 2 digits.
 * Accepts 2-digit year shorthand: <30 → 20xx, otherwise 19xx.
 * Returns the input unchanged if it doesn't look like a date.
 */
export function normalizeDob(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";
  const parts = trimmed.split("/").map((s) => s.trim());
  if (parts.length !== 3) return trimmed;
  let [m, d, y] = parts;
  if (!m || !d || !y || !/^\d+$/.test(m) || !/^\d+$/.test(d) || !/^\d+$/.test(y)) {
    return trimmed;
  }
  m = m.padStart(2, "0");
  d = d.padStart(2, "0");
  if (y.length === 2) {
    const yn = parseInt(y, 10);
    y = yn < 30 ? `20${y}` : `19${y}`;
  }
  return `${m}/${d}/${y}`;
}

