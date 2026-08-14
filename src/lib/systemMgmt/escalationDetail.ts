/**
 * What the System Management → Escalations tab says ABOUT an escalation.
 *
 * ⚠️ Read this before changing where the reason comes from.
 *
 * The tab used to describe an escalation from a dedicated **Escalation Notes**
 * long_text column, parsed for a `[ESCALATION FORM] … [/ESCALATION FORM]` block
 * (`lib/shared/escalation.ts`). That column is retired in practice: audited
 * 2026-08-14 against the live boards, it was populated for **0 of 28** escalated
 * Medical Evaluation patients and **3 of 30** on Insurance, while the notes
 * column was populated for 57 of those 58 and carried a stamped
 * `[Proposed Stuck …]` line for 15 of them. So the Details modal printed
 * "No escalation form data found" for 35 of the 38 patients that reached it,
 * and — because `parseEscalation` returned null — every row in the tab fell
 * through to the `"Medium"` urgency default and rendered the same yellow.
 *
 * How escalations are actually raised today (CLAUDE.md §7):
 *   - **Propose Stuck** — the reason is APPENDED to the stage's notes column as
 *     a stamped line (`lib/masheke/proposedStuck.ts`), never a column of its own.
 *   - **Auto rules** — attempt 4+, >5 days outstanding, a denial, the four DVS
 *     board automations. These write the status column and NOTHING else, so a
 *     patient with no stamp is normal, not missing data: their story is the
 *     attempt log in the same notes column.
 *
 * Both live in the notes body, which is why everything here reads `notes` and
 * the retired columns are not consulted. The legacy form is still rendered when
 * a patient happens to carry one (three do), so nothing already written is lost.
 */

import {
  PROPOSED_STUCK_TAG,
  APPROVED_STUCK_TAG,
  RETURNED_TO_QUEUE_TAG,
  RETURNED_TO_MANAGER_TAG,
  ESCALATED_TO_FINAL_TAG,
  extractProposedStuckReason,
} from "../masheke/proposedStuck";

// ── Escalation level ─────────────────────────────────────────

/**
 * Which rung of the ladder this escalation sits on.
 *
 * Medical Evaluation and Insurance split their Escalation column in July 2026
 * into index 0 "Manager Escalation Required" and index 2 "Final Escalation
 * Required" (index 1 = Done). Welcome Call never split — it has a single
 * "Escalation Required" label — hence `flat`, which exists so that board is
 * described honestly rather than being labelled a manager rung it has no
 * concept of.
 */
export type EscalationLevel = "manager" | "final" | "flat";

/** Boards whose Escalation column carries the manager/final split. */
const SPLIT_BOARDS = new Set([18406060017, 18410601299]);

/**
 * Derive the rung from the status column's label and raw index.
 *
 * Text first so a board that gains the split later is read correctly without a
 * code change; index second, and only on the two boards known to be split, so a
 * label RENAME can't silently drop every escalation to `flat`. Returns null when
 * the patient isn't escalated at all — same inputs the membership test uses, so
 * the two can't disagree about who is escalated.
 */
export function escalationLevelFrom(
  boardId: number,
  escalationText: string,
  escalationIndex: number | null,
): EscalationLevel | null {
  const text = (escalationText ?? "").trim();
  if (text === "Final Escalation Required") return "final";
  if (text === "Manager Escalation Required") return "manager";
  if (text === "Escalation Required" || text === "Escalate") return "flat";
  if (SPLIT_BOARDS.has(boardId)) {
    if (escalationIndex === 2) return "final";
    if (escalationIndex === 0) return "manager";
  }
  return null;
}

/** Badge text. `flat` boards say only that the patient IS escalated. */
export const LEVEL_LABEL: Record<EscalationLevel, string> = {
  manager: "Manager Intervention",
  final: "Final Decisions",
  flat: "Escalated",
};

