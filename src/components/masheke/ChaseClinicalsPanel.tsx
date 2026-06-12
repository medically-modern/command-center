/**
 * ChaseClinicalsPanel — Chase Clinicals (June 2026 single-button redesign).
 *
 *   - "Chase Clinicals Completed" is the ONLY action. It logs the attempt
 *     ("Who answered — date, time" into the matching chaseAttempt column),
 *     bumps MN Attempts (3rd press flags Escalation Required), and moves
 *     the Next Action Date forward 3 business days (both roles).
 *   - It NEVER advances the stage. Patients leave the Medical Necessity
 *     bucket ONLY via the Evaluate view (which has a read-only Chase
 *     Clinicals folder for opening these patients).
 *   - Attempt slot (1/2/3) from Monday's MN Attempts column; "Escalate"
 *     means no more attempts (manager view can still log follow-ups —
 *     those only move the next action date).
 *   - Completing requires ≥1 note added this session (no typed-but-unadded
 *     note text), and persists doctor-field edits.
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
} from "@/lib/masheke/mondayMapping";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  Phone,
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
  /** Which chase role this panel is rendered in (labels/copy only — both
   *  roles bump the next action +3 business days). Falls back to the
   *  patient's own Clinicals Method when not provided (deep links). */
  roleMethod?: "fax" | "parachute";
}

// =====================================================================
// Main panel — single-button flow. "Chase Clinicals Completed" logs the
// attempt to the matching chaseAttempt{N} text column, bumps MN Attempts
// (3rd press flips the Escalation column), and moves the next action date
// +3 business days. Never advances the stage.
// =====================================================================

