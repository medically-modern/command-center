// Batch writer for Medical Necessity "Send to Monday"

import { writeStatusIndex, writeText, writeLongText, writeDate, writeDateTime, writeStatusLabel, readColumnTexts, COL } from "./mondayApi";
import { executeWritesWithVerification, type WriteProgressPhase } from "../shared/verifiedWrite";
import { etNow, etToday, clampToBusinessDay } from "./etDate";
import {
  SUB_STAGE_INDEX,
  ADVANCER_2A_INDEX,
  ADVANCER_2B_INDEX,
  ADVANCER_2C_INDEX,
  ADVANCER_2D_INDEX,
  ESCALATION_INDEX,
} from "./mondayMapping";
import {
  labelToIndex,
  STANDARD_EVAL,
  LANGUAGE_OPTS,
  BLOOD_SUGAR_OPTS,
  DIAGNOSIS_OPTS,
  MR_OPTS,
  MED_NEC_OPTS,
  GEN_SCRIPT_OPTS,
  CLINICALS_METHOD_OPTS,
  MN_ATTEMPTS_OPTS,
} from "./fieldOptions";
import type { Patient } from "./workflow";
import type { StatusOption } from "@/components/masheke/StatusSelect";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

interface WriteTask {
  label: string;
  columnId: string;
  value?: unknown;
  fn: () => Promise<unknown>;
  expectedText?: string;
}

