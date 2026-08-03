/**
 * Doctor Appointments panel — patient outreach to get a visit booked.
 *
 * Mirrors the Chase Clinicals layout (MmStep 1 = context and history, MmStep 2
 * = do the work) so a rep moving between the two isn't relearning a screen, but
 * the job is different: you're calling the PATIENT, not the doctor's office.
 *
 * Step 2 is a structured log — method, outcome, required note — rather than
 * Chase's free-text completion, because the outcome is what decides everything
 * that happens next (see lib/masheke/apptOutreach.resolveApptOutcome). Only
 * "patient booked an appointment" ends the stage; it writes the date, returns
 * the patient to whichever chase role they came from, and snoozes them to the
 * day after the visit.
 *
 * The three Appt Attempt columns ARE the counter, which is why the note is
 * mandatory — an empty column reads as an unused slot and would hand the rep
 * an unlimited retry.
 *
 * Manager mode is the SAME screen (Josh, 2026-08-03). A manager who lands here
 * from Oversight → Manager Intervention → Appointments gets the identical
 * controls; recording an appointment clears the escalation on the way out, so
 * the patient rejoins the pipeline instead of sitting in a manager queue with a
 * date nobody acts on.
 *
 * "Won't schedule / wants to cancel" is the one outcome that doesn't wait for
 * the counter: it raises a Propose Stuck (Escalation index 2) at whatever
 * attempt the rep is on, stamped into MN Workflow Notes through the SAME
 * `stampProposedStuck` helper every other stage uses — so Oversight's Final
 * Decisions drill-down reads it in the "Proposed Reason" column with no
 * special-casing. The stamp carries the stage and the attempt number, because
 * that column is shared and a bare sentence wouldn't tell a manager whether the
 * patient refused on call one or call three.
 */
import { useEffect, useMemo, useState } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarClock,
  Check,
  Loader2,
} from "lucide-react";
import { MmStep, PatientContact } from "@/components/masheke/mmKit";
import { AttemptCards } from "@/components/masheke/AttemptCards";
import { MissingChecklist } from "@/components/masheke/MissingChecklist";
import { PriorStageNotes } from "@/components/shared/PriorStageNotes";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import { hasToken } from "@/lib/masheke/mondayApi";
import { logApptAttemptVerified, returnToChaseWithAppointment } from "@/lib/masheke/mondayWrite";
import { GatewayPendingError, type WriteProgressPhase } from "@/lib/shared/verifiedWrite";
import { userInitials } from "@/lib/shared/auth";
import { etNow, etToday, formatDateShort, formatDateTimeShort } from "@/lib/masheke/etDate";
import { appendNoteLine, type AttemptChip } from "@/lib/masheke/attemptLog";
import { appendStampedLine, stampProposedStuck } from "@/lib/masheke/proposedStuck";
import { loadEvalStateForPatient, computeMnChecklist } from "@/lib/masheke/evalState";
import { shouldShowCgmBlock, shouldShowIpBlock } from "@/lib/masheke/ipPaths";
import {
  APPT_METHODS,
  APPT_OUTCOME_LABEL,
  type ApptMethod,
  type ApptOutcome,
  apptAttempts,
  apptProposedStuckReason,
  canLogAttempt,
  chaseRoleLabel,
  formatApptAttempt,
  nextApptSlot,
  resolveApptOutcome,
  snoozeUntilAfterAppointment,
  stampApptEscalated,
  stampReturnedToChase,
} from "@/lib/masheke/apptOutreach";

const SAVE_CONFIRM_MS = 120_000;

const OUTCOME_ORDER: ApptOutcome[] = [
  "booked",
  "willCall",
  "noAnswer",
  "leftMessage",
  "wontSchedule",
];

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  /** Manager view (?manager=1) — same controls, collapsed context. */
  managerMode?: boolean;
  /** Refetch after a transition that moves the patient off this stage. */
  onDone?: () => void;
}

