// Monday board column mappings for Medical Necessity (18406060017)

import type { Patient } from "./workflow";
import type { MondayItem, MondayColumnValue } from "./mondayApi";
import { readEmailCell } from "../shared/emailCell";

// ---- Sub-Stage index → tab mapping ----
export const SUB_STAGE_INDEX = {
  evaluate: 8,        // 2A. Evaluate Medical Necessity
  sendRequest: 9,     // 2B. Send Request
  confirmReceipt: 10, // 2C. Confirm Receipt
  chase: 11,          // 2D. Chase Clinicals
  // Doctor Appointment (2026-08-03). Index 0, NOT 12 — Monday assigns the index
  // when a label is created in the UI and it picked the lowest free slot, which
  // happened to be 0 (this column's other labels start at 8). Verified against
  // the live board; a status write by index is silent if the index has no
  // label, so confirm the settings_str before changing this.
  doctorAppointment: 0,
  completed: 14,      // Final stage — clinicals received
} as const;

/** Sub-Stage label text, keyed by index. The Sub-Stage column IS the stage
 *  advancer on this board (see SendRequestPanel's Mark Complete — it passes
 *  COL.subStage as `stageColumnId`, "the single write that moves the item"), so
 *  moving a patient between sub-stages needs no board automation. */
export const SUB_STAGE_LABEL = {
  [SUB_STAGE_INDEX.evaluate]: "Evaluate MN",
  [SUB_STAGE_INDEX.sendRequest]: "Send Request",
  [SUB_STAGE_INDEX.confirmReceipt]: "Confirm Receipt",
  [SUB_STAGE_INDEX.chase]: "Chase Clinicals",
  [SUB_STAGE_INDEX.doctorAppointment]: "Doctor Appointment",
  [SUB_STAGE_INDEX.completed]: "Completed",
} as const;

// ---- Advancer indices ----
export const ADVANCER_2A_INDEX = { reviewAwaiting: 0, evaluate: 1, complete: 2, stuck: 3 } as const;
export const ADVANCER_2B_INDEX = { ready: 0, complete: 1, stuck: 2 } as const;
export const ADVANCER_2C_INDEX = { ready: 0, complete: 1, stuck: 2 } as const;
export const ADVANCER_2D_INDEX = { ready: 0, complete: 1 } as const;

// ---- Clinical eval status indices ----
// Most checklist items share: 0=Evaluate, 1=Not Serving, 2=Collect, 3=Valid
export const EVAL_STATUS = { evaluate: 0, notServing: 1, collect: 2, valid: 3 } as const;

// Blood Sugar Issues has different order: 0=Evaluate, 1=Valid, 2=Not Serving, 3=Collect
export const BLOOD_SUGAR_STATUS = { evaluate: 0, valid: 1, notServing: 2, collect: 3 } as const;

// Hypo/Insulin Language: 0=Evaluate, 1=Valid, 2=Collect, 3=Not Needed
export const LANGUAGE_STATUS = { evaluate: 0, valid: 1, collect: 2, notNeeded: 3 } as const;

// MRs/Clinicals: 0=Evaluate, 1=MR Received, 3=Collect
export const MR_STATUS = { evaluate: 0, received: 1, collect: 3 } as const;

// Medical Necessity: 0=Not Established, 1=Established
export const MED_NEC_STATUS = { notEstablished: 0, established: 1 } as const;

// Generate Script: 0=Ready, 1=Generate, 2=Not Needed
export const GEN_SCRIPT_STATUS = { ready: 0, generate: 1, notNeeded: 2 } as const;

// MN Attempts: 0=Escalate, 1=Attempt 3, 2=Attempt 1, 3=Attempt 2
export const MN_ATTEMPTS_INDEX = { escalate: 0, attempt3: 1, attempt1: 2, attempt2: 3 } as const;

// Escalation (color_mm1x7997). Labels were renamed on the board (2026-07):
//   0 = "Manager Escalation Required", 1 = "Done", 2 = "Final Escalation Required".
// The app writes this by INDEX and — since the rename — reads it by INDEX too, so a
// future label rename can't silently break escalation detection. Index 0
// (manager) is "escalated"; index 2 (final) is the rep's "proposed stuck" signal
// (leaves the queue for the manager's Final Decisions), handled separately.
export const ESCALATION_INDEX = { required: 0, done: 1, finalRequired: 2 } as const;

/** Status indices that mean the patient is escalated to a MANAGER (index 0).
 *  Final Escalation Required (index 2) is NOT here — it's proposed-stuck. */
