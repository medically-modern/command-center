/**
 * Welcome Call — standalone view from welcome-call-checklist repo.
 */
import confetti from "canvas-confetti";
import { useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/welcomeCall/useMondayPatients";
import { emptyIntake } from "@/lib/welcomeCall/callIntake";
import type { CallIntake } from "@/lib/welcomeCall/callIntake";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { sidebarVisibleList } from "@/lib/welcomeCall/sidebarList";
import { PatientInfoCard, NextOrderDatesCard } from "@/components/welcomeCall/PatientInfoCard";
import { OopEstimateCard } from "@/components/welcomeCall/OopEstimateCard";
import { WelcomeCallForm } from "@/components/welcomeCall/WelcomeCallForm";
import { ReviewPanel } from "@/components/welcomeCall/ReviewPanel";
import { PatientsSidebar } from "@/components/welcomeCall/PatientsSidebar";
import { SendToMondayButton } from "@/components/welcomeCall/SendToMondayButton";
import { EscalateButton } from "@/components/welcomeCall/EscalateButton";
import { NotesPanel } from "@/components/welcomeCall/NotesPanel";
import { ClinicalsDownloadButton } from "@/components/welcomeCall/ClinicalsDownloadButton";
import { CallAttemptsCounter } from "@/components/welcomeCall/CallAttemptsCounter";
import { FollowUpModal } from "@/components/welcomeCall/FollowUpModal";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RotateCcw, ClipboardCheck, ArrowLeft, Save, Clock, OctagonX } from "lucide-react";
import { toast } from "sonner";
import { sendPatientToMonday, sendWelcomeCallTextToMonday, sendNotesToMonday, sendPhoneToMonday, sendSecondaryInsuranceToMonday } from "@/lib/welcomeCall/mondayWrite";
import { BOARD_ID, writeStatusIndex, writeLongText, COL } from "@/lib/welcomeCall/mondayApi";
import { EscalationFormModal } from "@/components/shared/EscalationFormModal";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import { GatewayPendingError, SAVE_CONFIRM_MS, type WriteProgressPhase } from "@/lib/shared/verifiedWrite";
import { EmptyPatientPane } from "@/components/shared/EmptyPatientPane";
import { CompletedStageBanner, useCompletedStageReview } from "@/components/shared/CompletedStageBanner";
import { validatePatientForSend } from "@/lib/welcomeCall/workflow";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { useAutoSelectPatient } from "@/hooks/useAutoSelectPatient";
import { viewFilterFromParams } from "@/lib/roleView";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";