export function DoctorAppointmentsPanel({ patient, onUpdate, managerMode = false, onDone }: Props) {
  const [method, setMethod] = useState<ApptMethod>("Phone call");
  const [outcome, setOutcome] = useState<ApptOutcome>("noAnswer");
  const [note, setNote] = useState("");
  const [apptDate, setApptDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<WriteProgressPhase>("posting");

  useEffect(() => {
    setNote("");
    setApptDate("");
    setOutcome("noAnswer");
    setMethod("Phone call");
  }, [patient.id]);

  // Same checklist Chase shows — it's what the visit has to produce, so the rep
  // can tell the patient why they're being asked to go in.
  const mnChecklist = useMemo(() => {
    const evalState = loadEvalStateForPatient(patient);
    return computeMnChecklist(
      evalState,
      shouldShowCgmBlock(patient.serving),
      shouldShowIpBlock(patient.serving),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, patient.serving, patient.medicalNecessity, patient.mnRequestConsolidated]);

  const history = useMemo<AttemptChip[]>(
    () =>
      apptAttempts(patient).map((a) => ({
        attempt: a.slot,
        date: a.date,
        note: [a.method && a.outcome ? `${a.method} — ${a.outcome}` : "", a.note]
          .filter(Boolean)
          .join(" · "),
        raw: a.raw,
      })),
    [patient.mnEvalNotes],
  );

  const slot = nextApptSlot(patient);
  const exhausted = slot === null;
  // Opened from the sidebar's "Scheduled" folder: this patient already has a
  // visit booked and is back in Chase. There is nothing to log here, so the
  // work step shows the appointment instead of the attempt form.
  const alreadyScheduled = !!patient.appointmentDate && patient.subStage !== "Doctor Appointment";
  const today = etToday();
  const returnStage = chaseRoleLabel(patient.clinicalsMethod);

  const isBooked = outcome === "booked";
  // A PAST date is allowed on purpose (Josh, 2026-08-03) — "I already went in
  // last Thursday" is a normal answer. snoozeUntilAfterAppointment then returns
  // today, so the patient goes back to Chase due now rather than snoozed to a
  // date that has been and gone.
  const hasDate = !!apptDate;
  const isBackdated = hasDate && apptDate <= today;
  const hasNote = note.trim().length > 0;
  const canSave = !saving && canLogAttempt(note, slot) && (!isBooked || hasDate);

  // What this save will do, previewed under the button so nothing is a surprise.
  const preview = useMemo(() => {
    if (slot === null) return null;
    try {
      return resolveApptOutcome({
        outcome,
        slot,
        appointmentDate: isBooked ? apptDate : undefined,
        today,
      });
    } catch {
      return null;
    }
  }, [outcome, slot, apptDate, isBooked, today]);

  async function handleSave() {
    if (!canSave || slot === null) return;
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    let effect;
    try {
      effect = resolveApptOutcome({
        outcome,
        slot,
        appointmentDate: isBooked ? apptDate : undefined,
        today,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return;
    }

    const initials = userInitials();
    const stamp = formatDateTimeShort(etNow());
    // The attempt line IS the log and the counter — it goes straight into MN
    // Workflow Notes, no per-attempt column. Built up front so the pending path
    // applies the same patch.
    let notes = appendNoteLine(
      patient.mnEvalNotes,
      formatApptAttempt({ date: stamp, method, outcome, note, initials }),
    );
    if (effect.kind === "booked") {
      notes = appendNoteLine(
        notes,
        stampReturnedToChase({
          stamp,
          appointmentDate: apptDate,
          toStage: returnStage,
          initials,
        }),
      );
    } else if (effect.kind === "escalate") {
      notes = appendNoteLine(notes, stampApptEscalated({ stamp, initials }));
    } else if (effect.kind === "proposeStuck") {
      // Must go through stampProposedStuck so the line carries the
      // "[Proposed Stuck · date · initials]" tag that Oversight's Final
      // Decisions drill-down slices for its "Proposed Reason" column.
      notes = appendStampedLine(
        notes,
        stampProposedStuck(
          apptProposedStuckReason({ slot, note }),
          formatDateShort(etNow()),
          initials,
        ),
      );
    }

    const patch: Partial<Patient> = {
      mnEvalNotes: notes,
      ...(effect.kind === "booked"
        ? {
            appointmentDate: apptDate,
            nextActionDate: effect.nextActionDate ?? undefined,
            subStage: "Chase Clinicals",
            escalation: "Done",
            escalationIndex: 1,
          }
        : effect.kind === "escalate"
          ? { escalation: "Manager Escalation Required", escalationIndex: 0 }
          : effect.kind === "proposeStuck"
            ? { escalation: "Final Escalation Required", escalationIndex: 2, proposedStuck: true }
            : { nextActionDate: effect.nextActionDate ?? undefined }),
    };

    const toastId = `appt-save-${patient.id}`;
    const onProgress = (p: WriteProgressPhase) => {
      setPhase(p);
      if (p === "accepted") toast.loading("Data in server — writing to Monday…", { id: toastId });
      else if (p === "writing" || p === "verifying") toast.loading("Writing to Monday…", { id: toastId });
    };

    setSaving(true);
    setPhase("posting");
    toast.loading("Sending to server…", { id: toastId });
    try {
      if (effect.kind === "booked") {
        await returnToChaseWithAppointment({
          itemId: patient.id,
          appointmentDate: apptDate,
          nextActionDate: effect.nextActionDate!,
          notes,
          onProgress,
          requireDone: true,
          waitForDoneMs: SAVE_CONFIRM_MS,
        });
      } else {
        await logApptAttemptVerified({
          itemId: patient.id,
          notes,
          nextActionDate: effect.nextActionDate,
          escalate: effect.kind === "escalate",
          proposeStuck: effect.kind === "proposeStuck",
          onProgress,
          requireDone: true,
          waitForDoneMs: SAVE_CONFIRM_MS,
        });
      }
      onUpdate(patch);
      setNote("");
      setApptDate("");
      toast.success(`${effect.summary} — confirmed in Monday`, { id: toastId });
      if (effect.kind !== "retry") onDone?.();
    } catch (e) {
      if (e instanceof GatewayPendingError) {
        onUpdate(patch);
        setNote("");
        setApptDate("");
        toast.warning("Data in server — Monday confirmation still pending", {
          id: toastId,
          description: e.message,
          duration: 12_000,
        });
      } else {
        toast.error("Save failed — nothing was written", {
          id: toastId,
          description: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SaveProgressOverlay open={saving} phase={phase} />

      {/* ── Step 1 — context ── */}
      <MmStep
        num={1}
        title="Review Context & Attempt History"
        collapsible={managerMode}
        defaultOpen={!managerMode}
      >
        <div className="mb-5 flex flex-wrap gap-2.5">
          <div
            className="inline-flex items-center gap-2.5 rounded-xl border px-4 py-2.5"
            style={{ borderColor: "var(--mm-card-border)" }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Came from
            </span>
            <span className="text-sm font-bold">{returnStage}</span>
          </div>
          <div
            className="inline-flex items-center gap-2.5 rounded-xl border px-4 py-2.5"
            style={{ borderColor: "var(--mm-card-border)" }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Referral Source
            </span>
            <span className="text-sm font-bold">{patient.referralSource || "—"}</span>
          </div>
        </div>

        {alreadyScheduled ? (
          <div
            className="flex items-start gap-2.5 rounded-xl border px-4 py-3 mb-5"
            style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}
          >
            <CalendarCheck2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--mm-green)" }} />
            <p className="text-sm font-bold" style={{ color: "var(--mm-teal)" }}>
              Appointment booked for {patient.appointmentDate}
            </p>
          </div>
        ) : (
          <div
            className="flex items-start gap-2.5 rounded-xl border px-4 py-3 mb-5"
            style={{ background: "var(--mm-rose-soft)", borderColor: "oklch(0.62 0.13 18 / 0.35)" }}
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--mm-rose)" }} />
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--mm-rose)" }}>
                No appointment on file
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                The provider requires a new visit before they'll send medical documentation.
              </p>
            </div>
          </div>
        )}

        <h4 className="text-[1.05rem] font-bold tracking-tight mb-2.5">
          What the visit needs to produce
        </h4>
        <MissingChecklist checklist={mnChecklist} />

        <h4 className="text-[1.05rem] font-bold tracking-tight mt-7 mb-2.5">
          Appointment Attempts — {exhausted ? "3 of 3 used" : `Attempt ${(slot ?? 3)} of 3`}
        </h4>
        <AttemptCards history={history} exhausted={exhausted} />

        <PriorStageNotes
          stages={[{ label: "Profile Send-Off Notes", text: patient.profileSendOffNotes }]}
          className="mt-6"
        />

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

      {/* ── Step 2 — do the work ── */}
      <MmStep num={2} title="Call the Patient & Get a Visit Booked">
        <div
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-l-4 p-5"
          style={{ borderColor: "var(--mm-card-border)", borderLeftColor: "var(--mm-green)" }}
        >
          <p className="text-xl font-bold tracking-tight min-w-0 truncate">{patient.name}</p>
          <div className="ml-auto shrink-0">
            <PatientContact phone={patient.phone} />
          </div>
        </div>

        {alreadyScheduled ? (
          <div
            className="mt-5 flex items-start gap-3 rounded-xl border px-4.5 py-4"
            style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}
          >
            <CalendarCheck2 className="h-5 w-5 shrink-0" style={{ color: "var(--mm-green)" }} />
            <div>
              <p className="text-base font-bold" style={{ color: "var(--mm-teal)" }}>
                Appointment booked for {patient.appointmentDate}
              </p>
              <p className="text-sm text-muted-foreground">
                {patient.name} is back in {returnStage}, hidden until the day after the visit. Nothing
                to do here — this folder is just a way back to them.
              </p>
            </div>
          </div>
        ) : exhausted ? (
          <div
            className="mt-5 flex items-center gap-3 rounded-xl border px-4.5 py-4"
            style={{ background: "var(--mm-rose-soft)", borderColor: "oklch(0.62 0.13 18 / 0.35)" }}
          >
            <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "var(--mm-rose)" }} />
            <div>
              <p className="text-base font-bold" style={{ color: "var(--mm-rose)" }}>
                All 3 attempts used
              </p>
              <p className="text-sm text-muted-foreground">
                This patient is with a manager in Oversight → Manager Intervention → Appointments.
                Recording an appointment date there returns them to {returnStage}.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>How did you reach out?</FieldLabel>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as ApptMethod)}
                  className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm focus:outline-none"
                  style={{ borderColor: "var(--mm-card-border)" }}
                >
                  {APPT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>What happened?</FieldLabel>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as ApptOutcome)}
                  className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm focus:outline-none"
                  style={{ borderColor: "var(--mm-card-border)" }}
                >
                  {OUTCOME_ORDER.map((o) => (
                    <option key={o} value={o}>
                      {APPT_OUTCOME_LABEL[o]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isBooked && (
              <div
                className="rounded-xl border px-4 py-3.5"
                style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}
              >
                <FieldLabel className="mt-0">
                  Appointment date <span style={{ color: "var(--mm-rose)" }}>*</span>
                </FieldLabel>
                <input
                  type="date"
                  value={apptDate}
                  onChange={(e) => setApptDate(e.target.value)}
                  className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm focus:outline-none"
                  style={{ borderColor: "var(--mm-card-border)" }}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Returns {patient.name} to {returnStage}
                  {!hasDate
                    ? "."
                    : isBackdated
                      ? " — that visit already happened, so they'll be due now."
                      : `, snoozed until ${snoozeUntilAfterAppointment(apptDate, today)}.`}
                </p>
              </div>
            )}

            <div>
              <FieldLabel>
                Notes <span style={{ color: "var(--mm-rose)" }}>*</span>
              </FieldLabel>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="What you said and what they said — e.g. Texted the scheduling link, no reply yet"
                className="w-full resize-y rounded-xl border bg-background px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
                style={{ borderColor: "var(--mm-card-border)" }}
              />
            </div>

            <div className="flex flex-col items-center gap-2">
              <Button
                size="lg"
                onClick={handleSave}
                disabled={!canSave}
                className="min-w-[240px] justify-center gap-2 bg-[color:var(--mm-green)] text-white shadow-sm hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : isBooked ? (
                  <>
                    <CalendarCheck2 className="h-4 w-4" /> Save Appointment
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" /> Log Attempt {slot} of 3
                  </>
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground max-w-md">
                {!hasNote
                  ? "Add a note about this attempt to enable."
                  : isBooked && !hasDate
                    ? "Enter the appointment date."
                    : (preview?.summary ?? "")}
              </p>
              {preview?.kind === "escalate" && (
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  This is the last attempt — saving escalates to a manager.
                </p>
              )}
              {preview?.kind === "proposeStuck" && (
                <p
                  className="flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: "var(--mm-rose)" }}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Proposes stuck — {patient.name} leaves the queue for a manager's Final Decision.
                  Your note is the reason they'll see.
                </p>
              )}
            </div>
          </div>
        )}
      </MmStep>
    </div>
  );
}

function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={`mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground ${className ?? "mt-0"}`}
    >
      {children}
    </p>
  );
}

/** Exported for the page header chip. */
export function appointmentStageLabel(patient: Patient): string {
  return patient.appointmentDate
    ? `Appointment ${patient.appointmentDate}`
    : "No appointment scheduled";
}

export { CalendarClock };