export const ESCALATED_INDICES: readonly number[] = [
  ESCALATION_INDEX.required,
];

/** True when an escalation status index represents an escalated (to manager) state. */
export function isEscalatedIndex(index: number | null | undefined): boolean {
  return index != null && ESCALATED_INDICES.includes(index);
}

/** True when the escalation index is Final Escalation Required — the rep's
 *  "proposed stuck" signal (leaves the queue → the manager's Final Decisions). */
export function isProposedStuckIndex(index: number | null | undefined): boolean {
  return index === ESCALATION_INDEX.finalRequired;
}

// Clinicals Method: 0=Fax, 1=Parachute, 2=Email
export const CLINICALS_METHOD_INDEX = { fax: 0, parachute: 1, email: 2 } as const;

// Blocked: 0=Blocked
// Follow Up: 1=Follow Up (index 1 = "Done" label, repurposed)
export const BLOCKED_INDEX = { blocked: 0 } as const;
export const FOLLOW_UP_INDEX = { followUp: 1 } as const;

// ---- Item → Patient conversion ----
function col(item: MondayItem, id: string): string {
  return item.column_values.find((c: MondayColumnValue) => c.id === id)?.text ?? "";
}

/** Read an email/fax column as an ADDRESS, not as its display rendering. */
function emailCol(item: MondayItem, id: string): string {
  return readEmailCell(item.column_values.find((c: MondayColumnValue) => c.id === id));
}

/** Parse a status column's selected index from its raw `value` JSON. Returns null
 *  when unset/unparseable. Prefer this over matching label text for status columns
 *  whose labels can be renamed on the board (e.g. Escalation — see ESCALATION_INDEX). */
export function colIndex(item: MondayItem, id: string): number | null {
  const raw = item.column_values.find((c: MondayColumnValue) => c.id === id)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { index?: number } | null;
    return typeof parsed?.index === "number" ? parsed.index : null;
  } catch {
    return null;
  }
}

