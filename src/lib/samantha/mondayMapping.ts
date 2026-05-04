// Mapping between Monday status labels and our internal types.

import type { Patient, InsuranceState, ProductCodeState, ProductCodeId, UniversalChoice, AuthChoice, SosChoice } from "./workflow";
import type { PrimaryInsurance, Serving, ProductId } from "./hcpcRules";
import { PRIMARY_INSURANCE_OPTIONS, SERVING_OPTIONS } from "./hcpcRules";
import { COL, type MondayItem } from "./mondayApi";
// Reverse: Monday dropdown text → AuthSubmissionMethod
import type { AuthSubmissionMethod } from "./workflow";
import { AUTH_SUBMISSION_METHODS } from "./workflow";

function parseAuthMethod(text: string | null | undefined): AuthSubmissionMethod {
  if (!text) return "";
  const norm = text.trim();
  return (AUTH_SUBMISSION_METHODS.find((m) => m.toLowerCase() === norm.toLowerCase()) as AuthSubmissionMethod) ?? "";
}


// Universal-check write indices
export const UNIVERSAL_INDEX = {
  activeNetwork: { pass: 1, fail: 2 }, // 1=Active/In-network, 2=Stuck
  dmeBenefits: { pass: 1, fail: 2 },   // 1=Yes, 2=Partial / No
  sos: { pass: 1, fail: 2, skip: 0 },  // 1=All Clear, 2=Partial / Not Clear, 0=Skip
  auth: { noAuth: 1, required: 0 },    // 0=Auths Required, 1=No Auths Required
} as const;

// Escalation column indices
export const ESCALATION_INDEX = {
  required: 0,
  done: 1,
} as const;

// Stage Advancer indices
export const STAGE_INDEX = {
  stuck: 2,
  benefitsSos: 3,
  authorization: 4,
  authOutstanding: 6,
  complete: 7,
} as const;

// "Not Clear Products" dropdown option ids (per Monday board config)
export const NOT_CLEAR_PRODUCT_ID: Record<ProductCodeId, number> = {
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

// Map Monday universal status text → internal UniversalChoice
function parseUniversal(text: string | null | undefined): UniversalChoice {
  if (!text) return "";
  const t = text.toLowerCase().trim();
  if (t === "active/in-network" || t === "yes" || t === "all clear") return "confirmed";
  if (t === "stuck" || t === "partial / no" || t === "partial / not clear") return "not-confirmed";
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
  const doctorEmail = cv(COL.doctorEmail)?.text ?? "";
  const doctorFax = cv(COL.doctorFax)?.text ?? "";
  const clinicalsMethod = cv(COL.clinicalsMethod)?.text ?? "";
  const clinic = cv(COL.clinicName)?.text ?? "";
  const notes = cv(COL.callReferenceNotes)?.text ?? "";
  const memberId1 = cv(COL.memberId1)?.text ?? "";
  const memberId2 = cv(COL.memberId2)?.text ?? "";
  const diagnosis = cv(COL.diagnosis)?.text ?? "";
  // Secondary Insurance is a status column with labels: "None", "NY Medicaid",
  // "Medicare Supplement". The text comes back as the label string.
  const secondaryInsurance = cv(COL.secondaryInsurance)?.text ?? "";

  // Parse universal checks from Monday (only present for auth group reads)
  const activeNetText = cv(COL.activeNetwork)?.text;
  const dmeText = cv(COL.dmeBenefits)?.text;
  const inNetAndActive = parseUniversal(activeNetText);
  const dmeBenefits = parseUniversal(dmeText);

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

  // Carecentrix Intake ID (single shared column)
  const intakeText = cv(COL.carecentrixIntakeId)?.text;
  if (intakeText) {
    // Apply to all product codes that use Carecentrix
    for (const codeId of Object.keys(codes) as ProductCodeId[]) {
      if (codes[codeId]?.authSubmissionMethod === "Carecentrix Portal") {
        codes[codeId]!.intakeId = intakeText;
      }
    }
  }

  // Parse SoS from Monday
  const sosText = cv(COL.sos)?.text;
  const sosUniversal = sosText?.toLowerCase().trim();
  // Note: SoS is per-patient, auth result is per-product. We store SoS on the universal level.

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
    contactMethod: "parachute",
    stage: "advanced",
    pillars: { rx: false, records: false, diagnosis: false },
    pathwayChecks: {},
    chaseStep: 0,
    faxPhase: 1,
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
    insurance: {
      universal: {
        "in-network": inNetAndActive,
        active: inNetAndActive,
        "dme-benefits": dmeBenefits,
      },
      codes,
    } as InsuranceState,
  };
}
