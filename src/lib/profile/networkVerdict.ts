/**
 * The benefits check's In Network VERDICT, and what each screen says about it
 * (Brandon, 2026-09-24; built on Josh's answers the same day). §5.20b.
 *
 * `Stedi In Network?` (`text_mm1xehx8`) is written by stedi-monday-integration.
 * Until 2026-09-24 it carried the 271's first network indicator — which only
 * labels a benefit tier, and for Original Medicare came back the literal
 * `Unknown`. From that deploy (commit 02f5d81) it carries OUR CONTRACT verdict,
 * one of exactly four strings, after every SUCCESSFUL check:
 *
 *   `Yes` · `No` · `Check with patient: lives in NY, NJ, FL or TN?` · `Check manually`
 *
 * Rows checked before that deploy keep whatever they had (usually `Yes` or
 * `Unknown`) until somebody re-runs the check, so the old reading still
 * applies to them: an UNRECOGNISED value is never a No (§5.20).
 *
 * ⚠️ The two "Check…" strings are matched by PREFIX, not exactly. The backend
 * owns the wording after the colon (Brandon's list of states may grow — Josh
 * has already said Wyoming counts), and an exact match would silently demote a
 * reworded verdict to "other" and drop its pop-up.
 *
 * Pure, and imported by BOTH slices that print it — the intake pages and the
 * Care Coordinator cards — so the two cannot disagree about what a value means.
 */

import { ANTHEM_HOST_PLAN, resolveState } from "./primaryInsurance";

export type NetworkVerdict =
  | "yes"
  | "no"
  /** Anthem BCBS Commercial and the patient's state isn't one we cover. */
  | "checkWithPatient"
  /** No network rule covers the payer — somebody has to look it up. */
  | "checkManually"
  /** Anything else — the pre-2026-09-24 `Unknown` above all. Shown verbatim. */
  | "other"
  | "none";

const NETWORK_YES = new Set(["yes", "in network", "in-network", "true"]);
const NETWORK_NO = new Set([
  "no", "out of network", "out-of-network", "not in network", "oon", "false",
]);

export function networkVerdictOf(raw: string | null | undefined): NetworkVerdict {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "none";
  if (NETWORK_YES.has(v)) return "yes";
  if (NETWORK_NO.has(v)) return "no";
  if (v.startsWith("check with patient")) return "checkWithPatient";
  if (v.startsWith("check manually")) return "checkManually";
  return "other";
}

export type NetworkTone = "good" | "bad" | "warn" | "neutral";

/**
 * Yes green, No red, the two "check" answers amber (Brandon's spec). Anything
 * else stays neutral — a colour on a value we do not recognise would be a
 * claim about it.
 */
export function networkToneOf(v: NetworkVerdict): NetworkTone {
  switch (v) {
    case "yes": return "good";
    case "no": return "bad";
    case "checkWithPatient":
    case "checkManually": return "warn";
    default: return "neutral";
  }
}

/**
 * What the boxed readout prints. The two "check" verdicts get a SHORT label —
 * the full sentence is what the pop-up and the note underneath are for, and a
 * boxed field holding a whole question reads as a data problem. Anything
 * unrecognised prints VERBATIM (§5.20, Josh 2026-08-25): the board's own
 * `Unknown` included.
 */
export function networkShortLabel(raw: string | null | undefined): string {
  switch (networkVerdictOf(raw)) {
    case "yes": return "Yes";
    case "no": return "No";
    case "checkWithPatient": return "Check with patient";
    case "checkManually": return "Check manually";
    case "none": return "—";
    default: return (raw ?? "").trim();
  }
}

/** The tooltip on the "Check manually" readout — the one state Brandon gave
 *  no pop-up and no note, so the box itself has to say what it means. */
export const CHECK_MANUALLY_HINT =
  "No network rule covers this payer yet — look the plan up before moving forward.";

/* ── Anthem BCBS Commercial: where does the patient actually live? ─────── */

/**
 * The states an Anthem Commercial member can be in network in: NY through
 * Anthem itself, the rest through that state's own Blue plan
 * (`ANTHEM_HOST_PLAN`). Brandon's verdict string names NY, NJ, FL and TN;
 * Josh added Wyoming on 2026-09-24 ("Yes"), which the backend already counts
 * as in network and the suggestion engine already routes to BCBS WY.
 * `networkVerdict.test.ts` holds this list to `ANTHEM_HOST_PLAN`.
 */
export const ANTHEM_NETWORK_STATES: readonly string[] = ["NY", "NJ", "FL", "TN", "WY"];
export const ANTHEM_STATES_TEXT = "NY, NJ, FL, TN or WY";

