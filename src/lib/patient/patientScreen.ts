/**
 * The patient screen's pure rules (§5.39) — the onboarding stepper's state, the
 * info strip's facts, and where each "Open" link goes.
 *
 * Everything here reads the dossier the Comms Hub already builds (§5.28). No
 * board read, no write, no second opinion about who a patient is.
 */
import type { DossierItem, PathStep, PatientDossier } from "@/lib/commsHub/dossier";
import { COMPLETED_STAGE_ROUTES } from "@/lib/systemMgmt/stageCompletion";

/** Query key the page reads for its view toggle. */
export const VIEW_PARAM = "view";
/** Query key for the right-hand column's tab. */
export const SIDE_PARAM = "side";
/** Query key carrying the board, because a Monday item id alone does not say
 *  which board it is on and `fetchDossierItemsForPick` needs both. */
export const BOARD_PARAM = "board";

export type PatientView = "onboarding" | "subscription";
export type PatientSide = "texts" | "calls";

export function parseView(raw: string | null): PatientView {
  return raw === "subscription" ? "subscription" : "onboarding";
}

export function parseSide(raw: string | null): PatientSide {
  return raw === "calls" ? "calls" : "texts";
}

/** The Subscription board — not a pipeline stage, so it is not in the stepper. */
export const SUBSCRIPTION_BOARD = 18407459988;

/**
 * Is this patient on the Subscription board at all?
 *
 * ⚠️ **The rule is the ROW'S EXISTENCE, not its status** (Brandon, 2026-09-18):
 * the row is created at Final Profile Confirmation, so a patient stuck in
 * Insurance whose row was created early can still open it. Reading a status
 * would hide exactly that patient, which is the one case the toggle exists to
 * make reachable.
 */
export function subscriptionItem(dossier: PatientDossier | null): DossierItem | null {
  if (!dossier) return null;
  return dossier.items.find((i) => i.boardId === SUBSCRIPTION_BOARD) ?? null;
}

/**
 * Where a step's "Open" link goes.
 *
 * ⚠️ **A COMPLETED step opens in REVIEW MODE** — `?completedStage=` is what
 * `useCompletedStageReview` keys off, and it is a WRITE GATE, not a banner flag
 * (§7): without it a rep reading history could re-advance a finished patient,
 * and the advancer is what the board automations fire on. This is the same
 * mechanism §5.38 records as the app's stage history; the patient screen is
 * simply a second caller of it.
 *
 * Returns null when the board has no page — an honest dead end, rendered as
 * plain text rather than a link that goes nowhere (§7's `UnworkableRow` rule).
 */
export function stepOpenHref(step: PathStep): string | null {
  const item = step.item;
  if (!item) return null;

  // A live record opens the page its own Stage Advancer names, which is what
  // `DossierItem.route` already carries.
  if (!item.isCompleted) {
    return item.route ? `${item.route}?patientId=${item.itemId}&from=patient` : null;
  }

  const route = COMPLETED_STAGE_ROUTES[item.boardId];
  if (!route) return null;
  return `${route}?patientId=${item.itemId}&completedStage=${item.boardId}&from=patient`;
}

/** Human label under a step, saying what state it is in and why. */
export function stepCaption(step: PathStep): string {
  switch (step.state) {
    case "completed":
      return "Completed";
    case "active":
      return step.item?.stageAdvancerText || "In progress";
    case "parked":
      return step.item?.isStuck ? "Stuck" : step.item?.stageAdvancerText || "On this board";
    default:
      return "Not started";
  }
}

export interface InfoFact {
  label: string;
  value: string;
  /** Rendered muted when the board simply has no answer. */
  missing?: boolean;
}

/**
 * The info strip's facts, read off the ACTIVE record.
 *
 * ⚠️ **A blank renders as an em dash and says "not on file", never as a zero or
 * an invented default.** Missing and empty are different facts everywhere else
 * in this app (§5.31f, §5.31g) and they are different here too: a rep reading
 * this strip on a call must be able to tell "nobody has answered that" from "the
 * answer is none".
 */
export function infoFacts(dossier: PatientDossier | null): InfoFact[] {
  const a = dossier?.active ?? null;
  const fact = (label: string, value: string): InfoFact => ({
    label,
    value: value.trim() || "—",
    missing: !value.trim(),
  });
  if (!a) return [];
  return [
    fact("Stage", a.stageAdvancerText || a.groupTitle),
    fact("Board", a.boardName),
    fact("Days in stage", a.daysSinceStage),
    fact("Next action", a.nextActionDate),
    fact("DOB", a.dob),
    fact("Phone", a.phone),
  ];
}

/** How far along the stepper reads, for the header's one-line summary. */
export function pathSummary(dossier: PatientDossier | null): string {
  if (!dossier) return "";
  const done = dossier.path.filter((s) => s.state === "completed").length;
  const total = dossier.path.length;
  const live = dossier.active;
  if (live) return `${done} of ${total} stages complete · now on ${live.boardName}`;
  return `${done} of ${total} stages complete`;
}
