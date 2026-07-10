/**
 * Confirm Receipt — standalone view of masheke-checklist's "Confirm Receipt" tab.
 */
import { useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/masheke/useMondayPatients";
import { useAutoSelectPatient } from "@/hooks/useAutoSelectPatient";
import type { Patient } from "@/lib/masheke/workflow";
import { ConfirmReceiptPanel } from "@/components/masheke/ConfirmReceiptPanel";
import { PatientsSidebar } from "@/components/masheke/PatientsSidebar";
import { SendRequestHeaderCard } from "@/components/masheke/SendRequestHeaderCard";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, Stethoscope, ArrowLeft, Ban, Save, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { clearEvalState } from "@/lib/masheke/evalState";
import { useNavigate, useSearchParams } from "react-router-dom";
import { viewFilterFromParams } from "@/lib/roleView";
import { sidebarVisibleList } from "@/lib/masheke/sidebarList";
import { BlockedModal } from "@/components/masheke/BlockedModal";
import { EscalationFormModal } from "@/components/shared/EscalationFormModal";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { writeStatusIndex, writeLongText, COL } from "@/lib/masheke/mondayApi";
import { ESCALATION_INDEX } from "@/lib/masheke/mondayMapping";
import { StuckModal } from "@/components/masheke/StuckModal";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";

const ConfirmReceiptPage = () => {
  const navigate = useNavigate();
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  // Manager view (?manager=1): sidebar lists ONLY escalated patients and
  // the panel tucks "Review the Request" behind a collapsed dropdown.
  const isManager = searchParams.get("manager") === "1";
  const { patients, loading, initialLoading, error, refetch, update, clearOverlay , saveOverlay, hasOverlay } = useMondayPatients("confirmReceipt", searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );
  const [resetVersion, setResetVersion] = useState(0);
  const [blockedModalOpen, setBlockedModalOpen] = useState(false);
  const [escalationModalOpen, setEscalationModalOpen] = useState(false);
  const [stuckModalOpen, setStuckModalOpen] = useState(false);

  // Auto-select the first patient the sidebar actually shows (same list math
  // as PatientsSidebar), never from the pre-fetch localStorage cache.
  const viewFilter = viewFilterFromParams(searchParams);
  const visiblePatients = useMemo(
    () => sidebarVisibleList(patients, viewFilter),
    [patients, viewFilter],
  );
  useAutoSelectPatient(
    initialLoading, patients, visiblePatients, selectedId, setSelectedId,
    searchParams.get("patientId"),
  );

  const selected: Patient | undefined = useMemo(
    () => patients.find((p) => p.id === selectedId),
    [patients, selectedId],
  );

  const onUpdate = (patch: Partial<Patient>) => {
    if (!selected) return;
    update(selected.id, patch);
  };

  const resetForNewPatient = () => {
    if (!selected) return;
    clearEvalState(selected.id);
    clearOverlay(selected.id);
    setResetVersion((v) => v + 1);
    toast.success("Reset — pulled fresh from Monday");
    refetch();
  };

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar patients={patients} selectedId={selectedId} onSelect={setSelectedId} loading={loading} error={error} onRefresh={refetch} activeTab="confirmReceipt" managerMode={isManager} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className={`${isEscalated ? "bg-red-700" : "bg-gradient-navy"} text-navy-foreground border-b border-sidebar-border`}>
            <div className="px-3 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button onClick={() => goBack()} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <Stethoscope className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold flex items-center gap-2.5">
                    Confirm Receipt
                    {isManager && (
                      <span className="text-[11px] font-semibold uppercase tracking-wider bg-white/15 border border-white/25 rounded-full px-2.5 py-0.5">
                        Manager · Escalated
                      </span>
                    )}
                  </h1>{selected && (<p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">{selected.name}{selected.escalation === "Escalation Required" && <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Escalated</span>}</p>)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* <Button
                  onClick={() => setStuckModalOpen(true)}
                  disabled={!selected}
                  className="gap-2 bg-amber-600 hover:bg-amber-700 text-white shadow-elevate"
                >
                  <AlertTriangle className="h-4 w-4" /> Stuck
                </Button> */}
                {/* <Button
                  onClick={() => setBlockedModalOpen(true)}
                  disabled={!selected}
                  className="gap-2 bg-red-600 hover:bg-red-700 text-white shadow-elevate"
                >
                  <Ban className="h-4 w-4" /> Blocked
                </Button> */}
                <Button
                  onClick={() => {
                    if (!selected) return;
                    saveOverlay(selected.id);
                    toast.success("Progress saved — you can leave and come back");
                  }}
                  disabled={!selected || !hasOverlay(selected.id)}
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-elevate"
                >
                  <Save className="h-4 w-4" /> Save
                </Button>
                <Button onClick={resetForNewPatient} disabled={!selected} className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate">
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
                <ReportIssueButton />
              </div>
            </div>
          </header>

          <main className="flex-1 px-3 sm:px-6 py-6">
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">{loading ? "Loading patients from Monday…" : error ? error : "Select a patient from the sidebar to begin."}</p>
                </div>
              )}
              {selected && (
                <>
                  <SendRequestHeaderCard
                    patient={selected}
                    onDoctorEdit={(patch) => update(selected.id, patch)}
                    editHint="Edits are saved to Monday when you Save Attempt (or via the Save button above)."
                    fullDetails
                  />
                  <ConfirmReceiptPanel patient={selected} onUpdate={onUpdate} onOpenForm={() => setEscalationModalOpen(true)} managerMode={isManager} />
                </>
              )}
            </section>
          </main>
        </div>
      </div>

      {selected && (
        <>
          {/* <BlockedModal
            open={blockedModalOpen}
            onOpenChange={setBlockedModalOpen}
            patientId={selected.id}
            patientName={selected.name}
            onSuccess={refetch}
          /> */}
          {/* <EscalationFormModal
            open={escalationModalOpen}
            onOpenChange={setEscalationModalOpen}
            patientId={selected.id}
            patientName={selected.name}
            writeEscalationStatus={async (id) => { await writeStatusIndex(id, COL.escalation, ESCALATION_INDEX.required); }}
            writeEscalationNotes={async (id, text) => { await writeLongText(id, COL.escalationNotes, text); }}
            onSuccess={refetch}
          /> */}
          {/* <StuckModal
            open={stuckModalOpen}
            onOpenChange={setStuckModalOpen}
            patientId={selected.id}
            patientName={selected.name}
            onSuccess={refetch}
          /> */}
        </>
      )}
    </SidebarProvider>
  );
};

export default ConfirmReceiptPage;
