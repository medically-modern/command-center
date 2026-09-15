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
import { WelcomeCallForm } from "@/components/welcomeCall/WelcomeCallForm";
/* ⚠️ Review & Send is COMMENTED OUT, not deleted (Brandon's note, actioned by
   Josh 2026-09-11). Restoring it is uncommenting this import and the mount
   below — nothing else. `components/welcomeCall/ReviewPanel.tsx` stays in the
   tree and still compiles, and it reads through the same helpers the SEND uses
   (`phoneSlotWrites`, `frequencyState`), so it cannot go stale against the
   write path while it sits here. Same treatment as the Escalations tab in
   System Management (§7). */
// import { ReviewPanel } from "@/components/welcomeCall/ReviewPanel";
import { PatientsSidebar } from "@/components/welcomeCall/PatientsSidebar";
import { SendToMondayButton } from "@/components/welcomeCall/SendToMondayButton";
import { NotesPanel } from "@/components/welcomeCall/NotesPanel";
import { ClinicalsDownloadButton } from "@/components/welcomeCall/ClinicalsDownloadButton";
import { CallAttemptsCounter } from "@/components/welcomeCall/CallAttemptsCounter";
import { FollowUpModal } from "@/components/welcomeCall/FollowUpModal";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, ClipboardCheck, ArrowLeft, Save, Clock } from "lucide-react";
import { toast } from "sonner";
import { refusePendingNote } from "@/components/shared/pendingNoteGuard";
import { sendPatientToMonday, sendWelcomeCallTextToMonday, resetWelcomeCallText, sendNotesToMonday, sendSecondaryInsuranceToMonday } from "@/lib/welcomeCall/mondayWrite";
import { BOARD_ID, COL } from "@/lib/welcomeCall/mondayApi";
/* ⚠️ `EscalateButton` + `EscalationFormModal` are GONE from this page
   (2026-09-14). They wrote Escalation index 0 + a retired Escalation Notes
   column, and nothing could ever clear the flag (§10). The Propose Stuck
   ladder replaced them — the same one Medical Evaluation and Insurance run —
   rendered by `StageActionBar`. */
