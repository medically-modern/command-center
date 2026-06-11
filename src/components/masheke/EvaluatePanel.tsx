import { useImmediateFileUpload, type TrackedFile } from "@/hooks/masheke/useImmediateFileUpload";
import { useEffect, useMemo, useState, useCallback, useRef, type DragEvent } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { StatusSelect, type StatusOption } from "./StatusSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { NotesPanel } from "@/components/masheke/NotesPanel";
import {
  VALID_INVALID_OPTS,
  YES_NO_OPTS,
  CGM_COVERAGE_OPTS,
  LMN_OPTS,
  IP_PATH_OPTS,
  DIAGNOSIS_FAVORITES,
} from "@/lib/masheke/fieldOptions";
import {
  IP_PATH_FIELDS,
  shouldShowCgmBlock,
  shouldShowIpBlock,
  defaultIpPath,
  type IpPath,
} from "@/lib/masheke/ipPaths";
import {
  loadEvalState,
  saveEvalState,
  seedEvalStateFromPatient,
  isOowDateValid,
  formatOowDiff,
  getMrExpiry,
  deriveValidity,
  buildMondayPreview,
  type EvalState,
  type LocalFile,
  type CgmCoveragePath,
  type LmnStatus,
  type ValidInvalid,
  type YesNo,
} from "@/lib/masheke/evalState";
import { useMondayFiles } from "@/hooks/masheke/useMondayFiles";
import {
  COL,
  clearStatusColumn,
  clearDateColumn,
  deleteFileFromColumn,
  deleteSingleFileFromColumn,
  fetchAssetBytes,
  fetchStatusOptions,
  hasToken,
  writeDate,
  writeDropdownLabels,
  writeLongText,
  writeStatusIndex,
  writeStatusLabel,
  buildDoctorWriteTasks,
  uploadFileToColumn,
  type MondayFileEntry,
} from "@/lib/masheke/mondayApi";
import { GEN_SCRIPT_STATUS, ESCALATION_INDEX } from "@/lib/masheke/mondayMapping";
import { etToday } from "@/lib/masheke/etDate";
import { EscalateButton } from "@/components/masheke/EscalateButton";
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
  CheckCircle2,
  XCircle,
  Plus,
  Send,
  ChevronRight,
  Circle,
  Activity,
  Syringe,
  ClipboardList,
  Lock,
} from "lucide-react";
import { StepSection } from "@/components/shared/StepSection";
import { getServingAccent } from "@/lib/masheke/servingTheme";

