import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PriorStageNotes } from "@/components/shared/PriorStageNotes";
import { appendStampedNote } from "@/lib/shared/noteStamp";
import { refuseLongTextOverflow, type ColumnRef } from "@/components/shared/longTextGuard";

interface Props {
  notes: string;
  onNotesChange: (notes: string) => void;
  onSaveToMonday?: (notes: string) => Promise<void>;
  /** Board + column this panel writes, so the 2,000-char refusal can ask the
   *  column's REAL type — a column already converted to plain text has no cap. */
  columnRef?: ColumnRef;
  /** Optional prefix inserted after timestamp, e.g. "Confirm Receipt Attempt 1" */
  notePrefix?: string;
  /** Profile intake notes (read-only) — renders a view button next to the header */
  profileSendOffNotes?: string;
  /** Called after a note is successfully appended (and saved to Monday when
   *  onSaveToMonday is provided). Used by panels that require ≥1 note before
   *  allowing a save/send. */
  onNoteAdded?: () => void;
  /** Reports the current un-added text in the "Add a note…" box. Panels use
   *  this to block save/send while typed text hasn't been added yet. */
  onPendingTextChange?: (text: string) => void;
  /** Visual variant. "default" = classic card (Confirm Receipt / Chase).
   *  "mm" = Send Request redesign white card; "mm-inline" = same but as a
   *  muted inset box (used inside the Parachute Send & Complete step).
   *  Logic is identical across variants. */
  variant?: "default" | "mm" | "mm-inline";
}

/** Bold the "<Stage> Attempt N:" label inside a note line so attempt notes
 *  stand out from regular notes. Handles both full names and legacy
 *  abbreviations (C.R. / C.C. / S.R.). */
const ATTEMPT_LABEL_REGEX =
  /^(\[[^\]]*\]\s*)((?:Confirm Receipt|Chase Clinicals|Send Request|Evaluate|C\.R\.|C\.C\.|S\.R\.)(?: Attempt \d+)?:)([\s\S]*)$/;

export function renderNoteLine(line: string): React.ReactNode {
  const m = line.match(ATTEMPT_LABEL_REGEX);
  return m ? (
    <>
      {m[1]}
      <strong className="font-bold">{m[2]}</strong>
      {m[3]}
    </>
  ) : (
    line
  );
}

export function renderNoteLines(notes: string): React.ReactNode {
  return notes.split("\n").map((line, i) => (
    <span key={i}>
      {i > 0 && "\n"}
      {renderNoteLine(line)}
    </span>
  ));
}

