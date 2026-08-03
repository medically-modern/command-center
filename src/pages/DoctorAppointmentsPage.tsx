/**
 * Doctor Appointments (/doctor-appointments) — patient outreach to get a visit
 * booked when the provider won't send clinicals until the patient is seen again.
 *
 * Sliced off the Medical Evaluation board by Sub-Stage "Doctor Appointment"
 * (SUB_STAGE_INDEX.doctorAppointment), the same way Evaluate / Send Request /
 * Confirm Receipt / Chase are — no new Monday group, no new automation. Entry
 * is exclusively the "Doctor Appointment Required" button on the two chase
 * pages; exit is an appointment date (back to chase, snoozed) or three failed
 * attempts (Manager Intervention).
 *
 * Sidebar sections differ by ROLE, not by URL: the Awaiting-reply folder shows
 * for anyone who is a manager in access.json, however they got here. Gating it
 * on `?manager=1` hid it whenever a manager clicked in from the Processor
 * Overview column, which doesn't set that param.
 */
import { useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/masheke/useMondayPatients";
import { useAutoSelectPatient } from "@/hooks/useAutoSelectPatient";
import type { Patient } from "@/lib/masheke/workflow";
import { DoctorAppointmentsPanel } from "@/components/masheke/DoctorAppointmentsPanel";
import { DoctorAppointmentsSidebar } from "@/components/masheke/DoctorAppointmentsSidebar";
import { SendRequestHeaderCard } from "@/components/masheke/SendRequestHeaderCard";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ArrowLeft, CalendarClock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { clearEvalState } from "@/lib/masheke/evalState";
import { useSearchParams } from "react-router-dom";
import { apptSidebarVisibleList } from "@/lib/masheke/sidebarList";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { EmptyPatientPane } from "@/components/shared/EmptyPatientPane";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { StageActionBar } from "@/components/shared/StageActionBar";
import { isEscalatedIndex } from "@/lib/masheke/mondayMapping";
import { useAccessContext } from "@/components/AccessProvider";

const DoctorAppointmentsPage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  // Who the SIGNED-IN USER is, not how they arrived. `?manager=1` is only set
  // by some Oversight columns — clicking a patient from Processor Overview
  // doesn't set it — so gating the Awaiting-reply folder on the URL hid it from
  // a manager depending on which chart they clicked (Josh, 2026-08-03).
  const { access } = useAccessContext();
  const isManager = access.type === "manager";
  /** Arrived from an Oversight manager column — drives the header badge only. */
  const fromManagerColumn = searchParams.get("manager") === "1";
  const deepLinkedId = searchParams.get("patientId");
  const {
    patients: allPatients,
    loading,
    initialLoading,
    error,
    refetch,
    update,
    clearOverlay,
    scheduledApptPatients,
  } = useMondayPatients("doctorAppointments", deepLinkedId);

  // A manager sees the WHOLE queue, not just the escalated slice (Josh,
  // 2026-08-03). Filtering to escalated-only left the manager view empty for
  // every pre-escalation patient — including the common case of someone on
  // attempt 3 with a follow-up tomorrow, who is exactly who a manager wants to
  // look at. The escalated ones are still marked with a badge and sort into the
  // same sections; what makes this the manager view is the Awaiting-reply
  // folder and the action bar, not a narrower list.
  const patients = allPatients;

  const [selectedId, setSelectedId] = useState<string | null>(deepLinkedId ?? null);

  // Auto-select must only ever land on a row the sidebar actually renders. A
  // processor doesn't get the Awaiting-reply folder, so snoozed patients are
  // not selectable for them.
  const visiblePatients = useMemo(
    () => apptSidebarVisibleList(patients, undefined, scheduledApptPatients, isManager),
    [patients, isManager, scheduledApptPatients],
  );
  useAutoSelectPatient(
    initialLoading,
    patients,
    visiblePatients,
    selectedId,
    setSelectedId,
    deepLinkedId,
  );

  // The Scheduled folder shows patients who have already left this stage, so
  // the selection has to be resolvable from that list too.
  const selected: Patient | undefined = useMemo(
    () =>
      patients.find((p) => p.id === selectedId) ??
      scheduledApptPatients.find((p) => p.id === selectedId),
    [patients, scheduledApptPatients, selectedId],
  );

  const onUpdate = (patch: Partial<Patient>) => {
    if (!selected) return;
    update(selected.id, patch);
  };

  const resetForNewPatient = () => {
    if (!selected) return;
    clearEvalState(selected.id);
    clearOverlay(selected.id);
    toast.success("Reset — pulled fresh from Monday");
    refetch();
  };

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <DoctorAppointmentsSidebar
          patients={patients}
          scheduledPatients={scheduledApptPatients}
          showAwaitingReply={isManager}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          error={error}
          onRefresh={refetch}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
            <div className="px-3 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button
                  onClick={() => goBack()}
                  className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <CalendarClock className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">
                    Medically Modern
                  </p>
                  <h1 className="text-2xl font-bold flex items-center gap-2.5">
                    Doctor Appointments
                    {fromManagerColumn && (
                      <span className="text-[11px] font-semibold uppercase tracking-wider bg-white/15 border border-white/25 rounded-full px-2.5 py-0.5">
                        Manager view
                      </span>
                    )}
                  </h1>
                  {selected && (
                    <p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">
                      {selected.name}
                      {isEscalatedIndex(selected.escalationIndex) && (
                        <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">
                          Escalated
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={resetForNewPatient}
                  disabled={!selected}
                  className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate"
                >
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
                {selected && (
                  <StageActionBar
                    stage="doctor-appointments"
                    board="masheke"
                    patientId={selected.id}
                    patientName={selected.name}
                    escalationLabel={selected.escalation}
                    onDone={refetch}
                  />
                )}
                <ReportIssueButton />
              </div>
            </div>
          </header>

          <main className="flex-1 px-3 sm:px-6 py-6">
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <EmptyPatientPane
                    loading={loading}
                    error={error}
                    queueEmpty={visiblePatients.length === 0}
                    hint="Nobody is waiting on a doctor appointment right now."
                  />
                </div>
              )}
              {selected && (
                <>
                  <SendRequestHeaderCard
                    patient={selected}
                    onDoctorEdit={(patch) => update(selected.id, patch)}
                    fullDetails
                  />
                  <DoctorAppointmentsPanel
                    patient={selected}
                    onUpdate={onUpdate}
                    managerMode={fromManagerColumn}
                    onDone={refetch}
                  />
                </>
              )}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default DoctorAppointmentsPage;