/** The host plans in the order `ANTHEM_STATES_TEXT` names their states. */
const HOST_PLANS_TEXT = ["NJ", "FL", "TN", "WY"].map((s) => ANTHEM_HOST_PLAN[s]).join(", ")
  .replace(/, ([^,]*)$/, " or $1");

/**
 * The amber panel's heading under the benefits check (Brandon, 2026-09-25:
 * *"Let's just add the 4 states to this warning at bottom of benefit check"*
 * — the canonical list is five since Josh added Wyoming, and this reads it
 * from the one constant so the heading can never drift from the backend's
 * verdict). The guidance summary below it carries the other half of his
 * wording — "Insurance has them in <state> — confirm where they live before
 * moving forward."
 */
export const ANTHEM_PANEL_HEADLINE =
  `In network only if they live in ${ANTHEM_STATES_TEXT}`;

export interface AnthemGuidance {
  /** Where the INSURANCE's address puts them ("" when no state can be read). */
  insuranceState: string;
  /** Where this profile's own address puts them ("" when unreadable). */
  profileState: string;
  /** That state's own Blue plan, when the insurance has them in NJ/FL/TN/WY. */
  switchTo: string | null;
  /** One line for the persistent amber note under the boxes. */
  summary: string;
  /** What to do, in order — the pop-up. */
  steps: string[];
}

/**
 * What a rep does about a "Check with patient" verdict, worked out from the
 * address the insurance has on file (Josh, 2026-09-24: *"if it's anthem
 * commercial, and the address the insurance has on file isn't one of those
 * states, the rep needs to confirm with the patient if they've moved / actually
 * live in one of those states and the address the insurance has on file is
 * stale"*; Brandon: *"if it's NJ, FL, or TN then we should change primary
 * insurance to that state"*).
 *
 * ⚠️ It never CHANGES anything — it says what to change. Primary Insurance is
 * the rep's to set, and the verdict only moves when the check is re-run, which
 * is what every branch ends with.
 *
 * ⚠️ The backend decides the state from THIS profile's address first and the
 * insurance's second, so "the insurance has them in NY" can still arrive as a
 * "Check with patient": the profile's own address is somewhere else. That is
 * its own branch rather than advice to switch plans.
 */
export function anthemNetworkGuidance(input: {
  stediAddress?: string | null;
  patientAddress?: string | null;
  formState?: string | null;
}): AnthemGuidance {
  const insuranceState = resolveState(input.stediAddress ?? "");
  const profileState = resolveState(input.patientAddress ?? "") || resolveState(input.formState ?? "");
  const switchTo = insuranceState ? ANTHEM_HOST_PLAN[insuranceState] ?? null : null;

  if (switchTo) {
    return {
      insuranceState, profileState, switchTo,
      summary: `Insurance has them in ${insuranceState} — confirm they live there, then change Primary Insurance to ${switchTo} and re-run the benefits check.`,
      steps: [
        `The insurance has them in ${insuranceState}.`,
        `If they live in ${insuranceState}: change Primary Insurance to ${switchTo} and re-run the benefits check.`,
        "If they live in NY: update the address on this profile and re-run the check.",
      ],
    };
  }

  if (insuranceState === "NY") {
    const here = profileState ? `says ${profileState}` : "has no state we can read";
    return {
      insuranceState, profileState, switchTo: null,
      summary: `Insurance has them in NY, but this profile's address ${here} — confirm where they live, fix the address and re-run the benefits check.`,
      steps: [
        `The insurance has them in NY, but the address on this profile ${here}.`,
        "Confirm where they live, correct the address, then re-run the benefits check.",
      ],
    };
  }

  const where = insuranceState
    ? `The insurance has them in ${insuranceState}.`
    : "The insurance's address doesn't show a state we can read.";
  return {
    insuranceState, profileState, switchTo: null,
    summary: insuranceState
      ? `Insurance has them in ${insuranceState} — confirm where they live before moving forward.`
      : "Confirm where they live before moving forward.",
    steps: [
      where,
      "Ask whether they've moved and the insurance's address is out of date.",
      "If they live in NY: update the address on this profile and re-run the benefits check.",
      `If they live in NJ, FL, TN or WY: change Primary Insurance to that state's plan (${HOST_PLANS_TEXT}) and re-run.`,
      insuranceState
        ? `If they really do live in ${insuranceState}, we're not in network for them.`
        : "If they live anywhere else, we're not in network for them.",
    ],
  };
}

/* ── The Care Coordinator card's pill ──────────────────────────────────── */

/**
 * What the card's network pill says for "Check with patient" (see
 * `careCoordinator/networkPill.ts`). Josh, 2026-09-24: *"should say 'only
 * in-network if patient lives in NY, NJ, FL or TN?'"* — plus Wyoming, the
 * same day.
 */
export const NETWORK_CARD_CHECK_TEXT = `Only in-network if patient lives in ${ANTHEM_STATES_TEXT}?`;
