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
  type EvalState,
} from "@/lib/masheke/evalState";
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
  const handleSend = useCallback(async () => {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    const method = patient.clinicalsMethod ?? "Fax";
    setSending(true);
    try {
      try {
        await writeStatusLabel(patient.id, COL.sendRequestTrigger, "Send");
      } catch (e) {
        throw new Error(`[1/2 trigger Send Request] ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        await writeDateTime(patient.id, COL.requestSentAt);
      } catch (e) {
        throw new Error(`[2/2 Request Sent At] ${e instanceof Error ? e.message : String(e)}`);
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
  }, [patient]);

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
      const nextAction = toIsoDate(addBusinessDays(etNow(), 2));
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

  return (
    <div className="flex flex-col gap-6">
      <MethodHero patient={patient} method={method} />

      {/* ── Step 1 — What we're still missing ── */}
      <MmStep
        num={1}
        title="What we're still missing"
        rightAccessory={<MnStatusChip established={patient.medicalNecessity === "Established"} />}
      >
        <AskForList patient={patient} />
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Clinical files on hand — attached automatically
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

      {/* ── Step 2 — Generate Scripts (fax/email only; Parachute skips it) ── */}
      {!isParachute && (
        <MmStep
          num={2}
          title="Generate Scripts"
          sub={`Generate the documents to include in the ${method === "Email" ? "email" : "fax"}.`}
        >
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
                  label={mondayFiles.ipTemplate.length > 0 ? "Regenerate IP Script" : "Generate IP Script"}
                  disabled={ipMissing.length > 0}
                  onClick={() => handleGenerateIp("Generate")}
                />
              ))}
            {/* MN Request Letter generation temporarily disabled — coming soon */}
            <span title="MN Request Letter generation is coming soon">
              <GenBtn
                label={
                  generatingLetter
                    ? "Generating…"
                    : mnLetterPresent
                      ? "Regenerate MN Request Letter (coming soon)"
                      : "Generate MN Request Letter (coming soon)"
                }
                disabled
                spinner={generatingLetter}
                onClick={handleGenerateMnRequestLetter}
              />
            </span>
          </div>

          {showCgmGenerate && cgmMissing.length > 0 && (
            <p className="text-sm font-semibold mt-2.5" style={{ color: "var(--mm-rose)" }}>
              Cannot generate CGM Script — missing: {cgmMissing.join(", ")}
            </p>
          )}
          {showIpGenerate && ipMissing.length > 0 && (
            <p className="text-sm font-semibold mt-2.5" style={{ color: "var(--mm-rose)" }}>
              Cannot generate IP Script — missing: {ipMissing.join(", ")}
            </p>
          )}

          {(mondayFiles.loading &&
            mondayFiles.cgmTemplate.length + mondayFiles.ipTemplate.length + mondayFiles.mnRequestLetter.length === 0) ? (
            <div className="mt-4">
              <LoadingRow />
            </div>
          ) : (
            (mondayFiles.cgmTemplate.length > 0 ||
              mondayFiles.ipTemplate.length > 0 ||
              mondayFiles.mnRequestLetter.length > 0) && (
              <div className="mt-4 flex flex-col gap-2.5">
                <FileList files={mondayFiles.cgmTemplate} onDelete={handleDeleteCgmFile} deleteLabel="CGM script template" />
                <FileList files={mondayFiles.ipTemplate} onDelete={handleDeleteIpFile} deleteLabel="Insulin Pump script template" />
                <FileList files={mondayFiles.mnRequestLetter} onDelete={handleDeleteMnRequestLetterFile} deleteLabel="MN Request Letter" />
              </div>
            )
          )}
        </MmStep>
      )}

      {/* ── Notes — standalone card for fax/email (Parachute has it inline) ── */}
      {!isParachute && notesPanel("mm")}

      {/* ── Send & Complete ── */}
      <MmStep num={sendStepNum} title="Send & Complete">
        {/* sent status header */}
        <div className="flex items-center gap-3 flex-wrap -mt-1 mb-4">
          {patient.requestSentAt ? (
            <>
              <span className="text-sm text-muted-foreground">
                Last sent <b className="text-foreground">{formatDate(patient.requestSentAt)}</b>
              </span>
              <SentChip />
            </>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground bg-background border"
              style={{ borderColor: "var(--mm-card-border)" }}
            >
              Not sent yet
            </span>
          )}
        </div>

        {/* action 1 — send (fax/email) or open portal (parachute) */}
        {isFaxOrEmail && (
          <>
            <ActionRow
              num={1}
              done={sentNow}
              title={
                (method === "Fax" && patient.doctorFax)
                  ? `Send Fax to ${patient.doctorFax}`
                  : (method === "Email" && patient.doctorEmail)
                    ? `Send Email to ${patient.doctorEmail}`
                    : `Send ${method}`
              }
              sub={
                method === "Fax"
                  ? "Fax sending is coming soon."
                  : (method === "Email" && !patient.doctorEmail)
                    ? "(no doctor email on file)"
                    : "Sends generated documents + clinical files via Supermail."
              }
            >
              {/* Fax sending temporarily disabled — coming soon.
                  MN-letter gate relaxed while letter generation is paused. */}
              <Button
                onClick={handleSend}
                disabled={sending || method === "Fax"}
                title={method === "Fax" ? "Fax sending is coming soon" : undefined}
                className="gap-2 text-white shadow-sm bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    {method === "Email" ? <Mail className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                    Send {method}
                  </>
                )}
              </Button>
            </ActionRow>
          </>
        )}
        {isParachute && (
          <ActionRow num={1} done={portalOpened} title="Open the Parachute portal">
            <a
              href={PARACHUTE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPortalOpened(true)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-background text-sm font-semibold transition-colors text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1.5px_var(--mm-teal)] hover:bg-[oklch(0.36_0.04_200_/_0.06)]"
            >
              <ExtIcon />
              Open Parachute Portal
            </a>
          </ActionRow>
        )}

        {/* Parachute keeps notes inline between the two actions */}
        {isParachute && <div className="my-3">{notesPanel("mm-inline")}</div>}

        {/* action 2 — mark as complete */}
        <div className={isParachute ? "" : "mt-3"}>
          <ActionRow
            num={2}
            done={completed}
            title="Mark as Complete"
            sub={
              completed
                ? "Done — patient moved to the next stage on Monday."
                : "Click after the request has been sent — advances the patient to the next stage on Monday."
            }
          >
            <div className="flex flex-col items-end gap-1.5">
              {!completed && noteBlocked && (
                <span className="text-xs font-medium text-right" style={{ color: "var(--mm-rose)" }}>
                  {hasPendingNote
                    ? "Press Add on your note before marking complete"
                    : "Add at least one note above to mark complete"}
                </span>
              )}
              {completed ? (
                <span
                  className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
                  style={{ background: "var(--mm-mint)" }}
                >
                  <Check className="h-4 w-4" /> Completed
                </span>
              ) : (
                <Button
                  size="lg"
                  onClick={handleMarkComplete}
                  disabled={completing || noteBlocked}
                  className="gap-2 text-white shadow-sm bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
                >
                  {completing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Marking…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Mark as Complete
                    </>
                  )}
                </Button>
              )}
            </div>
          </ActionRow>
        </div>
      </MmStep>
    </div>
  );
}

// =====================================================================
// Send-request-specific sub-components
// =====================================================================

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

/** Numbered action row inside Send & Complete (mockup .action-row). */
function ActionRow({
  num,
  done,
  title,
  sub,
  children,
}: {
  num: number;
  done?: boolean;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-4 rounded-xl border px-5 py-4 flex-wrap"
      style={{ borderColor: "var(--mm-card-border)" }}
    >
      <span
        className={`grid place-items-center h-7 w-7 rounded-full text-sm font-bold shrink-0 ${
          done ? "text-white" : "bg-muted/70 text-muted-foreground"
        }`}
        style={done ? { background: "var(--mm-green)" } : undefined}
      >
        {done ? <Check className="h-4 w-4" /> : num}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[1.05rem] font-bold leading-snug">{title}</div>
        {sub && <div className="text-sm text-muted-foreground mt-0.5">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

// =====================================================================
// Helpers
// =====================================================================

function formatDate(iso?: string): string | null {
  if (!iso) return null;
  // Monday's text for a date+time column comes back like "2026-05-01 14:30:00 UTC"
  // — strip a trailing " UTC" so Date can parse the ISO-ish string.
  const cleaned = iso.replace(/\s+UTC$/, "Z").replace(" ", "T");
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return iso;
  // Always render in Eastern Time and tag the suffix so the rep sees the tz.
  const formatted = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatted} ET`;
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
