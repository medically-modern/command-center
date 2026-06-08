import { useState, useEffect, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Stethoscope, Plus, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { findDoctorByNpi, saveDoctorNotes, type DoctorRecord } from "@/lib/shared/doctorDb";

interface Props {
  /** The doctor NPI from the current patient — used to look up the Doctor Database record. */
  doctorNpi: string;
  /** Optional: doctor name shown in the header when we can't find a DB match. */
  doctorName?: string;
  /** Compact mode — smaller text, less padding (for use inside collapsible panels). */
  compact?: boolean;
}

export function DoctorNotesPanel({ doctorNpi, doctorName, compact = false }: Props) {
  const [doctor, setDoctor] = useState<DoctorRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const lastNpi = useRef("");

  const fetchDoctor = useCallback(async (npi: string) => {
    if (!npi?.trim()) { setDoctor(null); return; }
    setLoading(true);
    try {
      const rec = await findDoctorByNpi(npi);
      setDoctor(rec);
      if (rec) setEditText(rec.notes);
    } catch (e) {
      console.error("Doctor DB lookup failed", e);
      setDoctor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (doctorNpi !== lastNpi.current) {
      lastNpi.current = doctorNpi;
      setEditing(false);
      setNewNote("");
      fetchDoctor(doctorNpi);
    }
  }, [doctorNpi, fetchDoctor]);

  if (!doctorNpi?.trim()) return null;

  const handleAppend = async () => {
    if (!newNote.trim() || !doctor) return;
    const timestamp = new Date().toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
    const appended = doctor.notes
      ? `${doctor.notes}\n\n[${timestamp}] ${newNote.trim()}`
      : `[${timestamp}] ${newNote.trim()}`;

    setSaving(true);
    try {
      await saveDoctorNotes(doctor.itemId, appended);
      setDoctor({ ...doctor, notes: appended });
      setEditText(appended);
      setNewNote("");
      toast.success("Doctor note saved");
    } catch (e) {
      toast.error("Failed to save doctor note", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async () => {
    if (!doctor) return;
    setSaving(true);
    try {
      await saveDoctorNotes(doctor.itemId, editText);
      setDoctor({ ...doctor, notes: editText });
      setEditing(false);
      toast.success("Doctor notes updated");
    } catch (e) {
      toast.error("Failed to update doctor notes", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const headerLabel = doctor
    ? `Doctor Notes — ${doctor.name}`
    : doctorName
      ? `Doctor Notes — ${doctorName}`
      : "Doctor Notes";

  return (
    <div className={`border rounded-lg ${compact ? "p-3" : "p-4"} space-y-2 bg-card`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className={`${compact ? "text-xs" : "text-sm"} font-semibold text-emerald-700 flex items-center gap-1.5 truncate`}>
          <Stethoscope className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {headerLabel}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => fetchDoctor(doctorNpi)}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {doctor && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={saving}
              onClick={() => {
                if (editing) {
                  handleEditSave();
                } else {
                  setEditText(doctor.notes);
                  setEditing(true);
                }
              }}
            >
              {editing ? (saving ? "Saving…" : "Done") : "Edit"}
            </Button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Looking up doctor…
        </div>
      )}

      {/* No match */}
      {!loading && !doctor && (
        <p className="text-xs text-muted-foreground italic py-1">
          No doctor found in database for NPI {doctorNpi}.
        </p>
      )}

      {/* Notes display / edit */}
      {!loading && doctor && (
        <>
          {editing ? (
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={compact ? 4 : 5}
              className="text-xs font-mono"
              placeholder="No doctor notes yet."
            />
          ) : (
            <div className="bg-muted/50 rounded-md p-2.5 min-h-[40px] max-h-[160px] overflow-y-auto">
              {doctor.notes ? (
                <pre className="text-xs whitespace-pre-wrap font-sans text-foreground">{doctor.notes}</pre>
              ) : (
                <p className="text-xs text-muted-foreground italic">No doctor notes yet.</p>
              )}
            </div>
          )}

          {/* Append new note */}
          {!editing && (
            <div className="flex gap-2">
              <Textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={2}
                className="text-xs flex-1"
                placeholder="Add a doctor note…"
              />
              <Button
                onClick={handleAppend}
                disabled={!newNote.trim() || saving}
                size="sm"
                className="self-end gap-1"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                {saving ? "…" : "Add"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
