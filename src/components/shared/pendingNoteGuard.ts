import { useEffect } from "react";
import { toast } from "sonner";
import type { ColumnRef } from "./longTextGuard";
import { reportPendingNote, clearPendingNote, hasPendingNote, PENDING_NOTE_TITLE, PENDING_NOTE_DESCRIPTION } from "@/lib/shared/pendingNote";

/** The store key for a notes box: the column it writes, or a page-level name. */
export function pendingNoteKey(ref: ColumnRef | undefined, fallback: string): string {
  return ref ? `${ref.boardId}:${ref.columnId}` : fallback;
}

/**
 * Call from a notes box with its current draft. Reports every change and
 * clears the entry on unmount — the box is keyed by patient at every mount
 * (`notesDraftIsolation.test.ts`), so a patient switch unmounts it and the
 * draft can neither block the next patient's send nor be filed under them.
 */
export function usePendingNoteReport(key: string, text: string): void {
  useEffect(() => {
    reportPendingNote(key, text);
    return () => clearPendingNote(key);
  }, [key, text]);
}

/**
 * Call at the top of any action that leaves the patient (a send, an advance,
 * Mark as Stuck). Returns true — and tells the rep why — when a note box on
 * screen still holds un-added text. One press of Add, or clearing the box,
 * lets the action through; nothing is discarded on the rep's behalf.
 */
export function refusePendingNote(): boolean {
  if (!hasPendingNote()) return false;
  toast.error(PENDING_NOTE_TITLE, { description: PENDING_NOTE_DESCRIPTION, duration: 8000 });
  return true;
}
