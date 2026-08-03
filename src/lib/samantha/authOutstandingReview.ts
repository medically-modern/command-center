/**
 * authOutstandingReview.ts — domain rules for the redesigned Auth
 * Outstanding tab (JOSH_HANDOFF_AUTH_OUTSTANDING.md +
 * auth-outstanding-redesign.html, July 2026).
 *
 * Covers: which products get a result card ("tracked"), the derived SoS
 * recheck (facts → Clear/Not-Clear, never rep-picked), per-card and
 * page-level validation for Auth Review Complete, the next-order preview,
 * and the daily-bucket snooze rule. UI-free — exercised by
 * authOutstandingReview.test.ts.
 */

import {
  isAutoFilledMedicaidSupply,
  resolveHcpcs,
  type ProductId,
  type ResolvedProduct,
} from "./hcpcRules";
import type { Patient, ProductCodeId, ProductCodeState } from "./workflow";
import { EMPTY_INSURANCE, sensorsNextOrderOffsetDays } from "./workflow";
import {
  addDaysYmd,
  etTodayYmd,
  isValidUnits,
  patientHasMedicaidIns,
  sosCutoffYmd,
} from "./benefitsDerive";

const PRODUCT_TO_CODE_ID: Record<ProductId, ProductCodeId> = {
  monitor: "cgm-monitor",
  sensors: "cgm-sensors",
  insulin_pump: "pump",
  infusion_set: "infusion-sets",
  cartridge: "cartridges",
};

export function productCodeId(product: ProductId): ProductCodeId {
  return PRODUCT_TO_CODE_ID[product];
}

export type AuthOutstandingResult = "" | "auth-valid" | "denied" | "no-auth-needed";

/**
 * The card's effective result. Local state wins; otherwise a board label of
 * "No Auth Needed" counts — a partial-saved product (Save No Auth Needed)
 * hydrates with that label but no local result, and its card must come back
 * showing No Auth Needed with the recheck still open (handoff §4).
 */
export function effectiveResult(state: ProductCodeState | undefined): AuthOutstandingResult {
  if (state?.authOutstandingResult) return state.authOutstandingResult;
  if ((state?._mondayAuthLabel ?? "").trim().toLowerCase() === "no auth needed") {
    return "no-auth-needed";
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────
// Card selection (handoff §1/§4/§7)
// ─────────────────────────────────────────────────────────────────────

/**
 * Products that get a result card ("tracked"):
 *   - board auth status exactly "Submitted" (the daily-check work), OR
 *   - "No Auth Needed" while the product is still SoS-deferred (in the
 *     Skip SoS Products dropdown, hydrated as sos === "skip") — that's a
 *     partial-saved No Auth Needed whose Same-or-Similar recheck hasn't
 *     been sent yet. The card stays open across reloads until the
 *     page-level send resolves the recheck and rewrites the dropdown.
 * DVS-routed products never get a card (handled at the DVS stage, §7).
 *
 * Legacy caveat: patients that predate the Benefits redesign have no Skip
 * SoS dropdown entry, so their partial-saved NAN products resolve on
 * reload (pre-redesign behavior) instead of holding a recheck open.
 */
export function trackedCards(patient: Patient): ResolvedProduct[] {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  return resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  ).filter((r) => {
    if (isAutoFilledMedicaidSupply(r)) return false;
    const state = ins.codes[PRODUCT_TO_CODE_ID[r.product]];
    const label = (state?._mondayAuthLabel ?? "").trim().toLowerCase();
    if (label === "submitted") return true;
    return label === "no auth needed" && state?.sos === "skip";
  });
}

/** Products handled at the DVS stage (no card, no writes from this page). */
export function dvsRoutedProducts(patient: Patient): ResolvedProduct[] {
  return resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  ).filter(isAutoFilledMedicaidSupply);
}

// ─────────────────────────────────────────────────────────────────────
// Derived SoS recheck (handoff §3) — facts in, Clear/Not-Clear out
// ─────────────────────────────────────────────────────────────────────