export function mondayItemToPatient(item: MondayItem): Patient {
  return {
    id: item.id,
    name: item.name,
    groupId: item.group?.id,
    gender: col(item, "color_mm1x1bdg") || undefined,
    dob: col(item, "text_mm1xvxst"),
    phone: col(item, "phone_mm1x44yk") || undefined,
    address: col(item, "location_mm1xhw17") || undefined,
    primaryInsurance: col(item, "color_mm1x157j") || undefined,
    memberId1: col(item, "text_mm1x2qk2") || undefined,
    memberId2: col(item, "text_mm1xaccx") || undefined,
    serving: col(item, "color_mm1w1cm9") || undefined,
    referralType: col(item, "color_mm1wm4n4") || undefined,
    referralSource: col(item, "color_mm1w5wxr") || undefined,
    pumpType: col(item, "color_mm1wjjtk") || undefined,
    cgmType: col(item, "color_mm1w7pmf") || undefined,
    requestType: col(item, "color_mm1w1978") || undefined,
    ipCoveragePath: col(item, "color_mm1w5xn1") || undefined,
    cgmCoveragePath: col(item, "color_mm1w7e5q") || undefined,
    doctorName: col(item, "text_mm1x46et") || undefined,
    doctorNpi: col(item, "text_mm1x7d91") || undefined,
    clinicalsMethod: col(item, "color_mm1xw7y5") || undefined,
    doctorPhone: col(item, "phone_mm1xz8c0") || undefined,
    // Email columns render as "<label> - <address>" when the two differ, so
    // col()'s display text is NOT an address. See shared/emailCell.ts.
    doctorEmail: emailCol(item, "email_mm1x6fq5") || undefined,
    doctorFax: emailCol(item, "email_mm1xdzcj") || undefined,
    clinicName: col(item, "dropdown_mm1xbvas") || undefined,
    clinicAddress: col(item, "location_mm1xjnfv") || undefined,
    prescriberRequirements: col(item, "text_mm4b45rh") || undefined,
    patientEmail: col(item, "text_mm1xc140") || undefined,
    masterStage: col(item, "color_mm1ws96t") || undefined,
    subStage: col(item, "color_mm1wyr92") || undefined,
    // Proposed Stuck is now the Escalation column at index 2 ("Final Escalation
    // Required") — no separate column. The rep's reason lives in the MN notes
    // (stamped), not its own column (Manager Views rework 2026-07).
    proposedStuck: colIndex(item, "color_mm1x7997") === ESCALATION_INDEX.finalRequired,
    daysSinceIntake: col(item, "color_mm1xwabn") || undefined,
    daysSinceStageStart: col(item, "color_mm1wwm05") || undefined,
    dateOfIntake: col(item, "date_mm1wf43j") || undefined,
    dateOfStageStart: col(item, "date_mm1w6jeq") || undefined,
    evaluationCounter: col(item, "numeric_mm4bhjc8") || undefined,
    // Eval checklist
    cgmScript: col(item, "color_mm1w8mp1") || undefined,
    cgmScriptReceived: col(item, "color_mm44h0fx") || undefined,
    cgmLanguage: col(item, "color_mm4bb5sm") || undefined,
    hypoLanguage: col(item, "color_mm1whggs") || undefined,
    insulinLanguage: col(item, "color_mm1wgrst") || undefined,
    ipScript: col(item, "color_mm1wsbk5") || undefined,
    ipScriptReceived: col(item, "color_mm44chc8") || undefined,
    diabetesEducation: col(item, "color_mm1wjsyq") || undefined,
    threeInjections: col(item, "color_mm1wj1v8") || undefined,
    cgmUse: col(item, "color_mm1wgpek") || undefined,
    bloodSugarIssues: col(item, "color_mm1wpcrd") || undefined,
    lmn: col(item, "color_mm1wdcsf") || undefined,
    oowDate: col(item, "color_mm1wmv5c") || undefined,
    oowDateValue: col(item, "date_mm4kyfte") || undefined,
    malfunction: col(item, "color_mm1wp4e9") || undefined,
    diagnosis: col(item, "color_mm1wf7rv") || undefined,
    mrsClinicals: col(item, "color_mm1y8rv8") || undefined,
    lastVisit: col(item, "date_mm1wb9br") || undefined,
    mrExpiryDate: col(item, "date_mm1ymthz") || undefined,
    medicalNecessity: col(item, "color_mm1y6qrf") || undefined,
    mnEvalNotes: col(item, "text_mm6vevjf") || undefined,
    generalMnInvalidReasons: col(item, "dropdown_mm2xppn8") || undefined,
    cgmMnInvalidReasons: col(item, "dropdown_mm2xncfh") || undefined,
    ipMnInvalidReasons: col(item, "dropdown_mm2xgg2y") || undefined,
    ipMnNoReasons: col(item, "dropdown_mm4bwxpv") || undefined,
    mnRequestConsolidated: col(item, "dropdown_mm2yd3a2") || undefined,
    requestSentAt: col(item, "date_mm2yg8x8") || undefined,
    requestBody: col(item, "long_text_mm4cnw52") || undefined,
    generateCgmScript: col(item, "color_mm1w2ey") || undefined,
    generateIpScript: col(item, "color_mm1w4wd8") || undefined,
    confirmChaseNotes: col(item, "long_text_mm2ytsxp") || undefined,
    confirmReceiptNotes: col(item, "text_mm1wbe5y") || undefined,
    confirmAttempt1: col(item, "text_mm2yd068") || undefined,
    confirmAttempt2: col(item, "text_mm2y9h4a") || undefined,
    confirmAttempt3: col(item, "text_mm2ymtsk") || undefined,
    chaseAttempt1: col(item, "text_mm2yhpjt") || undefined,
    chaseAttempt2: col(item, "text_mm2yb3rv") || undefined,
    chaseAttempt3: col(item, "text_mm2ybk06") || undefined,
    receiptConfirmedName: col(item, "text_mm1wj9at") || undefined,
    receiptConfirmedDate: col(item, "date_mm1wxpdk") || undefined,
    chaseRecipientName: col(item, "text_mm1wabj9") || undefined,
    mnAttempts: col(item, "color_mm1wz0vg") || undefined,
    nextActionDate: col(item, "date_mm1wadgs") || undefined,
    escalation: col(item, "color_mm1x7997") || undefined,
    escalationIndex: colIndex(item, "color_mm1x7997") ?? undefined,
    advancer2a: col(item, "color_mm1w73jx") || undefined,
    advancer2b: col(item, "color_mm1wfbkz") || undefined,
    advancer2c: col(item, "color_mm1wf98t") || undefined,
    advancer2d: col(item, "color_mm1wcsbv") || undefined,
    blocked: col(item, "color_mm33ppgw") || undefined,
    followUp: col(item, "color_mm35v6a0") || undefined,
    followUpDate: col(item, "date_mm35kbkj") || undefined,
    blockedDate: col(item, "date_mm33vqkm") || undefined,
    // Doctor Appointments (2026-08-03)
    appointmentDate: col(item, "date_mm5w2vsf") || undefined,
    profileSendOffNotes: col(item, "text_mm3xdze1") || undefined,
    notes: "",
  };
}
