/**
 * lib/welcomeCall/sendGates.ts — what still has to be true before this call can
 * advance, as a list a rep can read.
 *
 * ── WHY A LIST AND NOT A BOOLEAN (Brandon, 2026-09-09) ──
 * *"Get rid of delete and send for production, but display what needs to be
 * done in order to advance patient."* The ops mockup does exactly that: the
 * unmet requirement is spelled out in a sentence beside a greyed-out
 * **Send to Monday**. One source feeds both, so the button and the explanation
 * can never disagree — a disabled control with no stated reason is the shape
 * reps report as "the app is broken".
 *
 * ── THE TWO NEW GATES ──
 * *"Pump type confirmed verbally"* and *"Address confirmed with patient"* are
 * **UI-only**: they gate the send and get written into the call-intake note as
 * an audit line, and they deliberately get no Monday column (Brandon: "keep
 * this UI-only, no Monday column… just don't parse it back or make a column out
 * of it").
 *
 * ⚠️ **They apply to ADVANCE only, never to Don't Advance.** If a rep could not
 * reach the patient and is holding, they cannot have confirmed anything with
 * them — gating the hold on a confirmation they were never able to get would
 * strand the patient in the queue with no way to record what happened. Brandon
 * called this out explicitly and it is the whole reason the decision is read
 * before the gates are.
 *
 * ⚠️ **The pump gate is scoped to serving a PUMP DEVICE**, via
 * `servingSellsPumpDevice` — never `servingIncludesPump`, which is true for
 * "Supplies Only" and would demand a pump confirmation from a patient who
 * already owns theirs. That conflation is CLAUDE.md §5.22's $3,787 incident.
 */
import { servingSellsPumpDevice } from "@/lib/shared/servingLines";
import type { CallIntake } from "./callIntake";

/** Advance? `color_mm301cpp` — 1 = Advance, 2 = Don't Advance. */
export const ADVANCE_INDEX = 1;
export const DONT_ADVANCE_INDEX = 2;

export interface SendGateInput {
  advanceDecisionIndex: number | null;
  /**
   * What Brandon's secondary-coverage question still needs — the output of
   * `secondaryCoverage.secondaryMissing`.
   *
   * ⚠️ He said "required" of the Member ID 2 / CIN / Insurance Notes rules and
   * carved out **only Unknown** from gating ("patients often don't know"). Shown
   * as amber text alone, a rep could pick NY Medicaid, type nothing, and advance
   * — handing the payer and DVS work downstream an incomplete policy (Greptile,
   * PR #56). `secondaryMissing` already returns [] for No and Unknown, so the
   * carve-out is preserved by construction rather than by a second condition
   * here that could drift from it.
   */
  secondaryMissing?: string[];
  /** Serving as the rep has it (edited value wins). */
  serving: string;
  /** Pump Type label, for naming the model in the requirement. */
  pumpType: string;
  intake: CallIntake;
}

export interface SendRequirement {
  key: "pump-confirmed" | "address-confirmed" | "secondary-incomplete";
  /** The sentence shown beside the disabled button. */
  label: string;
}

/**
 * Does this patient need the verbal pump confirmation?
 *
 * Hidden entirely when the serving does not sell a pump device — Brandon:
 * "Hide it and don't require it when Insulin Pump isn't in Serving."
 */
export function needsPumpConfirmation(serving: string): boolean {
  return servingSellsPumpDevice(serving);
}

/**
 * The checkbox label, with the model inline so the rep reads the actual pump
 * out loud rather than the word "pump" — the point of the gate is that the
 * supplies match the device.
 */
export function pumpConfirmLabel(pumpType: string): string {
  const model = (pumpType ?? "").trim();
  return model
    ? `Pump type confirmed verbally with the patient (${model})`
    : "Pump type confirmed verbally with the patient";
}

/**
 * Unmet requirements, in the order a rep works down the page.
 *
 * ⚠️ Returns `[]` for anything other than Advance — including an undecided
 * call. An undecided call is already blocked by `validatePatientForSend`'s own
 * "pick Advance or Don't Advance", and listing confirmations underneath it
 * would tell a rep to tick boxes before they have made the decision that
 * decides whether the boxes apply at all.
 */
export function unmetSendRequirements(i: SendGateInput): SendRequirement[] {
  if (i.advanceDecisionIndex !== ADVANCE_INDEX) return [];
  const out: SendRequirement[] = [];
  if (needsPumpConfirmation(i.serving) && !i.intake.confirmed.pump) {
    out.push({
      key: "pump-confirmed",
      label: `Confirm the pump type with the patient${
        i.pumpType.trim() ? ` (${i.pumpType.trim()})` : ""
      } in the Pump & Infusion Sets section.`,
    });
  }
  if (!i.intake.confirmed.address) {
    out.push({
      key: "address-confirmed",
      label: "Confirm the shipping address with the patient in the Confirm Address section.",
    });
  }
  for (const m of i.secondaryMissing ?? []) {
    out.push({ key: "secondary-incomplete", label: m });
  }
  return out;
}

/**
 * ⚠️ Whether the PUMP TYPE has changed out from under an existing tick.
 *
 * Brandon: "If Pump Type changes after it's checked, uncheck it automatically."
 * A confirmation is about one model — the rep said "t:slim" out loud — so it
 * cannot survive the model changing. Left checked, the audit line in the notes
 * would claim a conversation that never happened about the pump now on order.
 *
 * The model that was confirmed is carried in the call-intake block as
 * `pumpConfirmedModel` (Josh, 2026-09-09), so the tick survives a reload and a
 * rep coming back tomorrow keeps a confirmation they really did get.
 *
 * ⚠️ An untouched tick with NO recorded model is treated as stale. Those are
 * blocks written before this field existed: the confirmation is real but we
 * cannot say which pump it was about, and assuming it still holds is the
 * failure this exists to prevent. Re-asking costs one question on the call.
 */
export function pumpConfirmationStale(args: {
  /** `intake.confirmed.pump`. */
  confirmed: boolean;
  /** `intake.pumpConfirmedModel`. */
  confirmedModel: string;
  /** Pump Type as it now reads. */
  pumpType: string;
}): boolean {
  if (!args.confirmed) return false;
  const was = (args.confirmedModel ?? "").trim();
  const now = (args.pumpType ?? "").trim();
  if (!was) return true;
  return was !== now;
}
