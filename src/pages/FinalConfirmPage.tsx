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
  validatePatientForSend,
  determineOriginalSide,
  getSplitOverrides,
} from "@/lib/finalConfirm/workflow";
import { PatientInfoCard } from "@/components/finalConfirm/PatientInfoCard";
import { NotesPanel } from "@/components/finalConfirm/NotesPanel";
import { PatientsSidebar } from "@/components/finalConfirm/PatientsSidebar";
import { SendToMondayButton } from "@/components/finalConfirm/SendToMondayButton";
import { SplitOrderButton } from "@/components/finalConfirm/SplitOrderButton";
import { EscalateButton } from "@/components/finalConfirm/EscalateButton";
import { ClinicalsDownloadButton } from "@/components/finalConfirm/ClinicalsDownloadButton";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, ShieldCheck, ArrowLeft, AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/finalConfirm/mondayWrite";
import { duplicateItem, writeStatusIndex, writeDate, writeLongText, COL } from "@/lib/finalConfirm/mondayApi";
import { EscalationFormModal } from "@/components/shared/EscalationFormModal";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";

// Stage Advancer label index 0 = "Review Profile" — the stage that lands an
// item in the Final Profile Confirmation group on Monday.
const STAGE_ADVANCER_REVIEW_PROFILE = 0;
// Split column label index 1 = "Split" (per the Monday board column the user set up).
const SPLIT_FLAG_INDEX = 1;
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
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

  const validation = useMemo(
    () => (selected ? validatePatientForSend(selected) : { valid: false, errors: [] }),
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

  const handleSend = async () => {
    if (!selected) return;
    try {
      await sendPatientToMonday(selected);
      toast.success("Profile confirmed & sent to Monday — Stage Advancer set to Completed");
      confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 } });
      clearOverlay(selected.id);
      refetch();
    } catch (e) {
      toast.error("Send to Monday failed", {
        description: e instanceof Error ? e.message : String(e),
      });
      throw e;
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
  const handleSplit = async () => {
    if (!selected) return;
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
      const originalOverrides = { ...getSplitOverrides(originalSide, selected), _splitCreated: true };
      update(selected.id, originalOverrides);

      // Build the duplicate patient locally (clone of original + opposite-side
      // overrides). Force the name + dateOfStageStart to the original so the
      // sidebar and Days Since stay in sync even if Monday's writes are
      // briefly out of date relative to our local view.
      const otherOverrides = {
        ...getSplitOverrides(otherSide, selected),
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
            <section className="max-w-5xl mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {loading
                      ? "Loading patients from Monday…"
                      : error
                        ? error
                        : "Select a patient from the sidebar to begin."}
                  </p>
                </div>
              )}

              {selected && (
                <>
                  <PatientInfoCard patient={selected} onFieldChange={handleFieldChange} />
                  <SplitOrderButton patient={selected} onSplit={handleSplit} />
                  <NotesPanel
                    notes={selected.notes}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                    onSaveToMonday={(v) => writeLongText(selected.id, COL.notes, v)}
                  />
                  <EscalateButton
                    escalated={selected.escalated}
                    onToggle={toggleEscalate}
                    disabled={!selected}
                    onOpenForm={() => setEscalationModalOpen(true)}
                  />
                  <SendToMondayButton
                    onSend={handleSend}
                    disabled={!selected || !validation.valid}
                    validationErrors={validation.errors}
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
