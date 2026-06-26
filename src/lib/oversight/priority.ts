// Oversight priority scoring — turns each patient into a 0–12 "priority score"
// so high-value patients (e.g. a CareCentrix CGM stuck in Medical Evaluation)
// float to the top. Score = referral points + insurance points + days pressure.
// The tiers are fully editable in the UI and persisted to localStorage.

import type { OversightPatient, DayBucketLabel } from "./oversightApi";
import { DAY_BUCKET_LABELS, scoringFields } from "./oversightApi";

/** A scoring tier: any patient whose text contains one of `match` gets `points`.
 *  Tiers are evaluated in order — first match wins. */
export interface PriorityTier {
  points: number;
  /** Case-insensitive substrings to match against the field text. */
  match: string[];
}

export interface PriorityConfig {
  /** Bumped whenever the shipped defaults change so stale saved configs are
   *  discarded instead of masking the new defaults. */
  version: number;
  referralTiers: PriorityTier[];
  referralDefault: number;
  insuranceTiers: PriorityTier[];
  insuranceDefault: number;
  daysPoints: Record<DayBucketLabel, number>;
  /** Patients at or above this score are flagged as VIPs. */
  threshold: number;
}

/** Bump this when the defaults below change. */
const CONFIG_VERSION = 5;

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  version: CONFIG_VERSION,
  // Scored on Referral TYPE — exact status labels from Monday.
  referralTiers: [
    { points: 4, match: ["Doctor", "Payor"] },
    { points: 3, match: ["Manufacturer", "Advocacy Group"] },
    { points: 1, match: ["Patient"] },
  ],
  referralDefault: 1,
  // Exact Primary Insurance status labels from Monday.
  insuranceTiers: [
    { points: 4, match: ["Anthem BCBS Commercial", "Horizon BCBS", "Medicare A&B", "NYSHIP"] },
    { points: 3, match: ["Medicaid", "Aetna Commercial", "Humana", "Fidelis Medicaid", "Anthem BCBS Medicaid (JLJ)"] },
  ],
  insuranceDefault: 1,
  // Days-in-stage no longer feeds the priority score (it's a "what's going on
  // here" flag, not an importance signal). Defaults to 0; editable later.
  daysPoints: {
    "0–2 Days": 0,
    "3–5 Days": 0,
    "6–8 Days": 0,
    "9–12 Days": 0,
    "13-15 Days": 0,
    "16-20 Days": 0,
    "21-29 Days": 0,
    "30+ Days": 0,
  },
  threshold: 8,
};

/** Exact status-label match (case-insensitive). Each label belongs to one tier,
 *  so tier order doesn't affect the result. Anything unassigned → fallback. */
function tierPoints(value: string, tiers: PriorityTier[], fallback: number): number {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  for (const tier of tiers) {
    if (tier.match.some((m) => m.trim().toLowerCase() === v)) return tier.points;
  }
  return fallback;
}

export interface PriorityScore {
  score: number;
  referralPts: number;
  insurancePts: number;
  daysPts: number;
  /** True when referral OR insurance scored above its default — i.e. there's a
   *  real "this matters" signal, not just days-in-stage pressure. */
  hasSignal: boolean;
}

export function scorePatient(p: OversightPatient, config: PriorityConfig): PriorityScore {
  const { referral, insurance, bucket } = scoringFields(p);
  const referralPts = tierPoints(referral, config.referralTiers, config.referralDefault);
  const insurancePts = tierPoints(insurance, config.insuranceTiers, config.insuranceDefault);
  const daysPts = bucket === "Unknown" ? 0 : config.daysPoints[bucket] ?? 0;
  const hasSignal =
    referralPts > config.referralDefault || insurancePts > config.insuranceDefault;
  return { score: referralPts + insurancePts + daysPts, referralPts, insurancePts, daysPts, hasSignal };
}

/** Boards excluded from VIP flagging — DtC is top-of-funnel leads, not pipeline
 *  patients, and has no insurance data, so it shouldn't compete for priority. */
const VIP_EXCLUDED_BOARDS = new Set<number>([18392794310]);

/** A patient is a VIP only if they're on a scored board, have a real
 *  referral/insurance signal, AND clear the threshold (days pressure alone
 *  can never make a VIP). */
export function isVip(p: OversightPatient, config: PriorityConfig): boolean {
  if (VIP_EXCLUDED_BOARDS.has(p.boardId)) return false;
  const s = scorePatient(p, config);
  return s.hasSignal && s.score >= config.threshold;
}

// ── Persistence ─────────────────────────────────────────────────────────
const LS_KEY = "oversight-priority-config";

export function loadPriorityConfig(): PriorityConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PriorityConfig>;
      // Discard configs saved before the current defaults version so updated
      // defaults aren't masked by a stale localStorage copy.
      if (parsed.version === DEFAULT_PRIORITY_CONFIG.version) {
        return {
          ...DEFAULT_PRIORITY_CONFIG,
          ...parsed,
          daysPoints: { ...DEFAULT_PRIORITY_CONFIG.daysPoints, ...(parsed.daysPoints ?? {}) },
        };
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PRIORITY_CONFIG;
}

export function savePriorityConfig(config: PriorityConfig): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

/** Convenience: the 8 day buckets in order (re-exported for the editor). */
export const DAY_BUCKETS_ORDERED = DAY_BUCKET_LABELS;
