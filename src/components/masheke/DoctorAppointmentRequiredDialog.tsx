/**
 * "Doctor Appointment Required" — the ONLY entry point into Doctor Appointments.
 *
 * Lives on both chase pages, under the primary "Chase Clinicals Completed"
 * action. It fires when the provider's office tells us the patient must be seen
 * again before they'll send clinicals — never on a rep's own judgment, which is
 * why there is no equivalent control anywhere else in the app.
 *
 * One question, two answers (the July handoff's second "is it scheduled?" modal
 * was dropped — a rep who knows a date would always have picked the first
 * option anyway):
 *
 *   Already scheduled  → Appointment Date + a required note. The patient STAYS
 *                        in Chase, snoozed to the day after the visit.
 *   Not scheduled yet  → moves to Doctor Appointments for patient outreach.
 *
 * A note is required on BOTH paths: this is the only record of what the office
 * actually said, and it's the first thing whoever picks the patient up next
 * reads. Both writes are verified and block the screen until Monday confirms.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarClock, CalendarX2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Patient } from "@/lib/masheke/workflow";
import { COL, hasToken } from "@/lib/masheke/mondayApi";
import {
  enterDoctorAppointments,
  scheduleAppointmentFromChase,
} from "@/lib/masheke/mondayWrite";
import {
  chaseRoleLabel,
  snoozeUntilAfterAppointment,
  stampAppointmentNeeded,
  stampAppointmentScheduled,
} from "@/lib/masheke/apptOutreach";
import { appendNoteLine } from "@/lib/masheke/attemptLog";
import { etNow, etToday, formatDateTimeShort } from "@/lib/masheke/etDate";
import { userInitials } from "@/lib/shared/auth";
import { GatewayPendingError, type WriteProgressPhase } from "@/lib/shared/verifiedWrite";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import { SUB_STAGE_INDEX } from "@/lib/masheke/mondayMapping";

const SAVE_CONFIRM_MS = 120_000;

type Branch = null | "scheduled" | "unscheduled";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
  /** Applies the same patch the write made, so the sidebar/panel update
   *  without waiting for the next poll. */
  onUpdate: (patch: Partial<Patient>) => void;
  /** Called after a successful write so the page can refetch. */
  onDone?: () => void;
}

