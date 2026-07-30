// Direct (non-debounced) batch writes to Monday for a single patient.
// All edits are kept local until the user clicks "Send to Monday".
//
// Each column write retries up to 2 times on failure. Any columns that
// still fail after retries are logged to the "Josh Debug" column so
// nothing is silently lost.

import { writeStatusIndex, writeLongText, writeDropdownIds, writeDropdownLabels, writeText, writeDate, writeNumber, writeCheckbox, writeItemName, writePhone, writeEmail, writeSimpleValue, writeLocation, readColumnTexts, COL } from "./mondayApi";
import { executeWritesWithVerification, type WriteProgressPhase } from "../shared/verifiedWrite";
import { resolveHcpcs, isAutoFilledMedicaidSupply, PRIMARY_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX } from "./hcpcRules";
import type { PrimaryInsurance } from "./hcpcRules";
import {
  AUTH_RESULT_INDEX,
  AUTH_METHOD_OPTION_ID,
  ESCALATION_INDEX,
  NOT_CLEAR_PRODUCT_ID,
  PRODUCT_CODE_TO_PRODUCT_ID,
  TRIGGER_DVS_INDEX,
  TRIGGER_PUMP_DVS_INDEX,
  SKIP_SOS_PRODUCT_ID,
  STAGE_INDEX,
  UNIVERSAL_INDEX,
} from "./mondayMapping";
import type { Patient, ProductCodeId, ProductCodeState } from "./workflow";
import { EMPTY_INSURANCE, deriveInsuranceOutcome, computeNextOrderDates, isNegUniversal } from "./workflow";
import {
  appendCallLog,
  composeCallLogLines,
  composeEscalationReason,
  derivedSos,
  deriveNeverBilled,
  etTodayYmd,
  isBlankCallRow,
  isValidUnits,
  patientHasMedicaidIns,
  universalEscalationLevel,
} from "./benefitsDerive";
import {
  diffIdentity,
  identityNoteText,
  IDENTITY_STATUS_COLUMNS,
  IDENTITY_TEXT_COLUMNS,
  type IdentityChange,
  type IdentityDraft,
  type IdentityStatusFieldId,
} from "./managerIdentityEdit";
import { appendStampedNote } from "../shared/noteStamp";
import { derivedRecheckSos, effectiveResult } from "./authOutstandingReview";
import { isMedicarePrimary } from "./medicareJurisdiction";
import { allProductsDvsRouted, dvsAutoTrigger, hasDvsRoutedProducts } from "./dvsRouting";
import { etNow } from "../masheke/etDate";
import { userInitials } from "../shared/auth";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
  /** Expected text value after the write. Used for read-back verification
   *  before the stage advancer is written. */
  expectedText?: string;
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
export async function sendPatientToMonday(
  p: Patient,
  context: "benefits" | "submitAuth" | "authOutstanding" = "benefits",
  opts?: { onProgress?: (phase: WriteProgressPhase) => void },
): Promise<void> {
  const rawIns = p.insurance ?? EMPTY_INSURANCE;
  const tasks: WriteTask[] = [];

  // ----- Guard: require Serving + Primary Insurance -----
  const resolved = resolveHcpcs(p.primaryInsurance || null, p.serving || null, p.secondaryInsurance ?? null);
  if (!p.serving || !p.primaryInsurance || resolved.length === 0) {
    throw new Error(
      "Cannot send: Serving and Primary Insurance must both be selected before writing to Monday. " +
        "The Benefits header is read-only — fix the patient at Profile Send-Off.",
    );
  }

  // ----- Benefits redesign: DERIVE SoS + Never Billed from recorded facts -----
  // The rep records Auth + billing facts only; Clear/Not-Clear/Skip and the
  // Medicare never-billed rollups are computed here at send time (spec §1/§2,
  // benefitsDerive.ts). Other contexts keep the state they hydrated.
  const todayEt = etTodayYmd();
  const hasMedicaidIns = patientHasMedicaidIns(p.primaryInsurance ?? "", p.secondaryInsurance ?? "");
  // Medicare A&B primary → 5-year RUL for pump/CGM monitor same-or-similar.
  const isMedicare = isMedicarePrimary(p.primaryInsurance ?? "");

  // Failed-check path (Medicare-not-Primary handoff §2–§4): any negative
  // universal answer at Benefits means step 2 never ran — write ONLY the
  // universal checks + Escalation + Stage Advancer (+ notes/call log/profile)
  // and leave every per-product column untouched, even if stale step-2 facts
  // linger locally behind the disabled UI. Benefits context ONLY: in the auth
  // groups a board "Stuck" hydrates back as not-confirmed and must never
  // suppress auth writes there.
  const universalNegative =
    context === "benefits" && Object.values(rawIns.universal).some(isNegUniversal);

  let ins = rawIns;
  if (context === "benefits") {
    const derivedCodes: typeof rawIns.codes = { ...rawIns.codes };
    for (const r of resolved) {
      if (isAutoFilledMedicaidSupply(r)) continue; // hardcoded later in `entries`
      const cid = Object.entries(PRODUCT_CODE_TO_PRODUCT_ID).find(([, v]) => v === r.product)?.[0] as
        | ProductCodeId
        | undefined;
      if (!cid) continue;
      const st = derivedCodes[cid] ?? ({ status: "pending" } as ProductCodeState);
      derivedCodes[cid] = { ...st, sos: derivedSos(st, cid, hasMedicaidIns, todayEt, isMedicare) };
    }
    const nb = deriveNeverBilled({ ...rawIns, codes: derivedCodes }, p.primaryInsurance ?? "");
    ins = {
      ...rawIns,
      codes: derivedCodes,
      neverBilledIsCar: nb.isCar,
      neverBilledCgm: nb.cgm,
    };
  }

  // ----- Universal: In-Network + Active -----
  // Two INDEPENDENT columns since the 2026-07-29 board split. Each answer
  // writes its own column, so an in-network-but-inactive patient now reads
  // "In-Network" + "Inactive" instead of a single "Out-of-Network" that hid
  // which check actually failed. "Medicare not Primary" has its own board
  // label as of 2026-07-29 — it must be checked BEFORE isNegUniversal, which
  // is also true for it.
  const inNet = ins.universal["in-network"];
  const active = ins.universal["active"];
  if (inNet === "confirmed") {
    tasks.push({
      label: "In-Network",
      columnId: COL.inNetwork,
      fn: () => writeStatusIndex(p.id, COL.inNetwork, UNIVERSAL_INDEX.inNetwork.pass),
    });
  } else if (inNet === "medicare-not-primary") {
    tasks.push({
      label: "In-Network",
      columnId: COL.inNetwork,
      fn: () => writeStatusIndex(p.id, COL.inNetwork, UNIVERSAL_INDEX.inNetwork.medicareNotPrimary),
    });
  } else if (isNegUniversal(inNet)) {
    tasks.push({
      label: "In-Network",
      columnId: COL.inNetwork,
      fn: () => writeStatusIndex(p.id, COL.inNetwork, UNIVERSAL_INDEX.inNetwork.fail),
    });
  }
  if (active === "confirmed") {
    tasks.push({
      label: "Active",
      columnId: COL.active,
      fn: () => writeStatusIndex(p.id, COL.active, UNIVERSAL_INDEX.active.pass),
    });
  } else if (isNegUniversal(active)) {
    tasks.push({
      label: "Active",
      columnId: COL.active,
      fn: () => writeStatusIndex(p.id, COL.active, UNIVERSAL_INDEX.active.fail),
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
  // We also tag the entry with isMedicaidSupply so the Submit Auth write
  // path can leave these supplies at "Required" (the Monday DVS-trigger
  // automation expects them to flip from blank → Required at Benefits
  // send and stay Required until IP Auth Result becomes Auth Valid /
  // Not Serving).
  const entries = resolved
    .map((r) => {
      const cid = Object.entries(PRODUCT_CODE_TO_PRODUCT_ID).find(([, v]) => v === r.product)?.[0] as
        | ProductCodeId
        | undefined;
      if (!cid) return null;
      const userState = ins.codes[cid];
      const isMedicaidSupply = isAutoFilledMedicaidSupply(r);
      const state: ProductCodeState | undefined = isMedicaidSupply
        ? { ...(userState ?? { status: "pending" }), auth: "required", sos: "clear" }
        : userState;
      return { cid, state, isMedicaidSupply };
    })
    .filter(
      (e): e is { cid: ProductCodeId; state: ProductCodeState | undefined; isMedicaidSupply: boolean } =>
        !!e,
    );

  // Auth Outstanding redesign (§3): the SoS recheck is DERIVED from recorded
  // facts at SEND time (ET-anchored, same cutoffs as Benefits) — the UI sets
  // sosRecheck live for display, but this recomputation is authoritative so a
  // Friday-entered fact sent on Monday still derives against today's cutoff.
  if (context === "authOutstanding") {
    for (const e of entries) {
      if (e.isMedicaidSupply || !e.state) continue;
      if (effectiveResult(e.state) !== "no-auth-needed") continue;
      const derived = derivedRecheckSos(e.state, e.cid, hasMedicaidIns, todayEt, isMedicare);
      if (derived) e.state = { ...e.state, sosRecheck: derived };
    }
  }

  // Effective insurance state with auto-filled codes — used by
  // deriveInsuranceOutcome below so blocker/auth-required/all-clear logic
  // sees the same picture as the UI preview.
  const effectiveCodes: typeof ins.codes = { ...ins.codes };
  for (const e of entries) {
    if (e.state) effectiveCodes[e.cid] = e.state;
  }
  const effectiveIns = { ...ins, codes: effectiveCodes };

  // Write auth result for served products (skip for authOutstanding — handled
  // separately below; skip entirely on the failed-check path — step 2 never ran)
  const servedProductKeys = new Set(entries.map((e) => PRODUCT_CODE_TO_PRODUCT_ID[e.cid]));
  if (context !== "authOutstanding" && !universalNegative) {
  for (const { cid, state, isMedicaidSupply } of entries) {
    if (!state?.auth) continue;
    const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
    const authColumnId = COL.authResult[productId];
    if (state.auth === "required") {
      // When sending from Submit Auth tab, flip auth result to "Submitted"
      // — but skip Medicaid-routed supplies. They stay at "Required" so
      // the Monday automation can trigger DVS later, when IP Auth Result
      // changes to Auth Valid (or Not Serving for Supplies-Only patients).
      if (context === "submitAuth") {
        if (isMedicaidSupply) {
          console.log(`[mondayWrite] submitAuth: skipping Medicaid-routed supply ${productId} (staying at Required)`);
          continue;
        }
        // Flip ONLY products whose BOARD label is exactly "Required" — the
        // same rule submitAuthCards uses to render a card. Hydration collapses
        // Auth Valid / Denied / Submitted into internal auth "required"
        // (AUTH_RESULT_TEXT_MAP), so gating on internal state alone would
        // silently overwrite an already-resolved auth outcome on the board
        // for a product the rep never saw a card for.
        const boardLabel = (state._mondayAuthLabel ?? "").trim().toLowerCase();
        if (boardLabel !== "required") {
          console.log(`[mondayWrite] submitAuth: leaving ${productId} untouched (board label "${state._mondayAuthLabel ?? ""}", not "Required")`);
          continue;
        }
        console.log(`[mondayWrite] submitAuth: writing ${productId} → Submitted`);
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
  if (context !== "submitAuth" && context !== "authOutstanding" && !universalNegative) {
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

  // ----- Not Clear Products + Skip SoS Products dropdowns -----
  // Effective SoS per product = recheck if set, else the Benefits-page sos.
  // This way an Auth Outstanding recheck of Clear / Not Clear properly
  // moves a product between the two dropdowns and out of skip.
  const effectiveSos = (e: typeof entries[number]): "" | "clear" | "not-clear" | "skip" => {
    const recheck = e.state?.sosRecheck;
    if (recheck === "clear" || recheck === "not-clear") return recheck;
    return (e.state?.sos as "" | "clear" | "not-clear" | "skip" | undefined) ?? "";
  };

  if (!universalNegative) {
  const notClearIds = entries
    .filter((e) => effectiveSos(e) === "not-clear")
    .map((e) => NOT_CLEAR_PRODUCT_ID[e.cid])
    .filter((n): n is number => typeof n === "number");
  tasks.push({
    label: "Not Clear Products",
    columnId: COL.notClearProducts,
    fn: () => writeDropdownIds(p.id, COL.notClearProducts, notClearIds),
  });

  const skipIds = entries
    .filter((e) => effectiveSos(e) === "skip")
    .map((e) => SKIP_SOS_PRODUCT_ID[e.cid])
    .filter((n): n is number => typeof n === "number");
  tasks.push({
    label: "Skip SoS Products",
    columnId: COL.skipSosProducts,
    fn: () => writeDropdownIds(p.id, COL.skipSosProducts, skipIds),
  });
  }

  // ----- Per-product Last Bill Date (date — when SoS = Not Clear OR Auth = No Auth Needed) -----
  if (!universalNegative) {
  for (const { cid, state } of entries) {
    const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
    const lastBillDateCol = COL.lastBillDate[productId];
    const eSos = effectiveSos({ cid, state, isMedicaidSupply: false });
    // On Auth Outstanding, a hydrated partial save (board label "No Auth
    // Needed", no local result) counts too — effectiveResult covers it.
    const noAuthNeeded =
      context === "authOutstanding"
        ? effectiveResult(state) === "no-auth-needed"
        : state?.authOutstandingResult === "no-auth-needed";
    if ((eSos === "not-clear" || noAuthNeeded) && state?.lastBillDate) {
      tasks.push({
        label: `Last Bill Date: ${productId}`,
        columnId: lastBillDateCol,
        fn: () => writeDate(p.id, lastBillDateCol, state.lastBillDate!),
      });
    } else {
      // Clear last bill date when neither condition applies
      tasks.push({
        label: `Last Bill Date (clear): ${productId}`,
        columnId: lastBillDateCol,
        fn: () => writeDate(p.id, lastBillDateCol, ""),
      });
    }
  }
  }

  // ----- Calculated Next Order Dates (3 columns) -----
  if (!universalNegative) {
    // A product whose effective SoS is Skip is deferred — its entered
    // last-bill date contributes nothing to next-order math (spec §1:
    // "Any previously entered date/units are ignored while Auth = Required").
    const nodCodes: typeof effectiveIns.codes = { ...effectiveIns.codes };
    for (const e of entries) {
      if (effectiveSos(e) === "skip" && nodCodes[e.cid]?.lastBillDate) {
        nodCodes[e.cid] = { ...nodCodes[e.cid]!, lastBillDate: "" };
      }
    }
    const nod = computeNextOrderDates({ ...effectiveIns, codes: nodCodes }, p.primaryInsurance ?? "", p.secondaryInsurance ?? "");
    // IP Next Order Date
    tasks.push({
      label: "IP Next Order Date",
      columnId: COL.nextOrderDate.insulin_pump,
      fn: () => writeDate(p.id, COL.nextOrderDate.insulin_pump, nod.ipNextOrderDate),
    });
    // Sensors Next Order Date
    tasks.push({
      label: "Sensors Next Order Date",
      columnId: COL.nextOrderDate.sensors,
      fn: () => writeDate(p.id, COL.nextOrderDate.sensors, nod.sensorsNextOrderDate),
    });
    // Supplies Next Order Date
    tasks.push({
      label: "Supplies Next Order Date",
      columnId: COL.nextOrderDate.supplies,
      fn: () => writeDate(p.id, COL.nextOrderDate.supplies, nod.suppliesNextOrderDate),
    });
  }

  // ----- Aggregate SoS + Auth -----
  // SoS is now always required for every product (no auth-required skip
  // carve-out). A patient is "all filled" only when every served product
  // has both Auth and SoS picked.
  const states = entries.map((e) => e.state);
  const allFilled =
    states.length > 0 &&
    entries.every((e) => !!e.state?.auth && !!effectiveSos(e));
  if (allFilled && !universalNegative) {
    const anyAuth = states.some((s) => s?.auth === "required");
    const anyNotClear = entries.some((e) => effectiveSos(e) === "not-clear");
    const anySkip = entries.some((e) => effectiveSos(e) === "skip");

    tasks.push({
      label: "Auth aggregate",
      columnId: COL.auth,
      fn: () =>
        writeStatusIndex(p.id, COL.auth, anyAuth ? UNIVERSAL_INDEX.auth.required : UNIVERSAL_INDEX.auth.noAuth),
    });

    // SoS aggregate priority:
    //   not-clear > skip > clear
    const sosIndex = anyNotClear
      ? UNIVERSAL_INDEX.sos.fail
      : anySkip
        ? UNIVERSAL_INDEX.sos.skip
        : UNIVERSAL_INDEX.sos.pass;
    tasks.push({
      label: "SoS aggregate",
      columnId: COL.sos,
      fn: () => writeStatusIndex(p.id, COL.sos, sosIndex),
    });
  }

  // ----- Debug: trace deriveInsuranceOutcome -----
  {
    const _outcome = deriveInsuranceOutcome(effectiveIns, entries.map(e => e.cid));
    const _codeStates = Object.values(effectiveIns.codes).filter(Boolean);
    console.log('[mondayWrite] context:', context);
    console.log('[mondayWrite] universal:', JSON.stringify(effectiveIns.universal));
    console.log('[mondayWrite] codeStates:', JSON.stringify(_codeStates.map((c) => ({ auth: c?.auth, sos: c?.sos }))));
    console.log('[mondayWrite] entries:', JSON.stringify(entries.map(e => ({ cid: e.cid, auth: e.state?.auth, sos: e.state?.sos }))));
    console.log('[mondayWrite] deriveInsuranceOutcome =>', _outcome);
  }

  // ----- Escalation + Stage Advancer -----
  // One write each per send. Per-context rules decide the Stage Advancer
  // index, and Escalation is computed as: manual toggle (p.escalated) is
  // the floor — true means "Required" no matter what auto rules say.
  // Auto rules can also force Required (denial / blocker). When neither
  // manual nor auto demands escalation, we write "Done" so the toggle
  // round-trips through Monday cleanly.
  //
  // Benefits redesign: escalation at Benefits is DERIVED ONLY (spec §5 —
  // the Escalate button is gone). The hydrated p.escalated flag must NOT
  // floor the decision there, or a previously-escalated patient could
  // never be de-escalated by fixing the underlying facts and re-sending.
  const manualEscalate = context !== "benefits" && p.escalated === true;
  let stageWriteIndex: number | null = null;
  type EscalationDecision = "manager" | "final" | "done";
  let escalationDecision: EscalationDecision = manualEscalate ? "manager" : "done";

  if (context === "submitAuth") {
    // DVS routing (HANDOFF-Josh-DVS §1): a patient with zero submission
    // cards because EVERYTHING bills straight Medicaid goes to the DVS
    // stage, not Auth Outstanding — the stage write itself triggers the bot.
    stageWriteIndex = allProductsDvsRouted(p) ? STAGE_INDEX.dvs : STAGE_INDEX.authOutstanding;
    // submitAuth doesn't auto-touch escalation; manual toggle decides.
    // Follow Up Date → TODAY (ET), same-day not +1 — many auths approve
    // right away (Submit Auth redesign §7). This is the prerequisite for
    // the Auth Outstanding daily bucket: reps there will only see patients
    // whose Follow Up Date is today or earlier, and a "Still Outstanding"
    // button will push it +1 day. The Follow Up STATUS column is left
    // alone — the sidebar's Follow Up section keys on the status label,
    // and these patients aren't snoozed, just date-stamped.
    tasks.push({
      label: "Follow Up Date (today)",
      columnId: COL.followUpDate,
      fn: () => writeDate(p.id, COL.followUpDate, todayEt),
    });
  } else if (context === "authOutstanding") {
    // Auth Outstanding outcome rules (priority order):
    //   1. ANY product denied                → Stage = Auth Denied + Escalation Required
    //   2. ALL served products fully resolved → Stage = Complete
    //      (auth-valid or no-auth-needed count as resolved regardless
    //       of SoS status — SoS Not Clear does NOT block completion)
    //   3. Otherwise (partial — some product
    //      missing a result)                 → leave Stage Advancer alone
    // DVS-routed products neither gate nor advance this page (§7): they're
    // excluded from the rule entirely, and a patient whose products are ALL
    // DVS-routed can never reach Complete from here — their stage moves at
    // the DVS view.
    const nonDvsEntries = entries.filter((e) => !e.isMedicaidSupply);
    const anyDenied = nonDvsEntries.some(
      (e) => e.state?.authOutstandingResult === "denied",
    );
    const isProductResolved = (e: typeof entries[number]) => {
      // Products that were auth=not-required on Benefits never appear on
      // the Auth Outstanding UI, so they have no authOutstandingResult to
      // fill in. They're already resolved — no auth work needed.
      if (e.state?.auth === "not-required") return true;
      const r = e.state ? effectiveResult(e.state) : "";
      if (r === "auth-valid") return true;
      // No Auth Needed only resolves once its SoS recheck went out — a
      // partial save awaiting the recheck keeps the stage put (§4). The
      // recheck normalization above set sosRecheck when facts exist.
      if (r === "no-auth-needed") {
        return e.state?.sosRecheck === "clear" || e.state?.sosRecheck === "not-clear" || e.state?.sos !== "skip";
      }
      return false;
    };
    const allResolved =
      nonDvsEntries.length > 0 && nonDvsEntries.every(isProductResolved);

    // Diagnostic — verify the rule sees the right per-product results.
    console.log("[mondayWrite] authOutstanding rule:", {
      anyDenied,
      allResolved,
      manualEscalate,
      results: entries.map((e) => ({
        cid: e.cid,
        authOutstandingResult: e.state?.authOutstandingResult ?? "(unset)",
        sos: e.state?.sos ?? "(unset)",
        sosRecheck: e.state?.sosRecheck ?? "(unset)",
      })),
    });

    if (anyDenied) {
      stageWriteIndex = STAGE_INDEX.authDenied;
      escalationDecision = "manager"; // forced by denial regardless of toggle
    } else if (allResolved) {
      // Auth rail finished. Patients with Medicaid-routed supplies exit to
      // the DVS stage (the stage write triggers the bot, HANDOFF-Josh-DVS
      // §1/§7); everyone else completes as before.
      stageWriteIndex = hasDvsRoutedProducts(p) ? STAGE_INDEX.dvs : STAGE_INDEX.complete;
      // escalation follows manualEscalate (already set above)
    } else if (nonDvsEntries.length === 0 && entries.length > 0) {
      // ALL products are DVS-routed — this patient never belonged on the
      // auth rail. Send them to the DVS stage (supersedes the older
      // "never advances" guard, which predates the DVS stage existing).
      stageWriteIndex = STAGE_INDEX.dvs;
    }
    // else: partial → no Stage Advancer write; escalation still follows toggle
  } else {
    // benefits page — use insurance outcome to drive Stage Advancer.
    const outcome = deriveInsuranceOutcome(effectiveIns, entries.map(e => e.cid));
    if (outcome === "all-clear") stageWriteIndex = STAGE_INDEX.complete;
    else if (outcome === "auth-required") stageWriteIndex = STAGE_INDEX.authorization;
    else stageWriteIndex = STAGE_INDEX.benefitsSos;
    // DVS routing (HANDOFF-Josh-DVS §1): every served product bills straight
    // Medicaid → skip Submit Auth / Auth Outstanding entirely, stage → DVS.
    // A failed universal check still wins (blocker path escalates instead).
    if (outcome !== "blocker" && outcome !== "incomplete" && allProductsDvsRouted(p)) {
      stageWriteIndex = STAGE_INDEX.dvs;
    }
    // Blocker force-elevates escalation, split by cause (2026-07): a failed
    // universal check → Final (oversight Final Decisions); insulin-pump SoS
    // Not Clear only → Manager (oversight Manager Intervention). Check-fail
    // wins if both fire — deriveInsuranceOutcome returns blocker for the
    // universal case first (workflow.ts:540 before :552).
    // universalEscalationLevel owns the precedence between the checks
    // themselves (Medicare not Primary outranks everything else).
    if (outcome === "blocker") {
      const level = universalEscalationLevel(effectiveIns);
      escalationDecision = level === "none" ? "manager" : level;
    }
  }

  if (stageWriteIndex !== null) {
    const finalStageIndex = stageWriteIndex;
    tasks.push({
      label: "Stage Advancer",
      columnId: COL.stageAdvancer,
      fn: () => writeStatusIndex(p.id, COL.stageAdvancer, finalStageIndex),
    });
    // Landing at DVS auto-flips the right bot trigger by serving (Josh,
    // 2026-07-21): pump first for straight-Medicaid pump patients (supplies
    // chain bot-side after the pump claim pays), supplies otherwise. These
    // are the trigger columns today's automate-dvs bots listen to; delete
    // when the v2 bot keys on the stage flip itself.
    if (finalStageIndex === STAGE_INDEX.dvs) {
      const trig = dvsAutoTrigger(p);
      if (trig === "pump") {
        tasks.push({
          label: "Trigger Pump DVS (auto)",
          columnId: COL.triggerPumpDvs,
          fn: () => writeStatusIndex(p.id, COL.triggerPumpDvs, TRIGGER_PUMP_DVS_INDEX.triggerPumpDvs),
        });
      } else if (trig === "supplies") {
        tasks.push({
          label: "Trigger Supplies DVS (auto)",
          columnId: COL.triggerDvs,
          fn: () => writeStatusIndex(p.id, COL.triggerDvs, TRIGGER_DVS_INDEX.triggerDvs),
        });
      }
    }
  }
  // Always write the Escalation column so the toggle round-trips: an
  // agent toggling OFF + sending will clear a previously-required flag.
  tasks.push({
    label: "Escalation",
    columnId: COL.escalation,
    fn: () =>
      writeStatusIndex(
        p.id,
        COL.escalation,
        escalationDecision === "final"
          ? ESCALATION_INDEX.finalRequired
          : escalationDecision === "manager"
            ? ESCALATION_INDEX.managerRequired
            : ESCALATION_INDEX.done,
      ),
  });
  console.log(`[mondayWrite] Stage = ${stageWriteIndex ?? "(no change)"}, Escalation = ${escalationDecision}`);

  // ----- Benefits redesign: auto-composed escalation reason (D4) -----
  // Derived escalations carry no form text (the Escalate modal is gone at
  // Benefits), so compose the reason from the failing derivation and append
  // it to Call Reference Notes — visible to all three Insurance roles and
  // hop-copied to Welcome Call. Skipped if the identical line already
  // landed (repeat sends of the same blocker don't duplicate).
  let notesForSend: string | undefined = typeof p.notes === "string" ? p.notes : undefined;
  if (context === "benefits" && escalationDecision !== "done") {
    // On the failed-check path the reason cites only the failed checks —
    // pump SoS facts behind the disabled step 2 are stale, not findings.
    const reason = composeEscalationReason(
      ins,
      universalNegative ? "" : (ins.codes["pump"]?.sos ?? ""),
      universalNegative ? undefined : ins.codes["pump"]?.lastBillDate,
      todayEt,
      userInitials(),
    );
    if (reason && !(notesForSend ?? "").includes(reason)) {
      notesForSend = notesForSend ? `${notesForSend}\n\n${reason}` : reason;
    }
  }

  // ----- Never Billed attestations (Medicare A&B) -----
  // Skipped on the failed-check path — derived from step-2 facts that never ran.
  if (ins.neverBilledIsCar && !universalNegative) {
    tasks.push({
      label: "Never billed IS/Car",
      columnId: COL.neverBilledIsCar,
      fn: () => writeStatusIndex(p.id, COL.neverBilledIsCar, 0),
    });
  }
  if (ins.neverBilledCgm && !universalNegative) {
    tasks.push({
      label: "Never billed CGM",
      columnId: COL.neverBilledCgm,
      fn: () => writeStatusIndex(p.id, COL.neverBilledCgm, 0),
    });
  }

  // ----- Benefits redesign: SoS facts columns + TBD pump date + call logs -----
  if (context === "benefits") {
    // Per-product SoS billing facts (D2/D6): the full record — written for
    // every billed product (even derived-Clear), cleared otherwise so stale
    // facts never linger. Deliberately SEPARATE from the legacy lastBillDate
    // columns, whose date-presence still encodes "Not Clear" downstream.
    // Facts are ignored while the product's auth is pending (spec §1), and
    // the whole family is untouched on the failed-check path (handoff §4).
    const ALL_CODE_IDS = Object.keys(PRODUCT_CODE_TO_PRODUCT_ID) as ProductCodeId[];
    const servedCids = new Set(entries.map((e) => e.cid));
    if (!universalNegative)
    for (const cid of ALL_CODE_IDS) {
      const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
      const st = ins.codes[cid];
      const isBilledFact =
        servedCids.has(cid) &&
        st?.sosEntry === "billed" &&
        st.auth !== "required" &&
        !!st.lastBillDate;
      const dateVal = isBilledFact ? st!.lastBillDate! : "";
      tasks.push({
        label: `SoS Last Bill: ${productId}`,
        columnId: COL.sosLastBill[productId],
        fn: () => writeDate(p.id, COL.sosLastBill[productId], dateVal),
      });
      const unitsVal = isBilledFact && isValidUnits(st?.units) ? st!.units! : "";
      tasks.push({
        label: `SoS Units: ${productId}`,
        columnId: COL.sosUnits[productId],
        fn: () => writeNumber(p.id, COL.sosUnits[productId], unitsVal),
      });
      // "No Billing History" checkbox — the rep's answer for ALL payers
      // (the Medicare A&B rollups remain the derived special case). Written
      // checked/cleared every send, so it always matches the current answer.
      const neverChecked = servedCids.has(cid) && st?.sosEntry === "never" && st.auth !== "required";
      tasks.push({
        label: `SoS No Billing History: ${productId}`,
        columnId: COL.sosNeverBilled[productId],
        fn: () => writeCheckbox(p.id, COL.sosNeverBilled[productId], neverChecked),
      });
    }

    // Call logs (D8) + "TBD" pump date (D1). Read the current values ONCE so
    // each write is a single pre-composed, retry-idempotent value (no
    // double-append on retry — RELIABILITY_AUDIT §H pattern).
    // Step-1 payer calls always land; the step-2 log + TBD pump date are
    // step-2 outputs, skipped on the failed-check path (handoff §2/§4).
    const rows1 = (ins.callsUniversal ?? []).filter((r) => !isBlankCallRow(r));
    const rows2 = universalNegative ? [] : (ins.callsSosAuth ?? []).filter((r) => !isBlankCallRow(r));
    const pumpDateTbd = !universalNegative && !!ins.neverBilledIsCar; // derived: Medicare A&B + IS AND Cartridges never billed

    // Call logs → appended (timestamped) into Call Reference Notes, NOT the old
    // dedicated columns (Josh, 2026-07): both the payer and SoS/auth calls land
    // in the same notes. appendCallLog dedups against the notes text, and the
    // notes write is a full replace, so a rapid double-send never duplicates a
    // call line. Every call in one send shares the send-time ET stamp.
    if (rows1.length > 0 || rows2.length > 0) {
      const stamp = etNow().toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      });
      const ini = userInitials();
      const callLogLines = [
        ...composeCallLogLines(rows1, "benefits", stamp, ini),
        ...composeCallLogLines(rows2, "sos-auth", stamp, ini),
      ];
      notesForSend = appendCallLog(notesForSend, callLogLines);
    }

    // "TBD" pump date (D1): write the literal "TBD" only into an empty (or
    // already-TBD) cell — never clobber a real date someone collected.
    if (pumpDateTbd) {
      const current = await readColumnTexts(p.id, [COL.medicarePriorPumpDate]);
      const existingPumpDate = (current.find((c) => c.id === COL.medicarePriorPumpDate)?.text ?? "").trim();
      if (!existingPumpDate || existingPumpDate === "TBD") {
        tasks.push({
          label: "Medicare Prior Pump Date (TBD)",
          columnId: COL.medicarePriorPumpDate,
          fn: () => writeText(p.id, COL.medicarePriorPumpDate, "TBD"),
          expectedText: "TBD",
        });
      }
    }
  }

  // ----- Auth Outstanding redesign: SoS recheck facts (§3) -----
  // The recheck records the same facts as Benefits (Last Bill Date + Units,
  // or No Billing History) into the same facts columns — but ONLY for
  // products whose result is No Auth Needed and whose recheck was actually
  // recorded. Everything else is left untouched: this block must never
  // clear facts Benefits wrote for other products.
  if (context === "authOutstanding") {
    for (const { cid, state, isMedicaidSupply } of entries) {
      if (isMedicaidSupply || !state) continue;
      if (effectiveResult(state) !== "no-auth-needed") continue;
      const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
      if (state.sosEntry === "billed" && state.lastBillDate) {
        tasks.push({
          label: `SoS Last Bill (recheck): ${productId}`,
          columnId: COL.sosLastBill[productId],
          fn: () => writeDate(p.id, COL.sosLastBill[productId], state.lastBillDate!),
        });
        if (isValidUnits(state.units)) {
          tasks.push({
            label: `SoS Units (recheck): ${productId}`,
            columnId: COL.sosUnits[productId],
            fn: () => writeNumber(p.id, COL.sosUnits[productId], state.units!),
          });
        }
        tasks.push({
          label: `SoS No Billing History (recheck): ${productId}`,
          columnId: COL.sosNeverBilled[productId],
          fn: () => writeCheckbox(p.id, COL.sosNeverBilled[productId], false),
        });
      } else if (state.sosEntry === "never") {
        tasks.push({
          label: `SoS No Billing History (recheck): ${productId}`,
          columnId: COL.sosNeverBilled[productId],
          fn: () => writeCheckbox(p.id, COL.sosNeverBilled[productId], true),
        });
        tasks.push({
          label: `SoS Last Bill (recheck, clear): ${productId}`,
          columnId: COL.sosLastBill[productId],
          fn: () => writeDate(p.id, COL.sosLastBill[productId], ""),
        });
        tasks.push({
          label: `SoS Units (recheck, clear): ${productId}`,
          columnId: COL.sosUnits[productId],
          fn: () => writeNumber(p.id, COL.sosUnits[productId], ""),
        });
      }
      // No recheck recorded → write nothing for this product.
    }
  }

  // ----- Trigger DVS (Medicaid + supplies) -----
  // Only write when the agent toggled the button on the Benefits page.
  if (p.triggerDvs) {
    tasks.push({
      label: "Trigger DVS",
      columnId: COL.triggerDvs,
      fn: () => writeStatusIndex(p.id, COL.triggerDvs, TRIGGER_DVS_INDEX.triggerDvs),
    });
  }

  // ----- Trigger Pump DVS (Medicaid + insulin pump) -----
  // Separate bot system from the supplies DVS: its own trigger column,
  // no retry, no claims. Only write when the agent toggled the button.
  if (p.triggerPumpDvs) {
    tasks.push({
      label: "Trigger Pump DVS",
      columnId: COL.triggerPumpDvs,
      fn: () => writeStatusIndex(p.id, COL.triggerPumpDvs, TRIGGER_PUMP_DVS_INDEX.triggerPumpDvs),
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
  // Top-level patient field (entered from profile card)
  if (p.carecentrixIntakeId) {
    tasks.push({
      label: "Carecentrix Intake ID (profile)",
      columnId: COL.carecentrixIntakeId,
      fn: () => writeText(p.id, COL.carecentrixIntakeId, p.carecentrixIntakeId!),
    });
  }
  // Per-product code fallback (from checklist steps)
  const allCodeStates = Object.values(ins.codes).filter(Boolean) as ProductCodeState[];
  const intakeId = allCodeStates.map((s) => s.intakeId).find((v) => !!v);
  if (intakeId && !p.carecentrixIntakeId) {
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

  // ----- Profile fields (editable from PatientProfileCard) -----
  // Item name
  if (p.name) {
    tasks.push({
      label: 'Patient Name',
      columnId: 'name',
      fn: () => writeItemName(p.id, p.name),
    });
  }
  // DOB (text column)
  if (p.dob) {
    tasks.push({
      label: 'DOB',
      columnId: COL.dob,
      fn: () => writeText(p.id, COL.dob, p.dob),
    });
  }
  // Primary Insurance (status column)
  if (p.primaryInsurance) {
    const idx = PRIMARY_INSURANCE_INDEX[p.primaryInsurance as PrimaryInsurance];
    if (idx !== undefined) {
      tasks.push({
        label: 'Primary Insurance',
        columnId: COL.primaryInsurance,
        fn: () => writeStatusIndex(p.id, COL.primaryInsurance, idx),
      });
    }
  }
  // Member IDs (text columns)
  if (p.memberId1 !== undefined) {
    tasks.push({
      label: 'Member ID 1',
      columnId: COL.memberId1,
      fn: () => writeText(p.id, COL.memberId1, p.memberId1 ?? ''),
    });
  }
  if (p.memberId2 !== undefined) {
    tasks.push({
      label: 'Member ID 2',
      columnId: COL.memberId2,
      fn: () => writeText(p.id, COL.memberId2, p.memberId2 ?? ''),
    });
  }
  // Secondary Insurance (status column)
  if (p.secondaryInsurance !== undefined) {
    const secIdx = SECONDARY_INSURANCE_INDEX[p.secondaryInsurance ?? ""];
    if (secIdx !== undefined) {
      tasks.push({
        label: 'Secondary Insurance',
        columnId: COL.secondaryInsurance,
        fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, secIdx),
      });
    }
  }
  // Diagnosis (status column — write by label)
  if (p.diagnosis) {
    tasks.push({
      label: 'Diagnosis',
      columnId: COL.diagnosis,
      fn: () => writeSimpleValue(p.id, COL.diagnosis, p.diagnosis!),
    });
  }
  // Doctor fields
  if (p.doctorName !== undefined) {
    tasks.push({
      label: 'Doctor Name',
      columnId: COL.doctorName,
      fn: () => writeText(p.id, COL.doctorName, p.doctorName ?? ''),
    });
  }
  if (p.doctorPhone !== undefined) {
    tasks.push({
      label: 'Doctor Phone',
      columnId: COL.doctorPhone,
      fn: () => writePhone(p.id, COL.doctorPhone, p.doctorPhone ?? ''),
    });
  }
  if (p.doctorNpi !== undefined) {
    tasks.push({
      label: 'Doctor NPI',
      columnId: COL.doctorNpi,
      fn: () => writeText(p.id, COL.doctorNpi, p.doctorNpi ?? ''),
    });
  }
  if (p.doctorEmail !== undefined) {
    tasks.push({
      label: 'Doctor Email',
      columnId: COL.doctorEmail,
      fn: () => writeEmail(p.id, COL.doctorEmail, p.doctorEmail ?? ''),
    });
  }
  if (p.doctorFax !== undefined) {
    tasks.push({
      label: 'Doctor Fax',
      columnId: COL.doctorFax,
      fn: () => writeEmail(p.id, COL.doctorFax, p.doctorFax ?? ''),
    });
  }
  // Clinicals Method (status column — write by label)
  if (p.clinicalsMethod) {
    tasks.push({
      label: 'Clinicals Method',
      columnId: COL.clinicalsMethod,
      fn: () => writeSimpleValue(p.id, COL.clinicalsMethod, p.clinicalsMethod!),
    });
  }
  // Clinic Name (dropdown — write by label, creating the label if this board
  // doesn't have it yet). Clinic names are an open vocabulary and the source
  // board's label can differ slightly from the Insurance board's (e.g.
  // "The Office Don Zwickler" vs "The Office Don Zwickler, MD"), which would
  // otherwise reject the write and block the whole send.
  if (p.clinicName) {
    tasks.push({
      label: 'Clinic Name',
      columnId: COL.clinicName,
      fn: () => writeDropdownLabels(p.id, COL.clinicName, [p.clinicName!], true),
    });
  }
  // Patient Phone (phone column)
  if (p.patientPhone !== undefined) {
    tasks.push({
      label: 'Patient Phone',
      columnId: COL.patientPhone,
      fn: () => writePhone(p.id, COL.patientPhone, p.patientPhone ?? ''),
    });
  }
  // Patient Address (location column)
  if (p.patientAddress) {
    tasks.push({
      label: 'Patient Address',
      columnId: COL.patientAddress,
      fn: () => writeLocation(p.id, COL.patientAddress, p.patientAddress ?? ''),
    });
  }

  // ----- Notes (long text) -----
  // notesForSend = p.notes, plus the auto-escalation reason line when a
  // Benefits send derives an escalation (D4).
  if (typeof notesForSend === "string") {
    const notesVal = notesForSend;
    tasks.push({
      label: "Call Reference Notes",
      columnId: COL.callReferenceNotes,
      fn: () => writeLongText(p.id, COL.callReferenceNotes, notesVal),
    });
  }

  // ----- Execute writes with read-back verification -----
  // Monday automations trigger on Stage Advancer changes and copy the
  // item to other boards. All data columns must be fully indexed before
  // that trigger fires — otherwise the copy gets stale values.
  const failures = await executeWritesWithVerification({
    itemId: p.id,
    tasks,
    stageColumnId: COL.stageAdvancer,
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
    onProgress: opts?.onProgress,
  });

  if (failures.length > 0) {
    const succeeded = tasks.length - failures.length;
    throw new Error(
      `${failures.length} column(s) failed after retries (${succeeded} succeeded). Check "Josh Debug" column. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}

/**
 * Per-product partial save — "Save No Auth Needed" (Auth Outstanding
 * redesign handoff §4).
 *
 * Writes ONE product's auth-result column to "No Auth Needed" and clears
 * that product's Auth ID / Start / End / Units, with NO Stage Advancer or
 * Escalation write. Monday automations key on the Stage Advancer column and
 * this path never touches it, so the patient stays in Auth Outstanding —
 * the daily-check rep can persist a payer's "no auth needed" answer the
 * moment she hears it and finish the rest (SoS recheck, other products,
 * page-level complete) on a later pass.
 *
 * Still runs the full verified-write protocol (snapshot → write → read-back)
 * so a silently-failed write surfaces as an error instead of looking saved.
 */
/**
 * Manager-only correction of a patient's insurance identity — Serving, Primary
 * / Secondary Insurance, Member ID 1 / 2. Gated in the UI to the oversight
 * escalation columns (`?mv=manager-intervention` / `final-decisions`); see
 * `lib/samantha/managerIdentityEdit` for the why and the product-set caveat.
 *
 * Three deliberate choices:
 *
 * 1. **Only changed fields are written.** Every task in the batch is a real
 *    change, which makes read-back verification meaningful — an unchanged
 *    column here means the write did NOT land.
 * 2. **`expectedText` comes from the board's own label**, passed in by the
 *    caller from `fetchStatusOptions`. Verifying against a hardcoded label
 *    would fail on the board's actual spelling ("Magnacare"), and the
 *    snapshot-diff fallback is too weak for this flow: it treats three stable
 *    reads as "same-value write, fine", which is exactly what a silently failed
 *    write looks like here.
 * 3. **`stageColumnId: []`** — nothing to advance. Every Insurance automation
 *    that mentions these columns triggers on Stage Advancer and merely reads
 *    them, so this write fires no automation (verified against the live board
 *    2026-07-30). The verification still runs; it just has no advancer to gate.
 *
 * The attribution note is appended to the CURRENT Monday value of the notes
 * column, re-read here rather than taken from the caller's patient object: the
 * local overlay can hold an unsaved note draft, and a correction must not
 * commit someone else's half-typed line (or clobber a note saved since the
 * page last polled).
 *
 * Returns the changes it wrote; an empty draft-diff is a no-op, not an error.
 */
export async function saveManagerIdentityEdits(
  p: Patient,
  draft: IdentityDraft,
  /** Live board options per column id, from `fetchStatusOptions`. */
  statusOptions: Record<string, { index: number; label: string }[]>,
  /** Stage label for the note stamp ("Benefits" / "Submit Auth" / …). */
  stage: string,
  opts?: { onProgress?: (phase: WriteProgressPhase) => void },
): Promise<IdentityChange[]> {
  const changes = diffIdentity(p, draft);
  if (changes.length === 0) return [];

  const tasks: WriteTask[] = [];

  for (const change of changes) {
    const statusCol = IDENTITY_STATUS_COLUMNS[change.field as IdentityStatusFieldId];
    if (statusCol) {
      const option = (statusOptions[statusCol] ?? []).find((o) => o.label === change.to);
      if (!option) {
        // The picker is built from these same options, so this is unreachable
        // in the UI — but a stale cache after someone renames a board label
        // would otherwise write a wrong index silently. Fail loudly instead.
        throw new Error(`"${change.to}" is no longer a ${change.label} option on the board — reload and try again.`);
      }
      tasks.push({
        label: change.label,
        columnId: statusCol,
        expectedText: option.label,
        fn: () => writeStatusIndex(p.id, statusCol, option.index),
      });
      continue;
    }
    const textCol = IDENTITY_TEXT_COLUMNS[change.field as keyof typeof IDENTITY_TEXT_COLUMNS];
    if (textCol) {
      tasks.push({
        label: change.label,
        columnId: textCol,
        expectedText: change.to,
        fn: () => writeText(p.id, textCol, change.to),
      });
    }
  }

  const current = await readColumnTexts(p.id, [COL.callReferenceNotes]);
  const existingNotes = current.find((c) => c.id === COL.callReferenceNotes)?.text ?? "";
  const notes = appendStampedNote(existingNotes, identityNoteText(changes), stage, {
    initials: userInitials(),
  });
  tasks.push({
    label: "Reference Notes",
    columnId: COL.callReferenceNotes,
    expectedText: notes,
    fn: () => writeLongText(p.id, COL.callReferenceNotes, notes),
  });

  const failures = await executeWritesWithVerification({
    itemId: p.id,
    tasks,
    stageColumnId: [],
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
    onProgress: opts?.onProgress,
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
  return changes;
}

export async function saveNoAuthNeededToMonday(
  p: Patient,
  codeId: ProductCodeId,
  opts?: { onProgress?: (phase: WriteProgressPhase) => void },
): Promise<void> {
  const productId = PRODUCT_CODE_TO_PRODUCT_ID[codeId];
  const authColumnId = COL.authResult[productId];

  const tasks: WriteTask[] = [
    {
      label: `Auth result: ${productId}`,
      columnId: authColumnId,
      expectedText: "No Auth Needed",
      fn: () => writeStatusIndex(p.id, authColumnId, AUTH_RESULT_INDEX.noAuthNeeded),
    },
    // No auth exists, so the per-product auth detail columns are wiped —
    // same treatment the full send applies for a no-auth-needed result.
    {
      label: `Auth ID (clear): ${productId}`,
      columnId: COL.authId[productId],
      fn: () => writeText(p.id, COL.authId[productId], ""),
    },
    {
      label: `Auth Start (clear): ${productId}`,
      columnId: COL.authStart[productId],
      fn: () => writeDate(p.id, COL.authStart[productId], ""),
    },
    {
      label: `Auth End (clear): ${productId}`,
      columnId: COL.authEnd[productId],
      fn: () => writeDate(p.id, COL.authEnd[productId], ""),
    },
    {
      label: `Auth Units (clear): ${productId}`,
      columnId: COL.authUnits[productId],
      fn: () => writeNumber(p.id, COL.authUnits[productId], ""),
    },
  ];

  // Empty stage list = every task is a verified data write and Phase 3
  // (advance) writes nothing. Deliberate — see the function comment.
  const failures = await executeWritesWithVerification({
    itemId: p.id,
    tasks,
    stageColumnId: [],
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
    onProgress: opts?.onProgress,
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Check "Josh Debug" column. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}