interface Props {
  patient: Patient;
  /** Bumped by parent when Reset is pressed — forces local state to reload. */
  resetVersion?: number;
  onUpdate: (patch: Partial<Patient>) => void;
  onOpenForm?: () => void;
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

export function EvaluatePanel({ patient, resetVersion = 0, onUpdate, onOpenForm }: Props) {
  const accent = getServingAccent(patient.serving);
  const [state, setState] = useState<EvalState>(() => {
    const stored = loadEvalState(patient.id);
    return Object.keys(stored).length > 0 ? stored : seedEvalStateFromPatient(patient);
  });

  // Notes gate — Send to Monday requires ≥1 note added this session, and is
  // blocked while typed-but-unadded text sits in the note box.
  const [noteAdded, setNoteAdded] = useState(false);
  const [pendingNoteText, setPendingNoteText] = useState("");

  // Map of pending File objects keyed by column ("clinicalFiles" | "finalClinicalFiles").
  // FileUploadCard stores only metadata in EvalState; the actual blobs live here
  // so handleSendToMonday can upload them to Monday.
  const pendingFilesRef = useRef<Record<string, File[]>>({ clinicalFiles: [], finalClinicalFiles: [] });

  // Immediate file upload — uploads on drop, blocks Send until confirmed
  const clinicalUpload = useImmediateFileUpload();
  const finalClinicalUpload = useImmediateFileUpload();
  const filesUploading = clinicalUpload.busy || finalClinicalUpload.busy;

  // Reload state when patient changes OR when parent triggers a Reset.
  useEffect(() => {
    const stored = loadEvalState(patient.id);
    if (Object.keys(stored).length > 0) setState(stored);
    else setState(seedEvalStateFromPatient(patient));
    // Clear pending file blobs on reset / patient switch
    pendingFilesRef.current = { clinicalFiles: [], finalClinicalFiles: [] };
    clinicalUpload.reset();
    finalClinicalUpload.reset();
    setNoteAdded(false);
    setPendingNoteText("");
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

  // Effective state for validity / preview: a script whose switch is off (or
  // never touched) reads as "Missing" downstream — this produces the
  // "Script missing" MN reason AND the script ask in MN Request Consolidated,
  // matching the redesign rule that the received switch is always an answer.
  const effState = useMemo<EvalState>(
    () => ({
      ...state,
      cgmScriptValid:
        showCgm && state.cgmScriptReceived !== "Yes" ? "Missing" : state.cgmScriptValid,
      ipScriptValid:
        showIp && state.ipScriptReceived !== "Yes" ? "Missing" : state.ipScriptValid,
    }),
    [state, showCgm, showIp],
  );

  const validity = useMemo(
    () => deriveValidity(effState, patient, showCgm, showIp),
    [effState, patient, showCgm, showIp],
  );

  const preview = useMemo(
    () => buildMondayPreview(effState, validity, patient),
    [effState, validity, patient],
  );

  // Send to Monday — batched write of every column the rep has edited locally.
  // Generate Script triggers and template deletes are immediate elsewhere.
  const [sending, setSending] = useState(false);
  // Per-field write failures from the last Send — shown persistently in the
  // outcome card (not just a transient toast).
  const [sendErrors, setSendErrors] = useState<string[]>([]);
  const [escalated, setEscalated] = useState(false);
  const escalatedRef = useRef(false);
  const handleSendToMonday = useCallback(async () => {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setSending(true);
    setSendErrors([]);
    const tasks: { label: string; run: () => Promise<unknown> }[] = [];

    const clinReceived = state.mrReceived === "Yes";
    const cgmReceived = state.cgmScriptReceived === "Yes";
    const ipReceived = state.ipScriptReceived === "Yes";

    // Insulin Pump Coverage Path — write "Not Serving" if the patient isn't
    // being served IP at all; if the IP script was received, write the rep's
    // selection (or clear). If the script was NOT received the section was
    // hidden, so leave Monday's column untouched rather than clobbering it.
    if (!showIp) {
      tasks.push({
        label: "IP Coverage Path",
        run: () => writeStatusLabel(patient.id, COL.ipCoveragePath, "Not Serving"),
      });
    } else if (ipReceived) {
      if (state.ipCoveragePath) {
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
    }
    // CGM Coverage Path — same pattern.
    if (!showCgm) {
      tasks.push({
        label: "CGM Coverage Path",
        run: () => writeStatusLabel(patient.id, COL.cgmCoveragePath, "Not Serving"),
      });
    } else if (cgmReceived) {
      if (state.cgmCoveragePath) {
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
    }
    // Diagnosis / Last Visit / MR Expiry — only synced while the Clinicals
    // section is visible (Clinicals received). When hidden, leave Monday
    // untouched.
    if (clinReceived) {
      if (state.diagnosis) {
        tasks.push({
          label: "Diagnosis",
          // Diagnosis is the ONLY status column allowed to create new labels
          // (reps can add new ICD-10 codes).
          run: () => writeStatusLabel(patient.id, COL.diagnosis, state.diagnosis!, true),
        });
      } else {
        tasks.push({
          label: "Diagnosis",
          run: () => clearStatusColumn(patient.id, COL.diagnosis),
        });
      }
    }
    // Script Received columns — the switch is always an answer: off = "No".
    if (showCgm) {
      tasks.push({
        label: "CGM Script Received",
        run: () => writeStatusLabel(patient.id, COL.cgmScriptReceived, cgmReceived ? "Yes" : "No"),
      });
    }
    if (showIp) {
      tasks.push({
        label: "IP Script Received",
        run: () => writeStatusLabel(patient.id, COL.ipScriptReceived, ipReceived ? "Yes" : "No"),
      });
    }
    // MRs / Clinicals — switch is always an answer: off = "Collect".
    tasks.push({
      label: "MRs / Clinicals",
      run: () => writeStatusLabel(patient.id, COL.mrsClinicals, clinReceived ? "MR Received" : "Collect"),
    });
    if (clinReceived) {
      if (state.lastVisitDate) {
        tasks.push({
          label: "Last Visit Date",
          run: () => writeDate(patient.id, COL.lastVisit, state.lastVisitDate!),
        });
      } else {
        tasks.push({
          label: "Last Visit Date (clear)",
          run: () => clearDateColumn(patient.id, COL.lastVisit),
        });
      }
      const { expiry } = getMrExpiry(state.lastVisitDate);
      if (expiry) {
        tasks.push({
          label: "MR Expiry Date",
          run: () => writeDate(patient.id, COL.mrExpiryDate, expiry.toISOString().slice(0, 10)),
        });
      } else {
        tasks.push({
          label: "MR Expiry Date (clear)",
          run: () => clearDateColumn(patient.id, COL.mrExpiryDate),
        });
      }
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
      // Allowed to create labels: the OOW ask embeds a patient-specific date
      // ("Add OOW date of MM/DD/YYYY to the script") so it's dynamic by design.
      run: () =>
        writeDropdownLabels(
          patient.id,
          COL.mnRequestConsolidated,
          preview.mnRequestConsolidated,
          true,
        ),
    });
    tasks.push({
      label: "MN Workflow Notes",
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
    // Next Action Date → today (ET) — the patient lands in the next tab's
    // active list immediately instead of an empty/scheduled state.
    tasks.push({
      label: "Next Action Date → today",
      run: () => writeDate(patient.id, COL.nextActionDate, etToday()),
    });

    // Doctor fields (from pencil-edit overlay)
    tasks.push(...buildDoctorWriteTasks(patient));

    // File uploads are now handled immediately on drop via useImmediateFileUpload.
    // They are confirmed server-side before Send is enabled — no batch upload needed.
    // Escalation — only written when the toggle is active
    if (escalatedRef.current) {
      tasks.push({
        label: "Escalation → Required",
        run: () => writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required),
      });
    }
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
      setEscalated(false); escalatedRef.current = false;
    } else {
      setSendErrors(failures);
      toast.error(`${failures.length} write(s) failed — see details below`, {
        description: failures.slice(0, 3).join("\n"),
        duration: 10000,
      });
    }
  }, [patient, state, preview, showCgm, showIp]);

  // ── Redesign visibility rules (strict, per-document) ──
  // Each script strictly controls only its own coverage section; Clinicals
  // controls Diagnosis & Clinicals AND Clinical Files. Step numbers renumber
  // dynamically based on what's visible.
  const cgmOn = showCgm && state.cgmScriptReceived === "Yes";
  const ipOn = showIp && state.ipScriptReceived === "Yes";
  const clinOn = state.mrReceived === "Yes";
  let stepCounter = 1;
  const diagStepNum = clinOn ? ++stepCounter : 0;
  const pathStepNum = cgmOn || ipOn ? ++stepCounter : 0;
  const filesStepNum = clinOn ? ++stepCounter : 0;

  return (
    <div className="space-y-6">
      {/* Banner: Serving forces a path */}
      {!showCgm && !showIp && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Serving is set to <strong>{patient.serving ?? "—"}</strong>. Neither CGM nor IP applies — add a Diagnosis & MR below.
        </div>
      )}



      {/* ── Step 1 · Script / Clinicals Received? ──────── */}
      <MmStep num={1} title="Script / Clinicals Received?">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {showCgm && (
            <DocCard
              title="CGM Script"
              received={state.cgmScriptReceived === "Yes"}
              fullWidth={!showIp}
              showValidity
              validity={
                state.cgmScriptValid === "Valid"
                  ? true
                  : state.cgmScriptValid === "Invalid"
                    ? false
                    : null
              }
              onToggle={(on) => {
                update("cgmScriptReceived", (on ? "Yes" : "No") as YesNo);
                update("cgmScriptValid", undefined);
              }}
              onValidity={(v) => update("cgmScriptValid", (v ? "Valid" : "Invalid") as ValidInvalid)}
            />
          )}
          {showIp && (
            <DocCard
              title="IP Script"
              received={state.ipScriptReceived === "Yes"}
              fullWidth={!showCgm}
              showValidity
              validity={
                state.ipScriptValid === "Valid"
                  ? true
                  : state.ipScriptValid === "Invalid"
                    ? false
                    : null
              }
              onToggle={(on) => {
                update("ipScriptReceived", (on ? "Yes" : "No") as YesNo);
                update("ipScriptValid", undefined);
              }}
              onValidity={(v) => update("ipScriptValid", (v ? "Valid" : "Invalid") as ValidInvalid)}
            />
          )}
          <DocCard
            title="Clinicals"
            received={state.mrReceived === "Yes"}
            fullWidth
            onToggle={(on) => setMrReceived((on ? "Yes" : "No") as YesNo)}
          />
        </div>
      </MmStep>


      {/* ── Diagnosis & Clinicals — visible only when Clinicals received ── */}
      {clinOn && (
        <MmStep num={diagStepNum} title="Diagnosis & Clinicals">
          <SubCard icon={<ClipboardList className="h-4 w-4" />} title="Clinical Details">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4 items-start">
              <DiagnosisField value={state.diagnosis} onChange={(v) => setDiagnosis(v)} />
              <LastVisitField value={state.lastVisitDate} onChange={(v) => setLastVisitDate(v)} />
              <MrExpiryField lastVisit={state.lastVisitDate} />
            </div>
          </SubCard>
        </MmStep>
      )}

      {/* ── Coverage paths — each script strictly controls its own section ── */}
      {(cgmOn || ipOn) && (
        <MmStep
          num={pathStepNum}
          title={cgmOn && ipOn ? "CGM & Insulin Pump" : cgmOn ? "CGM" : "Insulin Pump"}
        >
          <div
            className={cn(
              "grid gap-5 items-start",
              cgmOn && ipOn ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1",
            )}
          >
            {cgmOn && (
              <SubCard icon={<Activity className="h-4 w-4" />} title="CGM Coverage Path">
                <PathSelect
                  value={state.cgmCoveragePath}
                  options={CGM_COVERAGE_OPTS}
                  onChange={(v) => setCgmCoveragePath(v as CgmCoveragePath)}
                  missing={!state.cgmCoveragePath}
                />
              </SubCard>
            )}
            {ipOn && (
              <SubCard icon={<Syringe className="h-4 w-4" />} title="Insulin Pump Coverage Path">
                <div className="space-y-4">
                  <PathSelect
                    value={state.ipCoveragePath}
                    options={IP_PATH_OPTS}
                    onChange={(v) => setIpCoveragePath(v as IpPath)}
                    missing={!state.ipCoveragePath}
                  />
                  <IpCriteria state={state} patient={patient} update={update} />
                </div>
              </SubCard>
            )}
          </div>
        </MmStep>
      )}

      {/* ── Clinical Files — visible only when Clinicals received ── */}
      {clinOn && (
        <MmStep num={filesStepNum} title="Clinical Files">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
            <div className="flex flex-col">
              <h4 className="text-base font-bold tracking-tight">Initial File Collection</h4>
              <p className="text-sm text-muted-foreground mb-3">
                All clinical documents gathered during collection
              </p>
              <div className="flex-1">
                <FileUploadCard
                  label="Initial File Collection"
                  hideLabel
                  tone={validity.established ? "gray" : "green"}
                  files={state.clinicalFiles ?? []}
                  mondayFiles={mondayFiles.clinicalFiles}
                  mondayLoading={mondayFiles.loading}
                  trackedFiles={clinicalUpload.files}
                  itemId={patient.id}
                  columnId={COL.clinicalFiles}
                  onRefetch={mondayFiles.refetch}
                  onAdd={(files) => update("clinicalFiles", [...(state.clinicalFiles ?? []), ...files])}
                  onAddRaw={(rawFiles) => {
                    clinicalUpload.upload(patient.id, COL.clinicalFiles, rawFiles);
                  }}
                  onRemove={(idx) => {
                    const next = [...(state.clinicalFiles ?? [])];
                    next.splice(idx, 1);
                    update("clinicalFiles", next);
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col">
              <h4 className="text-base font-bold tracking-tight">
                Final Clinicals{" "}
                <span className="font-medium text-muted-foreground">(Single File)</span>
              </h4>
              <p className="text-sm text-muted-foreground mb-3">
                The one combined, finalized clinical package
              </p>
              <div className="flex-1">
                {validity.established ? (
                  <FileUploadCard
                    label="Final Clinicals"
                    hideLabel
                    tone="green"
                    files={state.finalClinicalFiles ?? []}
                    mondayFiles={mondayFiles.finalClinicals}
                    mondayLoading={mondayFiles.loading}
                    trackedFiles={finalClinicalUpload.files}
                    itemId={patient.id}
                    columnId={COL.finalClinicals}
                    onRefetch={mondayFiles.refetch}
                    onAdd={(files) =>
                      update("finalClinicalFiles", [...(state.finalClinicalFiles ?? []), ...files])
                    }
                    onAddRaw={(rawFiles) => {
                      finalClinicalUpload.upload(patient.id, COL.finalClinicals, rawFiles);
                    }}
                    onRemove={(idx) => {
                      const next = [...(state.finalClinicalFiles ?? [])];
                      next.splice(idx, 1);
                      update("finalClinicalFiles", next);
                    }}
                  />
                ) : (
                  <LockedDropzone />
                )}
              </div>
            </div>
          </div>
        </MmStep>
      )}

      {/* Notes */}
      <NotesPanel
        notes={patient.mnEvalNotes ?? ""}
        onNotesChange={(v) => onUpdate({ mnEvalNotes: v })}
        onSaveToMonday={(v) => writeLongText(patient.id, COL.mnEvalNotes, v)}
        profileSendOffNotes={patient.profileSendOffNotes}
        onNoteAdded={() => setNoteAdded(true)}
        onPendingTextChange={setPendingNoteText}
        notePrefix="Evaluate"
      />

      {/* Sticky validity / preview footer */}
      <ValiditySummary
        validity={validity}
        preview={preview}
        onSendToMonday={handleSendToMonday}
        sending={sending}
        sendErrors={sendErrors}
        noteAdded={noteAdded}
        pendingNoteText={pendingNoteText}
        state={state}
        showCgm={showCgm}
        showIp={showIp}
        patient={patient}
        escalated={escalated}
        onToggleEscalate={() => setEscalated((v) => { const nv = !v; escalatedRef.current = nv; return nv; })}
        onOpenForm={onOpenForm}
        filesUploading={filesUploading}
      />
    </div>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

interface SectionCardProps {
  title?: string;
  status?: boolean | null; // true=valid, false=invalid, null=N/A, undefined=no badge
  children: React.ReactNode;
}

function SectionCard({ title, status, children }: SectionCardProps) {
  return (
    <div className="rounded-xl bg-card border shadow-card p-6">
      {(title || status === true || status === false) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="font-heading text-base font-semibold text-foreground">{title}</h3>}
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
      )}
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
  if (!state.ipCoveragePath || state.ipCoveragePath === "Not Serving") return null;
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

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Requirements — all required
      </p>
      <div className="flex flex-col gap-2.5">
        {cfg.showEducation && (
          <ReqRow label="Diabetes Education" missing={state.diabetesEducation === undefined}>
            <PillPair
              value={state.diabetesEducation}
              onChange={(v) => update("diabetesEducation", v)}
            />
          </ReqRow>
        )}
        {cfg.show3Injections && (
          <ReqRow label="3+ Injections / Day" missing={state.threeInjections === undefined}>
            <PillPair
              value={state.threeInjections}
              onChange={(v) => update("threeInjections", v)}
            />
          </ReqRow>
        )}
        {cfg.showCgmUse && (
          <ReqRow label="CGM Use" missing={state.cgmUse === undefined}>
            <PillPair value={state.cgmUse} onChange={(v) => update("cgmUse", v)} />
          </ReqRow>
        )}
        {cfg.showBsIssues && (
          <ReqRow label="Blood Sugar Issues" missing={state.bloodSugarIssues === undefined}>
            <PillPair
              value={state.bloodSugarIssues}
              onChange={(v) => update("bloodSugarIssues", v)}
            />
          </ReqRow>
        )}
        {cfg.showLmn && (
          <ReqRow label="Letter of MN on File" missing={state.lmn === undefined}>
            <LmnPills value={state.lmn} onChange={(v) => update("lmn", v)} />
          </ReqRow>
        )}
        {cfg.showOow && (
          <ReqRow
            label="OOW Date"
            missing={!state.oowDate || (oowCheck !== null && !oowCheck.valid)}
            hint={
              oowCheck === null ? undefined : oowCheck.valid ? (
                <p className="text-xs mt-0.5 text-[color:var(--mm-teal)]">
                  Out of warranty {formatOowDiff(oowCheck.diffDays)} ago
                </p>
              ) : (
                <p className="text-xs mt-0.5 text-[color:var(--mm-rose)]">
                  Date is in the future — pump still under warranty (OOW in{" "}
                  {formatOowDiff(oowCheck.diffDays)})
                </p>
              )
            }
          >
            <Input
              type="date"
              value={state.oowDate ?? ""}
              onChange={(e) => update("oowDate", e.target.value || undefined)}
              className="w-[170px] h-9 text-sm shrink-0"
            />
          </ReqRow>
        )}
        {cfg.showOowOnScript && (
          <ReqRow label="OOW on Script" missing={state.oowDateOnScript === undefined}>
            <PillPair
              value={state.oowDateOnScript}
              onChange={(v) => update("oowDateOnScript", v)}
            />
          </ReqRow>
        )}
        {cfg.showMalfunction && (
          <ReqRow label="Malfunction" missing={state.malfunction === undefined}>
            <PillPair value={state.malfunction} onChange={(v) => update("malfunction", v)} />
          </ReqRow>
        )}
      </div>
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
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        MR Expiry Date
      </p>
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
      <p className={cn("text-xs", expired ? "text-[color:var(--mm-rose)]" : "text-muted-foreground")}>
        {lastVisit
          ? expired
            ? "Expired — medical records are older than 6 months"
            : "Auto-set: Last Visit + 6 months"
          : "Auto-set: Last Visit + 6 months"}
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
  const [newCode, setNewCode] = useState("");
  const [customCodes, setCustomCodes] = useState<string[]>([]);
  const [mondayOptions, setMondayOptions] = useState<
    { index: number; label: string }[] | null
  >(null);

  // Fetch live diagnosis options from Monday on first open
  useEffect(() => {
    if (!open || mondayOptions !== null) return;
    if (!hasToken()) return;
    fetchStatusOptions(COL.diagnosis)
      .then((opts) => setMondayOptions(opts))
      .catch(() => setMondayOptions([]));
  }, [open, mondayOptions]);

  // All codes from Monday + custom, sorted, excluding non-ICD placeholders
  const allCodes = useMemo(() => {
    const mondayLabels = (mondayOptions ?? [])
      .map((o) => o.label)
      .filter((l) => l !== "Evaluate" && l !== "Collect");
    const set = new Set<string>(mondayLabels);
    for (const c of customCodes) set.add(c);
    return [...set].sort();
  }, [mondayOptions, customCodes]);

  const handleAddCode = () => {
    const code = newCode.trim().toUpperCase();
    if (!code) return;
    if (!allCodes.includes(code)) {
      setCustomCodes((prev) => [...prev, code]);
    }
    onChange(code);
    setNewCode("");
    setOpen(false);
  };

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
  const favorites = DIAGNOSIS_FAVORITES.filter((c) => allCodes.includes(c));
  const otherCodes = allCodes.filter((c) => !DIAGNOSIS_FAVORITES.includes(c));

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Diagnosis <span className="font-bold text-[color:var(--mm-rose)]">*</span>
        {!value && (
          <span className="ml-1 normal-case tracking-normal text-[color:var(--mm-rose)]">
            — required
          </span>
        )}
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full h-9 px-3 text-sm font-medium justify-between",
              value
                ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-50/80 hover:text-emerald-900"
                : "border-muted text-muted-foreground",
            )}
          >
            {value || "Select diagnosis"}
            <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="end">
          <Command>
            <CommandInput placeholder="Search ICD-10..." className="h-9" />
            <CommandList>
              <CommandEmpty>
                <span className="text-xs text-muted-foreground">No matching code — add it below.</span>
              </CommandEmpty>
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
              {favorites.length > 0 && (
                <CommandGroup heading="★ Most Common">
                  {favorites.map(renderItem)}
                </CommandGroup>
              )}
              <CommandGroup heading="All Diagnoses">
                {otherCodes.map(renderItem)}
              </CommandGroup>
            </CommandList>
          </Command>
          {/* Add new code */}
          <div className="border-t px-2 py-2 flex items-center gap-2">
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCode();
                }
              }}
              placeholder="New ICD-10 code…"
              className="flex-1 h-7 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs gap-1"
              disabled={!newCode.trim()}
              onClick={handleAddCode}
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>
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
                if (!u) return;
                const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(u)}&embedded=true`;
                window.open(viewerUrl, "_blank");
              }}
              className="h-7 px-2 text-[11px] gap-1"
            >
              <ExternalLink className="h-3 w-3" /> View
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!f.public_url && !f.url}
              onClick={async () => {
                const u = f.public_url || f.url;
                if (!u) return;
                try {
                  const bytes = await fetchAssetBytes(u, f.name);
                  const blob = new Blob([bytes as BlobPart]);
                  const blobUrl = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = blobUrl;
                  a.download = f.name || "file";
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(blobUrl);
                } catch {
                  window.open(u, "_blank");
                }
              }}
              className="h-7 px-2 text-[11px] gap-1"
            >
              <Download className="h-3 w-3" /> Download
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
  /** Hide the in-card label text (when the section already renders a title above). */
  hideLabel?: boolean;
  /** "green" = the active column to upload into (mint wash); "gray" = de-emphasized. */
  tone?: "green" | "gray";
  files: LocalFile[];
  mondayFiles: MondayFileEntry[];
  mondayLoading: boolean;
  trackedFiles?: TrackedFile[];
  itemId: string;
  columnId: string;
  onRefetch: () => Promise<void>;
  onAdd: (files: LocalFile[]) => void;
  onAddRaw?: (files: File[]) => void;
  onRemove: (idx: number) => void;
}

function FileUploadCard({
  label,
  hideLabel,
  tone,
  files,
  mondayFiles,
  mondayLoading,
  trackedFiles,
  itemId,
  columnId,
  onRefetch,
  onAdd,
  onAddRaw,
  onRemove,
}: FileUploadCardProps) {
  const hasActiveUpload = (trackedFiles ?? []).some(
    (f) => f.status === "uploading" || f.status === "confirming",
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);

  const handleDeleteMondayFile = async (target: MondayFileEntry) => {
    if (!confirm(`Delete "${target.name}" from Monday? This cannot be undone.`)) return;
    setDeletingAssetId(target.assetId);
    try {
      const keepFiles = mondayFiles
        .filter((f) => f.assetId !== target.assetId)
        .map((f) => ({ name: f.name, url: f.public_url || f.url }));
      await deleteSingleFileFromColumn(itemId, columnId, keepFiles);
      toast.success(`Deleted "${target.name}" from Monday`);
      await onRefetch();
    } catch (e) {
      toast.error("Delete failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeletingAssetId(null);
    }
  };

  const toggleSelect = (assetId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === mondayFiles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(mondayFiles.map((f) => f.assetId)));
    }
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const next: LocalFile[] = Array.from(fileList).map((f) => ({
      name: f.name,
      size: f.size,
      addedAt: new Date().toISOString(),
    }));
    onAdd(next);
    if (onAddRaw) onAddRaw(Array.from(fileList));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const downloadFile = async (f: MondayFileEntry) => {
    const url = f.public_url || f.url;
    if (!url) return;
    try {
      const bytes = await fetchAssetBytes(url, f.name);
      const blob = new Blob([bytes as BlobPart]);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = f.name || "file";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // fallback: open in new tab
      window.open(url, "_blank");
    }
  };

  const downloadSelected = async () => {
    const toDownload = selected.size > 0
      ? mondayFiles.filter((f) => selected.has(f.assetId))
      : mondayFiles;
    if (toDownload.length === 0) return;
    setDownloading(true);
    for (const f of toDownload) {
      await downloadFile(f);
      // small delay so browser doesn't choke on rapid downloads
      await new Promise((r) => setTimeout(r, 400));
    }
    setDownloading(false);
  };

  const downloadCount = selected.size > 0 ? selected.size : mondayFiles.length;
  const downloadLabel = selected.size > 0
    ? `Download selected (${selected.size})`
    : `Download all (${mondayFiles.length})`;

  return (
    <div
      className={`rounded-lg p-3 h-full flex flex-col gap-2 min-h-[200px] relative overflow-hidden transition-all duration-300 ${
        hasActiveUpload
          ? "border-2 border-red-500 bg-red-50/30 animate-[pulse-border_1.5s_ease-in-out_infinite]"
          : tone === "gray"
            ? "border bg-muted/40"
            : "border bg-muted/20"
      }`}
      style={
        hasActiveUpload
          ? { animation: "pulse-border 1.5s ease-in-out infinite" }
          : tone === "green"
            ? { background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }
            : undefined
      }
    >
      {/* Flashing upload overlay */}
      {hasActiveUpload && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-red-600/90 rounded-lg animate-[flash-red_1s_ease-in-out_infinite]">
          <Loader2 className="h-10 w-10 text-white animate-spin mb-2" />
          <p className="text-white text-sm font-bold uppercase tracking-wider">
            Uploading to Monday…
          </p>
          <p className="text-red-200 text-xs mt-1">
            Do not advance — waiting for server confirmation
          </p>
        </div>
      )}
      {/* Header */}
      <div className={`flex items-center gap-2 ${hideLabel ? "justify-end" : "justify-between"}`}>
        {!hideLabel && <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>}
        <Button
          variant="outline"
          size="sm"
          onClick={downloadSelected}
          disabled={mondayFiles.length === 0 || mondayLoading || downloading}
          className="h-7 px-2 text-[11px] gap-1"
          title={
            mondayFiles.length === 0
              ? "No Monday files to download"
              : downloadLabel
          }
        >
          {mondayLoading || downloading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {downloading ? "Downloading…" : downloadLabel}
        </Button>
      </div>

      {/* Monday-attached files with checkboxes */}
      {mondayFiles.length > 0 ? (
        <div className="space-y-1">
          {mondayFiles.length > 1 && (
            <button
              onClick={selectAll}
              className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1 mb-0.5"
            >
              {selected.size === mondayFiles.length ? "Deselect all" : "Select all"}
            </button>
          )}
          <ul className="space-y-2">
            {mondayFiles.map((f) => {
              const isSelected = selected.has(f.assetId);
              const url = f.public_url || f.url;
              return (
                <li
                  key={f.assetId}
                  onClick={() => toggleSelect(f.assetId)}
                  className="flex items-center gap-3 text-sm rounded-[10px] px-4 py-3 cursor-pointer transition-shadow border"
                  style={{
                    background: "var(--mm-mint)",
                    borderColor: "var(--mm-mint-ring)",
                    boxShadow: isSelected ? "inset 0 0 0 1.5px var(--mm-green)" : undefined,
                  }}
                >
                  <div
                    className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? "bg-[color:var(--mm-green)] border-[color:var(--mm-green)]"
                        : "border-[color:var(--mm-mint-ring)] bg-white"
                    }`}
                  >
                    {isSelected && (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <FileText className="h-4 w-4 shrink-0 text-[color:var(--mm-teal)]" />
                  <span className="truncate font-semibold flex-1">{f.name}</span>
                  {url && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(url, "_blank");
                      }}
                      className="shrink-0 text-xs font-semibold text-[color:var(--mm-teal)] hover:underline"
                      title={`View ${f.name}`}
                    >
                      View
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteMondayFile(f);
                    }}
                    disabled={deletingAssetId === f.assetId}
                    className="shrink-0 p-0.5 rounded hover:bg-red-100 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50"
                    aria-label={`Delete ${f.name}`}
                    title="Delete from Monday"
                  >
                    {deletingAssetId === f.assetId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground italic px-1 py-1">
          No Monday files attached
        </p>
      )}

      {/* Upload drop zone */}
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
        <p className="text-[10px] text-muted-foreground">(uploads to Monday immediately on drop)</p>
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