export function DoctorAppointmentRequiredDialog({
  open,
  onOpenChange,
  patient,
  onUpdate,
  onDone,
}: Props) {
  const [branch, setBranch] = useState<Branch>(null);
  const [apptDate, setApptDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<WriteProgressPhase>("posting");

  useEffect(() => {
    if (!open) {
      setBranch(null);
      setApptDate("");
      setNote("");
    }
  }, [open]);

  const fromStage = chaseRoleLabel(patient.clinicalsMethod);
  const today = etToday();
  const hasNote = note.trim().length > 0;
  // A PAST date is allowed on purpose (Josh, 2026-08-03): the office often says
  // "she was seen last Thursday, records are being pulled". There is nothing to
  // wait for then, so snoozeUntilAfterAppointment returns today and the patient
  // is due immediately back in Chase.
  const hasDate = !!apptDate;
  const isBackdated = hasDate && apptDate <= today;
  const canSaveScheduled = hasDate && hasNote && !saving;
  const canSaveUnscheduled = hasNote && !saving;

  const onProgress = (p: WriteProgressPhase) => setPhase(p);

  async function handleScheduled() {
    if (!canSaveScheduled) return;
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    const stamp = formatDateTimeShort(etNow());
    const line = stampAppointmentScheduled({
      stamp,
      appointmentDate: apptDate,
      fromStage,
      note,
      initials: userInitials(),
    });
    const nextNotes = appendNoteLine(patient.mnEvalNotes, line);
    const nextAction = snoozeUntilAfterAppointment(apptDate, today);
    const patch: Partial<Patient> = {
      appointmentDate: apptDate,
      mnEvalNotes: nextNotes,
      nextActionDate: nextAction,
    };
    const toastId = `appt-sched-${patient.id}`;
    setSaving(true);
    setPhase("posting");
    toast.loading("Sending to server…", { id: toastId });
    try {
      await scheduleAppointmentFromChase({
        itemId: patient.id,
        appointmentDate: apptDate,
        nextActionDate: nextAction,
        notes: nextNotes,
        onProgress,
        requireDone: true,
        waitForDoneMs: SAVE_CONFIRM_MS,
      });
      onUpdate(patch);
      toast.success(
        isBackdated
          ? `Appointment ${apptDate} recorded — ${patient.name} is due now`
          : `Appointment ${apptDate} saved — snoozed until ${nextAction}`,
        { id: toastId },
      );
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      if (e instanceof GatewayPendingError) {
        onUpdate(patch);
        toast.warning("Data in server — Monday confirmation still pending", {
          id: toastId,
          description: e.message,
          duration: 12_000,
        });
        onOpenChange(false);
      } else {
        toast.error("Save failed — nothing was changed", {
          id: toastId,
          description: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleUnscheduled() {
    if (!canSaveUnscheduled) return;
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    const stamp = formatDateTimeShort(etNow());
    const line = stampAppointmentNeeded({ stamp, fromStage, note, initials: userInitials() });
    const nextNotes = appendNoteLine(patient.mnEvalNotes, line);
    const patch: Partial<Patient> = {
      mnEvalNotes: nextNotes,
      subStage: "Doctor Appointment",
      nextActionDate: today,
      // Cleared on the way in — see enterDoctorAppointments.
      escalation: "Done",
      escalationIndex: 1,
    };
    const toastId = `appt-unsched-${patient.id}`;
    setSaving(true);
    setPhase("posting");
    toast.loading("Sending to server…", { id: toastId });
    try {
      await enterDoctorAppointments({
        itemId: patient.id,
        notes: nextNotes,
        onProgress,
        requireDone: true,
        waitForDoneMs: SAVE_CONFIRM_MS,
      });
      onUpdate(patch);
      toast.success("Moved to Doctor Appointments — patient outreach queue", { id: toastId });
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      if (e instanceof GatewayPendingError) {
        onUpdate(patch);
        toast.warning("Data in server — Monday confirmation still pending", {
          id: toastId,
          description: e.message,
          duration: 12_000,
        });
        onOpenChange(false);
      } else {
        toast.error("Move failed — the patient stayed in Chase", {
          id: toastId,
          description: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SaveProgressOverlay open={saving} phase={phase} />
      <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" style={{ color: "var(--mm-teal)" }} />
              Doctor appointment required
            </DialogTitle>
          </DialogHeader>

          {branch === null && (
            <div className="grid gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setBranch("scheduled")}
                className="rounded-xl border px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--mm-green)]"
                style={{ borderColor: "var(--mm-card-border)" }}
              >
                <span className="flex items-center gap-2 text-[15px] font-bold">
                  <CalendarClock className="h-4 w-4" style={{ color: "var(--mm-green)" }} />
                  Yes — appointment already scheduled
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Stays in {fromStage}, hidden until the day after the visit.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setBranch("unscheduled")}
                className="rounded-xl border px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--mm-green)]"
                style={{ borderColor: "var(--mm-card-border)" }}
              >
                <span className="flex items-center gap-2 text-[15px] font-bold">
                  <CalendarX2 className="h-4 w-4" style={{ color: "var(--mm-rose)" }} />
                  No — not scheduled yet
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Moves to Doctor Appointments so someone can call the patient and book one.
                </span>
              </button>
            </div>
          )}

          {branch === "scheduled" && (
            <div className="grid gap-3 pt-1">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Appointment date <span style={{ color: "var(--mm-rose)" }}>*</span>
                </label>
                <input
                  type="date"
                  value={apptDate}
                  onChange={(e) => setApptDate(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {hasDate && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {isBackdated
                      ? "That visit has already happened — the patient stays due now so you can chase the records."
                      : `Hidden from the queue until ${snoozeUntilAfterAppointment(apptDate, today)}.`}
                  </p>
                )}
              </div>
              <NoteField value={note} onChange={setNote} />
              <DialogActions
                onBack={() => setBranch(null)}
                disabled={!canSaveScheduled}
                saving={saving}
                onConfirm={handleScheduled}
                confirmLabel="Save appointment"
                hint={
                  !hasDate
                    ? "Pick the appointment date."
                    : !hasNote
                      ? "Add what the office told you."
                      : isBackdated
                        ? `Records the visit and leaves ${patient.name} due now.`
                        : `Snoozes ${patient.name} until the day after the visit.`
                }
              />
            </div>
          )}

          {branch === "unscheduled" && (
            <div className="grid gap-3 pt-1">
              <NoteField value={note} onChange={setNote} />
              <DialogActions
                onBack={() => setBranch(null)}
                disabled={!canSaveUnscheduled}
                saving={saving}
                onConfirm={handleUnscheduled}
                confirmLabel="Move to Doctor Appointments"
                hint={hasNote ? "" : "Add what the office told you."}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        What did the office say? <span style={{ color: "var(--mm-rose)" }}>*</span>
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="e.g. Spoke with Maria in records — Dr. Reyes hasn't seen the patient since 2024 and won't sign until she's back in"
        className="w-full resize-y rounded-xl border bg-background px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
        style={{ borderColor: "var(--mm-card-border)" }}
      />
    </div>
  );
}

function DialogActions({
  onBack,
  onConfirm,
  disabled,
  saving,
  confirmLabel,
  hint,
}: {
  onBack: () => void;
  onConfirm: () => void;
  disabled: boolean;
  saving: boolean;
  confirmLabel: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button
          onClick={onConfirm}
          disabled={disabled}
          className="gap-2 bg-[color:var(--mm-green)] text-white shadow-sm hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
          {confirmLabel}
        </Button>
      </div>
      {hint && <p className="text-right text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Sub-Stage index this dialog moves patients into — re-exported so callers
 *  don't reach into mondayMapping just to name the destination. */
export const DOCTOR_APPOINTMENT_SUB_STAGE = SUB_STAGE_INDEX.doctorAppointment;

/** Column ids the dialog writes, exported for tests/debugging. */
export const DOCTOR_APPOINTMENT_COLUMNS = {
  appointmentDate: COL.appointmentDate,
  notes: COL.mnEvalNotes,
  nextActionDate: COL.nextActionDate,
  subStage: COL.subStage,
} as const;
