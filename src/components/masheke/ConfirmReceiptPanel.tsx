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
 *   - Save requires an outcome AND ≥1 note added this session (no
 *     typed-but-unadded note text), and persists doctor-field edits.
 */
import { useEffect, useMemo, useState, useRef } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { NotesPanel } from "@/components/masheke/NotesPanel";
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
  writeStatusLabel,
  writeText,
} from "@/lib/masheke/mondayApi";
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
  Loader2,
  Phone,
  X,
} from "lucide-react";
import {
  AskForList,
  FileList,
  LoadingRow,
  MethodHero,
  MmStep,
  MnStatusChip,
  SentChip,
} from "@/components/masheke/mmKit";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  onOpenForm?: () => void;
  /** Manager view: "Review the Request" starts as a collapsed dropdown. */
  managerMode?: boolean;
}

// =====================================================================
// Main panel
// =====================================================================

export function ConfirmReceiptPanel({ patient, onUpdate, managerMode = false }: Props) {
  const mondayFiles = useMondayFiles(patient.id);
  const [saving, setSaving] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const escalatedRef = useRef(false);

  // Active-attempt form state — name + yes/no + (if no) next action date
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState<"yes" | "no" | null>(null);
  const [nextAction, setNextAction] = useState<string>("");
  // Save is blocked until the rep adds at least one note for this attempt,
  // and while typed-but-unadded text sits in the note box.
  const [noteAdded, setNoteAdded] = useState(false);
  const [pendingNoteText, setPendingNoteText] = useState("");
  // Session-only display state: set after a successful Yes save so the
  // step shows the confirmed banner (no Monday read — the patient leaves
  // this stage on the next refetch anyway).
  const [justConfirmed, setJustConfirmed] = useState<{ who: string; ts: string } | null>(null);
  // Re-send state (step 2) — session-only chip after a successful send.
  const [resending, setResending] = useState(false);
  const [resentNow, setResentNow] = useState(false);

  // Reset form when patient changes
  useEffect(() => {
    setName("");
    setConfirmed(null);
    setNextAction("");
    setNoteAdded(false);
    setPendingNoteText("");
    setJustConfirmed(null);
    setResentNow(false);
  }, [patient.id]);

  // Default Next Action Date based on the picked outcome:
  //   No  → next weekday (fast follow-up after a confirmed-receipt no)
  //   Yes / nothing → 2 weekdays
  // Re-applies on patient change and on every confirmed change.
  useEffect(() => {
    const days = confirmed === "no" ? 1 : 2;
    setNextAction(formatDateInput(addBusinessDays(etNow(), days)));
  }, [patient.id, confirmed]);

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

  // Name field is never required — agents sometimes don't catch a
  // name. Save needs a selected outcome AND at least one note added
  // for this attempt (with no un-added text left in the note box).
  const hasPendingNote = pendingNoteText.trim().length > 0;
  const canSave = !!confirmed && noteAdded && !hasPendingNote && !saving && !locked;

  async function handleSave() {
    if (!canSave) return;
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setSaving(true);
    try {
      if (confirmed === "yes") {
        await saveYes(patient, name.trim());
        if (isEscalated) {
          // Manager resolved the escalation by confirming receipt — clear
          // the flag so the patient doesn't stay in escalated lists.
          await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.done);
          onUpdate({ escalation: "Done" });
        }
        toast.success("Receipt confirmed — moved to Chase Clinicals");
        setJustConfirmed({
          who: name.trim(),
          ts: formatDateShort(etNow()),
        });
        onUpdate({
          receiptConfirmedName: name.trim(),
          receiptConfirmedDate: formatDateInput(etNow()),
          subStage: "Chase Clinicals",
        });
      } else if (isEscalated) {
        // Manager follow-up on an escalated patient: all 3 attempt slots are
        // used, so just set the next action date (weekend-clamped). Notes
        // were already saved by the notes panel. Patient stays escalated.
        const safeNextAction = clampToBusinessDay(nextAction);
        await writeDate(patient.id, COL.nextActionDate, safeNextAction);
        onUpdate({ nextActionDate: safeNextAction });
        toast.success("Follow-up saved — patient remains escalated");
      } else {
        const attempt = currentAttempt ?? 1;
        const value = formatAttemptValue(name.trim(), etNow());
        const nextSlot = nextMnAttempt(attempt);
        // Never schedule a next action on a weekend, no matter how the
        // date was produced.
        const safeNextAction = clampToBusinessDay(nextAction);
        await saveNo({
          patient,
          attempt,
          value,
          nextSlot,
          nextActionDateInput: safeNextAction,
        });
        // Optimistic local update so the chip + next slot show before refetch
        const fieldKey =
          attempt === 1 ? "confirmAttempt1" : attempt === 2 ? "confirmAttempt2" : "confirmAttempt3";
        onUpdate({
          [fieldKey]: value,
          mnAttempts: nextSlot,
          nextActionDate: safeNextAction,
          escalation: nextSlot === "Escalate" ? "Escalation Required" : patient.escalation,
        });
        toast.success(
          nextSlot === "Escalate"
            ? `Attempt ${attempt} saved — escalated`
            : `Attempt ${attempt} saved`,
        );
      }
      // Persist any doctor-field edits made on the method hero
      const docTasks = buildDoctorWriteTasks(patient);
      if (docTasks.length) await Promise.all(docTasks.map((t) => t.run()));
      // Write escalation if toggled
      if (escalatedRef.current) {
        await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required);
        setEscalated(false); escalatedRef.current = false;
      }
      // Reset form for next attempt (or clear if patient is leaving the tab)
      setName("");
      setConfirmed(null);
      setNextAction("");
      setNoteAdded(false);
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  const method = patient.clinicalsMethod ?? "—";
  const isEmail = method === "Email";
  const recipient = isEmail ? patient.doctorEmail : patient.doctorFax;
  const mnLetterPresent = mondayFiles.mnRequestLetter.length > 0;

  // Re-send the request — identical writes to Send Request's Send action:
  // flip the Send Request trigger column (Monday's automation re-dispatches
  // the files via Supermail) and stamp Request Sent At.
  async function handleResend() {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setResending(true);
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
      setResentNow(true);
      toast.success(
        isEmail
          ? "Request sent — email dispatched via Supermail"
          : "Request sent — fax dispatched via Supermail",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Re-send] failed", msg);
      toast.error("Send failed", { description: msg });
    } finally {
      setResending(false);
    }
  }

  const showCgm =
    patient.serving === "CGM" ||
    patient.serving === "Insulin Pump + CGM" ||
    patient.serving === "Supplies + CGM";
  const showIp = patient.serving !== "CGM";

  const isLastAttempt = currentAttempt === 3;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Method hero — who to call to confirm ── */}
      <MethodHero
        patient={patient}
        method={method}
        label="Confirm receipt with"
        where={
          isEmail
            ? patient.doctorEmail
              ? `Emailed to ${patient.doctorEmail}`
              : "(no doctor email on file)"
            : patient.doctorFax
              ? `Faxed to ${patient.doctorFax}`
              : "(no doctor fax on file)"
        }
        right={<CallBox phone={patient.doctorPhone} />}
      />

      {/* ── Attempt context hero ── */}
      <AttemptHero
        justConfirmed={!!justConfirmed}
        isEscalated={isEscalated}
        attempt={currentAttempt ?? 3}
      />

      {/* ── Step 1 — Review the Request (collapsed dropdown in manager view) ── */}
      <MmStep
        num={1}
        title="Review the Request"
        rightAccessory={<MnStatusChip established={patient.medicalNecessity === "Established"} />}
        collapsible={managerMode}
        defaultOpen={!managerMode}
      >
        <RequestSentBanner patient={patient} />

        <h4 className="text-[1.05rem] font-bold tracking-tight mb-2.5 mt-4">Ask the doctor for</h4>
        <AskForList patient={patient} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start mt-5">
          <div>
            <h4 className="text-[1.05rem] font-bold tracking-tight">Script Templates</h4>
            <FilesLabel>CGM Template</FilesLabel>
            {!showCgm ? (
              <NotApplicable>— Not Serving</NotApplicable>
            ) : mondayFiles.loading && mondayFiles.cgmTemplate.length === 0 ? (
              <LoadingRow />
            ) : mondayFiles.cgmTemplate.length === 0 ? (
              <NotApplicable>— None on Monday</NotApplicable>
            ) : (
              <FileList files={mondayFiles.cgmTemplate} />
            )}
            <FilesLabel className="mt-3.5">IP Template</FilesLabel>
            {!showIp ? (
              <NotApplicable>— Not Serving</NotApplicable>
            ) : mondayFiles.loading && mondayFiles.ipTemplate.length === 0 ? (
              <LoadingRow />
            ) : mondayFiles.ipTemplate.length === 0 ? (
              <NotApplicable>— None on Monday</NotApplicable>
            ) : (
              <FileList files={mondayFiles.ipTemplate} />
            )}
          </div>
          <div>
            <h4 className="text-[1.05rem] font-bold tracking-tight">Other Files</h4>
            <FilesLabel>MN Request Letter</FilesLabel>
            {mondayFiles.loading && mondayFiles.mnRequestLetter.length === 0 ? (
              <LoadingRow />
            ) : mondayFiles.mnRequestLetter.length === 0 ? (
              <NotApplicable>— None on Monday</NotApplicable>
            ) : (
              <FileList files={mondayFiles.mnRequestLetter} />
            )}
            <FilesLabel className="mt-3.5">From Clinicals</FilesLabel>
            {mondayFiles.loading && mondayFiles.clinicalFiles.length === 0 ? (
              <LoadingRow />
            ) : mondayFiles.clinicalFiles.length === 0 ? (
              <NotApplicable>— None on Monday</NotApplicable>
            ) : (
              <FileList files={mondayFiles.clinicalFiles} />
            )}
          </div>
        </div>
      </MmStep>

      {/* ── Step 2 — Re-send the Fax/Email — same writes as Send Request's
            Send action (trigger column + Request Sent At stamp). ── */}
      <MmStep num={2} title={isEmail ? "Re-send the Email" : "Re-send the Fax"}>
        <div
          className="flex items-center gap-4 rounded-xl border px-5 py-4 flex-wrap"
          style={{ borderColor: "var(--mm-card-border)" }}
        >
          <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
            <div className="text-[1.05rem] font-bold leading-snug">
              {recipient
                ? `Send ${isEmail ? "Email" : "Fax"} to ${recipient}`
                : `Send ${isEmail ? "Email" : "Fax"}`}
            </div>
            {resentNow && <SentChip />}
          </div>
          {!recipient && (
            <div className="text-sm text-muted-foreground w-full -mt-2">
              ({isEmail ? "no doctor email on file" : "no doctor fax on file"})
            </div>
          )}
          <Button
            onClick={handleResend}
            disabled={resending || !mnLetterPresent}
            className="gap-2 text-white shadow-sm bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
          >
            {resending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <SendIcon />
                Send {isEmail ? "Email" : "Fax"}
              </>
            )}
          </Button>
        </div>
        {!mnLetterPresent && (
          <p className="text-sm text-muted-foreground mt-2">
            MN Request Letter missing on Monday — Send is blocked. Generate it on the Send Request tab first.
          </p>
        )}
      </MmStep>

      {/* ── Step 3 — Call Notes ── */}
      <MmStep num={3} title="Call Notes">
        <NotesPanel
          variant="mm-inline"
          notes={patient.mnEvalNotes ?? ""}
          onNotesChange={(v) => onUpdate({ mnEvalNotes: v })}
          onSaveToMonday={(v) => writeLongText(patient.id, COL.mnEvalNotes, v)}
          notePrefix={currentAttempt ? `Confirm Receipt Attempt ${currentAttempt}` : undefined}
          profileSendOffNotes={patient.profileSendOffNotes}
          onNoteAdded={() => setNoteAdded(true)}
          onPendingTextChange={setPendingNoteText}
        />
      </MmStep>

      {/* ── Step 4 — Confirm Receipt? ── */}
      <MmStep
        num={4}
        title="Confirm Receipt?"
        sub={
          justConfirmed || locked
            ? undefined
            : isLastAttempt
              ? "Final attempt — if not confirmed, the patient will be flagged for escalation."
              : "Call the doctor's office to confirm receipt."
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
        {justConfirmed ? (
          <>
            <div
              className="flex items-center gap-3 rounded-xl border px-4.5 py-4"
              style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}
            >
              <CheckCircle2 className="h-[22px] w-[22px] shrink-0" style={{ color: "var(--mm-green)" }} />
              <div>
                <p className="text-base font-bold text-[color:var(--mm-teal)]">
                  Receipt confirmed{justConfirmed.who ? ` by ${justConfirmed.who}` : ""} · {justConfirmed.ts}
                </p>
                <p className="text-sm text-muted-foreground">
                  Patient advances to the next stage on Monday.
                </p>
              </div>
            </div>
            <HistRows history={history} confirmedRow={justConfirmed} />
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
            <HistRows history={history} />
          </>
        ) : (
          <>
            {isEscalated && managerMode && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 mb-1">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-800">
                  <span className="font-bold">Manager override</span> — all 3 attempts used.
                  "Yes" advances the patient and clears the escalation; "No" just sets the next action date.
                </p>
              </div>
            )}
            <FilesLabel className="mt-0">Who answered the call?</FilesLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name and title (e.g. Donna, Records)"
              className="h-[42px] bg-background"
            />

            <FilesLabel>
              Did they confirm receipt?{" "}
              <span className="font-bold" style={{ color: "var(--mm-rose)" }}>*</span>
            </FilesLabel>
            <div className="flex gap-2.5 w-full">
              <SegBtn
                tone="g"
                selected={confirmed === "yes"}
                onClick={() => setConfirmed(confirmed === "yes" ? null : "yes")}
              >
                <Check className="h-4 w-4" /> Yes — confirmed
              </SegBtn>
              <SegBtn
                tone="r"
                selected={confirmed === "no"}
                onClick={() => setConfirmed(confirmed === "no" ? null : "no")}
              >
                <X className="h-4 w-4" /> No — not yet
              </SegBtn>
            </div>

            <HistRows history={history} />

            <div className="flex flex-col items-center gap-2 mt-5">
              <Button
                size="lg"
                onClick={handleSave}
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
                  hasPendingNote,
                  noteAdded,
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
      </MmStep>
    </div>
  );
}

