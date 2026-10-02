/**
 * Two kinds of escalation, classified LIVE (Brandon's CORE RULE; CR-17). The notes stamp is read at runtime for
 * escalated patients only, reduced to one word, and never stored or cached as text. Signals are the ones Command
 * Center itself writes (verified in its code), parsed with CC's own stamp parser:
 * - Proposed Stuck: the latest stamped decision line is "[Proposed Stuck" (MN/INS/WC notes) or, on Intake, the latest
 *   call-log line starts "Proposed stuck" (lib/profile/unverifiedWrite.ts proposeStuckNoteLine); an "[Auto-escalated"
 *   stamp (Insurance Benefits) is Proposed Stuck too (Brandon A3).
 * - Edge Case: Medical Necessity attempts exhausted (Attempts = "Escalate") or Evaluation Count >= 3 at Evaluate;
 *   Insurance patients in the Auth Denied group (Brandon A3, 30-day normal applied in the model).
 * - Anything else: Unclassified, never guessed.
 */
import { escalationTimeline } from "@/lib/systemMgmt/escalationDetail";
import type { BoardKey, ItemRow } from "../types";
import { gql } from "../data/gql";

export type EscClass = "proposedStuck" | "edgeCase" | "unclassified";
export const ESC_SIGNALS = {
  notesColumn: { INT: "text_mm389fs", MN: "text_mm6vevjf", INS: "text_mm6vzc7q", WC: "text_mm6vqq2k" } as Record<string, string>,
  escalationColumn: { INT: "color_mm5zww42", MN: "color_mm1x7997", INS: "color_mm2vsh2f", WC: "color_mm1x7997" } as Record<string, string>,
  mnAttempts: { col: "color_mm1wz0vg", escalateIndex: 0 },
  mnEvalCount: { col: "numeric_mm4bhjc8", min: 3, stageIndex: 8 },
  mnStageColumn: "color_mm1wyr92",
  insAuthDeniedGroup: "group_mm316hg2",
  autoEscalatedTag: "[Auto-escalated",
  intakeProposedLine: /^\s*Proposed stuck\b/i,
  intakeEscalatedLine: /^\s*Escalated:/i,
};

/** Classify one escalated item from its column values and (transient) notes text. Pure; tested. */
export function classifyEscalation(it: Pick<ItemRow, "boardKey" | "groupId" | "values">, notes: string | null | undefined): EscClass {
  const b = it.boardKey; const v = it.values;
  if (b === "MN") {
    if (v[ESC_SIGNALS.mnAttempts.col]?.index === ESC_SIGNALS.mnAttempts.escalateIndex) return "edgeCase"; // the structured signal wins over a stale stamp
    if (v[ESC_SIGNALS.mnStageColumn]?.index === ESC_SIGNALS.mnEvalCount.stageIndex && (v[ESC_SIGNALS.mnEvalCount.col]?.num ?? 0) >= ESC_SIGNALS.mnEvalCount.min) return "edgeCase";
  }
  if (b === "INS" && it.groupId === ESC_SIGNALS.insAuthDeniedGroup) return "edgeCase";
  if (!notes) return "unclassified";
  if (b === "INT") {
    const lines = notes.split(/\r?\n/).filter((l) => ESC_SIGNALS.intakeProposedLine.test(l) || ESC_SIGNALS.intakeEscalatedLine.test(l));
    const last = lines.at(-1); return last && ESC_SIGNALS.intakeProposedLine.test(last) ? "proposedStuck" : "unclassified";
  }
  const latest = escalationTimeline(notes)[0]; // newest first
  const lastAuto = notes.lastIndexOf(ESC_SIGNALS.autoEscalatedTag), lastProp = notes.lastIndexOf("[Proposed Stuck");
  if (lastAuto > lastProp && lastAuto >= 0) return "proposedStuck";
  return latest?.kind === "propose" ? "proposedStuck" : "unclassified";
}

/** Is the item escalated now (Manager = 0 or Final = 2 on its board's escalation column)? */
export const isEscalated = (it: Pick<ItemRow, "boardKey" | "values">) => { const c = ESC_SIGNALS.escalationColumn[it.boardKey]; const i = c ? it.values[c]?.index : null; return i === 0 || i === 2; };

/**
 * Read the notes column for the escalated items of one board (READ-ONLY query), classify each in memory and return
 * only the class. The notes text never leaves this function.
 */
export async function fetchEscClasses(board: Exclude<BoardKey, "SUB" | "FAX">, items: ItemRow[]): Promise<Record<string, EscClass>> {
  const col = ESC_SIGNALS.notesColumn[board]; const esc = items.filter((it) => it.boardKey === board && isEscalated(it)); const out: Record<string, EscClass> = {};
  for (let i = 0; i < esc.length; i += 50) {
    const chunk = esc.slice(i, i + 50);
    const d = await gql<{ items: { id: string; column_values: { id: string; text: string | null }[] }[] }>(
      "query($ids:[ID!],$cols:[String!]){ items(ids:$ids){ id column_values(ids:$cols){ id text } } }", { ids: chunk.map((x) => x.itemId), cols: [col] });
    const notes = new Map((d.items ?? []).map((x) => [String(x.id), x.column_values?.[0]?.text ?? null]));
    for (const it of chunk) out[it.itemId] = classifyEscalation(it, notes.get(it.itemId));
  }
  return out;
}
