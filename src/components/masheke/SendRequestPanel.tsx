/**
 * SendRequestPanel — Send Request redesign (June 2026 mockups).
 *
 * Visual layer rebuilt to match send-request-fax.html / send-request-parachute.html.
 * ALL existing logic is preserved:
 *   - Generate triggers write Monday's Generate status column, poll files
 *     every 2s while generating, support cancel, and auto-clear when Monday
 *     flips the column.
 *   - MN Request Letter is generated client-side (PDF) and uploaded to its
 *     Monday file column. (Re-enabled — was "Coming soon".)
 *   - Send flips the Send Request trigger column + stamps Request Sent At;
 *     Monday's automation dispatches via Supermail. Send stays gated on the
 *     MN Request Letter file existing on Monday.
 *   - Mark as Complete requires ≥1 note added this session (and no
 *     typed-but-unadded note text), advances the stage (Parachute → Chase
 *     Clinicals +2 business days; otherwise → Confirm Receipt, due today),
 *     and persists doctor-field edits.
 */
import {
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { NotesPanel } from "@/components/masheke/NotesPanel";
import { etNow } from "@/lib/masheke/etDate";
import { Button } from "@/components/ui/button";
import { useMondayFiles } from "@/hooks/masheke/useMondayFiles";
import {
  COL,
  buildDoctorWriteTasks,
  clearStatusColumn,
  deleteFileFromColumn,
  deleteSingleFileFromColumn,
  hasToken,
  uploadFileToColumn,
  writeDate,
  writeLongText,
  writeDateTime,
  writeStatusIndex,
  writeStatusLabel,
  type MondayFileEntry,
} from "@/lib/masheke/mondayApi";
import { GEN_SCRIPT_STATUS } from "@/lib/masheke/mondayMapping";
import {
  loadEvalStateForPatient,
  saveEvalState,
  computeMnChecklist,
  type EvalState,
  type MnChecklist,
  type MnItem,
  type MnLangItem,
  type MnState,
} from "@/lib/masheke/evalState";
import { shouldShowCgmBlock, shouldShowIpBlock } from "@/lib/masheke/ipPaths";
import { MissingChecklist } from "@/components/masheke/MissingChecklist";
import { PreviousActivityCard } from "@/components/masheke/PreviousActivityCard";
import { MethodBar } from "@/components/masheke/MethodBar";
import { buildRequestTemplate, titleCase } from "@/lib/masheke/requestTemplate";
import { generateMnRequestPdf } from "@/lib/masheke/mnRequestPdf";
import { ESCALATION_INDEX } from "@/lib/masheke/mondayMapping";
import { toast } from "sonner";
import {
  Check,
  X,
  Loader2,
  FileText,
  Send,
  Mail,
  Info,
  Printer,
  Phone,
  Globe,
  AlertTriangle,
  ChevronRight,
  Upload,
  Plus,
} from "lucide-react";
import {
  AskForList,
  ExtIcon,
  FileList,
  LoadingRow,
  MethodHero,
  MmStep,
  MnStatusChip,
  SentChip,
} from "@/components/masheke/mmKit";
import { DoctorNotesPanel } from "@/components/shared/DoctorNotesPanel";

interface Props {
  onUpdate: (patch: Partial<Patient>) => void;
  patient: Patient;
  /** Bumped by parent on Reset — forces local state reload. */
  resetVersion?: number;
  onOpenForm?: () => void;
}

// =====================================================================
// Main panel
// =====================================================================

export function SendRequestPanel({ patient, resetVersion = 0, onUpdate }: Props) {
  const [state, setState] = useState<EvalState>(() => loadEvalStateForPatient(patient));
  const showCgm = shouldShowCgmBlock(patient.serving);
  const showIp = shouldShowIpBlock(patient.serving);
  const mnChecklist = computeMnChecklist(state, showCgm, showIp);

  useEffect(() => {
    setState(loadEvalStateForPatient(patient));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, resetVersion]);

  useEffect(() => {
    saveEvalState(patient.id, state);
  }, [patient.id, state]);

  const update = useCallback(<K extends keyof EvalState>(key: K, value: EvalState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  const cgmIsGeneratingLocal = state.generateCgmScript === "Generate";
  const ipIsGeneratingLocal = state.generateIpScript === "Generate";

  const mondayFiles = useMondayFiles(patient.id, {
    pollingIntervalMs: cgmIsGeneratingLocal || ipIsGeneratingLocal ? 2000 : 0,
  });

  // ---- Generate triggers (write to Monday's Generate column) ----
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
          await clearStatusColumn(patient.id, columnId);
          await new Promise((r) => setTimeout(r, 250));
          await writeStatusIndex(patient.id, columnId, GEN_SCRIPT_STATUS.generate);
        } else {
          await clearStatusColumn(patient.id, columnId);
        }
      } catch (e) {
        toast.error("Generate request failed", {
          description: e instanceof Error ? e.message : String(e),
        });
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

  // ---- Delete a single file from a Monday file column.
  //      Looks up the list of current files in the column, computes the
  //      "keep" set by asset id, then asks the API to do download +
  //      clear + re-upload. If the deleted file is the only one, the
  //      keep list is empty and we just clear the column. ----
  const deleteOne = useCallback(
    async (columnId: string, allFiles: MondayFileEntry[], assetId: string, label: string) => {
      if (!hasToken()) {
        toast.error("Monday token not configured");
        return;
      }
      const keep = allFiles
        .filter((f) => f.assetId !== assetId)
        .map((f) => ({ name: f.name, url: f.public_url || f.url }))
        .filter((f) => !!f.url);
      try {
        if (keep.length === 0) {
          await deleteFileFromColumn(patient.id, columnId);
        } else {
          await deleteSingleFileFromColumn(patient.id, columnId, keep);
        }
        await mondayFiles.refetch();
        toast.success(`${label} deleted`);
      } catch (e) {
        toast.error(`Failed to delete ${label}`, {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [patient.id, mondayFiles],
  );

  const handleDeleteCgmFile = useCallback(
    (assetId: string) =>
      deleteOne(COL.cgmTemplate, mondayFiles.cgmTemplate, assetId, "CGM script template"),
    [deleteOne, mondayFiles.cgmTemplate],
  );
  const handleDeleteIpFile = useCallback(
    (assetId: string) =>
      deleteOne(COL.ipTemplate, mondayFiles.ipTemplate, assetId, "Insulin Pump script template"),
    [deleteOne, mondayFiles.ipTemplate],
  );
  const handleDeleteMnRequestLetterFile = useCallback(
    (assetId: string) =>
      deleteOne(COL.mnRequestLetter, mondayFiles.mnRequestLetter, assetId, "MN Request Letter"),
    [deleteOne, mondayFiles.mnRequestLetter],
  );

  // ---- Generate MN Request Letter: build PDF + upload to Monday column.
  //      Behaves like the script templates — file lives on Monday and the
  //      Send action attaches everything that's there.
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const handleGenerateMnRequestLetter = useCallback(async () => {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setGeneratingLetter(true);
    try {
      const bytes = await generateMnRequestPdf(patient);
      const safeName = patient.name.replace(/[^a-zA-Z0-9_-]/g, "_") || "patient";
      await uploadFileToColumn(
        patient.id,
        COL.mnRequestLetter,
        bytes,
        `MN_Request_${safeName}.pdf`,
      );
      await mondayFiles.refetch();
      toast.success("MN Request Letter generated");
    } catch (e) {
      toast.error("MN Request Letter generation failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setGeneratingLetter(false);
    }
  }, [patient, mondayFiles]);

  // ---- Auto-clear local Generate state when Monday flips column away from Generate ----
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

  // ---- Send: trigger Monday status only. Monday already has the
  //      MN Request Letter + script templates + clinical files in their
  //      respective file columns; the automation attaches them to the
  //      outbound fax/email. We just flip the trigger column and stamp
  //      the Request Sent At column.
  const [sending, setSending] = useState(false);
  const [sentNow, setSentNow] = useState(false);
  const handleSend = useCallback(async (bodyText?: string) => {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    const method = patient.clinicalsMethod ?? "Fax";
    setSending(true);
    try {
      // Write the Request Message + Sent At FIRST, then flip the Supermail
      // trigger LAST. Supermail fires on the trigger, so writing the body and
      // timestamp first guarantees it never reads a stale/empty Request Message.
      if (bodyText != null) {
        try {
          await writeLongText(patient.id, COL.requestBody, bodyText);
          onUpdate({ requestBody: bodyText });
        } catch (e) {
          throw new Error(`[1/3 Request Body] ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      try {
        await writeDateTime(patient.id, COL.requestSentAt);
      } catch (e) {
        throw new Error(`[2/3 Request Sent At] ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        await writeStatusLabel(patient.id, COL.sendRequestTrigger, "Send");
      } catch (e) {
        throw new Error(`[3/3 trigger Send Request] ${e instanceof Error ? e.message : String(e)}`);
      }
      setSentNow(true);
      toast.success(
        method === "Email"
          ? "Request sent — email dispatched via Supermail"
          : "Request sent — fax dispatched via Supermail",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Send] failed", msg);
      toast.error("Send failed", { description: msg });
    } finally {
      setSending(false);
    }
  }, [patient, onUpdate]);

  // Notes gate — Mark as Complete requires ≥1 note added this session, and is
  // blocked while typed-but-unadded text sits in the note box.
  const [noteAdded, setNoteAdded] = useState(false);
  const [pendingNoteText, setPendingNoteText] = useState("");
  useEffect(() => {
    setNoteAdded(false);
    setPendingNoteText("");
  }, [patient.id]);

  // Local action-state for the new step UI (session-only, no Monday writes).
  const [portalOpened, setPortalOpened] = useState(false);
  const [completed, setCompleted] = useState(false);
  // Attempt counter — pulled from Monday's Evaluation Counter column.
  const attempt = Number(patient.evaluationCounter) || 1;
  useEffect(() => {
    setPortalOpened(false);
    setCompleted(false);
    setSentNow(false);
  }, [patient.id, resetVersion]);

  // ---- Mark as Complete: advance stage. ----
  const [completing, setCompleting] = useState(false);
  const escalatedRef = useRef(false);
  const handleMarkComplete = useCallback(async () => {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setCompleting(true);
    const isParachute = patient.clinicalsMethod === "Parachute";
    // Parachute skips Confirm Receipt (rep handles receipt-confirmation in the
    // Parachute portal directly), so we route straight to Chase Clinicals.
    const nextStage = isParachute ? "Chase Clinicals" : "Confirm Receipt";
    const tasks: { label: string; run: () => Promise<unknown> }[] = [
      {
        label: "Request Sent At",
        run: () => writeDateTime(patient.id, COL.requestSentAt),
      },
      {
        label: `Stage Advancer → ${nextStage}`,
        run: () => writeStatusLabel(patient.id, COL.subStage, nextStage),
      },
    ];
    if (isParachute) {
      // Entry into Chase Clinicals → +3 business days (matches chase cadence)
      const nextAction = toIsoDate(addBusinessDays(etNow(), 3));
      tasks.push({
        label: `Next Action Date → ${nextAction}`,
        run: () => writeDate(patient.id, COL.nextActionDate, nextAction),
      });
    } else {
      // → Confirm Receipt: Next Action Date = +1 business day (the fax/email
      // needs a day to land before the receipt call makes sense).
      const nextAction = toIsoDate(addBusinessDays(etNow(), 1));
      tasks.push({
        label: `Next Action Date → ${nextAction}`,
        run: () => writeDate(patient.id, COL.nextActionDate, nextAction),
      });
    }
    if (escalatedRef.current) {
      tasks.push({
        label: "Escalation → Required",
        run: () => writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required),
      });
    }
    // Persist any doctor-field edits made on the method hero
    tasks.push(...buildDoctorWriteTasks(patient));
    const results = await Promise.allSettled(tasks.map((t) => t.run()));
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failures.push(
          `${tasks[i].label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        );
      }
    });
    setCompleting(false);
    if (failures.length === 0) {
      toast.success(`Marked complete — moved to ${nextStage}`);
      setCompleted(true);
      escalatedRef.current = false;
    } else {
      toast.error(`${failures.length} write(s) failed`, {
        description: failures.slice(0, 3).join("\n"),
      });
    }
  }, [patient]);

  const cgmIsGenerating = cgmIsGeneratingLocal || mondayFiles.generateCgmStatus === "Generate";
  const ipIsGenerating = ipIsGeneratingLocal || mondayFiles.generateIpStatus === "Generate";

  const showCgmGenerate = patient.serving === "CGM" || patient.serving === "Insulin Pump + CGM" || patient.serving === "Supplies + CGM";
  const showIpGenerate = patient.serving !== "CGM";

  // Required fields before triggering DocExport.
  function missingForScript(kind: "cgm" | "ip"): string[] {
    const out: string[] = [];
    if (!patient.name) out.push("Name");
    if (!patient.dob) out.push("DOB");
    if (kind === "cgm" && !patient.cgmType) out.push("CGM Type");
    if (kind === "ip" && !patient.pumpType) out.push("Pump Type");
    if (!patient.doctorName) out.push("Doctor Name");
    if (!patient.doctorNpi) out.push("Doctor NPI");
    return out;
  }
  const cgmMissing = missingForScript("cgm");
  const ipMissing = missingForScript("ip");

  const method = patient.clinicalsMethod ?? "Fax";
  const isParachute = method === "Parachute";
  const isFaxOrEmail = method === "Fax" || method === "Email";
  const mnLetterPresent = mondayFiles.mnRequestLetter.length > 0;

  const hasPendingNote = pendingNoteText.trim().length > 0;
  const noteBlocked = !noteAdded || hasPendingNote;

  const notesPanel = (variant: "mm" | "mm-inline") => (
    <NotesPanel
      variant={variant}
      notes={patient.mnEvalNotes ?? ""}
      onNotesChange={(v) => onUpdate({ mnEvalNotes: v })}
      onSaveToMonday={(v) => writeLongText(patient.id, COL.mnEvalNotes, v)}
      profileSendOffNotes={patient.profileSendOffNotes}
      notePrefix="Send Request"
      onNoteAdded={() => setNoteAdded(true)}
      onPendingTextChange={setPendingNoteText}
    />
  );

  const sendStepNum = isParachute ? 2 : 3;
  void sendStepNum;

  const handleAddNote = (text: string) => {
    const stamp = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const entry = `[${stamp}] ${text}`;
    const next = patient.mnEvalNotes ? `${patient.mnEvalNotes}\n\n${entry}` : entry;
    onUpdate({ mnEvalNotes: next });
    void writeLongText(patient.id, COL.mnEvalNotes, next).catch(() => {});
  };

  const generateScriptsBlock = (
    <>
      <div className="flex flex-wrap gap-3">
        {showCgmGenerate &&
          (cgmIsGenerating ? (
            <GeneratingChip label="Generating CGM Script…" onCancel={() => handleGenerateCgm(undefined)} />
          ) : (
            <GenBtn
              label={mondayFiles.cgmTemplate.length > 0 ? "Regenerate CGM Script" : "Generate CGM Script"}
              disabled={cgmMissing.length > 0}
              onClick={() => handleGenerateCgm("Generate")}
            />
          ))}
        {showIpGenerate &&
          (ipIsGenerating ? (
            <GeneratingChip label="Generating IP Script…" onCancel={() => handleGenerateIp(undefined)} />
          ) : (
            <GenBtn
              label={mondayFiles.ipTemplate.length > 0 ? "Regenerate Insulin Pump Script" : "Generate Insulin Pump Script"}
              disabled={ipMissing.length > 0}
              onClick={() => handleGenerateIp("Generate")}
            />
          ))}
      </div>
      {showCgmGenerate && cgmMissing.length > 0 && (
        <p className="text-sm font-semibold mt-2.5" style={{ color: "var(--mm-rose)" }}>
          Cannot generate CGM Script — missing: {cgmMissing.join(", ")}
        </p>
      )}
      {showIpGenerate && ipMissing.length > 0 && (
        <p className="text-sm font-semibold mt-2.5" style={{ color: "var(--mm-rose)" }}>
          Cannot generate Insulin Pump Script — missing: {ipMissing.join(", ")}
        </p>
      )}
      {(mondayFiles.cgmTemplate.length > 0 || mondayFiles.ipTemplate.length > 0) && (
        <div className="mt-4 flex flex-col gap-2.5">
          <FileList files={mondayFiles.cgmTemplate} onDelete={handleDeleteCgmFile} deleteLabel="CGM script template" />
          <FileList files={mondayFiles.ipTemplate} onDelete={handleDeleteIpFile} deleteLabel="Insulin Pump script template" />
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ── Cross-stage attempt + activity context (shared with Confirm Receipt) ── */}
      <PreviousActivityCard title={`Send Request Attempt #${attempt}`} patient={patient} />

      {/* ── Step 1 — What we're still missing ── */}
      <MmStep num={1} title="What we're still missing">
        <MissingChecklist checklist={mnChecklist} />
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Clinical files on hand
          </p>
          {mondayFiles.loading && mondayFiles.clinicalFiles.length === 0 ? (
            <LoadingRow />
          ) : mondayFiles.clinicalFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No clinical files attached on Monday.
            </p>
          ) : (
            <FileList files={mondayFiles.clinicalFiles} />
          )}
        </div>
      </MmStep>

      {/* ── Step 2 — Method of Communication ── */}
      <MmStep num={2} title="Method of Communication">
        <MethodComms patient={patient} method={method} />
      </MmStep>

      {/* ── Step 3 — Generate Scripts (fax/email; for Parachute it sits inside the Send drawer) ── */}
      {!isParachute && (
        <MmStep num={3} title="Generate Scripts">
          {generateScriptsBlock}
        </MmStep>
      )}

      {/* ── Step 4 — Send the Request ── */}
      <MmStep num={isParachute ? 3 : 4} title="Send the Request">
        <SendRequestComposer
          key={`${patient.id}:${resetVersion}`}
          patient={patient}
          checklist={mnChecklist}
          attempt={attempt}
          method={method}
          sending={sending}
          onSend={handleSend}
          onAddNote={handleAddNote}
          generateSlot={isParachute ? generateScriptsBlock : undefined}
        />
      </MmStep>
    </div>
  );
}

// =====================================================================
// Send-request-specific sub-components
// =====================================================================

/** Plain-language bullet phrasing for each requirement (bold lead + tail). */
const BULLETS: Record<string, { lead: string; rest: string }> = {
  "3+ Injections / Day": { lead: "≥3 daily insulin injections", rest: "(insulin-dependence)" },
  "Diabetes Education": { lead: "Diabetes education", rest: "provided / documented" },
  "CGM Use": { lead: "Current CGM use", rest: "documented" },
  "Blood Sugar Issues": { lead: "Blood-sugar management difficulty", rest: "noted" },
  "Letter of MN on File": { lead: "Letter of medical necessity", rest: "signed & on file" },
  "OOW Date": { lead: "Out-of-warranty date", rest: "" },
  "OOW on Script": { lead: "OOW date", rest: "written on the script" },
  Malfunction: { lead: "Non-repairable malfunction", rest: "reason" },
};
function bulletFor(label: string): { lead: string; rest: string } {
  return BULLETS[label] ?? { lead: label.replace(" Language", " language"), rest: "in the note" };
}

// Pump model → manufacturer, for the partner line + loop-in chip.
const PUMP_MFR: Record<string, string> = {
  iLet: "Beta Bionics",
  Omnipod: "Insulet",
  "Omnipod 5": "Insulet",
  "t:slim": "Tandem",
  "t:slim X2": "Tandem",
  Mobi: "Tandem",
  Tandem: "Tandem",
};

function ProvField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-bold mt-0.5">{value || "—"}</p>
    </div>
  );
}

/** Format a phone number as (xxx)-xxx-xxxx. */
function formatPhone(raw?: string): string {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)})-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)})-${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}


/** Method badge (Fax / Email / Parachute) for the top bar. Parachute links out. */
function MethodBadge({ method }: { method: string }) {
  const isFax = method === "Fax";
  const isEmail = method === "Email";
  const isParachute = method === "Parachute";
  const known = isFax || isEmail || isParachute;
  const cls = `inline-flex items-center gap-2 rounded-xl px-5 py-3.5 text-xl font-extrabold tracking-tight shrink-0 ${
    known ? "text-white" : "bg-muted text-muted-foreground"
  }`;
  const style = known ? { background: isParachute ? "var(--mm-green)" : "var(--mm-teal)" } : undefined;
  const inner = (
    <>
      {isEmail ? <Mail className="h-[22px] w-[22px]" /> : isFax ? <Printer className="h-[22px] w-[22px]" /> : isParachute ? <Globe className="h-[22px] w-[22px]" /> : null}
      {method}
    </>
  );
  if (isParachute) {
    return (
      <a
        href="https://www.parachutehealth.com/"
        target="_blank"
        rel="noopener noreferrer"
        className={`${cls} hover:opacity-90 transition-opacity`}
        style={style}
        title="Open Parachute Health"
      >
        {inner}
      </a>
    );
  }
  return (
    <span className={cls} style={style}>
      {inner}
    </span>
  );
}

/** A titled outreach section card. */
function OutreachCard({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: "var(--mm-card-border)" }}>
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-base font-bold tracking-tight">{title}</h4>
        {badge && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: "oklch(0.94 0.02 175 / 0.7)", color: "var(--mm-teal)" }}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Method of Communication — minimal top bar (method + doctor) then three
 *  outreach paths: Provider, Referral, Patient. No duplicated info. */
function MethodComms({ patient, method }: { patient: Patient; method: string }) {
  return (
    <div className="space-y-4">
      {/* Top bar — just the method + doctor name (shared with Confirm Receipt) */}
      <MethodBar patient={patient} method={method} />

      {/* 1 — Provider Outreach (primary path) */}
      <OutreachCard title="Provider Outreach">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
          <ProvField label="Fax" value={patient.doctorFax} />
          <ProvField label="Email" value={patient.doctorEmail} />
          <ProvField label="Phone" value={formatPhone(patient.doctorPhone)} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Clinic: <span className="font-semibold text-foreground">{patient.clinicName || "—"}</span>
          {"   ·   "}Address: <span className="font-semibold text-foreground">{patient.clinicAddress || "—"}</span>
        </p>

        {/* Prescriber requirements — amber when present, plain row when empty */}
        {patient.prescriberRequirements?.trim() ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800 mb-1 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Prescriber Requirements
            </p>
            <p className="text-sm text-amber-900 whitespace-pre-wrap">{patient.prescriberRequirements}</p>
          </div>
        ) : (
          <div className="mt-4 border-t pt-3 flex items-center gap-2" style={{ borderColor: "var(--mm-card-border)" }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Prescriber Requirements
            </span>
            <span className="text-sm font-bold">—</span>
          </div>
        )}

        {patient.doctorNpi && (
          <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--mm-card-border)" }}>
            <DoctorNotesPanel doctorNpi={patient.doctorNpi} doctorName={patient.doctorName} compact flush />
          </div>
        )}
      </OutreachCard>

      {/* 2 & 3 — Referral + Patient Outreach, side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <OutreachCard title="Referral Outreach">
          <ProvField label="Referral Source" value={patient.referralSource} />
        </OutreachCard>
        <OutreachCard title="Patient Outreach">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <ProvField label="Phone" value={formatPhone(patient.phone)} />
            <ProvField label="Email" value={patient.patientEmail} />
          </div>
        </OutreachCard>
      </div>
    </div>
  );
}

/** Selectable channel card for the Method of Communication section. */
function ChannelCard({
  icon,
  label,
  value,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left rounded-xl border-2 p-4 transition-colors"
      style={
        selected
          ? { borderColor: "var(--mm-teal)", background: "oklch(0.94 0.02 175 / 0.4)" }
          : { borderColor: "var(--mm-card-border)" }
      }
    >
      <span
        className="grid place-items-center h-9 w-9 rounded-lg mb-2"
        style={
          selected
            ? { background: "var(--mm-teal)", color: "#fff" }
            : { background: "oklch(0.95 0.005 260)", color: "var(--mm-muted-foreground, #64748b)" }
        }
      >
        {icon}
      </span>
      <div className="text-sm font-bold">{label}</div>
      <div className="text-xs text-muted-foreground mt-0.5 break-all">{value || "—"}</div>
    </button>
  );
}

/** Loop-in support chip (toggleable). */
function LoopChip({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border-2 transition-colors"
      style={
        on
          ? { borderColor: "var(--mm-teal)", color: "var(--mm-teal)", background: "oklch(0.94 0.02 175 / 0.4)" }
          : { borderColor: "var(--mm-card-border)" }
      }
    >
      {on && <Check className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

/** Section 2 — how to reach the provider + who to loop in. */
function MethodOfCommunication({
  patient,
  channel,
  onChannel,
  loopIns,
  onToggleLoop,
}: {
  patient: Patient;
  channel: string;
  onChannel: (c: string) => void;
  loopIns: string[];
  onToggleLoop: (l: string) => void;
}) {
  const preferred = patient.clinicalsMethod ?? "Fax";
  const mfr = PUMP_MFR[patient.pumpType ?? ""] ?? patient.pumpType;
  const loopOptions = [
    "Clinical Educator (CDE)",
    mfr ? `Manufacturer rep · ${mfr}` : "Manufacturer rep",
    "Masheke (MN)",
  ];
  const channels = [
    { key: "Fax", icon: <Printer className="h-4 w-4" />, label: "Fax", value: patient.doctorFax },
    { key: "Portal", icon: <Globe className="h-4 w-4" />, label: "Provider Portal", value: "Portal · linked" },
    { key: "Email", icon: <Mail className="h-4 w-4" />, label: "E-fax / Email", value: patient.doctorEmail },
    { key: "Phone", icon: <Phone className="h-4 w-4" />, label: "Phone", value: patient.doctorPhone },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-10 gap-y-3 border-b pb-4" style={{ borderColor: "var(--mm-card-border)" }}>
        <ProvField label="Provider" value={patient.doctorName} />
        <ProvField label="NPI" value={patient.doctorNpi} />
        <ProvField label="Preferred" value={preferred} />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          How to reach this provider
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {channels.map((c) => (
            <ChannelCard
              key={c.key}
              icon={c.icon}
              label={c.label}
              value={c.value}
              selected={channel === c.key}
              onSelect={() => onChannel(c.key)}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground mb-2">
          Because this is a <b className="text-foreground">language / education</b> ask, loop in support if helpful:
        </p>
        <div className="flex flex-wrap gap-2">
          {loopOptions.map((l) => (
            <LoopChip key={l} label={l} on={loopIns.includes(l)} onToggle={() => onToggleLoop(l)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Gmail-style recipient field — each address becomes a removable pill. */
function RecipientChips({ recipients, onChange }: { recipients: string[]; onChange: (r: string[]) => void }) {
  const [input, setInput] = useState("");
  const add = (raw: string) => {
    const v = raw.trim().replace(/[,;]+$/, "").trim();
    if (v && !recipients.includes(v)) onChange([...recipients, v]);
    setInput("");
  };
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-xl border p-2 min-h-[44px]"
      style={{ borderColor: "var(--mm-card-border)" }}
    >
      {recipients.map((r) => (
        <span
          key={r}
          className="inline-flex items-center gap-1.5 rounded-full pl-1 pr-2 py-0.5 text-sm"
          style={{ background: "oklch(0.94 0.02 175 / 0.6)", color: "var(--mm-teal)" }}
        >
          <span
            className="grid place-items-center h-5 w-5 rounded-full text-[10px] font-bold text-white"
            style={{ background: "var(--mm-teal)" }}
          >
            {r[0]?.toUpperCase()}
          </span>
          {r}
          <button
            type="button"
            onClick={() => onChange(recipients.filter((x) => x !== r))}
            className="hover:opacity-70"
            aria-label={`Remove ${r}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === ";") {
            e.preventDefault();
            add(input);
          } else if (e.key === "Backspace" && !input && recipients.length) {
            onChange(recipients.slice(0, -1));
          }
        }}
        onBlur={() => add(input)}
        placeholder={recipients.length ? "" : "Recipient(s)"}
        className="flex-1 min-w-[120px] bg-transparent text-sm p-1 focus:outline-none"
      />
    </div>
  );
}

/** Section 3 — auto-filled request template + notes + send footer. */
function SendRequestComposer({
  patient,
  checklist,
  attempt,
  method,
  sending,
  onSend,
  onAddNote,
  generateSlot,
}: {
  patient: Patient;
  checklist: MnChecklist;
  attempt: number;
  method: string;
  sending: boolean;
  onSend: (body: string) => void;
  onAddNote: (text: string) => void;
  generateSlot?: React.ReactNode;
}) {
  // The template derives live from the current checklist until the rep edits
  // it; once they type, their draft takes over. Falls back to the saved
  // column value (requestBody) so a previously approved message reloads.
  const generated = buildRequestTemplate(patient, checklist);
  const [draft, setDraft] = useState<string | null>(null);
  const body = draft ?? patient.requestBody ?? generated;
  const [notes, setNotes] = useState("");
  const chanValue =
    method === "Email" ? patient.doctorEmail : method === "Fax" ? patient.doctorFax : patient.doctorPhone;
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState(`Medical necessity documentation — ${titleCase(patient.name || "")}`);
  const isParachute = method === "Parachute";
  const [open, setOpen] = useState(!isParachute);
  const [files, setFiles] = useState<File[]>([]);
  const [warned, setWarned] = useState(false);
  // Almost every request should carry an attachment — warn once before sending.
  const trySend = () => {
    if (!isParachute && files.length === 0 && !warned) {
      setWarned(true);
      return;
    }
    onSend(body);
  };
  return (
    <div className="space-y-5">
      {isParachute && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
          {open ? "Hide request template" : "Show request template (optional for Parachute)"}
        </button>
      )}
      {open && (
        <>
      {generateSlot && (
        <div className="rounded-2xl border p-5" style={{ borderColor: "var(--mm-card-border)" }}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Generate Scripts</p>
          {generateSlot}
        </div>
      )}
      <div className="rounded-2xl border p-5 space-y-5" style={{ borderColor: "var(--mm-card-border)" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">To</p>
          <RecipientChips recipients={recipients} onChange={setRecipients} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Subject</p>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-xl border p-3 text-sm focus:outline-none"
            style={{ borderColor: "var(--mm-card-border)" }}
          />
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Request template — auto-filled, edit before sending
        </p>
        <textarea
          value={body}
          onChange={(e) => setDraft(e.target.value)}
          rows={9}
          className="w-full rounded-xl border p-4 text-sm leading-relaxed resize-y focus:outline-none"
          style={{ borderColor: "var(--mm-card-border)" }}
        />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Attachments — sent with the request
        </p>
        <label
          className="flex items-center gap-2 cursor-pointer rounded-xl border border-dashed p-4 text-sm text-muted-foreground hover:bg-muted/30"
          style={{ borderColor: "var(--mm-card-border)" }}
        >
          <Upload className="h-4 w-4 shrink-0" />
          <span>Click to add files</span>
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
          />
        </label>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--mm-card-border)" }}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="hover:opacity-70"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
        </>
      )}

      {/* Notes — always visible (rep still logs notes after a Parachute send) */}
      <div className="rounded-2xl border p-5" style={{ borderColor: "var(--mm-card-border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Notes — anything else the team should know <span className="normal-case font-normal">(optional)</span>
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. Also emailed the nurse separately to flag the exact language we need."
          className="w-full rounded-xl border p-4 text-sm resize-y focus:outline-none"
          style={{ borderColor: "var(--mm-card-border)" }}
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            disabled={!notes.trim()}
            onClick={() => {
              onAddNote(notes.trim());
              setNotes("");
            }}
            className="gap-1.5 text-white bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
          >
            <Plus className="h-4 w-4" /> Add note
          </Button>
        </div>
        {(() => {
          const noteItems = [
            { label: "MN Workflow", text: patient.mnEvalNotes },
            { label: "Confirm Receipt", text: patient.confirmReceiptNotes },
            { label: "Chase Clinicals", text: patient.confirmChaseNotes },
            { label: "Intake", text: patient.profileSendOffNotes },
          ].filter((n) => n.text?.trim());
          if (!noteItems.length) return null;
          return (
            <div className="mt-3 rounded-xl border bg-muted/30 p-4" style={{ borderColor: "var(--mm-card-border)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Notes on file
              </p>
              <div className="space-y-2.5">
                {noteItems.map((n) => (
                  <div key={n.label}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{n.label}</p>
                    <p className="text-sm whitespace-pre-wrap">{n.text}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {!isParachute && files.length === 0 && (
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{ background: "oklch(0.98 0.03 95)", borderColor: "oklch(0.85 0.08 85)", color: "oklch(0.5 0.08 70)" }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "oklch(0.62 0.13 70)" }} />
          {warned
            ? "No attachment detected — press “Send request” again to send without one."
            : "No attachment added yet — most requests should include the signed script."}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap border-t pt-4" style={{ borderColor: "var(--mm-card-border)" }}>
        <span />
        <div className="flex items-center gap-3">
          <Button
            onClick={trySend}
            disabled={sending}
            className="gap-2 text-white shadow-sm bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Send request
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

type CardMode = "complete" | "docs" | "language";
interface DeviceCard {
  name: string;
  model?: string;
  coverageType?: string;
  scriptOk: boolean;
  clinicalsOk: boolean;
  languageOk: boolean;
  mode: CardMode;
  docNeeds: string[]; // whole documents still missing
  bullets: { lead: string; rest: string }[]; // specific note language missing
}

function buildDeviceCard(
  name: string,
  model: string | undefined,
  coverageType: string | undefined,
  scriptOk: boolean,
  clinicalsOk: boolean,
  lang: MnLangItem,
): DeviceCard {
  const languageOk = lang.state === "ok";
  const docsMissing = !scriptOk || !clinicalsOk;

  const docNeeds: string[] = [];
  if (!scriptOk) docNeeds.push(`${name} Script`);
  if (!clinicalsOk) docNeeds.push("Medical Records");

  // Only drill into specific note language once the documents are in hand.
  const bullets: { lead: string; rest: string }[] = [];
  if (!docsMissing && !languageOk) {
    const subs = lang.subItems.filter((s) => s.state !== "ok");
    if (subs.length === 0) bullets.push(bulletFor(`${name} Language`));
    else for (const s of subs) bullets.push(bulletFor(s.label));
  }

  const mode: CardMode = scriptOk && clinicalsOk && languageOk ? "complete" : docsMissing ? "docs" : "language";
  return { name, model, coverageType, scriptOk, clinicalsOk, languageOk, mode, docNeeds, bullets };
}

function DeviceRequestCard({ card }: { card: DeviceCard }) {
  // Color by mode so "missing documents" vs "missing language" reads at a glance.
  const tone =
    card.mode === "complete"
      ? { bg: "var(--mm-mint)", border: "var(--mm-mint-ring)", badge: "var(--mm-green)", label: "Complete — nothing to request" }
      : card.mode === "docs"
        ? { bg: "var(--mm-rose-soft)", border: "oklch(0.62 0.13 18 / 0.3)", badge: "var(--mm-rose)", label: "Missing documents" }
        : { bg: "oklch(0.98 0.03 95)", border: "oklch(0.85 0.08 85)", badge: "oklch(0.62 0.13 70)", label: "Missing language" };

  return (
    <div className="rounded-xl border p-5" style={{ background: tone.bg, borderColor: tone.border }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-lg font-bold tracking-tight">{card.name}</h4>
          {card.model && (
            <span className="rounded-md bg-card/70 border px-2 py-0.5 text-xs font-medium text-muted-foreground" style={{ borderColor: "var(--mm-card-border)" }}>
              {card.model}
            </span>
          )}
          {card.coverageType && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-bold"
              style={{ background: "oklch(0.94 0.02 175 / 0.7)", color: "var(--mm-teal)", boxShadow: "inset 0 0 0 1px var(--mm-mint-ring)" }}
            >
              {card.coverageType}
            </span>
          )}
        </div>
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"
          style={{ background: tone.badge }}
        >
          {tone.label}
        </span>
      </div>

      {/* What we already have vs still need, at a glance */}
      <div className="flex flex-wrap gap-2 mt-3">
        <StatusChip label="Script" ok={card.scriptOk} />
        <StatusChip label="Clinicals" ok={card.clinicalsOk} />
        <StatusChip label="Language" ok={card.languageOk} />
      </div>

      {/* Missing whole documents — name them, don't drill into language yet. */}
      {card.mode === "docs" && (
        <ul className="mt-3 space-y-1.5">
          {card.docNeeds.map((d) => (
            <li key={d} className="text-sm flex gap-2 items-start">
              <FileText className="h-4 w-4 mt-0.5 shrink-0 text-[color:var(--mm-rose)]" />
              <span className="font-semibold text-[color:var(--mm-rose)]">{d}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Docs in hand — list the exact sentences the note must carry. */}
      {card.mode === "language" && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Note needs to say:
          </p>
          <ul className="mt-2 space-y-1">
            {card.bullets.map((b) => (
              <li key={b.lead} className="text-sm flex gap-2">
                <span className="mt-1.5 h-1 w-1 rounded-full shrink-0" style={{ background: "oklch(0.62 0.13 70)" }} />
                <span>
                  <b style={{ color: "oklch(0.5 0.1 70)" }}>{b.lead}</b>
                  {b.rest ? ` ${b.rest}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Small ✓/✗ status chip — shows what we already have vs still need. */
function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
      style={
        ok
          ? { background: "oklch(0.94 0.02 175 / 0.8)", color: "var(--mm-teal)" }
          : { background: "var(--mm-rose-soft)", color: "var(--mm-rose)" }
      }
    >
      {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

/** Outline-teal generate button (mockup .gen-btn). */
function GenBtn({
  label,
  disabled,
  spinner,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  spinner?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-lg px-[18px] py-2.5 text-sm font-semibold transition-colors text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1.5px_var(--mm-teal)] hover:bg-[oklch(0.36_0.04_200_/_0.06)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {spinner ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      {label}
    </button>
  );
}

/** Amber "Generating…" chip with a cancel ✕ (preserves the cancel flow). */
function GeneratingChip({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2.5 text-sm font-semibold">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </span>
      <button
        onClick={onCancel}
        title="Cancel"
        className="p-2 rounded-lg border bg-background hover:bg-muted transition-colors"
        style={{ borderColor: "var(--mm-card-border)" }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}



const PARACHUTE_URL = "https://dme.parachutehealth.com/u/r/BGP3-YIEG1-Z8-SL/dashboard";

/** Add N business days (Mon–Fri) to a date. */
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/** Format a Date as YYYY-MM-DD for Monday's date column. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
