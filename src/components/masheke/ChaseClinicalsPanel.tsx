/**
 * ChaseClinicalsPanel — Chase Clinicals redesign (June 2026 mockup
 * chase-clinicals-redesign.html). Visual layer only — ALL existing
 * logic is preserved:
 *   - Attempt slot (1/2/3) from Monday's MN Attempts column; "Escalate"
 *     means no more attempts.
 *   - Yes → writes the chase recipient, advances Stage Advancer to
 *     Completed, next action +2 business days.
 *   - No / Parachute message → logs "Name — date" (or "Parachute
 *     message — date") into the matching chaseAttempt column, bumps MN
 *     Attempts, 3rd failure flags Escalation Required, otherwise writes
 *     the next action date.
 *   - Parachute patients get the "Sent message on Parachute" outreach
 *     option in addition to the call flow.
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
  writeLongText,
  writeStatusIndex,
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
  Send,
  X,
} from "lucide-react";
import {
  AskForList,
  FileList,
  LoadingRow,
  MethodHero,
  MmStep,
  MnStatusChip,
} from "@/components/masheke/mmKit";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  onOpenForm?: () => void;
  /** Manager view: "Review the Request" starts as a collapsed dropdown. */
  managerMode?: boolean;
}

// =====================================================================
// Main panel — mirrors ConfirmReceiptPanel for the Chase Clinicals stage.
// On Yes, advances Stage Advancer to "Completed". On No, logs the
// attempt to the matching chaseAttempt{N} text column, bumps MN Attempts,
// and (after the 3rd No) flips the Escalation column.
// =====================================================================

