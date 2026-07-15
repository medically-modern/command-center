/**
 * ConfirmReceiptPanel — Confirm Receipt redesign (June 2026 mockup
 * confirm-receipt-redesign.html). Visual layer only — ALL existing
 * logic is preserved:
 *   - Attempt slot (1/2/3) comes from Monday's MN Attempts column;
 *     "Escalate" means no more attempts.
 *   - Yes → stamps confirmed name/date, resets MN Attempts, advances
 *     stage to Chase Clinicals, next action +2 business days.
 *   - No → writes "Name — date" into the attempt column, bumps MN
 *     Attempts, 3rd failure flags Escalation Required, otherwise writes
 *     the auto-computed next action date (No → next weekday).
 *   - Escalated + "No" (manager override, all 3 slots used): the required
 *     note is appended to MN Workflow Notes (COL.mnEvalNotes) and only the
 *     next action date moves — patient stays escalated. (Before July 2026
 *     this note was REQUIRED but silently dropped: the escalated branch
 *     wrote only the Next Action Date.)
 *   - Save requires an outcome AND ≥1 note added this session (no
 *     typed-but-unadded note text), and persists doctor-field edits.
 */
import { useEffect, useMemo, useState, useRef } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { etNow, clampToBusinessDay } from "@/lib/masheke/etDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMondayFiles } from "@/hooks/masheke/useMondayFiles";
import {
  COL,
  buildDoctorWriteTasks,
  hasToken,
  writeDate,
  writeDateTime,
  writeLongText,
  writeStatusIndex,
  writeText,
} from "@/lib/masheke/mondayApi";
import { runVerifiedSend } from "@/lib/masheke/mondayWrite";
import { GatewayPendingError, type WriteProgressPhase, type WriteTask } from "@/lib/shared/verifiedWrite";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import { FILE_PROXY_URL, fetchAssetBytes } from "@/lib/shared/mondayAssets";
import { getIdToken, userInitials } from "@/lib/shared/auth";
import {
  ESCALATION_INDEX,
  MN_ATTEMPTS_INDEX,
  SUB_STAGE_INDEX,
} from "@/lib/masheke/mondayMapping";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Phone,
  Plus,
  X,
  XCircle,
} from "lucide-react";
import {
  AskForList,
  FileList,
  LoadingRow,
  MethodHero,
  MmStep,
  MnStatusChip,
  SentChip,
  type TaggedFile,
} from "@/components/masheke/mmKit";
import { useFaxStatus, type FaxStage } from "@/hooks/masheke/useFaxStatus";
import { MissingChecklist } from "@/components/masheke/MissingChecklist";
import { MethodBar } from "@/components/masheke/MethodBar";
import { ActivityRow, formatActivityDate } from "@/components/masheke/PreviousActivityCard";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { buildRequestTemplate, titleCase } from "@/lib/masheke/requestTemplate";
import { loadEvalStateForPatient, computeMnChecklist } from "@/lib/masheke/evalState";
import { shouldShowCgmBlock, shouldShowIpBlock } from "@/lib/masheke/ipPaths";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  onOpenForm?: () => void;
  /** Manager view: "Review the Request" starts as a collapsed dropdown. */
  managerMode?: boolean;
}

// How long a save blocks the screen waiting for Monday to confirm before we
// surface "queued on the server, do not repeat" (same as Chase Clinicals).
const SAVE_CONFIRM_MS = 120_000;

// =====================================================================
// Main panel
// =====================================================================

