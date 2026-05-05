import { useEffect, useMemo, useState, useCallback, useRef, type DragEvent } from "react";
import type { Patient } from "@/lib/mesheke/workflow";
import { StatusSelect } from "./StatusSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { NotesPanel } from "@/components/mesheke/NotesPanel";
import {
  VALID_INVALID_OPTS,
  YES_NO_OPTS,
  CGM_COVERAGE_OPTS,
  LMN_OPTS,
  IP_PATH_OPTS,
  DIAGNOSIS_FAVORITES,
  DIAGNOSIS_OTHER,
} from "@/lib/mesheke/fieldOptions";
import {
  IP_PATH_FIELDS,
  shouldShowCgmBlock,
  shouldShowIpBlock,
  defaultIpPath,
  type IpPath,
} from "@/lib/mesheke/ipPaths";
import {
  loadEvalState,
  saveEvalState,
  seedEvalStateFromPatient,
  isOowDateValid,
  getMrExpiry,
  deriveValidity,
  buildMondayPreview,
  type EvalState,
  type LocalFile,
  type CgmCoveragePath,
  type LmnStatus,
  type ValidInvalid,
  type YesNo,
} from "@/lib/mesheke/evalState";
import { useMondayFiles } from "@/hooks/mesheke/useMondayFiles";
import {
  COL,
  clearStatusColumn,
  deleteFileFromColumn,
  deleteSingleFileFromColumn,
  hasToken,
  writeDate,
  writeDropdownLabels,
  writeLongText,
  writeStatusIndex,
  writeStatusLabel,
  type MondayFileEntry,
} from "@/lib/mesheke/mondayApi";
import { GEN_SCRIPT_STATUS } from "@/lib/mesheke/mondayMapping";
import { toast } from "sonner";
import {
  Check,
  X,
  CircleDashed,
  Upload,
  FileText,
  Trash2,
  ChevronsUpDown,
  AlertTriangle,
  Download,
  ExternalLink,
  Loader2,
  Send,
} from "lucide-react";

interface Props {
  patient: Patient;
  /** Bumped by parent when Reset is pressed — forces local state to reload. */
  resetVersion?: number;
  onUpdate: (patch: Partial<Patient>) => void;
}

