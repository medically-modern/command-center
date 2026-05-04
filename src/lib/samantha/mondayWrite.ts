// Direct (non-debounced) batch writes to Monday for a single patient.
// All edits are kept local until the user clicks "Send to Monday".
//
// Each column write retries up to 2 times on failure. Any columns that
// still fail after retries are logged to the "Josh Debug" column so
// nothing is silently lost.

import { writeStatusIndex, writeLongText, writeDropdownIds, writeText, writeDate, writeNumber, COL } from "./mondayApi";
import { resolveHcpcs, isAutoFilledMedicaidSupply } from "./hcpcRules";
import {
  AUTH_RESULT_INDEX,
  AUTH_METHOD_OPTION_ID,
  ESCALATION_INDEX,
  NOT_CLEAR_PRODUCT_ID,
  PRODUCT_CODE_TO_PRODUCT_ID,
  STAGE_INDEX,
  UNIVERSAL_INDEX,
} from "./mondayMapping";
import type { Patient, ProductCodeId, ProductCodeState } from "./workflow";
import { EMPTY_INSURANCE, deriveInsuranceOutcome } from "./workflow";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
}

/**
 * Execute a single write with retries.
 * Returns null on success, or an error message string on final failure.
 */
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

/**
 * Push every relevant column for a patient to Monday in one batch.
 * Each column is written independently with retries. Columns that fail
 * after all retries are logged to the Josh Debug column.
 *
 * Throws if any columns failed (after logging), so the UI shows an error.
 */