export function ConfirmReceiptPanel({ patient, onUpdate, managerMode = false }: Props) {
  const mondayFiles = useMondayFiles(patient.id);

  // "What we're still missing" + courtesy-fax message body are derived from
  // the same eval output Send Request uses, so both stages stay in sync.
  const mnChecklist = useMemo(() => {
    const evalState = loadEvalStateForPatient(patient);
    return computeMnChecklist(
      evalState,
      shouldShowCgmBlock(patient.serving),
      shouldShowIpBlock(patient.serving),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, patient.serving, patient.medicalNecessity, patient.mnRequestConsolidated]);
  const [saving, setSaving] = useState(false);
  // Which milestone the in-flight save is at — drives the blocking overlay.
  const [savePhase, setSavePhase] = useState<WriteProgressPhase>("posting");
  const [escalated, setEscalated] = useState(false);
  const escalatedRef = useRef(false);

  // Active-attempt form state — outcome + the single per-attempt note.
  // The note (who they spoke to / what was said) is saved into the attempt's
  // own column, NOT the MN workflow notes. The follow-up date is computed at
  // save time (never held in state — see handleSave).
  const [confirmed, setConfirmed] = useState<"yes" | "no" | null>(null);
  // One free-text note per attempt. Required on "Not Confirmed"; optional
  // (but prompted with an example) on "Confirmed".
  const [attemptNote, setAttemptNote] = useState("");
  // Session-only display state: set after a successful Yes save so the
  // step shows the confirmed banner (no Monday read — the patient leaves
  // this stage on the next refetch anyway).
  const [justConfirmed, setJustConfirmed] = useState<{ note: string; ts: string } | null>(null);
  // Re-send state (step 2) — session-only chip after a successful send.
  const [resending, setResending] = useState(false);
  const [resentNow, setResentNow] = useState(false);
  // For a "Not Confirmed" outcome, the rep must re-send the fax before saving.
  const [faxResent, setFaxResent] = useState(false);
  // Inline "no re-send yet — save anyway?" confirmation (replaces the old
  // blocking window.confirm). Reset whenever the outcome or re-send changes.
  const [noResendWarning, setNoResendWarning] = useState(false);
  // Editable courtesy-fax message. null until the rep edits — until then we
  // show the saved column value (if any) or the freshly generated template.
  const [messageDraft, setMessageDraft] = useState<string | null>(null);
  // Per-send file curation (session only): Monday files the rep removed from
  // THIS send (by assetId) and extra files they added. These drive the ACTUAL
  // send (handleResend) — removing here drops the file from the fax/email but
  // never touches the Monday files column; adding attaches a one-off file.
  const [excludedAssetIds, setExcludedAssetIds] = useState<Set<string>>(() => new Set<string>());
  const [addedFiles, setAddedFiles] = useState<File[]>([]);

  // Reset form when patient changes
  useEffect(() => {
    setConfirmed(null);
    setAttemptNote("");
    setJustConfirmed(null);
    setResentNow(false);
    setFaxResent(false);
    setNoResendWarning(false);
    setMessageDraft(null);
    setExcludedAssetIds(new Set());
    setAddedFiles([]);
  }, [patient.id]);

  // Re-selecting an outcome clears the "must re-send" gate — switching away
  // from "Not Confirmed" and back requires a fresh re-send. Any outcome or
  // re-send change also clears the pending inline save confirmation.
  useEffect(() => {
    if (confirmed !== "no") setFaxResent(false);
    setNoResendWarning(false);
  }, [confirmed]);
  useEffect(() => {
    if (faxResent) setNoResendWarning(false);
  }, [faxResent]);

  // Determine current attempt slot (1, 2, or 3) from MN Attempts column.
  // No value yet → Attempt 1.
  const currentAttempt = useMemo(() => {
    const v = (patient.mnAttempts || "").trim();
    if (v === "Attempt 2") return 2;
    if (v === "Attempt 3") return 3;
    if (v === "Escalate") return null; // already escalated, no more attempts
    return 1;
  }, [patient.mnAttempts]);

  const isEscalated = currentAttempt === null;
  // Managers work the escalated queue — the lock that hides the action UI
  // for escalated patients must NOT apply in manager mode, otherwise a
  // manager can never confirm/advance or send updates to Monday.
  const locked = isEscalated && !managerMode;

  // Build history from the 3 per-attempt text columns. Only attempts
  // that have been saved (column has a value) appear here.
  const history = useMemo<AttemptChip[]>(() => {
    const out: AttemptChip[] = [];
    if (patient.confirmAttempt1) out.push(parseAttemptValue(1, patient.confirmAttempt1));
    if (patient.confirmAttempt2) out.push(parseAttemptValue(2, patient.confirmAttempt2));
    if (patient.confirmAttempt3) out.push(parseAttemptValue(3, patient.confirmAttempt3));
    return out;
  }, [patient.confirmAttempt1, patient.confirmAttempt2, patient.confirmAttempt3]);

  // The round to display/save as active — the first un-logged slot (1..3).
  // Derived from logged attempts so it stays correct even when Monday's MN
  // Attempts counter lags the per-attempt columns.
  const activeAttempt = isEscalated ? 3 : Math.min(history.length + 1, 3);

  // A note is required ONLY when receipt was not confirmed (the rep must
  // explain what happened); a confirmed receipt can save without a note but
  // is prompted to capture who confirmed. "Not Confirmed" must also re-send
  // the fax before it can be saved.
  const hasNote = attemptNote.trim().length > 0;
  // Re-sending the fax on a "Not Confirmed" attempt is strongly recommended
  // but no longer hard-required — Save asks for confirmation instead.
  const canSave =
    !!confirmed &&
    (confirmed !== "no" || hasNote) &&
    !saving &&
    !locked;

  async function handleSave(skipResendWarning = false) {
    if (!canSave) return;
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    // Not Confirmed without a fresh fax re-send — warn INLINE before saving.
    // Never a blocking window.confirm here: a native dialog suspends the save
    // mid-flight indefinitely, and a rep who tabs away and dismisses it an
    // hour later unknowingly commits their stale draft as an attempt (this
    // logged a phantom attempt for a rep on 7/2). The inline row keeps the
    // form fully un-saved and visible until "Save anyway" is clicked.
    if (confirmed === "no" && !faxResent && !skipResendWarning) {
      setNoResendWarning(true);
      return;
    }
    setNoResendWarning(false);
    // Follow-up date computed AT SAVE TIME (No → next weekday, escalated
    // follow-up → 2 weekdays; weekend-clamped) — never trusted from component
    // state, so a stale in-flight completion can never blank it and silently
    // drop the date from the transaction (July 2026 chase incident).
    const safeNextAction = clampToBusinessDay(
      formatDateInput(addBusinessDays(etNow(), confirmed === "no" ? 1 : 2)),
    );
    const toastId = `confirm-save-${patient.id}`;
    const onProgress = (phase: WriteProgressPhase) => {
      setSavePhase(phase);
      if (phase === "accepted") toast.loading("Data in server — writing to Monday…", { id: toastId });
      else if (phase === "writing" || phase === "verifying") toast.loading("Writing to Monday…", { id: toastId });
    };
    // Optimistic patch + success copy are fixed BEFORE the awaits so the
    // pending path (job durably queued, confirmation still running) can apply
    // the exact same patch.
    let patch: Partial<Patient> | undefined;
    let successMsg = "";
    let confirmedBanner: { note: string; ts: string } | null = null;
    setSaving(true);
    setSavePhase("posting");
    toast.loading("Sending to server…", { id: toastId });
    try {
      if (confirmed === "yes") {
        const slot = activeAttempt;
        const value = formatAttemptValue("confirmed", attemptNote.trim(), etNow());
        const fieldKey =
          slot === 1 ? "confirmAttempt1" : slot === 2 ? "confirmAttempt2" : "confirmAttempt3";
        patch = { [fieldKey]: value, subStage: "Chase Clinicals" };
        successMsg = "Receipt confirmed — moved to Chase Clinicals";
        confirmedBanner = { note: attemptNote.trim(), ts: formatDateShort(etNow()) };
        await saveYes(patient, slot, value, onProgress);
        if (isEscalated) {
          // Manager resolved the escalation by confirming receipt — clear
          // the flag so the patient doesn't stay in escalated lists.
          await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.done);
          patch.escalation = "Done";
        }
      } else if (isEscalated) {
        // Manager follow-up on an escalated patient: all 3 attempt slots are
        // used, so there's no attempt column left to log into. The required
        // "what happened" note is NOT discarded — append it to MN Workflow
        // Notes (the shared eval log), then set the next action date
        // (weekend-clamped). Patient stays escalated.
        const nextNotes = appendMnNote(
          patient.mnEvalNotes,
          formatEscalatedConfirmNote(attemptNote.trim(), etNow()),
        );
        patch = { nextActionDate: safeNextAction, mnEvalNotes: nextNotes };
        successMsg = "Follow-up saved — note added to MN Workflow Notes, patient remains escalated";
        await runVerifiedSend({
          itemId: patient.id,
          label: "Confirm Receipt → escalated follow-up",
          stageColumnId: [],
          tasks: [
            // MN Workflow Notes is a DATA column (read-back verified). No
            // stage-advancer here — an escalated follow-up never advances.
            { label: "MN Workflow Notes", columnId: COL.mnEvalNotes, value: { text: nextNotes }, fn: () => writeLongText(patient.id, COL.mnEvalNotes, nextNotes) },
            { label: "Next Action Date", columnId: COL.nextActionDate, value: { date: safeNextAction }, fn: () => writeDate(patient.id, COL.nextActionDate, safeNextAction) },
          ],
          onProgress,
          requireDone: true,
          waitForDoneMs: SAVE_CONFIRM_MS,
        });
      } else {
        const attempt = currentAttempt ?? 1;
        const value = formatAttemptValue("not_confirmed", attemptNote.trim(), etNow());
        const nextSlot = nextMnAttempt(attempt);
        // Optimistic local update so the chip + next slot show before refetch
        const fieldKey =
          attempt === 1 ? "confirmAttempt1" : attempt === 2 ? "confirmAttempt2" : "confirmAttempt3";
        patch = {
          [fieldKey]: value,
          mnAttempts: nextSlot,
          nextActionDate: safeNextAction,
          escalation: nextSlot === "Escalate" ? "Escalation Required" : patient.escalation,
        };
        successMsg =
          nextSlot === "Escalate"
            ? `Attempt ${attempt} saved — escalated`
            : `Attempt ${attempt} saved`;
        await saveNo({
          patient,
          attempt,
          value,
          nextSlot,
          nextActionDateInput: safeNextAction,
          onProgress,
        });
      }
      onUpdate(patch);
      if (confirmedBanner) setJustConfirmed(confirmedBanner);
      // Persist any doctor-field edits made on the method hero
      const docTasks = buildDoctorWriteTasks(patient);
      if (docTasks.length) await Promise.all(docTasks.map((t) => t.run()));
      // Write escalation if toggled
      if (escalatedRef.current) {
        await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required);
        setEscalated(false); escalatedRef.current = false;
      }
      // Reset form for next attempt (or clear if patient is leaving the tab)
      setConfirmed(null);
      setAttemptNote("");
      toast.success(`${successMsg} — confirmed in Monday`, { id: toastId });
    } catch (e) {
      if (e instanceof GatewayPendingError && patch) {
        // The gateway durably queued the job; it WILL complete server-side.
        // Reflect it locally, but make clear the Monday confirmation is
        // still pending.
        onUpdate(patch);
        if (confirmedBanner) setJustConfirmed(confirmedBanner);
        setConfirmed(null);
        setAttemptNote("");
        toast.warning("Data in server — Monday confirmation still pending", {
          id: toastId,
          description: e.message,
          duration: 12_000,
        });
      } else {
        toast.error("Save failed — nothing was advanced", {
          id: toastId,
          description: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  const method = patient.clinicalsMethod ?? "—";
  const isEmail = method === "Email";
  const recipient = isEmail ? patient.doctorEmail : patient.doctorFax;
  // const mnLetterPresent = mondayFiles.mnRequestLetter.length > 0; // (unused while fax re-send is paused)

  // The message that will be sent — the rep's edit, else the saved column
  // value, else a freshly generated template.
  const currentMessage =
    messageDraft ?? patient.requestBody ?? buildRequestTemplate(patient, mnChecklist);

  // Re-send the request — identical writes to Send Request's Send action:
  // flip the Send Request trigger column (Monday's automation re-dispatches
  // the files via Supermail), save the approved message body, and stamp
  // Request Sent At.
  async function handleResend(): Promise<boolean> {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return false;
    }
    const idToken = getIdToken();
    if (!idToken) {
      toast.error("Sign in with your medicallymodern.com account to send.");
      return false;
    }
    if (!recipient) {
      toast.error(`No doctor ${isEmail ? "email" : "fax"} on file.`);
      return false;
    }
    setResending(true);
    try {
      // Send the SAME way Send Request does: POST recipient + subject + message
      // + the Monday request files to the worker /send-message (RingCentral),
      // not the dormant trigger column. A bare fax number becomes
      // <digits>@rcfax.com (RingCentral turns that into a fax).
      const to = recipient.includes("@") ? recipient : `${recipient.replace(/\D/g, "")}@rcfax.com`;
      // Send EXACTLY what the card shows: the Monday files the rep kept (the X
      // removes them from `sendMondayFiles`, not just from view) plus any files
      // the rep added for this send.
      const files: File[] = [];
      for (const { file: f } of sendMondayFiles) {
        const url = f.public_url || f.url;
        if (!url) continue;
        const bytes = await fetchAssetBytes(url, f.name);
        files.push(new File([bytes as BlobPart], f.name));
      }
      files.push(...addedFiles);
      const fd = new FormData();
      fd.append("recipients", JSON.stringify([to]));
      fd.append("subject", `Medical necessity documentation for ${titleCase(patient.name || "")}`);
      fd.append("body", currentMessage);
      for (const f of files) fd.append("files", f);
      const res = await fetch(`${FILE_PROXY_URL}/send-message`, {
        method: "POST",
        headers: { "X-MM-Auth": idToken },
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        sender?: string;
        results?: { to: string; ok: boolean; error?: string | null }[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        const failed = (data.results || []).filter((r) => !r.ok);
        throw new Error(
          failed.length
            ? failed.map((r) => `${r.to}: ${r.error || "failed"}`).join("; ")
            : data.error || `HTTP ${res.status}`,
        );
      }
      // Save the approved message body + stamp Request Sent At — verified /send.
      const sentAt = new Date();
      const sentIso = sentAt.toISOString();
      await runVerifiedSend({
        itemId: patient.id,
        label: "Confirm Receipt → courtesy re-send",
        stageColumnId: [],
        tasks: [
          { label: "Request Body", columnId: COL.requestBody, value: { text: currentMessage }, fn: () => writeLongText(patient.id, COL.requestBody, currentMessage) },
          { label: "Request Sent At", columnId: COL.requestSentAt, value: { date: sentIso.slice(0, 10), time: sentIso.slice(11, 19) }, fn: () => writeDateTime(patient.id, COL.requestSentAt, sentAt) },
        ],
      });
      onUpdate({ requestBody: currentMessage, requestSentAt: sentIso });
      setResentNow(true);
      toast.success(isEmail ? "Email sent via RingCentral" : "Fax sent via RingCentral");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Re-send] failed", msg);
      toast.error("Send failed", { description: msg });
      return false;
    } finally {
      setResending(false);
    }
  }

  const showCgm =
    patient.serving === "CGM" ||
    patient.serving === "Insulin Pump + CGM" ||
    patient.serving === "Supplies + CGM";
  const showIp = patient.serving !== "CGM";

  // The Monday files auto-attached to the courtesy send (script templates + MN
  // letter + clinicals), tagged for display. `sendMondayFiles` is that list
  // minus anything the rep removed (X) for this send — the single source of
  // truth for BOTH the attachment card and what handleResend actually sends.
  const mondayAttachments: TaggedFile[] = [
    ...(showCgm ? mondayFiles.cgmTemplate.map((f) => ({ file: f, tag: "CGM" })) : []),
    ...(showIp ? mondayFiles.ipTemplate.map((f) => ({ file: f, tag: "IP" })) : []),
    ...mondayFiles.mnRequestLetter.map((f) => ({ file: f, tag: "MN" })),
    ...mondayFiles.clinicalFiles.map((f) => ({ file: f, tag: "Clinical" })),
  ];
  const sendMondayFiles = mondayAttachments.filter((f) => !excludedAssetIds.has(f.file.assetId));

  const isLastAttempt = currentAttempt === 3;

  // Provider-ask round (same counter Send Request shows) for the page header.
  const cycle = patient.evaluationCounter ?? 1;

  return (
    <div className="flex flex-col gap-6">
      {/* Blocks the WHOLE screen (sidebar included) while a save is in
          flight, until Monday confirms — switching patients mid-save is what
          corrupted saves in the July 2026 dropped-date incident. */}
      <SaveProgressOverlay open={saving} phase={savePhase} />

      {/* Round header — which provider-ask cycle this is (from the counter). */}
      <div
        className="rounded-2xl border border-l-4 px-6 py-4 shadow-sm"
        style={{ borderColor: "var(--mm-card-border)", borderLeftColor: "var(--mm-green)" }}
      >
        <h2 className="text-xl font-bold tracking-tight">Confirm Receipt #{cycle}</h2>
      </div>

      {/* ── Step 1 — Send the Courtesy Fax (first action) — recipient, a
            tight attachment list, a delivered timestamp, and a one-press
            re-send. The written message lives in a collapsible drawer. ── */}
      <MmStep num={1} title={isEmail ? "Send the Courtesy Email" : "Send the Courtesy Fax"}>
        <CourtesyFax
          key={patient.id}
          isEmail={isEmail}
          recipient={recipient}
          files={mondayAttachments}
          excludedAssetIds={excludedAssetIds}
          addedFiles={addedFiles}
          onRemoveMondayFile={(assetId) =>
            setExcludedAssetIds((prev) => new Set(prev).add(assetId))
          }
          onAddFiles={(picked) => setAddedFiles((prev) => [...prev, ...picked])}
          onRemoveAddedFile={(idx) =>
            setAddedFiles((prev) => prev.filter((_, i) => i !== idx))
          }
          filesLoading={mondayFiles.loading}
          messageBody={currentMessage}
          onMessageChange={setMessageDraft}
          sentAt={patient.requestSentAt}
          resending={resending}
          resentNow={resentNow}
          onResend={handleResend}
        />
      </MmStep>

      {/* ── Step 2 — Review Context & Attempt History (collapsed dropdown in
            manager view) ── */}
      <MmStep
        num={2}
        title="Review Context & Attempt History"
        collapsible={managerMode}
        defaultOpen={!managerMode}
      >
        {/* Referral source — quick context for the call */}
        <div
          className="flex items-center gap-2.5 rounded-xl border px-4 py-2.5 mb-5"
          style={{ borderColor: "var(--mm-card-border)" }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Referral Source
          </span>
          <span className="text-sm font-bold">{patient.referralSource || "—"}</span>
        </div>

        {/* What we're still missing — identical to Send Request */}
        <h4 className="text-[1.05rem] font-bold tracking-tight mb-2.5">What we're still missing</h4>
        <MissingChecklist checklist={mnChecklist} />

        {/* Attempt history — always three cards, status per round */}
        <h4 className="text-[1.05rem] font-bold tracking-tight mb-2.5 mt-6">
          Attempt {activeAttempt} of 3
        </h4>
        <AttemptCards
          history={history}
          isEscalated={isEscalated}
          justConfirmed={justConfirmed}
        />

        {/* Other activity — the non-confirm-receipt rounds */}
        <h4 className="text-[1.05rem] font-bold tracking-tight mb-2.5 mt-6">Other activity</h4>
        <OtherActivity patient={patient} />

        {/* MN Workflow Notes — READ-ONLY here. Confirm Receipt never writes to
            these; on re-evaluation a prior round's attempt notes get folded in,
            so the rep can read the running history without editing it. */}
        {patient.mnEvalNotes?.trim() && (
          <>
            <h4 className="text-[1.05rem] font-bold tracking-tight mb-2.5 mt-6">
              MN Workflow Notes{" "}
              <span className="text-xs font-medium text-muted-foreground">(read-only)</span>
            </h4>
            <div
              className="rounded-xl border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground bg-muted/30 max-h-64 overflow-y-auto"
              style={{ borderColor: "var(--mm-card-border)" }}
            >
              {patient.mnEvalNotes}
            </div>
          </>
        )}
      </MmStep>

      {/* ── Step 3 — Call & Confirm Receipt — who to call (method + phone),
            call notes, and the receipt outcome, all in one step. ── */}
      <MmStep
        num={3}
        title="Call & Confirm Receipt"
        sub={
          justConfirmed || locked
            ? undefined
            : isLastAttempt
              ? "Final attempt — if not confirmed, the patient will be flagged for escalation."
              : undefined
        }
        rightAccessory={
          justConfirmed ? (
            <span
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
              style={{ background: "var(--mm-mint)" }}
            >
              <Check className="h-4 w-4" /> Confirmed
            </span>
          ) : undefined
        }
      >
        {/* Who to call — doctor name + a call button for the office */}
        <div
          className="flex items-center gap-4 rounded-2xl border border-l-4 p-5"
          style={{ borderColor: "var(--mm-card-border)", borderLeftColor: "var(--mm-green)" }}
        >
          <p className="text-xl font-bold tracking-tight min-w-0 truncate">
            {doctorDisplayName(patient.doctorName)}
          </p>
          <div className="ml-auto shrink-0">
            <CallBox phone={patient.doctorPhone} />
          </div>
        </div>

        {/* Outcome */}
        <div className="mt-5">
        {justConfirmed ? (
          <>
            <div
              className="flex items-center gap-3 rounded-xl border px-4.5 py-4"
              style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}
            >
              <CheckCircle2 className="h-[22px] w-[22px] shrink-0" style={{ color: "var(--mm-green)" }} />
              <div>
                <p className="text-base font-bold text-[color:var(--mm-teal)]">
                  Receipt confirmed · {justConfirmed.ts}
                </p>
                <p className="text-sm text-muted-foreground">
                  Patient advances to the next stage on Monday.
                </p>
              </div>
            </div>
          </>
        ) : locked ? (
          <>
            <div
              className="flex items-center gap-3 rounded-xl border px-4.5 py-4"
              style={{
                background: "var(--mm-rose-soft)",
                borderColor: "oklch(0.62 0.13 18 / 0.35)",
              }}
            >
              <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "var(--mm-rose)" }} />
              <div>
                <p className="text-base font-bold" style={{ color: "var(--mm-rose)" }}>
                  Escalated
                </p>
                <p className="text-sm text-muted-foreground">
                  All 3 confirm-receipt attempts came back unsuccessful. Notes are still editable above.
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            {isEscalated && managerMode && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 mb-1">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-800">
                  <span className="font-bold">Manager override</span> — all 3 attempts used.
                  "Yes" advances the patient and clears the escalation; "No" logs your note to
                  MN Workflow Notes and sets the next action date.
                </p>
              </div>
            )}
            <FilesLabel className="mt-0">
              Did they confirm receipt?{" "}
              <span className="font-bold" style={{ color: "var(--mm-rose)" }}>*</span>
            </FilesLabel>
            <div className="flex gap-2.5 w-full">
              <SegBtn
                tone="g"
                selected={confirmed === "yes"}
                onClick={() => setConfirmed(confirmed === "yes" ? null : "yes")}
              >
                <Check className="h-4 w-4" /> Confirmed
              </SegBtn>
              <SegBtn
                tone="r"
                selected={confirmed === "no"}
                onClick={() => setConfirmed(confirmed === "no" ? null : "no")}
              >
                <X className="h-4 w-4" /> Not Confirmed
              </SegBtn>
            </div>

            {confirmed && (
              <>
                <FilesLabel>
                  {confirmed === "yes" ? "Confirmation note — who confirmed & what they said" : "What happened on this attempt?"}
                  {confirmed === "no" && (
                    <span className="font-bold" style={{ color: "var(--mm-rose)" }}> *</span>
                  )}
                </FilesLabel>
                <textarea
                  value={attemptNote}
                  onChange={(e) => setAttemptNote(e.target.value)}
                  rows={3}
                  placeholder={
                    confirmed === "yes"
                      ? "Name, title, and what they said — e.g. Donna, Records Coordinator: confirmed all 4 pages received, will fax chart notes by Friday"
                      : "Who you spoke to and what happened — e.g. Left voicemail with front desk; records dept out until Monday"
                  }
                  className="w-full rounded-xl border px-4 py-3 text-sm leading-relaxed bg-background resize-y focus:outline-none placeholder:text-muted-foreground/50"
                  style={{ borderColor: "var(--mm-card-border)" }}
                />
              </>
            )}

            {confirmed === "no" && (
              <div
                className="mt-3 rounded-xl border px-4 py-3.5"
                style={{ borderColor: "var(--mm-card-border)" }}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  Re-send the {isEmail ? "email" : "fax"} <span className="normal-case font-semibold text-[color:var(--mm-rose)]">— Important</span>
                </p>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <Input
                    value={recipient ?? ""}
                    onChange={(e) =>
                      onUpdate(isEmail ? { doctorEmail: e.target.value } : { doctorFax: e.target.value })
                    }
                    placeholder={isEmail ? "doctor email" : "fax number"}
                    className="h-[42px] bg-background flex-1 min-w-[220px]"
                  />
                  <Button
                    onClick={async () => {
                      const ok = await handleResend();
                      if (ok) setFaxResent(true);
                    }}
                    disabled={resending || !recipient || faxResent}
                    className="gap-2 text-white shadow-sm bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
                  >
                    {resending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                      </>
                    ) : faxResent ? (
                      <>
                        <Check className="h-4 w-4" /> Re-sent
                      </>
                    ) : (
                      <>
                        <SendIcon /> Re-send {isEmail ? "Email" : "Fax"}
                      </>
                    )}
                  </Button>
                </div>
                {faxResent && (
                  <p className="text-xs mt-2 font-semibold" style={{ color: "var(--mm-green)" }}>
                    Fax re-sent — you're good to save this attempt.
                  </p>
                )}
              </div>
            )}

            {noResendWarning && (
              <div
                className="mt-4 rounded-xl border px-4 py-3.5 flex flex-col gap-3"
                style={{ borderColor: "var(--amber-ring, #e8c47a)", background: "var(--amber-soft, #fdf6e3)" }}
              >
                <p className="text-sm font-semibold flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  You haven't re-sent the {isEmail ? "email" : "fax"} on this attempt — the office may
                  still be missing the request.
                </p>
                <div className="flex gap-2.5">
                  <Button
                    size="sm"
                    onClick={() => handleSave(true)}
                    disabled={saving}
                    className="gap-1.5 text-white bg-amber-600 hover:bg-amber-700"
                  >
                    Save attempt anyway
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setNoResendWarning(false)}>
                    Go back
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-col items-center gap-2 mt-5">
              <Button
                size="lg"
                onClick={() => handleSave()}
                disabled={!canSave}
                className="gap-2 text-white shadow-sm min-w-[200px] justify-center bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save Attempt
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                {saveHint({
                  confirmed,
                  hasNote,
                  faxResent,
                  attemptNumber: currentAttempt ?? 1,
                })}
              </p>
              {currentAttempt === 3 && confirmed === "no" && (
                <p className="text-xs font-semibold text-amber-600 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Note: This action will escalate this patient to a supervisor.
                </p>
              )}
            </div>
          </>
        )}
        </div>
      </MmStep>
    </div>
  );
}

// =====================================================================
// Save handlers (unchanged)
// =====================================================================

async function saveYes(
  patient: Patient,
  slot: number,
  attemptValue: string,
  onProgress?: (phase: WriteProgressPhase) => void,
) {
  // Yes path: log the confirmation note in the active attempt column (so the
  // effort + confirmed date/time show on Chase), advance stage. Also reset MN
  // Attempts back to "Attempt 1" so the Chase Clinicals tab starts fresh (the
  // column is shared across stages). The "who confirmed" and the confirmed
  // date/time now both live inside the attempt note, so we no longer write the
  // separate Receipt Confirmed Name / Date columns.
  const columnId =
    slot === 1 ? COL.confirmAttempt1 : slot === 2 ? COL.confirmAttempt2 : COL.confirmAttempt3;
  // Entry into Chase Clinicals → +3 business days (matches chase cadence)
  const nextAction = formatDateInput(addBusinessDays(etNow(), 3));
  // KEEP OUR BACKEND: still stamp the structured Receipt Confirmed Date so any
  // Monday automation / report / oversight keyed on it keeps working (the "who"
  // also lives in the attempt note per Brandon's model). Verified write →
  // gateway /send: data columns are read-back confirmed BEFORE the stage flips.
  const today = formatDateInput(etNow());
  const tasks: WriteTask[] = [
    { label: `Confirm Attempt ${slot}`, columnId, value: attemptValue, expectedText: attemptValue, fn: () => writeText(patient.id, columnId, attemptValue) },
    { label: "Receipt Confirmed Date", columnId: COL.receiptConfirmedDate, value: { date: today }, fn: () => writeDate(patient.id, COL.receiptConfirmedDate, today) },
    { label: "MN Attempts → Attempt 1", columnId: COL.mnAttempts, value: { index: MN_ATTEMPTS_INDEX.attempt1 }, fn: () => writeStatusIndex(patient.id, COL.mnAttempts, MN_ATTEMPTS_INDEX.attempt1) },
    { label: "Next Action Date", columnId: COL.nextActionDate, value: { date: nextAction }, fn: () => writeDate(patient.id, COL.nextActionDate, nextAction) },
    { label: "Sub-Stage → Chase Clinicals", columnId: COL.subStage, value: { index: SUB_STAGE_INDEX.chase }, fn: () => writeStatusIndex(patient.id, COL.subStage, SUB_STAGE_INDEX.chase) },
  ];
  await runVerifiedSend({
    itemId: patient.id,
    label: "Confirm Receipt → Confirmed (advance to Chase)",
    tasks,
    stageColumnId: COL.subStage,
    onProgress,
    requireDone: true,
    waitForDoneMs: SAVE_CONFIRM_MS,
  });
}

async function saveNo({
  patient,
  attempt,
  value,
  nextSlot,
  nextActionDateInput,
  onProgress,
}: {
  patient: Patient;
  attempt: number;
  value: string;
  nextSlot: "Attempt 2" | "Attempt 3" | "Escalate";
  nextActionDateInput: string;
  onProgress?: (phase: WriteProgressPhase) => void;
}) {
  // The attempt note is a DATA column (read-back verified) so it lands BEFORE
  // MN Attempts / Escalation flip (managers + automations key on those).
  // Verified write → gateway /send when available.
  const columnId =
    attempt === 1
      ? COL.confirmAttempt1
      : attempt === 2
        ? COL.confirmAttempt2
        : COL.confirmAttempt3;
  const mnIdx =
    nextSlot === "Attempt 2"
      ? MN_ATTEMPTS_INDEX.attempt2
      : nextSlot === "Attempt 3"
        ? MN_ATTEMPTS_INDEX.attempt3
        : MN_ATTEMPTS_INDEX.escalate;
  const escalate = nextSlot === "Escalate";
  const tasks: WriteTask[] = [
    { label: `Confirm Attempt ${attempt}`, columnId, value, expectedText: value, fn: () => writeText(patient.id, columnId, value) },
    { label: `MN Attempts → ${nextSlot}`, columnId: COL.mnAttempts, value: { index: mnIdx }, fn: () => writeStatusIndex(patient.id, COL.mnAttempts, mnIdx) },
  ];
  const stageColumnId: string[] = [COL.mnAttempts];
  if (escalate) {
    tasks.push({ label: "Escalation → Required", columnId: COL.escalation, value: { index: ESCALATION_INDEX.required }, fn: () => writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required) });
    stageColumnId.push(COL.escalation);
  } else {
    // A non-escalating "not confirmed" MUST reschedule the patient — without
    // this date they stay "due now" forever and get re-worked, burning
    // attempts (the 7/6 incident). Abort loudly rather than write a partial.
    if (!nextActionDateInput) {
      throw new Error("Next Action Date failed to compute — nothing was written. Reload and try again.");
    }
    tasks.push({ label: "Next Action Date", columnId: COL.nextActionDate, value: { date: nextActionDateInput }, fn: () => writeDate(patient.id, COL.nextActionDate, nextActionDateInput) });
  }
  await runVerifiedSend({
    itemId: patient.id,
    label: `Confirm Receipt → Attempt ${attempt} (${nextSlot})`,
    tasks,
    stageColumnId,
    onProgress,
    requireDone: true,
    waitForDoneMs: SAVE_CONFIRM_MS,
  });
}

