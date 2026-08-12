// Mapping between Monday status labels and our internal types.

import type { Patient, InsuranceState, ProductCodeState, ProductCodeId, UniversalChoice, AuthChoice, SosChoice } from "./workflow";
import type { PrimaryInsurance, Serving, ProductId } from "./hcpcRules";
import { PRIMARY_INSURANCE_OPTIONS, SERVING_OPTIONS } from "./hcpcRules";
import { COL, type MondayItem } from "./mondayApi";
import { readEmailCell } from "../shared/emailCell";
// Reverse: Monday dropdown text → AuthSubmissionMethod
import type { AuthSubmissionMethod } from "./workflow";
import { AUTH_SUBMISSION_METHODS } from "./workflow";

function parseAuthMethod(text: string | null | undefined): AuthSubmissionMethod {
  if (!text) return "";
  const norm = text.trim();
  return (AUTH_SUBMISSION_METHODS.find((m) => m.toLowerCase() === norm.toLowerCase()) as AuthSubmissionMethod) ?? "";
}


// Universal-check write indices. In-Network? and Active? are SEPARATE columns
// as of 2026-07-29 (they were one "Active/Network" column before the board
// split) — see COL.inNetwork / COL.active.
export const UNIVERSAL_INDEX = {
  // 11 is not a typo: Monday derives a new status label's key from its palette
  // slot, and "Medicare not Primary" (dark red) landed on 11 when the label was
  // added 2026-07-29. Never renumber these by hand — read the column's
  // settings_str if a label is ever re-added.
  inNetwork: { pass: 1, fail: 2, medicareNotPrimary: 11 },
  active: { pass: 1, fail: 2 },        // 1=Active, 2=Inactive
  dmeBenefits: { pass: 1, fail: 2 },   // 1=Yes, 2=Partial / No
  sos: { pass: 1, fail: 2, skip: 0 },  // 1=All Clear, 2=Partial / Not Clear, 0=Skip
  auth: { noAuth: 1, required: 0 },    // 0=Auths Required, 1=No Auths Required
} as const;

// Escalation column indices
export const ESCALATION_INDEX = {
  managerRequired: 0, // "Manager Escalation Required"
  done: 1,            // "Done"
  finalRequired: 2,   // "Final Escalation Required"
} as const;

// Trigger DVS status indices
export const TRIGGER_DVS_INDEX = {
  triggerDvs: 1,
} as const;

// Trigger Pump DVS status indices (index 1 = "Trigger Pump DVS" fire label)
export const TRIGGER_PUMP_DVS_INDEX = {
  triggerPumpDvs: 1,
} as const;

// Follow Up status indices
export const FOLLOW_UP_INDEX = {
  followUp: 1,
} as const;


// Stage Advancer indices
export const STAGE_INDEX = {
  authDenied: 0,
  /** "DVS" — the fully-automatic DVS stage (dvs-redesign v2, 2026-07).
   *  Label verified on the live board 2026-07-21. */
  dvs: 1,
  stuck: 2,
  benefitsSos: 3,
  authorization: 4,
  authOutstanding: 6,
  complete: 7,
} as const;


/** Stage Advancer text → SidebarGroup key.
 *  Used to assign escalated patients (in the Escalations Monday group)
 *  to the correct sidebar view. */
export const STAGE_TEXT_TO_GROUP: Record<string, "benefits" | "submitAuth" | "authOutstanding"> = {
  "Benefits / SoS": "benefits",
  "Submit Auth.": "submitAuth",
  "Auth. Outstanding": "authOutstanding",
};
// "Not Clear Products" dropdown option ids (per Monday board config)
export const NOT_CLEAR_PRODUCT_ID: Record<ProductCodeId, number> = {
  pump: 1,
  "cgm-monitor": 2,
  "cgm-sensors": 3,
  "infusion-sets": 4,
  cartridges: 5,
};

// "Skip SoS Products" dropdown option ids — same labels and ids as
// Not Clear Products. Populated when an agent picks SoS = Skip on the
// Benefits page; products are removed when the Auth Outstanding recheck
// resolves the SoS to Clear.
export const SKIP_SOS_PRODUCT_ID: Record<ProductCodeId, number> = {
  pump: 1,
  "cgm-monitor": 2,
  "cgm-sensors": 3,
  "infusion-sets": 4,
  cartridges: 5,
};