/** Returns the list of required field labels that are visible but not yet
 *  filled in. Strict gate (redesign §9): Send is disabled until EVERY visible
 *  required field is answered. Answered-but-failing (e.g. requirement = No)
 *  does NOT block — Not Established outcomes still sync. */
function getMissingRequiredFields(
  state: EvalState,
  showCgm: boolean,
  showIp: boolean,
): string[] {
  const missing: string[] = [];
  const cgmOn = showCgm && state.cgmScriptReceived === "Yes";
  const ipOn = showIp && state.ipScriptReceived === "Yes";

  // Validity — required for any received script
  if (cgmOn && state.cgmScriptValid === undefined) missing.push("CGM Script validity");
  if (ipOn && state.ipScriptValid === undefined) missing.push("IP Script validity");

  // Diagnosis & Last Visit — required when Clinicals received
  if (state.mrReceived === "Yes") {
    if (!state.diagnosis) missing.push("Diagnosis");
    if (!state.lastVisitDate) missing.push("Last Visit Date");
  }

  // Coverage paths — required per visible section
  if (cgmOn && !state.cgmCoveragePath) missing.push("CGM Coverage Path");
  if (ipOn) {
    if (!state.ipCoveragePath) {
      missing.push("Insulin Pump Coverage Path");
    } else {
      const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
      if (cfg.showEducation && state.diabetesEducation === undefined) missing.push("Diabetes Education");
      if (cfg.show3Injections && state.threeInjections === undefined) missing.push("3+ Injections / Day");
      if (cfg.showCgmUse && state.cgmUse === undefined) missing.push("CGM Use");
      if (cfg.showBsIssues && state.bloodSugarIssues === undefined) missing.push("Blood Sugar Issues");
      if (cfg.showLmn && state.lmn === undefined) missing.push("Letter of MN on File");
      if (cfg.showOow && !state.oowDate) missing.push("OOW Date");
      if (cfg.showOowOnScript && state.oowDateOnScript === undefined) missing.push("OOW on Script");
      if (cfg.showMalfunction && state.malfunction === undefined) missing.push("Malfunction");
    }
  }

  return missing;
}

