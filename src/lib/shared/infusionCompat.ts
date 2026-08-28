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
 * (25 labels on `color_mm1x9paw`).
 *
 * ⚠️ **An unclassified set is reported as UNVERIFIED, never as silence.** This
 * module originally returned null for an unknown family, reasoning that a set
 * nobody had classified must not throw false errors at reps. That was the wrong
 * trade: it left the check silently blind on 2 of the 24 real sets, and a rep
 * picking one got a clean screen that looks exactly like a verified pass —
 * reported from the floor on t:slim + Luer, which is a genuine mismatch. Silence
 * reading as approval is the same failure class as a green UI that has not
 * actually written (CLAUDE.md §10). Unknown now says so, in amber, and only a
 * pairing we have positively checked stays quiet.
 */

export type SetFamily = "tandem" | "ilet" | "medtronic" | "unknown";

/** Which family a set label belongs to. Source: board labels on color_mm1x9paw. */
export function infusionSetFamily(label: string): SetFamily {
  const l = (label ?? "").toLowerCase();
  if (/autosoft|trusteel|varisoft/.test(l)) return "tandem";
  if (/contact|inset/.test(l)) return "ilet";
  // MiniMed QuickSet — Medtronic's own set.
  if (/mio|quick\s*-?\s*set/.test(l)) return "medtronic";
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

/**
 * Luer-connector sets. Luer is a CONNECTOR standard, not a manufacturer, so it
 * gets its own rule rather than a family: Tandem pumps (t:slim, Mobi) use a
 * proprietary t:lock connector, so a Luer set physically cannot attach to them
 * (reported from the floor, 2026-08-28).
 * ⚠️ Deliberately NOT classified into a family. Which non-Tandem pumps a Luer
 * set fits has not been established here, so those pairings fall through to
 * "unverified" rather than being asserted either way.
 */
export const LUER_RX = /\bluer\b/i;

/** Pumps that use Tandem's t:lock connector. */
const TLOCK_PUMPS = new Set(["t:slim", "Mobi"]);

export type InfusionIssueKind = "incompatible" | "five-inch-not-mobi" | "unverified";

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

  // Connector rule, checked before family: a Luer set has no family here on
  // purpose, so this would otherwise fall through to "unverified" for the one
  // pairing we DO know is wrong.
  if (LUER_RX.test(set) && TLOCK_PUMPS.has(pump)) {
    return {
      kind: "incompatible",
      title: `${set} ✗ ${pump}`,
      detail: `${set} uses a Luer connector; the ${pump} uses t:lock, so the set cannot attach. Pick a ${pump}-compatible set.`,
    };
  }

  const fam = infusionSetFamily(set);
  if (fam === "unknown") {
    return {
      kind: "unverified",
      title: `${set} — compatibility not verified`,
      detail: `We have no compatibility record for ${set} with a ${pump}. Check it against the pump before sending; this is not a confirmed match.`,
    };
  }
  if (fam !== pumpFamily) {
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
