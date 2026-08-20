/**
 * Final Profile Confirmation — Check Pack (Phase 1)
 *
 * WARNINGS ONLY. Nothing in this file ever blocks Send — the rep always has
 * full manual override. runFinalChecks() is a pure function of the Patient
 * row: no fetches, no writes, trivially unit-testable.
 *
 * Design rules (see FINAL-CONFIRM-CHECK-PACK-SPEC.md in the project folder):
 *  - Silence over false alarms: every check fires only on positive evidence;
 *    missing inputs mean the check is skipped, never fired.
 *  - Split-aware: after Split Order, "Not Serving" values and Order
 *    Handling = Separate are intentional — product-coherence checks stand
 *    down rather than false-fire.
 *  - Check IDs (C1…C24) match the spec doc. Tier-2/Tier-3 checks (Stedi
 *    mirrors) are not in this file yet — see the spec for what unlocks them.
 *
 * State parsing + the POS rule live in lib/shared/pos.ts (single shared
 * implementation — used here and by the Welcome Call submit write). The
 * serving/subscription helpers are duplicated from lib/welcomeCall/workflow.ts
 * with their source noted (per-role convention).
 */

import type { Patient } from "./workflow";
import {
  resolveState,
  expectedPos,
  BCBS_FAMILY,
  IN_FOOTPRINT_STATES,
} from "@/lib/shared/pos";
import {
  checkCardinalAddress,
  cardinalAddressHardReason,
  CARDINAL_FORMAT_HINT,
} from "@/lib/shared/cardinalAddress";

/* ─── Findings model ─── */

export type CheckSeverity = "red" | "amber" | "info";
// red   = we believe this profile is wrong (would misbill / can't serve / lapsed)
// amber = likely inconsistency — verify before sending
// info  = FYI / corroboration note; never shown in the send-confirm dialog

export interface CheckFinding {
  id: string; // stable check ID, e.g. "C11_CGM_ONLY_MEDICAID"
  severity: CheckSeverity;
  /** Anchor field for optional inline pill placement. */
  field?: keyof Patient;
  /** Short label for pills / dialog rows. */
  title: string;
  /** One-sentence explanation carrying the evidence. */
  detail: string;
  /**
   * A "here is the shape it has to be" line, rendered in red directly under
   * the anchored field (and shown in the panel + send dialog). Present only on
   * checks whose fix is "retype it like this" — today, the two address-format
   * checks. Anything carrying this is rendered inline by PatientInfoCard, so
   * don't add it to a check whose field has no input on the page.
   */
  formatHint?: string;
}

/* ─── Shared helpers (duplicated per codebase convention — sources noted) ─── */

/** Source: lib/welcomeCall/workflow.ts */
function servingIncludesCgm(serving: string): boolean {
  return serving.toLowerCase().includes("cgm");
}

/** Source: lib/welcomeCall/workflow.ts */
function servingIncludesPump(serving: string): boolean {
  const s = serving.toLowerCase();
  return s.includes("pump") || s.includes("supplies");
}

/**
 * Which of the referral's products the profile is NO LONGER serving (C13).
 *
 * Request Type and Serving share one five-label vocabulary — Insulin Pump ·
 * Supplies Only · CGM · Insulin Pump + CGM · Supplies + CGM — so comparing the
 * LABELS makes every change look equal. They aren't: what matters is which
 * product FAMILIES survive the trip.
 *
 *  - Added a family  → cross-sell. Silent: "Insulin Pump" → "Insulin Pump +
 *    CGM" is the intended output of the CGM cross-sell step, not a mistake.
 *  - Dropped a family → the patient asked for something they now won't get.
 *    That is the whole concern, and the only thing that fires.
 *
 * ⚠️ Pump and supplies are ONE family here, per Brandon's rule ("requested
 * insulin pump/supplies and we weren't serving them anymore"), so a demotion
 * from "Insulin Pump" to "Supplies Only" is deliberately silent — they are
 * still served, just without new pump hardware. Splitting those two apart is a
 * one-line change to PRODUCTS below if that turns out to want flagging.
 */
const PRODUCTS: Array<{ label: string; inLabel: (v: string) => boolean }> = [
  { label: "CGM", inLabel: servingIncludesCgm },
  { label: "pump/supplies", inLabel: servingIncludesPump },
];

export function droppedProducts(requestType: string, serving: string): string[] {
  // Positive evidence only: with either side blank there is nothing to compare
  // and the check stands down rather than guessing (check-pack design rule).
  if (!requestType.trim() || !serving.trim()) return [];
  return PRODUCTS.filter((x) => x.inLabel(requestType) && !x.inLabel(serving)).map((x) => x.label);
}