export function ChaseClinicalsPanel({ patient, onUpdate, managerMode = false, roleMethod }: Props) {
  const mondayFiles = useMondayFiles(patient.id);
  const [saving, setSaving] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const escalatedRef = useRef(false);

  const [name, setName] = useState("");
  const [nextAction, setNextAction] = useState<string>("");
  // Complete is blocked until the rep adds at least one note for this attempt,
  // and while typed-but-unadded text sits in the note box.
  const [noteAdded, setNoteAdded] = useState(false);
  const [pendingNoteText, setPendingNoteText] = useState("");

  const isParachute = patient.clinicalsMethod === "Parachute";
  const effectiveRole = roleMethod ?? (isParachute ? "parachute" : "fax");
  // Both chase roles bump the next action +3 business days on Complete
  // (was fax +1 / parachute +3 — unified June 2026).
  const nadBumpDays = 3;
  void effectiveRole; // role kept for titles/labels elsewhere

  useEffect(() => {
    setName("");
    setNextAction("");
    setNoteAdded(false);
    setPendingNoteText("");
  }, [patient.id]);

  // Default Next Action Date — +3 business days (both roles). The date input
  // is not displayed but the computed value is written to Monday on Complete.
  useEffect(() => {
    setNextAction(formatDateInput(addBusinessDays(etNow(), nadBumpDays)));
  }, [patient.id, nadBumpDays]);

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
  // name on the call. Complete needs at least one note added for this
  // attempt (with no un-added text left in the note box).
  const hasPendingNote = pendingNoteText.trim().length > 0;
  const canSave = noteAdded && !hasPendingNote && !saving && !locked;

  async function handleSave() {
    if (!canSave) return;
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setSaving(true);
    try {
      if (isEscalated) {
        // Manager follow-up on an escalated patient: all 3 attempt slots are
        // used, so just move the next action date (weekend-clamped). Notes
        // were already saved by the notes panel. Patient stays escalated.
        const safeNextAction = clampToBusinessDay(nextAction);
        await writeDate(patient.id, COL.nextActionDate, safeNextAction);
        onUpdate({ nextActionDate: safeNextAction });
        toast.success("Follow-up saved — patient remains escalated");
      } else {
        // Chase Clinicals Completed — logs the attempt (who answered +
        // date/time), bumps MN Attempts (3rd press flags Escalation
        // Required), and moves the next action date +3 business days.
        // NEVER advances the stage: patients leave Medical
        // Necessity only via the Evaluate view.
        const attempt = currentAttempt ?? 1;
        const value = formatAttemptValue(name.trim(), etNow());
        const nextSlot = nextMnAttempt(attempt);
        // Never schedule a next action on a weekend, no matter how the
        // date was produced.
        const safeNextAction = clampToBusinessDay(nextAction);
        await saveAttempt({
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
            ? `Chase completed — attempt ${attempt} logged, escalated`
            : `Chase completed — attempt ${attempt} logged`,
        );
      }
      // Persist any doctor-field edits made on the header card
      const docTasks = buildDoctorWriteTasks(patient);
      if (docTasks.length) await Promise.all(docTasks.map((t) => t.run()));
      setName("");
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
          notePrefix={managerMode ? "Chase Clinicals Escalated" : currentAttempt ? `Chase Clinicals Attempt ${currentAttempt}` : undefined}
          profileSendOffNotes={patient.profileSendOffNotes}
          onNoteAdded={() => setNoteAdded(true)}
          onPendingTextChange={setPendingNoteText}
        />
      </MmStep>

      {/* ── Step 3 — Complete the Chase (single-button flow) ── */}
      <MmStep
        num={3}
        title="Complete the Chase"
        sub={
          isEscalated
            ? undefined
            : isLastAttempt
              ? "Final attempt — completing this chase will flag the patient for escalation."
              : effectiveRole === "parachute"
                ? "Chase via the Parachute portal (or a call), add a note, then mark completed — next action moves out 3 business days."
                : "Call the doctor's office to chase the clinicals, add a note, then mark completed — next action moves out 3 business days."
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
                  Completing just moves the next action date; the patient stays escalated.
                </p>
              </div>
            )}

            {/* The old Yes/No outcome picker + "Sent message on Parachute"
                option were removed (June 2026): "Chase Clinicals Completed"
                is now the only action and never advances the stage — patients
                leave Medical Necessity only via the Evaluate view. See git
                history of this file for the previous outcome UI. */}

            <FilesLabel className="mt-0">Who answered the call?</FilesLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name and title (e.g. Donna, Records) — optional"
              className="h-[42px] bg-background"
            />

            <HistRows history={history} />

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
                  hasPendingNote,
                  noteAdded,
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
      </MmStep>
    </div>
  );
}

// =====================================================================
// Save handlers
// =====================================================================

// saveYes — REMOVED June 2026. The old "Yes — will send" path wrote the
// chase recipient and advanced Stage Advancer to Completed. Chase no longer
// advances the stage: when clinicals actually arrive they're uploaded from
// the Evaluate view (Chase Clinicals folder), and Evaluate's Send to Monday
// is the ONLY thing that moves a patient out of Medical Necessity.
//
// async function saveYes(patient: Patient, name: string) {
//   await writeText(patient.id, COL.chaseRecipientName, name);
//   await writeStatusIndex(patient.id, COL.subStage, SUB_STAGE_INDEX.completed);
//   const nextAction = formatDateInput(addBusinessDays(etNow(), 2));
//   await writeDate(patient.id, COL.nextActionDate, nextAction);
// }

async function saveAttempt({
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

/* SegBtn — unused since the June 2026 single-button redesign (old Yes/No
   outcome picker). Restore from git history if outcome buttons return.
  ** Segmented Yes/No button (mockup .seg). Click again to deselect. * /
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
*/

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
  // Date + timestamp (ET) — e.g. "Donna — 6/12/26, 2:33 PM"
  const datePart = formatDateTimeShort(date);
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

/** "6/12/26, 2:33 PM" — expects a Date whose components are already ET (etNow). */
function formatDateTimeShort(d: Date): string {
  const h24 = d.getHours();
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 || 12;
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${formatDateShort(d)}, ${h}:${mins} ${ampm}`;
}

function formatDateLong(iso: string): string {
  // Parse date-only strings (YYYY-MM-DD) as LOCAL dates. new Date("2026-06-11")
  // is UTC midnight, which rendered as the previous day ("Jun 10") in ET —
  // the receipt-confirmed off-by-one bug.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
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

/** Hint under the "Chase Clinicals Completed" button. */
function saveHint({
  hasPendingNote,
  noteAdded,
  attemptNumber,
  isEscalated,
  bumpDays,
}: {
  hasPendingNote: boolean;
  noteAdded: boolean;
  attemptNumber: number;
  isEscalated: boolean;
  bumpDays: number;
}): string {
  if (hasPendingNote) return "Press Add on your note before completing.";
  if (!noteAdded) return "Add at least one call note above to enable.";
  if (isEscalated)
    return `Moves the next action date out ${bumpDays} business day${bumpDays === 1 ? "" : "s"} — patient stays escalated.`;
  if (attemptNumber === 3) return "Logs Attempt 3 and flags Escalation Required.";
  return `Logs Attempt ${attemptNumber} and moves the next action date out ${bumpDays} business day${bumpDays === 1 ? "" : "s"}.`;
}

/** Open a Monday file URL directly in a new tab (existing behavior). */
