import { toast } from "sonner";
import { assertLongTextFits } from "@/lib/shared/longText";
import { isCappedColumn } from "@/lib/shared/columnType";

/** The board + column a notes body is headed for, so the guard can ask its real type. */
export interface ColumnRef {
  boardId: number | string;
  columnId: string;
}

/**
 * Refuse a notes body Monday would silently truncate — and TELL the rep.
 *
 * Monday accepts an over-2000-char long_text write, returns 200, and stores
 * only the first 2000 (lib/shared/longText). Every NotesPanel's "Add" wrote
 * straight through that: the panel showed "Note saved to Monday", the local
 * overlay showed the note, and the board had thrown it away. Bridget Browne's
 * MN Workflow Notes sat at exactly 2000 for five days while every note added
 * to it vanished with a green toast (2026-09-03).
 *
 * Call this BEFORE touching local state or clearing the textarea, so a refused
 * note stays in the box to be shortened rather than retyped.
 *
 * Pass `ref` when the column is known: a column that is already plain `text`
 * has no 2,000 cap and must not be refused.
 *
 * @returns true when the write was refused (the toast has already been shown).
 */
export async function refuseLongTextOverflow(text: string, label: string, ref?: ColumnRef): Promise<boolean> {
  // Only a column the board confirms as plain `text` is exempt. No ref, a
  // long_text column, an unknown id or a failed lookup all keep the refusal
  // (lib/shared/columnType) — losing a note silently is the worse failure.
  if (ref && !(await isCappedColumn(ref.boardId, ref.columnId))) return false;
  try {
    assertLongTextFits(text, label);
    return false;
  } catch (e) {
    toast.error(`${label} not saved`, {
      description: e instanceof Error ? e.message : String(e),
      duration: 12000,
    });
    return true;
  }
}
