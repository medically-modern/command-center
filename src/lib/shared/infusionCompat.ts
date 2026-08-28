/**
 * lib/shared/infusionCompat.ts — does this infusion set physically fit this pump?
 *
 * ONE matrix, shared by the two stages that can still act on the answer:
 *  - **Welcome Call** — inline, while the rep is choosing the set with the
 *    patient on the phone.
 *  - **Final Confirm** — as check pack items C24_SET_INCOMPATIBLE and
 *    C24_FIVE_INCH_NOT_MOBI.
 *
 * It lived only in `finalConfirm/checkPack.ts` until now, which meant a rep
 * picked an unusable set at Welcome Call and found out a whole stage later —
 * after the order had already moved boards. Extracted rather than copied
 * because a duplicated matrix is the drift this codebase keeps getting bitten
 * by: two copies WILL diverge, and the failure is an order that ships sets the
 * patient cannot attach to their pump.
 *
 * ⚠️ Families are matched on the set LABEL, against the live board vocabulary
 * (25 labels on `color_mm1x9paw`). An unrecognised label returns "unknown" and
 * is deliberately NOT flagged — a new set added to the board must not start
 * throwing false incompatibility errors at reps before anyone has classified
 * it. Silence on unknown, never a guess.
 */

export type SetFamily = "tandem" | "ilet" | "medtronic" | "unknown";

/** Which family a set label belongs to. Source: board labels on color_mm1x9paw. */
export function infusionSetFamily(label: string): SetFamily {
  const l = (label ?? "").toLowerCase();
  if (/autosoft|trusteel|varisoft/.test(l)) return "tandem";
  if (/contact|inset/.test(l)) return "ilet";
  if (/mio/.test(l)) return "medtronic";
  return "unknown";
}

/** Which family a pump takes. Source: board labels on color_mm1wjjtk. */
export const PUMP_SET_FAMILY: Record<string, SetFamily> = {
  "t:slim": "tandem",
  "Mobi": "tandem",
  "iLet": "ilet",
  "Minimed 780G": "medtronic",
};

/** 5" tubing detector — 5" sets are Mobi-ONLY (Brandon, 2026-07-31). */
export const FIVE_INCH_RX = /5\s*(?:"|”|in\b)/i;

export type InfusionIssueKind = "incompatible" | "five-inch-not-mobi";

export interface InfusionIssue {
  kind: InfusionIssueKind;
  /** Short headline, e.g. `TruSteel 6 mm 23" ✗ iLet`. */
  title: string;
  /** Full sentence naming the consequence and the fix. */
  detail: string;
}

/**
 * Check one pump/set pairing. Returns null when the pairing is fine, when
 * either side is blank, or when the set's family isn't recognised.
 *
 * `setLabel` is the board label as selected. Callers skip "Not Serving" slots
 * before calling — an empty slot is not a compatibility problem.
 */
export function infusionSetIssue(pumpType: string, setLabel: string): InfusionIssue | null {
  const pump = (pumpType ?? "").trim();
  const set = (setLabel ?? "").trim();
  if (!pump || !set) return null;

  const pumpFamily = PUMP_SET_FAMILY[pump];
  if (!pumpFamily) return null;

  const fam = infusionSetFamily(set);
  if (fam !== "unknown" && fam !== pumpFamily) {
    return {
      kind: "incompatible",
      title: `${set} ✗ ${pump}`,
      detail: `${set} is not compatible with a ${pump} — the order would ship unusable sets. Pick a ${pump}-compatible set.`,
    };
  }
  if (fam === "tandem" && FIVE_INCH_RX.test(set) && pump !== "Mobi") {
    return {
      kind: "five-inch-not-mobi",
      title: `5" tubing is Mobi-only`,
      detail: `${set} — 5" tubing sets are for the Mobi only; they can't be used with a ${pump}. Pick a standard-length set.`,
    };
  }
  return null;
}
