/**
 * Un-added text sitting in a notes box — the note a rep typed and has not yet
 * pressed Add on.
 *
 * Brandon, 2026-09-03: he typed a note on Final Profile Confirmation, pressed
 * "Confirm Profile & Send" without pressing Add, opened the next patient, and
 * the text was still sitting in that patient's note box. Two failures in one:
 * the note never reached the board, and it was one click from being filed under
 * the wrong patient. Every notes box reports its draft here (see
 * `components/shared/pendingNoteGuard`), and every send that leaves the page
 * refuses while one is pending — the same gate EvaluatePanel already had for
 * its own box ("Press Add on your note before sending").
 *
 * Keyed by the box (board:column), not the patient: only one patient's boxes
 * are mounted at a time, and a box unmounting clears its own entry, so a stale
 * key cannot outlive the screen it belonged to.
 */
const drafts = new Map<string, string>();

/** Record the box's current draft; blank/whitespace clears the entry. */
export function reportPendingNote(key: string, text: string): void {
  if (text.trim()) drafts.set(key, text);
  else drafts.delete(key);
}

export function clearPendingNote(key: string): void {
  drafts.delete(key);
}

/** The first non-blank draft on screen, or "" when every box is empty. */
export function pendingNoteText(): string {
  for (const v of drafts.values()) if (v.trim()) return v;
  return "";
}

export function hasPendingNote(): boolean {
  return pendingNoteText().length > 0;
}

/** Test-only: forget every draft. */
export function resetPendingNotesForTests(): void {
  drafts.clear();
}

export const PENDING_NOTE_TITLE = "Press Add on your note before sending";
export const PENDING_NOTE_DESCRIPTION =
  "There is text in the note box that hasn't been added. Press Add to keep it, or clear the box, then send again.";