export function NotesPanel({ notes, onNotesChange, onSaveToMonday, columnRef, notePrefix, profileSendOffNotes, onNoteAdded, onPendingTextChange, variant = "default" }: Props) {
  const [newNote, setNewNote] = useState("");
  const setNewNoteAndReport = (v: string) => {
    setNewNote(v);
    onPendingTextChange?.(v);
  };
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Earlier-stage notes rendered read-only above the current MN notes.
  const priorStages = [{ label: "Profile Send-Off Notes", text: profileSendOffNotes }];

  const handleAppend = async () => {
    if (!newNote.trim()) return;
    const appended = appendStampedNote(notes, newNote, notePrefix);
    // Refuse BEFORE the optimistic overlay and before clearing the box —
    // Monday would accept the write, return 200 and keep only the first
    // 2000 chars, so an unguarded Add showed "Note saved to Monday" while
    // throwing the note away (components/shared/longTextGuard).
    if (await refuseLongTextOverflow(appended, "MN Workflow Notes", columnRef)) return;
    onNotesChange(appended);
    setNewNoteAndReport("");

    if (onSaveToMonday) {
      setSaving(true);
      try {
        await onSaveToMonday(appended);
        toast.success("Note saved to Monday");
        onNoteAdded?.();
      } catch (e) {
        toast.error("Failed to save note", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setSaving(false);
      }
    } else {
      onNoteAdded?.();
    }
  };

  // ── Send Request redesign variant (June 2026 mockups) ──
  if (variant === "mm" || variant === "mm-inline") {
    const noteLines = notes.split("\n").map((l) => l.trim()).filter(Boolean);
    return (
      <section
        className={
          variant === "mm"
            ? "rounded-2xl bg-card border p-5 shadow-sm"
            : "rounded-xl border bg-muted/20 px-5 py-4"
        }
        style={{ borderColor: "var(--mm-card-border)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <p
              className="text-xs uppercase tracking-wide font-bold flex items-center gap-2"
              style={{ color: "var(--mm-teal)" }}
            >
              <MessageSquare className="h-[18px] w-[18px]" /> MN Workflow Notes
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={saving}
            onClick={async () => {
              if (editing && onSaveToMonday) {
                // Over the cap → refuse and STAY in edit mode so the body can be trimmed.
                if (await refuseLongTextOverflow(notes, "MN Workflow Notes", columnRef)) return;
                setSaving(true);
                try {
                  await onSaveToMonday(notes);
                  toast.success("Notes saved to Monday");
                } catch (e) {
                  toast.error("Failed to save notes", {
                    description: e instanceof Error ? e.message : String(e),
                  });
                } finally {
                  setSaving(false);
                }
              }
              setEditing(!editing);
            }}
          >
            {editing ? (saving ? "Saving…" : "Done") : "Edit"}
          </Button>
        </div>

        <PriorStageNotes stages={priorStages} className="mt-2" />

        {editing ? (
          <Textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={6}
            className="text-sm font-mono mt-2"
            placeholder="No notes yet."
          />
        ) : noteLines.length > 0 ? (
          <div className="max-h-[220px] overflow-y-auto">
            {noteLines.map((line, i) => (
              <div key={i} className="text-sm bg-muted/40 rounded-lg px-3.5 py-2.5 mt-2 whitespace-pre-wrap">
                {renderNoteLine(line)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic mt-2">No notes yet.</p>
        )}

        <div className="flex gap-2.5 items-start mt-3">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNoteAndReport(e.target.value)}
            rows={2}
            className="text-sm flex-1 rounded-lg"
            placeholder="Add a note..."
          />
          <Button
            onClick={handleAppend}
            disabled={!newNote.trim() || saving}
            className="self-start gap-1 text-white shadow-sm bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {saving ? "Saving" : "Add"}
          </Button>
        </div>

      </section>
    );
  }

  return (
    <section className="rounded-xl bg-card border shadow-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5" /> MN Workflow Notes
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={saving}
          onClick={async () => {
            if (editing && onSaveToMonday) {
              // Over the cap → refuse and STAY in edit mode so the body can be trimmed.
              if (await refuseLongTextOverflow(notes, "MN Workflow Notes", columnRef)) return;
              setSaving(true);
              try {
                await onSaveToMonday(notes);
                toast.success("Notes saved to Monday");
              } catch (e) {
                toast.error("Failed to save notes", {
                  description: e instanceof Error ? e.message : String(e),
                });
              } finally {
                setSaving(false);
              }
            }
            setEditing(!editing);
          }}
        >
          {editing ? (saving ? "Saving…" : "Done") : "Edit"}
        </Button>
      </div>

      <PriorStageNotes stages={priorStages} />

      {/* Existing notes display / edit */}
      {editing ? (
        <Textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={6}
          className="text-sm font-mono"
          placeholder="No notes yet."
        />
      ) : (
        <div className="bg-muted/50 rounded-md p-3 min-h-[60px] max-h-[200px] overflow-y-auto">
          {notes ? (
            <pre className="text-sm whitespace-pre-wrap font-sans text-foreground">{renderNoteLines(notes)}</pre>
          ) : (
            <p className="text-sm text-muted-foreground italic">No notes yet.</p>
          )}
        </div>
      )}

      {/* Append new note */}
      <div className="flex gap-2">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNoteAndReport(e.target.value)}
          rows={2}
          className="text-sm flex-1"
          placeholder="Add a note…"
        />
        <Button
          onClick={handleAppend}
          disabled={!newNote.trim() || saving}
          size="sm"
          className="self-end gap-1"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {saving ? "Saving" : "Add"}
        </Button>
      </div>
    </section>
  );
}
