/**
 * oopEstimate.ts — Profile Send-Off out-of-pocket estimator.
 *
 * Computes the two board values the Profile page writes:
 *   • First-Order OOP   → `text_mm4tvsk6`  (pump + first fill of consumables, deductible applied)
 *   • Recurring (90-day) → `text_mm4ttaa6` (consumables only, no pump, deductible assumed met)
 *
 * ⚠️ This is deliberately DIFFERENT from `src/lib/welcomeCall/oopEstimator.ts`,
 * per the Profile redesign / OOP handoff:
 *   1. The CGM **Monitor (E2103) is EXCLUDED** here (welcome-call includes it).
 *   2. **United Medicare = 0% coinsurance** override applies here (welcome-call removed it).
 * Both estimators mirror the Python `financial_estimate_service.py`; keep the
 * rate schedule shared (imported below) but these two rules are Profile-only.
 * Ported from the redesign prototype's `estimateOop`.
 */

import { PAYER_RATE_SCHEDULE } from "@/lib/welcomeCall/oopEstimator";

const MEDICARE_STYLE = new Set([
  "Anthem BCBS Medicare", "Fidelis Medicare", "Medicare A&B", "NYSHIP",
  "United Medicare", "Wellcare", "Humana", "Cigna", "Midlands Choice",
]);
const SUPPLIES_TO_MEDICAID = new Set(["Fidelis Medicaid", "Anthem BCBS Medicaid (JLJ)", "Medicaid"]);
const PRIMARY_MEDICAID = new Set([
  "Fidelis Medicaid", "Anthem BCBS Medicaid (JLJ)", "Anthem BCBS Low-Cost (JLJ)",
  "Wellcare", "Medicaid", "United Medicaid",
]);
// $0-OOP payers — keep in sync with ZERO_OOP_PAYERS in welcomeCall/oopEstimator.ts
const ZERO_PAYERS = new Set(["Medicare A&B", "NYSHIP"]);
/** United Medicare = 0% coinsurance — patient pays the deductible only. */
const COINS_OVERRIDES: Record<string, number> = { "United Medicare": 0 };
const HUMANA_CGM = new Set(["CGM Monitor", "CGM Sensors"]);
const ALIASES: Record<string, string> = { "Magnacare": "MagnaCare", "BCBS Wyoming": "BCBS WY" };

function round2(n: number): number { return Math.round(n * 100) / 100; }
function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const c = String(raw).replace(/[$,%\s]/g, "").replace(/,/g, "");
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}
function resolveCoins(primary: string, raw: string): number {
  const o = COINS_OVERRIDES[primary];
  if (o !== undefined) return o;
  const v = parseNumber(raw);
  if (v === null) return 0;
  return v < 1 ? v * 100 : v;
}
function products(serving: string): { hasCgm: boolean; hasPump: boolean; hasSupplies: boolean } {
  const x = (serving || "").toLowerCase();
  return { hasCgm: x.includes("cgm"), hasPump: x.includes("pump"), hasSupplies: x.includes("suppli") || x.includes("pump") };
}
function canon(l: string): string { const t = (l || "").trim(); return ALIASES[t] ?? t; }

interface OopLine { product: string; units: number; rate: number; allowed: number; }
export interface OopRaw {
  ok: boolean;
  reason?: string;
  lines?: OopLine[];
  totalAllowed?: number;
  patientOwes?: number | null;
  oopMaxRemaining?: number | null;
  medicaidCovers?: boolean;
  medicaidNote?: string;
  canCalculateCosts?: boolean;
  missingFields?: string[];
  coinsurancePct?: number;
}

export interface OopEstimateInputs {
  serving: string;
  primaryInsurance: string;
  secondaryInsurance: string;
  infusionSets?: number;
  deductibleRemaining: string;
  stediCoinsurance: string;
  oopMaxRemaining: string;
  /** true for the recurring 90-day estimate (no pump, deductible treated as met). */
  recurring?: boolean;
}