// =====================================================================
// Sub-components
// =====================================================================

/** Step 1 courtesy-fax — recipient + delivered timestamp + one-press re-send,
 *  a tight attachment list, and the written message tucked into a drawer. */
function CourtesyFax({
  isEmail,
  recipient,
  files,
  excludedAssetIds,
  addedFiles,
  onRemoveMondayFile,
  onAddFiles,
  onRemoveAddedFile,
  filesLoading,
  messageBody,
  onMessageChange,
  sentAt,
  resending,
  resentNow,
  onResend,
}: {
  isEmail: boolean;
  recipient?: string;
  files: TaggedFile[];
  excludedAssetIds: Set<string>;
  addedFiles: File[];
  onRemoveMondayFile: (assetId: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveAddedFile: (idx: number) => void;
  filesLoading: boolean;
  messageBody: string;
  onMessageChange: (v: string) => void;
  sentAt?: string;
  resending: boolean;
  resentNow: boolean;
  onResend: () => void;
}) {
  const channel = isEmail ? "Email" : "Fax";
  const [showMsg, setShowMsg] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // The files that will actually be sent. Curation state lives in the parent so
  // handleResend sends EXACTLY this list: Monday files the rep kept (an X drops
  // the file from the send, not just from view — it never touches the Monday
  // files column) plus any files the rep added for this send.
  const sendFiles = files.filter((f) => !excludedAssetIds.has(f.file.assetId));
  // Live RingCentral fax status (fax only, same-day only). Polls RC's message
  // store for the real Queued → Sent (or Failed) status of this send.
  const faxActive = !isEmail && !!sentAt && isSentToday(sentAt);
  const faxStatus = useFaxStatus(recipient, sentAt, faxActive);
  return (
    <div className="flex flex-col gap-3">
      {/* Recipient · delivered · re-send — all on one compact row */}
      <div
        className="flex items-center gap-3 rounded-xl border px-4 py-2.5 flex-wrap"
        style={{ borderColor: "var(--mm-card-border)" }}
      >
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">To</span>
        <span className="text-[0.95rem] font-bold">
          {recipient || `(no doctor ${isEmail ? "email" : "fax"} on file)`}
        </span>
        {!isEmail ? (
          faxStatus ? (
            <FaxStatusChip stage={faxStatus.stage} at={faxStatus.at} sentAt={sentAt} />
          ) : resentNow ? (
            <DeliveredChip label="Re-sent just now" />
          ) : null
        ) : resentNow ? (
          <DeliveredChip label="Re-sent just now" />
        ) : sentAt && isSentToday(sentAt) ? (
          <DeliveredChip label={`Delivered · ${formatSent(sentAt)}`} />
        ) : null}
        <Button
          onClick={onResend}
          disabled={resending || !recipient}
          className="ml-auto gap-2 text-white shadow-sm bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
        >
          {resending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <SendIcon />
              Re-send {channel}
            </>
          )}
        </Button>
      </div>

      {/* Attachments — the files that will be sent. Each can be removed from
          this fax (✕) without deleting it from the Monday files column. */}
      {filesLoading && files.length === 0 ? (
        <LoadingRow />
      ) : sendFiles.length === 0 && addedFiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files attached.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {sendFiles.map(({ file: f, tag }) => {
            const url = f.public_url || f.url;
            return (
              <span
                key={f.assetId}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
                style={{ borderColor: "var(--mm-card-border)" }}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-[color:var(--mm-teal)]" />
                <button
                  type="button"
                  disabled={!url}
                  onClick={() => url && openFileViewer({ url, name: f.name })}
                  title={f.name}
                  className="max-w-[200px] truncate hover:underline disabled:no-underline disabled:opacity-50"
                >
                  {f.name}
                </button>
                {tag && (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{tag}</span>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveMondayFile(f.assetId)}
                  title={`Remove from this ${channel.toLowerCase()} (kept on Monday)`}
                  className="shrink-0 text-muted-foreground hover:text-[color:var(--mm-rose)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          {addedFiles.map((f, i) => (
            <span
              key={`added-${i}-${f.name}`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--mm-mint-ring)", background: "var(--mm-mint)" }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-[color:var(--mm-teal)]" />
              <span className="max-w-[200px] truncate">{f.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--mm-teal)]">New</span>
              <button
                type="button"
                onClick={() => onRemoveAddedFile(i)}
                title="Remove from this send"
                className="shrink-0 text-muted-foreground hover:text-[color:var(--mm-rose)]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add files to this send — click or drag & drop. Added files go out with
          the fax/email and appear above tagged "New". */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = Array.from(e.dataTransfer?.files ?? []);
          if (dropped.length) onAddFiles(dropped);
        }}
        className={`flex items-center gap-2 cursor-pointer rounded-xl border border-dashed px-3 py-2.5 text-sm transition-colors ${
          dragOver ? "text-foreground bg-emerald-50" : "text-muted-foreground hover:bg-muted/30"
        }`}
        style={{ borderColor: dragOver ? "var(--mm-green)" : "var(--mm-card-border)" }}
      >
        <Plus className="h-4 w-4 shrink-0" />
        <span>
          {dragOver
            ? "Drop files to attach"
            : `Add files to this ${channel.toLowerCase()} — click or drag & drop`}
        </span>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length) onAddFiles(picked);
            e.target.value = "";
          }}
        />
      </label>

      {/* Written message — collapsible, editable drawer. */}
      <div>
        <button
          type="button"
          onClick={() => setShowMsg((o) => !o)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${showMsg ? "rotate-90" : ""}`} />
          {showMsg ? "Hide message" : "Edit message"}
        </button>
        {showMsg && (
          <textarea
            value={messageBody}
            onChange={(e) => onMessageChange(e.target.value)}
            rows={10}
            className="mt-2 w-full whitespace-pre-wrap rounded-xl border px-4 py-3 text-sm leading-relaxed font-sans bg-background resize-y focus:outline-none"
            style={{ borderColor: "var(--mm-card-border)" }}
          />
        )}
      </div>
    </div>
  );
}

/** Small mint "delivered/sent" chip with a timestamp. */
function DeliveredChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
      style={{ background: "var(--mm-mint)" }}
    >
      <CheckCircle2 className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

/** Live RingCentral fax-status pill. Animated (spinner + pulse) while the fax is
 *  in flight (processing → queued), then settles to "Sent · <time>" (✓ mint) or
 *  "Fax failed" (✗ rose). Mirrors RingCentral's real Queued/Sent status. */
function FaxStatusChip({ stage, at, sentAt }: { stage: FaxStage; at?: string; sentAt?: string }) {
  if (stage === "sent") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
        style={{ background: "var(--mm-mint)" }}
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> Sent · {formatSent(at || sentAt || "")}
      </span>
    );
  }
  if (stage === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
        style={{ background: "var(--mm-rose-soft)", color: "var(--mm-rose)", boxShadow: "inset 0 0 0 1px oklch(0.62 0.13 18 / 0.35)" }}
      >
        <XCircle className="h-3.5 w-3.5" /> Fax failed{at ? ` · ${formatSent(at)}` : ""} — re-send
      </span>
    );
  }
  if (stage === "submitted") {
    // RC has accepted the fax and it's in transit — no issues. Static (no
    // spinner/pulse) so the rep knows it's safely handed off and can move on.
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
        style={{ background: "oklch(0.95 0.05 240)", color: "oklch(0.45 0.13 250)", boxShadow: "inset 0 0 0 1px oklch(0.80 0.08 250)" }}
      >
        <Clock className="h-3.5 w-3.5" /> Submitted · {formatSent(at || sentAt || "")}
      </span>
    );
  }
  // processing — still waiting for RC to register the fax; keep it animated.
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold animate-pulse"
      style={{ background: "oklch(0.97 0.04 85)", color: "oklch(0.48 0.10 70)", boxShadow: "inset 0 0 0 1px oklch(0.82 0.10 80)" }}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing · {formatSent(sentAt || "")}
    </span>
  );
}

/** Confirm-receipt attempts — always three cards, status per round
 *  (Corey's mockup). Worked attempts show "Not confirmed", the active round
 *  "In progress", future rounds "Scheduled" (3rd flags escalation). */
function AttemptCards({
  history,
  isEscalated,
  justConfirmed,
}: {
  history: AttemptChip[];
  isEscalated: boolean;
  justConfirmed: { note: string; ts: string } | null;
}) {
  // The active round is the first slot that hasn't been logged yet — derived
  // from the logged attempts so it's correct even if Monday's MN Attempts
  // counter is out of sync with the per-attempt columns.
  const doneSlots = new Set(history.map((h) => h.attempt));
  const activeSlot = [1, 2, 3].find((n) => !doneSlots.has(n)) ?? null;
  const cards = [1, 2, 3].map((n) => {
    const h = history.find((x) => x.attempt === n);
    if (justConfirmed && activeSlot === n && !h) {
      return {
        n,
        status: "confirmed" as const,
        date: justConfirmed.ts,
        desc: justConfirmed.note,
      };
    }
    if (h) {
      // Show only the actual note logged on the attempt column — the outcome
      // pill already conveys confirmed / not confirmed.
      return {
        n,
        status: h.outcome === "confirmed" ? ("confirmed" as const) : ("not_confirmed" as const),
        date: h.date || "—",
        desc: h.note,
      };
    }
    if (!isEscalated && activeSlot === n) {
      return { n, status: "in_progress" as const, date: "Today", desc: "" };
    }
    return {
      n,
      status: "scheduled" as const,
      date: "—",
      desc: "",
    };
  });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {cards.map((c) => (
        <AttemptCard key={c.n} {...c} />
      ))}
    </div>
  );
}

function AttemptCard({
  n,
  status,
  date,
  desc,
}: {
  n: number;
  status: "confirmed" | "not_confirmed" | "in_progress" | "scheduled";
  date: string;
  desc: string;
}) {
  // Status shown by a bold colored border. The current round (in progress /
  // just confirmed) is bright white and fully opaque; every other round is
  // grayed + dimmed so it's obvious which attempt you're on.
  const cfg = {
    confirmed: { border: "var(--mm-green)", width: 2, current: true, pillColor: "var(--mm-green)", label: "Confirmed" },
    not_confirmed: { border: "var(--mm-rose)", width: 2, current: false, pillColor: "var(--mm-rose)", label: "Not confirmed" },
    in_progress: { border: "var(--mm-teal)", width: 2, current: true, pillColor: "var(--mm-teal)", label: "In progress" },
    scheduled: { border: "var(--mm-card-border)", width: 1, current: false, pillColor: "var(--muted-foreground)", label: "" },
  }[status];
  return (
    <div
      className={`rounded-xl p-3.5 ${cfg.current ? "bg-card" : "bg-muted/50"}`}
      style={{
        border: `${cfg.width}px solid ${cfg.border}`,
        opacity: cfg.current ? 1 : 0.6,
        ...(cfg.current ? { boxShadow: "0 1px 2px rgba(15,31,36,.06)" } : {}),
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Attempt {n}
        </span>
        {cfg.label && (
          <span
            className="rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: cfg.pillColor }}
          >
            {cfg.label}
          </span>
        )}
      </div>
      <p className="text-sm font-bold mt-2">{date}</p>
      {desc && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{desc}</p>}
    </div>
  );
}

/** Non-confirm-receipt activity (Send Request + Chase Clinicals) as compact
 *  rows. The Send Request line carries the fax/email it went to. */
function OtherActivity({ patient }: { patient: Patient }) {
  const method = patient.clinicalsMethod ?? "Fax";
  const dest = method === "Email" ? patient.doctorEmail : method === "Fax" ? patient.doctorFax : undefined;
  const sendItems = patient.requestSentAt
    ? [`${formatActivityDate(patient.requestSentAt)} · ${method}${dest ? ` · ${dest}` : ""}`]
    : [];
  const chaseItems = [patient.chaseAttempt1, patient.chaseAttempt2, patient.chaseAttempt3].filter(Boolean) as string[];
  return (
    <div className="space-y-2.5">
      <ActivityRow label="Send Request" items={sendItems} />
      <ActivityRow label="Chase Clinicals" items={chaseItems} />
    </div>
  );
}

/** "Dr. {name}" — prefixes "Dr." unless the name already has it. */
function doctorDisplayName(name?: string): string {
  const n = (name ?? "").trim();
  if (!n) return "—";
  return /^dr\.?\s/i.test(n) ? n : `Dr. ${n}`;
}

/** Right-side "Call" button on the method bar — a tel: link styled as a
 *  button so the rep can click to dial. */
function CallBox({ phone }: { phone?: string }) {
  const display = formatPhoneDisplay(phone);
  const tel = (phone ?? "").replace(/[^\d+]/g, "");
  return (
    <a
      href={tel ? `tel:${tel}` : undefined}
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-base font-bold text-white shadow-sm transition-opacity hover:opacity-90 bg-[color:var(--mm-teal)] aria-disabled:opacity-50"
      aria-disabled={!tel}
    >
      <Phone className="h-4 w-4 shrink-0" /> Call {display}
    </a>
  );
}

/** "Request sent" context banner — kept from the previous design so the
 *  agent knows whether the request actually went out before calling. */
function RequestSentBanner({ patient }: { patient: Patient }) {
  const sent = patient.requestSentAt;
  if (!sent) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border px-4 py-3"
        style={{ background: "var(--mm-rose-soft)", borderColor: "oklch(0.62 0.13 18 / 0.35)" }}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--mm-rose)" }} />
        <div>
          <p className="text-sm font-bold" style={{ color: "var(--mm-rose)" }}>
            No Request Sent date on file
          </p>
          <p className="text-xs text-muted-foreground">
            Confirm the request actually went out before calling — the column is blank on Monday.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}
    >
      <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "var(--mm-green)" }} />
      <div>
        <p className="text-sm font-bold text-[color:var(--mm-teal)]">Request sent</p>
        <p className="text-xs text-muted-foreground">
          {formatSent(sent)} — confirm with the doctor's office that they received the {patient.clinicalsMethod === "Email" ? "email" : "fax"} below.
        </p>
      </div>
    </div>
  );
}

/** Attempt history rows (mockup .hist-row). Saved attempts from Monday
 *  are always unsuccessful ("Not confirmed") — the Yes path writes the
 *  confirmed name/date columns instead. A session-local confirmed row
 *  is appended after a Yes save. */
function HistRows({
  history,
  confirmedRow,
}: {
  history: AttemptChip[];
  confirmedRow?: { who: string; ts: string } | null;
}) {
  if (history.length === 0 && !confirmedRow) return null;
  return (
    <div className="mt-2.5">
      {history.map((h) => (
        <div
          key={h.raw}
          className="flex items-center gap-3.5 rounded-[10px] border px-4 py-3 mt-2.5 text-sm flex-wrap"
          style={{ borderColor: "var(--mm-card-border)" }}
        >
          <span className="font-extrabold shrink-0 text-[color:var(--mm-teal)]">Attempt {h.attempt}</span>
          <span className="text-muted-foreground shrink-0">{h.date}</span>
          <span className="font-semibold">{h.note}</span>
          <span className="ml-auto font-bold shrink-0" style={{ color: "var(--mm-rose)" }}>
            Not confirmed
          </span>
        </div>
      ))}
      {confirmedRow && (
        <div
          className="flex items-center gap-3.5 rounded-[10px] border px-4 py-3 mt-2.5 text-sm flex-wrap"
          style={{ borderColor: "var(--mm-card-border)" }}
        >
          <span className="font-extrabold shrink-0 text-[color:var(--mm-teal)]">Confirmed</span>
          <span className="text-muted-foreground shrink-0">{confirmedRow.ts}</span>
          <span className="font-semibold">{confirmedRow.who || "—"}</span>
          <span className="ml-auto font-bold shrink-0" style={{ color: "var(--mm-green)" }}>
            Confirmed
          </span>
        </div>
      )}
    </div>
  );
}

/** Segmented Yes/No button (mockup .seg). Click again to deselect. */
function SegBtn({
  tone,
  selected,
  onClick,
  children,
}: {
  tone: "g" | "r";
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const color = tone === "g" ? "var(--mm-green)" : "var(--mm-rose)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-[0.95rem] font-semibold border-2 transition-all"
      style={
        selected
          ? { borderColor: "transparent", background: color, color: "#fff", boxShadow: "0 1px 2px 0 rgb(0 0 0 / .05)" }
          : { borderColor: "var(--mm-card-border)", background: "var(--background)", color: "var(--muted-foreground)" }
      }
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.color = color;
          e.currentTarget.style.borderColor = color;
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.color = "var(--muted-foreground)";
          e.currentTarget.style.borderColor = "var(--mm-card-border)";
        }
      }}
    >
      {children}
    </button>
  );
}

function FilesLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-medium uppercase tracking-wide text-muted-foreground mt-[18px] mb-2 ${className ?? ""}`}>
      {children}
    </p>
  );
}