export function ChaseClinicalsPanel({ patient, onUpdate, managerMode = false }: Props) {
  const mondayFiles = useMondayFiles(patient.id);
  const [saving, setSaving] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const escalatedRef = useRef(false);

  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState<"yes" | "no" | "parachute-message" | null>(null);
  const [nextAction, setNextAction] = useState<string>("");
  // Save is blocked until the rep adds at least one note for this attempt,
  // and while typed-but-unadded text sits in the note box.
  const [noteAdded, setNoteAdded] = useState(false);
  const [pendingNoteText, setPendingNoteText] = useState("");

  const isParachute = patient.clinicalsMethod === "Parachute";

  useEffect(() => {
    setName("");
    setConfirmed(null);
    setNextAction("");
    setNoteAdded(false);
    setPendingNoteText("");
  }, [patient.id]);

  // Default Next Action Date based on which option is selected:
  //   No → next weekday (fast follow-up)
  //   Yes / Parachute message / nothing → 2 weekdays
  // Re-applies on patient change and on every confirmed change. The date
  // input is no longer displayed (per the June 2026 redesign) but the
  // computed value is still written to Monday on save, unchanged.
  useEffect(() => {
    const days = confirmed === "no" ? 1 : 2;
    setNextAction(formatDateInput(addBusinessDays(etNow(), days)));
  }, [patient.id, confirmed]);

  const currentAttempt = useMemo(() => {
    const v = (patient.mnAttempts || "").trim();
    if (v === "Attempt 2") return 2;
    if (v === "Attempt 3") return 3;
    if (v === "Escalate") return null;
    return 1;
  }, [patient.mnAttempts]);

  const isEscalated = currentAttempt === null;
  // Managers work the escalated queue — don't lock the action UI for them,
  // otherwise a manager can never confirm/advance or send updates to Monday.
  const locked = isEscalated && !managerMode;

  const history = useMemo<AttemptChip[]>(() => {
    const out: AttemptChip[] = [];
    if (patient.chaseAttempt1) out.push(parseAttemptValue(1, patient.chaseAttempt1));
    if (patient.chaseAttempt2) out.push(parseAttemptValue(2, patient.chaseAttempt2));
    if (patient.chaseAttempt3) out.push(parseAttemptValue(3, patient.chaseAttempt3));
    return out;
  }, [patient.chaseAttempt1, patient.chaseAttempt2, patient.chaseAttempt3]);

  // Name field is never required — agents sometimes don't catch a
  // name on the call, and the Parachute message path has no human at
  // all. Save needs a selected outcome AND at least one note added
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
          // Manager resolved the escalation — clear the flag so the patient
          // doesn't stay in escalated lists.
          await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.done);
          onUpdate({ escalation: "Done" });
        }
        toast.success("Clinicals confirmed — moved to Completed");
        onUpdate({
          chaseRecipientName: name.trim(),
          subStage: "Completed",
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
        // For Parachute-message attempts, the column value records the
        // outreach instead of a person's name.
        const value =
          confirmed === "parachute-message"
            ? formatAttemptValue("Parachute message", etNow())
            : formatAttemptValue(name.trim(), etNow());
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
        const fieldKey =
          attempt === 1 ? "chaseAttempt1" : attempt === 2 ? "chaseAttempt2" : "chaseAttempt3";
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
      // Persist any doctor-field edits made on the header card
      const docTasks = buildDoctorWriteTasks(patient);
      if (docTasks.length) await Promise.all(docTasks.map((t) => t.run()));
      setName("");
      setConfirmed(null);
      setNextAction("");
      setNoteAdded(false);
      // Write escalation if user toggled the Escalate button
      if (escalatedRef.current) {
        await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required);
        setEscalated(false); escalatedRef.current = false;
      }
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

  const showCgm =
    patient.serving === "CGM" ||
    patient.serving === "Insulin Pump + CGM" ||
    patient.serving === "Supplies + CGM";
  const showIp = patient.serving !== "CGM";

  const isLastAttempt = currentAttempt === 3;

  // Click-again-to-deselect: tapping the already-selected option clears
  // the selection so the agent can switch paths or back out before save.
  const toggle = (v: "yes" | "no" | "parachute-message") => {
    setConfirmed(confirmed === v ? null : v);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Method hero — who to chase ── */}
      <MethodHero
        patient={patient}
        method={method}
        label="Chase clinicals with"
        where={
          method === "Fax"
            ? patient.doctorFax
              ? `Faxed to ${patient.doctorFax}`
              : "(no doctor fax on file)"
            : isEmail
              ? patient.doctorEmail
                ? `Emailed to ${patient.doctorEmail}`
                : "(no doctor email on file)"
              : undefined
        }
        right={<CallBox phone={patient.doctorPhone} />}
      />

      {/* ── Attempt context hero ── */}
      <AttemptHero
        isEscalated={isEscalated}
        attempt={currentAttempt ?? 3}
        receiptName={patient.receiptConfirmedName}
        receiptDate={patient.receiptConfirmedDate}
      />

      {/* ── Step 1 — Review the Request (collapsed dropdown in manager view) ── */}
      <MmStep
        num={1}
        title="Review the Request"
        rightAccessory={<MnStatusChip established={patient.medicalNecessity === "Established"} />}
        collapsible={managerMode}
        defaultOpen={!managerMode}
      >
        {!patient.receiptConfirmedDate && !patient.receiptConfirmedName && (
          <div
            className="flex items-center gap-3 rounded-xl border px-4 py-3 mb-4"
            style={{ background: "var(--mm-rose-soft)", borderColor: "oklch(0.62 0.13 18 / 0.35)" }}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--mm-rose)" }} />
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--mm-rose)" }}>
                No receipt-confirmed details on file
              </p>
              <p className="text-xs text-muted-foreground">
                Receipt Confirmed Name + Date are blank on Monday — re-check the prior step before calling.
              </p>
            </div>
          </div>
        )}

        <h4 className="text-[1.05rem] font-bold tracking-tight mb-2.5">Ask the doctor for</h4>
        <AskForList patient={patient} />

        {/* Fixed 2×2 grid — slots are placed by grid row, so the two columns
            always stay horizontally aligned no matter how much content each
            slot holds (matches Confirm Receipt). */}
        <div className="grid grid-cols-2 gap-x-5 mt-5 items-start">
          <h4 className="text-[1.05rem] font-bold tracking-tight">Script Templates</h4>
          <h4 className="text-[1.05rem] font-bold tracking-tight">Other Files</h4>

          {/* row 1: CGM Template | MN Request Letter */}
          <div className="min-h-[88px]">
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
          </div>
          <div className="min-h-[88px]">
            <FilesLabel>MN Request Letter</FilesLabel>
            {mondayFiles.loading && mondayFiles.mnRequestLetter.length === 0 ? (
              <LoadingRow />
            ) : mondayFiles.mnRequestLetter.length === 0 ? (
              <NotApplicable>— None on Monday</NotApplicable>
            ) : (
              <FileList files={mondayFiles.mnRequestLetter} />
            )}
          </div>

          {/* row 2: IP Template | From Clinicals */}
          <div className="min-h-[88px]">
            <FilesLabel>IP Template</FilesLabel>
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
          <div className="min-h-[88px]">
            <FilesLabel>From Clinicals</FilesLabel>
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

      {/* ── Step 2 — Call Notes ── */}
      <MmStep num={2} title="Call Notes">
        <NotesPanel
          variant="mm-inline"
          notes={patient.mnEvalNotes ?? ""}
          onNotesChange={(v) => onUpdate({ mnEvalNotes: v })}
          onSaveToMonday={(v) => writeLongText(patient.id, COL.mnEvalNotes, v)}
          notePrefix={currentAttempt ? `Chase Clinicals Attempt ${currentAttempt}` : undefined}
          profileSendOffNotes={patient.profileSendOffNotes}
          onNoteAdded={() => setNoteAdded(true)}
          onPendingTextChange={setPendingNoteText}
        />
      </MmStep>

      {/* ── Step 3 — Clinicals Sent? ── */}
      <MmStep
        num={3}
        title="Clinicals Sent?"
        sub={
          isEscalated
            ? undefined
            : isLastAttempt
              ? "Final attempt — if clinicals aren't sent, the patient will be flagged for escalation."
              : isParachute
                ? "Either send a message through the Parachute portal or call the doctor's office — pick one."
                : "Call the doctor's office to confirm the clinicals are sent."
        }
      >
        {locked ? (
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
                  All 3 chase attempts came back unsuccessful. Notes are still editable above.
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
                  "Yes" completes the patient and clears the escalation; "No" just sets the next action date.
                </p>
              </div>
            )}
            {/* Parachute mode shows BOTH options — agents either send a
                message via the portal OR call the office. The Parachute
                button is its own selectable mode (no name input); call
                mode uses the existing name + Yes/No inputs. */}
            {isParachute && (
              <>
                <FilesLabel className="mt-0">Outreach via Parachute</FilesLabel>
                <button
                  type="button"
                  onClick={() => toggle("parachute-message")}
                  className="w-full rounded-lg border-2 px-4 py-3 flex items-center gap-3 text-[0.95rem] font-semibold transition-all"
                  style={
                    confirmed === "parachute-message"
                      ? { borderColor: "transparent", background: "var(--mm-green)", color: "#fff", boxShadow: "0 1px 2px 0 rgb(0 0 0 / .05)" }
                      : { borderColor: "var(--mm-card-border)", background: "var(--background)", color: "var(--muted-foreground)" }
                  }
                >
                  <Send className="h-4 w-4" />
                  <span>Sent message on Parachute</span>
                </button>

                <div className="flex items-center gap-3 mt-4" role="separator" aria-label="or">
                  <span className="flex-1 h-px" style={{ background: "var(--mm-card-border)" }} />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    or call instead
                  </span>
                  <span className="flex-1 h-px" style={{ background: "var(--mm-card-border)" }} />
                </div>
              </>
            )}

            <FilesLabel className={isParachute ? undefined : "mt-0"}>Who answered the call?</FilesLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name and title (e.g. Donna, Records)"
              className="h-[42px] bg-background"
            />

            <FilesLabel>
              Did they say they will send the clinicals?{" "}
              <span className="font-bold" style={{ color: "var(--mm-rose)" }}>*</span>
            </FilesLabel>
            <div className="flex gap-2.5 w-full">
              <SegBtn tone="g" selected={confirmed === "yes"} onClick={() => toggle("yes")}>
                <Check className="h-4 w-4" /> Yes — will send
              </SegBtn>
              <SegBtn tone="r" selected={confirmed === "no"} onClick={() => toggle("no")}>
                <X className="h-4 w-4" /> No — still pending
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
              {currentAttempt === 3 && (confirmed === "no" || confirmed === "parachute-message") && (
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
  // Yes path: write the chase recipient (the person who said the
  // clinicals are on the way) and advance Stage Advancer to Completed.
  // No date column for chase success — the stage advance is the signal.
  await writeText(patient.id, COL.chaseRecipientName, name);
  await writeStatusIndex(patient.id, COL.subStage, SUB_STAGE_INDEX.completed);
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
  const columnId =
    attempt === 1
      ? COL.chaseAttempt1
      : attempt === 2
        ? COL.chaseAttempt2
        : COL.chaseAttempt3;
  await writeText(patient.id, columnId, value);
  const mnIdx =
    nextSlot === "Attempt 2"
      ? MN_ATTEMPTS_INDEX.attempt2
      : nextSlot === "Attempt 3"
        ? MN_ATTEMPTS_INDEX.attempt3
        : MN_ATTEMPTS_INDEX.escalate;
  await writeStatusIndex(patient.id, COL.mnAttempts, mnIdx);
  if (nextSlot === "Escalate") {
    await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required);
  } else if (nextActionDateInput) {
    await writeDate(patient.id, COL.nextActionDate, nextActionDateInput);
  }
}

