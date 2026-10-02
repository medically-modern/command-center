/**
 * The one health rule (BUILD-SPEC §3.14.1). Code/stage health uses active queue work only;
 * parked items (STUCK/MGR/FINAL) have holder tiles with their own thresholds.
 */
import type { Dict } from "../types";
import type { Status } from "../types";
import type { Cfg } from "./context";

export interface Threshold { y: number; r: number; confirmed: boolean }
export const thresholdFor = (cfg: Cfg, k: string): Threshold | null => ((cfg.thresholds as Dict)[k] ?? (k.startsWith("UNMAPPED") ? (cfg.thresholds as Dict).UNMAPPED : null));

const ORDER: Status[] = ["breaking", "risk", "healthy", "finding", "nodata", "notconnected", "nottracked"];
export function worst(list: Status[]): Status {
  for (const s of ORDER) if (list.includes(s)) return s;
  return "nodata";
}

/** Queue code health: completed p50 (bd) + open ages (bd, not snoozed). */
export function codeHealth(cfg: Cfg, t: Threshold | null, p50Bd: number | null, n: number, openAgesBd: number[]): Status {
  if (!t) return "nodata";
  if (n < cfg.health.minSample && openAgesBd.length === 0) return "nodata";
  const share = (lim: number) => (openAgesBd.length ? openAgesBd.filter((a) => a >= lim).length / openAgesBd.length : 0);
  if ((p50Bd != null && n >= cfg.health.minSample && p50Bd > t.r) || share(t.r) >= cfg.health.redShare || openAgesBd.some((a) => a > 2 * t.r)) return "breaking";
  if ((p50Bd != null && n >= cfg.health.minSample && p50Bd > t.y) || share(t.y) >= cfg.health.yellowShare) return "risk";
  return "healthy";
}

/** Holder tile rule with the unknown-age guard (§3.14.1). ages = non-synthetic hold ages (bd), unknown = open synthetic count. */
export function holderHealth(cfg: Cfg, t: Threshold, agesBd: number[], unknown: number): { status: Status; reason?: string } {
  const total = agesBd.length + unknown;
  if (total === 0) return { status: "healthy" };
  const share = (lim: number) => (agesBd.length ? agesBd.filter((a) => a >= lim).length / agesBd.length : 0);
  // Brandon CR B: any escalated item over r (2 bd) is "in limbo" = red; any over y (1 bd) = yellow.
  void share;
  let status: Status = "healthy";
  if (agesBd.some((a) => a > t.r)) status = "breaking";
  else if (agesBd.some((a) => a > t.y)) status = "risk";
  // Escalation buckets: ANY unknown age caps at At risk (maxUnknownShareEscalation = 0); never hides a known Red.
  if (status !== "breaking" && unknown / total > cfg.health.maxUnknownShareEscalation) return { status: "risk", reason: `age unknown for ${unknown} of ${total}` };
  return { status };
}