export async function sendPatientToMonday(p: Patient, context: "benefits" | "submitAuth" | "authOutstanding" = "benefits"): Promise<void> {
  const ins = p.insurance ?? EMPTY_INSURANCE;
  const tasks: WriteTask[] = [];

  // ----- Guard: require Serving + Primary Insurance -----
  const resolved = resolveHcpcs(p.primaryInsurance || null, p.serving || null, p.secondaryInsurance ?? null);
  if (!p.serving || !p.primaryInsurance || resolved.length === 0) {
    throw new Error(
      "Cannot send: Serving and Primary Insurance must both be selected before writing to Monday.",
    );
  }

  // ----- Universal: Active / In-Network -----
  const inNet = ins.universal["in-network"];
  const active = ins.universal["active"];
  if (inNet === "confirmed" && active === "confirmed") {
    tasks.push({
      label: "Active/Network",
      columnId: COL.activeNetwork,
      fn: () => writeStatusIndex(p.id, COL.activeNetwork, UNIVERSAL_INDEX.activeNetwork.pass),
    });
  } else if (inNet === "not-confirmed" || active === "not-confirmed") {
    tasks.push({
      label: "Active/Network",
      columnId: COL.activeNetwork,
      fn: () => writeStatusIndex(p.id, COL.activeNetwork, UNIVERSAL_INDEX.activeNetwork.fail),
    });
  }

  // ----- Universal: DME Benefits -----
  const dme = ins.universal["dme-benefits"];
  if (dme === "confirmed") {
    tasks.push({
      label: "DME Benefits",
      columnId: COL.dmeBenefits,
      fn: () => writeStatusIndex(p.id, COL.dmeBenefits, UNIVERSAL_INDEX.dmeBenefits.pass),
    });
  } else if (dme === "not-confirmed") {
    tasks.push({
      label: "DME Benefits",
      columnId: COL.dmeBenefits,
      fn: () => writeStatusIndex(p.id, COL.dmeBenefits, UNIVERSAL_INDEX.dmeBenefits.fail),
    });
  }

  // ----- Per-product auth-result columns -----
  // Build entries from resolved products. For Medicaid-billed supplies
  // (hidden in the UI) the user never sets state, so we auto-fill
  // Auth=Required, SoS=Clear here — matching the UI preview's behavior.
  const entries = resolved
    .map((r) => {
      const cid = Object.entries(PRODUCT_CODE_TO_PRODUCT_ID).find(([, v]) => v === r.product)?.[0] as
        | ProductCodeId
        | undefined;
      if (!cid) return null;
      const userState = ins.codes[cid];
      const state: ProductCodeState | undefined = isAutoFilledMedicaidSupply(r)
        ? { ...(userState ?? { status: "pending" }), auth: "required", sos: "clear" }
        : userState;
      return { cid, state };
    })
    .filter((e): e is { cid: ProductCodeId; state: ProductCodeState | undefined } => !!e);

  // Effective insurance state with auto-filled codes — used by
  // deriveInsuranceOutcome below so blocker/auth-required/all-clear logic
  // sees the same picture as the UI preview.
  const effectiveCodes: typeof ins.codes = { ...ins.codes };
  for (const e of entries) {
    if (e.state) effectiveCodes[e.cid] = e.state;
  }
  const effectiveIns = { ...ins, codes: effectiveCodes };

  // Write auth result for served products (skip for authOutstanding — handled separately below)
  const servedProductKeys = new Set(entries.map((e) => PRODUCT_CODE_TO_PRODUCT_ID[e.cid]));
  if (context !== "authOutstanding") {
  for (const { cid, state } of entries) {
    if (!state?.auth) continue;
    const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
    const authColumnId = COL.authResult[productId];
    if (state.auth === "required") {
      // When sending from Submit Auth tab, flip auth result to "Submitted"
      if (context === "submitAuth") {
        tasks.push({
          label: `Auth result: ${productId}`,
          columnId: authColumnId,
          fn: () => writeStatusIndex(p.id, authColumnId, AUTH_RESULT_INDEX.submitted),
        });
      } else {
        tasks.push({
          label: `Auth result: ${productId}`,
          columnId: authColumnId,
          fn: () => writeStatusIndex(p.id, authColumnId, AUTH_RESULT_INDEX.required),
        });
      }
    } else if (state.auth === "not-required" && context !== "submitAuth" && context !== "authOutstanding") {
      // Skip when in submit-auth flow — leave non-auth-required results untouched
      tasks.push({
        label: `Auth result: ${productId}`,
        columnId: authColumnId,
        fn: () => writeStatusIndex(p.id, authColumnId, AUTH_RESULT_INDEX.noAuthNeeded),
      });
    }
  }
  }

  // Write "Not Serving" for products NOT in this patient's serving type
  // Skip when in submit-auth flow — leave other auth results untouched
  if (context !== "submitAuth" && context !== "authOutstanding") {
    const allProductIds = Object.keys(COL.authResult) as Array<keyof typeof COL.authResult>;
    for (const prodKey of allProductIds) {
      if (!servedProductKeys.has(prodKey)) {
        tasks.push({
          label: `Auth result: ${prodKey} (not serving)`,
          columnId: COL.authResult[prodKey],
          fn: () => writeStatusIndex(p.id, COL.authResult[prodKey], AUTH_RESULT_INDEX.notServing),
        });
      }
    }
  }

  // ----- Not Clear Products dropdown -----
  // Any product with SoS = not-clear lands here, regardless of auth.
  const notClearIds = entries
    .filter((e) => e.state?.sos === "not-clear")
    .map((e) => NOT_CLEAR_PRODUCT_ID[e.cid])
    .filter((n): n is number => typeof n === "number");
  tasks.push({
    label: "Not Clear Products",
    columnId: COL.notClearProducts,
    fn: () => writeDropdownIds(p.id, COL.notClearProducts, notClearIds),
  });

  // ----- Aggregate SoS + Auth -----
  // SoS is now always required for every product (no auth-required skip
  // carve-out). A patient is "all filled" only when every served product
  // has both Auth and SoS picked.
  const states = entries.map((e) => e.state);
  const allFilled =
    states.length > 0 &&
    states.every((s) => !!s?.auth && !!s?.sos);
  if (allFilled) {
    const anyAuth = states.some((s) => s?.auth === "required");
    const anyNotClear = states.some((s) => s?.sos === "not-clear");

    tasks.push({
      label: "Auth aggregate",
      columnId: COL.auth,
      fn: () =>
        writeStatusIndex(p.id, COL.auth, anyAuth ? UNIVERSAL_INDEX.auth.required : UNIVERSAL_INDEX.auth.noAuth),
    });

    tasks.push({
      label: "SoS aggregate",
      columnId: COL.sos,
      fn: () =>
        writeStatusIndex(p.id, COL.sos, anyNotClear ? UNIVERSAL_INDEX.sos.fail : UNIVERSAL_INDEX.sos.pass),
    });
  }

  // ----- Debug: trace deriveInsuranceOutcome -----
  {
    const _outcome = deriveInsuranceOutcome(effectiveIns, entries.map(e => e.cid));
    const _codeStates = Object.values(effectiveIns.codes).filter(Boolean);
    console.log('[mondayWrite] context:', context);
    console.log('[mondayWrite] universal:', JSON.stringify(effectiveIns.universal));
    console.log('[mondayWrite] codeStates:', JSON.stringify(_codeStates.map((c: any) => ({ auth: c.auth, sos: c.sos }))));
    console.log('[mondayWrite] entries:', JSON.stringify(entries.map(e => ({ cid: e.cid, auth: e.state?.auth, sos: e.state?.sos }))));
    console.log('[mondayWrite] deriveInsuranceOutcome =>', _outcome);
  }

  // ----- Escalation + Stage Advancer -----
  // Stage Advancer never goes to "Stuck" — the Escalation column is the
  // only place we surface that something needs attention. Blocker
  // conditions (universal not confirmed, SoS not clear) leave the
  // patient in the Benefits / SoS stage with Escalation flagged.
  if (context === "submitAuth") {
    tasks.push({
      label: "Stage Advancer",
      columnId: COL.stageAdvancer,
      fn: () => writeStatusIndex(p.id, COL.stageAdvancer, STAGE_INDEX.authOutstanding),
    });
  } else if (context === "authOutstanding") {
    tasks.push({
      label: "Stage Advancer",
      columnId: COL.stageAdvancer,
      fn: () => writeStatusIndex(p.id, COL.stageAdvancer, STAGE_INDEX.complete),
    });
  } else {
    const outcome = deriveInsuranceOutcome(effectiveIns, entries.map(e => e.cid));

    // Blocker → only flag escalation. Do NOT move Stage Advancer to Stuck.
    if (outcome === "blocker") {
      tasks.push({
        label: "Escalation",
        columnId: COL.escalation,
        fn: () => writeStatusIndex(p.id, COL.escalation, ESCALATION_INDEX.required),
      });
    }

    // Stage Advancer — always one of: Benefits / SoS, Authorization, Complete.
    let stageIndex: number;
    if (outcome === "all-clear") {
      stageIndex = STAGE_INDEX.complete;
    } else if (outcome === "auth-required") {
      stageIndex = STAGE_INDEX.authorization;
    } else {
      // "blocker" or "incomplete" → still working through Benefits / SoS
      stageIndex = STAGE_INDEX.benefitsSos;
    }
    tasks.push({
      label: "Stage Advancer",
      columnId: COL.stageAdvancer,
      fn: () => writeStatusIndex(p.id, COL.stageAdvancer, stageIndex),
    });
  }

  // ----- Per-product auth submission fields (Authorizations tab) -----
  for (const { cid, state } of entries) {
    if (!state) continue;
    const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];

    // Auth Submission Method (dropdown)
    if (state.authSubmissionMethod) {
      const optId = AUTH_METHOD_OPTION_ID[state.authSubmissionMethod];
      if (optId !== undefined) {
        tasks.push({
          label: `Auth method: ${productId}`,
          columnId: COL.authMethod[productId],
          fn: () => writeDropdownIds(p.id, COL.authMethod[productId], [optId]),
        });
      }
    }

    // Auth Submission Date (text column)
    if (state.authSubmissionDate) {
      tasks.push({
        label: `Auth submit date: ${productId}`,
        columnId: COL.authSubmissionDate[productId],
        fn: () => writeText(p.id, COL.authSubmissionDate[productId], state.authSubmissionDate!),
      });
    }

    // Auth ID (text column)
    if (state.authId) {
      tasks.push({
        label: `Auth ID: ${productId}`,
        columnId: COL.authId[productId],
        fn: () => writeText(p.id, COL.authId[productId], state.authId!),
      });
    }

    // Auth Start (date column)
    if (state.authStart) {
      tasks.push({
        label: `Auth start: ${productId}`,
        columnId: COL.authStart[productId],
        fn: () => writeDate(p.id, COL.authStart[productId], state.authStart!),
      });
    }

    // Auth End (date column)
    if (state.authEnd) {
      tasks.push({
        label: `Auth end: ${productId}`,
        columnId: COL.authEnd[productId],
        fn: () => writeDate(p.id, COL.authEnd[productId], state.authEnd!),
      });
    }

    // Auth Units (numeric column)
    if (state.authUnits) {
      tasks.push({
        label: `Auth units: ${productId}`,
        columnId: COL.authUnits[productId],
        fn: () => writeNumber(p.id, COL.authUnits[productId], state.authUnits!),
      });
    }
  }

  // ----- Call/Fax Number (single shared column) -----
  // The Monday board has one Call/Fax Number column for the whole patient.
  // If any served product was submitted via Call or Fax, write the first
  // non-empty callFaxNumber we find to that column.
  {
    const cf = entries.find(
      (e) =>
        (e.state?.authSubmissionMethod === "Call" ||
          e.state?.authSubmissionMethod === "Fax") &&
        !!e.state?.callFaxNumber,
    );
    if (cf?.state?.callFaxNumber) {
      const num = cf.state.callFaxNumber;
      tasks.push({
        label: "Call/Fax Number",
        columnId: COL.callFaxNumber,
        fn: () => writeText(p.id, COL.callFaxNumber, num),
      });
    }
  }

  // ----- Auth Outstanding: per-product auth result (Auth Valid / Denied / No Auth Needed) -----
  if (context === "authOutstanding") {
    console.log('[mondayWrite] authOutstanding entries:', entries.map(e => ({
      cid: e.cid,
      product: PRODUCT_CODE_TO_PRODUCT_ID[e.cid],
      authOutstandingResult: e.state?.authOutstandingResult,
      authColumnId: COL.authResult[PRODUCT_CODE_TO_PRODUCT_ID[e.cid]],
    })));
    for (const { cid, state } of entries) {
      if (!state?.authOutstandingResult) {
        console.log(`[mondayWrite] SKIPPED ${cid}: no authOutstandingResult`, state);
        continue;
      }
      const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
      const authColumnId = COL.authResult[productId];
      const resultIndex =
        state.authOutstandingResult === "auth-valid"
          ? AUTH_RESULT_INDEX.authValid
          : state.authOutstandingResult === "no-auth-needed"
            ? AUTH_RESULT_INDEX.noAuthNeeded
            : AUTH_RESULT_INDEX.denied;
      console.log(`[mondayWrite] WRITING auth result: ${productId} → index ${resultIndex} (col: ${authColumnId})`);
      tasks.push({
        label: `Auth result: ${productId}`,
        columnId: authColumnId,
        fn: () => writeStatusIndex(p.id, authColumnId, resultIndex),
      });

      // No Auth Needed → also blank out the per-product auth detail
      // columns (Auth ID / Start / End / Units) so they don't keep
      // stale values from a prior pass.
      if (state.authOutstandingResult === "no-auth-needed") {
        tasks.push({
          label: `Auth ID (clear): ${productId}`,
          columnId: COL.authId[productId],
          fn: () => writeText(p.id, COL.authId[productId], ""),
        });
        tasks.push({
          label: `Auth Start (clear): ${productId}`,
          columnId: COL.authStart[productId],
          fn: () => writeDate(p.id, COL.authStart[productId], ""),
        });
        tasks.push({
          label: `Auth End (clear): ${productId}`,
          columnId: COL.authEnd[productId],
          fn: () => writeDate(p.id, COL.authEnd[productId], ""),
        });
        tasks.push({
          label: `Auth Units (clear): ${productId}`,
          columnId: COL.authUnits[productId],
          fn: () => writeNumber(p.id, COL.authUnits[productId], ""),
        });
      }
    }
  }

  // ----- Carecentrix Intake ID (single shared text column) -----
  const allCodeStates = Object.values(ins.codes).filter(Boolean) as ProductCodeState[];
  const intakeId = allCodeStates.map((s) => s.intakeId).find((v) => !!v);
  if (intakeId) {
    tasks.push({
      label: "Carecentrix Intake ID",
      columnId: COL.carecentrixIntakeId,
      fn: () => writeText(p.id, COL.carecentrixIntakeId, intakeId),
    });
  }


  // ----- Per-product auth submission fields (Authorizations tab) -----
  for (const { cid, state } of entries) {
    if (!state) continue;
    const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
    const productLabel = cid;

    // Auth Submission Method (dropdown)
    if (state.authSubmissionMethod) {
      const optId = AUTH_METHOD_OPTION_ID[state.authSubmissionMethod];
      if (optId !== undefined) {
        const colId = COL.authMethod[productId];
        tasks.push({
          label: `Auth Method (${productLabel})`,
          columnId: colId,
          fn: () => writeDropdownIds(p.id, colId, [optId]),
        });
      }
    }

    // Auth Submission Date (text column)
    if (state.authSubmissionDate) {
      const colId = COL.authSubmissionDate[productId];
      const v = state.authSubmissionDate;
      tasks.push({
        label: `Auth Submission Date (${productLabel})`,
        columnId: colId,
        fn: () => writeText(p.id, colId, v),
      });
    }

    // Auth ID (text column)
    if (state.authId) {
      const colId = COL.authId[productId];
      const v = state.authId;
      tasks.push({
        label: `Auth ID (${productLabel})`,
        columnId: colId,
        fn: () => writeText(p.id, colId, v),
      });
    }

    // Auth Start (date column)
    if (state.authStart) {
      const colId = COL.authStart[productId];
      const v = state.authStart;
      tasks.push({
        label: `Auth Start (${productLabel})`,
        columnId: colId,
        fn: () => writeDate(p.id, colId, v),
      });
    }

    // Auth End (date column)
    if (state.authEnd) {
      const colId = COL.authEnd[productId];
      const v = state.authEnd;
      tasks.push({
        label: `Auth End (${productLabel})`,
        columnId: colId,
        fn: () => writeDate(p.id, colId, v),
      });
    }

    // Auth Units (numeric column)
    if (state.authUnits) {
      const colId = COL.authUnits[productId];
      const v = state.authUnits;
      tasks.push({
        label: `Auth Units (${productLabel})`,
        columnId: colId,
        fn: () => writeNumber(p.id, colId, v),
      });
    }
  }

  // ----- Notes (long text) -----
  if (typeof p.notes === "string") {
    tasks.push({
      label: "Call Reference Notes",
      columnId: COL.callReferenceNotes,
      fn: () => writeLongText(p.id, COL.callReferenceNotes, p.notes),
    });
  }

  // ----- Execute all writes in parallel, each with independent retries -----
  const results = await Promise.all(tasks.map(executeWithRetry));
  const failures = results.filter((r): r is string => r !== null);

  if (failures.length > 0) {
    // Log failures to Josh Debug column (best-effort, no retry on this one)
    const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    const debugMsg = `[${timestamp}] ${failures.length} write(s) failed:\n${failures.join("\n")}`;
    try {
      await writeText(p.id, COL.joshDebug, debugMsg);
    } catch {
      console.error("[mondayWrite] Could not write to Josh Debug column:", debugMsg);
    }

    const succeeded = tasks.length - failures.length;
    throw new Error(
      `${failures.length} column(s) failed after retries (${succeeded} succeeded). Check "Josh Debug" column. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}
