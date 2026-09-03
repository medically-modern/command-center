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
  loadEvalStateForPatient,
  saveEvalState,
  isOowDateValid,
  formatOowDiff,
  getMrExpiry,
  deriveValidity,
  buildMondayPreview,
  computeIpReasonLists,
  computeCgmInvalidReasons,
  buildScriptCoverageWrites,
  type ScriptCoverageField,
  type EvalState,
  type LocalFile,
  type CgmCoveragePath,
  type LmnStatus,
  type ValidInvalid,
  type YesNo,
  type YesNoInvalid,
  type Received4,
} from "@/lib/masheke/evalState";
import { useMondayFiles } from "@/hooks/masheke/useMondayFiles";
import { BOARD_ID,
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
  writeText,
  buildDoctorWriteTasks,
  uploadFileToColumn,
  type MondayFileEntry,
} from "@/lib/masheke/mondayApi";
import { runVerifiedSend } from "@/lib/masheke/mondayWrite";
import type { WriteTask } from "@/lib/shared/verifiedWrite";
import { GEN_SCRIPT_STATUS, ESCALATION_INDEX } from "@/lib/masheke/mondayMapping";
import { etToday } from "@/lib/masheke/etDate";
import { buildAttemptRollup } from "@/lib/masheke/attemptRollup";
import { assertTextLikeFits } from "@/lib/shared/longText";
import { EscalateButton } from "@/components/masheke/EscalateButton";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
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
  ChevronDown,
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
  /** Viewing a stage this patient already finished (opened from a System
   *  Management completion badge). The panel still renders every answer the rep
   *  gave — it just can't re-advance an item that has already moved on. */
  reviewMode?: boolean;
  /** The send landed and the patient has left this stage — the page takes them
   *  off screen immediately instead of leaving them in the queue, with a live
   *  Send button, until the next 30s poll. Not called when the send escalates
   *  without advancing: that patient stays in Evaluate MN. */
  onAdvanced?: () => void;
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
  // Format YYYY-MM-DD directly (no Date parsing — avoids UTC off-by-one) → MM/DD/YYYY,
  // matching the native <input type="date"> display used for Last Visit Date.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export function EvaluatePanel({ patient, resetVersion = 0, onUpdate, onOpenForm, reviewMode = false, onAdvanced }: Props) {
  const accent = getServingAccent(patient.serving);
  // Monday is the source of truth: local drafts are merged UNDER Monday's
  // current column values (loadEvalStateForPatient), never over them.
  const [state, setState] = useState<EvalState>(() => loadEvalStateForPatient(patient));

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
  // Monday-backed fields always come from Monday (see loadEvalStateForPatient).
  useEffect(() => {
    setState(loadEvalStateForPatient(patient));
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

  // After an immediate upload settles (every file confirmed or errored),
  // re-read Monday's file columns so the Monday-attached list updates without
  // a page reload. A second silent refetch on the confirm-poll cadence (2.5s)
  // covers the fast path where Monday returns the asset id before the column
  // read reflects the new file. Stale-patient refetches are ignored inside
  // useMondayFiles, so the delayed call is safe across patient switches.
  const { refetch: refetchMondayFiles } = mondayFiles;
  const refetchFilesAfterUpload = useCallback(() => {
    void refetchMondayFiles();
    window.setTimeout(() => void refetchMondayFiles(), 2500);
  }, [refetchMondayFiles]);

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
    // Defense-in-depth gate (the Send button is also disabled on these). Blocks
    // advancing the patient to the next board while a clinical file is still
    // uploading — a mid-upload advance would move the item with no confirmed
    // clinical package — and enforces required fields + an added note.
    if (filesUploading) {
      toast.error("Files are still uploading to Monday — wait until they're confirmed before completing.");
      return;
    }
    const missingNow = getMissingRequiredFields(state, showCgm, showIp);
    if (missingNow.length > 0) {
      toast.error(`Fill in required fields first: ${missingNow.slice(0, 4).join(", ")}${missingNow.length > 4 ? "…" : ""}`);
      return;
    }
    if (!noteAdded || pendingNoteText.trim().length > 0) {
      toast.error(pendingNoteText.trim().length > 0 ? "Press Add on your note before sending" : "Add at least one MN Workflow note to send");
      return;
    }
    setSending(true);
    setSendErrors([]);
    const tasks: WriteTask[] = [];

    const clinReceived = state.mrReceived === "Yes";
    const cgmReceived = state.cgmScriptReceived === "Yes";
    const ipReceived = state.ipScriptReceived === "Yes";

    // Each task carries BOTH a raw `value` (used by the gateway /send fast path)
    // and an `fn` (the client-side fallback) so the two stay in lockstep. Clears
    // assert expectedText "" so a clear that didn't take fails verification
    // (instead of falsely passing as an unchanged column).
    const pushLabel = (label: string, columnId: string, labelValue: string, createLabels = false) =>
      tasks.push({ label, columnId, value: { label: labelValue }, expectedText: labelValue, fn: () => writeStatusLabel(patient.id, columnId, labelValue, createLabels) });
    const pushClearStatus = (label: string, columnId: string) =>
      tasks.push({ label, columnId, value: null, expectedText: "", fn: () => clearStatusColumn(patient.id, columnId) });
    const pushClearDate = (label: string, columnId: string) =>
      tasks.push({ label, columnId, value: null, expectedText: "", fn: () => clearDateColumn(patient.id, columnId) });
    const pushDate = (label: string, columnId: string, date: string) =>
      tasks.push({ label, columnId, value: { date }, fn: () => writeDate(patient.id, columnId, date) });
    const pushDropdown = (label: string, columnId: string, labels: string[], createLabels = false) =>
      tasks.push({ label, columnId, value: { labels }, fn: () => writeDropdownLabels(patient.id, columnId, labels, createLabels) });

    // Coverage paths + CGM Language — every selection persists (saved whenever the
    // product is served; "Not Serving" only when greyed/not served). Single source
    // of truth in buildScriptCoverageWrites so the write matches the read-back.
    const COVERAGE_WRITE_META: Record<ScriptCoverageField, { col: string; label: string }> = {
      ipCoveragePath: { col: COL.ipCoveragePath, label: "IP Coverage Path" },
      cgmCoveragePath: { col: COL.cgmCoveragePath, label: "CGM Coverage Path" },
      cgmLanguage: { col: COL.cgmLanguage, label: "CGM Language" },
    };
    for (const cw of buildScriptCoverageWrites(state, showCgm, showIp)) {
      const meta = COVERAGE_WRITE_META[cw.field];
      if (cw.value === null) pushClearStatus(meta.label, meta.col);
      else pushLabel(meta.label, meta.col, cw.value);
    }
    // Diagnosis / Last Visit / MR Expiry — only synced while the Clinicals
    // section is visible (Clinicals received). When hidden, leave Monday untouched.
    if (clinReceived) {
      // Diagnosis is the ONLY status column allowed to create new labels (reps
      // can add new ICD-10 codes) — createLabelsIfMissing on the /send below.
      if (state.diagnosis) pushLabel("Diagnosis", COL.diagnosis, state.diagnosis, true);
      else pushClearStatus("Diagnosis", COL.diagnosis);
    }
    // Script Received columns — the switch is always an answer: off = "No".
    if (showCgm) pushLabel("CGM Script Received", COL.cgmScriptReceived, cgmReceived ? "Yes" : "No");
    if (showIp) pushLabel("IP Script Received", COL.ipScriptReceived, ipReceived ? "Yes" : "No");
    // MRs / Clinicals — switch is always an answer: off = "Collect".
    pushLabel("MRs / Clinicals", COL.mrsClinicals, clinReceived ? "MR Received" : "Collect");
    if (clinReceived) {
      if (state.lastVisitDate) pushDate("Last Visit Date", COL.lastVisit, state.lastVisitDate);
      else pushClearDate("Last Visit Date (clear)", COL.lastVisit);
      const { expiry } = getMrExpiry(state.lastVisitDate);
      if (expiry) pushDate("MR Expiry Date", COL.mrExpiryDate, expiry.toISOString().slice(0, 10));
      else pushClearDate("MR Expiry Date (clear)", COL.mrExpiryDate);
    }
    pushLabel("Medical Necessity", COL.medicalNecessity, preview.medicalNecessity);
    pushDropdown("General MN Invalid Reasons", COL.generalMnInvalidReasons, preview.generalMnInvalidReasons);
    // CGM MN Invalid Reasons — reflect the rep's exact CGM answers (script /
    // coverage path / language), canonical board labels, so it stays in sync and
    // round-trips. createLabels backstops "CGM Language invalid".
    pushDropdown("CGM MN Invalid Reasons", COL.cgmMnInvalidReasons, computeCgmInvalidReasons(effState, showCgm), true);
    // IP requirement answers, split by the rep's EXACT state so No (= Missing)
    // and Invalid round-trip faithfully (Option A): Invalid → "IP MN Invalid
    // Reasons", No/Missing → "IP MN No Reasons". createLabels is a backstop; the
    // board already has these labels. Both are read back by seedRequirementsFromMonday.
    const ipReasonLists = computeIpReasonLists(effState, showIp);
    pushDropdown("IP MN Invalid Reasons", COL.ipMnInvalidReasons, ipReasonLists.invalid, true);
    pushDropdown("IP MN No Reasons", COL.ipMnNoReasons, ipReasonLists.missing, true);
    // OOW date (OOW Pump path) → its own date column so it round-trips from
    // Monday instead of cache. The "on script?" Yes/No/Invalid answer rides the
    // IP reason dropdowns above (handled in computeIpReasonLists).
    if (showIp && state.ipCoveragePath && state.ipCoveragePath !== "Not Serving") {
      const oowCfg = IP_PATH_FIELDS[state.ipCoveragePath as IpPath];
      if (oowCfg?.showOow) {
        if (state.oowDate) pushDate("OOW Date", COL.oowDateValue, state.oowDate);
        else pushClearDate("OOW Date (clear)", COL.oowDateValue);
      }
    }
    // Consolidated, doctor-facing ask list — drives the Send Request UI and the
    // MN Request Letter PDF. Allowed to create labels: the OOW ask embeds a
    // patient-specific date so it's dynamic by design.
    pushDropdown("MN Request Consolidated", COL.mnRequestConsolidated, preview.mnRequestConsolidated, true);
    // Re-eval rollup (ATOMIC + verified): fold any leftover Confirm Receipt /
    // Chase attempt notes from a PRIOR cycle into the permanent MN Workflow
    // Notes history, then blank the six attempt columns so the next cycle's
    // cards start clean. Both the append and the clears ride this one verified
    // /send mutation (change_multiple_column_values is all-or-nothing), so a
    // note can NEVER be lost — unlike a parallel append-then-clear.
    // The merge itself lives in lib/masheke/attemptRollup so this send and the
    // manager's "Send back to pipeline" (oversightApi.returnProposedToQueue)
    // write the same headers into the same notes column.
    const { hasAttempts: hasLeftover, notes: mergedNotes } = buildAttemptRollup({
      notes: patient.mnEvalNotes,
      confirm: [patient.confirmAttempt1, patient.confirmAttempt2, patient.confirmAttempt3],
      chase: [patient.chaseAttempt1, patient.chaseAttempt2, patient.chaseAttempt3],
      dateStr: etToday(),
    });
    // Monday silently truncates a long_text body over 2000 chars, dropping the
    // NEWEST content — this rollup can add ~700 in one go (lib/shared/longText).
    // ⚠️ The overflow check lives INSIDE the try below, deliberately not here.
    // It threw from this point, which is outside every catch in this handler:
    // the rep got no toast, `setSending(false)` never ran, and the Send button
    // stuck in its spinner forever. Bridget Browne (12604305734) sat like that
    // for five days — her notes were already at exactly 2000, so the send
    // required a note, any note overflowed, and every send aborted in silence
    // with nothing written to the board at all. Keep it in the try.
    tasks.push({
      label: "MN Workflow Notes",
      columnId: COL.mnEvalNotes,
      value: mergedNotes,
      fn: () => writeLongText(patient.id, COL.mnEvalNotes, mergedNotes),
    });
    if (hasLeftover) {
      for (const col of [
        COL.confirmAttempt1, COL.confirmAttempt2, COL.confirmAttempt3,
        COL.chaseAttempt1, COL.chaseAttempt2, COL.chaseAttempt3,
      ]) {
        tasks.push({ label: `Clear ${col}`, columnId: col, value: "", expectedText: "", fn: () => writeText(patient.id, col, "") });
      }
    }
    // Next Action Date → today (ET) — the patient lands in the next tab's active
    // list immediately instead of an empty/scheduled state.
    pushDate("Next Action Date → today", COL.nextActionDate, etToday());
    // ── 3rd-attempt escalation SOP ──
    // On the 3rd (or later) Evaluate pass, if Medical Necessity STILL isn't
    // established, the patient is escalated instead of going back to Send
    // Request: flag Escalation Required and DO NOT advance the stage, so the
    // patient stays in Evaluate MN for a manager to work (the oversight
    // "3rd Attempt" column). Established always completes; a not-yet-3rd pass
    // still routes to Send Request.
    // Route on the SAME `established` value we WRITE to the Medical Necessity
    // column (deriveValidity → preview.medicalNecessity), so the stage move can
    // never disagree with the written column. The old bannerMnEstablished ignored
    // Diagnosis / Last-Visit validity, so a patient with Diagnosis left at the
    // board's "Evaluate" placeholder advanced to Completed while the column was
    // written "Not Established".
    const mnEstablishedNow = validity.established;
    const attemptNum = Number(patient.evaluationCounter ?? 1) || 1;
    const sopEscalate = !mnEstablishedNow && attemptNum >= 3;

    // Escalation flag — written by the SOP above OR the manual toggle.
    if (sopEscalate || escalatedRef.current) {
      tasks.push({
        label: "Escalation → Required",
        columnId: COL.escalation,
        value: { index: ESCALATION_INDEX.required },
        fn: () => writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required),
      });
    }
    // Stage Advancer LAST (the automation trigger). Established → Completed
    // (skip Send Request); Not Established → Send Request — UNLESS the SOP
    // escalation fired, in which case we don't advance (stay in Evaluate MN).
    // Routed on the SAME banner signal the rep sees so screen and submit agree.
    const nextStage = mnEstablishedNow ? "Completed" : sopEscalate ? null : "Send Request";
    if (nextStage) {
      tasks.push({
        label: `Stage Advancer → ${nextStage}`,
        columnId: COL.subStage,
        value: { label: nextStage },
        expectedText: nextStage,
        fn: () => writeStatusLabel(patient.id, COL.subStage, nextStage),
      });
    }

    try {
      // Refuse a body Monday would silently truncate BEFORE any column is
      // written. Inside the try so the failure reaches the rep as the "Send
      // failed — stage not advanced" toast (carrying longText's character
      // count, which is actionable) and the button is released.
      await assertTextLikeFits(BOARD_ID, COL.mnEvalNotes, mergedNotes, "MN Workflow Notes");
      // Verified write → gateway /send when available. createLabelsIfMissing so
      // Diagnosis + the dynamic consolidated ask can add labels server-side.
      // Every data column is read-back confirmed before the trigger column flips
      // (file uploads are already confirmed on drop, so none are batched here).
      // When escalating without advancing, the Escalation column is the trigger
      // written last; otherwise the Stage Advancer is.
      await runVerifiedSend({
        itemId: patient.id,
        label: nextStage ? `Evaluate → ${nextStage}` : "Evaluate → Escalated",
        tasks,
        stageColumnId: nextStage ? COL.subStage : COL.escalation,
        createLabelsIfMissing: true,
      });
      // Doctor-field edits (pencil overlay) persist as a separate, non-stage write.
      const docTasks = buildDoctorWriteTasks(patient);
      if (docTasks.length) await Promise.all(docTasks.map((t) => t.run()));
      setSending(false);
      toast.success(nextStage ? `Sent to Monday — moved to ${nextStage}` : "Sent to Monday — patient escalated");
      setEscalated(false); escalatedRef.current = false;
      // Reflect the rolled-up notes + cleared attempt columns locally.
      if (hasLeftover) {
        onUpdate({
          mnEvalNotes: mergedNotes,
          confirmAttempt1: undefined, confirmAttempt2: undefined, confirmAttempt3: undefined,
          chaseAttempt1: undefined, chaseAttempt2: undefined, chaseAttempt3: undefined,
        });
      }
      // LAST, and only on an advance: this unmounts the panel (the patient
      // leaves the queue), so everything above must already have run. A send
      // that escalated without advancing leaves them in Evaluate MN, where they
      // still belong.
      if (nextStage) onAdvanced?.();
    } catch (e) {
      setSending(false);
      const msg = e instanceof Error ? e.message : String(e);
      setSendErrors([msg]);
      toast.error("Send failed — stage not advanced", {
        description: msg,
        duration: 10000,
      });
    }
  }, [patient, state, validity, preview, showCgm, showIp, filesUploading, noteAdded, pendingNoteText, onAdvanced]);

  // ── Evaluate redesign (prototype) ──
  // Attempt counter — pulled from Monday's Evaluation Counter column.
  const attempt = patient.evaluationCounter ?? 1;

  // Map the new 4-state "Received?" controls onto the existing fields so the
  // Monday send/validity logic keeps working.
  const cgmReceivedVal: Received4 | undefined = !showCgm
    ? "Not Serving"
    : state.cgmCoveragePath === "Not Serving"
      ? "Not Serving"
      : state.cgmScriptReceived === "Yes"
        ? state.cgmScriptValid === "Invalid"
          ? "Invalid"
          : "Yes"
        : state.cgmScriptReceived === "No"
          ? "No"
          : undefined;
  const ipReceivedVal: Received4 | undefined = !showIp
    ? "Not Serving"
    : state.ipCoveragePath === "Not Serving"
      ? "Not Serving"
      : state.ipScriptReceived === "Yes"
        ? state.ipScriptValid === "Invalid"
          ? "Invalid"
          : "Yes"
        : state.ipScriptReceived === "No"
          ? "No"
          : undefined;

  const setCgmReceived = (v?: Received4) => {
    if (!v) {
      update("cgmScriptReceived", undefined);
      update("cgmScriptValid", undefined);
      if (state.cgmCoveragePath === "Not Serving") update("cgmCoveragePath", undefined);
      return;
    }
    if (v === "Yes") {
      update("cgmScriptReceived", "Yes");
      update("cgmScriptValid", "Valid");
      if (state.cgmCoveragePath === "Not Serving") update("cgmCoveragePath", undefined);
    } else if (v === "Invalid") {
      update("cgmScriptReceived", "Yes");
      update("cgmScriptValid", "Invalid");
      if (state.cgmCoveragePath === "Not Serving") update("cgmCoveragePath", undefined);
    } else if (v === "No") {
      update("cgmScriptReceived", "No");
      update("cgmScriptValid", undefined);
    } else {
      update("cgmScriptReceived", "No");
      update("cgmCoveragePath", "Not Serving");
    }
  };
  const setIpReceived = (v?: Received4) => {
    if (!v) {
      update("ipScriptReceived", undefined);
      update("ipScriptValid", undefined);
      if (state.ipCoveragePath === "Not Serving") update("ipCoveragePath", undefined);
      return;
    }
    if (v === "Yes") {
      update("ipScriptReceived", "Yes");
      update("ipScriptValid", "Valid");
      if (state.ipCoveragePath === "Not Serving") update("ipCoveragePath", undefined);
    } else if (v === "Invalid") {
      update("ipScriptReceived", "Yes");
      update("ipScriptValid", "Invalid");
      if (state.ipCoveragePath === "Not Serving") update("ipCoveragePath", undefined);
    } else if (v === "No") {
      update("ipScriptReceived", "No");
      update("ipScriptValid", undefined);
    } else {
      update("ipScriptReceived", "No");
      update("ipCoveragePath", "Not Serving");
    }
  };
  const setClinReceived = (v?: YesNoInvalid) => {
    update("clinReceived3", v);
    update("mrReceived", v === undefined ? undefined : v === "No" ? "No" : "Yes");
  };

  const cgmServed = showCgm && cgmReceivedVal !== "Not Serving";
  const ipServed = showIp && ipReceivedVal !== "Not Serving";
  // Coverage-path / language / evaluation answers are only *required* when the
  // corresponding script was actually received ("Yes").
  const cgmReqReq = cgmReceivedVal === "Yes";
  const ipReqReq = ipReceivedVal === "Yes";
  // Coverage path + language controls only appear once a script is in hand —
  // received "Yes" or received-but-"Invalid". Hidden for "No"/unset, mirroring
  // how the Clinicals detail only shows once Clinicals are received.
  const cgmScriptInHand = cgmReceivedVal === "Yes" || cgmReceivedVal === "Invalid";
  const ipScriptInHand = ipReceivedVal === "Yes" || ipReceivedVal === "Invalid";

  // Applicable IP language requirements for the chosen path.
  const ipCfg =
    state.ipCoveragePath && state.ipCoveragePath !== "Not Serving"
      ? IP_PATH_FIELDS[state.ipCoveragePath]
      : null;
  const ipReqValues: YesNoInvalid[] = [];
  if (ipCfg) {
    if (ipCfg.showEducation) ipReqValues.push(state.ipEducationV ?? "No");
    if (ipCfg.show3Injections) ipReqValues.push(state.ipThreeInjectionsV ?? "No");
    if (ipCfg.showCgmUse) ipReqValues.push(state.ipCgmUseV ?? "No");
    if (ipCfg.showBsIssues) ipReqValues.push(state.ipBsIssuesV ?? "No");
    if (ipCfg.showLmn) ipReqValues.push(state.ipLmnV ?? "No");
    if (ipCfg.showMalfunction) ipReqValues.push(state.ipMalfunctionV ?? "No");
    if (ipCfg.showOowOnScript) ipReqValues.push(state.ipOowOnScriptV ?? "No");
  }

  // ── MN checklist (auto-derived from the fields above) ──
  const cgmDocChecked = cgmServed && cgmReceivedVal === "Yes";
  const ipDocChecked = ipServed && ipReceivedVal === "Yes";
  const { expired: mrExpired } = getMrExpiry(state.lastVisitDate);
  const clinDocChecked = state.clinReceived3 === "Yes" && !mrExpired;
  const cgmLangChecked =
    cgmServed &&
    (state.cgmCoveragePath === "Insulin" || state.cgmCoveragePath === "Hypo") &&
    state.cgmLanguage === "Yes";
  const ipLangChecked = ipServed && !!ipCfg && ipReqValues.every((v) => v === "Yes");

  // Single source of truth for the banner AND the submit routing — the exact
  // value written to the Medical Necessity column (deriveValidity), so the
  // on-screen banner, the written column, and the stage move can never disagree.
  const mnEstablished = validity.established;

  // 3rd-attempt escalation SOP: on the 3rd (or later) Evaluate pass with MN still
  // not established, sending escalates the patient instead of advancing to Send
  // Request — surface a warning by the Send button so the rep knows.
  const willEscalate = !mnEstablished && (Number(patient.evaluationCounter ?? 1) || 1) >= 3;

  // Send gate (reintegrated — the summary component that held this was defined
  // but never mounted, so the live button had no guard). Blocks Send until every
  // required field is answered, ≥1 note is added (and no unadded text lingers),
  // and every dropped clinical file has confirmed landing in Monday.
  const missingFields = getMissingRequiredFields(state, showCgm, showIp);
  const hasPendingNote = pendingNoteText.trim().length > 0;
  const noteBlocked = !noteAdded || hasPendingNote;
  const sendBlocked = missingFields.length > 0 || noteBlocked || filesUploading || reviewMode;
  // Live per-file upload status so the rep watches each file go Uploading →
  // Confirming → Confirmed (or Error) instead of guessing whether it landed.
  const uploadFiles = [...clinicalUpload.files, ...finalClinicalUpload.files];

  const cgmLangLabel =
    state.cgmCoveragePath === "Hypo" ? "Hypoglycemia Language" : "Insulin Language";

  return (
    <div className="space-y-6">
      {/* ── Evaluate Attempt counter ── */}
      <div
        className="rounded-2xl border border-l-4 px-6 py-4 shadow-sm"
        style={{ borderColor: "var(--mm-card-border)", borderLeftColor: "var(--mm-green)" }}
      >
        <h2 className="text-xl font-bold tracking-tight">Evaluate Attempt #{attempt}</h2>
      </div>

      {/* Banner: nothing being served */}
      {!showCgm && !showIp && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Serving is set to <strong>{patient.serving ?? "—"}</strong>. Neither CGM nor IP applies — complete the Clinicals column below.
        </div>
      )}

      {/* ── Received Clinical Files — view / download ── */}
      <MmStep num={1} title="Received Clinical Files">
        <p className="text-sm text-muted-foreground -mt-3 mb-4">
          All clinical documents gathered during collection — view or download here
        </p>
        <FileUploadCard
          label="Initial File Collection"
          hideLabel
          tone="green"
          files={state.clinicalFiles ?? []}
          mondayFiles={mondayFiles.clinicalFiles}
          mondayLoading={mondayFiles.loading}
          trackedFiles={clinicalUpload.files}
          itemId={patient.id}
          columnId={COL.clinicalFiles}
          onRefetch={mondayFiles.refetch}
          onAdd={(files) => update("clinicalFiles", [...(state.clinicalFiles ?? []), ...files])}
          onAddRaw={(rawFiles) => {
            void clinicalUpload
              .upload(patient.id, COL.clinicalFiles, rawFiles)
              .then(refetchFilesAfterUpload);
          }}
          onRemove={(idx) => {
            const next = [...(state.clinicalFiles ?? [])];
            next.splice(idx, 1);
            update("clinicalFiles", next);
          }}
        />
      </MmStep>

      {/* ── 3-column evaluation grid (always 3 columns) ── */}
      <MmStep num={2} title="Script / Clinicals Evaluation">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          {/* CGM */}
          <ProductColumn title="CGM" icon={<Activity className="h-4 w-4" />} grayed={!showCgm}>
            <RcvField
              label="CGM Script Received?"
              value={cgmReceivedVal}
              onChange={(v) => setCgmReceived(v as Received4 | undefined)}
              disabled={!showCgm}
            />
            {cgmServed && cgmScriptInHand && (
              <>
                <FieldBlock label="Coverage Path">
                  <CgmPathSelect
                    value={state.cgmCoveragePath}
                    onChange={(v) => setCgmCoveragePath(v as CgmCoveragePath)}
                    missing={cgmReqReq && !state.cgmCoveragePath}
                  />
                </FieldBlock>
                {(state.cgmCoveragePath === "Insulin" || state.cgmCoveragePath === "Hypo") && (
                  <ReqRow
                    label={cgmLangLabel}
                    required={cgmReqReq}
                    missing={state.cgmLanguage === undefined}
                  >
                    <YniPills value={state.cgmLanguage} onChange={(v) => update("cgmLanguage", v)} />
                  </ReqRow>
                )}
              </>
            )}
          </ProductColumn>

          {/* Insulin Pump */}
          <ProductColumn title="Insulin Pump" icon={<Syringe className="h-4 w-4" />} grayed={!showIp}>
            <RcvField
              label="IP Script Received?"
              value={ipReceivedVal}
              onChange={(v) => setIpReceived(v as Received4 | undefined)}
              disabled={!showIp}
            />
            {ipServed && ipScriptInHand && (
              <>
                <FieldBlock label="Coverage Path">
                  <PathSelect
                    value={state.ipCoveragePath}
                    options={IP_PATH_OPTS.filter((o) => o.label !== "Not Serving")}
                    onChange={(v) => setIpCoveragePath(v as IpPath)}
                    missing={ipReqReq && !state.ipCoveragePath}
                  />
                </FieldBlock>
                {ipCfg && ipReqValues.length > 0 && (
                  <div className="flex flex-col gap-2.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Language Requirements{ipReqReq ? " — all required" : ""}
                    </p>
                    {ipCfg.showEducation && (
                      <ReqRow label="Diabetes Education" required={ipReqReq} missing={state.ipEducationV === undefined}>
                        <YniPills
                          value={state.ipEducationV}
                          onChange={(v) => { update("ipEducationV", v); update("diabetesEducation", v === "Yes" ? "Yes" : "No"); }}
                        />
                      </ReqRow>
                    )}
                    {ipCfg.show3Injections && (
                      <ReqRow label="3+ Injections / Day" required={ipReqReq} missing={state.ipThreeInjectionsV === undefined}>
                        <YniPills
                          value={state.ipThreeInjectionsV}
                          onChange={(v) => { update("ipThreeInjectionsV", v); update("threeInjections", v === "Yes" ? "Yes" : "No"); }}
                        />
                      </ReqRow>
                    )}
                    {ipCfg.showCgmUse && (
                      <ReqRow label="CGM Use" required={ipReqReq} missing={state.ipCgmUseV === undefined}>
                        <YniPills
                          value={state.ipCgmUseV}
                          onChange={(v) => { update("ipCgmUseV", v); update("cgmUse", v === "Yes" ? "Yes" : "No"); }}
                        />
                      </ReqRow>
                    )}
                    {ipCfg.showBsIssues && (
                      <ReqRow label="Blood Sugar Issues" required={ipReqReq} missing={state.ipBsIssuesV === undefined}>
                        <YniPills
                          value={state.ipBsIssuesV}
                          onChange={(v) => { update("ipBsIssuesV", v); update("bloodSugarIssues", v === "Yes" ? "Yes" : "No"); }}
                        />
                      </ReqRow>
                    )}
                    {ipCfg.showLmn && (
                      <ReqRow label="Letter of MN on File" required={ipReqReq} missing={state.ipLmnV === undefined}>
                        <YniPills
                          value={state.ipLmnV}
                          onChange={(v) => { update("ipLmnV", v); update("lmn", v === "Yes" ? "Yes & Valid" : v === "Invalid" ? "Yes, but Invalid" : "No"); }}
                        />
                      </ReqRow>
                    )}
                    {ipCfg.showOow && (
                      <ReqRow label="OOW Date" required={ipReqReq} missing={!state.oowDate}>
                        <Input
                          type="date"
                          value={state.oowDate ?? ""}
                          onChange={(e) => update("oowDate", e.target.value || undefined)}
                          className="w-[150px] h-9 text-sm shrink-0"
                        />
                      </ReqRow>
                    )}
                    {ipCfg.showOowOnScript && (
                      <ReqRow label="OOW on Script" required={ipReqReq} missing={state.ipOowOnScriptV === undefined}>
                        <YniPills
                          value={state.ipOowOnScriptV}
                          onChange={(v) => { update("ipOowOnScriptV", v); update("oowDateOnScript", v === "Yes" ? "Yes" : "No"); }}
                        />
                      </ReqRow>
                    )}
                    {ipCfg.showMalfunction && (
                      <ReqRow label="Malfunction" required={ipReqReq} missing={state.ipMalfunctionV === undefined}>
                        <YniPills
                          value={state.ipMalfunctionV}
                          onChange={(v) => { update("ipMalfunctionV", v); update("malfunction", v === "Yes" ? "Yes" : "No"); }}
                        />
                      </ReqRow>
                    )}
                  </div>
                )}
              </>
            )}
          </ProductColumn>

          {/* Clinicals */}
          <ProductColumn title="Clinicals" icon={<ClipboardList className="h-4 w-4" />} grayed={false}>
            <RcvField
              label="Clinicals Received?"
              value={state.clinReceived3}
              onChange={(v) => setClinReceived(v as YesNoInvalid | undefined)}
              includeNotServing={false}
              includeInvalid={false}
            />
            {state.clinReceived3 !== "No" && (
              <div className="flex flex-col gap-4">
                <DiagnosisField
                  value={state.diagnosis}
                  onChange={(v) => setDiagnosis(v)}
                  required={state.clinReceived3 === "Yes"}
                />
                <LastVisitField
                  value={state.lastVisitDate}
                  onChange={(v) => setLastVisitDate(v)}
                  required={state.clinReceived3 === "Yes"}
                />
                <MrExpiryField lastVisit={state.lastVisitDate} />
              </div>
            )}
          </ProductColumn>
        </div>

        {/* ── Medical Necessity result — a banner + checklist, part of Step 2 ── */}
        <div
          className="mt-6 flex items-center gap-2.5 rounded-xl px-4 py-3"
          style={
            mnEstablished
              ? { background: "var(--mm-mint)", boxShadow: "inset 0 0 0 1px var(--mm-mint-ring)" }
              : { background: "var(--mm-rose-soft)", boxShadow: "inset 0 0 0 1px oklch(0.62 0.13 18 / 0.35)" }
          }
        >
          {mnEstablished ? (
            <Check className="h-5 w-5 shrink-0" style={{ color: "var(--mm-green)" }} />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "var(--mm-rose)" }} />
          )}
          <span
            className="text-base font-bold"
            style={{ color: mnEstablished ? "var(--mm-teal)" : "var(--mm-rose)" }}
          >
            Medical Necessity {mnEstablished ? "Established" : "Not Established"}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2.5">
              Documents
            </p>
            <div className="flex flex-col gap-2">
              <MnRow label="Insulin Pump Script" state={!ipServed ? "na" : ipDocChecked ? "ok" : "bad"} />
              <MnRow label="CGM Script" state={!cgmServed ? "na" : cgmDocChecked ? "ok" : "bad"} />
              <MnRow label="Clinicals" state={clinDocChecked ? "ok" : "bad"} />
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2.5">
              Language
            </p>
            <div className="flex flex-col gap-2">
              <MnRow label="CGM Language" state={!cgmServed ? "na" : cgmLangChecked ? "ok" : "bad"} />
              <MnRow label="Insulin Pump Language" state={!ipServed ? "na" : ipLangChecked ? "ok" : "bad"} />
            </div>
          </div>
        </div>
      </MmStep>

      {/* ── Final Clinicals — locked until MN Established ── */}
      <MmStep num={3} title="Final Clinicals">
        <p className="text-sm text-muted-foreground -mt-3 mb-4">
          The one combined, finalized clinical package — unlocks when Medical Necessity is Established
        </p>
        {mnEstablished ? (
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
              void finalClinicalUpload
                .upload(patient.id, COL.finalClinicals, rawFiles)
                .then(refetchFilesAfterUpload);
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
      </MmStep>

      {/* Notes */}
      <NotesPanel
        columnRef={{ boardId: BOARD_ID, columnId: COL.mnEvalNotes }}
        notes={patient.mnEvalNotes ?? ""}
        onNotesChange={(v) => onUpdate({ mnEvalNotes: v })}
        onSaveToMonday={(v) => writeLongText(patient.id, COL.mnEvalNotes, v)}
        profileSendOffNotes={patient.profileSendOffNotes}
        onNoteAdded={() => setNoteAdded(true)}
        onPendingTextChange={setPendingNoteText}
        notePrefix="Evaluate"
      />

      {/* Send to Monday */}
      <div className="flex flex-col items-end gap-3">
        {willEscalate && (
          <div className="w-full flex items-center gap-2 rounded-lg border-2 border-red-500 bg-red-50 px-3.5 py-2.5">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
            <span className="text-sm font-bold text-red-600">
              This is the third unsuccessful attempt — patient will be escalated.
            </span>
          </div>
        )}
        {/* Live per-file upload status — Send stays disabled until every file
            reads "Confirmed" (landed in Monday). */}
        {uploadFiles.length > 0 && (
          <div className="w-full rounded-lg border bg-muted/20 px-3.5 py-2.5 space-y-1">
            {uploadFiles.map((f) => (
              <div key={f.name} className="flex items-center gap-2 text-xs">
                {f.status === "confirmed" ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--mm-green)]" />
                ) : f.status === "error" ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{f.name}</span>
                <span
                  className={cn(
                    "font-medium",
                    f.status === "confirmed" && "text-[color:var(--mm-green)]",
                    f.status === "error" && "text-red-600",
                  )}
                >
                  {f.status === "uploading"
                    ? "Uploading…"
                    : f.status === "confirming"
                      ? "Confirming…"
                      : f.status === "confirmed"
                        ? "Confirmed"
                        : "Upload failed — retry"}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Why Send is blocked (fields / note / uploading). In review mode the
            stage is already finished, so the "you still owe us a note" nags are
            noise — one line saying why the button is off replaces them. */}
        {reviewMode && (
          <span className="text-xs font-medium text-right text-muted-foreground">
            Completed stage — this is what the rep filled out, so there is nothing left to send.
          </span>
        )}
        {!reviewMode && missingFields.length > 0 && (
          <span
            className="text-xs font-medium text-right"
            style={{ color: "var(--mm-rose)" }}
            title={missingFields.join(", ")}
          >
            {missingFields.length} required field{missingFields.length > 1 ? "s" : ""} remaining:{" "}
            {missingFields.slice(0, 4).join(", ")}
            {missingFields.length > 4 ? "…" : ""}
          </span>
        )}
        {!reviewMode && noteBlocked && (
          <span className="text-xs font-medium text-right" style={{ color: "var(--mm-rose)" }}>
            {hasPendingNote
              ? "Press Add on your note before sending"
              : "Add at least one MN Workflow note to send"}
          </span>
        )}
        {filesUploading && (
          <div className="w-full flex items-start gap-2 rounded-lg border-2 border-red-400 bg-red-50 px-3 py-2 animate-pulse">
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
        <Button
          size="lg"
          onClick={handleSendToMonday}
          disabled={sending || sendBlocked}
          className="gap-2 text-white shadow-elevate bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Completed Evaluation
            </>
          )}
        </Button>
        {sendErrors.length > 0 && (
          <div
            className="w-full rounded-lg border-2 px-3.5 py-2.5 text-sm"
            style={{ background: "var(--mm-rose-soft)", borderColor: "var(--mm-rose)", color: "oklch(0.5 0.12 18)" }}
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
          </div>
        )}
      </div>
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
  required?: boolean;
}

function DiagnosisField({ value, onChange, required = true }: DiagnosisFieldProps) {
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
        Diagnosis
        {required && <span className="font-bold text-[color:var(--mm-rose)]"> *</span>}
        {required && !value && (
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
  // Non-blocking delete confirmation (never window.confirm — see ConfirmDeleteDialog).
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDelete = async () => {
    setConfirmingDelete(false);
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
                openFileViewer({ url: u, name: f.name });
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
              onClick={() => setConfirmingDelete(true)}
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
      <ConfirmDeleteDialog
        open={confirmingDelete}
        name={label}
        onConfirm={handleDelete}
        onOpenChange={setConfirmingDelete}
      />
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
  // "Local storage" tab — browser-only file metadata (EvalState/localStorage),
  // NOT the Monday-attached list above. Collapsed by default so reps aren't
  // confused by seeing the same file twice.
  const [showLocalFiles, setShowLocalFiles] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  // Non-blocking delete confirmation (never window.confirm — see ConfirmDeleteDialog).
  // Stored by assetId so the confirm re-resolves the target + keep-list from
  // the CURRENT mondayFiles — files added while the dialog is open are kept.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDelete = mondayFiles.find((f) => f.assetId === pendingDeleteId) ?? null;

  const handleDeleteMondayFile = async (target: MondayFileEntry) => {
    setPendingDeleteId(null);
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
                        openFileViewer({ url, name: f.name });
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
                      setPendingDeleteId(f.assetId);
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
      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        name={pendingDelete?.name ?? ""}
        onConfirm={() => pendingDelete && handleDeleteMondayFile(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
      />

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

      {/* Local storage tab — collapsed by default. These entries are browser-
          only metadata (persisted in EvalState/localStorage when files were
          dropped), not the Monday source of truth listed above. */}
      {files.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowLocalFiles((v) => !v)}
            aria-expanded={showLocalFiles}
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showLocalFiles ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            Local storage ({files.length})
          </button>
          {showLocalFiles && (
            <ul className="space-y-1 mt-1">
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

  // Diagnosis & Last Visit — required when Clinicals received. "Evaluate" is the
  // board's placeholder default (not a real diagnosis), so it counts as unanswered
  // — otherwise it slips through the gate yet fails deriveValidity, writing "Not
  // Established" with a "Diagnosis missing" reason.
  if (state.mrReceived === "Yes") {
    if (!state.diagnosis || state.diagnosis === "Evaluate") missing.push("Diagnosis");
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

// ⚠️ SUPERSEDED / NOT RENDERED. This component was defined in the redesign but
// never mounted (0 render sites), so its Send gate — required-fields + note +
// files-uploading — was dead and the live button advanced patients mid-upload.
// The gate now lives directly on the "Completed Evaluation" button in the main
// EvaluatePanel component (search `sendBlocked`). Do NOT wire this back in as a
// second Send path; edit the live gate instead. Kept only to avoid a cascading
// dead-code delete (MondayPreviewPanel/OutcomeChip) right before release.
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
              Saving…
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Completed Evaluation
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
  return formatDate(iso);
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
/** Evaluate-redesign: one product column (CGM / Insulin Pump / Clinicals).
 *  Always rendered; `grayed` dims + disables the box when not served. */
function ProductColumn({
  title,
  icon,
  grayed,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  grayed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm transition-opacity",
        grayed && "opacity-55",
      )}
      style={{ borderColor: "var(--mm-card-border)" }}
      aria-disabled={grayed}
    >
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[color:var(--mm-teal)]">{icon}</span>
          <h3 className="text-base font-bold tracking-tight truncate">{title}</h3>
        </div>
        {grayed && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/70 rounded-full px-2 py-0.5 shrink-0">
            Not Serving
          </span>
        )}
      </div>
      <div className={cn("flex flex-col gap-4", grayed && "pointer-events-none")}>{children}</div>
    </div>
  );
}

/** Evaluate-redesign: the "Received?" segmented control (4-state for CGM/IP,
 *  3-state for Clinicals when includeNotServing is false). */
function RcvField({
  label,
  value,
  onChange,
  includeNotServing = true,
  includeInvalid = true,
  disabled = false,
}: {
  label: string;
  value?: string;
  onChange: (v: string | undefined) => void;
  includeNotServing?: boolean;
  includeInvalid?: boolean;
  disabled?: boolean;
}) {
  const opts: { label: string; sel: string }[] = [
    { label: "Yes", sel: "border-transparent bg-[color:var(--mm-green)] text-white shadow-sm" },
    { label: "No", sel: "border-transparent bg-[color:var(--mm-rose)] text-white shadow-sm" },
    ...(includeInvalid
      ? [{ label: "Invalid", sel: "border-transparent bg-amber-500 text-white shadow-sm" }]
      : []),
    ...(includeNotServing
      ? [{ label: "Not Serving", sel: "border-transparent bg-slate-500 text-white shadow-sm" }]
      : []),
  ];
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        {label} <span className="font-bold text-[color:var(--mm-rose)]">*</span>
        {value === undefined && !disabled && (
          <span className="ml-1 normal-case tracking-normal text-[color:var(--mm-rose)]">— required</span>
        )}
      </p>
      <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label={label}>
        {opts.map((o) => {
          const selected = value === o.label;
          return (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(selected ? undefined : o.label)}
              className={cn(
                "flex-1 min-w-[64px] px-2.5 py-2 rounded-md text-xs font-semibold border-2 transition-all",
                selected
                  ? o.sel
                  : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-[color:var(--mm-green)]",
                disabled && "cursor-not-allowed",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Small labeled wrapper used inside a product column. */
function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Yes / No / Invalid tri-pill for language requirements. */
function YniPills({
  value,
  onChange,
}: {
  value?: YesNoInvalid;
  onChange: (v: YesNoInvalid | undefined) => void;
}) {
  const opts: { label: YesNoInvalid; cls: string }[] = [
    { label: "Yes", cls: "bg-[color:var(--mm-green)] text-white shadow-sm" },
    { label: "No", cls: "bg-[color:var(--mm-rose)] text-white shadow-sm" },
    { label: "Invalid", cls: "bg-amber-500 text-white shadow-sm" },
  ];
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-muted/70 p-[3px] shrink-0"
      role="radiogroup"
    >
      {opts.map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={value === o.label}
          onClick={() => onChange(value === o.label ? undefined : o.label)}
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

/** MN checklist row — ✓ ok / ✕ bad. N/A items are hidden entirely. The bar
 *  border is green for Yes, red for No (in addition to the check/x). */
function MnRow({ label, state }: { label: string; state: "ok" | "bad" | "na" }) {
  if (state === "na") return null;
  const borderColor = state === "ok" ? "var(--mm-green)" : "var(--mm-rose)";
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border-2 px-3.5 py-2.5 bg-card"
      style={{ borderColor }}
    >
      <span className="text-sm font-medium">{label}</span>
      {state === "ok" ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--mm-teal)" }}>
          <Check className="h-4 w-4" /> Yes
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--mm-rose)" }}>
          <X className="h-4 w-4" /> No
        </span>
      )}
    </div>
  );
}

/** CGM coverage path select — Insulin / Hypoglycemia / Not Serving.
 *  Stores Monday's underlying values ("Insulin" | "Hypo" | "Not Serving"). */
function CgmPathSelect({
  value,
  onChange,
  missing,
}: {
  value?: string;
  onChange: (v: string) => void;
  missing?: boolean;
}) {
  const opts = [
    { v: "Insulin", l: "Insulin" },
    { v: "Hypo", l: "Hypoglycemia" },
  ];
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
          {opts.map((o) => (
            <SelectItem key={o.v} value={o.v} className="text-sm">
              {o.l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {missing && <p className="text-xs mt-1 text-[color:var(--mm-rose)]">Required</p>}
    </div>
  );
}

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
  required = true,
  children,
}: {
  label: string;
  missing: boolean;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}) {
  const showMissing = missing && required;
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 bg-card"
      style={{
        borderColor: showMissing ? "oklch(0.62 0.13 18 / 0.45)" : "var(--mm-card-border)",
      }}
    >
      <div className="min-w-0">
        <span className="text-sm font-medium">
          {label}
          {required && <span className="font-bold text-[color:var(--mm-rose)]"> *</span>}
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
  required = true,
}: {
  value?: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const future = !!value && value > todayIso();
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Last Visit Date
        {required && <span className="font-bold text-[color:var(--mm-rose)]"> *</span>}
      </p>
      <Input
        type="date"
        value={value ?? ""}
        max={todayIso()}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm h-9"
      />
      {required && !value ? (
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
