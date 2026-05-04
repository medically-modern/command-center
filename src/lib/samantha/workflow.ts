// Medically Modern · Medical Evaluation Workflow data model
// Source of truth for stages, pillars, coverage pathways, and chase protocols.

import {
  isAutoFilledMedicaidSupply,
  PRODUCT_LABELS,
  resolveHcpcs,
  type PrimaryInsurance,
  type ProductId,
  type Serving,
} from "./hcpcRules";

export type StageId =
  | "intake"
  | "evaluation"
  | "doctor-request"
  | "re-evaluation"
  | "advanced"
  | "insurance-cleared"
  | "welcome-call"
  | "escalated";

export type PathwayId =
  | "cgm-p1"
  | "cgm-p2"
  | "pump-p1"
  | "pump-p2"
  | "pump-p3"
  | "pump-p4"
  | "pump-p5"
  | "supplies-s1";

export type ContactMethod = "parachute" | "fax";

export interface ChecklistItem {
  id: string;
  label: string;
  hint?: string;
}

export interface Pathway {
  id: PathwayId;
  group: "CGM" | "Pump" | "Supplies";
  code: string;
  name: string;
  tag: string;
  items: ChecklistItem[];
  language?: string;
}

export const PILLARS: ChecklistItem[] = [
  {
    id: "rx",
    label: "Valid Prescription",
    hint: "Signed Rx for each product (CGM and/or pump). Signature stamps not acceptable.",
  },
  {
    id: "records",
    label: "Clinical Notes / Medical Records",
    hint: "Office visit encounter date within the last 6 months.",
  },
  {
    id: "diagnosis",
    label: "Diabetes Diagnosis",
    hint: "Valid ICD-10 code (E10.x, E11.x, etc.) in the clinical records.",
  },
];

export const PATHWAYS: Pathway[] = [
  {
    id: "cgm-p1",
    group: "CGM",
    code: "P1",
    name: "Insulin Use",
    tag: "CGM · INSULIN",
    items: [
      { id: "insulin-evidence", label: "Evidence of insulin use found in records" },
      { id: "insulin-meds", label: "Insulin brand listed in medication list (any)" },
    ],
    language:
      "Any mention of insulin use qualifies — MDI, basal, bolus, insulin pen/pump references, or medication list entries (Humalog, Lantus, Novolog, Tresiba, etc.).",
  },
  {
    id: "cgm-p2",
    group: "CGM",
    code: "P2",
    name: "Hypoglycemia History",
    tag: "CGM · HYPOGLYCEMIA",
    items: [
      { id: "hypo-event", label: "≥1 Level 2 hypoglycemic event documented (<54 mg/dL)" },
      { id: "hypo-adjustments", label: "≥2 treatment plan adjustments referenced" },
    ],
    language:
      "Patient experienced at least one Level 2 hypoglycemic event (<54 mg/dL) despite modifications. Notes should reference at least two adjustment attempts.",
  },
  {
    id: "pump-p1",
    group: "Pump",
    code: "P1",
    name: "1st Pump · MDI > 6 Months",
    tag: "PUMP · FIRST TIME",
    items: [
      { id: "mdi-current", label: "First-time pump user on MDI (3+ injections/day)" },
      { id: "mdi-6mo", label: "MDI documented for ≥6 months" },
      { id: "cgm-use", label: "CGM use documented in notes" },
      { id: "dsme", label: "Diabetes self-management education completed" },
      { id: "bg-justification", label: "≥1 BG justification (A1c>7%, recurrent hypo, variability, dawn phenomenon, severe excursions)" },
    ],
    language:
      "Notes must show comprehensive diabetes education completed and document that injections are not adequately controlling blood sugars.",
  },
  {
    id: "pump-p2",
    group: "Pump",
    code: "P2",
    name: "1st Pump · MDI < 6 Months",
    tag: "PUMP · FIRST TIME",
    items: [
      { id: "p1-met", label: "All P1 requirements met" },
      { id: "lmn-signed", label: "Letter of Medical Necessity (LMN) obtained and signed" },
      { id: "lmn-language", label: "LMN explicitly states life-threatening need" },
    ],
    language:
      "Separate signed LMN required — clinical notes alone insufficient. LMN must use explicit life-threatening language.",
  },
  {
    id: "pump-p3",
    group: "Pump",
    code: "P3",
    name: "OOW Pump Replacement",
    tag: "PUMP · REPLACEMENT",
    items: [
      { id: "oow", label: "Pump confirmed beyond 4-year warranty" },
      { id: "malfunction", label: "Malfunction reason documented" },
      { id: "no-repair", label: "Documentation pump cannot be repaired or safely continued" },
    ],
    language:
      "Insurance replaces pumps every 4 years. Records must confirm out-of-warranty status and clinical reason current device cannot continue.",
  },
  {
    id: "pump-p4",
    group: "Pump",
    code: "P4",
    name: "New Insurance · In-Warranty Switch",
    tag: "PUMP · SPECIAL",
    items: [
      { id: "switched-plans", label: "Patient switched insurance plans" },
      { id: "no-history", label: "Existing pump does NOT appear in new payer history" },
      { id: "p1-rules", label: "Medical necessity built under first-time pump (P1) rules" },
    ],
    language:
      "Medically Modern special offering — if new payer has no record of an active pump, treat as new pump under first-time rules.",
  },
  {
    id: "pump-p5",
    group: "Pump",
    code: "P5",
    name: "Omnipod → Tandem Switch",
    tag: "PUMP · SWITCH",
    items: [
      { id: "on-omnipod", label: "Patient currently on Omnipod (pharmacy-only)" },
      { id: "switch-reason", label: "Clinical reason for switching to Tandem documented" },
    ],
    language:
      "Specific Omnipod-switch language requirements TBD — confirm with team. Omnipod is pharmacy-only; this covers patients moving to Tandem.",
  },
  {
    id: "supplies-s1",
    group: "Supplies",
    code: "S1",
    name: "Supplies Only",
    tag: "PUMP · SUPPLIES",
    items: [{ id: "established", label: "Patient already established on a pump" }],
    language: "Straightforward resupply — basic script and records sufficient.",
  },
];