/** Badge styling per rung. Orange = a manager owns it, red = final review. */
export const LEVEL_BADGE: Record<EscalationLevel, string> = {
  manager: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  final:   "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  flat:    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// ── Stamped decision lines ───────────────────────────────────

/** The five stamped lines a manager decision can leave in a notes column. */
const DECISION_TAGS: { tag: string; label: string; kind: StampKind }[] = [
  { tag: PROPOSED_STUCK_TAG,     label: "Proposed Stuck",      kind: "propose" },
  { tag: APPROVED_STUCK_TAG,     label: "Approved Stuck",      kind: "approve" },
  { tag: ESCALATED_TO_FINAL_TAG, label: "Escalated to Final",  kind: "escalate" },
  { tag: RETURNED_TO_QUEUE_TAG,  label: "Returned to queue",   kind: "return" },
  { tag: RETURNED_TO_MANAGER_TAG, label: "Returned to manager", kind: "return" },
];

export type StampKind = "propose" | "approve" | "escalate" | "return";

export interface StampedEvent {
  kind: StampKind;
  /** Human label for the tag, e.g. "Proposed Stuck". */
  label: string;
  /** ET date string as stamped, e.g. "2026-08-14". "" when absent. */
  date: string;
  /** Author initials as stamped. "" when the writer wasn't signed in. */
  initials: string;
  /** Everything after the closing bracket — the reason/note itself. */
  body: string;
}

/**
 * Every stamped decision line in a notes body, NEWEST FIRST.
 *
 * The stamp shape is `[<Tag> · <date> · <initials>] <body>` and the initials are
 * deliberately INSIDE the bracket (see proposedStuck.ts), so the split is always
 * at the first `]` — the body can contain anything, brackets included.
 */
export function escalationTimeline(notes: string | undefined): StampedEvent[] {
  if (!notes) return [];
  const out: StampedEvent[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    const def = DECISION_TAGS.find((d) => line.startsWith(d.tag));
    if (!def) continue;
    const close = line.indexOf("]");
    // A tag with no closing bracket is malformed; keep the line rather than
    // dropping it, so a broken stamp is visible instead of silently missing.
    if (close < 0) {
      out.push({ kind: def.kind, label: def.label, date: "", initials: "", body: line.slice(def.tag.length).trim() });
      continue;
    }
    // Inside the bracket: "<Tag> · <date>" or "<Tag> · <date> · <initials>".
    const parts = line.slice(1, close).split("·").map((s) => s.trim());
    out.push({
      kind: def.kind,
      label: def.label,
      date: parts[1] ?? "",
      initials: parts[2] ?? "",
      body: line.slice(close + 1).trim(),
    });
  }
  return out.reverse();
}

/** The latest proposed-stuck reason, or "" for an auto-escalation. */
export function proposedStuckReason(notes: string | undefined): string {
  return extractProposedStuckReason(notes);
}

// ── Notes / attempt parsing ──────────────────────────────────

/**
 * Split a notes body into entries.
 *
 * Extracted from SystemMgmtPage (2026-08-14) so the Escalations modal and the
 * Notes side panel share one parser instead of drifting.
 *
 * Handles bracketed headers like `[May 14, 2026, 12:04 PM]` first, then bare
 * date prefixes, then blank-line paragraphs, then a single block.
 */
export function parseNoteEntries(notes: string): { header: string; body: string }[] {
  if (!notes) return [];
  const text = notes.trim();

  const bracketParts = text.split(/(?=\[[^\]]*\d{4}[^\]]*\])/);
  if (bracketParts.length > 1 || /^\[[^\]]*\d{4}[^\]]*\]/.test(text)) {
    const entries = bracketParts
      .filter((p) => p.trim().length > 0)
      .map((entry) => {
        const headerMatch = entry.match(/^\[([^\]]+)\]/);
        const header = headerMatch ? headerMatch[1].trim() : "";
        const body = headerMatch ? entry.slice(headerMatch[0].length).trim() : entry.trim();
        return { header, body };
      });
    if (entries.length > 0) return entries;
  }

  const dateParts = text.split(/(?=(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}))/);
  if (dateParts.length > 1) {
    return dateParts
      .filter((p) => p.trim().length > 0)
      .map((entry) => {
        const dateMatch = entry.match(/^(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
        const header = dateMatch ? dateMatch[1] : "";
        const body = dateMatch ? entry.slice(dateMatch[0].length).trim() : entry.trim();
        return { header, body };
      });
  }

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paragraphs.length > 1) {
    return paragraphs.map((p) => ({ header: "", body: p.trim() }));
  }

  return [{ header: "", body: text }];
}