const WelcomeCallPage = () => {
  const navigate = useNavigate();
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const isManager = searchParams.get("manager") === "1";
  const [escalationModalOpen, setEscalationModalOpen] = useState(false);
  const { patients, loading, initialLoading, error, refetch, update, markAdvanced, clearOverlay , saveOverlay, hasOverlay } = useMondayPatients(searchParams.get("patientId"));
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [stuckOpen, setStuckOpen] = useState(false);
  const [stuckSending, setStuckSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );
  // Blocks the screen while a send is in flight. It is not decoration: a
  // mid-save patient switch clobbers panel state and can drop a column from the
  // transaction (CLAUDE.md §5.2, the July 2026 dropped-date incident).
  const [saving, setSaving] = useState(false);
  const [savePhase, setSavePhase] = useState<WriteProgressPhase>("posting");

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

  /** Opened from a completion badge in System Management → Search: this item
   *  already left Welcome Call, so the page reads as history and cannot advance.
   *  Tied to the SELECTED patient, so picking a live one off the sidebar hands
   *  the page back. */
  const reviewMode = !!useCompletedStageReview(selected?.id);

  const validation = useMemo(
    () => selected ? validatePatientForSend(selected) : { valid: false, errors: [] },
    [selected],
  );

  const handleFieldChange = (field: keyof Patient, value: string | number | null) => {
    if (!selected) return;
    update(selected.id, { [field]: value } as Partial<Patient>);
  };

  /** The no-column intake payload (lib/welcomeCall/callIntake.ts). Rides the
   *  same overlay as every other edit, so it survives a poll and a reload the
   *  way a column edit does — and is serialised into Notes on send. */
  const handleIntakeChange = (next: CallIntake) => {
    if (!selected) return;
    update(selected.id, { callIntake: next });
  };

  const toggleEscalate = () => {
    if (!selected) return;
    update(selected.id, { escalated: !selected.escalated });
  };

  const resetForNewPatient = () => {
    if (!selected) return;
    clearOverlay(selected.id);
    update(selected.id, {
      callIntake: emptyIntake(),
      cgmTypeIndex: null,
      servingEdited: null,
      servingIndexEdited: null,
      primaryInsuranceEdited: null,
      primaryInsuranceIndexEdited: null,
      memberId1Edited: null,
      secondaryInsuranceEdited: null,
      secondaryInsuranceIndex: null,
      memberId2Edited: null,
      phoneEdited: null,
      monitorQty: "",
      pumpQty: "",
      medicarePriorPumpDate: "",
      monitorPurchaseDate: "",
      sosNeverBilledMonitor: false,
      sosLastBillMonitor: "",
      qtyInf1: "",
      infusionSet1: "",
      infusionSet1Index: null,
      qtyInf2: "",
      infusionSet2: "",
      infusionSet2Index: null,
      subscriptionType: "",
      subscriptionTypeIndex: null,
      welcomeCallText: "",
      welcomeCallTextIndex: null,
      orderHandling: "",
      orderHandlingIndex: null,
      advanceDecision: "",
      advanceDecisionIndex: null,
      addressEdited: null,
      addressLat: null,
      addressLng: null,
      ipNextOrderDateEdited: null,
      sensorsNextOrderDateEdited: null,
      suppliesNextOrderDateEdited: null,
      escalated: false,
    } as Partial<Patient>);
    toast.success("Cleared local edits — refetching from Monday");
    refetch();
  };

  const handleSend = async () => {
    if (!selected) return;
    setSaving(true);
    setSavePhase("posting");
    try {
      await sendPatientToMonday(selected, {
        onProgress: setSavePhase,
        requireDone: true,
        waitForDoneMs: SAVE_CONFIRM_MS,
      });
      toast.success("Sent to Monday");
      confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 } });
      clearOverlay(selected.id);
      // The send set the Stage Advancer, so the patient has left this stage —
      // take them off screen now rather than leaving a live Send button until
      // the poll AND the Monday automation that moves the item catch up.
      // Unconditional here: unlike Insurance, this send always advances.
      markAdvanced(selected.id);
      refetch();
    } catch (e) {
      if (e instanceof GatewayPendingError) {
        // Durably queued on the gateway and it WILL run — not a failure, and
        // above all not retryable: a second send writes the transaction twice.
        // No confetti, no clearOverlay and no refetch: the rep's edits stay on
        // screen so nothing looks lost while the job lands, and the board would
        // still read the OLD values if we refetched now.
        toast.warning("Queued — Monday is still writing this save", {
          description: e.message,
          duration: 15_000,
        });
        return;
      }
      toast.error("Send to Monday failed", {
        description: e instanceof Error ? e.message : String(e),
      });
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const handleSendWelcomeCallText = async () => {
    if (!selected) return;
    try {
      await sendWelcomeCallTextToMonday(selected);
      update(selected.id, {
        welcomeCallText: "Send",
        welcomeCallTextIndex: 0,
      } as Partial<Patient>);
      toast.success("Welcome Call Text queued in Monday");
      refetch();
    } catch (e) {
      toast.error("Welcome Call Text failed", {
        description: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  };

  const handleStuck = async () => {
    if (!selected) return;
    setStuckSending(true);
    try {
      await writeStatusIndex(selected.id, COL.stageAdvancer, 2);
      toast.success(`${selected.name} marked as Stuck`);
      setStuckOpen(false);
      refetch();
    } catch (e) {
      toast.error("Failed to mark as Stuck", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStuckSending(false);
    }
  };

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      <SaveProgressOverlay open={saving} phase={savePhase} />
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar
          patients={patients}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          error={error}
          onRefresh={refetch}
          managerMode={isManager}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className={`${isEscalated ? "bg-red-700" : "bg-gradient-navy"} text-navy-foreground border-b border-sidebar-border`}>
            <div className="px-3 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button onClick={() => goBack()} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <ClipboardCheck className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Welcome Call</h1>{selected && (<p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">{selected.name}{selected.escalated && <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Escalated</span>}</p>)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selected && (
                  <CallAttemptsCounter
                    itemId={selected.id}
                    callAttempts={selected.callAttempts}
                    onUpdate={(v) => update(selected.id, { callAttempts: v })}
                    onFollowUp={refetch}
                  />
                )}
                {selected && <ClinicalsDownloadButton itemId={selected.id} />}
                <Button onClick={() => setStuckOpen(true)} disabled={!selected} className="gap-2 bg-red-600 text-white hover:bg-red-700 shadow-elevate">
                  <OctagonX className="h-4 w-4" /> Stuck
                </Button>
                <Button onClick={() => setFollowUpOpen(true)} disabled={!selected} className="gap-2 bg-white/90 text-blue-700 hover:bg-white shadow-elevate">
                  <Clock className="h-4 w-4" /> Follow Up
                </Button>
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
          <StaleDataNotice
            error={error}
            scope="The patient list"
            onRetry={() => { void refetch(); }}
            className="mx-3 sm:mx-6 mt-3"
          />


          <main className="flex-1 px-3 sm:px-6 py-6 overflow-y-auto">
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              <CompletedStageBanner patientId={selected?.id} />
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <EmptyPatientPane loading={loading} error={error} queueEmpty={visiblePatients.length === 0} hint="No welcome calls are due right now." />
                </div>
              )}

              {selected && (
                <>
                  <PatientInfoCard
                    patient={selected}
                    onFieldChange={handleFieldChange}
                    onSavePhone={(phone) => sendPhoneToMonday(selected.id, phone)}
                    onSaveSecondaryInsurance={(_label, index) => sendSecondaryInsuranceToMonday(selected.id, index)}
                  />
                  <OopEstimateCard patient={selected} />
                  <WelcomeCallForm patient={selected} onFieldChange={handleFieldChange} onIntakeChange={handleIntakeChange} onSendWelcomeCallText={handleSendWelcomeCallText} />
                  <NextOrderDatesCard patient={selected} onFieldChange={handleFieldChange} />
                  <NotesPanel
                    columnRef={{ boardId: BOARD_ID, columnId: COL.notes }}
                    notes={selected.notes}
                    profileSendOffNotes={selected.profileSendOffNotes}
                    mnWorkflowNotes={selected.mnWorkflowNotes}
                    insuranceNotes={selected.insuranceNotes}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                    onSaveToMonday={(v) => sendNotesToMonday(selected.id, v)}
                    notePrefix="Welcome Call"
                  />
                  <ReviewPanel patient={selected} />
                  <EscalateButton escalated={selected.escalated} onToggle={toggleEscalate} disabled={!selected} onOpenForm={() => setEscalationModalOpen(true)} />
                  <SendToMondayButton onSend={handleSend} disabled={!selected || !validation.valid || reviewMode} validationErrors={reviewMode ? ["Completed stage — this is what the rep filled out, so there is nothing left to send."] : validation.errors} />
                </>
              )}
            </section>
          </main>
        </div>
      </div>
      {selected && (
        <FollowUpModal
          open={followUpOpen}
          onOpenChange={setFollowUpOpen}
          patientId={selected.id}
          patientName={selected.name}
          onSuccess={refetch}
        />
      )}
      <AlertDialog open={stuckOpen} onOpenChange={setStuckOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this patient as stuck?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately set Stage Advancer to <span className="font-semibold">Stuck / Don't Proceed</span> for{" "}
              {selected?.name ?? "this patient"} on Monday.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stuckSending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStuck}
              disabled={stuckSending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {stuckSending ? "Sending…" : "Yes, mark as Stuck"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    {selected && (
        <EscalationFormModal
          open={escalationModalOpen}
          onOpenChange={setEscalationModalOpen}
          patientId={selected.id}
          patientName={selected.name}
          writeEscalationStatus={async (id) => { await writeStatusIndex(id, COL.escalation, 0); }}
          writeEscalationNotes={async (id, text) => { await writeLongText(id, COL.escalationNotes, text); }}
          onSuccess={refetch}
        />
      )}
    </SidebarProvider>
  );
};

export default WelcomeCallPage;