export const STAGE_LABELS: Record<StageId, string> = {
  intake: "Intake",
  evaluation: "Stage 1 · Necessity Review",
  "doctor-request": "Stage 2 · Doctor Request",
  "re-evaluation": "Stage 3 · Re-evaluation",
  advanced: "Samantha · Insurance & Benefits",
  "insurance-cleared": "Insurance Cleared → Welcome Call",
  "welcome-call": "Welcome Call Scheduled",
  escalated: "Escalated → Janelle",
};

// ============================================================
// SAMANTHA · Insurance & Benefits Workflow
// ============================================================

export interface UniversalCheck {
  id: "in-network" | "active" | "dme-benefits";
  label: string;
  hint: string;
}

export const UNIVERSAL_CHECKS: UniversalCheck[] = [
  {
    id: "in-network",
    label: "In-Network Confirmed",
    hint: "Medically Modern is in-network with this payer.",
  },
  {
    id: "active",
    label: "Insurance Active",
    hint: "Patient's insurance is currently active and valid.",
  },
  {
    id: "dme-benefits",
    label: "DME Benefits Confirmed",
    hint: "Coverage is under DME — not pharmacy — for the codes being served.",
  },
];

export type ProductCodeId =
  | "cgm-monitor"
  | "cgm-sensors"
  | "pump"
  | "infusion-sets"
  | "cartridges";

export type CodeStatus = "pending" | "clear" | "auth-required" | "auth-approved" | "blocker";

export interface ProductCode {
  id: ProductCodeId;
  group: "CGM" | "Pump";
  name: string;
  cadence: "ONE-TIME" | "RECURRING";
  hcpcs: string;
  codeOptions?: string[]; // for payer-variant codes
  billingNote: string;
  appliesTo: Array<Patient["product"]>;
}

export const PRODUCT_CODES: ProductCode[] = [
  {
    id: "cgm-monitor",
    group: "CGM",
    name: "CGM Monitor",
    cadence: "ONE-TIME",
    hcpcs: "E2103",
    billingNote:
      "Monitor is billed once. Same or similar lookback window applies — confirm with payer on validation call.",
    appliesTo: ["CGM", "CGM + Pump"],
  },
  {
    id: "cgm-sensors",
    group: "CGM",
    name: "CGM Sensors",
    cadence: "RECURRING",
    hcpcs: "A4239",
    billingNote:
      "Razor-blade model. Fill timing critical — billing too soon means no payment. Sensors ship on a 60 or 90 day cycle.",
    appliesTo: ["CGM", "CGM + Pump"],
  },
  {
    id: "pump",
    group: "Pump",
    name: "Insulin Pump",
    cadence: "ONE-TIME",
    hcpcs: "E0784",
    billingNote:
      "Pump billed once. Insurance allows replacement every 4 years — confirm prior pump billing is outside that window.",
    appliesTo: ["Pump", "CGM + Pump", "Supplies"],
  },
  {
    id: "infusion-sets",
    group: "Pump",
    name: "Infusion Sets",
    cadence: "RECURRING",
    hcpcs: "A4224 / A4230 / A4231",
    codeOptions: ["A4224", "A4230", "A4231"],
    billingNote:
      "Code varies by payer — confirm on validation call. If patient has Medicaid, infusion sets must be billed to Medicaid (not managed Medicaid plan).",
    appliesTo: ["Pump", "CGM + Pump", "Supplies"],
  },
  {
    id: "cartridges",
    group: "Pump",
    name: "Cartridges",
    cadence: "RECURRING",
    hcpcs: "A4225 / A4232",
    codeOptions: ["A4225", "A4232"],
    billingNote:
      "Code varies by payer — confirm on validation call. Medicaid routing applies same as infusion sets.",
    appliesTo: ["Pump", "CGM + Pump", "Supplies"],
  },
];