// =====================================================================
// Save handlers (unchanged)
// =====================================================================

async function saveYes(patient: Patient, name: string) {
  // Yes path: stamp success columns + advance stage. Also reset
  // MN Attempts back to "Attempt 1" so the Chase Clinicals tab starts
  // fresh (the column is shared across stages).
  const today = formatDateInput(etNow());
  await writeText(patient.id, COL.receiptConfirmedName, name);
  await writeDate(patient.id, COL.receiptConfirmedDate, today);
  await writeStatusIndex(patient.id, COL.mnAttempts, MN_ATTEMPTS_INDEX.attempt1);
  await writeStatusIndex(patient.id, COL.subStage, SUB_STAGE_INDEX.chase);
  // Next action date — 2 business days from now.
  const nextAction = formatDateInput(addBusinessDays(etNow(), 2));
  await writeDate(patient.id, COL.nextActionDate, nextAction);
}

async function saveNo({
  patient,
  attempt,
  value,
  nextSlot,
  nextActionDateInput,
}: {
  patient: Patient;
  attempt: number;
  value: string;
  nextSlot: "Attempt 2" | "Attempt 3" | "Escalate";
  nextActionDateInput: string;
}) {
  // 1) Write the attempt's "Name — date" string into the matching column.
  const columnId =
    attempt === 1
      ? COL.confirmAttempt1
      : attempt === 2
        ? COL.confirmAttempt2
        : COL.confirmAttempt3;
  await writeText(patient.id, columnId, value);
  // 2) Bump MN Attempts.
  const mnIdx =
    nextSlot === "Attempt 2"
      ? MN_ATTEMPTS_INDEX.attempt2
      : nextSlot === "Attempt 3"
        ? MN_ATTEMPTS_INDEX.attempt3
        : MN_ATTEMPTS_INDEX.escalate;
  await writeStatusIndex(patient.id, COL.mnAttempts, mnIdx);
  // 3) Either set escalation flag (if 3rd failure) or write next action date.
  if (nextSlot === "Escalate") {
    await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required);
  } else if (nextActionDateInput) {
    await writeDate(patient.id, COL.nextActionDate, nextActionDateInput);
  }
}