// Per-product auth result indices
export const AUTH_RESULT_INDEX = {
  evaluate: 0,
  authValid: 1,
  denied: 2,
  noAuthNeeded: 3,
  submitted: 4,
  required: 6,
  notServing: 7,
} as const;


// Auth Method dropdown option IDs on Monday (per-product dropdown columns)
export const AUTH_METHOD_OPTION_ID: Record<string, number> = {
  "Availity Portal": 1,
  "Fax": 2,
  "Payer Portal": 5,
  "Call": 6,
};
export const PRODUCT_CODE_TO_PRODUCT_ID: Record<ProductCodeId, ProductId> = {
  "cgm-monitor": "monitor",
  "cgm-sensors": "sensors",
  pump: "insulin_pump",
  "infusion-sets": "infusion_set",
  cartridges: "cartridge",
};

function findExact<T extends string>(options: readonly T[], text: string | null | undefined): T | "" {
  if (!text) return "";
  const norm = text.trim();
  return (options.find((o) => o.toLowerCase() === norm.toLowerCase()) as T) ?? "";
}

// Maps Monday product-label strings (used by Not Clear Products / Skip SoS
// Products dropdowns) back to internal ProductCodeId.
const PRODUCT_LABEL_TO_CODE: Record<string, ProductCodeId> = {
  "Insulin Pump": "pump",
  "CGM Monitor": "cgm-monitor",
  "CGM Sensors": "cgm-sensors",
  "Infusion Sets": "infusion-sets",
  "Cartridges": "cartridges",
};

function parseProductsDropdown(text: string | null | undefined): Set<ProductCodeId> {
  if (!text) return new Set();
  const out = new Set<ProductCodeId>();
  for (const raw of text.split(",")) {
    const code = PRODUCT_LABEL_TO_CODE[raw.trim()];
    if (code) out.add(code);
  }
  return out;
}

// Map Monday auth result text labels → internal AuthChoice
const AUTH_RESULT_TEXT_MAP: Record<string, { auth: AuthChoice; sos?: SosChoice }> = {
  "required":       { auth: "required" },
  "no auth needed":  { auth: "not-required", sos: "clear" },
  "auth valid":      { auth: "required" },
  "submitted":       { auth: "required" },
  "denied":          { auth: "required" },
  "not serving":     { auth: "", sos: "" },   // product not in serving — will be shown as "Not Serving"
  "evaluate":        { auth: "" },
};

