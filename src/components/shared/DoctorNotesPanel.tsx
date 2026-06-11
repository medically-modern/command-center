import { useState, useEffect, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Stethoscope, Plus, Loader2, RefreshCw, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { findDoctorByNpi, saveDoctorNotes, type DoctorRecord } from "@/lib/shared/doctorDb";

interface Props {
  /** The doctor NPI from the current patient — used to look up the Doctor Database record. */
  doctorNpi: string;
  /** Optional: doctor name shown in the header when we can't find a DB match. */
  doctorName?: string;
  /** Compact mode — smaller text, less padding (for use inside collapsible panels). */
  compact?: boolean;
  /** Flush mode — no card border/background; header styled like the
   *  surrounding field labels so the panel blends into a details grid.
   *  Functionality is identical. */
  flush?: boolean;
  /** Start expanded so the notes are directly viewable. */
  defaultOpen?: boolean;
}

export function DoctorNotesPanel({ doctorNpi, doctorName, compact = false, flush = false, defaultOpen = false }: Props) {
  const [doctor, setDoctor] = useState<DoctorRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [fetchError, setFetchError] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const lastNpi = useRef("");
  const retryCount = useRef(0);

  const fetchDoctor = useCallback(async (npi: string, retry = 0) => {
    if (!npi?.trim()) { setDoctor(null); setFetchError(false); return; }
    setLoading(true);
    setFetchError(false);
    try {
      const rec = await findDoctorByNpi(npi);
      setDoctor(rec);
      if (rec) setEditText(rec.notes);
      retryCount.current = 0;
    } catch (e) {
      console.error("Doctor DB lookup failed", e);
      // Retry up to 2 times with increasing delay (rate-limit recovery)
      if (retry < 2) {
        retryCount.current = retry + 1;
        setTimeout(() => fetchDoctor(npi, retry + 1), (retry + 1) * 2000);
        return; // stay in loading state
      }
      setDoctor(null);
      setFetchError(true);
    } finally {
      if (retry >= 2 || retryCount.current === 0) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (doctorNpi === lastNpi.current) return;
    // Debounced: on pages where the NPI is being typed into a form (e.g.
    // Profile Checklist), don't fire a Doctor DB lookup per keystroke.
    const t = setTimeout(() => {
      lastNpi.current = doctorNpi;
      retryCount.current = 0;
      setEditing(false);
      setNewNote("");
      fetchDoctor(doctorNpi);
    }, 500);
    return () => clearTimeout(t);
  }, [doctorNpi, fetchDoctor]);

  // No NPI yet (common at the Profile/intake stage): keep the panel visible
  // with a hint instead of hiding the capability entirely. It activates as
  // soon as an NPI is entered.
  if (!doctorNpi?.trim()) {
    if (flush) {
      // Grid-cell style — matches the HVal fields around it.
      return (
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Doctor Notes
          </p>
          <p
            className="mt-0.5 text-lg font-semibold truncate text-muted-foreground/50"
            title="Enter the doctor's NPI to view or add doctor notes."
          >
            —
          </p>
        </div>
      );
    }
    return (
      <div className={`border rounded-lg ${compact ? "p-3" : "p-4"} space-y-1 bg-card`}>
        <p className={`${compact ? "text-xs" : "text-sm"} font-semibold text-emerald-700 flex items-center gap-1.5`}>
          <Stethoscope className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0`} />
          Doctor Notes
        </p>
        <p className="text-xs text-muted-foreground italic">
          Enter the doctor's NPI to view or add doctor notes.
        </p>
      </div>
    );
  }

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

  // Collapsed flush mode renders as a plain grid cell — identical styling to
  // the HVal fields around it (uppercase label, value underneath). Clicking
  // anywhere in the cell expands into the full notes editor.
  if (flush && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Click to view or add doctor notes"
        className="block w-full min-w-0 text-left group"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground group-hover:text-foreground transition-colors">
          Doctor Notes
        </p>
        {loading ? (
          <p className="mt-0.5 text-sm text-muted-foreground">Loading…</p>
        ) : doctor?.notes ? (
          <p className="mt-0.5 text-sm font-medium text-foreground whitespace-pre-wrap [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical] overflow-hidden">
            {doctor.notes}
          </p>
        ) : (
          <p className="mt-0.5 text-lg font-semibold truncate text-muted-foreground/50">—</p>
        )}
      </button>
    );
  }

  // Flush mode sits next to the Doctor field, so the name would be redundant.
  const headerLabel = flush
    ? "Doctor Notes"
    : doctor
      ? `Doctor Notes — ${doctor.name}`
      : doctorName
        ? `Doctor Notes — ${doctorName}`
        : "Doctor Notes";

  return (
    <div
      className={
        flush
          ? "space-y-2"
          : `border rounded-lg ${compact ? "p-3" : "p-4"} space-y-2 bg-card`
      }
    >
      {/* Header (click to expand/collapse) */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={
            flush
              ? "text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 truncate min-w-0 hover:text-foreground transition-colors"
              : `${compact ? "text-xs" : "text-sm"} font-semibold text-emerald-700 flex items-center gap-1.5 truncate min-w-0 hover:opacity-80 transition-opacity`
          }
          title={open ? "Collapse doctor notes" : "Expand doctor notes"}
        >
          <ChevronRight
            className={`${compact || flush ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <Stethoscope className={`${compact || flush ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0`} />
          <span className="truncate">{headerLabel}</span>
          {!open && doctor?.notes && (
            <span className="ml-1 shrink-0 rounded-full bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0.5 font-medium">
              notes
            </span>
          )}
        </button>
        {open && (
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
        )}
      </div>

      {/* Loading state */}
      {open && loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Looking up doctor…
        </div>
      )}

      {/* No match or error */}
      {open && !loading && !doctor && (
        fetchError ? (
          <div className="flex items-center gap-2 py-1">
            <p className="text-xs text-amber-600 italic">
              Failed to look up NPI {doctorNpi} — Monday may be busy.
            </p>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => fetchDoctor(doctorNpi)}>
              Retry
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic py-1">
            No doctor found in database for NPI {doctorNpi}.
          </p>
        )
      )}

      {/* Notes display / edit */}
      {open && !loading && doctor && (
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