// =====================================================================
// Sub-components
// =====================================================================

/** Big attempt-context line between the hero and step 1. */
function AttemptHero({
  justConfirmed,
  isEscalated,
  attempt,
}: {
  justConfirmed: boolean;
  isEscalated: boolean;
  attempt: number;
}) {
  return (
    <div className="flex items-baseline gap-3.5 px-1 -mb-2">
      {justConfirmed ? (
        <span className="text-[2rem] font-black tracking-tight" style={{ color: "var(--mm-green)" }}>
          ✓ Receipt Confirmed
        </span>
      ) : isEscalated ? (
        <span className="text-[2rem] font-black tracking-tight" style={{ color: "var(--mm-rose)" }}>
          3 Attempts — Not Confirmed
        </span>
      ) : (
        <>
          <span className="text-[2rem] font-black tracking-tight text-[color:var(--mm-teal)]">
            Attempt {attempt}
          </span>
          <span className="text-xl font-semibold text-muted-foreground">of 3</span>
        </>
      )}
    </div>
  );
}

/** Right-side "Call" box on the method hero. */
function CallBox({ phone }: { phone?: string }) {
  return (
    <div className="text-right">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center justify-end gap-1.5">
        <Phone className="h-3.5 w-3.5" /> Call
      </p>
      <p className="text-xl font-extrabold mt-0.5 text-[color:var(--mm-teal)]">
        {formatPhoneDisplay(phone)}
      </p>
    </div>
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
          <span className="font-semibold">{h.name}</span>
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
  name: string;
  date: string;
  raw: string;
}

// Format used for the per-attempt text columns: "Donna — 5/1/26".
const VALUE_REGEX = /^(.+?)\s+—\s+(.+)$/;

function parseAttemptValue(attempt: number, raw: string): AttemptChip {
  const m = raw.match(VALUE_REGEX);
  if (!m) return { attempt, name: raw, date: "", raw };
  return { attempt, name: m[1], date: m[2], raw };
}

function formatAttemptValue(name: string, date: Date): string {
  const datePart = formatDateShort(date);
  return name ? `${name} — ${datePart}` : datePart;
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

/** Save-area hint — same strings as the previous design. */
function saveHint({
  confirmed,
  hasPendingNote,
  noteAdded,
  attemptNumber,
}: {
  confirmed: "yes" | "no" | null;
  hasPendingNote: boolean;
  noteAdded: boolean;
  attemptNumber: number;
}): string {
  let hint = "Pick Yes or No to enable save.";
  if (confirmed && hasPendingNote) hint = "Press Add on your note before saving.";
  else if (confirmed && !noteAdded) hint = "Add at least one note above to enable save.";
  else if (confirmed === "yes") hint = "Saves the confirmation, advances to Chase Clinicals.";
  else if (confirmed === "no" && attemptNumber < 3) hint = `Logs Attempt ${attemptNumber} as unsuccessful and schedules the next callback.`;
  else if (confirmed === "no" && attemptNumber === 3) hint = "Logs Attempt 3 as unsuccessful and flags Escalation Required.";
  return hint;
}

/** Open a Monday file URL directly in a new tab (Confirm Receipt's
 *  existing behavior — unlike Send Request's Google viewer). */
