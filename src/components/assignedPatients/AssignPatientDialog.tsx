/**
 * Manager control: assign a patient to a rep.
 *
 * Deliberately PATIENT-first, not number-first. The assignment store keys on a
 * hash of the phone number but also records the Monday item id, and that id is
 * what every name on screen is resolved from — so the assignment has to be made
 * against a real patient record, not a number typed from memory.
 *
 * When opened from an unassigned conversation the number is already known, so
 * the search is there to identify WHO it belongs to.
 */
import { useEffect, useState } from "react";
import { Loader2, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { assignPatient } from "@/lib/assignedPatients/assignmentsApi";
import { searchPatientsByName, type PatientRef } from "@/lib/assignedPatients/patientLookup";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onAssigned: () => void;
  /** Rep emails that can receive an assignment, with display names. */
  reps: Array<{ email: string; name: string }>;
  /** Pre-selected rep (the manager was looking at their queue). */
  defaultRep?: string;
  /** Known number, when assigning from an unassigned conversation. */
  presetPhone?: string;
}

export default function AssignPatientDialog({ open, onClose, onAssigned, reps, defaultRep, presetPhone }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRef[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<PatientRef | null>(null);
  const [rep, setRep] = useState(defaultRep || reps[0]?.email || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setPicked(null);
    setRep(defaultRep || reps[0]?.email || "");
  }, [open, defaultRep, reps]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setSearching(true);
    // Debounced: the search fans out across every pipeline board, so typing
    // must not fire one of those per keystroke.
    const id = setTimeout(async () => {
      try {
        const r = await searchPatientsByName(q);
        if (alive) setResults(r);
      } catch (e) {
        if (alive) toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setSearching(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query, open]);

  if (!open) return null;

  // The number we assign: the patient's own, unless we came from a specific
  // conversation — then that conversation's number is the one that must route.
  const phoneToAssign = presetPhone || picked?.phone || "";
  const canSave = !!picked && !!rep && !!phoneToAssign && !saving;

  const save = async () => {
    if (!canSave || !picked) return;
    setSaving(true);
    try {
      await assignPatient({
        phone: phoneToAssign,
        repEmail: rep,
        mondayItemId: picked.itemId,
        mondayBoardId: picked.boardId || undefined,
      });
      toast.success(`${picked.name} assigned to ${reps.find((r) => r.email === rep)?.name || rep}`);
      onAssigned();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl bg-card border border-border shadow-xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <UserPlus className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Assign a patient</h2>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto min-h-0">
          {presetPhone && (
            <p className="text-xs text-muted-foreground">
              Assigning the conversation with <b className="text-foreground">{fmtPhone(presetPhone)}</b>. Find the
              patient it belongs to.
            </p>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Patient</label>
            <div className="relative mt-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPicked(null);
                }}
                placeholder="Search by name…"
                className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              {searching && (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {results.length > 0 && (
            <div className="border border-border rounded-lg divide-y max-h-56 overflow-y-auto">
              {results.map((p) => (
                <button
                  key={p.itemId}
                  onClick={() => setPicked(p)}
                  className={cn(
                    "w-full text-left px-3 py-2 hover:bg-muted/50",
                    picked?.itemId === p.itemId && "bg-muted",
                  )}
                >
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {p.phone ? fmtPhone(p.phone) : "no phone on record"} · {p.boardName}
                  </p>
                </button>
              ))}
            </div>
          )}

          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="text-xs text-muted-foreground">No patients matched.</p>
          )}

          {picked && !presetPhone && !picked.phone && (
            <p className="text-xs text-destructive">
              {picked.name} has no phone number on their Monday record, so there's nothing to route. Add one on the
              board first.
            </p>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Assign to</label>
            <select
              value={rep}
              onChange={(e) => setRep(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              {reps.map((r) => (
                <option key={r.email} value={r.email}>
                  {r.name} ({r.email})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