// Compute "today + N months" — used for MR Expiry Date
function plusMonths(iso: string, months: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function EvaluatePanel({ patient, resetVersion = 0, onUpdate }: Props) {
  const [state, setState] = useState<EvalState>(() => {
    const stored = loadEvalState(patient.id);
    return Object.keys(stored).length > 0 ? stored : seedEvalStateFromPatient(patient);
  });

  // Reload state when patient changes OR when parent triggers a Reset.
  useEffect(() => {
    const stored = loadEvalState(patient.id);
    if (Object.keys(stored).length > 0) setState(stored);
    else setState(seedEvalStateFromPatient(patient));
    // Re-run when patient.id changes or resetVersion bumps. We intentionally
    // don't depend on `patient` (the whole object) since useMondayPatients
    // creates a new reference on every poll which would re-seed unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, resetVersion]);

  // Persist on every change
  useEffect(() => {
    saveEvalState(patient.id, state);
  }, [patient.id, state]);

  const showCgm = shouldShowCgmBlock(patient.serving);
  const showIp = shouldShowIpBlock(patient.serving);

  // Pre-fill IP coverage path from Serving on initial load if nothing is set
  // yet. Once the rep picks a path we leave it alone — this used to clobber
  // every edit when Serving was "Supplies Only" / "Supplies + CGM".
  useEffect(() => {
    const def = defaultIpPath(patient.serving);
    if (def && state.ipCoveragePath === undefined) {
      setState((s) => ({ ...s, ipCoveragePath: def }));
    }
  }, [patient.serving, state.ipCoveragePath]);

  const update = useCallback(<K extends keyof EvalState>(key: K, value: EvalState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  // Poll Monday's file columns every 2s while a Generate is in flight. Silent
  // (no loading flicker) after the initial fetch. Declared early so the
  // auto-clear effects below can reference mondayFiles.generateCgmStatus etc.
  const isGenerating =
    state.generateCgmScript === "Generate" || state.generateIpScript === "Generate";
  const mondayFiles = useMondayFiles(patient.id, {
    pollingIntervalMs: isGenerating ? 2000 : 0,
  });

  // Generate button handlers — write the Monday status column so the
  // DocExport automation actually runs. The automation fires on a *change*
  // event, so if the column happens to already be on "Generate", a plain set
  // won't trigger it. We clear the column to blank first, wait briefly, then
  // set to "Generate" — guarantees the change event fires.
  const triggerGenerate = useCallback(
    async (
      stateKey: "generateCgmScript" | "generateIpScript",
      columnId: string,
      v: string | undefined,
    ) => {
      update(stateKey, v);
      if (!hasToken()) return;
      try {
        if (v === "Generate") {
          // 1) clear → 2) set Generate
          await clearStatusColumn(patient.id, columnId);
          await new Promise((r) => setTimeout(r, 250));
          await writeStatusIndex(patient.id, columnId, GEN_SCRIPT_STATUS.generate);
        } else {
          // Auto-revert / cancel: clear so the next click can re-trigger
          await clearStatusColumn(patient.id, columnId);
        }
      } catch (e) {
        toast.error(
          v === "Generate"
            ? "Couldn't trigger script generation on Monday"
            : "Couldn't reset Generate column on Monday",
          { description: e instanceof Error ? e.message : String(e) },
        );
      }
    },
    [patient.id, update],
  );

  const handleGenerateCgm = useCallback(
    (v: string | undefined) => triggerGenerate("generateCgmScript", COL.generateCgmScript, v),
    [triggerGenerate],
  );
  const handleGenerateIp = useCallback(
    (v: string | undefined) => triggerGenerate("generateIpScript", COL.generateIpScript, v),
    [triggerGenerate],
  );

  // Auto-clear local Generate state when Monday's column transitions away from
  // "Generate" — i.e. when Brandon's automation flips it back to Ready after
  // DocExport completes.
  const prevCgmStatusRef = useRef<string | undefined>(undefined);
  const prevIpStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevCgmStatusRef.current;
    const curr = mondayFiles.generateCgmStatus;
    if (prev === "Generate" && curr && curr !== "Generate") {
      update("generateCgmScript", undefined);
    }
    prevCgmStatusRef.current = curr;
  }, [mondayFiles.generateCgmStatus, update]);
  useEffect(() => {
    const prev = prevIpStatusRef.current;
    const curr = mondayFiles.generateIpStatus;
    if (prev === "Generate" && curr && curr !== "Generate") {
      update("generateIpScript", undefined);
    }
    prevIpStatusRef.current = curr;
  }, [mondayFiles.generateIpStatus, update]);

  // Field-specific local-only update wrappers. All Monday writes happen via
  // the Send to Monday button at the bottom — except Generate Script which is
  // immediate (DocExport requires the live status change).
  const setIpCoveragePath = useCallback(
    (v: IpPath | undefined) => update("ipCoveragePath", v),
    [update],
  );
  const setCgmCoveragePath = useCallback(
    (v: CgmCoveragePath | undefined) => update("cgmCoveragePath", v),
    [update],
  );
  const setDiagnosis = useCallback((v: string) => update("diagnosis", v), [update]);
  const setMrReceived = useCallback(
    (v: YesNo | undefined) => update("mrReceived", v),
    [update],
  );
  const setLastVisitDate = useCallback(
    (v: string) => update("lastVisitDate", v),
    [update],
  );

  // ---- Delete a single file from a Monday file column ----
  const deleteOne = useCallback(
    async (columnId: string, allFiles: MondayFileEntry[], assetId: string, label: string) => {
      if (!hasToken()) {
        toast.error("Monday token not configured");
        return;
      }
      const keep = allFiles
        .filter((f) => f.assetId !== assetId)
        .map((f) => ({ name: f.name, url: f.public_url || f.url }))
        .filter((f): f is { name: string; url: string } => !!f.url);
      try {
        if (keep.length === 0) {
          await deleteFileFromColumn(patient.id, columnId);
        } else {
          await deleteSingleFileFromColumn(patient.id, columnId, keep);
        }
        await mondayFiles.refetch();
        toast.success(`${label} deleted from Monday`);
      } catch (e) {
        toast.error(`Failed to delete ${label}`, {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [patient.id, mondayFiles],
  );

  const handleDeleteClinicalFile = useCallback(
    (assetId: string) =>
      deleteOne(COL.clinicalFiles, mondayFiles.clinicalFiles, assetId, "Clinical file"),
    [deleteOne, mondayFiles.clinicalFiles],
  );

  const handleDeleteFinalClinicalFile = useCallback(
    (assetId: string) =>
      deleteOne(COL.finalClinicals, mondayFiles.finalClinicals, assetId, "Final clinical file"),
    [deleteOne, mondayFiles.finalClinicals],
  );

  const validity = useMemo(
    () => deriveValidity(state, patient, showCgm, showIp),
    [state, patient, showCgm, showIp],
  );

  const preview = useMemo(
    () => buildMondayPreview(state, validity, patient),
    [state, validity, patient],
  );

  // Send to Monday — batched write of every column the rep has edited locally.
  // Generate Script triggers and template deletes are immediate elsewhere.
  const [sending, setSending] = useState(false);
  const handleSendToMonday = useCallback(async () => {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setSending(true);
    const tasks: { label: string; run: () => Promise<unknown> }[] = [];

    // Insulin Pump Coverage Path — write "Not Serving" if the patient isn't
    // being served IP at all; otherwise write the rep's selection (or clear).
    if (!showIp) {
      tasks.push({
        label: "IP Coverage Path",
        run: () => writeStatusLabel(patient.id, COL.ipCoveragePath, "Not Serving"),
      });
    } else if (state.ipCoveragePath) {
      tasks.push({
        label: "IP Coverage Path",
        run: () => writeStatusLabel(patient.id, COL.ipCoveragePath, state.ipCoveragePath!),
      });
    } else {
      tasks.push({
        label: "IP Coverage Path",
        run: () => clearStatusColumn(patient.id, COL.ipCoveragePath),
      });
    }
    // CGM Coverage Path — same pattern.
    if (!showCgm) {
      tasks.push({
        label: "CGM Coverage Path",
        run: () => writeStatusLabel(patient.id, COL.cgmCoveragePath, "Not Serving"),
      });
    } else if (state.cgmCoveragePath) {
      tasks.push({
        label: "CGM Coverage Path",
        run: () => writeStatusLabel(patient.id, COL.cgmCoveragePath, state.cgmCoveragePath!),
      });
    } else {
      tasks.push({
        label: "CGM Coverage Path",
        run: () => clearStatusColumn(patient.id, COL.cgmCoveragePath),
      });
    }
    if (state.diagnosis) {
      tasks.push({
        label: "Diagnosis",
        run: () => writeStatusLabel(patient.id, COL.diagnosis, state.diagnosis!),
      });
    } else {
      tasks.push({
        label: "Diagnosis",
        run: () => clearStatusColumn(patient.id, COL.diagnosis),
      });
    }
    const mrLabel =
      state.mrReceived === "Yes" ? "MR Received" : state.mrReceived === "No" ? "Collect" : null;
    if (mrLabel) {
      tasks.push({
        label: "MRs / Clinicals",
        run: () => writeStatusLabel(patient.id, COL.mrsClinicals, mrLabel),
      });
    }
    if (state.lastVisitDate) {
      tasks.push({
        label: "Last Visit Date",
        run: () => writeDate(patient.id, COL.lastVisit, state.lastVisitDate!),
      });
    }
    const { expiry } = getMrExpiry(state.lastVisitDate);
    if (expiry) {
      tasks.push({
        label: "MR Expiry Date",
        run: () => writeDate(patient.id, COL.mrExpiryDate, expiry.toISOString().slice(0, 10)),
      });
    }
    tasks.push({
      label: "Medical Necessity",
      run: () => writeStatusLabel(patient.id, COL.medicalNecessity, preview.medicalNecessity),
    });
    tasks.push({
      label: "General MN Invalid Reasons",
      run: () =>
        writeDropdownLabels(
          patient.id,
          COL.generalMnInvalidReasons,
          preview.generalMnInvalidReasons,
        ),
    });
    tasks.push({
      label: "CGM MN Invalid Reasons",
      run: () =>
        writeDropdownLabels(
          patient.id,
          COL.cgmMnInvalidReasons,
          preview.cgmMnInvalidReasons,
        ),
    });
    tasks.push({
      label: "Insulin Pump MN Invalid Reasons",
      run: () =>
        writeDropdownLabels(
          patient.id,
          COL.ipMnInvalidReasons,
          preview.ipMnInvalidReasons,
        ),
    });
    // Consolidated, doctor-facing ask list — drives the Send Request UI
    // and the MN Request Letter PDF. Replaces the 3 raw reason dropdowns
    // for downstream consumers.
    tasks.push({
      label: "MN Request Consolidated",
      run: () =>
        writeDropdownLabels(
          patient.id,
          COL.mnRequestConsolidated,
          preview.mnRequestConsolidated,
        ),
    });
    tasks.push({
      label: "MN Evaluation Notes",
      run: () => writeLongText(patient.id, COL.mnEvalNotes, patient.mnEvalNotes ?? ""),
    });
    // Advance the Stage Advancer based on MN outcome:
    //   Established     → Completed (skip Send Request entirely)
    //   Not Established → Send Request
    const nextStage = validity.established ? "Completed" : "Send Request";
    tasks.push({
      label: `Stage Advancer → ${nextStage}`,
      run: () => writeStatusLabel(patient.id, COL.subStage, nextStage),
    });

    const results = await Promise.allSettled(tasks.map((t) => t.run()));
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failures.push(`${tasks[i].label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });
    setSending(false);
    if (failures.length === 0) {
      toast.success(`Sent ${tasks.length} fields to Monday`);
    } else {
      toast.error(`${failures.length} write(s) failed`, {
        description: failures.slice(0, 3).join("\n"),
      });
    }
  }, [patient.id, state, preview, showCgm, showIp]);

  return (
    <div className="space-y-4">
      {/* Banner: Serving forces a path */}
      {!showCgm && !showIp && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Serving is set to <strong>{patient.serving ?? "—"}</strong>. Neither CGM nor IP applies — add a Diagnosis & MR below.
        </div>
      )}

      {/* Diagnosis & Clinicals — top section */}
      <SectionCard
        title="Diagnosis & Clinicals"
        status={validity.sections.diagnosis.valid && validity.sections.mr.valid}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <DiagnosisField
            value={state.diagnosis}
            onChange={(v) => setDiagnosis(v)}
          />
          <StatusSelect
            label="MRs Received"
            value={state.mrReceived}
            options={YES_NO_OPTS}
            onChange={(v) => setMrReceived(v as YesNo)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mt-4">
          <DateField
            label="Last Visit Date"
            value={state.lastVisitDate}
            onChange={(v) => setLastVisitDate(v)}
          />
          <MrExpiryField lastVisit={state.lastVisitDate} />
        </div>
      </SectionCard>

      {/* CGM block */}
      {showCgm && (
        <SectionCard
          title="CGM"
          status={validity.sections.cgm.shown ? validity.sections.cgm.valid : null}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <StatusSelect
              label="CGM Script"
              value={state.cgmScriptValid}
              options={VALID_INVALID_OPTS}
              onChange={(v) => update("cgmScriptValid", v as ValidInvalid)}
            />
            <StatusSelect
              label="CGM Coverage Path"
              value={state.cgmCoveragePath}
              options={CGM_COVERAGE_OPTS}
              onChange={(v) => setCgmCoveragePath(v as CgmCoveragePath)}
            />
          </div>
        </SectionCard>
      )}

      {/* IP block */}
      {showIp && (
        <SectionCard
          title="Insulin Pump"
          status={validity.sections.ip.shown ? validity.sections.ip.valid : null}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 mb-2">
            <StatusSelect
              label="Insulin Pump Script"
              value={state.ipScriptValid}
              options={VALID_INVALID_OPTS}
              onChange={(v) => update("ipScriptValid", v as ValidInvalid)}
            />
            <StatusSelect
              label="Insulin Pump Coverage Path"
              value={state.ipCoveragePath}
              options={IP_PATH_OPTS}
              onChange={(v) => setIpCoveragePath(v as IpPath)}
            />
          </div>
          {state.ipCoveragePath && (
            <IpCriteria state={state} patient={patient} update={update} />
          )}
        </SectionCard>
      )}

      {/* Clinical files (uploads) */}
      <SectionCard title="Clinical Files">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FileUploadCard
            label="Clinical Files"
            files={state.clinicalFiles ?? []}
            mondayFiles={mondayFiles.clinicalFiles}
            mondayLoading={mondayFiles.loading}
            onAdd={(files) => update("clinicalFiles", [...(state.clinicalFiles ?? []), ...files])}
            onRemove={(idx) => {
              const next = [...(state.clinicalFiles ?? [])];
              next.splice(idx, 1);
              update("clinicalFiles", next);
            }}
            onDeleteMondayFile={handleDeleteClinicalFile}
          />
          <FileUploadCard
            label="Final Clinical Files"
            files={state.finalClinicalFiles ?? []}
            mondayFiles={mondayFiles.finalClinicals}
            mondayLoading={mondayFiles.loading}
            onAdd={(files) =>
              update("finalClinicalFiles", [...(state.finalClinicalFiles ?? []), ...files])
            }
            onRemove={(idx) => {
              const next = [...(state.finalClinicalFiles ?? [])];
              next.splice(idx, 1);
              update("finalClinicalFiles", next);
            }}
            onDeleteMondayFile={handleDeleteFinalClinicalFile}
          />
        </div>
      </SectionCard>

      {/* Notes */}
      <NotesPanel
        notes={patient.mnEvalNotes ?? ""}
        onNotesChange={(v) => onUpdate({ mnEvalNotes: v })}
        onSaveToMonday={(v) => writeLongText(patient.id, COL.mnEvalNotes, v)}
      />

      {/* Sticky validity / preview footer */}
      <ValiditySummary
        validity={validity}
        preview={preview}
        onSendToMonday={handleSendToMonday}
        sending={sending}
        state={state}
      />
    </div>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

interface SectionCardProps {
  title: string;
  status?: boolean | null; // true=valid, false=invalid, null=N/A, undefined=no badge
  children: React.ReactNode;
}

function SectionCard({ title, status, children }: SectionCardProps) {
  return (
    <div className="rounded-xl bg-card border shadow-card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
        {status === true && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            <Check className="h-3 w-3" /> Complete
          </span>
        )}
        {status === false && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
            <X className="h-3 w-3" /> Incomplete
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

interface IpCriteriaProps {
  state: EvalState;
  patient: Patient;
  update: <K extends keyof EvalState>(key: K, value: EvalState[K]) => void;
}

function IpCriteria({ state, patient, update }: IpCriteriaProps) {
  if (!state.ipCoveragePath) return null;
  const cfg = IP_PATH_FIELDS[state.ipCoveragePath];

  // Nothing else to show for Supplies Only
  const anyFieldShown =
    cfg.showEducation ||
    cfg.show3Injections ||
    cfg.showCgmUse ||
    cfg.showBsIssues ||
    cfg.showLmn ||
    cfg.showOow ||
    cfg.showMalfunction;

  if (!anyFieldShown) return null;

  const oowCheck = isOowDateValid(state.oowDate, patient.primaryInsurance);
  const isMedicareAB = patient.primaryInsurance === "Medicare A&B";
  const oowYears = isMedicareAB ? 5 : 4;

  return (
    <div className="mt-3 pt-3 border-t border-dashed">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Criteria for {state.ipCoveragePath}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        {cfg.showEducation && (
          <StatusSelect
            label="Diabetes Education"
            value={state.diabetesEducation}
            options={YES_NO_OPTS}
            onChange={(v) => update("diabetesEducation", v as YesNo)}
          />
        )}
        {cfg.show3Injections && (
          <StatusSelect
            label="3+ Injections / day"
            value={state.threeInjections}
            options={YES_NO_OPTS}
            onChange={(v) => update("threeInjections", v as YesNo)}
          />
        )}
        {cfg.showCgmUse && (
          <StatusSelect
            label="CGM Use"
            value={state.cgmUse}
            options={YES_NO_OPTS}
            onChange={(v) => update("cgmUse", v as YesNo)}
          />
        )}
        {cfg.showBsIssues && (
          <StatusSelect
            label="Blood Sugar Issues"
            value={state.bloodSugarIssues}
            options={YES_NO_OPTS}
            onChange={(v) => update("bloodSugarIssues", v as YesNo)}
          />
        )}
        {cfg.showLmn && (
          <StatusSelect
            label="Letter of MN on file"
            value={state.lmn}
            options={LMN_OPTS}
            onChange={(v) => update("lmn", v as LmnStatus)}
          />
        )}
        {cfg.showMalfunction && (
          <StatusSelect
            label="Malfunction"
            value={state.malfunction}
            options={YES_NO_OPTS}
            onChange={(v) => update("malfunction", v as YesNo)}
          />
        )}
      </div>

      {cfg.showOow && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 items-end">
          <div className="space-y-1.5 px-2">
            <Label className="text-xs text-muted-foreground">OOW Date</Label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={state.oowDate ?? ""}
                onChange={(e) => update("oowDate", e.target.value)}
                className="text-sm h-9"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => update("oowDate", undefined)}
                disabled={!state.oowDate}
                className="h-9 px-2 text-xs gap-1"
                title="Mark as not provided"
              >
                <X className="h-3 w-3" /> Clear
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 pb-1">
            {oowCheck === null ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                <X className="h-3 w-3" />
                Not provided — invalid
              </span>
            ) : oowCheck.valid ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                <Check className="h-3 w-3" />
                {(oowCheck.ageDays / 365.25).toFixed(1)} yrs OOW — valid
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                <X className="h-3 w-3" />
                {(oowCheck.ageDays / 365.25).toFixed(1)} yrs — needs {oowYears}+ years
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              ({oowYears}+ yrs required{isMedicareAB && " · Medicare A&B"})
            </span>
          </div>
        </div>
      )}

      {cfg.showOowOnScript && (
        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <StatusSelect
            label="OOW Date on Script?"
            value={state.oowDateOnScript}
            options={YES_NO_OPTS}
            onChange={(v) => update("oowDateOnScript", v as YesNo)}
          />
        </div>
      )}
    </div>
  );
}

interface DateFieldProps {
  label: string;
  value?: string;
  onChange: (v: string) => void;
}

function DateField({ label, value, onChange }: DateFieldProps) {
  return (
    <div className="space-y-1.5 px-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm h-9"
      />
    </div>
  );
}

function MrExpiryField({ lastVisit }: { lastVisit?: string }) {
  const { expiry, expired } = getMrExpiry(lastVisit);
  return (
    <div className="space-y-1.5 px-2">
      <Label className="text-xs text-muted-foreground">MR Expiry Date</Label>
      <div
        className={cn(
          "text-sm h-9 flex items-center justify-between px-3 rounded-md border",
          !expiry && "bg-muted/30 text-muted-foreground",
          expiry && !expired && "bg-emerald-50 border-emerald-200 text-emerald-900",
          expired && "bg-red-50 border-red-200 text-red-900",
        )}
      >
        <span>{expiry ? formatDate(expiry.toISOString().slice(0, 10)) : "—"}</span>
        {expiry && expired && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
            <AlertTriangle className="h-3 w-3" /> Expired
          </span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {lastVisit
          ? expired
            ? "Re-collect MR — last visit was over 6 months ago"
            : "auto: Last Visit + 6 months"
          : "set Last Visit first"}
      </p>
    </div>
  );
}

interface DiagnosisFieldProps {
  value?: string;
  onChange: (v: string) => void;
}

function DiagnosisField({ value, onChange }: DiagnosisFieldProps) {
  const [open, setOpen] = useState(false);
  // Override the default Command "selected" highlight (which is dark/white) with
  // a light emerald that keeps text readable on hover/keyboard focus.
  const itemClass =
    "text-xs cursor-pointer text-foreground data-[selected=true]:bg-emerald-100 data-[selected=true]:text-emerald-900 aria-selected:bg-emerald-100 aria-selected:text-emerald-900";
  const renderItem = (code: string) => (
    <CommandItem
      key={code}
      value={code}
      onSelect={() => {
        onChange(code === value ? "" : code);
        setOpen(false);
      }}
      className={itemClass}
    >
      <Check
        className={cn(
          "mr-2 h-3 w-3",
          value === code ? "opacity-100" : "opacity-0",
        )}
      />
      {code}
    </CommandItem>
  );
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50">
      <span className="text-sm text-muted-foreground whitespace-nowrap">Diagnosis</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-[160px] h-8 px-3 text-xs font-medium justify-between",
              value
                ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-50/80 hover:text-emerald-900"
                : "border-muted",
            )}
          >
            {value || "—"}
            <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-0" align="end">
          <Command>
            <CommandInput placeholder="Search ICD-10..." className="h-9" />
            <CommandList>
              <CommandEmpty>No code found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  key="__none__"
                  value="(none)"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className={itemClass + " text-muted-foreground italic"}
                >
                  <X className="mr-2 h-3 w-3" />
                  (none)
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Favorites">
                {DIAGNOSIS_FAVORITES.map(renderItem)}
              </CommandGroup>
              <CommandGroup heading="All Codes">
                {DIAGNOSIS_OTHER.map(renderItem)}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface GenerateScriptToggleProps {
  label: string;
  isGenerating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
}

function GenerateScriptToggle({
  label,
  isGenerating,
  onGenerate,
  onCancel,
}: GenerateScriptToggleProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50">
      <span className="text-sm text-muted-foreground whitespace-nowrap">{label}</span>
      {isGenerating ? (
        <div className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium rounded-md border border-amber-300 bg-amber-50 text-amber-900">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating…
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="h-8 px-2 text-xs"
            title="Cancel"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          onClick={onGenerate}
          className="h-8 px-3 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <FileText className="h-3 w-3" />
          Generate
        </Button>
      )}
    </div>
  );
}

interface MondayScriptViewerProps {
  label: string; // "CGM script template" or "Insulin Pump script template"
  itemId: string;
  columnId: string;
  files: MondayFileEntry[];
  loading: boolean;
  onDeleted: () => void;
}

function MondayScriptViewer({
  label,
  itemId,
  columnId,
  files,
  loading,
  onDeleted,
}: MondayScriptViewerProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete the ${label} from Monday? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteFileFromColumn(itemId, columnId);
      toast.success("Template deleted");
      onDeleted();
    } catch (e) {
      toast.error("Delete failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading && files.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 h-9 rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading…
        </span>
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 h-9 rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <FileText className="h-3 w-3" />
          No {label} found
        </span>
        <Button variant="ghost" size="sm" disabled className="h-7 px-2 text-[11px]">
          View
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {files.map((f) => (
        <div
          key={f.assetId}
          className="flex items-center justify-between gap-2 px-3 h-9 rounded-md border bg-emerald-50 border-emerald-200"
        >
          <span className="flex items-center gap-2 truncate text-xs text-emerald-900">
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate font-medium">{f.name}</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="outline"
              size="sm"
              disabled={!f.public_url && !f.url}
              onClick={() => {
                const u = f.public_url || f.url;
                if (u) window.open(u, "_blank");
              }}
              className="h-7 px-2 text-[11px] gap-1"
            >
              <ExternalLink className="h-3 w-3" /> View
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="h-7 px-2 text-[11px] text-red-700 hover:text-red-800 hover:bg-red-50 border-red-200"
              title="Delete from Monday"
            >
              {deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface FileUploadCardProps {
  label: string;
  files: LocalFile[];
  mondayFiles: MondayFileEntry[];
  mondayLoading: boolean;
  onAdd: (files: LocalFile[]) => void;
  onRemove: (idx: number) => void;
  /** Delete a single Monday file by asset ID — removes from Monday's column. */
  onDeleteMondayFile?: (assetId: string) => void | Promise<void>;
}

function FileUploadCard({
  label,
  files,
  mondayFiles,
  mondayLoading,
  onAdd,
  onRemove,
  onDeleteMondayFile,
}: FileUploadCardProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteMondayFile = async (file: MondayFileEntry) => {
    if (!onDeleteMondayFile) return;
    if (!window.confirm(`Delete "${file.name}" from Monday? This can't be undone.`)) return;
    setDeletingId(file.assetId);
    try {
      await onDeleteMondayFile(file.assetId);
    } finally {
      setDeletingId(null);
    }
  };

  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const next: LocalFile[] = Array.from(fileList).map((f) => ({
      name: f.name,
      size: f.size,
      addedAt: new Date().toISOString(),
    }));
    onAdd(next);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const downloadAll = () => {
    for (const f of mondayFiles) {
      const url = f.public_url || f.url;
      if (url) window.open(url, "_blank");
    }
  };

  return (
    <div className="rounded-lg border bg-muted/20 p-3 h-full flex flex-col gap-2 min-h-[200px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={downloadAll}
          disabled={mondayFiles.length === 0 || mondayLoading}
          className="h-7 px-2 text-[11px] gap-1"
          title={
            mondayFiles.length === 0
              ? "No Monday files to download"
              : `Download all ${mondayFiles.length} file(s) from Monday`
          }
        >
          {mondayLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          Download all
          {mondayFiles.length > 0 && ` (${mondayFiles.length})`}
        </Button>
      </div>

      {/* Monday-attached files (always rendered for consistent layout) */}
      {mondayFiles.length > 0 ? (
        <ul className="space-y-1">
          {mondayFiles.map((f) => (
            <li
              key={f.assetId}
              className="flex items-center justify-between gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-emerald-900"
            >
              <span className="flex items-center gap-2 truncate">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate font-medium">{f.name}</span>
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!f.public_url && !f.url}
                  onClick={() => {
                    const u = f.public_url || f.url;
                    if (!u) return;
                    // Wrap in Google Docs Viewer so the browser renders
                    // inline instead of downloading (Monday's CDN sets
                    // Content-Disposition: attachment on direct links).
                    const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(u)}&embedded=true`;
                    window.open(viewerUrl, "_blank");
                  }}
                  className="h-6 px-1.5 text-[10px] gap-1"
                >
                  <ExternalLink className="h-2.5 w-2.5" /> View
                </Button>
                {onDeleteMondayFile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteMondayFile(f)}
                    disabled={deletingId !== null}
                    title={`Delete "${f.name}" from Monday`}
                    className="h-6 px-1.5 text-[10px] text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {deletingId === f.assetId ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-2.5 w-2.5" />
                    )}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground italic px-1 py-1">
          No Monday files attached
        </p>
      )}

      {/* Upload drop zone — fills remaining vertical space so both boxes mirror */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={`flex-1 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed py-6 cursor-pointer transition-colors ${
          isDragOver ? "border-emerald-400 bg-emerald-50" : "border-muted bg-background hover:bg-muted/30"
        }`}
      >
        <Upload className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Drop files here or <span className="underline">browse</span>
        </p>
        <p className="text-[10px] text-muted-foreground">(local preview — uploads to Monday wired up later)</p>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between gap-2 text-xs bg-background border rounded px-2 py-1"
            >
              <span className="flex items-center gap-2 truncate">
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">{f.name}</span>
                <span className="text-muted-foreground shrink-0">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
              </span>
              <button
                onClick={() => onRemove(i)}
                className="text-muted-foreground hover:text-red-600"
                aria-label="Remove file"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Returns the list of IP criteria field labels that are shown but not yet filled in. */
function getMissingIpCriteria(state: EvalState): string[] {
  if (!state.ipCoveragePath) return [];
  const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
  const missing: string[] = [];
  if (cfg.showMalfunction && state.malfunction === undefined) missing.push("Malfunction");
  if (cfg.showOow && !state.oowDate) missing.push("OOW Date");
  if (cfg.showOowOnScript && state.oowDateOnScript === undefined) missing.push("OOW Date on Script?");
  if (cfg.showEducation && state.diabetesEducation === undefined) missing.push("Diabetes Education");
  if (cfg.showCgmUse && state.cgmUse === undefined) missing.push("CGM Use");
  if (cfg.show3Injections && state.threeInjections === undefined) missing.push("3+ Injections / day");
  if (cfg.showBsIssues && state.bloodSugarIssues === undefined) missing.push("Blood Sugar Issues");
  return missing;
}

interface ValiditySummaryProps {
  validity: ReturnType<typeof deriveValidity>;
  preview: ReturnType<typeof buildMondayPreview>;
  onSendToMonday: () => void;
  sending: boolean;
  state: EvalState;
}

function ValiditySummary({
  validity,
  preview,
  onSendToMonday,
  sending,
  state,
}: ValiditySummaryProps) {
  const missingIpFields = getMissingIpCriteria(state);
  const blocked = missingIpFields.length > 0;
  return (
    <section className="rounded-xl bg-card border shadow-card p-5 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Monday Preview
        </p>
        <p className="text-[11px] text-muted-foreground/80 mt-0.5">
          Review the values below, then press Send to Monday.
        </p>
      </div>

      {/* Section pills + MN status */}
      <div className="flex items-center gap-2 flex-wrap">
        <SectionPill
          label="General"
          status={{
            shown: true,
            valid: validity.sections.diagnosis.valid && validity.sections.mr.valid,
          }}
        />
        <SectionPill label="Insulin Pump" status={validity.sections.ip} />
        <SectionPill label="CGM" status={validity.sections.cgm} />
        <span className="text-sm ml-1">
          →{" "}
          {validity.established ? (
            <strong className="text-emerald-700">Medical Necessity: Established</strong>
          ) : (
            <strong className="text-red-700">Not Established</strong>
          )}
        </span>
      </div>

      {!validity.established && validity.reasons.length > 0 && (
        <div className="text-xs text-muted-foreground border-l-2 border-red-200 pl-3 py-1">
          <span className="font-medium text-foreground">Reasons:</span>{" "}
          {validity.reasons.join(" · ")}
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Monday Columns
        </p>
        <MondayPreviewPanel preview={preview} />
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {blocked && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 max-w-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-800">
                Fill out all IP criteria to submit
              </p>
              <ul className="mt-1 space-y-0.5">
                {missingIpFields.map((f) => (
                  <li key={f} className="text-[11px] text-amber-700">• {f}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <Button
          size="lg"
          onClick={onSendToMonday}
          disabled={sending || blocked}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-elevate"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Send to Monday
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

function MondayPreviewPanel({ preview }: { preview: ReturnType<typeof buildMondayPreview> }) {
  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      <table className="w-full text-xs">
        <tbody className="[&>tr]:border-t [&>tr:first-child]:border-t-0 [&>tr>td]:px-3 [&>tr>td]:py-2 [&>tr>td]:align-top">
          <ColRow label="Insulin Pump Coverage Path" value={preview.ipCoveragePath} />
          <ColRow label="CGM Coverage Path" value={preview.cgmCoveragePath} />
          <ColRow label="Diagnosis" value={preview.diagnosis} />
          <ColRow label="MRs / Clinicals" value={preview.mrsClinicals} />
          <ColRow label="Last Visit Date" value={formatPreviewDate(preview.lastVisitDate)} />
          <ColRow label="MR Expiry Date" value={formatPreviewDate(preview.mrExpiryDate)} />
          <ColRow
            label="Medical Necessity"
            value={preview.medicalNecessity}
          />
          <ReasonsRow label="General MN Invalid Reasons" reasons={preview.generalMnInvalidReasons} />
          <ReasonsRow label="CGM MN Invalid Reasons" reasons={preview.cgmMnInvalidReasons} />
          <ReasonsRow label="Insulin Pump MN Invalid Reasons" reasons={preview.ipMnInvalidReasons} />
          {preview.generateCgmScript && (
            <ColRow label="Generate CGM Script" value={preview.generateCgmScript} />
          )}
          {preview.generateIpScript && (
            <ColRow label="Generate Insulin Pump Script" value={preview.generateIpScript} />
          )}
        </tbody>
      </table>
    </div>
  );
}

function getBadgeClass(label: string, value: string): string | null {
  // "Not Serving" — light green, distinct from the "valid"/"established" green.
  if (value === "Not Serving") {
    return "bg-lime-100 text-lime-800 border-lime-300";
  }
  // CGM Coverage Path: Insulin dark blue, Hypo light blue
  if (label === "CGM Coverage Path") {
    if (value === "Insulin") return "bg-blue-100 text-blue-900 border-blue-300";
    if (value === "Hypo") return "bg-sky-100 text-sky-900 border-sky-300";
    if (value === "Invalid") return "bg-red-100 text-red-900 border-red-300";
  }
  // Insulin Pump Coverage Path: subtle indigo for paths.
  if (label === "Insulin Pump Coverage Path") {
    return "bg-indigo-100 text-indigo-900 border-indigo-300";
  }
  // MRs / Clinicals: green for received, orange for collect
  if (label === "MRs / Clinicals") {
    if (value === "MR Received") return "bg-emerald-100 text-emerald-900 border-emerald-300";
    if (value === "Collect") return "bg-orange-100 text-orange-900 border-orange-300";
  }
  // Medical Necessity: green established, orange not established
  if (label === "Medical Necessity") {
    if (value === "Established") return "bg-emerald-100 text-emerald-900 border-emerald-300";
    if (value === "Not Established") return "bg-orange-100 text-orange-900 border-orange-300";
  }
  // Generate Script status: amber pill while triggered
  if (label.startsWith("Generate ") && value === "Generate") {
    return "bg-amber-100 text-amber-900 border-amber-300";
  }
  return null;
}

function ColRow({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  const badge = value ? getBadgeClass(label, value) : null;
  return (
    <tr>
      <td className="text-muted-foreground w-[180px] whitespace-nowrap">{label}</td>
      <td>
        {!value ? (
          <span className="text-muted-foreground/60 italic">—</span>
        ) : badge ? (
          <span
            className={cn(
              "inline-flex items-center text-xs font-medium border rounded-md px-2 py-0.5",
              badge,
            )}
          >
            {value}
          </span>
        ) : (
          <span className="font-medium">{value}</span>
        )}
      </td>
    </tr>
  );
}

function ReasonsRow({ label, reasons }: { label: string; reasons: string[] }) {
  return (
    <tr>
      <td className="text-muted-foreground w-[180px] whitespace-nowrap">{label}</td>
      <td>
        {reasons.length === 0 ? (
          <span className="text-muted-foreground/60 italic">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {reasons.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"
              >
                <X className="h-3 w-3" />
                {r}
              </span>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

function formatPreviewDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function SectionPill({
  label,
  status,
}: {
  label: string;
  status: { shown: boolean; valid: boolean };
}) {
  if (!status.shown) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/40 border rounded-full px-2 py-0.5">
        <CircleDashed className="h-3 w-3" /> {label} N/A
      </span>
    );
  }
  return status.valid ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
      <Check className="h-3 w-3" /> {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
      <X className="h-3 w-3" /> {label}
    </span>
  );
}
