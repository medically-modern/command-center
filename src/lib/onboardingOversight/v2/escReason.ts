/**
 * WHY a patient is escalated, in the words the person who escalated them wrote (Josh, 2026-10-02: "pull the
 * escalated reason … for all stages to help Brandon assess"). Read LIVE when a patient list opens, held in the
 * list's React state only, and never put on an item or into the dashboard's IndexedDB cache (CR-17: note text is
 * never stored or cached). Only the escalated rows of the open list are read.
 *
 * Where each stage writes its reason (verified in Command Center's writers and on the live boards, 2026-10-02):
 * - Medical Evaluation, Insurance, Welcome Call: a stamped line in the stage's notes column, as written by
 *   `masheke/proposedStuck.ts`: `[Proposed Stuck · <date> · <initials>] <reason>`, and a manager's
 *   `[Escalated to Final · …] <why>`. Insurance Benefits adds `[Auto-escalated · <date> · <initials>] <failed checks>`
 *   (`samantha/benefitsDerive.composeEscalationReason`).
 * - Intake (Profile Send Off): a NOTE-STAMPED line (`shared/noteStamp`), not a bracket tag:
 *   `[Oct 2, 2026, 2:33 PM] Patient Intake: Proposed stuck: <reason> —KT`, `… Proposed stuck — Manager Escalation:
 *   <reason> —KT`, or `… Escalated: <reason> —KT` (`profile/unverifiedWrite`).
 * - Medical Evaluation and Welcome Call also have an Escalation Reason dropdown (dropdown_mm2fhcd6), used when no
 *   line was written.
 * - A Monday automation (attempts used up, days outstanding, a denial, the DVS automations) writes the status and
 *   nothing else, so "no written reason" is normal there and is said plainly, never filled in.
 */
import { escalationTimeline } from "@/lib/systemMgmt/escalationDetail";
import { gql } from "../data/gql";
import { intakeDecisionLine } from "@/lib/masheke/proposedStuck";
import { ESC_SIGNALS } from "./escClass";

export type ReasonSource = "proposedStuck" | "escalatedToFinal" | "autoEscalated" | "escalated" | "dropdown" | "edgeCase" | "none";
export interface EscReason {
  source: ReasonSource;
  /** The reason as written ("" for none). */
  text: string;
  /** As stamped: "2026-10-01" (bracket tags) or "Oct 1, 2026, 2:33 PM" (intake). "" when absent. */
  date: string;
  /** Initials as stamped, "" when the writer was not signed in. */
  by: string;
  /** A manager decision (returned, approved) was written AFTER this reason, so it may describe an earlier escalation. */
  earlier: boolean;
}

export const SOURCE_LABEL: Record<ReasonSource, string> = {
  proposedStuck: "Proposed stuck",
  escalatedToFinal: "Escalated to Final",
  autoEscalated: "Benefits check failed",
  escalated: "Escalated",
  dropdown: "Escalation Reason",
  edgeCase: "Automatic",
  none: "No reason written",
};

const AUTO_TAG = ESC_SIGNALS.autoEscalatedTag;
const DROPDOWN_COL = "dropdown_mm2fhcd6";
const DROPDOWN_BOARDS = new Set(["MN", "WC"]);

/**
 * One intake decision line, read through Command Center's own `intakeDecisionLine` (the parser the classifier and
 * Pipeline Oversight use), plus the stamp's time and initials for display, and "Returned to pipeline" (a manager
 * handing the patient back, `unverifiedWrite.returnIntakeToPipeline`). Null for any other line.
 */
export function intakeDecision(line: string): { kind: "propose" | "escalated" | "return"; date: string; body: string; by: string } | null {
  const t = line.trim();
  const stamp = t.match(/^\[([^\]]*\d{4}[^\]]*)\]\s*/); const date = stamp ? stamp[1].trim() : "";
  const by = stamp ? t.match(/\s+—([A-Za-z]{1,4})$/)?.[1] ?? "" : "";
  const d = intakeDecisionLine(t);
  if (d) return { kind: d.kind === "escalate" ? "escalated" : "propose", date, body: d.reason, by };
  const rest = stamp ? t.slice(stamp[0].length) : t;
  return /^(?:[^:]*?:\s*)?Returned to pipeline:/i.test(rest) ? { kind: "return", date, body: "", by } : null;
}

const NONE: EscReason = { source: "none", text: "", date: "", by: "", earlier: false };