// =====================================================================
// Sub-components
// =====================================================================

/** Big attempt-context line between the hero and step 1. Includes the
 *  receipt-confirmed context chip from the prior stage when on file. */
function AttemptHero({
  isEscalated,
  attempt,
  receiptName,
  receiptDate,
}: {
  isEscalated: boolean;
  attempt: number;
  receiptName?: string;
  receiptDate?: string;
}) {
  return (
    <div className="flex items-baseline gap-3.5 px-1 -mb-2 flex-wrap">
      {isEscalated ? (
        <span className="text-[2rem] font-black tracking-tight" style={{ color: "var(--mm-rose)" }}>
          3 Attempts — Clinicals Still Pending
        </span>
      ) : (
        <>
          <span className="text-[2rem] font-black tracking-tight text-[color:var(--mm-teal)]">
            Attempt {attempt}
          </span>
          <span className="text-xl font-semibold text-muted-foreground">of 3</span>
          {(receiptName || receiptDate) && (
            <span
              className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold self-center text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
              style={{ background: "oklch(0.94 0.02 175 / 0.7)" }}
            >
              <CheckCircle2 className="h-4 w-4" style={{ color: "var(--mm-green)" }} />
              {receiptName ? `${receiptName} confirmed receipt` : "Confirmed receipt"}
              {receiptDate ? ` on ${formatDateLong(receiptDate)}` : ""}
            </span>
          )}
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

/** Attempt history rows. Saved chase attempts are always unsuccessful
 *  ("Still pending") — the Yes path writes the chase recipient column
 *  and advances the stage instead of logging an attempt. */
function HistRows({ history }: { history: AttemptChip[] }) {
  if (history.length === 0) return null;
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
            Still pending
          </span>
        </div>
      ))}
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

// =====================================================================
// Helpers (unchanged)
// =====================================================================

interface AttemptChip {
  attempt: number;
  name: string;
  date: string;
  raw: string;
}

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

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  confirmed: "yes" | "no" | "parachute-message" | null;
  hasPendingNote: boolean;
  noteAdded: boolean;
  attemptNumber: number;
}): string {
  let hint = "Pick an option above to enable save.";
  if (confirmed && hasPendingNote) hint = "Press Add on your note before saving.";
  else if (confirmed && !noteAdded) hint = "Add at least one note above to enable save.";
  else if (confirmed === "yes") hint = "Saves the chase recipient and advances to Completed.";
  else if (confirmed === "no" && attemptNumber < 3)
    hint = `Logs Attempt ${attemptNumber} as unsuccessful and schedules the next callback.`;
  else if (confirmed === "no" && attemptNumber === 3)
    hint = "Logs Attempt 3 as unsuccessful and flags Escalation Required.";
  else if (confirmed === "parachute-message" && attemptNumber < 3)
    hint = `Logs the Parachute message as Attempt ${attemptNumber} and schedules the next outreach.`;
  else if (confirmed === "parachute-message" && attemptNumber === 3)
    hint = "Logs the Parachute message as Attempt 3 and flags Escalation Required.";
  return hint;
}

/** Open a Monday file URL directly in a new tab (existing behavior). */