import { StageActionBar } from "@/components/shared/StageActionBar";
import { managerOriginFromParams } from "@/lib/shared/managerOrigin";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import { GatewayPendingError, SAVE_CONFIRM_MS, type WriteProgressPhase } from "@/lib/shared/verifiedWrite";
import { EmptyPatientPane } from "@/components/shared/EmptyPatientPane";
import { CompletedStageBanner, useCompletedStageReview } from "@/components/shared/CompletedStageBanner";
import { validatePatientForSend } from "@/lib/welcomeCall/workflow";
import { unmetSendRequirements } from "@/lib/welcomeCall/sendGates";
import { phoneSlotGaps, phoneSlotsFor } from "@/lib/welcomeCall/phoneSlots";
import { secondaryMissing, secondaryStateFor } from "@/lib/welcomeCall/secondaryCoverage";
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
  /** Which Oversight column a manager clicked in from (`?mv=`). It resolves the
   *  action bar (lib/shared/stageActions) and — from Final Decisions — makes
   *  the sidebar list the proposed-stuck cohort that column counts. */
  const managerOrigin = managerOriginFromParams(searchParams);
  const { patients, loading, initialLoading, error, refetch, update, markAdvanced, clearOverlay , saveOverlay, hasOverlay } = useMondayPatients(searchParams.get("patientId"));
  const [followUpOpen, setFollowUpOpen] = useState(false);
  /* The Propose Stuck dialog is owned HERE because it has TWO triggers — the
     header's action bar and the End of Call button (Josh, 2026-09-14: "both
     stuck buttons have same behavior" — two triggers for one dialog, not two
     controls). `StageActionBar` renders the dialog in controlled mode. The
     reason is required inside it; this board has no stuck-reason column, so
     the stamped "[Proposed Stuck …]" line in Notes is the only record. */
  const [proposeOpen, setProposeOpen] = useState(false);
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
    () => sidebarVisibleList(patients, viewFilter, { origin: managerOrigin }),
    [patients, viewFilter, managerOrigin],
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

  /* The two verbal confirmations Brandon added (2026-09-09). ONE source feeds
     both the disabled button and the sentences under it, so a greyed-out
     control can never sit there with no stated reason — the shape reps report
     as "the app is broken".
     ⚠️ ADVANCE ONLY — `unmetSendRequirements` reads the decision first and
     returns [] for anything that is not Advance. That mattered when there was
     a "Don't Advance" button beside it (a rep who never reached the patient
     cannot have confirmed anything with them), and it still matters now that
     the hold is the Stuck button: Stuck writes directly and never runs this
     gate, so a patient who cannot be reached is never trapped behind a
     confirmation nobody could get. */
  const sendGaps = useMemo(
    () =>
      selected
        ? unmetSendRequirements({
            advanceDecisionIndex: selected.advanceDecisionIndex,
            serving: selected.servingEdited ?? selected.serving,
            pumpType: selected.pumpType,
            intake: selected.callIntake ?? emptyIntake(),
            /* Brandon called the secondary details "required"; only Unknown is
               carved out, and `secondaryMissing` returns [] for it already.
               ⚠️ Through `secondaryStateFor`, NOT the column: the rep's Unknown
               has no board representation, so re-reading the column here made
               this gate disagree with the control the rep had just used and
               held Advance shut on a CIN they had said nobody knew. */
            /* ⚠️ Through `phoneSlotsFor`, NOT the phone columns. The slots the
               rep is editing live on the page overlay precisely so this gate
               can see them; reading the columns here would hold Advance shut on
               a number they had already corrected — the §5.31c
               gate-with-no-passing-move, whose fix this mirrors. */
            phoneGaps: phoneSlotGaps(phoneSlotsFor(selected)),
            secondaryMissing: secondaryMissing({
              ...secondaryStateFor(selected),
              memberId2: selected.memberId2Edited ?? selected.memberId2,
              insuranceNotes: selected.insuranceNotesEdited ?? selected.insuranceNotes ?? "",
            }),
          })
        : [],
    [selected],
  );
  const validation = useMemo(
    () => selected ? validatePatientForSend(selected) : { valid: false, errors: [] },
    [selected],
  );

  const handleFieldChange = (field: keyof Patient, value: string | number | boolean | null) => {
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

  /** After a ladder write (a proposal, an approval, a return): the patient has
   *  left THIS view's list, so hide them now rather than leaving a live Send
   *  button until the poll catches up (§9's re-send window), then reconcile. The
   *  hide is a claim with an expiry, never a verdict — `lib/shared/pendingAdvance`. */
  const handleLadderDone = () => {
    if (selected) markAdvanced(selected.id);
    refetch();
  };

  /**
   * Reset = "discard my local edits and show me what Monday holds".
   *
   * ⚠️ It must NOT install blank overrides for a column the send writes
   * UNCONDITIONALLY, because the overlay is merged over the board's values on
   * every refetch and the writer cannot tell that blank from a rep deliberately
   * removing something. `clearOverlay` above already reverts every field to the
   * board — the explicit blanks below only exist to empty fields on SCREEN, and
   * for an always-written column that emptiness reaches Monday as a clear.
   *
   * So the always-written product columns are deliberately absent here:
   *   · Monitor Qty — `coerceMonitorQty("")` is "0", pushed on every send, so a
   *     Reset followed by a Send used to overwrite a real monitor sale with 0.
   *   · Infusion Set 1/2 + their quantities — always written from 2026-09-10 so
   *     that REMOVING a set actually clears the board (Brandon's ask). Blanking
   *     them here would make Reset wipe the patient's whole infusion order.
   * Both now come back from the board on reset, which is what Reset means.
   * `resetPatchIsSafe.test.ts` fails the build if one is added back.
   *
   * Pump Qty stays blanked: its write is still guarded (`pumpQtyToWrite !== ""`),
   * so the blank never reaches Monday. Make that write unconditional and it has
   * to leave this list too.
   */
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
      pumpQty: "",
      medicarePriorPumpDate: "",
      monitorPurchaseDate: "",
      sosNeverBilledMonitor: false,
      sosLastBillMonitor: "",
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
    } as Partial<Patient>);
    toast.success("Cleared local edits — refetching from Monday");
    refetch();
  };

  const handleSend = async () => {
    if (!selected) return;
    if (refusePendingNote()) return;
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

  /** Clear the Welcome Call Text trigger on the board so it can fire again
   *  (mondayWrite.resetWelcomeCallText). Local state follows the board. */
  const handleResetWelcomeCallText = async () => {
    if (!selected) return;
    try {
      await resetWelcomeCallText(selected.id);
      update(selected.id, { welcomeCallText: "", welcomeCallTextIndex: null } as Partial<Patient>);
      toast.success("Welcome Call Text reset — press Send again to re-text");
      refetch();
    } catch (e) {
      toast.error("Couldn't reset the Welcome Call Text", {
        description: e instanceof Error ? e.message : String(e),
      });
      throw e;
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
                  <h1 className="text-2xl font-bold">Welcome Call</h1>{selected && (<p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">{selected.name}{selected.escalated && <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Escalated</span>}{selected.proposedStuck && <span className="inline-flex items-center rounded-full bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Proposed Stuck</span>}</p>)}
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
                {/* Propose Stuck / Approve Stuck / Send back to pipeline — which
                    of them renders is decided per (stage × ?mv= origin) in
                    lib/shared/stageActions, exactly as on every ME and
                    Insurance page. The dialog is controlled from this page so
                    the End of Call button can open the same one. */}
                {selected && (
                  <StageActionBar
                    stage="welcome-call"
                    board="welcomeCall"
                    patientId={selected.id}
                    patientName={selected.name}
                    escalationLabel={selected.escalation}
                    onDone={handleLadderDone}
                    proposeOpen={proposeOpen}
                    onProposeOpenChange={setProposeOpen}
                  />
                )}
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
                    onSaveSecondaryInsurance={(_label, index) => sendSecondaryInsuranceToMonday(selected.id, index)}
                  />
                  {/* ⚠️ The out-of-pocket estimate is deliberately NOT a row on
                      this page — Brandon, 2026-09-11, "get rid of the next 3
                      rows". It renders one level down, inside the form's
                      Authorizations section as part of
                      `InsuranceAuthSection.OopBlock` (Josh, 2026-09-15), beside
                      the confirmed-amount field. Do not re-mount
                      `OopEstimateCard` here: it would render twice. */}
                  <WelcomeCallForm patient={selected} onFieldChange={handleFieldChange} onIntakeChange={handleIntakeChange} onSendWelcomeCallText={handleSendWelcomeCallText} onResetWelcomeCallText={handleResetWelcomeCallText} onProposeStuck={() => setProposeOpen(true)} />
                  {/* Order dates moved INTO Subscription & Logistics (form
                      section 7) on 2026-09-09 — Brandon: "under the cards, in
                      this section", not at the end of the call. */}
                  <NotesPanel key={selected.id}
                    columnRef={{ boardId: BOARD_ID, columnId: COL.notes }}
                    notes={selected.notes}
                    profileSendOffNotes={selected.profileSendOffNotes}
                    mnWorkflowNotes={selected.mnWorkflowNotes}
                    insuranceNotes={selected.insuranceNotes}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                    onSaveToMonday={(v) => sendNotesToMonday(selected.id, v)}
                    notePrefix="Welcome Call"
                  />
                  {/* <ReviewPanel patient={selected} /> */}
                  <SendToMondayButton
                    onSend={handleSend}
                    disabled={!selected || !validation.valid || sendGaps.length > 0 || reviewMode}
                    validationErrors={
                      reviewMode
                        ? ["Completed stage — this is what the rep filled out, so there is nothing left to send."]
                        : [...validation.errors, ...sendGaps.map((g) => g.label)]
                    }
                  />
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
    </SidebarProvider>
  );
};

export default WelcomeCallPage;
