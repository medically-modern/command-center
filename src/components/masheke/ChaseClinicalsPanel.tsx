/**
 * ChaseClinicalsPanel — Chase Clinicals (June 2026 redesign, mirrors the new
 * Confirm Receipt layout). Two steps:
 *
 *   1. Review Context & Attempt History — referral source + the prior-stage
 *      receipt-confirmed chip, "What we're still missing" (identical to Send
 *      Request / Confirm Receipt), the chase attempts as three cards ("Still
 *      pending" instead of "Not confirmed"), and other activity (Send Request
 *      + Confirm Receipt).
 *   2. Call & Complete the Chase — doctor name + a call button, call notes, and
 *      the single "Chase Clinicals Completed" action.
 *
 * Logic is unchanged from the prior single-button chase:
 *   - "Chase Clinicals Completed" logs the attempt ("Who answered — date,
 *     time" into the matching chaseAttempt column), bumps MN Attempts (3rd
 *     press flags Escalation Required), and moves the Next Action Date forward
 *     (Email/Parachute +3 business days, Fax +1). It NEVER advances the stage —
 *     patients leave Medical Necessity only via the Evaluate view.
 *   - Attempt slot (1/2/3) from Monday's MN Attempts column; the displayed
 *     active attempt is derived from the logged attempts so it stays correct
 *     even if the counter lags.
 *   - Completing requires ≥1 note added this session (no typed-but-unadded
 *     note text), and persists doctor-field edits.
 *
 * Write-safety (July 2026 incident): the Next Action Date is computed AT SAVE
 * TIME (never held in component state — a stale in-flight save once cleared
 * that state after the rep switched patients, so the next save went out
 * dateless and the patient never left the due queue), a missing date aborts
 * the save instead of being silently skipped, and a full-screen
 * SaveProgressOverlay blocks ALL interaction until the transaction is
 * confirmed written in Monday (requireDone).
 */
import { useEffect, useMemo, useState, useRef } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { etNow, clampToBusinessDay } from "@/lib/masheke/etDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMondayFiles } from "@/hooks/masheke/useMondayFiles";
import { buildRequestTemplate, titleCase } from "@/lib/masheke/requestTemplate";
import { openFileViewer } from "@/components/shared/FileViewerModal";
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
import { userInitials } from "@/lib/shared/auth";
import { GatewayPendingError, type WriteProgressPhase, type WriteTask } from "@/lib/shared/verifiedWrite";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import { FILE_PROXY_URL, fetchAssetBytes } from "@/lib/shared/mondayAssets";
import { getIdToken } from "@/lib/shared/auth";
import { ESCALATION_INDEX, MN_ATTEMPTS_INDEX } from "@/lib/masheke/mondayMapping";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, FileText, Loader2, Phone, Send } from "lucide-react";
import { FileList, LoadingRow, MmStep } from "@/components/masheke/mmKit";
import { MissingChecklist } from "@/components/masheke/MissingChecklist";
import { MethodBar } from "@/components/masheke/MethodBar";
import { ActivityRow, formatActivityDate } from "@/components/masheke/PreviousActivityCard";
import { loadEvalStateForPatient, computeMnChecklist } from "@/lib/masheke/evalState";
import { shouldShowCgmBlock, shouldShowIpBlock } from "@/lib/masheke/ipPaths";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  onOpenForm?: () => void;
  /** Manager view: "Review Context" starts as a collapsed dropdown. */
  managerMode?: boolean;
  /** Which chase role this panel is rendered in (labels/copy + the optional
   *  re-send box only). The Next Action bump is keyed off the patient's
   *  Clinicals Method, not this: Email/Parachute +3 business days, Fax +1. */
  roleMethod?: "fax" | "parachute";
}

// How long a save blocks the screen waiting for Monday to confirm before we
// give up and surface "queued on the server, do not repeat".
const SAVE_CONFIRM_MS = 120_000;