/**
 * Is the recheck entry complete? Unlike benefitsDerive.sosEntryComplete,
 * auth = "required" does NOT auto-complete here — on this page the product
 * hydrates as auth "required" (Submitted label) while the recheck is
 * exactly the thing being filled in.
 */
export function recheckComplete(state: ProductCodeState | undefined): boolean {
  if (state?.sosEntry === "never") return true;
  if (state?.sosEntry === "billed") return !!state.lastBillDate && isValidUnits(state.units);
  return false;
}

/**
 * Derive the recheck's SoS from recorded facts (never shown to the rep):
 *   No Billing History      → "clear"
 *   Billed, date < cutoff   → "clear"   (strict <, same as benefitsDerive)
 *   Billed, date ≥ cutoff   → "not-clear"
 *   incomplete              → ""
 * Lookbacks: pump/monitor 5 yr (Medicare A&B primary) / 4 yr otherwise;
 * sensors/IS/cartridges 90 days (60 with Medicaid) — sosCutoffYmd.
 */
export function derivedRecheckSos(
  state: ProductCodeState | undefined,
  codeId: ProductCodeId,
  hasMedicaid: boolean,
  todayYmd: string = etTodayYmd(),
  isMedicare = false,
): "" | "clear" | "not-clear" {
  if (state?.sosEntry === "never") return "clear";
  if (state?.sosEntry === "billed" && state.lastBillDate) {
    return state.lastBillDate < sosCutoffYmd(codeId, hasMedicaid, todayYmd, isMedicare)
      ? "clear"
      : "not-clear";
  }
  return "";
}

/** Next Order Date preview for the recheck hint — existing math off the
 *  entered Last Bill Date. Monitor has no next-order date. */
