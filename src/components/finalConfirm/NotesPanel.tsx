import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PriorStageNotes } from "@/components/shared/PriorStageNotes";
import { appendStampedNote } from "@/lib/shared/noteStamp";
import { refuseLongTextOverflow } from "@/components/shared/longTextGuard";

interface Props {
  notes: string;
  onNotesChange: (notes: string) => void;
  onSaveToMonday?: (notes: string) => Promise<void>;
  /** Read-only notes carried from earlier stages, shown above the current notes
   *  in pipeline order (Profile Send-Off → Medical Necessity → Insurance). */
  profileSendOffNotes?: string;
  mnWorkflowNotes?: string;
  insuranceNotes?: string;
  /** Stage label stamped into each appended note (see lib/shared/noteStamp). */
  notePrefix?: string;
}

export function NotesPanel({ notes, onNotesChange, onSaveToMonday, profileSendOffNotes, mnWorkflowNotes, insuranceNotes, notePrefix }: Props) {
  const priorStages = [
    { label: "Profile Send-Off Notes", text: profileSendOffNotes },
    { label: "MN Workflow Notes", text: mnWorkflowNotes },
    { label: "Insurance Notes", text: insuranceNotes },
  ];
  const [newNote, setNewNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAppend = async () => {
    if (!newNote.trim()) return;
    const appended = appendStampedNote(notes, newNote, notePrefix);
    // Refuse BEFORE the optimistic overlay and before clearing the box —
    // Monday would accept the write, return 200 and keep only the first
    // 2000 chars, so an unguarded Add showed "Note saved to Monday" while
    // throwing the note away (components/shared/longTextGuard).
    if (refuseLongTextOverflow(appended, "Notes")) return;
    onNotesChange(appended);
    setNewNote("");

    if (onSaveToMonday) {
      setSaving(true);
      try {
        await onSaveToMonday(appended);
        toast.success("Note saved to Monday");
      } catch (e) {
        toast.error("Failed to save note", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5" /> Notes
        </p>
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
            <pre className="text-sm whitespace-pre-wrap font-sans text-foreground">{notes}</pre>
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
    </Card>
  );
}