async function executeWithRetry(task: WriteTask): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await task.fn();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mondayWrite] ${task.label} (${task.columnId}) failed attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${msg}`,
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      } else {
        return `${task.label} (${task.columnId}): ${msg}`;
      }
    }
  }
  return null;
}

const BOARD_ID = "18406060017";

/**
 * Run a Medical-Necessity write batch through the verified writer. When the
 * gateway is configured AND every task carries a raw `value`, this hands the
 * whole transaction to the server-side /send fast path (durable + idempotent:
 * snapshot → write data → read-back verify → stage columns LAST). Otherwise it
 * runs the same sequence client-side. Throws if any column fails so callers can
 * surface the error and NOT report success to the rep.
 *
 * To engage /send, EVERY task must carry a raw `value` (change_multiple_column_values
 * shape). `stageColumnId` names the trigger/advancer column(s) written last.
 */
export async function runVerifiedSend(opts: {
  itemId: string;
  tasks: WriteTask[];
  stageColumnId: string | string[];
  createLabelsIfMissing?: boolean;
  label?: string;
  onProgress?: (phase: WriteProgressPhase) => void;
  requireDone?: boolean;
  waitForDoneMs?: number;
}): Promise<void> {
  const failures = await executeWritesWithVerification({
    itemId: opts.itemId,
    boardId: BOARD_ID,
    label: opts.label,
    tasks: opts.tasks,
    stageColumnId: opts.stageColumnId,
    executeWithRetry,
    readColumns: readColumnTexts,
    createLabelsIfMissing: opts.createLabelsIfMissing,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
    onProgress: opts.onProgress,
    requireDone: opts.requireDone,
    waitForDoneMs: opts.waitForDoneMs,
  });
  if (failures.length > 0) {
    throw new Error(`${failures.length} column(s) failed verification: ${failures.join("; ")}`);
  }
}

/** Push a status field if it has a value and we can resolve the index. */
function pushStatus(
  tasks: WriteTask[],
  itemId: string,
  label: string,
  columnId: string,
  value: string | undefined,
  options: StatusOption[],
) {
  if (!value) return;
  const idx = labelToIndex(options, value);
  if (idx === undefined) return;
  tasks.push({
    label,
    columnId,
    value: { index: idx },
    fn: () => writeStatusIndex(itemId, columnId, idx),
  });
}

export type TabContext = "evaluate" | "sendRequest" | "confirmReceipt" | "chase";

export async function sendPatientToMonday(
  p: Patient,
  context: TabContext,
): Promise<void> {
  const tasks: WriteTask[] = [];

  // ---- Evaluate tab ----
  if (context === "evaluate") {
    // Clinical eval checklist statuses
    pushStatus(tasks, p.id, "CGM Script", COL.cgmScript, p.cgmScript, STANDARD_EVAL);
    pushStatus(tasks, p.id, "CGM Script Received", COL.cgmScriptReceived, p.cgmScriptReceived, YES_NO_MONDAY_OPTS);
    pushStatus(tasks, p.id, "Hypo Language", COL.hypoLanguage, p.hypoLanguage, LANGUAGE_OPTS);
    pushStatus(tasks, p.id, "Insulin Language", COL.insulinLanguage, p.insulinLanguage, LANGUAGE_OPTS);
    pushStatus(tasks, p.id, "IP Script", COL.ipScript, p.ipScript, STANDARD_EVAL);
    pushStatus(tasks, p.id, "IP Script Received", COL.ipScriptReceived, p.ipScriptReceived, YES_NO_MONDAY_OPTS);
    pushStatus(tasks, p.id, "Diabetes Education", COL.diabetesEducation, p.diabetesEducation, STANDARD_EVAL);
    pushStatus(tasks, p.id, "3+ Injections", COL.threeInjections, p.threeInjections, STANDARD_EVAL);
    pushStatus(tasks, p.id, "CGM Use", COL.cgmUse, p.cgmUse, STANDARD_EVAL);
    pushStatus(tasks, p.id, "Blood Sugar Issues", COL.bloodSugarIssues, p.bloodSugarIssues, BLOOD_SUGAR_OPTS);
    pushStatus(tasks, p.id, "LMN", COL.lmn, p.lmn, STANDARD_EVAL);
    pushStatus(tasks, p.id, "OOW Date", COL.oowDate, p.oowDate, STANDARD_EVAL);
    pushStatus(tasks, p.id, "Malfunction", COL.malfunction, p.malfunction, STANDARD_EVAL);
    pushStatus(tasks, p.id, "Diagnosis", COL.diagnosis, p.diagnosis, DIAGNOSIS_OPTS);
    // MR + MedNec
    pushStatus(tasks, p.id, "MRs / Clinicals", COL.mrsClinicals, p.mrsClinicals, MR_OPTS);
    pushStatus(tasks, p.id, "Medical Necessity", COL.medicalNecessity, p.medicalNecessity, MED_NEC_OPTS);
    if (p.mnEvalNotes) {
      tasks.push({
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        value: { text: p.mnEvalNotes },
        fn: () => writeLongText(p.id, COL.mnEvalNotes, p.mnEvalNotes!),
      });
    }
    // Advancer 2A → Complete + Sub-Stage → 2B
    tasks.push({
      label: "Advancer 2A",
      columnId: COL.advancer2a,
      value: { index: ADVANCER_2A_INDEX.complete },
      fn: () => writeStatusIndex(p.id, COL.advancer2a, ADVANCER_2A_INDEX.complete),
    });
    tasks.push({
      label: "Sub-Stage → Send Request",
      columnId: COL.subStage,
      value: { index: SUB_STAGE_INDEX.sendRequest },
      fn: () => writeStatusIndex(p.id, COL.subStage, SUB_STAGE_INDEX.sendRequest),
    });
  }

  // ---- Send Request tab ----
  if (context === "sendRequest") {
    pushStatus(tasks, p.id, "Generate CGM Script", COL.generateCgmScript, p.generateCgmScript, GEN_SCRIPT_OPTS);
    pushStatus(tasks, p.id, "Generate IP Script", COL.generateIpScript, p.generateIpScript, GEN_SCRIPT_OPTS);
    pushStatus(tasks, p.id, "Clinicals Method", COL.clinicalsMethod, p.clinicalsMethod, CLINICALS_METHOD_OPTS);
    if (p.mnEvalNotes) {
      tasks.push({
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        value: { text: p.mnEvalNotes },
        fn: () => writeLongText(p.id, COL.mnEvalNotes, p.mnEvalNotes!),
      });
    }
    // Advancer 2B → Complete + Sub-Stage → 2C
    tasks.push({
      label: "Advancer 2B",
      columnId: COL.advancer2b,
      value: { index: ADVANCER_2B_INDEX.complete },
      fn: () => writeStatusIndex(p.id, COL.advancer2b, ADVANCER_2B_INDEX.complete),
    });
    tasks.push({
      label: "Sub-Stage → Confirm Receipt",
      columnId: COL.subStage,
      value: { index: SUB_STAGE_INDEX.confirmReceipt },
      fn: () => writeStatusIndex(p.id, COL.subStage, SUB_STAGE_INDEX.confirmReceipt),
    });
  }

  // ---- Confirm Receipt tab ----
  if (context === "confirmReceipt") {
    pushStatus(tasks, p.id, "MRs / Clinicals", COL.mrsClinicals, p.mrsClinicals, MR_OPTS);
    pushStatus(tasks, p.id, "MN Attempts", COL.mnAttempts, p.mnAttempts, MN_ATTEMPTS_OPTS);
    if (p.receiptConfirmedDate) {
      tasks.push({
        label: "Receipt Confirmed Date",
        columnId: COL.receiptConfirmedDate,
        value: { date: p.receiptConfirmedDate },
        fn: () => writeDate(p.id, COL.receiptConfirmedDate, p.receiptConfirmedDate!),
      });
    }
    if (p.receiptConfirmedName) {
      tasks.push({
        label: "Receipt Confirmed Name",
        columnId: COL.receiptConfirmedName,
        value: p.receiptConfirmedName,
        fn: () => writeText(p.id, COL.receiptConfirmedName, p.receiptConfirmedName!),
      });
    }
    if (p.mnEvalNotes) {
      tasks.push({
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        value: { text: p.mnEvalNotes },
        fn: () => writeLongText(p.id, COL.mnEvalNotes, p.mnEvalNotes!),
      });
    }
    // Advancer 2C → Complete + Sub-Stage → 2D
    tasks.push({
      label: "Advancer 2C",
      columnId: COL.advancer2c,
      value: { index: ADVANCER_2C_INDEX.complete },
      fn: () => writeStatusIndex(p.id, COL.advancer2c, ADVANCER_2C_INDEX.complete),
    });
    tasks.push({
      label: "Sub-Stage → Chase",
      columnId: COL.subStage,
      value: { index: SUB_STAGE_INDEX.chase },
      fn: () => writeStatusIndex(p.id, COL.subStage, SUB_STAGE_INDEX.chase),
    });
  }

  // ---- Chase tab ----
  if (context === "chase") {
    pushStatus(tasks, p.id, "MRs / Clinicals", COL.mrsClinicals, p.mrsClinicals, MR_OPTS);
    pushStatus(tasks, p.id, "MN Attempts", COL.mnAttempts, p.mnAttempts, MN_ATTEMPTS_OPTS);
    if (p.nextActionDate) {
      tasks.push({
        label: "Next Action Date",
        columnId: COL.nextActionDate,
        value: { date: clampToBusinessDay(p.nextActionDate!) },
        // Clamped: a Next Action Date must never land on a weekend.
        fn: () => writeDate(p.id, COL.nextActionDate, clampToBusinessDay(p.nextActionDate!)),
      });
    }
    if (p.chaseRecipientName) {
      tasks.push({
        label: "Chase Recipient Name",
        columnId: COL.chaseRecipientName,
        value: p.chaseRecipientName,
        fn: () => writeText(p.id, COL.chaseRecipientName, p.chaseRecipientName!),
      });
    }
    if (p.mnEvalNotes) {
      tasks.push({
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        value: { text: p.mnEvalNotes },
        fn: () => writeLongText(p.id, COL.mnEvalNotes, p.mnEvalNotes!),
      });
    }
    // Advancer 2D → Complete
    tasks.push({
      label: "Advancer 2D",
      columnId: COL.advancer2d,
      value: { index: ADVANCER_2D_INDEX.complete },
      fn: () => writeStatusIndex(p.id, COL.advancer2d, ADVANCER_2D_INDEX.complete),
    });
  }

  // ---- Execute with read-back verification before advancing stage ----
  // Both the advancer columns and subStage trigger Monday automations,
  // so they must be written after all data columns are verified.
  const stageColumnIds = [
    COL.advancer2a, COL.advancer2b, COL.advancer2c, COL.advancer2d,
    COL.subStage,
  ];

  const failures = await executeWritesWithVerification({
    itemId: p.id,
    boardId: "18406060017",
    label: `Masheke ${context} send`,
    tasks,
    stageColumnId: stageColumnIds,
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Check debug column.`,
    );
  }
}


