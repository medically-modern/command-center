/**
 * dvsRouting.ts — who goes to the DVS stage, and when (HANDOFF-Josh-DVS.md
 * §1/§7, v2 2026-07-20). The DVS stage is FULLY AUTOMATIC: the Stage
 * Advancer flipping to "DVS" (STAGE_INDEX.dvs = 1, label verified on the
 * live board) IS the bot trigger — these rules decide when the app's sends
 * write that stage instead of their usual next stage.
 *
 *   - Benefits send: a patient whose served products ALL route to DVS
 *     (Medicaid-billed supplies, or a straight-Medicaid primary) skips the
 *     whole auth rail — stage → DVS directly.
 *   - Submit Auth send: same all-DVS test (zero submission cards) → DVS
 *     instead of Auth Outstanding.
 *   - Auth Outstanding send: when the auth rail finishes (all non-DVS
 *     products resolved) and the patient HAS DVS-routed products, stage →
 *     DVS instead of Complete — the supplies still need their DVS run.
 *
 * NOTE: the handoff's primary entry ("skip patients get Stage Advancer →
 * DVS straight from Profile Send-Off routing") is upstream board-automation
 * work — until it exists, these send-time rules are how skip patients reach
 * DVS. Straight-Medicaid patients normally never enter the rail at all
 * (Josh, 2026-07-21); these rules are the app-side safety net when one does.
 */
import { isAutoFilledMedicaidSupply, resolveHcpcs } from "./hcpcRules";
import type { Patient } from "./workflow";

/** NY Medicaid CIN format — 2 letters, 5 digits, 1 letter (e.g. KJ51074B).
 *  HARD GATE (Josh, 2026-07-21): a patient only routes to DVS when Member
 *  ID 1 or Member ID 2 matches this format — the bot runs on that ID. */
const NY_CIN_RE = /^[A-Za-z]{2}\d{5}[A-Za-z]$/;

export interface NyMedicaidCin {
  cin: string;
  source: "Member ID 1" | "Member ID 2";
}

/** The Medicaid ID the DVS runs on: Member ID 1 if it's CIN-shaped, else
 *  Member ID 2, else null (→ the patient must NOT route to DVS). */
export function nyMedicaidCin(patient: Patient): NyMedicaidCin | null {
  const m1 = (patient.memberId1 ?? "").trim();
  if (NY_CIN_RE.test(m1)) return { cin: m1.toUpperCase(), source: "Member ID 1" };
  const m2 = (patient.memberId2 ?? "").trim();
  if (NY_CIN_RE.test(m2)) return { cin: m2.toUpperCase(), source: "Member ID 2" };
  return null;
}

/** Straight NY Medicaid primary — everything the patient is served DVSes. */
export function isStraightMedicaidPrimary(patient: Patient): boolean {
  return (patient.primaryInsurance ?? "").trim() === "Medicaid";
}

/** Any served product that bills straight Medicaid (handled at DVS).
 *  Requires a CIN-shaped Medicaid ID — no CIN, no DVS routing. */
export function hasDvsRoutedProducts(patient: Patient): boolean {
  if (!nyMedicaidCin(patient)) return false;
  if (isStraightMedicaidPrimary(patient)) {
    return resolveHcpcs(
      patient.primaryInsurance || null,
      patient.serving || null,
      patient.secondaryInsurance ?? null,
    ).length > 0;
  }
  return resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  ).some(isAutoFilledMedicaidSupply);
}

/** EVERY served product routes to DVS — the patient skips the auth rail
 *  entirely (supplies-only Medicaid, or any straight-Medicaid primary). */
export function allProductsDvsRouted(patient: Patient): boolean {
  if (!nyMedicaidCin(patient)) return false;
  const resolved = resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  );
  if (resolved.length === 0) return false;
  if (isStraightMedicaidPrimary(patient)) return true;
  return resolved.every(isAutoFilledMedicaidSupply);
}

/**
 * The claims status that answers "did the INSULIN PUMP claim pay?".
 *
 * The board splits claims into two families — `S Claims Status` (supplies) and
 * `IP Claims Status` (pump). This prefers the pump-specific column and falls
 * back to the supplies one only while the pump column is blank, which is every
 * patient today: the bot doesn't populate it yet (verified against the live
 * board 2026-08-02), and the older single-column model treated the shared
 * column as "whichever claim is in flight" — the pump, at this point in the
 * chain, since supplies haven't been submitted.
 *
 * The fallback makes this self-healing: the day the bot starts writing
 * `IP Claims Status`, this reads it with no code change. That matters because
 * the alternative was guessing the bot's behaviour in advance and swapping a
 * dormant bug for a live one.
 *
 * Being wrong here is cosmetic by design — it only picks the Supplies card's
 * "Waiting on pump" chip. A pump claim that actually FAILS is caught by
 * `isManualReview` (and the board's escalation automation) off the raw status
 * columns, which never consult this.
 */
export function pumpClaimStatus(
  patient: Pick<Patient, "ipClaimsStatus" | "claimsStatus">,
): string {
  return (patient.ipClaimsStatus ?? "").trim() || (patient.claimsStatus ?? "").trim();
}

/**
 * Which bot trigger fires when the app writes Stage → DVS (Josh,
 * 2026-07-21: landing at DVS auto-flips the trigger by serving).
 *   - Pump DVSes here (straight Medicaid + pump serving) → PUMP first;
 *     supplies chain bot-side after the pump claim is fully paid.
 *   - Otherwise supplies DVS → supplies trigger.
 * The current automate-dvs bots listen to these trigger columns; when the
 * v2 bot switches to the stage flip itself, delete this.
 */
export function dvsAutoTrigger(patient: Patient): "pump" | "supplies" | null {
  if (!hasDvsRoutedProducts(patient)) return null;
  const resolved = resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  );
  const pumpHere = isStraightMedicaidPrimary(patient) && resolved.some((r) => r.product === "insulin_pump");
  if (pumpHere) return "pump";
  const suppliesHere = resolved.some(
    (r) => (r.product === "infusion_set" || r.product === "cartridge") &&
      (isStraightMedicaidPrimary(patient) || isAutoFilledMedicaidSupply(r)),
  );
  return suppliesHere ? "supplies" : null;
}