// =====================================================================
// Main panel
// =====================================================================

export function ChaseClinicalsPanel({ patient, onUpdate, managerMode = false, roleMethod }: Props) {
  const [saving, setSaving] = useState(false);
  // Which milestone the in-flight save is at — drives the blocking overlay.
  const [savePhase, setSavePhase] = useState<WriteProgressPhase>("posting");
  const [escalated, setEscalated] = useState(false);
  const escalatedRef = useRef(false);

  // One free-text note per chase attempt — who you reached + what happened.
  // Saved into the attempt's own column, NOT the MN workflow notes.
  const [attemptNote, setAttemptNote] = useState("");
  // Optional re-send (fax role only) — session-only chip after a send.
  const [resending, setResending] = useState(false);
  const [resentNow, setResentNow] = useState(false);
  // Re-send drawer (view files + message) + editable message body.
  const [showResendDrawer, setShowResendDrawer] = useState(false);
  const [messageDraft, setMessageDraft] = useState<string | null>(null);
  const mondayFiles = useMondayFiles(patient.id);

  // "What we're still missing" — same eval output Send Request / Confirm
  // Receipt use, so all three stages show an identical picture.
  const mnChecklist = useMemo(() => {
    const evalState = loadEvalStateForPatient(patient);
    return computeMnChecklist(
      evalState,
      shouldShowCgmBlock(patient.serving),
      shouldShowIpBlock(patient.serving),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, patient.serving, patient.medicalNecessity, patient.mnRequestConsolidated]);

  const isParachute = patient.clinicalsMethod === "Parachute";
  const effectiveRole = roleMethod ?? (isParachute ? "parachute" : "fax");
  // Cadence on Complete: Email/Parachute push the Next Action Date +3 business
  // days; Fax (or a blank method) pushes +1. Keyed off the patient's Clinicals
  // Method — not the page role — so a deep-linked patient keeps its own cadence.
  const nadBumpDays =
    patient.clinicalsMethod === "Parachute" || patient.clinicalsMethod === "Email" ? 3 : 1;

  useEffect(() => {
    setAttemptNote("");
    setResentNow(false);
    setShowResendDrawer(false);
    setMessageDraft(null);
  }, [patient.id]);

  const currentAttempt = useMemo(() => {
    const v = (patient.mnAttempts || "").trim();
    if (v === "Attempt 2") return 2;
    if (v === "Attempt 3") return 3;
    if (v === "Escalate") return null;
    return 1;
  }, [patient.mnAttempts]);

  const isEscalated = currentAttempt === null;
  // Managers work the escalated queue — don't lock the action UI for them.
  const locked = isEscalated && !managerMode;

  const history = useMemo<AttemptChip[]>(() => {
    const out: AttemptChip[] = [];
    if (patient.chaseAttempt1) out.push(parseAttemptValue(1, patient.chaseAttempt1));
    if (patient.chaseAttempt2) out.push(parseAttemptValue(2, patient.chaseAttempt2));
    if (patient.chaseAttempt3) out.push(parseAttemptValue(3, patient.chaseAttempt3));
    return out;
  }, [patient.chaseAttempt1, patient.chaseAttempt2, patient.chaseAttempt3]);

  // The Confirm Receipt attempt that actually confirmed receipt — surfaced at
  // the top so the chase rep sees who/what without hunting. Parsed from the
  // confirm attempt columns ("datetime · Confirmed · note").
  const confirmedAttempt = useMemo(() => {
    for (const raw of [patient.confirmAttempt1, patient.confirmAttempt2, patient.confirmAttempt3]) {
      if (!raw) continue;
      const parts = raw.split(" · ");
      if (parts.length >= 2 && /^confirmed/i.test(parts[1].trim())) {
        return { date: parts[0].trim(), note: parts.slice(2).join(" · ").trim() };
      }
    }
    return null;
  }, [patient.confirmAttempt1, patient.confirmAttempt2, patient.confirmAttempt3]);

  // Completing a chase requires a note describing the attempt. It's saved into
  // the attempt's own column (not the MN workflow notes).
  const hasNote = attemptNote.trim().length > 0;
  const canSave = hasNote && !saving && !locked;

  // Displayed active round — first un-logged slot (1..3), derived from the
  // logged attempts so it stays correct even if MN Attempts lags.
  const activeAttempt = isEscalated ? 3 : Math.min(history.length + 1, 3);
  const isLastAttempt = currentAttempt === 3;

  async function handleSave() {
    if (!canSave) return;
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    // Computed AT SAVE TIME — never trusted from component state. A stale
    // in-flight completion once blanked that state after a mid-save patient
    // switch, and the date was silently dropped from the transaction.
    const safeNextAction = clampToBusinessDay(
      formatDateInput(addBusinessDays(etNow(), nadBumpDays)),
    );
    const toastId = `chase-save-${patient.id}`;
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
    setSaving(true);
    setSavePhase("posting");
    toast.loading("Sending to server…", { id: toastId });
    try {
      if (isEscalated) {
        // Manager follow-up on an escalated patient: all 3 slots used, so just
        // move the next action date (weekend-clamped). Patient stays escalated.
        patch = { nextActionDate: safeNextAction };
        successMsg = "Follow-up saved — patient remains escalated";
        await runVerifiedSend({
          itemId: patient.id,
          label: "Chase Clinicals → escalated follow-up",
          stageColumnId: [],
          tasks: [
            { label: "Next Action Date", columnId: COL.nextActionDate, value: { date: safeNextAction }, fn: () => writeDate(patient.id, COL.nextActionDate, safeNextAction) },
          ],
          onProgress,
          requireDone: true,
          waitForDoneMs: SAVE_CONFIRM_MS,
        });
      } else {
        // Chase Clinicals Completed — logs the attempt, bumps MN Attempts
        // (3rd press flags Escalation Required), and moves the next action
        // date +3 business days. NEVER advances the stage.
        const attempt = currentAttempt ?? 1;
        const value = formatAttemptValue(attemptNote.trim(), etNow());
        const nextSlot = nextMnAttempt(attempt);
        const fieldKey =
          attempt === 1 ? "chaseAttempt1" : attempt === 2 ? "chaseAttempt2" : "chaseAttempt3";
        patch = {
          [fieldKey]: value,
          mnAttempts: nextSlot,
          nextActionDate: safeNextAction,
          escalation: nextSlot === "Escalate" ? "Escalation Required" : patient.escalation,
        };
        successMsg =
          nextSlot === "Escalate"
            ? `Chase completed — attempt ${attempt} logged, escalated`
            : `Chase completed — attempt ${attempt} logged`;
        await saveAttempt({
          patient,
          attempt,
          value,
          nextSlot,
          nextActionDateInput: safeNextAction,
          onProgress,
        });
      }
      onUpdate(patch);
      // Persist any doctor-field edits made on the header card
      const docTasks = buildDoctorWriteTasks(patient);
      if (docTasks.length) await Promise.all(docTasks.map((t) => t.run()));
      setAttemptNote("");
      if (escalatedRef.current) {
        await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required);
        setEscalated(false);
        escalatedRef.current = false;
      }
      toast.success(`${successMsg} — confirmed in Monday`, { id: toastId });
    } catch (e) {
      if (e instanceof GatewayPendingError && patch) {
        // The gateway durably queued the job; it WILL complete server-side.
        // Reflect it locally so the patient leaves the due list, but make
        // clear the Monday confirmation is still pending.
        onUpdate(patch);
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

  const showCgm =
    patient.serving === "CGM" ||
    patient.serving === "Insulin Pump + CGM" ||
    patient.serving === "Supplies + CGM";
  const showIp = patient.serving !== "CGM";

  // Files that will go out with the re-send (same columns Send Request attaches).
  const resendFiles = [
    ...(showCgm ? mondayFiles.cgmTemplate.map((f) => ({ file: f, tag: "CGM" })) : []),
    ...(showIp ? mondayFiles.ipTemplate.map((f) => ({ file: f, tag: "IP" })) : []),
    ...mondayFiles.mnRequestLetter.map((f) => ({ file: f, tag: "MN" })),
    ...mondayFiles.clinicalFiles.map((f) => ({ file: f, tag: "Clinical" })),
  ];

  // The message that goes out — the rep's edit, else the saved column value,
  // else a freshly generated template.
  const currentMessage =
    messageDraft ?? patient.requestBody ?? buildRequestTemplate(patient, mnChecklist);

  // Optional re-send (fax role only) — same writes as Send Request's Send:
  // persist the (possibly edited) recipient + message, flip the trigger column
  // so Monday re-dispatches via Supermail, and stamp Request Sent At.
  async function handleResend() {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    const idToken = getIdToken();
    if (!idToken) {
      toast.error("Sign in with your medicallymodern.com account to send.");
      return;
    }
    if (!recipient) {
      toast.error(`No doctor ${isEmail ? "email" : "fax"} on file.`);
      return;
    }
    setResending(true);
    try {
      // Send the SAME way Send Request does: POST recipient + subject + message
      // + the Monday request files to the worker /send-message (RingCentral),
      // not the dormant trigger column.
      const to = recipient.includes("@") ? recipient : `${recipient.replace(/\D/g, "")}@rcfax.com`;
      const files: File[] = [];
      for (const { file: f } of resendFiles) {
        const url = f.public_url || f.url;
        if (!url) continue;
        const bytes = await fetchAssetBytes(url, f.name);
        files.push(new File([bytes as BlobPart], f.name));
      }
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
      const sentAt = new Date();
      const sentIso = sentAt.toISOString();
      await runVerifiedSend({
        itemId: patient.id,
        label: "Chase → courtesy re-send",
        stageColumnId: [],
        tasks: [
          { label: "Request Body", columnId: COL.requestBody, value: { text: currentMessage }, fn: () => writeLongText(patient.id, COL.requestBody, currentMessage) },
          { label: "Request Sent At", columnId: COL.requestSentAt, value: { date: sentIso.slice(0, 10), time: sentIso.slice(11, 19) }, fn: () => writeDateTime(patient.id, COL.requestSentAt, sentAt) },
        ],
      });
      onUpdate({ requestBody: currentMessage, requestSentAt: sentIso });
      setResentNow(true);
      toast.success(isEmail ? "Email sent via RingCentral" : "Fax sent via RingCentral");
    } catch (e) {
      toast.error("Send failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Blocks the WHOLE screen (sidebar included) while a save is in
          flight, until Monday confirms — switching patients mid-save is what
          corrupted saves in the July 2026 dropped-date incident. */}
      <SaveProgressOverlay open={saving} phase={savePhase} />

      {/* ── Step 1 — Review Context & Attempt History ── */}
      <MmStep
        num={1}
        title="Review Context & Attempt History"
        collapsible={managerMode}
        defaultOpen={!managerMode}
      >
        {/* Referral source + the confirming attempt surfaced from Confirm Receipt */}
        <div className="mb-5 space-y-2.5">
          <div
            className="inline-flex items-center gap-2.5 rounded-xl border px-4 py-2.5"
            style={{ borderColor: "var(--mm-card-border)" }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Referral Source
            </span>
            <span className="text-sm font-bold">{patient.referralSource || "—"}</span>
          </div>
          {confirmedAttempt && (
            <div
              className="flex items-start gap-2.5 rounded-xl border px-4 py-3"
              style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--mm-green)" }} />
              <div>
                <p className="text-sm font-bold text-[color:var(--mm-teal)]">
                  Receipt confirmed{confirmedAttempt.date ? ` · ${confirmedAttempt.date}` : ""}
                </p>
                {confirmedAttempt.note && (
                  <p className="text-sm text-muted-foreground mt-0.5">{confirmedAttempt.note}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* What we're still missing — identical to Send Request / Confirm Receipt */}
        <h4 className="text-[1.05rem] font-bold tracking-tight mb-2.5">What we're still missing</h4>
        <MissingChecklist checklist={mnChecklist} />

        {/* Clinical files on hand — same section as Send Request, so the chase
            rep can see/open what's already attached on Monday before calling. */}
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

        {/* STEP A — Review what it took to confirm receipt (read-only). In its
            own tinted container so it reads as reference, not the work to do. */}
        {[patient.confirmAttempt1, patient.confirmAttempt2, patient.confirmAttempt3].some(Boolean) && (
          <div
            className="rounded-2xl border bg-muted/40 p-4 mt-6"
            style={{ borderColor: "var(--mm-card-border)" }}
          >
            <h4 className="text-[1.05rem] font-bold tracking-tight mb-3">
              Confirm Receipt — prior attempts
            </h4>
            <ConfirmReceiptAttemptsView patient={patient} />
          </div>
        )}

        {/* STEP B — The current chase rounds (logged in Step 2 below). */}
        <h4 className="text-[1.05rem] font-bold tracking-tight mt-7 mb-2.5">
          Chase Clinicals — Attempt {activeAttempt} of 3
        </h4>
        <AttemptCards history={history} isEscalated={isEscalated} />

        {/* Other activity — the earlier stages */}
        <h4 className="text-[1.05rem] font-bold tracking-tight mb-2.5 mt-6">Other activity</h4>
        <OtherActivity patient={patient} />

        {/* MN Workflow Notes — READ-ONLY here. Chase never writes to these; a
            prior round's attempt notes get folded in on re-evaluation, so the
            rep can read the running history without editing it. */}
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

      {/* ── Step 2 — Call & Complete the Chase ── */}
      <MmStep
        num={2}
        title="Call & Complete the Chase"
        sub={
          isEscalated
            ? undefined
            : isLastAttempt
              ? "Final attempt — completing this chase will flag the patient for escalation."
              : undefined
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

        {/* Complete */}
        <div className="mt-5">
          {locked ? (
            <div
              className="flex items-center gap-3 rounded-xl border px-4.5 py-4"
              style={{ background: "var(--mm-rose-soft)", borderColor: "oklch(0.62 0.13 18 / 0.35)" }}
            >
              <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "var(--mm-rose)" }} />
              <div>
                <p className="text-base font-bold" style={{ color: "var(--mm-rose)" }}>
                  Escalated
                </p>
                <p className="text-sm text-muted-foreground">
                  All 3 chase attempts came back unsuccessful. Notes are still editable above.
                </p>
              </div>
            </div>
          ) : (
            <>
              {isEscalated && managerMode && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 mb-1">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-xs text-amber-800">
                    <span className="font-bold">Manager override</span> — all 3 attempts used.
                    Completing just moves the next action date; the patient stays escalated.
                  </p>
                </div>
              )}

              <FilesLabel className="mt-0">
                What happened on this attempt?{" "}
                <span className="font-bold" style={{ color: "var(--mm-rose)" }}>*</span>
              </FilesLabel>
              <textarea
                value={attemptNote}
                onChange={(e) => setAttemptNote(e.target.value)}
                rows={3}
                placeholder="Who you reached and what they said — e.g. Spoke with Maria in records; chart notes being pulled, will fax by Thursday"
                className="w-full rounded-xl border px-4 py-3 text-sm leading-relaxed bg-background resize-y focus:outline-none placeholder:text-muted-foreground/50"
                style={{ borderColor: "var(--mm-card-border)" }}
              />

              {/* Optional re-send (fax role only) — re-fax the request while chasing */}
              {effectiveRole === "fax" && (
                <div
                  className="mt-4 rounded-xl border px-4 py-3.5"
                  style={{ borderColor: "var(--mm-card-border)" }}
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    Re-send the {isEmail ? "email" : "fax"}{" "}
                    <span className="normal-case font-normal">(optional)</span>
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
                      onClick={handleResend}
                      disabled={resending || !recipient}
                      className="gap-2 text-white shadow-sm bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
                    >
                      {resending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                        </>
                      ) : resentNow ? (
                        <>
                          <Check className="h-4 w-4" /> Re-sent
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" /> Re-send {isEmail ? "Email" : "Fax"}
                        </>
                      )}
                    </Button>
                  </div>
                  {resentNow && (
                    <p className="text-xs mt-2 font-semibold" style={{ color: "var(--mm-green)" }}>
                      {isEmail ? "Email" : "Fax"} re-sent.
                    </p>
                  )}

                  {/* Drawer — view the files + message that go out */}
                  <button
                    type="button"
                    onClick={() => setShowResendDrawer((o) => !o)}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight className={`h-4 w-4 transition-transform ${showResendDrawer ? "rotate-90" : ""}`} />
                    {showResendDrawer ? "Hide files & message" : "View files & message"}
                  </button>
                  {showResendDrawer && (
                    <div className="mt-3 flex flex-col gap-3">
                      {/* Files being sent */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Documents being sent
                        </p>
                        {mondayFiles.loading && resendFiles.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Loading…</p>
                        ) : resendFiles.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No files attached on Monday.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {resendFiles.map(({ file: f, tag }) => {
                              const url = f.public_url || f.url;
                              return (
                                <button
                                  key={f.assetId}
                                  type="button"
                                  disabled={!url}
                                  onClick={() => url && openFileViewer({ url, name: f.name })}
                                  title={f.name}
                                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40 disabled:opacity-50"
                                  style={{ borderColor: "var(--mm-card-border)" }}
                                >
                                  <FileText className="h-3.5 w-3.5 shrink-0 text-[color:var(--mm-teal)]" />
                                  <span className="max-w-[220px] truncate">{f.name}</span>
                                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{tag}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Editable message — saved on re-send */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Message
                        </p>
                        <textarea
                          value={currentMessage}
                          onChange={(e) => setMessageDraft(e.target.value)}
                          rows={9}
                          className="w-full whitespace-pre-wrap rounded-xl border px-4 py-3 text-sm leading-relaxed font-sans bg-background resize-y focus:outline-none"
                          style={{ borderColor: "var(--mm-card-border)" }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col items-center gap-2 mt-5">
                <Button
                  size="lg"
                  onClick={handleSave}
                  disabled={!canSave}
                  className="gap-2 text-white shadow-sm min-w-[240px] justify-center bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Chase Clinicals Completed
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {saveHint({
                    hasNote,
                    attemptNumber: currentAttempt ?? 1,
                    isEscalated,
                    bumpDays: nadBumpDays,
                  })}
                </p>
                {currentAttempt === 3 && (
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
// Save handler (unchanged)
// =====================================================================

async function saveAttempt({
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
  // Verified write → gateway /send. NEVER advances the stage.
  const columnId =
    attempt === 1 ? COL.chaseAttempt1 : attempt === 2 ? COL.chaseAttempt2 : COL.chaseAttempt3;
  const mnIdx =
    nextSlot === "Attempt 2"
      ? MN_ATTEMPTS_INDEX.attempt2
      : nextSlot === "Attempt 3"
        ? MN_ATTEMPTS_INDEX.attempt3
        : MN_ATTEMPTS_INDEX.escalate;
  const escalate = nextSlot === "Escalate";
  const tasks: WriteTask[] = [
    { label: `Chase Attempt ${attempt}`, columnId, value, expectedText: value, fn: () => writeText(patient.id, columnId, value) },
    { label: `MN Attempts → ${nextSlot}`, columnId: COL.mnAttempts, value: { index: mnIdx }, fn: () => writeStatusIndex(patient.id, COL.mnAttempts, mnIdx) },
  ];
  const stageColumnId: string[] = [COL.mnAttempts];
  if (escalate) {
    tasks.push({ label: "Escalation → Required", columnId: COL.escalation, value: { index: ESCALATION_INDEX.required }, fn: () => writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required) });
    stageColumnId.push(COL.escalation);
  } else {
    // A non-escalating complete MUST reschedule the patient — without this
    // date they stay "due now" forever and get re-chased (the 7/6–7/7
    // dropped-date incident). Abort loudly rather than write a partial save.
    if (!nextActionDateInput) {
      throw new Error("Next Action Date failed to compute — nothing was written. Reload and try again.");
    }
    tasks.push({ label: "Next Action Date", columnId: COL.nextActionDate, value: { date: nextActionDateInput }, fn: () => writeDate(patient.id, COL.nextActionDate, nextActionDateInput) });
  }
  await runVerifiedSend({
    itemId: patient.id,
    label: `Chase Clinicals → Attempt ${attempt} (${nextSlot})`,
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

/** Chase attempts — always three cards. Logged attempts are "Still pending"
 *  (the chase didn't return clinicals yet); the active round is "In progress"
 *  and future rounds are "Scheduled". */
function AttemptCards({ history, isEscalated }: { history: AttemptChip[]; isEscalated: boolean }) {
  const doneSlots = new Set(history.map((h) => h.attempt));
  const activeSlot = [1, 2, 3].find((n) => !doneSlots.has(n)) ?? null;
  const cards = [1, 2, 3].map((n) => {
    const h = history.find((x) => x.attempt === n);
    if (h) {
      // Show only what's actually logged on Monday — the timestamp and the
      // note (if any). No fabricated status text.
      return { n, status: "logged" as const, date: h.date || "—", desc: h.note };
    }
    if (!isEscalated && activeSlot === n) {
      return { n, status: "in_progress" as const, date: "Today", desc: "" };
    }
    return { n, status: "scheduled" as const, date: "—", desc: "" };
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
  status: "logged" | "in_progress" | "scheduled";
  date: string;
  desc: string;
}) {
  // The current round is bright white + fully opaque; every other round is
  // grayed + dimmed so it's obvious which attempt you're on.
  const cfg = {
    logged: { border: "var(--mm-card-border)", width: 1, current: false, pillColor: "var(--muted-foreground)", label: "Logged" },
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

/** Non-chase activity (Send Request) as compact rows. Confirm Receipt attempts
 *  get their own view-only cards above, so they're not duplicated here. */
function OtherActivity({ patient }: { patient: Patient }) {
  const method = patient.clinicalsMethod ?? "Fax";
  const dest = method === "Email" ? patient.doctorEmail : method === "Fax" ? patient.doctorFax : undefined;
  const sendItems = patient.requestSentAt
    ? [`${formatActivityDate(patient.requestSentAt)} · ${method}${dest ? ` · ${dest}` : ""}`]
    : [];
  return (
    <div className="space-y-2.5">
      <ActivityRow label="Send Request" items={sendItems} />
    </div>
  );
}

/** Read-only Confirm Receipt attempts (1–3) shown on the Chase page. Parses the
 *  per-attempt column "datetime · Confirmed|Not confirmed · note". Non-clickable. */
function ConfirmReceiptAttemptsView({ patient }: { patient: Patient }) {
  const raws = [patient.confirmAttempt1, patient.confirmAttempt2, patient.confirmAttempt3];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {[1, 2, 3].map((n) => (
        <ConfirmAttemptCard key={n} n={n} raw={raws[n - 1]} />
      ))}
    </div>
  );
}

function ConfirmAttemptCard({ n, raw }: { n: number; raw?: string }) {
  if (!raw) {
    return (
      <div
        className="rounded-lg p-3 bg-background/60"
        style={{ border: "1px dashed var(--mm-card-border)", opacity: 0.7 }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Attempt {n}
        </span>
        <p className="text-sm font-bold mt-1.5 text-muted-foreground">—</p>
      </div>
    );
  }
  const parts = raw.split(" · ");
  const date = parts[0]?.trim() ?? "";
  const outcomeRaw = parts[1]?.trim() ?? "";
  const confirmed = /^confirmed/i.test(outcomeRaw);
  // If the value has no outcome segment (legacy "name — date"), treat as note.
  const hasOutcome = parts.length >= 2;
  const note = hasOutcome ? parts.slice(2).join(" · ").trim() : raw;
  const color = confirmed ? "var(--mm-green)" : "var(--mm-rose)";
  // Flat reference style (1px neutral border + a small colored outcome dot/pill)
  // so these read clearly as read-only history, distinct from the bold-bordered
  // active chase cards.
  return (
    <div
      className="rounded-lg p-3 bg-background"
      style={{ border: "1px solid var(--mm-card-border)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Attempt {n}
        </span>
        {hasOutcome && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            {confirmed ? "Confirmed" : "Not confirmed"}
          </span>
        )}
      </div>
      <p className="text-sm font-bold mt-1.5">{date || "—"}</p>
      {note && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{note}</p>}
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

function FilesLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-medium uppercase tracking-wide text-muted-foreground mt-[18px] mb-2 ${className ?? ""}`}>
      {children}
    </p>
  );
}

// =====================================================================
// Helpers
// =====================================================================

interface AttemptChip {
  attempt: number;
  date: string;
  note: string;
  raw: string;
}

/** Chase per-attempt column format: "6/12/26, 2:33 PM · {note}".
 *  Older rows used "Name — date"; parse those too so legacy history renders. */
function parseAttemptValue(attempt: number, raw: string): AttemptChip {
  const parts = raw.split(" · ");
  if (parts.length >= 2) {
    const [date, ...rest] = parts;
    return { attempt, date: date.trim(), note: rest.join(" · ").trim(), raw };
  }
  const m = raw.match(/^(.+?)\s+—\s+(.+)$/);
  if (m) return { attempt, date: m[2], note: m[1], raw };
  // Bare value (legacy attempts logged without a note) — it's the timestamp,
  // so put it on top with no note (date-on-top, note-below format).
  return { attempt, date: raw, note: "", raw };
}

function formatAttemptValue(note: string, date: Date): string {
  // "6/12/26, 2:33 PM · {note}" — note omitted if empty.
  const datePart = formatDateTimeShort(date);
  const n = note.trim();
  const ini = userInitials();
  const sfx = ini ? ` —${ini}` : "";
  return (n ? `${datePart} · ${n}` : datePart) + sfx;
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

function formatDateLong(iso: string): string {
  // Parse date-only strings (YYYY-MM-DD) as LOCAL dates to avoid an off-by-one.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Format raw phone digits for the Call button. */
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

/** Hint under the "Chase Clinicals Completed" button. */
function saveHint({
  hasNote,
  attemptNumber,
  isEscalated,
  bumpDays,
}: {
  hasNote: boolean;
  attemptNumber: number;
  isEscalated: boolean;
  bumpDays: number;
}): string {
  if (!hasNote) return "Add a note about this attempt to enable.";
  if (isEscalated)
    return `Moves the next action date out ${bumpDays} business day${bumpDays === 1 ? "" : "s"} — patient stays escalated.`;
  if (attemptNumber === 3) return "Logs Attempt 3 and flags Escalation Required.";
  return `Logs Attempt ${attemptNumber} and moves the next action date out ${bumpDays} business day${bumpDays === 1 ? "" : "s"}.`;
}