/**
 * Send Request — verified trigger.
 *
 * Writes the Request Message + Request Sent At FIRST, reads them back to
 * confirm Monday has indexed them, and ONLY THEN flips the Send Request
 * trigger column (which fires the SuperMail send). If the data columns can't
 * be verified, the trigger is NOT flipped and this throws — so SuperMail can
 * never dispatch off a stale or empty Request Message.
 *
 * Mirrors the stage-advancer pattern: the trigger is the "stage column",
 * written last only after read-back verification of the data columns.
 */
export async function recordAndAdvanceVerified(
  p: Patient,
  opts: { body: string; nextStage: string; nextActionDate: string },
): Promise<void> {
  // Same guarantee as every other send: write ALL data columns first, read them
  // back to confirm Monday indexed them, and ONLY THEN flip the Stage Advancer
  // (subStage) — the single write that moves the item. If verification fails the
  // advancer is never written and this throws, so the item does not move.
  // Stamp Request Sent At once so the raw `value` (used by /send) matches the fn.
  const sentAt = new Date();
  const sentIso = sentAt.toISOString();
  const tasks: WriteTask[] = [
    {
      label: "Request Message",
      columnId: COL.requestBody,
      value: { text: opts.body },
      fn: () => writeLongText(p.id, COL.requestBody, opts.body),
    },
    {
      label: "Request Sent At",
      columnId: COL.requestSentAt,
      value: { date: sentIso.slice(0, 10), time: sentIso.slice(11, 19) },
      fn: () => writeDateTime(p.id, COL.requestSentAt, sentAt),
    },
    {
      label: "Next Action Date",
      columnId: COL.nextActionDate,
      value: { date: opts.nextActionDate },
      fn: () => writeDate(p.id, COL.nextActionDate, opts.nextActionDate),
    },
    {
      label: `Stage Advancer → ${opts.nextStage}`,
      columnId: COL.subStage,
      value: { label: opts.nextStage },
      fn: () => writeStatusLabel(p.id, COL.subStage, opts.nextStage),
    },
  ];

  const failures = await executeWritesWithVerification({
    itemId: p.id,
    boardId: "18406060017",
    label: "Send Request → advance",
    tasks,
    stageColumnId: COL.subStage,
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed verification — item NOT moved. Check the Josh Debug column.`,
    );
  }
}


/**
 * Return a patient to the Evaluate MN stage for re-review (Update Clinicals
 * "Submit — back to Evaluate").
 *
 * A patient sent back to Evaluate must land in the rep's ACTIVE Evaluate queue,
 * NOT a hidden bucket. Both the masheke sidebar (lib/masheke/sidebarList.ts) and
 * the burndown counts (hooks/useRoleCounts.ts) drop any patient who is escalated
 * (Escalation index 0 "Manager" or 2 "Final Escalation Required" — the latter is
 * a rep's stuck proposal), or has a future Next Action Date — so a patient
 * returned WITHOUT resetting those stays invisible even though their Stage
 * Advancer reads "Evaluate MN". (This is the "sent back but never showed up in my
 * MN Evaluation queue" bug: the returning patient still carried an escalation —
 * and/or a stuck proposal — from a prior stage, e.g. Chase Clinicals, where
 * Attempt 4+ escalates.)
 *
 * This is an EXPLICIT rep action (they uploaded new clinicals and chose to send
 * the patient back), so it supersedes any pending escalation or stuck proposal
 * unconditionally: it writes Escalation → Done (which ALSO clears a Final /
 * stuck-proposal flag — that's the same column, index 2) and Next Action Date →
 * today FIRST, verifies they landed (read-back), and ONLY THEN flips the Stage
 * Advancer → Evaluate MN (the automation trigger, written last per the verify-
 * before-advance rule). If verification fails the stage is not advanced and this
 * throws, so the caller surfaces the error instead of reporting a phantom success.
 */
// =====================================================================
// Doctor Appointments (2026-08-03)
// =====================================================================

/**
 * Chase → "the office says a visit is already booked".
 *
 * The patient does NOT move — they stay a normal Chase patient, just snoozed
 * until the day after the visit. Appointment Date and the stamped note are DATA
 * columns; Next Action Date goes LAST because it's the write that hides the
 * patient. If the note or the date failed and the NAD landed anyway, we'd have
 * an invisible patient with no record of why — the exact failure the
 * verify-before-advance rule exists to prevent.
 */
export async function scheduleAppointmentFromChase(opts: {
  itemId: string;
  appointmentDate: string;
  nextActionDate: string;
  notes: string;
  onProgress?: (phase: WriteProgressPhase) => void;
  requireDone?: boolean;
  waitForDoneMs?: number;
}): Promise<void> {
  await runVerifiedSend({
    itemId: opts.itemId,
    label: "Chase → appointment scheduled",
    tasks: [
      {
        label: "Appointment Date",
        columnId: COL.appointmentDate,
        value: { date: opts.appointmentDate },
        fn: () => writeDate(opts.itemId, COL.appointmentDate, opts.appointmentDate),
      },
      {
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        value: { text: opts.notes },
        fn: () => writeLongText(opts.itemId, COL.mnEvalNotes, opts.notes),
      },
      {
        label: "Next Action Date",
        columnId: COL.nextActionDate,
        value: { date: opts.nextActionDate },
        fn: () => writeDate(opts.itemId, COL.nextActionDate, opts.nextActionDate),
      },
    ],
    stageColumnId: COL.nextActionDate,
    onProgress: opts.onProgress,
    requireDone: opts.requireDone,
    waitForDoneMs: opts.waitForDoneMs,
  });
}

/**
 * Chase → Doctor Appointments (no appointment booked yet).
 *
 * CLEARS THE ESCALATION on the way in, deliberately. Escalation
 * (color_mm1x7997) is one board-wide column that Chase already writes at
 * Attempt 4+ — so a manager working an escalated chase patient who clicks
 * "Doctor Appointment Required" would otherwise deliver them into the
 * Doctor Appointments queue ALREADY escalated, where escalated patients are
 * hidden from the sidebar. They'd be invisible on arrival, with no error.
 * Same stale-carry-over class of bug that evaluateReentry.ts exists to
 * self-heal, and the same fix returnToEvaluateVerified already applies.
 *
 * Next Action Date → today so they're due immediately in the new queue.
 * Sub-Stage is written LAST — it IS the stage advancer on this board.
 */
export async function enterDoctorAppointments(opts: {
  itemId: string;
  notes: string;
  onProgress?: (phase: WriteProgressPhase) => void;
  requireDone?: boolean;
  waitForDoneMs?: number;
}): Promise<void> {
  // NOT weekend-clamped: we want them due NOW, and clamping a Saturday forward
  // would re-hide the patient for the rest of the weekend.
  const today = etToday();
  await runVerifiedSend({
    itemId: opts.itemId,
    label: "Chase → Doctor Appointments",
    tasks: [
      {
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        value: { text: opts.notes },
        fn: () => writeLongText(opts.itemId, COL.mnEvalNotes, opts.notes),
      },
      {
        label: "Escalation → Done",
        columnId: COL.escalation,
        value: { index: ESCALATION_INDEX.done },
        expectedText: "Done",
        fn: () => writeStatusIndex(opts.itemId, COL.escalation, ESCALATION_INDEX.done),
      },
      {
        label: "Next Action Date → today",
        columnId: COL.nextActionDate,
        value: { date: today },
        fn: () => writeDate(opts.itemId, COL.nextActionDate, today),
      },
      {
        label: "Stage Advancer → Doctor Appointment",
        columnId: COL.subStage,
        value: { index: SUB_STAGE_INDEX.doctorAppointment },
        fn: () => writeStatusIndex(opts.itemId, COL.subStage, SUB_STAGE_INDEX.doctorAppointment),
      },
    ],
    stageColumnId: COL.subStage,
    onProgress: opts.onProgress,
    requireDone: opts.requireDone,
    waitForDoneMs: opts.waitForDoneMs,
  });
}

/**
 * Doctor Appointments → log one outreach attempt (patient stays in the queue).
 *
 * The attempt text column IS the counter, so it must land before anything that
 * reads the count. `escalate` is the third-attempt hand-off: Escalation → index
 * 0 (Manager Intervention), NOT index 2 — index 2 is the "proposed stuck"
 * signal that pulls a patient out of every queue awaiting a Final Decision, and
 * an unreachable patient is a manager task, not a pipeline exit.
 */
export async function logApptAttemptVerified(opts: {
  itemId: string;
  attemptColumnId: string;
  attemptValue: string;
  notes: string;
  /** Null when escalating — an escalated patient is the manager's. */
  nextActionDate: string | null;
  escalate: boolean;
  onProgress?: (phase: WriteProgressPhase) => void;
  requireDone?: boolean;
  waitForDoneMs?: number;
}): Promise<void> {
  const tasks: WriteTask[] = [
    {
      label: "Appointment attempt",
      columnId: opts.attemptColumnId,
      value: opts.attemptValue,
      expectedText: opts.attemptValue,
      fn: () => writeText(opts.itemId, opts.attemptColumnId, opts.attemptValue),
    },
    {
      label: "MN Workflow Notes",
      columnId: COL.mnEvalNotes,
      value: { text: opts.notes },
      fn: () => writeLongText(opts.itemId, COL.mnEvalNotes, opts.notes),
    },
  ];
  const stageColumnId: string[] = [];
  if (opts.escalate) {
    tasks.push({
      label: "Escalation → Manager Intervention",
      columnId: COL.escalation,
      value: { index: ESCALATION_INDEX.required },
      fn: () => writeStatusIndex(opts.itemId, COL.escalation, ESCALATION_INDEX.required),
    });
    stageColumnId.push(COL.escalation);
  } else {
    if (!opts.nextActionDate) {
      // Without a date the patient stays due forever and gets re-called every
      // poll — the same dropped-date failure the chase panel guards against.
      throw new Error("Next Action Date failed to compute — nothing was written. Reload and try again.");
    }
    tasks.push({
      label: "Next Action Date",
      columnId: COL.nextActionDate,
      value: { date: opts.nextActionDate },
      fn: () => writeDate(opts.itemId, COL.nextActionDate, opts.nextActionDate),
    });
    stageColumnId.push(COL.nextActionDate);
  }
  await runVerifiedSend({
    itemId: opts.itemId,
    label: "Doctor Appointments → attempt logged",
    tasks,
    stageColumnId,
    onProgress: opts.onProgress,
    requireDone: opts.requireDone,
    waitForDoneMs: opts.waitForDoneMs,
  });
}

/**
 * Doctor Appointments → back to Chase with an appointment on file.
 *
 * The only non-escalation exit. Clears the escalation unconditionally, because
 * this is also the path a MANAGER takes on an escalated patient: they get the
 * appointment date, and the patient goes back to the pipeline snoozed rather
 * than staying in Manager Intervention with a date nobody acts on.
 *
 * `attempt` is optional — set when a rep logged this as an outreach attempt,
 * omitted when a manager entered the date directly.
 */
export async function returnToChaseWithAppointment(opts: {
  itemId: string;
  appointmentDate: string;
  nextActionDate: string;
  notes: string;
  attempt?: { columnId: string; value: string };
  onProgress?: (phase: WriteProgressPhase) => void;
  requireDone?: boolean;
  waitForDoneMs?: number;
}): Promise<void> {
  const tasks: WriteTask[] = [];
  if (opts.attempt) {
    tasks.push({
      label: "Appointment attempt",
      columnId: opts.attempt.columnId,
      value: opts.attempt.value,
      expectedText: opts.attempt.value,
      fn: () => writeText(opts.itemId, opts.attempt!.columnId, opts.attempt!.value),
    });
  }
  tasks.push(
    {
      label: "Appointment Date",
      columnId: COL.appointmentDate,
      value: { date: opts.appointmentDate },
      fn: () => writeDate(opts.itemId, COL.appointmentDate, opts.appointmentDate),
    },
    {
      label: "MN Workflow Notes",
      columnId: COL.mnEvalNotes,
      value: { text: opts.notes },
      fn: () => writeLongText(opts.itemId, COL.mnEvalNotes, opts.notes),
    },
    {
      label: "Escalation → Done",
      columnId: COL.escalation,
      value: { index: ESCALATION_INDEX.done },
      expectedText: "Done",
      fn: () => writeStatusIndex(opts.itemId, COL.escalation, ESCALATION_INDEX.done),
    },
    {
      label: "Next Action Date",
      columnId: COL.nextActionDate,
      value: { date: opts.nextActionDate },
      fn: () => writeDate(opts.itemId, COL.nextActionDate, opts.nextActionDate),
    },
    {
      // LAST — the Sub-Stage column is the stage advancer on this board.
      label: "Stage Advancer → Chase Clinicals",
      columnId: COL.subStage,
      value: { index: SUB_STAGE_INDEX.chase },
      fn: () => writeStatusIndex(opts.itemId, COL.subStage, SUB_STAGE_INDEX.chase),
    },
  );
  await runVerifiedSend({
    itemId: opts.itemId,
    label: "Doctor Appointments → back to Chase",
    tasks,
    stageColumnId: COL.subStage,
    onProgress: opts.onProgress,
    requireDone: opts.requireDone,
    waitForDoneMs: opts.waitForDoneMs,
  });
}

export async function returnToEvaluateVerified(itemId: string): Promise<void> {
  // NOT clamped to a business day: we want the patient DUE NOW. Clamping a
  // weekend "today" forward to Monday would re-hide them over the weekend —
  // the exact failure mode this fixes. NAD <= today (ET) is the due-now rule.
  const today = etToday();
  const tasks: WriteTask[] = [
    {
      label: "Escalation → Done",
      columnId: COL.escalation,
      value: { index: ESCALATION_INDEX.done },
      // Confirm the flag actually cleared before we advance — a still-Required
      // escalation is what hides the patient from the rep.
      expectedText: "Done",
      fn: () => writeStatusIndex(itemId, COL.escalation, ESCALATION_INDEX.done),
    },
    {
      label: "Next Action Date → today",
      columnId: COL.nextActionDate,
      value: { date: today },
      fn: () => writeDate(itemId, COL.nextActionDate, today),
    },
    {
      // Stage Advancer LAST (the trigger column) — written only after the
      // data columns above verify.
      label: "Stage Advancer → Evaluate MN",
      columnId: COL.subStage,
      value: { index: SUB_STAGE_INDEX.evaluate },
      fn: () => writeStatusIndex(itemId, COL.subStage, SUB_STAGE_INDEX.evaluate),
    },
  ];

  const failures = await executeWritesWithVerification({
    itemId,
    boardId: BOARD_ID,
    label: "Update Clinicals → back to Evaluate",
    tasks,
    stageColumnId: COL.subStage,
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
  });
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed verification — patient NOT returned to Evaluate. Check the Josh Debug column.`,
    );
  }
}
