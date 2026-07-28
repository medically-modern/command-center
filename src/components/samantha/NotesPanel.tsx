import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PriorStageNotes } from "@/components/shared/PriorStageNotes";
import { appendStampedNote } from "@/lib/shared/noteStamp";

interface Props {
  notes: string;
  onNotesChange: (notes: string) => void;
  onSaveToMonday?: (notes: string) => Promise<void>;
  placeholder?: string;
  description?: string;
  /** Stage label stamped into each appended note ("Benefits", "Submit Auth",
   *  "Auth Outstanding", "DVS"). All four Insurance roles append to the SAME
   *  Call Reference Notes column, so without it a line can't be traced back
   *  to the stage that wrote it. */
  notePrefix?: string;
  /** Earlier-stage notes shown read-only above the current Reference Notes. */
  profileSendOffNotes?: string;
  mnWorkflowNotes?: string;
  /** Stretch the panel to fill its container's height, letting the notes
   *  display grow instead of capping at 200px (Benefits notes rail). */
  fillHeight?: boolean;
}

export function NotesPanel({ notes, onNotesChange, onSaveToMonday, placeholder, description, notePrefix, profileSendOffNotes, mnWorkflowNotes, fillHeight }: Props) {
  // Earlier pipeline stages, oldest first, rendered read-only above the
  // current (editable) insurance Reference Notes.
  const priorStages = [
    { label: "Profile Send-Off Notes", text: profileSendOffNotes },
    { label: "MN Workflow Notes", text: mnWorkflowNotes },
  ];
  const [newNote, setNewNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAppend = async () => {
    if (!newNote.trim()) return;
    const appended = appendStampedNote(notes, newNote, notePrefix);
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

  const header = (
    <div className="flex items-center justify-between shrink-0">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5" /> Reference Notes
        </h3>
        {description && (
          <p className="text-[11px] text-muted-foreground">{description}</p>
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
  );

  // Prior-stage notes + the current notes. In fillHeight these scroll together
  // (below) so the append box stays pinned; here they're just the content.
  const notesBody = (
    <>
      <PriorStageNotes stages={priorStages} />
      {editing ? (
        <Textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={6}
          className="text-sm font-mono bg-background"
          placeholder="No notes yet."
        />
      ) : (
        <div
          className={`bg-background rounded-md p-3 min-h-[60px] overflow-y-auto border${fillHeight ? "" : " max-h-[200px]"}`}
        >
          {notes ? (
            <pre className="text-sm whitespace-pre-wrap font-sans text-foreground">{notes}</pre>
          ) : (
            <p className="text-sm text-muted-foreground italic">No notes yet.</p>
          )}
        </div>
      )}
    </>
  );

  const appendBox = (
    <div className="flex gap-2 shrink-0">
      <Textarea
        value={newNote}
        onChange={(e) => setNewNote(e.target.value)}
        rows={2}
        className="text-sm flex-1 bg-background"
        placeholder={placeholder || "Add a note…"}
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
  );

  return (
    <div className={`rounded-lg border bg-muted/20 p-4${fillHeight ? " h-full flex flex-col gap-3" : " space-y-3"}`}>
      {header}
      {/* fillHeight (Benefits rail): notes scroll in a flex-1 region so the
          append box below stays pinned + visible on page load, instead of long
          upstream notes pushing it past the bottom of the viewport. */}
      {fillHeight ? (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">{notesBody}</div>
      ) : (
        notesBody
      )}
      {appendBox}
    </div>
  );
}