/** Status column `value` JSON → label index, or undefined when unset. */
function statusIndex(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  try {
    const idx = (JSON.parse(value) as { index?: number }).index;
    return typeof idx === "number" ? idx : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Monday universal status → internal UniversalChoice, matched by INDEX.
 *
 * This used to match label TEXT ("active/in-network" / "stuck"), and silently
 * started returning "" for every patient when the Active/Network column was
 * renamed and split on the board (2026-07-29) — the answers stopped
 * round-tripping and reps had to re-enter both checks on every load. Indices
 * survive a rename; labels don't (CLAUDE.md §9).
 */
function parseUniversal(
  cell: { value: string | null } | undefined,
  idx: { pass: number; fail: number; medicareNotPrimary?: number },
): UniversalChoice {
  const i = statusIndex(cell?.value);
  if (i === idx.pass) return "confirmed";
  if (i === idx.fail) return "not-confirmed";
  // In-Network only: "Medicare not Primary" is its own board label as of
  // 2026-07-29, so the answer now survives a reload instead of coming back as
  // a plain Out-of-Network.
  if (idx.medicareNotPrimary !== undefined && i === idx.medicareNotPrimary) return "medicare-not-primary";
  return "";
}

// Map Monday auth result text → internal auth status label (for display)
export function parseAuthResultLabel(text: string | null | undefined): string {
  if (!text) return "";
  return text.trim();
}

// Product auth column ID → ProductCodeId
const AUTH_COL_TO_CODE_ID: Record<string, ProductCodeId> = {
  [COL.authResult.monitor]: "cgm-monitor",
  [COL.authResult.sensors]: "cgm-sensors",
  [COL.authResult.insulin_pump]: "pump",
  [COL.authResult.infusion_set]: "infusion-sets",
  [COL.authResult.cartridge]: "cartridges",
};

/**
 * Convert a Monday board item into a Patient row.
 * Only Serving / PrimaryInsurance / DOB / Doctor / Clinic are populated from
 * Monday — the rest of the workflow checks live in the UI session.
 */
export function mondayItemToPatient(item: MondayItem): Patient {
  const cv = (id: string) => item.column_values.find((c) => c.id === id);
  const serving = findExact<Serving>(SERVING_OPTIONS, cv(COL.serving)?.text) || "";
  const primary = findExact<PrimaryInsurance>(PRIMARY_INSURANCE_OPTIONS, cv(COL.primaryInsurance)?.text) || "";
  const dob = cv(COL.dob)?.text ?? "";
  const doctorName = cv(COL.doctorName)?.text ?? "";
  const doctorPhone = cv(COL.doctorPhone)?.text ?? "";
  const doctorNpi = cv(COL.doctorNpi)?.text ?? "";
  // Email columns render as "<label> - <address>" when the two differ, so the
  // display text is NOT an address. See shared/emailCell.ts.
  const doctorEmail = readEmailCell(cv(COL.doctorEmail));
  const doctorFax = readEmailCell(cv(COL.doctorFax));
  const clinicalsMethod = cv(COL.clinicalsMethod)?.text ?? "";
  const clinic = cv(COL.clinicName)?.text ?? "";
  const clinicAddress = cv(COL.clinicAddress)?.text ?? "";
  const notes = cv(COL.callReferenceNotes)?.text ?? "";
  const memberId1 = cv(COL.memberId1)?.text ?? "";
  const memberId2 = cv(COL.memberId2)?.text ?? "";
  const referralSource = cv(COL.referralSource)?.text ?? "";
  const diagnosis = cv(COL.diagnosis)?.text ?? "";
  const patientPhone = cv(COL.patientPhone)?.text ?? "";
  const patientAddress = cv(COL.patientAddress)?.text ?? "";
  const pumpBrand = cv(COL.pumpBrand)?.text ?? "";
  const dvsStatus = cv(COL.triggerDvs)?.text ?? "";
  const pumpDvsStatus = cv(COL.triggerPumpDvs)?.text ?? "";
  const claimsStatus = cv(COL.claimsStatus)?.text ?? "";
  // Secondary Insurance is a status column with labels: "None", "NY Medicaid",
  // "Medicare Supplement". The text comes back as the label string.
  const secondaryInsurance = cv(COL.secondaryInsurance)?.text ?? "";

  // Parse universal checks from Monday (only present for auth group reads).
  // In-Network and Active are read from their own columns — before the
  // 2026-07-29 board split one column answered both, which meant an
  // in-network-but-inactive patient was indistinguishable from an
  // out-of-network one.
  const inNetwork = parseUniversal(cv(COL.inNetwork), UNIVERSAL_INDEX.inNetwork);
  const active = parseUniversal(cv(COL.active), UNIVERSAL_INDEX.active);
  const dmeBenefits = parseUniversal(cv(COL.dmeBenefits), UNIVERSAL_INDEX.dmeBenefits);

  // Parse per-product auth results from Monday (only present for auth group reads)
  const codes: Partial<Record<ProductCodeId, ProductCodeState>> = {};
  for (const [colId, codeId] of Object.entries(AUTH_COL_TO_CODE_ID)) {
    const text = cv(colId)?.text;
    if (text) {
      const key = text.toLowerCase().trim();
      const mapped = AUTH_RESULT_TEXT_MAP[key];
      codes[codeId] = {
        status: "pending",
        auth: mapped?.auth ?? "",
        sos: mapped?.sos,
        // Store original Monday label for read-only display
        _mondayAuthLabel: text.trim(),
      } as ProductCodeState;
    }
  }

  // Parse per-product submission fields from Monday (method, date, authId, start, end, units)
  const PRODUCT_KEYS: ProductId[] = ["monitor", "sensors", "insulin_pump", "infusion_set", "cartridge"];
  const PRODUCT_KEY_TO_CODE: Record<ProductId, ProductCodeId> = {
    monitor: "cgm-monitor",
    sensors: "cgm-sensors",
    insulin_pump: "pump",
    infusion_set: "infusion-sets",
    cartridge: "cartridges",
  };
  for (const pk of PRODUCT_KEYS) {
    const codeId = PRODUCT_KEY_TO_CODE[pk];
    // Ensure entry exists (auth result parsing may have created it already)
    if (!codes[codeId]) {
      codes[codeId] = { status: "pending" } as ProductCodeState;
    }
    const existing = codes[codeId]!;

    const method = parseAuthMethod(cv(COL.authMethod[pk])?.text);
    if (method) existing.authSubmissionMethod = method;

    const authId = cv(COL.authId[pk])?.text;
    if (authId) existing.authId = authId;

    const subDate = cv(COL.authSubmissionDate[pk])?.text;
    if (subDate) existing.authSubmissionDate = subDate;

    const authStart = cv(COL.authStart[pk])?.text;
    if (authStart) existing.authStart = authStart;

    const authEnd = cv(COL.authEnd[pk])?.text;
    if (authEnd) existing.authEnd = authEnd;

    const authUnits = cv(COL.authUnits[pk])?.text;
    if (authUnits) existing.authUnits = authUnits;
  }

  // Carecentrix Intake ID (single shared column). Applied to EVERY code —
  // the ID is one-per-patient (the Submit Auth card fans it out the same
  // way), and the old method === "Carecentrix Portal" gate was dead code:
  // parseAuthMethod never produces that value, so the ID silently failed
  // to rehydrate into the cards after a reload.
  const intakeText = cv(COL.carecentrixIntakeId)?.text;
  if (intakeText) {
    for (const codeId of Object.keys(codes) as ProductCodeId[]) {
      codes[codeId]!.intakeId = intakeText;
    }
  }

  // Call/Fax Number (single shared column, write-only until 2026-07-20).
  // Rehydrate into every code whose method is Call or Fax so the number
  // survives a reload — without this, the method came back but the number
  // box sat empty, and the new submit validation would demand it again.
  const callFaxText = cv(COL.callFaxNumber)?.text;
  if (callFaxText) {
    for (const codeId of Object.keys(codes) as ProductCodeId[]) {
      const m = codes[codeId]?.authSubmissionMethod;
      if (m === "Call" || m === "Fax") codes[codeId]!.callFaxNumber = callFaxText;
    }
  }

  // Parse SoS from Monday
  const sosText = cv(COL.sos)?.text;
  const sosUniversal = sosText?.toLowerCase().trim();
  // Note: SoS is per-patient, auth result is per-product. We store SoS on the universal level.

  // Per-product SoS — overlay the Not Clear and Skip dropdown reads on
  // top of any sos value the AUTH_RESULT_TEXT_MAP populated. These two
  // dropdowns are the canonical record of which products are flagged
  // not-clear or skip-deferred.
  const notClearSet = parseProductsDropdown(cv(COL.notClearProducts)?.text);
  const skipSet = parseProductsDropdown(cv(COL.skipSosProducts)?.text);
  for (const codeId of notClearSet) {
    if (!codes[codeId]) codes[codeId] = { status: "pending" } as ProductCodeState;
    codes[codeId]!.sos = "not-clear";
  }
  for (const codeId of skipSet) {
    if (!codes[codeId]) codes[codeId] = { status: "pending" } as ProductCodeState;
    codes[codeId]!.sos = "skip";
  }

  // Per-product Last Bill Date — hydrated from the 5 Last Bill Date columns.
  const LAST_BILL_DATE_COLS: Record<ProductId, string> = {
    monitor: COL.lastBillDate.monitor,
    sensors: COL.lastBillDate.sensors,
    insulin_pump: COL.lastBillDate.insulin_pump,
    infusion_set: COL.lastBillDate.infusion_set,
    cartridge: COL.lastBillDate.cartridge,
  };
  for (const pk of PRODUCT_KEYS) {
    const codeId = PRODUCT_KEY_TO_CODE[pk];
    const dateText = cv(LAST_BILL_DATE_COLS[pk])?.text;
    if (dateText) {
      if (!codes[codeId]) codes[codeId] = { status: "pending" } as ProductCodeState;
      codes[codeId]!.lastBillDate = dateText;
    }
  }

  // Benefits redesign — per-product SoS billing FACTS (dates + units +
  // "No Billing History" checkboxes). These are the fuller record: hydrate
  // them over the legacy lastBillDate (which only exists for Not-Clear
  // products) and mark the entry "billed" / "never".
  for (const pk of PRODUCT_KEYS) {
    const codeId = PRODUCT_KEY_TO_CODE[pk];
    const factDate = cv(COL.sosLastBill[pk])?.text;
    const factUnits = cv(COL.sosUnits[pk])?.text;
    if (factDate || factUnits) {
      if (!codes[codeId]) codes[codeId] = { status: "pending" } as ProductCodeState;
      if (factDate) codes[codeId]!.lastBillDate = factDate;
      if (factUnits) codes[codeId]!.units = factUnits;
      codes[codeId]!.sosEntry = "billed";
    } else if (cv(COL.sosNeverBilled[pk])?.text) {
      // Checkbox text is non-empty ("v") only when checked.
      if (!codes[codeId]) codes[codeId] = { status: "pending" } as ProductCodeState;
      codes[codeId]!.sosEntry = "never";
    }
  }

  // Escalation toggle — hydrated from Monday so the Escalate button on the
  // Benefits / Submit Auth / Auth Outstanding pages reflects the current
  // state when the patient loads. "Escalation Required" → on; "Done" or
  // unset → off.
  const escalationText = cv(COL.escalation)?.text?.trim();
  // Insurance escalation split into two labels (2026-07) — either counts as
  // escalated (Manager Escalation Required = index 0, Final = index 2).
  const escalated =
    escalationText === "Manager Escalation Required" ||
    escalationText === "Final Escalation Required";
  // Keep the raw label too — the manager sidebars need to tell the two apart.
  const escalationLabel = escalated ? escalationText : undefined;
  const stageAdvancerText = cv(COL.stageAdvancer)?.text?.trim() ?? "";

  // Days Since Stage Started — status column with index-based ordering
  const daysSinceStage = cv(COL.daysSinceStage)?.text ?? "";
  const daysSinceRaw = cv(COL.daysSinceStage)?.value;
  let daysSinceStageIndex: number | undefined;
  if (daysSinceRaw) {
    try { daysSinceStageIndex = JSON.parse(daysSinceRaw).index; } catch { /* ignore */ }
  }

  // Days Auth Outstanding — number column recalced daily by baseline-cron
  const daysAuthOutstandingText = cv(COL.daysAuthOutstanding)?.text?.trim() ?? "";
  const daysAuthOutstanding =
    daysAuthOutstandingText !== "" && Number.isFinite(Number(daysAuthOutstandingText))
      ? Number(daysAuthOutstandingText)
      : undefined;

  // Never Billed attestations (Medicare A&B)
  const neverBilledIsCarText = cv(COL.neverBilledIsCar)?.text?.trim().toLowerCase() ?? "";
  const neverBilledCgmText = cv(COL.neverBilledCgm)?.text?.trim().toLowerCase() ?? "";
  const neverBilledIsCar = neverBilledIsCarText === "never billed";
  const neverBilledCgm = neverBilledCgmText === "never billed";

  // Benefits redesign — round-trip the "No Billing History" fact where the
  // board can express it. Only the Medicare A&B rollups exist as columns, so
  // per-product "never" state is recoverable ONLY for the products those
  // rollups cover, and only when no billed facts landed for that product.
  // (Known gap: non-Medicare never-billed facts don't round-trip — see the
  // review doc's optional "SoS No Billing History" checkbox item.)
  const seedNever = (codeId: ProductCodeId) => {
    if (!codes[codeId]) codes[codeId] = { status: "pending" } as ProductCodeState;
    if (codes[codeId]!.sosEntry !== "billed") codes[codeId]!.sosEntry = "never";
  };
  if (neverBilledIsCar) {
    seedNever("infusion-sets");
    seedNever("cartridges");
  }
  if (neverBilledCgm) seedNever("cgm-sensors");

  // Follow Up — mirrors Blocked on the Evaluate board
  const followUpText = cv(COL.followUp)?.text?.trim() ?? "";
  const followUpDate = cv(COL.followUpDate)?.text ?? "";

  return {
    id: item.id,
    name: item.name,
    dob,
    product: "CGM",
    payer: primary || "",
    doctorName,
    doctorClinic: clinic,
    doctorPhone,
    doctorNpi,
    doctorEmail,
    doctorFax,
    clinicalsMethod,
    clinicName: clinic,
    clinicAddress,
    contactMethod: "parachute",
    stage: "advanced",
    pillars: { rx: false, records: false, diagnosis: false },
    pathwayChecks: {},
    chaseStep: 0,
    faxPhase: 1,
    profileSendOffNotes: cv(COL.profileSendOffNotes)?.text || undefined,
    mnWorkflowNotes: cv(COL.mnWorkflowNotes)?.text || undefined,
    notes,
    receivedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    owner: "Samantha",
    serving,
    primaryInsurance: primary,
    diagnosis,
    secondaryInsurance,
    memberId1,
    memberId2,
    referralSource: referralSource || undefined,
    carecentrixIntakeId: cv(COL.carecentrixIntakeId)?.text || undefined,
    patientPhone,
    patientAddress,
    pumpBrand,
    dvsStatus: dvsStatus || undefined,
    pumpDvsStatus: pumpDvsStatus || undefined,
    claimsStatus: claimsStatus || undefined,
    escalated,
    escalationLabel,
    stageAdvancerText,
    daysSinceStage: daysSinceStage || undefined,
    daysSinceStageIndex,
    daysAuthOutstanding,
    retryCount: (() => {
      const t = cv(COL.retryCount)?.text?.trim() ?? "";
      return t !== "" && Number.isFinite(Number(t)) ? Number(t) : undefined;
    })(),
    retryNextDate: cv(COL.retryNextDate)?.text || undefined,
    a4230Claim: cv(COL.a4230Claim)?.text || undefined,
    a4232Claim: cv(COL.a4232Claim)?.text || undefined,
    dvsDenialReason: cv(COL.dvsDenialReason)?.text || undefined,
    claimsPaidAmount: cv(COL.claimsPaidAmount)?.text || undefined,
    claimsPaidDate: cv(COL.claimsPaidDate)?.text || undefined,
    claimsDenialReason: cv(COL.claimsDenialReason)?.text || undefined,
    claimsError: cv(COL.claimsError)?.text || undefined,
    ipClaimsStatus: cv(COL.ipClaimsStatus)?.text || undefined,
    ipClaimsPaidAmount: cv(COL.ipClaimsPaidAmount)?.text || undefined,
    ipClaimsPaidDate: cv(COL.ipClaimsPaidDate)?.text || undefined,
    ipClaimsDenialReason: cv(COL.ipClaimsDenialReason)?.text || undefined,
    ipClaimsError: cv(COL.ipClaimsError)?.text || undefined,
    followUp: followUpText,
    followUpDate,
    planName: cv(COL.planName)?.text || undefined,
    homePlan: cv(COL.homePlan)?.text || undefined,
    stediQmb: cv(COL.stediQmb)?.text || undefined,
    stediCoinsurance: cv(COL.stediCoinsurance)?.text || undefined,
    stediPlanBegin: cv(COL.stediPlanBegin)?.text || undefined,
    deductibleRemaining: cv(COL.deductibleRemaining)?.text || undefined,
    oopMaxRemaining: cv(COL.oopMaxRemaining)?.text || undefined,
    insurance: {
      universal: {
        "in-network": inNetwork,
        active,
        "dme-benefits": dmeBenefits,
      },
      codes,
      neverBilledIsCar,
      neverBilledCgm,
    } as InsuranceState,
  };
}
