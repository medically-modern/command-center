/**
 * Shared note stamping — ONE format for every role's append-only note log:
 *
 *     [Jul 28, 2026, 2:33 PM] Benefits: payer confirmed active —JH
 *
 * Three parts, all load-bearing:
 * - **ET timestamp** — Monday's clock is ET and timezone-naive (CLAUDE.md §9),
 *   so notes are stamped in ET too, never the browser's local zone.
 * - **Stage label** — says WHICH role wrote the line. This matters most in the
 *   Insurance workflow, where Benefits / Submit Auth / Auth Outstanding / DVS
 *   all append to the SAME column (Call Reference Notes `text_mm6vzc7q`):
 *   without the label a line can't be traced back to the stage that wrote it.
 *   Welcome Call / Final Confirm / Subscription notes are also hop-copied
 *   forward, so the label survives as provenance on the next board.
 * - **Initials** — says WHO wrote it (from the signed-in Google name).
 *
 * Both label and initials are omitted rather than rendered empty (signed-out
 * session, or a caller with no stage), so a line never ends in a bare "—".
 *
 * Every role's NotesPanel composes through here so the formats can't drift
 * apart — masheke's `ATTEMPT_LABEL_REGEX` and profile's `NoteLog` renderer
 * both bold the "<Stage>:" label and rely on this exact shape.
 */
import { etNow } from "@/lib/masheke/etDate";
import { userInitials } from "@/lib/shared/auth";

/** "Jul 28, 2026, 2:33 PM" — ET, matching every existing note log. */
export function noteTimestamp(now: Date = etNow()): string {
  return now.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compose one stamped line. `initials`/`now` are injectable for tests. */
export function stampNoteEntry(
  text: string,
  stage?: string,
  opts?: { initials?: string; now?: Date },
): string {
  const prefix = stage ? `${stage}: ` : "";
  const ini = opts?.initials ?? userInitials();
  const suffix = ini ? ` —${ini}` : "";
  return `[${noteTimestamp(opts?.now)}] ${prefix}${text.trim()}${suffix}`;
}

/** Append an entry to an existing log, blank-line separated, history intact. */
export function appendNoteEntry(existing: string | undefined, entry: string): string {
  const base = (existing ?? "").trimEnd();
  return base ? `${base}\n\n${entry}` : entry;
}

/** Stamp + append in one call — what every NotesPanel's "Add" button uses. */
export function appendStampedNote(
  existing: string | undefined,
  text: string,
  stage?: string,
  opts?: { initials?: string; now?: Date },
): string {
  return appendNoteEntry(existing, stampNoteEntry(text, stage, opts));
}