function NotApplicable({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground px-0.5 py-1">{children}</p>;
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

// =====================================================================
// Helpers (unchanged)
// =====================================================================

interface AttemptChip {
  attempt: number;
  date: string;
  outcome: "confirmed" | "not_confirmed";
  note: string;
  raw: string;
}

/** Per-attempt text column format:
 *    "6/12/26, 2:33 PM · Not confirmed · Donna, front desk — left VM"
 *  Older rows used "Name — date"; we still parse those so legacy history
 *  keeps rendering. */
function parseAttemptValue(attempt: number, raw: string): AttemptChip {
  const parts = raw.split(" · ");
  if (parts.length >= 2) {
    const [date, outcomeRaw, ...rest] = parts;
    const outcome = /^confirmed/i.test(outcomeRaw.trim()) ? "confirmed" : "not_confirmed";
    return { attempt, date: date.trim(), outcome, note: rest.join(" · ").trim(), raw };
  }
  // Legacy "Name — date"
  const m = raw.match(/^(.+?)\s+—\s+(.+)$/);
  if (m) return { attempt, date: m[2], outcome: "not_confirmed", note: m[1], raw };
  return { attempt, date: "", outcome: "not_confirmed", note: raw, raw };
}

function formatAttemptValue(outcome: "confirmed" | "not_confirmed", note: string, date: Date): string {
  // "6/12/26, 2:33 PM · Not confirmed · {note}" — note omitted if empty.
  const datePart = formatDateTimeShort(date);
  const label = outcome === "confirmed" ? "Confirmed" : "Not confirmed";
  const n = note.trim();
  const ini = userInitials();
  const sfx = ini ? ` —${ini}` : "";
  return (n ? `${datePart} · ${label} · ${n}` : `${datePart} · ${label}`) + sfx;
}

/** MN Workflow Notes line for a manager's escalated Confirm Receipt follow-up.
 *  Once a patient escalates all three attempt columns are full, so the required
 *  "what happened" note is appended here instead of being dropped.
 *  "6/12/26, 2:33 PM · Confirm Receipt (escalated) · {note} —{ini}" */
function formatEscalatedConfirmNote(note: string, date: Date): string {
  const ini = userInitials();
  const sfx = ini ? ` —${ini}` : "";
  return `${formatDateTimeShort(date)} · Confirm Receipt (escalated) · ${note.trim()}${sfx}`;
}

/** Append a line to the running MN Workflow Notes (newest last), preserving the
 *  existing log. Monday's long_text has no server-side append, so the whole
 *  value is rewritten from the in-memory notes + the new line. */
function appendMnNote(existing: string | undefined, line: string): string {
  const prev = (existing ?? "").trimEnd();
  return prev ? `${prev}\n${line}` : line;
}

function nextMnAttempt(currentAttempt: number): "Attempt 2" | "Attempt 3" | "Escalate" {
  if (currentAttempt === 1) return "Attempt 2";
  if (currentAttempt === 2) return "Attempt 3";
  return "Escalate";
}

function addBusinessDays(date: Date, days: number): Date {
  const out = new Date(date);
  let added = 0;
  while (added < days) {
    out.setDate(out.getDate() + 1);
    const day = out.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return out;
}

function formatDateInput(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

/** "6/12/26, 2:33 PM" — expects a Date whose components are already ET (etNow). */
function formatDateTimeShort(d: Date): string {
  const h24 = d.getHours();
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 || 12;
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${formatDateShort(d)}, ${h}:${mins} ${ampm}`;
}

/** True when an ET-rendered Monday timestamp is today's ET date. The "Delivered"
 *  chip only shows for a same-day send; older sends are covered by attempt history. */
function isSentToday(iso?: string): boolean {
  if (!iso) return false;
  const cleaned = iso.replace(/\s+UTC$/, "Z").replace(" ", "T");
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return false;
  const etDate = (x: Date) =>
    x.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  return etDate(d) === etDate(new Date());
}

function formatSent(iso: string): string {
  // Monday's date+time text comes back as "2026-04-30 20:00:00 UTC" or
  // "2026-04-30 20:00:00" — normalize and render in ET.
  const cleaned = iso.replace(/\s+UTC$/, "Z").replace(" ", "T");
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " ET";
}

/** Format raw phone digits for the Call box (same as profile card). */
function formatPhoneDisplay(raw?: string): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)})-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

/** Save-area hint. */
function saveHint({
  confirmed,
  hasNote,
  faxResent,
  attemptNumber,
}: {
  confirmed: "yes" | "no" | null;
  hasNote: boolean;
  faxResent: boolean;
  attemptNumber: number;
}): string {
  if (!confirmed) return "Pick Confirmed or Not Confirmed to enable save.";
  if (confirmed === "no" && !hasNote) return "Add a note explaining what happened to enable save.";
  if (confirmed === "yes") return "Saves the confirmation, advances to Chase Clinicals.";
  if (confirmed === "no" && attemptNumber === 3) return "Logs Attempt 3 as unsuccessful and flags Escalation Required.";
  if (confirmed === "no" && !faxResent) return "Tip: re-send the fax before saving so the office gets it again.";
  return "";
}

/** Open a Monday file URL directly in a new tab (Confirm Receipt's
 *  existing behavior — unlike Send Request's Google viewer). */