export type AuthChoice = "" | "not-required" | "required";
export type SosChoice = "" | "clear" | "not-clear" | "skip";

export type AuthSubmissionMethod =
  | ""
  | "Availity Portal"
  | "Call"
  | "Fax"
  | "Payer Portal";

export const AUTH_SUBMISSION_METHODS: Exclude<AuthSubmissionMethod, "">[] = [
  "Availity Portal",
  "Call",
  "Fax",
  "Payer Portal",
];

export interface ProductCodeState {
  status: CodeStatus;
  selectedCode?: string; // chosen variant for payer-specific codes
  authRequired?: boolean;
  authSubmittedAt?: string;
  authApprovedAt?: string;
  notes?: string;
  auth?: AuthChoice;
  sos?: SosChoice;
  // Authorizations tab — local only
  authSubmissionMethod?: AuthSubmissionMethod;
  authSubmissionDate?: string; // YYYY-MM-DD
  authId?: string;
  authStart?: string; // YYYY-MM-DD
  authEnd?: string;   // YYYY-MM-DD
  authUnits?: string;
  intakeId?: string; // Carecentrix Portal only
  callFaxNumber?: string; // Phone or fax number used when method is Call/Fax
  authOutstandingResult?: "auth-valid" | "denied" | "no-auth-needed" | "";
  /** Original Monday auth result label — populated when reading from auth groups, used for read-only display */
  _mondayAuthLabel?: string;
}

export type UniversalChoice = "" | "confirmed" | "not-confirmed";

export interface InsuranceState {
  universal: Record<UniversalCheck["id"], UniversalChoice>;
  codes: Partial<Record<ProductCodeId, ProductCodeState>>;
}

export const EMPTY_INSURANCE: InsuranceState = {
  universal: {
    "in-network": "",
    active: "",
    "dme-benefits": "",
  },
  codes: {},
};

// Chase protocols
export const PARACHUTE_STEPS = [
  { label: "Send request via Parachute Health", snoozeHrs: 0 },
  { label: "Snooze 48 hrs", snoozeHrs: 48 },
  { label: "Follow-up on Parachute confirming receipt", snoozeHrs: 0 },
  { label: "Snooze 48 hrs", snoozeHrs: 48 },
  { label: "Escalate to Janelle", snoozeHrs: 0, escalate: true },
];

export const FAX_PHASE1_STEPS = [
  { label: "Attempt 1 — send fax + call within 5 min", snoozeHrs: 0 },
  { label: "Attempt 2 (24 hrs later)", snoozeHrs: 24 },
  { label: "Attempt 3 (24 hrs later)", snoozeHrs: 24 },
  { label: "Escalate to Janelle", snoozeHrs: 0, escalate: true },
];

export const FAX_PHASE2_STEPS = [
  { label: "Snooze 72 hrs · prep documents", snoozeHrs: 72 },
  { label: "Call clinic — reference confirming person", snoozeHrs: 0 },
  { label: "Snooze 72 hrs · repeat call", snoozeHrs: 72 },
  { label: "Final call (72 hrs)", snoozeHrs: 72 },
  { label: "Escalate to Janelle", snoozeHrs: 0, escalate: true },
];

export interface AccountabilityLog {
  representativeName: string;
  representativeTitle: string;
  confirmedAt: string; // ISO
}