interface ValiditySummaryProps {
  validity: ReturnType<typeof deriveValidity>;
  preview: ReturnType<typeof buildMondayPreview>;
  onSendToMonday: () => void;
  sending: boolean;
  sendErrors?: string[];
  noteAdded?: boolean;
  pendingNoteText?: string;
  state: EvalState;
  showCgm: boolean;
  showIp: boolean;
  patient: Patient;
  escalated: boolean;
  onToggleEscalate: () => void;
  onOpenForm?: () => void;
  filesUploading?: boolean;
}

function ValiditySummary({
  validity,
  preview,
  onSendToMonday,
  sending,
  sendErrors = [],
  noteAdded = true,
  pendingNoteText = "",
  state,
  showCgm,
  showIp,
  patient,
  escalated,
  onToggleEscalate,
  onOpenForm,
  filesUploading,
}: ValiditySummaryProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const missingFields = getMissingRequiredFields(state, showCgm, showIp);
  const hasPendingNote = pendingNoteText.trim().length > 0;
  const noteBlocked = !noteAdded || hasPendingNote;
  const blocked = missingFields.length > 0 || noteBlocked;
  return (
    <section className="rounded-xl bg-card border shadow-card p-5 space-y-4">

      {/* Outcome chips + MN status */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <OutcomeChip
          label="General"
          state={validity.sections.diagnosis.valid && validity.sections.mr.valid ? "ok" : "bad"}
        />
        <OutcomeChip
          label="CGM"
          state={!validity.sections.cgm.shown ? "na" : validity.sections.cgm.valid ? "ok" : "bad"}
        />
        <OutcomeChip
          label="Insulin Pump"
          state={!validity.sections.ip.shown ? "na" : validity.sections.ip.valid ? "ok" : "bad"}
        />
        <span className="text-muted-foreground">→</span>
        <span
          className="text-lg font-extrabold tracking-tight"
          style={{ color: validity.established ? "var(--mm-teal)" : "var(--mm-rose)" }}
        >
          Medical Necessity {validity.established ? "Established" : "Not Established"}
        </span>
      </div>

      {!validity.established && validity.reasons.length > 0 && (
        <div
          className="rounded-lg px-3.5 py-2.5 text-sm"
          style={{ background: "var(--mm-rose-soft)", color: "oklch(0.5 0.12 18)" }}
        >
          <b style={{ color: "var(--mm-rose)" }}>Reasons:</b> {validity.reasons.join(" · ")}
        </div>
      )}

      {/* Per-field Monday write failures from the last Send — persistent
          until the next Send attempt. */}
      {sendErrors.length > 0 && (
        <div
          className="rounded-lg border-2 px-3.5 py-2.5 text-sm"
          style={{
            background: "var(--mm-rose-soft)",
            borderColor: "var(--mm-rose)",
            color: "oklch(0.5 0.12 18)",
          }}
        >
          <p className="font-bold flex items-center gap-1.5" style={{ color: "var(--mm-rose)" }}>
            <AlertTriangle className="h-4 w-4" />
            {sendErrors.length} field{sendErrors.length > 1 ? "s" : ""} failed to write to Monday
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {sendErrors.map((e) => (
              <li key={e} className="text-xs break-words">• {e}</li>
            ))}
          </ul>
          <p className="text-xs mt-1.5 italic">
            Other fields were written. Fix the issue (e.g. a label that doesn't exist on the
            Monday board) and press Send again.
          </p>
        </div>
      )}



      {/* Collapsible Monday Preview */}
      <button
        type="button"
        onClick={() => setPreviewOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", previewOpen && "rotate-90")} />
        Monday Preview
      </button>
      {previewOpen && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <MondayPreviewPanel preview={preview} />
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        {missingFields.length > 0 && (
          <span
            className="text-xs font-medium self-center text-right"
            style={{ color: "var(--mm-rose)" }}
            title={missingFields.join(", ")}
          >
            {missingFields.length} required field{missingFields.length > 1 ? "s" : ""} remaining:{" "}
            {missingFields.slice(0, 4).join(", ")}
            {missingFields.length > 4 ? "…" : ""}
          </span>
        )}
        {noteBlocked && (
          <span className="text-xs font-medium self-center text-right" style={{ color: "var(--mm-rose)" }}>
            {hasPendingNote
              ? "Press Add on your note before sending"
              : "Add at least one MN Workflow note to send"}
          </span>
        )}
        {filesUploading && (
          <div className="flex items-start gap-2 rounded-lg border-2 border-red-400 bg-red-50 px-3 py-2 max-w-sm animate-pulse">
            <Loader2 className="h-4 w-4 text-red-600 shrink-0 mt-0.5 animate-spin" />
            <div>
              <p className="text-xs font-bold text-red-800 uppercase tracking-wide">
                Files uploading to Monday
              </p>
              <p className="text-[11px] text-red-700 mt-0.5">
                Do NOT advance until upload is confirmed
              </p>
            </div>
          </div>
        )}
        {/* <EscalateButton
          escalated={escalated}
          onToggle={onToggleEscalate}
          onOpenForm={onOpenForm}
          disabled={sending}
        /> */}
        <Button
          size="lg"
          onClick={onSendToMonday}
          disabled={sending || blocked || filesUploading}
          className="gap-2 text-white shadow-elevate bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
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

      {blocked && (
        <p className="text-xs text-muted-foreground text-center pt-1">
          Every visible evaluation field must be filled out — even if the answer is Missing or No —
          so we have a complete record of what was checked before syncing to Monday.
        </p>
      )}
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

/* ── Segmented toggle field (industry-standard pill selector) ── */
function ToggleField({
  label,
  value,
  onChange,
  optionA = "Yes",
  optionB = "No",
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  optionA?: string;
  optionB?: string;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground mb-1.5">{label}</p>
      <div className="flex rounded-lg border border-border bg-muted/30 p-0.5 w-full max-w-[280px]">
        <button
          onClick={() => onChange(optionA)}
          className={cn(
            "flex-1 py-2.5 rounded-md text-sm font-medium transition-all",
            value === optionA
              ? "bg-emerald-500 text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {optionA}
        </button>
        <button
          onClick={() => onChange(optionB)}
          className={cn(
            "flex-1 py-2.5 rounded-md text-sm font-medium transition-all",
            value === optionB
              ? "bg-red-500 text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {optionB}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Redesign components (Evaluate v2 — Brandon, June 2026)
// =====================================================================

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Step card — white, 1px border, 4px left border in mm-green, numbered
 *  36px circle (green-12% bg, teal text, mint ring). */
function MmStep({
  num,
  title,
  rightAccessory,
  children,
}: {
  num: number;
  title: string;
  rightAccessory?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl bg-card border border-l-4 p-6 shadow-sm"
      style={{ borderColor: "var(--mm-card-border)", borderLeftColor: "var(--mm-green)" }}
    >
      <header className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="grid place-items-center h-9 w-9 rounded-full text-base font-bold shrink-0"
            style={{
              background: "var(--mm-green-12)",
              color: "var(--mm-teal)",
              boxShadow: "inset 0 0 0 1px var(--mm-mint-ring)",
            }}
          >
            {num}
          </span>
          <h2 className="text-xl font-bold tracking-tight truncate">{title}</h2>
        </div>
        {rightAccessory}
      </header>
      {children}
    </section>
  );
}

/** Inner subcard with teal icon + title. */
function SubCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border bg-card p-5 shadow-sm"
      style={{ borderColor: "var(--mm-card-border)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[color:var(--mm-teal)]">{icon}</span>
        <h3 className="text-base font-bold tracking-tight">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/** Segmented Valid/Invalid button. Hover tint only applies to UNSELECTED
 *  buttons; selected stays solid while hovered. */
function SegBtn({
  selected,
  tone,
  onClick,
  children,
}: {
  selected: boolean;
  tone: "green" | "rose";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const green = tone === "green";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex-1 px-4 py-2.5 rounded-md text-sm font-semibold border-2 transition-all",
        selected
          ? green
            ? "border-transparent bg-[color:var(--mm-green)] text-white shadow-sm"
            : "border-transparent bg-[color:var(--mm-rose)] text-white shadow-sm"
          : green
            ? "border-border bg-background text-muted-foreground hover:text-[color:var(--mm-teal)] hover:border-[color:var(--mm-green)] hover:bg-[color:var(--mm-green-12)]"
            : "border-border bg-background text-muted-foreground hover:text-[color:var(--mm-rose)] hover:border-[color:var(--mm-rose)] hover:bg-[color:var(--mm-rose-12)]",
      )}
    >
      {children}
    </button>
  );
}

/** Step-1 document card: title + Received/Not received + switch; mint wash
 *  when received; optional Valid/Invalid segmented control for scripts. */
function DocCard({
  title,
  received,
  fullWidth,
  showValidity,
  validity = null,
  onToggle,
  onValidity,
}: {
  title: string;
  received: boolean;
  fullWidth?: boolean;
  showValidity?: boolean;
  /** true = Valid, false = Invalid, null = unanswered */
  validity?: boolean | null;
  onToggle: (on: boolean) => void;
  onValidity?: (valid: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-5 shadow-sm transition-colors",
        fullWidth && "md:col-span-2",
        !received && "bg-muted/30",
      )}
      style={
        received
          ? { background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }
          : { borderColor: "var(--mm-card-border)" }
      }
    >
      <div className="flex items-center gap-4">
        {received ? (
          <CheckCircle2 className="h-6 w-6 shrink-0 text-[color:var(--mm-teal)]" />
        ) : (
          <FileText className="h-6 w-6 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onToggle(!received)}
            className="text-lg font-bold leading-tight text-left"
          >
            {title}
          </button>
          <p className="text-sm text-muted-foreground mt-0.5">
            {received ? "Received" : "Not received"}
          </p>
        </div>
        <Switch
          checked={received}
          onCheckedChange={onToggle}
          className="data-[state=checked]:bg-[color:var(--mm-green)]"
          aria-label={`Mark ${title} as received`}
        />
      </div>
      {showValidity && received && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Validity <span className="font-bold text-[color:var(--mm-rose)]">*</span>
            {validity === null && (
              <span className="ml-1 normal-case tracking-normal text-[color:var(--mm-rose)]">
                — required
              </span>
            )}
          </p>
          <div className="flex gap-2" role="radiogroup" aria-label={`${title} validity`}>
            <SegBtn selected={validity === true} tone="green" onClick={() => onValidity?.(true)}>
              Valid
            </SegBtn>
            <SegBtn selected={validity === false} tone="rose" onClick={() => onValidity?.(false)}>
              Invalid
            </SegBtn>
          </div>
        </div>
      )}
    </div>
  );
}

/** Full-width coverage-path select. */
function PathSelect({
  value,
  options,
  onChange,
  missing,
}: {
  value?: string;
  options: StatusOption[];
  onChange: (label: string) => void;
  missing?: boolean;
}) {
  return (
    <div>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger
          className="w-full h-10 text-sm"
          style={missing ? { borderColor: "oklch(0.62 0.13 18 / 0.45)" } : undefined}
        >
          <SelectValue placeholder="Select coverage path" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.index} value={o.label} className="text-sm">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {missing && (
        <p className="text-xs mt-1 text-[color:var(--mm-rose)]">Required</p>
      )}
    </div>
  );
}

/** Bordered requirement row — label + * left, control right. Unanswered
 *  rows get a rose-tinted border. */
function ReqRow({
  label,
  missing,
  hint,
  children,
}: {
  label: string;
  missing: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 bg-card"
      style={{
        borderColor: missing ? "oklch(0.62 0.13 18 / 0.45)" : "var(--mm-card-border)",
      }}
    >
      <div className="min-w-0">
        <span className="text-sm font-medium">
          {label} <span className="font-bold text-[color:var(--mm-rose)]">*</span>
        </span>
        {hint}
      </div>
      {children}
    </div>
  );
}

/** No/Yes pill-pair capsule — No fills rose, Yes fills green, unselected
 *  muted in a gray capsule. */
function PillPair({
  value,
  onChange,
}: {
  value?: YesNo;
  onChange: (v: YesNo) => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-muted/70 p-[3px] shrink-0"
      role="radiogroup"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "No"}
        onClick={() => onChange("No")}
        className={cn(
          "text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all",
          value === "No"
            ? "bg-[color:var(--mm-rose)] text-white shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        No
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "Yes"}
        onClick={() => onChange("Yes")}
        className={cn(
          "text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all",
          value === "Yes"
            ? "bg-[color:var(--mm-green)] text-white shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Yes
      </button>
    </span>
  );
}

/** Letter-of-MN pill trio — keeps Monday's three labels (No / Yes, but
 *  Invalid / Yes & Valid) so the "Updated LMN" ask survives downstream. */
function LmnPills({
  value,
  onChange,
}: {
  value?: LmnStatus;
  onChange: (v: LmnStatus) => void;
}) {
  const opts: { label: LmnStatus; cls: string }[] = [
    { label: "No", cls: "bg-[color:var(--mm-rose)] text-white shadow-sm" },
    { label: "Yes, but Invalid", cls: "bg-amber-500 text-white shadow-sm" },
    { label: "Yes & Valid", cls: "bg-[color:var(--mm-green)] text-white shadow-sm" },
  ];
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-muted/70 p-[3px] shrink-0 flex-wrap justify-end"
      role="radiogroup"
    >
      {opts.map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={value === o.label}
          onClick={() => onChange(o.label)}
          className={cn(
            "text-xs font-semibold px-3 py-1.5 rounded-full transition-all whitespace-nowrap",
            value === o.label ? o.cls : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** Last Visit Date — required when Clinicals received; cannot be in the future. */
function LastVisitField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (v: string) => void;
}) {
  const future = !!value && value > todayIso();
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Last Visit Date <span className="font-bold text-[color:var(--mm-rose)]">*</span>
      </p>
      <Input
        type="date"
        value={value ?? ""}
        max={todayIso()}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm h-9"
      />
      {!value ? (
        <p className="text-xs text-[color:var(--mm-rose)]">Required when Clinicals received</p>
      ) : future ? (
        <p className="text-xs text-[color:var(--mm-rose)]">Cannot be after today</p>
      ) : null}
    </div>
  );
}

/** Locked Final-Clinicals dropzone — unlocks live when MN is Established. */
function LockedDropzone() {
  return (
    <div className="h-full min-h-[200px] rounded-xl border-2 border-dashed border-border bg-muted/40 flex flex-col items-center justify-center gap-1.5 text-muted-foreground p-6 text-center cursor-not-allowed">
      <Lock className="h-5 w-5" />
      <p className="text-sm font-medium">Locked</p>
      <p className="text-xs">available once Medical Necessity is Established</p>
    </div>
  );
}

/** Outcome chip — ✓ mint / ✕ rose / ○ N/A gray. */
function OutcomeChip({ label, state }: { label: string; state: "ok" | "bad" | "na" }) {
  if (state === "na") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold bg-muted/60 text-muted-foreground">
        ○ {label} N/A
      </span>
    );
  }
  return state === "ok" ? (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold"
      style={{
        background: "oklch(0.94 0.02 175 / 0.7)",
        color: "var(--mm-teal)",
        boxShadow: "inset 0 0 0 1px var(--mm-mint-ring)",
      }}
    >
      ✓ {label}
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold"
      style={{
        background: "var(--mm-rose-soft)",
        color: "var(--mm-rose)",
        boxShadow: "inset 0 0 0 1px oklch(0.62 0.13 18 / 0.3)",
      }}
    >
      ✕ {label}
    </span>
  );
}
