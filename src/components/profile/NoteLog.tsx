import { appendStampedNote } from "@/lib/shared/noteStamp";

/** Stage label stamped into each appended note. */
export const NOTE_STAGE = "Profile Send-Off";

/**
 * Append a new note to an existing log the way every other role does:
 * "[Mon D, YYYY, H:MM AM] Profile Send-Off: <text> —<initials>", separated
 * from prior entries by a blank line. Format lives in lib/shared/noteStamp.
 */
export function stampNote(existing: string, draft: string): string {
  return appendStampedNote(existing, draft, NOTE_STAGE);
}

/** Render a note log, bolding each entry's "[date time] Stage:" prefix. */
export function NoteLog({ text }: { text: string }) {
  const entries = text.split(/\n\n+/).map((e) => e.trim()).filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entries.map((e, i) => {
        // Bold only the stage label ("Profile Send-Off:"), not the timestamp.
        const m = e.match(/^(\[[^\]]*\])\s*([^:]*:)\s*([\s\S]*)$/);
        return (
          <div key={i} className="note-entry" style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
            {m ? <>{m[1]} <b style={{ color: "var(--mm-teal)" }}>{m[2]}</b> {m[3]}</> : e}
          </div>
        );
      })}
    </div>
  );
}
