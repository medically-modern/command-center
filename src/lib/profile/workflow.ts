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

  // ── DTC intake form (dtc-mm-form) ──
  // Everything the patient answered on the form. "provided*" values are what
  // THEY told us and are deliberately separate from the verified doctor
  // columns the rep fills via Select Correct Provider (HANDOFF §6.0).
  formReasonForInquiry: string;
  formState: string;
  /** Furthest step reached; "Completed" once submitted. Drives the
   *  partial-vs-completed split in Unverified Referrals. */
  formDropOffStep: string;
  formSessionId: string;
  formPumpNeed: string;
  formCgmPreference: string;
  formPumpPreference: string;
  formProvidedDoctorName: string;
  formProvidedClinicPhone: string;
  /** Filename(s) on the two intake file columns — the UI matches these against
   *  the item's assets to open them in the viewer. */
  formCardPhoto: string;
  cgmDataFile: string;
  formInsuranceVia: string;
  formInsuranceOther: string;
  formSecondaryProvided: string;
  formSecondaryMemberId: string;
  formProceedPreference: string;
  formCallSlot: string;
  formBookingStatus: string;

  // ── Rep-entered on the intake call (not on the patient form) ──
  selfAdvocacy: string;
  currentOopCost: string;
  cgmDataAwareness: string;
  attemptCounter: string;
  intakeCallComplete: string;
  /** "Manager Escalation Required" | "Done" | "Final Escalation Required" */
  intakeEscalation: string;
  intakeEscalationNotes: string;

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
  /** Who is actually PRIMARY per the eligibility check — the MSP payer name
   *  (e.g. "BLUE CROSS BLUE SHIELD S.C.") when CMS's COB file says a
   *  commercial plan is primary to Medicare, "Medicare" for plain A&B,
   *  parsed payer name otherwise (dropdown_mm594743). */
  stediPrimaryPayer: string;
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
  /** Member's address as parsed by the Stedi eligibility check (text_mm5fqm4s). */
  stediAddress: string;
  /** Active facility status from the Medicare 271 — comma-joined dropdown
   *  labels ("Hospice", "Hospital/SNF"); "" when none active. */
  stediFacilityFlags: string;

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
 *   - Anthem JLJ plans (Medicaid AND Low-Cost): no JLJ plan can do CGM (Brandon, 2026-07-15)
 *   - Medicaid plans: not eligible (rule)
 *   - United plans: business decision — we choose not to cross-sell United patients
 *   - Cigna: business decision — we choose not to cross-sell Cigna patients
 */
export type CrossSellReason =
  | "no-primary"   // Primary insurance not yet selected
  | "eligible"     // Allowed → auto Cross-Sell
  | "jlj"          // Blocked: Anthem JLJ plan (Medicaid and Low-Cost alike)
  | "medicaid"     // Blocked: Medicaid plan
  | "united"       // Blocked: United business rule
  | "cigna";       // Blocked: Cigna business rule

export function crossSellReason(primaryInsurance: string): CrossSellReason {
  if (!primaryInsurance) return "no-primary";
  const lower = primaryInsurance.toLowerCase();
  // First, before medicaid — "Anthem BCBS Medicaid (JLJ)" was only blocked
  // incidentally (label contains "medicaid"); "Low-Cost (JLJ)" wasn't blocked
  // at all and auto-upgraded Supplies Only → Supplies + CGM.
  if (lower.includes("jlj")) return "jlj";
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
  if (cgmCrossSell === "Couldn't Cross-Sell") {
    // We CANNOT serve CGM for this patient (Medicaid — e.g. Fidelis Medicaid —
    // Anthem JLJ, United, or Cigna). When the referral asked for a COMBINED
    // product, drop the CGM half and serve only the base product: we still
    // serve the pump/supplies, just not the CGM they can't get. Without this,
    // an "Insulin Pump + CGM" request was suggested verbatim as serving, i.e.
    // suggesting a CGM we know we can't provide.
    if (requestType === "Insulin Pump + CGM") return "Insulin Pump";
    if (requestType === "Supplies + CGM") return "Supplies Only";
    // Non-combined request (Insulin Pump / Supplies Only / CGM) — stays as-is.
    return requestType || null;
  }
  if (cgmCrossSell === "Already Serving CGM") {
    // Not a fresh cross-sell — the patient already gets CGM through us — so
    // serving stays exactly as requested.
    return requestType || null;
  }
  return null;
}

