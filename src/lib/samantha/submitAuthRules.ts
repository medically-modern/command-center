/**
 * submitAuthRules.ts — domain rules for the redesigned Submit Auth tab
 * (HANDOFF-Josh-Submit-Auth.md + submit-auth-redesign.html, July 2026).
 *
 * Covers: which products get a submission card, submit validation, the
 * per-card modifier chips, the MLTC fax banner, and the BCBS home-plan
 * banner. UI-free — everything here is exercised by submitAuthRules.test.ts.
 */

import {
  isAutoFilledMedicaidSupply,
  resolveHcpcs,
  type ProductId,
  type ResolvedProduct,
} from "./hcpcRules";
import type { Patient, ProductCodeId } from "./workflow";
import { EMPTY_INSURANCE } from "./workflow";

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

// ─────────────────────────────────────────────────────────────────────
// Card selection (handoff §1/§6)
// ─────────────────────────────────────────────────────────────────────

/**
 * Products that get a submission card: board auth status is exactly
 * "Required" (the verbatim Monday label, NOT the hydrated `auth` field —
 * that maps Submitted/Auth Valid/Denied to "required" too) and the product
 * is not DVS-routed. DVS-routed products stay at Required on the board and
 * are handled at the DVS stage.
 *
 * (The handoff's straight-Medicaid rule — primary "Medicaid" routes the
 * PUMP to DVS too — is deliberately not implemented: straight-Medicaid
 * patients never reach this stage; they get their own stage later.)
 */
export function submitAuthCards(patient: Patient): ResolvedProduct[] {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  return resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  ).filter((r) => {
    if (isAutoFilledMedicaidSupply(r)) return false;
    const label = ins.codes[PRODUCT_TO_CODE_ID[r.product]]?._mondayAuthLabel ?? "";
    return label.trim().toLowerCase() === "required";
  });
}

/** Products handled at the DVS stage (no submission card, blue note). */
export function dvsRoutedProducts(patient: Patient): ResolvedProduct[] {
  return resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  ).filter(isAutoFilledMedicaidSupply);
}

// ─────────────────────────────────────────────────────────────────────
// Submit validation (handoff §7 — client + server gating)
// ─────────────────────────────────────────────────────────────────────

/**
 * Every submission card needs Method + Submission Date, plus a number when
 * the method is Call or Fax. Auth ID is optional (payer may not have
 * issued one yet). Zero cards → nothing to validate → send is allowed
 * (the patient advances; DVS-routed work happens at the next stage).
 */
export function validateSubmitAuthForSubmit(patient: Patient): string[] {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const missing: string[] = [];
  for (const r of submitAuthCards(patient)) {
    const s = ins.codes[PRODUCT_TO_CODE_ID[r.product]];
    const method = s?.authSubmissionMethod ?? "";
    if (!method) missing.push(`${r.hcpc} · Submission Method`);
    if ((method === "Call" || method === "Fax") && !(s?.callFaxNumber ?? "").trim()) {
      missing.push(`${r.hcpc} · ${method} Number`);
    }
    if (!s?.authSubmissionDate) missing.push(`${r.hcpc} · Submission Date`);
  }
  return missing;
}

// ─────────────────────────────────────────────────────────────────────
// Modifiers (handoff §4) — HAND-SYNCED COPY of claims-ui-tool tables
// ─────────────────────────────────────────────────────────────────────
//
// Source of truth is the claims-ui-tool repo (the repo that submits
// claims): PRODUCT_DEFAULTS in PrimarySubmitBoard.tsx and
// EXPECTED_LINE_MODIFIERS_BY_PAYER in bcbsSubmitGuard.ts +
// ANTHEM_SUBMISSION_RULES.md. No shared package — same hand-sync
// arrangement as medicareJurisdiction.ts ↔ claims-ui-tool. Update both.
//
// NOTE (deliberate simplification, per Josh 2026-07-20): the route is
// keyed off the BILLING PAYER name. The claims board's real switch is
// patient address state (NJ → CareCentrix 11348, NY/other → Anthem 803);
// if/when that matters here, key modifierRoute off the address state the
// way medicareJurisdiction.ts does. Referral source NEVER sets the route.

/** Defaults for every payer without a route override. */
const DEFAULT_MODIFIERS: Record<string, string[]> = {
  A4230: ["KX", "NU"],
  A4231: ["KX", "NU"],
  A4224: ["KX", "NU"],
  A4232: ["KX", "NU"],
  A4225: ["KX", "NU"],
  A4239: ["KX"],
  E0784: ["KX", "NU"],
  E2103: ["KX", "NU"],
};

type ModifierRoute = "anthem-803" | "carecentrix" | "bcbs-tn";