export interface Patient {
  id: string;
  name: string;
  dob: string;
  product: "CGM" | "Pump" | "Supplies" | "CGM + Pump";
  payer: string;
  doctorName: string;
  doctorClinic: string;
  contactMethod: ContactMethod;
  pathwayId?: PathwayId;
  stage: StageId;
  pillars: Record<string, boolean>;
  pathwayChecks: Record<string, boolean>;
  chaseStep: number;
  faxPhase: 1 | 2;
  accountability?: AccountabilityLog;
  notes: string;
  receivedAt: string; // ISO
  lastUpdated: string; // ISO
  owner: "Masheke" | "Janelle" | "Samantha";
  insurance?: InsuranceState;
  hasMedicaid?: boolean;
  serving?: Serving | "";
  primaryInsurance?: PrimaryInsurance | "";
  diagnosis?: string;
  /** Secondary insurance label (e.g. "NY Medicaid"). Drives Medicaid routing
   *  for supplies when primary is Fidelis Medicaid or Anthem BCBS Medicaid (JLJ). */
  secondaryInsurance?: string;
  memberId1?: string;
  memberId2?: string;
  escalated?: boolean;
  // Doctor info — surfaced in the collapsible Doctor Info row of the
  // patient profile across every tab.
  doctorPhone?: string;
  doctorNpi?: string;
  doctorEmail?: string;
  doctorFax?: string;
  clinicalsMethod?: string;
  clinicName?: string;
}

export function deriveInsuranceOutcome(ins?: InsuranceState, servedCodeIds?: ProductCodeId[]):
  | "incomplete"
  | "all-clear"
  | "auth-required"
  | "blocker" {
  if (!ins) return "incomplete";
  const uVals = Object.values(ins.universal);
  const universalAllConfirmed = uVals.every((v) => v === "confirmed");
  const anyUniversalNotConfirmed = uVals.some((v) => v === "not-confirmed");
  // Only consider served products if provided; otherwise fall back to all non-empty codes
  const codeStates = servedCodeIds
    ? (servedCodeIds.map((id) => ins.codes[id]).filter(Boolean) as ProductCodeState[])
    : (Object.values(ins.codes).filter(Boolean) as ProductCodeState[]).filter(c => c.auth || c.sos);
  const anyProductFilled = codeStates.some((c) => c.auth || c.sos);
  // Nothing started yet
  if (codeStates.length === 0 && !anyProductFilled && uVals.every((v) => !v)) return "incomplete";
  // Any universal check explicitly not confirmed → blocker (escalate)
  if (anyUniversalNotConfirmed) return "blocker";
  // Universal checks not all confirmed yet (still pending) → incomplete
  if (!universalAllConfirmed) return "incomplete";
  // Still filling product dropdowns — Auth AND SoS are both required
  // for every served product (no auth-required skip carve-out).
  if (
    codeStates.length === 0 ||
    codeStates.some((c) => !c.auth || !c.sos)
  ) {
    return "incomplete";
  }
  // Any product's SoS not clear → blocker (escalate)
  if (codeStates.some((c) => c.sos === "not-clear")) return "blocker";
  // Auths required is fine — not an escalation
  if (codeStates.some((c) => c.auth === "required")) return "auth-required";
  return "all-clear";
}

// ─────────────────────────────────────────────────────────────────────
// Benefits-tab submit validation
// ─────────────────────────────────────────────────────────────────────

const PRODUCT_TO_CODE_ID_VALIDATOR: Record<ProductId, ProductCodeId> = {
  monitor: "cgm-monitor",
  sensors: "cgm-sensors",
  insulin_pump: "pump",
  infusion_set: "infusion-sets",
  cartridge: "cartridges",
};

const UNIVERSAL_LABELS: Record<string, string> = {
  "in-network": "In-Network Confirmed",
  "active": "Insurance Active",
  "dme-benefits": "DME Benefits Confirmed",
};

/**
 * Returns a list of human-readable labels for fields that are required
 * but not yet filled on the Benefits tab. Empty array means the patient
 * is ready to Send to Monday.
 *
 * Rules (in lockstep with InsurancePanel.tsx):
 *   - All 3 universal checks must be picked (Confirmed or Not Confirmed).
 *   - Each VISIBLE served product (Medicaid-routed supplies are hidden
 *     and auto-filled, so they're skipped) must have BOTH Auth and SoS
 *     selected.
 */
export function validateBenefitsForSubmit(patient: Patient): string[] {
  const missing: string[] = [];
  const ins = patient.insurance ?? EMPTY_INSURANCE;

  // Universal checks
  for (const id of ["in-network", "active", "dme-benefits"] as const) {
    if (!ins.universal[id]) {
      missing.push(UNIVERSAL_LABELS[id] ?? id);
    }
  }

  // Per-product Auth + SoS (visible products only)
  const resolved = resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  );
  const visible = resolved.filter((r) => !isAutoFilledMedicaidSupply(r));
  for (const r of visible) {
    const codeId = PRODUCT_TO_CODE_ID_VALIDATOR[r.product];
    const state = ins.codes[codeId];
    if (!state?.auth) missing.push(`${PRODUCT_LABELS[r.product]} · Auth Requirements`);
    if (!state?.sos) missing.push(`${PRODUCT_LABELS[r.product]} · Same or Similar`);
  }

  return missing;
}

