/**
 * Final Profile Confirmation — pre-check before Monday automations
 * advance the patient to Subscription & Order boards.
 */
import confetti from "canvas-confetti";
import { useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/finalConfirm/useMondayPatients";
import type { Patient, SplitSide } from "@/lib/finalConfirm/workflow";
import { sidebarVisibleList } from "@/lib/finalConfirm/sidebarList";
import {
  determineOriginalSide,
  getSplitOverrides,
} from "@/lib/finalConfirm/workflow";
import { runFinalChecks, type CheckFinding } from "@/lib/finalConfirm/checkPack";
import { PatientInfoCard } from "@/components/finalConfirm/PatientInfoCard";
import { NotesPanel } from "@/components/finalConfirm/NotesPanel";
import { PatientsSidebar } from "@/components/finalConfirm/PatientsSidebar";
import { FinalCheckPanel } from "@/components/finalConfirm/FinalCheckPanel";
import { SendWithChecksButton } from "@/components/finalConfirm/SendWithChecksButton";
import { SplitOrderButton } from "@/components/finalConfirm/SplitOrderButton";
import { EscalateButton } from "@/components/finalConfirm/EscalateButton";
import { ClinicalsDownloadButton } from "@/components/finalConfirm/ClinicalsDownloadButton";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, ShieldCheck, ArrowLeft, AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/finalConfirm/mondayWrite";
import { duplicateItem, writeStatusIndex, writeDate, writeLongText, BOARD_ID, COL } from "@/lib/finalConfirm/mondayApi";
import { useStatusOptions } from "@/hooks/useStatusOptions";
import { indexForLabel } from "@/lib/shared/statusOptions";
import { EscalationFormModal } from "@/components/shared/EscalationFormModal";
import { appendNoteEntry, stampNoteEntry } from "@/lib/shared/noteStamp";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import { GatewayPendingError, SAVE_CONFIRM_MS, type WriteProgressPhase } from "@/lib/shared/verifiedWrite";
import { EmptyPatientPane } from "@/components/shared/EmptyPatientPane";

// Stage Advancer label index 0 = "Review Profile" — the stage that lands an
// item in the Final Profile Confirmation group on Monday.
const STAGE_ADVANCER_REVIEW_PROFILE = 0;
// Split column label index 1 = "Split" (per the Monday board column the user set up).
const SPLIT_FLAG_INDEX = 1;
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { useAutoSelectPatient } from "@/hooks/useAutoSelectPatient";
import { viewFilterFromParams } from "@/lib/roleView";

const FinalConfirmPage = () => {
  const navigate = useNavigate();
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const isManager = searchParams.get("manager") === "1";
  const [escalationModalOpen, setEscalationModalOpen] = useState(false);
  const { patients, loading, initialLoading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay, addPatient } = useMondayPatients(searchParams.get("patientId"));
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

  // Any patient with _splitCreated has an unsubmitted local split.
  const unsubmittedSplits = useMemo(
    () => patients.filter((p) => p._splitCreated === true),
    [patients],
  );

  // Warn the user if they try to refresh or close the tab while a split is
  // still local-only. The split overlay isn't persisted; refreshing wipes it
  // and the duplicate Monday item is left without its Not-Serving overrides.
  useEffect(() => {
    if (unsubmittedSplits.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Some browsers ignore the custom message but still show a generic prompt.
      e.returnValue = "You have unsaved split changes. Submit both profiles first.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsubmittedSplits.length]);

  const selected: Patient | undefined = useMemo(
    () => patients.find((p) => p.id === selectedId),
    [patients, selectedId],
  );

  // Check pack — recomputed from `selected` on every keystroke, so fixing a
  // field clears its warning immediately instead of on the next send attempt.
  // Purely advisory: nothing here can disable Send (Brandon's hard requirement
  // #1). The page's old hard gate — Subscription Type "Sensors" with infusion
  // sets still set — is now C15 at RED severity inside the pack, so the rule
  // survives at the top of the panel and in every send dialog; it just can't
  // trap a rep behind a disabled button any more.
  const findings = useMemo(
    () => (selected ? runFinalChecks(selected) : []),
    [selected],
  );

  const handleFieldChange = (field: keyof Patient, value: string | number | null) => {
    if (!selected) return;
    update(selected.id, { [field]: value } as Partial<Patient>);
  };

  const toggleEscalate = () => {
    if (!selected) return;
    update(selected.id, { escalated: !selected.escalated });
  };

  const resetForNewPatient = () => {
    if (!selected) return;
    clearOverlay(selected.id);
    update(selected.id, {
      phoneEdited: null,
      emailEdited: null,
      addressEdited: null,
      addressLat: null,
      addressLng: null,
      clinicAddressEdited: null,
      clinicAddressLat: null,
      clinicAddressLng: null,
      genderIndex: null,
      secondaryInsuranceEdited: null,
      secondaryInsuranceIndex: null,
      memberId2Edited: null,
      subscriptionTypeIndex: null,
      infusionSet1Index: null,
      infusionSet2Index: null,
      orderHandlingIndex: null,
      sosMonitor: "",
      sosSensors: "",
      sosIp: "",
      sosInfusionSet: "",
      sosCartridge: "",
      lastBillDateMonitor: "",
      lastBillDateSensors: "",
      lastBillDateIp: "",
      lastBillDateInfusionSet: "",
      lastBillDateCartridge: "",
      escalated: false,
    } as Partial<Patient>);
    toast.success("Cleared local edits — refetching from Monday");
    refetch();
  };

  const handleSend = async (overridden: CheckFinding[] = []) => {
    if (!selected) return;
    setSaving(true);
    setSavePhase("posting");
    try {
      await sendPatientToMonday(selected, {
        onProgress: setSavePhase,
        requireDone: true,
        waitForDoneMs: SAVE_CONFIRM_MS,
      });
      toast.success("Profile confirmed & sent to Monday — Stage Advancer set to Completed");
      confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 } });

      // Audit trail for every warning the rep sent through anyway. Written
      // AFTER the send, and deliberately not part of the verified transaction:
      // a failed notes write must never fail or roll back a send that already
      // landed (Brandon's hard requirement #3). The trade-off is that the line
      // lands after the Stage Advancer fired, so it stays on this item rather
      // than riding the create-item automation downstream — which is the right
      // home for it anyway, since this is where the decision was made.
      //
      // Stamped through the shared helper rather than written raw, so the line
      // carries WHO overrode it (CLAUDE.md §9 — the raw format Brandon drafted
      // had no attribution). The `[FPC override] <ID>` token sits INSIDE the
      // stamp, keeping check IDs greppable while leaving the first `]` to the
      // timestamp, which is what Oversight's reason extractor slices on.
      if (overridden.length > 0) {
        try {
          const entry = overridden
            .map((f) => stampNoteEntry(`[FPC override] ${f.id} — ${f.title}`, "Final Confirm"))
            .join("\n");
          await writeLongText(selected.id, COL.notes, appendNoteEntry(selected.notes, entry));
        } catch (noteErr) {
          console.warn("[finalConfirm] override audit note failed (send already succeeded)", noteErr);
          toast.warning("Sent — but the override note didn't save", {
            description: "The profile went through. Add the override reason to Notes by hand.",
          });
        }
      }

      clearOverlay(selected.id);
      refetch();
    } catch (e) {
      if (e instanceof GatewayPendingError) {
        // Durably queued on the gateway and it WILL run — not a failure, and
        // above all not retryable: a second send writes the transaction twice.
        // No confetti, no clearOverlay and no refetch (the board still reads the
        // OLD values until the job lands, so refetching would look like a loss).
        //
        // ⚠️ The override audit note is skipped ON PURPOSE. It is a direct
        // writeLongText to COL.notes, and the queued transaction writes that
        // same column with the PRE-override body — so writing it now would be
        // silently overwritten when the job runs. The rep is told to add it by
        // hand instead, which is the same fallback the failed-note branch uses.
        toast.warning("Queued — Monday is still writing this save", {
          description:
            overridden.length > 0
              ? `${e.message} Add the override reason to Notes by hand once it lands.`
              : e.message,
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

  /**
   * Split the selected patient into two profiles (Supplies + Sensors).
   * 1. Duplicate the Monday item via API → get the new item's id.
   * 2. Apply the "original side" overrides to the existing item (local only).
   * 3. Inject the new duplicate into local state with the opposite side's
   *    overrides applied (also local only).
   * 4. Background refetch reconciles with Monday in ~30s; user can edit and
   *    Submit each profile independently in the meantime.
   *
   * No column writes happen here — those happen per profile on Submit.
   */
  // Live infusion-set options, shared (and cached) with PatientInfoCard — the
  // split path needs to resolve "Not Serving" against the real board.
  const { options: infusionOptions } = useStatusOptions(BOARD_ID, [
    COL.infusionSet1,
    COL.infusionSet2,
  ]);

  const handleSplit = async () => {
    if (!selected) return;

    // The sensors half of a split gets its infusion sets set to "Not Serving",
    // and that index reaches Monday. Resolve it from the LIVE board and abort
    // BEFORE duplicateItem if we can't — a guessed index writes a blank without
    // erroring, and aborting here means nothing has been created yet.
    const ns1 = indexForLabel(infusionOptions[COL.infusionSet1] ?? [], "Not Serving");
    const ns2 = indexForLabel(infusionOptions[COL.infusionSet2] ?? [], "Not Serving");
    if (ns1 === null || ns2 === null) {
      toast.error("Can't split yet — infusion set options haven't loaded from Monday", {
        description: "Nothing was created. Wait a moment and try again.",
      });
      return;
    }
    const infusionNotServing = { set1: ns1, set2: ns2 };

    const originalSide: SplitSide = determineOriginalSide(selected);
    const otherSide: SplitSide = originalSide === "supplies" ? "sensors" : "supplies";
    try {
      // Pass the original name so the new item doesn't keep Monday's "(copy)" suffix.
      const newId = await duplicateItem(selected.id, selected.name);

      // Immediately mark the new item as a split duplicate so Monday's
      // "new item created" automation can gate on `Split is not Split` and
      // skip resetting Stage Advancer / Days Since on this item.
      // Best-effort: if these fail, the user's overlay state still works
      // for the current session — but the duplicate may show wrong stage
      // values until the next Submit re-writes them.
      try {
        await Promise.all([
          writeStatusIndex(newId, COL.split, SPLIT_FLAG_INDEX),
          // Defensive: Monday's new-item automation might fire faster than
          // our Split write. Set Stage Advancer = Review Profile explicitly
          // so even if the automation reset it to something else, we
          // overwrite back to the correct stage.
          writeStatusIndex(newId, COL.stageAdvancer, STAGE_ADVANCER_REVIEW_PROFILE),
          selected.dateOfStageStart
            ? writeDate(newId, COL.dateOfStageStart, selected.dateOfStageStart)
            : Promise.resolve(),
        ]);
      } catch (err) {
        console.warn("[split] post-duplicate Monday writes partially failed:", err);
      }

      // Apply overrides + _splitCreated flag to the existing (original) patient.
      const originalOverrides = { ...getSplitOverrides(originalSide, selected, infusionNotServing), _splitCreated: true };
      update(selected.id, originalOverrides);

      // Build the duplicate patient locally (clone of original + opposite-side
      // overrides). Force the name + dateOfStageStart to the original so the
      // sidebar and Days Since stay in sync even if Monday's writes are
      // briefly out of date relative to our local view.
      const otherOverrides = {
        ...getSplitOverrides(otherSide, selected, infusionNotServing),
        _splitCreated: true,
        name: selected.name,
        dateOfStageStart: selected.dateOfStageStart,
      };
      const duplicate: Patient = {
        ...selected,
        ...otherOverrides,
        id: newId,
        lastUpdated: new Date().toISOString(),
      };
      addPatient(duplicate, otherOverrides);

      toast.success(
        `Split into 2 profiles — this becomes the ${originalSide === "supplies" ? "Supplies" : "Sensors"} profile. ` +
          `Review the ${otherSide === "supplies" ? "Supplies" : "Sensors"} profile in the sidebar.`,
      );
    } catch (e) {
      toast.error("Split failed", {
        description: e instanceof Error ? e.message : String(e),
      });
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
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button
                  onClick={() => goBack()}
                  className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <ShieldCheck className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Final Profile Confirmation</h1>
                  {selected && (<p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">{selected.name}{selected.escalated && <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Escalated</span>}</p>)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selected && <ClinicalsDownloadButton itemId={selected.id} />}
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
                <Button
                  onClick={resetForNewPatient}
                  disabled={!selected}
                  className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate"
                >
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
                <ReportIssueButton />
              </div>
            </div>
          </header>

          {unsubmittedSplits.length > 0 && (
            <div className="sticky top-0 z-30 bg-amber-100 border-b-2 border-amber-400 px-6 py-2.5 flex items-center gap-3 shadow-sm">
              <AlertTriangle className="h-5 w-5 text-amber-700 flex-shrink-0" />
              <p className="text-sm text-amber-900 flex-1">
                <span className="font-bold">
                  {unsubmittedSplits.length} unsaved split{unsubmittedSplits.length === 1 ? "" : "s"} —
                </span>{" "}
                Submit each profile to Monday before refreshing or closing the tab.
                Refreshing now will lose the split changes.
              </p>
            </div>
          )}

          <main className="flex-1 px-6 py-6 overflow-y-auto">
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <EmptyPatientPane loading={loading} error={error} queueEmpty={visiblePatients.length === 0} hint="No orders are due for final confirmation right now." />
                </div>
              )}

              {selected && (
                <>
                  <FinalCheckPanel findings={findings} />
                  <PatientInfoCard patient={selected} onFieldChange={handleFieldChange} findings={findings} />
                  <SplitOrderButton patient={selected} onSplit={handleSplit} />
                  <NotesPanel
                    notes={selected.notes}
                    profileSendOffNotes={selected.profileSendOffNotes}
                    mnWorkflowNotes={selected.mnWorkflowNotes}
                    insuranceNotes={selected.insuranceNotes}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                    onSaveToMonday={(v) => writeLongText(selected.id, COL.notes, v)}
                    notePrefix="Final Confirm"
                  />
                  <EscalateButton
                    escalated={selected.escalated}
                    onToggle={toggleEscalate}
                    disabled={!selected}
                    onOpenForm={() => setEscalationModalOpen(true)}
                  />
                  <SendWithChecksButton
                    findings={findings}
                    onSend={handleSend}
                    disabled={!selected}
                  />
                </>
              )}
            </section>
          </main>
        </div>
      </div>
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

export default FinalConfirmPage;