/** Reverse so the most recent (last in Monday's text) comes first. */
export function parseNoteEntriesNewestFirst(notes: string): { header: string; body: string }[] {
  return parseNoteEntries(notes).reverse();
}

/** Full stage names (current) + legacy abbreviations still on old items. */
const ATTEMPT_PREFIXES = [
  "Chase Clinicals Attempt",
  "Confirm Receipt Attempt",
  "Send Request Attempt",
  "C.C. Attempt",
  "C.R. Attempt",
  "S.R. Attempt",
];

export interface AttemptEntry {
  timestamp: string;
  label: string;
  body: string;
}

/** The logged Confirm Receipt / Chase / Send Request attempts, oldest first. */
export function parseAttemptNotes(notes: string): AttemptEntry[] {
  if (!notes) return [];
  return parseNoteEntries(notes)
    .filter((e) => ATTEMPT_PREFIXES.some((pfx) => e.body.startsWith(pfx)))
    .map((e) => {
      const colonIdx = e.body.indexOf(":");
      const label = colonIdx > -1 ? e.body.slice(0, colonIdx).trim() : e.body.trim();
      const body = colonIdx > -1 ? e.body.slice(colonIdx + 1).trim() : "";
      return { timestamp: e.header, label, body };
    });
}

// ── Assembled view model ─────────────────────────────────────

export interface EscalationDetail {
  level: EscalationLevel | null;
  /** The rep's stated reason, or "" when an auto rule raised this. */
  reason: string;
  /** Manager decisions on this patient, newest first. */
  timeline: StampedEvent[];
  /** Logged outreach attempts — the story behind an auto-escalation. */
  attempts: AttemptEntry[];
  /** Recent ordinary note entries, newest first. */
  recentNotes: { header: string; body: string }[];
  /**
   * True when nothing at all could be said about this escalation. Distinct from
   * "no proposed reason": an auto-escalated patient with a full attempt log is
   * well explained, and must not be reported as missing data.
   */
  empty: boolean;
}

/** How many ordinary note entries the modal shows before "…and N more". */
export const RECENT_NOTES_SHOWN = 5;

export function buildEscalationDetail(
  level: EscalationLevel | null,
  notes: string | undefined,
): EscalationDetail {
  const body = notes ?? "";
  const reason = proposedStuckReason(body);
  const timeline = escalationTimeline(body);
  const attempts = parseAttemptNotes(body);
  // Ordinary notes = everything that isn't already shown as a stamped decision
  // or an attempt card, so the modal doesn't print the same line three times.
  //
  // ⚠️ A stamp has to be matched on the entry HEADER as well as the body.
  // `parseNoteEntries` splits on any bracketed run containing a 4-digit year,
  // and a stamp head — `[Proposed Stuck · 2026-08-01 · JH]` — is exactly that,
  // so the tag lands in `header` (brackets stripped) and only the reason lands
  // in `body`. Checking the body alone let every stamped decision through as an
  // ordinary note. The body check stays for a stamp whose date carries a
  // 2-digit year, which the bracket split doesn't recognise.
  const recentNotes = parseNoteEntriesNewestFirst(body).filter((e) => {
    const header = e.header.trim();
    const t = e.body.trim();
    const isDecision = DECISION_TAGS.some(
      (d) => header.startsWith(d.tag.slice(1)) || t.startsWith(d.tag),
    );
    if (isDecision) return false;
    if (ATTEMPT_PREFIXES.some((pfx) => t.startsWith(pfx))) return false;
    return t.length > 0;
  });
  return {
    level,
    reason,
    timeline,
    attempts,
    recentNotes,
    empty: !reason && timeline.length === 0 && attempts.length === 0 && recentNotes.length === 0,
  };
}