/** The latest written reason in a notes body, else the dropdown's. Pure; tested. */
export function extractEscReason(board: string, notes: string | null | undefined, dropdown?: string | null): EscReason {
  const lines = (notes ?? "").split(/\r?\n/);
  let later = false; // a return/approval was written after the reason we end up with
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim(); if (!raw) continue;
    if (board === "INT") {
      const d = intakeDecision(raw); if (!d) continue;
      if (d.kind === "return") { later = true; continue; }
      return { source: d.kind === "propose" ? "proposedStuck" : "escalated", text: d.body, date: d.date, by: d.by, earlier: later };
    }
    if (raw.startsWith(AUTO_TAG)) {
      const close = raw.indexOf("]"); const parts = raw.slice(1, close < 0 ? undefined : close).split("·").map((s) => s.trim());
      return { source: "autoEscalated", text: close < 0 ? "" : raw.slice(close + 1).trim(), date: parts[1] ?? "", by: parts[2] ?? "", earlier: later };
    }
    const ev = escalationTimeline(raw)[0]; if (!ev) continue;
    if (ev.kind === "return" || ev.kind === "approve") { later = true; continue; }
    return { source: ev.kind === "escalate" ? "escalatedToFinal" : "proposedStuck", text: ev.body, date: ev.date, by: ev.initials, earlier: later };
  }
  return fallback(board, dropdown, later);
}

function fallback(board: string, dropdown: string | null | undefined, earlier: boolean): EscReason {
  const d = (dropdown ?? "").trim();
  return DROPDOWN_BOARDS.has(board) && d ? { source: "dropdown", text: d, date: "", by: "", earlier: false } : { ...NONE, earlier };
}

/** The automatic Edge Case triggers (escClass), named, for an escalated row with no written reason. */
export function edgeCaseReason(board: string, sig: { attemptsIndex?: number | null; stageIndex?: number | null; evalCount?: number | null; groupId?: string }): string {
  if (board === "MN" && sig.attemptsIndex === ESC_SIGNALS.mnAttempts.escalateIndex) return "Medical Evaluation attempts used up (Attempts = Escalate)";
  if (board === "MN" && sig.stageIndex === ESC_SIGNALS.mnEvalCount.stageIndex && (sig.evalCount ?? 0) >= ESC_SIGNALS.mnEvalCount.min) return `Evaluated ${sig.evalCount} times`;
  if (board === "INS" && sig.groupId === ESC_SIGNALS.insAuthDeniedGroup) return "In the Auth Denied group";
  return "";
}

type RowRef = { key: string; boardKey: string; itemId: string };
type GqlItem = { id: string; group?: { id: string } | null; column_values: { id: string; text: string | null; index?: number | null }[] };

/**
 * Read the reasons for these rows (READ-ONLY, 50 items per query, one board at a time). Returns reasons keyed by row
 * key. The notes text is parsed here and dropped; only the reason line leaves this function.
 */
export async function fetchEscReasons(rows: RowRef[]): Promise<Record<string, EscReason>> {
  const out: Record<string, EscReason> = {};
  const byBoard = new Map<string, RowRef[]>();
  for (const r of rows) if (ESC_SIGNALS.notesColumn[r.boardKey]) (byBoard.get(r.boardKey) ?? byBoard.set(r.boardKey, []).get(r.boardKey)!).push(r);
  for (const [board, list] of byBoard) {
    const notesCol = ESC_SIGNALS.notesColumn[board];
    const cols = [notesCol, ...(DROPDOWN_BOARDS.has(board) ? [DROPDOWN_COL] : []),
      ...(board === "MN" ? [ESC_SIGNALS.mnAttempts.col, ESC_SIGNALS.mnStageColumn, ESC_SIGNALS.mnEvalCount.col] : [])];
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      const d = await gql<{ items: GqlItem[] }>(
        "query($ids:[ID!],$cols:[String!]){ items(ids:$ids){ id group { id } column_values(ids:$cols){ id text ... on StatusValue { index } } } }",
        { ids: chunk.map((r) => r.itemId), cols });
      const byId = new Map((d.items ?? []).map((x) => [String(x.id), x]));
      for (const r of chunk) {
        const it = byId.get(r.itemId); if (!it) continue;
        const cv = (id: string) => it.column_values?.find((c) => c.id === id);
        let reason = extractEscReason(board, cv(notesCol)?.text, cv(DROPDOWN_COL)?.text);
        if (reason.source === "none") {
          const edge = edgeCaseReason(board, { attemptsIndex: cv(ESC_SIGNALS.mnAttempts.col)?.index, stageIndex: cv(ESC_SIGNALS.mnStageColumn)?.index,
            evalCount: Number(cv(ESC_SIGNALS.mnEvalCount.col)?.text) || null, groupId: it.group?.id });
          if (edge) reason = { ...reason, source: "edgeCase", text: edge, earlier: false }; // the trigger is current, not an earlier write
        }
        out[r.key] = reason;
      }
    }
  }
  return out;
}