const listAnd = (xs: string[]): string =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const CGM_NOT_SERVING_INDEX = 9;
const INFUSION_NOT_SERVING_INDEX = 101;

/**
 * Is this product slot still being served? Label FIRST, index as the backstop.
 *
 * Both halves are load-bearing, and C15 inherited this from the hard send gate
 * it replaced (`validatePatientForSend`, PR #21 — removed 2026-08-03):
 *  - **Label with no index** is the live-overlay case: switching Subscription
 *    Type to Sensors leaves the previous pump-side set sitting in patient
 *    state, label populated, index not yet resolved from the board. An
 *    index-only test waves that straight through — which is the bug the gate
 *    existed to stop, so C15 has to catch it now that the gate is gone.
 *  - **Index with a blank label** is the board-renumbering case: the stored
 *    index points at a label that no longer exists, reads back empty, and the
 *    writer would persist that dead index onto the record anyway.
 * A blank label with a null index is genuinely unset, and "Not Serving" is an
 * explicit no — neither counts.
 */
function slotServing(label: string, index: number | null, notServingIndex: number): boolean {
  const l = (label ?? "").trim();
  if (l === "Not Serving") return false;
  if (l !== "") return true;
  return index !== null && index !== notServingIndex;
}

/** Source: lib/welcomeCall/workflow.ts (expectedSubscriptionType) */
function expectedSubscriptionType(p: Patient): string | null {
  const cgm = slotServing(p.cgmType, p.cgmTypeIndex, CGM_NOT_SERVING_INDEX);
  const infusion =
    slotServing(p.infusionSet1, p.infusionSet1Index, INFUSION_NOT_SERVING_INDEX) ||
    slotServing(p.infusionSet2, p.infusionSet2Index, INFUSION_NOT_SERVING_INDEX);
  if (cgm && infusion) return "Sensors & Supplies";
  if (cgm) return "Sensors";
  if (infusion) return "Supplies";
  return null;
}

/* ─── Label sets & patterns ─── */

const JLJ_LABELS = new Set(["Anthem BCBS Medicaid (JLJ)", "Anthem BCBS Low-Cost (JLJ)"]);

/** Host Blue per address state (Book 1 / POS rule). */
const HOST_BY_STATE: Record<string, string> = {
  NJ: "Horizon BCBS", TN: "BCBS TN", FL: "BCBS FL", WY: "BCBS WY",
};
const STATE_BY_HOST: Record<string, string> = {
  "Horizon BCBS": "NJ", "BCBS TN": "TN", "BCBS FL": "FL", "BCBS WY": "WY",
};
/** Primary labels that mean the *primary* coverage is a Medicaid flavor. */
function isMedicaidPrimary(label: string): boolean {
  return label === "Medicaid" || /medicaid/i.test(label);
}

/** Medicare Advantage / dual evidence in a plan name (degraded C6 — full check needs the Stedi MA mirror). */
const MA_PLAN_RX = /advantage|mapd|d-?snp|dual (align|liberty|complete|access)|gold plus/i;

const MLTC_RX = /mltc|care at home/i;

/** NY Medicaid CIN shape: 2 letters, 5 digits, 1 letter (e.g. AB12345C). */
const NY_CIN_RX = /^[A-Z]{2}\d{5}[A-Z]$/;

/* ─── C24: pump ↔ infusion-set compatibility ───
 *
 * Families are classified from the SET LABEL (not index — Infusion Set 1 and 2
 * columns have different index orderings on the board).
 *
 * Matrix (confirmed by Brandon 2026-07-31: 5" tubing is Mobi-ONLY):
 *  - t:slim / Mobi (Tandem t:lock): AutoSoft XC / 30 / 90, TruSteel, VariSoft
 *  - 5" tubing sets: Mobi ONLY — any other pump + a 5" set fires red
 *  - iLet (Beta Bionics):           Contact, Inset
 *  - Minimed 780G (Medtronic):      Mio Advance
 *
 * The 5" rule is ONE-WAY (Brandon, 2026-08-10). "5" is Mobi-only" does NOT
 * mean "Mobi is 5"-only": a Mobi on standard-length tubing is a perfectly
 * normal order. An info-level `C24_MOBI_TUBING` nudge used to fire on exactly
 * that and was removed — it flagged the common case, which is how a check pack
 * teaches reps to click past its reds.
 */
type SetFamily = "tandem" | "ilet" | "medtronic" | "unknown";