export function nextOrderPreviewYmd(
  codeId: ProductCodeId,
  lastBillYmd: string,
  hasMedicaid: boolean,
  units?: string,
  isMedicare = false,
): string {
  if (!lastBillYmd) return "";
  if (codeId === "pump") return addDaysYmd(lastBillYmd, isMedicare ? 365 * 5 : 365 * 4);
  if (codeId === "cgm-sensors") return addDaysYmd(lastBillYmd, sensorsNextOrderOffsetDays(units));
  if (codeId === "infusion-sets" || codeId === "cartridges") {
    return addDaysYmd(lastBillYmd, hasMedicaid ? 60 : 90);
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────
// Auth Review Complete gating (handoff §6 — client side)
// ─────────────────────────────────────────────────────────────────────

/**
 * Missing-item labels blocking Auth Review Complete. Empty array = ready.
 *   - every tracked card needs a result
 *   - Auth Valid needs ID + Start + End + Units
 *   - No Auth Needed needs a complete recheck
 *   - Denied needs nothing more (denial upload is optional, §5)
 * A product still at board label "Required" was never submitted — surfaced
 * as its own line so data drift doesn't silently un-gate the page.
 * DVS-routed products never gate (§7).
 */
export function validateAuthReviewForComplete(patient: Patient): string[] {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const missing: string[] = [];

  const resolved = resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  ).filter((r) => !isAutoFilledMedicaidSupply(r));

  for (const r of resolved) {
    const label = (ins.codes[PRODUCT_TO_CODE_ID[r.product]]?._mondayAuthLabel ?? "").trim().toLowerCase();
    if (label === "required") missing.push(`${r.hcpc} · Not submitted yet (Submit Auth)`);
  }

  for (const r of trackedCards(patient)) {
    const state = ins.codes[PRODUCT_TO_CODE_ID[r.product]];
    const result = effectiveResult(state);
    if (!result) {
      missing.push(`${r.hcpc} · Auth Result`);
      continue;
    }
    if (result === "auth-valid") {
      if (!state?.authId) missing.push(`${r.hcpc} · Auth ID`);
      if (!state?.authStart) missing.push(`${r.hcpc} · Auth Start`);
      if (!state?.authEnd) missing.push(`${r.hcpc} · Auth End`);
      if (!isValidUnits(state?.authUnits)) missing.push(`${r.hcpc} · Units`);
    }
    if (result === "no-auth-needed" && !recheckComplete(state)) {
      missing.push(`${r.hcpc} · SoS recheck (Last Bill Date + Units, or No Billing History)`);
    }
  }
  return missing;
}

// ─────────────────────────────────────────────────────────────────────
// Daily bucket (handoff §12) — date-only snooze for this stage
// ─────────────────────────────────────────────────────────────────────

/**
 * Auth Outstanding bucket rule: a patient is snoozed ONLY while their
 * Follow Up Date is in the future — the Follow Up STATUS column is
 * ignored on this stage. A blank date counts as DUE (legacy items without
 * a stamp must never fall out of the bucket); Submit Auth stamps the date
 * same-day on submission, and "Auth Still Outstanding" pushes it +1 day.
 * Counting contract (CLAUDE.md §5.8): useRoleCounts.samActive,
 * scripts/snapshot-baseline.mjs and services/baseline-cron countSamGroup
 * apply the SAME rule for this group — change all of them together.
 */
export function isSnoozedAuthOutstanding(p: Patient, todayYmd: string): boolean {
  return !!p.followUpDate && p.followUpDate > todayYmd;
}

// ─────────────────────────────────────────────────────────────────────
// Send outcome — which stage the page writes, and whether it escalates
// ─────────────────────────────────────────────────────────────────────

/** Stage the Auth Outstanding send writes, or null to LEAVE IT ALONE. */
export type AuthOutstandingStage = "authDenied" | "complete" | "dvs" | null;

export interface AuthOutstandingFacts {
  /** Any non-DVS product came back Denied. */
  anyDenied: boolean;
  /** The insulin pump's effective SoS resolved to Not Clear. */
  pumpSosNotClear: boolean;
  /** Every non-DVS product has a usable result. */
  allResolved: boolean;
  /** The patient has products, and every one of them is DVS-routed. */
  allDvsRouted: boolean;
  /** The patient has at least one DVS-routed product. */
  hasDvsRouted: boolean;
}

/**
 * The Auth Outstanding send's stage + escalation decision, in priority order.
 * Extracted from `sendPatientToMonday` so the ORDER is testable — it is the
 * whole rule, and getting it wrong silently advances a blocked patient.
 *
 *   1. Denial          → Auth Denied + manager. Most specific destination, and
 *                        it has its own queue, so it outranks the pump blocker.
 *   2. Pump SoS Not Clear → NO stage write + manager. A pump we may not be able
 *                        to bill is a blocker, exactly as at Benefits, where the
 *                        identical finding makes deriveInsuranceOutcome return
 *                        "blocker" and hold the patient at Benefits / SoS.
 *                        Ordered above `allResolved` deliberately: a completed
 *                        not-clear recheck otherwise counts as RESOLVED, and the
 *                        send would advance the patient to Complete — firing the
 *                        Welcome Call create-item automation — while merely
 *                        flagging a manager. (PR #22 review, 2026-08-02.)
 *   3. All resolved    → Complete, or DVS when supplies still owe a DVS run.
 *   4. All DVS-routed  → DVS; the patient never belonged on the auth rail.
 *   5. Otherwise       → partial save: no stage write.
 */
export function authOutstandingOutcome(
  f: AuthOutstandingFacts,
): { stage: AuthOutstandingStage; escalate: boolean } {
  if (f.anyDenied) return { stage: "authDenied", escalate: true };
  if (f.pumpSosNotClear) return { stage: null, escalate: true };
  if (f.allResolved) return { stage: f.hasDvsRouted ? "dvs" : "complete", escalate: false };
  if (f.allDvsRouted) return { stage: "dvs", escalate: false };
  return { stage: null, escalate: false };
}

/** Convenience for the panel: does the patient have Medicaid (either insurance)? */
export function reviewHasMedicaid(patient: Patient): boolean {
  return patientHasMedicaidIns(patient.primaryInsurance ?? "", patient.secondaryInsurance ?? "");
}