// ── ALL-CAPS normalization (autoscraped intake data arrives shouty) ──

/** Roman-numeral name suffixes stay uppercase ("JOHN SMITH III"). */
const ROMAN_SUFFIX = /^(?:II|III|IV|V|VI|VII|VIII|IX|X)$/;

/** Capitalize the first letter of each -/'/. segment of an all-lowercase
 *  word ("smith-jones" → "Smith-Jones", "o'brien" → "O'Brien"), then fix
 *  Mc surnames ("mcdonald" → "McDonald"). */
function capWordSegments(lower: string): string {
  return lower
    .replace(/(^|[-'’.])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c: string) => "Mc" + c.toUpperCase());
}

/**
 * Normalize an ALL-CAPS name to First Last. Only words whose letters are
 * entirely uppercase are touched (≥2 letters — single initials stay), so an
 * already-correct "McDonald" or a hand-typed mixed-case name is never mangled.
 */
export function titleCaseName(raw: string): string {
  if (!raw) return raw ?? "";
  return raw.replace(/[A-Za-z][A-Za-z'’.-]*/g, (w) => {
    const letters = w.replace(/[^A-Za-z]/g, "");
    if (letters.length < 2 || letters !== letters.toUpperCase()) return w;
    if (ROMAN_SUFFIX.test(letters)) return w;
    return capWordSegments(w.toLowerCase());
  });
}

/**
 * Normalize ALL-CAPS words in an address. Only words with ≥4 letters are
 * touched — the same exemption addressWarning uses, so legitimate caps
 * ("NY", "USA", "APT", "FL 2") survive. Ordinals lowercase ("45TH" → "45th").
 */
export function titleCaseAddress(raw: string): string {
  if (!raw) return raw ?? "";
  return raw.replace(/[A-Za-z0-9][A-Za-z0-9'’-]*/g, (w) => {
    if (/^\d+(?:ST|ND|RD|TH)$/.test(w)) return w.toLowerCase();
    const letters = w.replace(/[^A-Za-z]/g, "");
    if (letters.length < 4 || letters !== letters.toUpperCase()) return w;
    return capWordSegments(w.toLowerCase());
  });
}

/** Lowercase an ALL-CAPS email; anything already containing lowercase is
 *  left exactly as entered. */
export function normalizeEmailCase(raw: string): string {
  if (!raw || /[a-z]/.test(raw)) return raw ?? "";
  return raw.toLowerCase();
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
 * and full or PARTIAL ALL-CAPS (e.g. "1746 45th Street, BROOKLYN, NY 11204")
 * — caps words mean the address didn't come from the address matcher, so it
 * should be re-picked from the suggestions. Words under 4 letters are exempt
 * (state codes "NY", "USA", "APT", "FL 2" are legitimate caps).
 */
export function addressWarning(address: string): string | undefined {
  const a = (address || "").trim();
  if (!a) return undefined;
  if (/\b\d{5}-\d{4}\b/.test(a)) return "Zip is in XXXXX-XXXX format — use the plain 5-digit zip";
  if (!/\b\d{5}\b/.test(a)) return "Address must include a 5-digit zip code (XXXXX)";
  const capsWord = (a.match(/[a-zA-Z]+/g) ?? []).some(
    (w) => w.length >= 4 && w === w.toUpperCase(),
  );
  const letters = a.replace(/[^a-zA-Z]/g, "");
  if (capsWord || (letters.length >= 8 && letters === letters.toUpperCase())) {
    return "Address has ALL-CAPS parts — re-pick it from the address suggestions so it's properly formatted";
  }
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

