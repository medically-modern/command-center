import { etNow } from "@/lib/masheke/etDate";
import { userInitials } from "@/lib/shared/auth";

/** Stage label stamped into each appended note. */
export const NOTE_STAGE = "Profile Send-Off";

/**
 * Append a new note to an existing log the way the Evaluate role does:
 * "[Mon D, YYYY, H:MM AM] Profile Send-Off: <text> —<initials>", separated
 * from prior entries by a blank line.
 */
export function stampNote(existing: string, draft: string): string {
  const ts = etNow().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const inits = userInitials();
  const entry = `[${ts}] ${NOTE_STAGE}: ${draft.trim()}${inits ? ` —${inits}` : ""}`;
  return existing ? `${existing}\n\n${entry}` : entry;
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