function infusionSetFamily(label: string): SetFamily {
  const l = label.toLowerCase();
  if (/autosoft|trusteel|varisoft/.test(l)) return "tandem";
  if (/contact|inset/.test(l)) return "ilet";
  if (/mio/.test(l)) return "medtronic";
  return "unknown";
}

const PUMP_SET_FAMILY: Record<string, SetFamily> = {
  "t:slim": "tandem",
  "Mobi": "tandem",
  "iLet": "ilet",
  "Minimed 780G": "medtronic",
};

/** 5" tubing detector — 5" sets are Mobi-ONLY (Brandon, 2026-07-31). */
const FIVE_INCH_RX = /5\s*(?:"|”|in\b)/i;

/* ─── Small utils ─── */

function blank(v: string | null | undefined): boolean {
  return !v || !v.trim();
}

function parseYmd(raw: string): Date | null {
  const m = (raw || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function daysFromToday(d: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/**
 * C25 / C26 — will the Cardinal order pipeline accept this address?
 *
 * The rule is not ours: `lib/shared/cardinalAddress.ts` mirrors the ordering
 * service's own parser (`Cardinal-api/src/address.js`), which runs at submit
 * time on the orders board. A `hard` result there is GATE 1 — the order is
 * never sent to Cardinal and the row sits in "Needs Review" until a human
 * reformats the address. This stage is the last place the address is still
 * editable (and, for the patient address, the last place somebody is on the
 * phone), so the same verdict is worth a lot more here than it is there.
 *
 * Severity follows the pack's rule that red means positive evidence of a wrong
 * profile: a MALFORMED address is red (we know Cardinal rejects it), a BLANK
 * one is amber (a missing input, same as C22's blank DOB).
 *
 * Live rates when this was added (2026-08-18, over the real boards): 46 of
 * 1151 rows on the Cardinal orders board carry a doctor address that hard-
 * fails, against 6 patient addresses — the clinic address was the bigger
 * problem and was checked nowhere in the app.
 */
function cardinalAddressFindings(
  value: string,
  opts: { idPrefix: string; field: keyof Patient; label: string; blankTitle: string; blankDetail: string },
): CheckFinding[] {
  const { idPrefix, field, label, blankTitle, blankDetail } = opts;
  const out: CheckFinding[] = [];

  if (!(value || "").trim()) {
    out.push({ id: `${idPrefix}_MISSING`, severity: "amber", field, title: blankTitle, detail: blankDetail });
    return out;
  }

  const r = checkCardinalAddress(value);
  if (r.hard) {
    out.push({
      id: `${idPrefix}_FORMAT`,
      severity: "red",
      field,
      title: `${label} is not in Cardinal order format`,
      detail: `${cardinalAddressHardReason(r)} Cardinal blocks the order on this — it is never submitted, and the order row lands in Needs Review.`,
      formatHint: CARDINAL_FORMAT_HINT,
    });
    return out;
  }
  for (const w of r.issues.filter((i) => !i.hard)) {
    out.push({
      id: `${idPrefix}_${w.code}`,
      severity: "amber",
      field,
      title: w.code === "PO_BOX" ? `${label} contains a PO Box` : `${label} has an unrecognized line`,
      detail: `${w.message} The order still goes through.`,
    });
  }
  return out;
}

/* ─── The check engine ─── */

export function runFinalChecks(p: Patient): CheckFinding[] {
  const out: CheckFinding[] = [];
  const add = (f: CheckFinding) => out.push(f);

  // Effective (edited-over-original) values, matching the page's own logic.
  const address = (p.addressEdited ?? p.address) || "";
  const clinicAddress = (p.clinicAddressEdited ?? p.clinicAddress) || "";
  const secondary = (p.secondaryInsuranceEdited ?? p.secondaryInsurance) || "";
  const memberId2 = (p.memberId2Edited ?? p.memberId2) || "";
  const primary = p.primaryInsurance || "";
  const planName = p.planName || "";
  const mid1 = (p.memberId1 || "").trim();
  const state = resolveState(address);

  // Split-awareness: a Separate profile (or a just-split local one) has
  // intentional "Not Serving" values on the off-side — product-coherence
  // checks must not treat those as mistakes.
  const isSplitProfile = p.orderHandling === "Separate" || p._splitCreated === true;

  const cgmInServing = servingIncludesCgm(p.serving);
  const pumpishInServing = servingIncludesPump(p.serving); // pump OR supplies
  const pumpInServing = /pump/i.test(p.serving);
  const cgmServed = cgmInServing && p.cgmType !== "Not Serving";
  const pumpServed = pumpInServing && p.pumpType !== "Not Serving";

  /* ── A. Insurance ─────────────────────────────────────────────────── */

  // C1 (Tier-1 subset) — BCBS label vs address-state host rules (Book 1).
  if (primary && state) {
    const host = HOST_BY_STATE[state];
    if (host && BCBS_FAMILY.has(primary) && primary !== host) {
      add({
        id: "C1_HOST_STATE", severity: "amber", field: "primaryInsurance",
        title: `Expect ${host} for ${state}`,
        detail: `Patient address resolves to ${state} — Book 1 routes ${state} Blues to ${host}, but Primary is ${primary}. Address wins; verify.`,
      });
    } else if (STATE_BY_HOST[primary] && state !== STATE_BY_HOST[primary] && !host) {
      add({
        id: "C1_LABEL_STATE_MISMATCH", severity: "amber", field: "primaryInsurance",
        title: "Primary label vs address state",
        detail: `Primary is ${primary} (a ${STATE_BY_HOST[primary]} host plan) but the address resolves to ${state}. Address is the master input — verify before sending.`,
      });
    }
  }

  // C3 — Secondary = NY Medicaid requires Member ID 2 (Profile Send Off rule, re-asserted).
  if (secondary === "NY Medicaid" && blank(memberId2)) {
    add({
      id: "C3_MEDICAID_NO_MID2", severity: "red", field: "memberId2",
      title: "NY Medicaid secondary, no Member ID 2",
      detail: "Secondary is NY Medicaid but Member ID 2 is blank — supplies claims will route to Medicaid with no ID.",
    });
  }

  // C5 — Medicare A&B with no secondary (port of the Welcome Call warning).
  if (primary === "Medicare A&B" && (blank(secondary) || secondary === "None")) {
    add({
      id: "C5_MEDICARE_NO_SECONDARY", severity: "amber", field: "secondaryInsurance",
      title: "Medicare A&B, no secondary",
      detail: "Medicare pays 80% — with no supplement/Medicaid on file the patient owes 20%. Confirm no secondary exists (QMB members must NOT be billed).",
    });
  }

  // C6 (degraded) — plan name looks Medicare Advantage while Primary = Medicare A&B.
  if (primary === "Medicare A&B" && MA_PLAN_RX.test(planName)) {
    add({
      id: "C6_MA_AS_MEDICARE", severity: "red", field: "primaryInsurance",
      title: "Looks like Medicare Advantage",
      detail: `Plan Name "${planName}" reads as a Medicare Advantage/dual plan — billing straight Medicare A&B will deny. Bill the MA payer.`,
    });
  }

  // C8 (heuristic) — straight-Medicaid primary: Member ID 1 should be the CIN.
  if (primary === "Medicaid" && mid1 && !NY_CIN_RX.test(mid1.toUpperCase())) {
    add({
      id: "C8_MID1_NOT_CIN", severity: "info", field: "memberId1",
      title: "Member ID 1 may not be the Medicaid ID",
      detail: `"${mid1}" doesn't match the NY Medicaid CIN shape (AA12345A). For Medicaid-primary profiles the Medicaid ID belongs in Member ID 1; the managed plan's ID drops to Member ID 2.`,
    });
  }

  // C9 (plan-name mode) — MLTC routes to Anthem BCBS Low-Cost (JLJ), auth by fax through Anthem.
  if (MLTC_RX.test(planName) && primary !== "Anthem BCBS Low-Cost (JLJ)") {
    add({
      id: "C9_MLTC_ROUTING", severity: "amber", field: "primaryInsurance",
      title: "MLTC plan — expect Low-Cost (JLJ)",
      detail: `Plan Name "${planName}" looks like MLTC. Rule: MLTC → Anthem BCBS Low-Cost (JLJ), and supplies auth goes through Anthem by fax — NOT routed to Medicaid.`,
    });
  }

  // C10 — JLJ member-ID prefix corroboration (prefix corroborates, never drives).
  const midHasJlj = /JLJ/i.test(mid1);
  if (midHasJlj && primary && !JLJ_LABELS.has(primary)) {
    add({
      id: "C10_JLJ_PREFIX", severity: "info", field: "memberId1",
      title: "JLJ prefix, non-JLJ primary",
      detail: `Member ID 1 carries a JLJ prefix but Primary is ${primary} — the card and label don't corroborate; double-check.`,
    });
  } else if (JLJ_LABELS.has(primary) && mid1 && !midHasJlj) {
    add({
      id: "C10_JLJ_LABEL", severity: "info", field: "memberId1",
      title: "JLJ label, no JLJ prefix",
      detail: `Primary is ${primary} but Member ID 1 has no JLJ prefix — double-check the card.`,
    });
  }

  /* ── B. Serving & product ─────────────────────────────────────────── */

  // C11 — CGM under a Medicaid-flavor PRIMARY can't be served (2026-07-14 rule).
  // Deliberately keyed on the primary label only: dual patients with Medicare
  // primary get CGM through the primary — do not fire on secondary Medicaid.
  if (isMedicaidPrimary(primary)) {
    if (p.serving === "CGM") {
      add({
        id: "C11_CGM_ONLY_MEDICAID", severity: "red", field: "serving",
        title: "Can't Serve — CGM under Medicaid",
        detail: `Serving is CGM-only with ${primary} primary — Medicaid patients can't be served CGM. This profile should not advance as-is.`,
      });
    } else if (p.serving === "Supplies + CGM" && !isSplitProfile) {
      add({
        id: "C11_CGM_HALF_MEDICAID", severity: "amber", field: "serving",
        title: "CGM half not servable under Medicaid",
        detail: `${primary} primary — the CGM half of Supplies + CGM can't be served; expect supplies only.`,
      });
    }
  }

  // C12 — ALL Anthem (JLJ) members are blocked from CGM (2026-07-15 rule).
  if (JLJ_LABELS.has(primary) && cgmServed) {
    add({
      id: "C12_JLJ_NO_CGM", severity: "red", field: "cgmType",
      title: "Anthem (JLJ) — no CGM",
      detail: `Primary is ${primary} and the profile is serving CGM — CGM cannot be served or cross-sold on Anthem (JLJ) plans.`,
    });
  }

  // C13 — a product the referral asked for that we are no longer serving.
  //
  // ⚠️ This is NOT "serving ≠ requested" — that is what it used to be, and it
  // made the check noise (Brandon, 2026-08-20). ADDING a product is a
  // cross-sell, which is the normal, wanted outcome: a referral for Insulin
  // Pump that leaves as Insulin Pump + CGM is the whole point of the CGM
  // cross-sell step (`profile/workflow.deriveServing`), not something a rep
  // should have to confirm. Only a DROP is a concern — the patient asked for
  // something they are now not getting. Both product families count: CGM, and
  // pump/supplies.
  const dropped = droppedProducts(p.requestType, p.serving);
  if (dropped.length && !isSplitProfile) {
    add({
      id: "C13_SERVING_VS_REQUEST", severity: "info", field: "serving",
      title: "Requested product not served",
      detail: `Referral requested ${p.requestType}; profile is serving ${p.serving} — ${listAnd(dropped)} ${dropped.length > 1 ? "are" : "is"} no longer being served. Confirm the drop is intentional.`,
    });
  }

  // C14 — Serving vs product-field coherence (split-aware).
  if (!isSplitProfile) {
    if (cgmInServing && blank(p.cgmType)) {
      add({
        id: "C14_CGM_TYPE_MISSING", severity: "amber", field: "cgmType",
        title: "CGM Type missing",
        detail: "Serving includes CGM but no CGM Type is selected.",
      });
    }
    if (cgmInServing && p.cgmType === "Not Serving") {
      add({
        id: "C14_CGM_NOT_SERVING", severity: "amber", field: "cgmType",
        title: "CGM Type = Not Serving",
        detail: `Serving is ${p.serving} but CGM Type is Not Serving — these disagree.`,
      });
    }
    if (pumpInServing && blank(p.pumpType)) {
      add({
        id: "C14_PUMP_TYPE_MISSING", severity: "amber", field: "pumpType",
        title: "Pump Type missing",
        detail: "Serving includes a pump but no Pump Type is selected.",
      });
    }
    if (pumpInServing && p.pumpType === "Not Serving") {
      add({
        id: "C14_PUMP_NOT_SERVING", severity: "amber", field: "pumpType",
        title: "Pump Type = Not Serving",
        detail: `Serving is ${p.serving} but Pump Type is Not Serving — these disagree.`,
      });
    }
    const qty1 = Number(p.qtyInf1) || 0;
    const qty2 = Number(p.qtyInf2) || 0;
    if (p.serving === "CGM" && (Number(p.pumpQty) > 0 || qty1 > 0 || qty2 > 0)) {
      add({
        id: "C14_PUMP_QTY_ON_CGM", severity: "amber", field: "serving",
        title: "Pump-side quantities on CGM-only",
        detail: "Serving is CGM-only but pump/infusion quantities are > 0.",
      });
    }
    // Set-selected/qty mismatches (mirror of the Welcome Call validation, as warnings).
    const set1Selling = p.infusionSet1Index !== null && p.infusionSet1Index !== INFUSION_NOT_SERVING_INDEX;
    const set2Selling = p.infusionSet2Index !== null && p.infusionSet2Index !== INFUSION_NOT_SERVING_INDEX;
    if (set1Selling && qty1 === 0) {
      add({
        id: "C14_SET1_QTY_ZERO", severity: "amber", field: "qtyInf1",
        title: "Infusion Set 1 qty is 0",
        detail: `${p.infusionSet1} is selected but Qty Inf. 1 is 0.`,
      });
    }
    if (set2Selling && qty2 === 0) {
      add({
        id: "C14_SET2_QTY_ZERO", severity: "amber", field: "qtyInf2",
        title: "Infusion Set 2 qty is 0",
        detail: `${p.infusionSet2} is selected but Qty Inf. 2 is 0.`,
      });
    }
    if (!set1Selling && qty1 > 0) {
      add({
        id: "C14_QTY1_NO_SET", severity: "amber", field: "infusionSet1",
        title: "Qty without a set type",
        detail: "Qty Inf. 1 is > 0 but no Infusion Set 1 type is selected.",
      });
    }
  }

  // C15 — Subscription Type vs expected (same rule as the Welcome Call step).
  // RED, not amber (Josh, 2026-08-03): this rule used to be the page's only
  // HARD send gate (`validatePatientForSend`), which came out when Final
  // Confirm went advisory-only. Red keeps it top-of-panel and always in the
  // send dialog, so the stop became impossible to miss rather than impossible
  // to override.
  const expectedSub = expectedSubscriptionType(p);
  if (expectedSub && p.subscriptionType && expectedSub !== p.subscriptionType) {
    add({
      id: "C15_SUBSCRIPTION_MISMATCH", severity: "red", field: "subscriptionType",
      title: `Expected ${expectedSub}`,
      detail: `Based on the selected products, expected Subscription Type ${expectedSub} — ${p.subscriptionType} is selected.`,
    });
  }

  // C16 — Coverage-path coherence (split-aware).
  if (!isSplitProfile) {
    if (cgmServed && p.cgmCoveragePath === "Not Serving") {
      add({
        id: "C16_CGM_PATH", severity: "amber", field: "cgmCoveragePath",
        title: "CGM path = Not Serving",
        detail: "Profile serves CGM but CGM Coverage Path is Not Serving.",
      });
    }
    if (pumpServed && p.ipCoveragePath === "Not Serving") {
      add({
        id: "C16_IP_PATH", severity: "amber", field: "ipCoveragePath",
        title: "IP path = Not Serving",
        detail: "Profile serves a pump but Insulin Pump Coverage Path is Not Serving.",
      });
    }
  }

  // C24 — Pump ↔ infusion-set compatibility (NEW; matrix in header — confirm with ops).
  if (pumpServed && p.pumpType && PUMP_SET_FAMILY[p.pumpType]) {
    const pumpFamily = PUMP_SET_FAMILY[p.pumpType];
    const slots: Array<{ label: string; idx: number | null; field: keyof Patient; qty: number }> = [
      { label: p.infusionSet1, idx: p.infusionSet1Index, field: "infusionSet1", qty: Number(p.qtyInf1) || 0 },
      { label: p.infusionSet2, idx: p.infusionSet2Index, field: "infusionSet2", qty: Number(p.qtyInf2) || 0 },
    ];
    for (const slot of slots) {
      if (slot.idx === null || slot.idx === INFUSION_NOT_SERVING_INDEX || blank(slot.label)) continue;
      const fam = infusionSetFamily(slot.label);
      if (fam !== "unknown" && fam !== pumpFamily) {
        add({
          id: "C24_SET_INCOMPATIBLE", severity: "red", field: slot.field,
          title: `${slot.label} ✗ ${p.pumpType}`,
          detail: `${slot.label} is not compatible with a ${p.pumpType} — the order would ship unusable sets. Pick a ${p.pumpType}-compatible set.`,
        });
      } else if (fam === "tandem" && FIVE_INCH_RX.test(slot.label) && p.pumpType !== "Mobi") {
        add({
          id: "C24_FIVE_INCH_NOT_MOBI", severity: "red", field: slot.field,
          title: `5" tubing is Mobi-only`,
          detail: `${slot.label} — 5" tubing sets are for the Mobi only; they can't be used with a ${p.pumpType}. Pick a standard-length set.`,
        });
      }
    }
  }

  /* ── C. Authorization & documentation ─────────────────────────────── */

  // C17/C18 — per-product auth state, expiry, and completeness (split-aware
  // via each product's own "Not Serving" auth result).
  const authProducts: Array<{
    name: string; served: boolean; result: string;
    authId: string; end: string; field: keyof Patient;
  }> = [
    { name: "CGM monitor", served: cgmServed, result: p.cgmAuthResult, authId: p.monitorAuthId, end: p.monitorAuthEnd, field: "cgmAuthResult" },
    { name: "Sensors", served: cgmServed, result: p.sensorsAuthResult, authId: p.sensorsAuthId, end: p.sensorsAuthEnd, field: "sensorsAuthResult" },
    { name: "Insulin pump", served: pumpServed, result: p.ipAuthResult, authId: p.ipAuthId, end: p.ipAuthEnd, field: "ipAuthResult" },
    { name: "Infusion sets", served: pumpishInServing, result: p.infusionSetAuthResult, authId: p.infusionSetAuthId, end: p.infusionSetAuthEnd, field: "infusionSetAuthResult" },
    { name: "Cartridges", served: pumpishInServing, result: p.cartridgeAuthResult, authId: p.cartridgeAuthId, end: p.cartridgeAuthEnd, field: "cartridgeAuthResult" },
  ];
  for (const prod of authProducts) {
    if (!prod.served || prod.result === "Not Serving") continue;
    if (prod.result === "Denied") {
      add({
        id: "C17_AUTH_DENIED", severity: "red", field: prod.field,
        title: `${prod.name} auth DENIED`,
        detail: `${prod.name} auth is Denied — sending this profile to Subscription will bill without authorization.`,
      });
    } else if (["Evaluate", "Required", "Submitted"].includes(prod.result)) {
      add({
        id: "C17_AUTH_UNRESOLVED", severity: "amber", field: prod.field,
        title: `${prod.name} auth ${prod.result.toLowerCase()}`,
        detail: `${prod.name} auth is still "${prod.result}" — advancing with the auth unresolved.`,
      });
    } else if (prod.result === "Auth Valid") {
      const end = parseYmd(prod.end);
      if (end) {
        const days = daysFromToday(end);
        if (days < 0) {
          add({
            id: "C18_AUTH_EXPIRED", severity: "red", field: prod.field,
            title: `${prod.name} auth expired`,
            detail: `${prod.name} auth ended ${prod.end} — it has lapsed.`,
          });
        } else if (days <= 30) {
          add({
            id: "C18_AUTH_EXPIRING", severity: "amber", field: prod.field,
            title: `${prod.name} auth expires in ${days}d`,
            detail: `${prod.name} auth ends ${prod.end} — the first subscription order may fall outside the window.`,
          });
        }
      }
      if (blank(prod.authId)) {
        add({
          id: "C18_AUTH_NO_ID", severity: "info", field: prod.field,
          title: `${prod.name}: valid, no Auth ID`,
          detail: `${prod.name} auth is marked valid but no Auth ID is on file.`,
        });
      }
    }
  }

  // C19 — MR expiry.
  const mr = parseYmd(p.mrExpiryDate);
  if (mr) {
    const days = daysFromToday(mr);
    if (days < 0) {
      add({
        id: "C19_MR_EXPIRED", severity: "amber", field: "mrExpiryDate",
        title: "Medical records expired",
        detail: `MR expired ${p.mrExpiryDate} — refresh before subscription orders bill.`,
      });
    } else if (days <= 30) {
      add({
        id: "C19_MR_EXPIRING", severity: "info", field: "mrExpiryDate",
        title: `MR expires in ${days}d`,
        detail: `MR expiry is ${p.mrExpiryDate} — coming up soon.`,
      });
    }
  }

  /* ── D. Cost / benefits ───────────────────────────────────────────── */

  // C20 — cost-sharing plan with no cost data on file.
  const medicaidish = isMedicaidPrimary(primary) || secondary === "NY Medicaid";
  if (primary && !medicaidish &&
      blank(p.coInsurance) && blank(p.deductibleRemaining) && blank(p.oopMaxRemaining)) {
    add({
      id: "C20_NO_COST_DATA", severity: "info", field: "coInsurance",
      title: "No cost-sharing data",
      detail: `${primary} is a cost-sharing plan but coinsurance, deductible remaining, and OOP max remaining are all blank — the OOP conversation may not have happened.`,
    });
  }

  // C21 (lite) — OOP expectations.
  if (secondary === "NY Medicaid") {
    add({
      id: "C21_ZERO_OOP_EXPECTED", severity: "info",
      title: "Expect $0 patient OOP",
      detail: "Medicaid backstop on file — patient out-of-pocket should be $0; don't quote cost-sharing.",
    });
  }
  if (p.referralSource === "CareCentrix") {
    add({
      id: "C21_CARECENTRIX", severity: "info", field: "referralSource",
      title: "CareCentrix pricing",
      detail: "CareCentrix referral — confirm pricing with CareCentrix directly (standing rule).",
    });
  }

  /* ── E. Demographics & downstream ─────────────────────────────────── */

  // C22 — formatting checks (folds in + extends the existing inline ones).
  // The old `C22_ZIP_MISSING` branch is gone: C25 below runs the ordering
  // service's own parser, which reports a missing ZIP as a HARD failure with
  // the exact reason and the required format. Two rows saying the same thing at
  // two different severities is how a check pack gets ignored.
  if (address && address === address.toUpperCase() && /[A-Z]/.test(address)) {
    add({
      id: "C22_ADDRESS_CAPS", severity: "red", field: "address",
      title: "Address is ALL CAPS",
      detail: "Address must be re-entered with correct formatting before send.",
    });
  }

  // C25 / C26 — Cardinal order-format checks on BOTH addresses that go on the
  // order: the patient's (shipTo) and the clinic's (doctorInfo). Cardinal
  // requires and validates both; see cardinalAddressFindings above.
  for (const f of cardinalAddressFindings(address, {
    idPrefix: "C25_ADDRESS",
    field: "address",
    label: "Patient address",
    blankTitle: "Patient address is blank",
    blankDetail: "Nothing can ship without it — the Cardinal order is blocked at submit.",
  })) add(f);

  for (const f of cardinalAddressFindings(clinicAddress, {
    idPrefix: "C26_CLINIC_ADDRESS",
    field: "clinicAddress",
    label: "Clinic address",
    blankTitle: "Clinic address is blank",
    blankDetail: "Cardinal requires the doctor's address on every order (doctorInfo) — a blank one is blocked at submit.",
  })) add(f);

  if (blank(p.dob)) {
    add({
      id: "C22_DOB_MISSING", severity: "amber", field: "dob",
      title: "DOB missing",
      detail: "Date of birth is blank.",
    });
  }
  const phoneDigits = ((p.phoneEdited ?? p.phone) || "").replace(/\D/g, "");
  if (phoneDigits && phoneDigits.length !== 10 && !(phoneDigits.length === 11 && phoneDigits.startsWith("1"))) {
    add({
      id: "C22_PHONE_FORMAT", severity: "info", field: "phone",
      title: "Phone number looks off",
      detail: `Phone has ${phoneDigits.length} digits — expected 10.`,
    });
  }

  // C23 — POS verification. POS is computed & WRITTEN at Welcome Call
  // completion (expectedPos → WC board status column `color_mm5wq0ys`,
  // Office = index 0, Home = index 1). Here we VERIFY the stored value
  // against the CURRENT primary + address, since the address is still
  // editable at this stage. Until `pos` is mapped into Patient, the
  // mismatch check silently skips and the info fallback covers Office cases.
  const storedPos = (((p as { pos?: string }).pos ?? "") + "").trim();
  const expPos = expectedPos(primary, address);
  if (storedPos && primary && address && storedPos !== expPos) {
    add({
      id: "C23_POS_STALE", severity: "amber", field: "address",
      title: `POS should be ${expPos}`,
      detail: `POS is set to ${storedPos}, but ${primary} + ${state ? "the " + state : "this"} address computes ${expPos} — the address or primary changed after Welcome Call. Update POS before sending.`,
    });
  } else if (!storedPos && BCBS_FAMILY.has(primary) && state && !IN_FOOTPRINT_STATES.has(state)) {
    add({
      id: "C23_POS_11", severity: "info", field: "address",
      title: "POS 11 (Office) expected",
      detail: `Out-of-state Blue (${state} address) — billed via Anthem NY 803 BlueCard; POS should be Office (11).`,
    });
  }

  // Stable ordering: red → amber → info.
  const rank: Record<CheckSeverity, number> = { red: 0, amber: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Convenience: counts per severity for badges. */
export function countFindings(findings: CheckFinding[]): Record<CheckSeverity, number> {
  const c: Record<CheckSeverity, number> = { red: 0, amber: 0, info: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}
