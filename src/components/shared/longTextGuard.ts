import { toast } from "sonner";
import { assertLongTextFits } from "@/lib/shared/longText";

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
 * @returns true when the write was refused (the toast has already been shown).
 */
export function refuseLongTextOverflow(text: string, label: string): boolean {
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
