import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Plus, Loader2, FileText, X } from "lucide-react";
import { toast } from "sonner";
import { etNow } from "@/lib/masheke/etDate";

interface Props {
  notes: string;
  onNotesChange: (notes: string) => void;
  onSaveToMonday?: (notes: string) => Promise<void>;
  /** Optional prefix inserted after timestamp, e.g. "Confirm Receipt Attempt 1" */
  notePrefix?: string;
  /** Profile intake notes (read-only) — renders a view button next to the header */
  profileSendOffNotes?: string;
  /** Called after a note is successfully appended (and saved to Monday when
   *  onSaveToMonday is provided). Used by panels that require ≥1 note before
   *  allowing a save/send. */
  onNoteAdded?: () => void;
}

/** Bold the "<Stage> Attempt N:" label inside a note line so attempt notes
 *  stand out from regular notes. Handles both full names and legacy
 *  abbreviations (C.R. / C.C. / S.R.). */
const ATTEMPT_LABEL_REGEX =
  /^(\[[^\]]*\]\s*)((?:Confirm Receipt|Chase Clinicals|Send Request|C\.R\.|C\.C\.|S\.R\.) Attempt \d+:)([\s\S]*)$/;

function renderNoteLines(notes: string): React.ReactNode {
  return notes.split("\n").map((line, i) => {
    const m = line.match(ATTEMPT_LABEL_REGEX);
    return (
      <span key={i}>
        {i > 0 && "\n"}
        {m ? (
          <>
            {m[1]}
            <strong className="font-bold">{m[2]}</strong>
            {m[3]}
          </>
        ) : (
          line
        )}
      </span>
    );
  });
}

export function NotesPanel({ notes, onNotesChange, onSaveToMonday, notePrefix, profileSendOffNotes, onNoteAdded }: Props) {
  const [newNote, setNewNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [intakeNotesOpen, setIntakeNotesOpen] = useState(false);

  const handleAppend = async () => {
    if (!newNote.trim()) return;
    const timestamp = etNow().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const prefix = notePrefix ? `${notePrefix}: ` : "";
    const appended = notes
      ? `${notes}\n\n[${timestamp}] ${prefix}${newNote.trim()}`
      : `[${timestamp}] ${prefix}${newNote.trim()}`;
    onNotesChange(appended);
    setNewNote("");

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

  return (
    <section className="rounded-xl bg-card border shadow-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5" /> MN Workflow Notes
          </p>
          {profileSendOffNotes !== undefined && (
            <button
              onClick={() => setIntakeNotesOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              Profile Intake Notes
            </button>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={saving}
          onClick={async () => {
            if (editing && onSaveToMonday) {
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
          onChange={(e) => setNewNote(e.target.value)}
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

      {/* Profile Intake Notes Modal */}
      {intakeNotesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIntakeNotesOpen(false)} />
          <div className="relative bg-card border rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-sm">Profile Intake Notes</h3>
              <button
                onClick={() => setIntakeNotesOpen(false)}
                className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {profileSendOffNotes ? (
                <p className="text-sm whitespace-pre-wrap">{profileSendOffNotes}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">No intake notes recorded.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
