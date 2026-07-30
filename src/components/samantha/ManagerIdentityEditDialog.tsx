/**
 * ManagerIdentityEditDialog — the ONLY place in the app where Serving, Primary
 * / Secondary Insurance or the Member IDs can be edited from an Insurance role
 * page, and only for a manager who arrived from an oversight escalation column.
 *
 * The rep-facing header stays read-only by design (those five facts are
 * finalized at Profile Send-Off). But most escalations ARE one of those five
 * being wrong — "coverage came back inactive" is usually the wrong payer, not
 * no payer — so the manager reviewing the escalation needs to fix it without
 * leaving for Monday. See `lib/samantha/managerIdentityEdit` for the rationale
 * and the product-set caveat this dialog surfaces.
 *
 * Dropdowns are built from the LIVE board labels, not from the app's hardcoded
 * option lists: those exist to parse machine-written values and have drifted
 * (the board spells index 3 "Magnacare"; "Fidelis CHP" isn't in the list at
 * all). Writing a drifted label would make Monday create a duplicate label —
 * CLAUDE.md §9 — so the picker and the write both key off the board's own
 * index/label pairs.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, PencilLine, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Patient } from "@/lib/samantha/workflow";
import { fetchStatusOptions, type StatusOption } from "@/lib/samantha/mondayApi";
import { saveManagerIdentityEdits } from "@/lib/samantha/mondayWrite";
import {
  diffIdentity,
  identityDraftFrom,
  productImpact,
  IDENTITY_FIELD_LABELS,
  IDENTITY_STATUS_COLUMNS,
  type IdentityDraft,
  type IdentityStatusFieldId,
} from "@/lib/samantha/managerIdentityEdit";

const STATUS_FIELDS: IdentityStatusFieldId[] = [
  "serving",
  "primaryInsurance",
  "secondaryInsurance",
];

const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function ManagerIdentityEditDialog({
  patient,
  stage,
  onSaved,
}: {
  patient: Patient;
  /** Stage label for the note stamp — "Benefits" / "Submit Auth" / … */
  stage: string;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IdentityDraft>(() => identityDraftFrom(patient));
  const [options, setOptions] = useState<Record<string, StatusOption[]>>({});
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch the board's label sets once per open (cached per session in
  // fetchStatusOptions) and re-seed the draft from whatever the poll last
  // brought in, so reopening never shows a stale form.
  useEffect(() => {
    if (!open) return;
    setDraft(identityDraftFrom(patient));
    setLoadingOptions(true);
    setOptionsError(null);
    let cancelled = false;
    fetchStatusOptions(Object.values(IDENTITY_STATUS_COLUMNS))
      .then((o) => { if (!cancelled) setOptions(o); })
      .catch((e) => { if (!cancelled) setOptionsError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoadingOptions(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient.id]);

  const changes = diffIdentity(patient, draft);
  const impact = productImpact(patient, draft);

  const save = async () => {
    setSaving(true);
    try {
      const written = await saveManagerIdentityEdits(patient, draft, options, stage);
      toast.success(
        written.length === 1
          ? `${written[0].label} updated on Monday`
          : `${written.length} fields updated on Monday`,
      );
      setOpen(false);
      onSaved?.();
    } catch (e) {
      toast.error("Update failed — nothing was changed on Monday", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--bnr-border)] px-2.5 py-1 text-xs font-semibold text-[var(--mm-teal)] hover:bg-black/[.04] dark:hover:bg-white/[.06] transition-colors"
      >
        <PencilLine size={13} /> Edit insurance
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : setOpen(false))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PencilLine className="h-5 w-5 text-teal-600" />
              Correct insurance details
            </DialogTitle>
            <DialogDescription>
              Manager view only. Saving writes straight to Monday and records who changed
              what in the Reference Notes — it does not move the patient's stage.
            </DialogDescription>
          </DialogHeader>

          {optionsError && (
            <p className="text-sm text-red-600">
              Couldn't load the board's options: {optionsError}
            </p>
          )}

          <div className="space-y-3 pt-1">
            {STATUS_FIELDS.map((field) => {
              const colId = IDENTITY_STATUS_COLUMNS[field];
              const opts = options[colId] ?? [];
              const current = draft[field];
              const knownValue = opts.some((o) => o.label === current);
              return (
                <div key={field}>
                  <label className="block text-sm font-medium mb-1" htmlFor={`mie-${field}`}>
                    {IDENTITY_FIELD_LABELS[field]}
                  </label>
                  <select
                    id={`mie-${field}`}
                    className={selectClass}
                    value={current}
                    disabled={loadingOptions || saving || opts.length === 0}
                    onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                  >
                    {/* The patient's current value when the board no longer offers
                        it (blank, or a label this app can't parse) — selectable so
                        the form opens on the truth, but never a target. */}
                    {!knownValue && (
                      <option value={current}>{current || "— not set —"}</option>
                    )}
                    {opts.map((o) => (
                      <option key={o.index} value={o.label}>{o.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}

            <div className="grid grid-cols-2 gap-3">
              {(["memberId1", "memberId2"] as const).map((field) => (
                <div key={field}>
                  <label className="block text-sm font-medium mb-1" htmlFor={`mie-${field}`}>
                    {IDENTITY_FIELD_LABELS[field]}
                  </label>
                  <input
                    id={`mie-${field}`}
                    className={selectClass}
                    value={draft[field]}
                    disabled={saving}
                    onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                  />
                </div>
              ))}
            </div>

            {impact && (
              <div className="rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs">
                <p className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400 mb-1">
                  <TriangleAlert size={13} /> This changes which products are in play
                </p>
                {impact.removed.length > 0 && (
                  <p className="text-amber-800 dark:text-amber-300">
                    No longer served: <b>{impact.removed.join(", ")}</b> — any answers already
                    recorded for these stay on the board but stop showing here.
                  </p>
                )}
                {impact.added.length > 0 && (
                  <p className="text-amber-800 dark:text-amber-300">
                    Now served: <b>{impact.added.join(", ")}</b> — these will need answers.
                  </p>
                )}
              </div>
            )}

            {changes.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {changes.map((c) => (
                  <li key={c.field}>
                    <b className="text-foreground">{c.label}</b>: {c.from || "(blank)"} → {c.to || "(blank)"}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={save}
                disabled={saving || loadingOptions || changes.length === 0}
                className="gap-2 bg-teal-600 hover:bg-teal-700 text-white"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {changes.length > 0 ? `Save ${changes.length} change${changes.length > 1 ? "s" : ""}` : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