/** Core estimate — faithful port of the prototype `estimateOop`. */
export function estimateOop(inp: OopEstimateInputs): OopRaw {
  const serving = inp.serving;
  const infusionSets = inp.infusionSets || 3;
  const primary = canon(inp.primaryInsurance);
  if (!primary) return { ok: false, reason: "Missing primary insurance" };
  const rates = PAYER_RATE_SCHEDULE[primary];
  if (!rates) return { ok: false, reason: `No rate schedule for "${primary}"` };
  const pr = products(serving);
  if (!pr.hasCgm && !pr.hasPump && !pr.hasSupplies) return { ok: false, reason: `Cannot determine products from serving: "${serving}"` };

  const lines: OopLine[] = [];
  if (pr.hasCgm) {
    // Monitor (CGM receiver / E2103) intentionally EXCLUDED from the Profile estimate.
    if (rates.sensor_rate !== null) lines.push({ product: "CGM Sensors", units: 3, rate: rates.sensor_rate, allowed: round2(3 * rates.sensor_rate) });
  }
  if (pr.hasPump && !inp.recurring && rates.pump_rate !== null) lines.push({ product: "Insulin Pump", units: 1, rate: rates.pump_rate, allowed: round2(rates.pump_rate) });
  if (pr.hasSupplies) {
    const sp = SUPPLIES_TO_MEDICAID.has(primary) ? "Medicaid" : primary;
    const sr = PAYER_RATE_SCHEDULE[sp];
    if (sr) {
      const med = MEDICARE_STYLE.has(sp);
      const iu = med ? 13 : infusionSets * 10;
      const cu = med ? 30 : infusionSets * 10;
      if (sr.infusion_rate !== null) lines.push({ product: "Infusion Sets", units: iu, rate: sr.infusion_rate, allowed: round2(iu * sr.infusion_rate) });
      if (sr.cartridge_rate !== null) lines.push({ product: "Cartridges", units: cu, rate: sr.cartridge_rate, allowed: round2(cu * sr.cartridge_rate) });
    }
  }
  if (lines.length === 0) return { ok: false, reason: `No rates available for "${primary}" with serving "${serving}"` };

  const totalAllowed = round2(lines.reduce((a, l) => a + l.allowed, 0));
  const isPrimMcaid = PRIMARY_MEDICAID.has(primary);
  // Any secondary other than "None" (NY Medicaid or Medicare Supplement) covers
  // the patient's remaining balance → $0 OOP, same as a Medicaid secondary.
  const secLabel = (inp.secondaryInsurance || "").trim().toLowerCase();
  const secCovers = secLabel !== "" && secLabel !== "none";
  if (isPrimMcaid || secCovers) {
    return { ok: true, lines, totalAllowed, patientOwes: 0, oopMaxRemaining: null, medicaidCovers: true, medicaidNote: isPrimMcaid ? `${primary} is a Medicaid plan — no patient cost share` : `Secondary ${inp.secondaryInsurance} covers remaining balance`, canCalculateCosts: true, missingFields: [] };
  }
  if (ZERO_PAYERS.has(primary)) {
    return { ok: true, lines, totalAllowed, patientOwes: 0, oopMaxRemaining: null, medicaidCovers: true, medicaidNote: `${primary} — no patient cost share`, canCalculateCosts: true, missingFields: [] };
  }

  const hasOverride = COINS_OVERRIDES[primary] !== undefined;
  const pd = parseNumber(inp.deductibleRemaining);
  const pc = parseNumber(inp.stediCoinsurance);
  const om = parseNumber(inp.oopMaxRemaining);
  const humanaCgmOnly = primary === "Humana" && lines.every((l) => HUMANA_CGM.has(l.product));
  const missing: string[] = [];
  if (pd === null) missing.push("deductible");
  if (pc === null && !hasOverride && !humanaCgmOnly) missing.push("coinsurance");
  if (om === null) missing.push("oopMax");
  const hasDed = pd !== null;
  const hasCoins = pc !== null || hasOverride || humanaCgmOnly;
  const oopMaxRemaining = om !== null ? om : null;
  if (!(hasDed && hasCoins)) {
    return { ok: true, lines, totalAllowed, patientOwes: null, oopMaxRemaining, medicaidCovers: false, medicaidNote: "", canCalculateCosts: false, missingFields: missing };
  }
  const ded = pd!;
  const coins = resolveCoins(primary, inp.stediCoinsurance);
  const appliedDed = round2(Math.min(totalAllowed, Math.max(0, ded)));
  const postDed = round2(totalAllowed - appliedDed);
  let patientCoins: number;
  if (primary === "Humana") {
    const cgmAllowed = lines.filter((l) => HUMANA_CGM.has(l.product)).reduce((a, l) => a + l.allowed, 0);
    const nonCgm = totalAllowed - cgmAllowed;
    const cgmProp = totalAllowed > 0 ? cgmAllowed / totalAllowed : 0;
    const cgmDed = round2(appliedDed * cgmProp);
    const nonCgmDed = round2(appliedDed - cgmDed);
    const nonCgmPost = round2(nonCgm - nonCgmDed);
    patientCoins = round2(round2(nonCgmPost * (coins / 100)));
  } else {
    patientCoins = round2(postDed * (coins / 100));
  }
  const owesRaw = round2(appliedDed + patientCoins);
  const patientOwes = oopMaxRemaining !== null ? round2(Math.min(owesRaw, Math.max(0, oopMaxRemaining))) : owesRaw;
  return { ok: true, lines, totalAllowed, patientOwes, oopMaxRemaining, coinsurancePct: coins, medicaidCovers: false, medicaidNote: "", canCalculateCosts: true, missingFields: missing };
}

/** Format an estimate result as the board display string. */
export function formatOop(r: OopRaw): { val: string; note: string } {
  if (!r.ok) return { val: "N/A", note: "no rate on file yet · " + (r.reason ?? "") };
  if (r.medicaidCovers) return { val: "$0", note: r.medicaidNote ?? "" };
  if (r.patientOwes == null) return { val: "Need benefits", note: (r.missingFields ?? []).join(" + ") + " missing from Stedi" };
  return { val: "$" + r.patientOwes.toLocaleString("en-US", { maximumFractionDigits: 2 }), note: "" };
}

export interface OopBaseInputs {
  serving: string;
  primaryInsurance: string;
  secondaryInsurance: string;
  infusionSets?: number;
  stediCoinsurance: string;
  deductibleRemaining: string;
  oopMaxRemaining: string;
}

export interface FirstAndRecurring {
  first: { val: string; note: string };
  recurring: { val: string; note: string };
  hasPump: boolean;
}

/** Compute both board values from one benefits snapshot. */
export function computeFirstAndRecurring(base: OopBaseInputs): FirstAndRecurring {
  const first = estimateOop({ ...base, recurring: false });
  const recur = estimateOop({ ...base, deductibleRemaining: "0", recurring: true });
  const hasPump = (first.lines ?? []).some((l) => l.product === "Insulin Pump");
  return { first: formatOop(first), recurring: formatOop(recur), hasPump };
}