/** Route-specific overrides. HCPCs absent from a route fall through to defaults. */
const ROUTE_MODIFIERS: Record<ModifierRoute, { label: string } & Record<string, string[] | string>> = {
  // Anthem NY / Empire 803 — NY residents + all out-of-state BlueCard.
  // E0784/E2103 not yet codified for 803 → fall through to defaults.
  "anthem-803": {
    label: "Anthem NY 803",
    A4230: ["KX"],
    A4231: ["KX"],
    A4224: ["KX"],
    A4232: ["KX"],
    A4225: ["KX"],
    A4239: ["KF", "KX", "CG"],
  },
  // Horizon NJ via CareCentrix 11348 — NJ residents.
  carecentrix: {
    label: "CareCentrix 11348",
    A4230: ["NU", "SC"],
    A4231: ["NU", "SC"],
    A4224: ["NU", "SC"],
    A4232: ["NU", "SC"],
    A4225: ["NU", "SC"],
    A4239: ["NU"],
    E0784: ["NU"],
    E2103: ["NU"],
  },
  // BCBS Tennessee — direct, in-network 2026: NU on every line.
  "bcbs-tn": {
    label: "BCBS TN direct",
    A4230: ["NU"],
    A4231: ["NU"],
    A4224: ["NU"],
    A4232: ["NU"],
    A4225: ["NU"],
    A4239: ["NU"],
    E0784: ["NU"],
    E2103: ["NU"],
  },
};

export function modifierRoute(primaryInsurance: string): ModifierRoute | null {
  const p = primaryInsurance ?? "";
  if (p === "Horizon BCBS") return "carecentrix";
  if (p === "BCBS TN") return "bcbs-tn";
  if (/Anthem BCBS|BCBS FL|BCBS WY/.test(p)) return "anthem-803";
  return null;
}

export interface ModifierInfo {
  mods: string[];
  /** Route label ("Anthem NY 803" / "CareCentrix 11348" / "BCBS TN direct") or "default". */
  source: string;
}

/** Modifiers for a card headline, or null for unknown HCPCs (e.g. "Evaluate"). */
export function modifiersFor(hcpc: string, primaryInsurance: string): ModifierInfo | null {
  const route = modifierRoute(primaryInsurance);
  const routeTable = route ? ROUTE_MODIFIERS[route] : null;
  const fromRoute = routeTable ? (routeTable[hcpc] as string[] | undefined) : undefined;
  const mods = fromRoute ?? DEFAULT_MODIFIERS[hcpc];
  if (!mods) return null;
  return { mods, source: fromRoute ? (routeTable!.label as string) : "default" };
}

// ─────────────────────────────────────────────────────────────────────
// MLTC (handoff §5 — definitive, from the Plan Name column)
// ─────────────────────────────────────────────────────────────────────

/**
 * MLTC detection: the Stedi-written Plan Name contains "MLTC",
 * case-insensitive. That's the whole rule — verified against real Anthem
 * MLTC 271s ("NEW YORK MLTC" lands in the Plan Name column via
 * benefitsInformation[0].planCoverage). Do NOT key off Managed Medicaid
 * (blank on MLTC 271s) or the old JLJ + Medicaid-ID heuristic (real MLTC
 * 271s return no CIN). Tip only: never force or preselect Fax.
 */
export function isMltcPlan(planName: string | null | undefined): boolean {
  return /MLTC/i.test(planName ?? "");
}

// ─────────────────────────────────────────────────────────────────────
// BCBS home plan (handoff §8)
// ─────────────────────────────────────────────────────────────────────

export function isBcbsFamily(payer: string | null | undefined): boolean {
  return /BCBS|Anthem|Horizon/i.test(payer ?? "");
}

export interface HomePlanInfo {
  /** The member's home plan (from the 271, Stedi Home Plan column) — handles auths. */
  home: string;
  /** The host plan we bill (the board's Primary Insurance). */
  host: string;
}

/**
 * When a BCBS-family member's HOME plan differs from the host plan we
 * bill, auths go through the home plan. Compare on the first word
 * ("Horizon BCBSNJ" vs "Horizon BCBS" → same family → no banner).
 * Phone numbers are deliberately absent — no payer-phone source yet.
 */
export function authHomePlan(patient: Patient): HomePlanInfo | null {
  const home = (patient.homePlan ?? "").trim();
  const host = (patient.primaryInsurance ?? "").trim();
  if (!home || !host || !isBcbsFamily(host)) return null;
  const first = (s: string) => (s.split(/\s+/)[0] ?? "").toLowerCase();
  if (first(home) === first(host)) return null;
  return { home, host };
}
