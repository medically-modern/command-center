/**
 * Subscription Board — Agent view for managing patient subscriptions.
 * Reads from board 18407459988, "Subscriptions" group.
 */
import confetti from "canvas-confetti";
import { useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/subscription/useMondayPatients";
import { useAutoSelectPatient } from "@/hooks/useAutoSelectPatient";
import type { Patient } from "@/lib/subscription/workflow";
import { sidebarVisibleList } from "@/lib/subscription/sidebarList";
import { viewFilterFromParams } from "@/lib/roleView";
import { PatientInfoCard } from "@/components/subscription/PatientInfoCard";
import { SubscriptionForm } from "@/components/subscription/SubscriptionForm";
import { PatientsSidebar } from "@/components/subscription/PatientsSidebar";
import { SendToMondayButton } from "@/components/subscription/SendToMondayButton";
import { EscalateButton } from "@/components/subscription/EscalateButton";
import { NotesPanel } from "@/components/subscription/NotesPanel";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, RefreshCw, ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { refusePendingNote } from "@/components/shared/pendingNoteGuard";
import { sendPatientToMonday, sendNotesToMonday } from "@/lib/subscription/mondayWrite";
import { AbilityLockNote, useAbility } from "@/components/shell/AbilityLock";
import { validatePatientForSend } from "@/lib/subscription/workflow";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import { GatewayPendingError, SAVE_CONFIRM_MS, type WriteProgressPhase } from "@/lib/shared/verifiedWrite";
import { EmptyPatientPane } from "@/components/shared/EmptyPatientPane";
import { useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";
import { BOARD_ID as SUBSCRIPTION_BOARD_ID, COL as SUBSCRIPTION_COL } from "@/lib/subscription/mondayApi";

const SubscriptionPage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const { patients, loading, initialLoading, error, refetch, update, clearOverlay, discardEdits, saveOverlay, hasOverlay } = useMondayPatients(searchParams.get("patientId"));
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

  const validation = useMemo(
    () => selected ? validatePatientForSend(selected) : { valid: false, errors: [] },
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

  /** ⚠️ The SIGNED-IN person, never a borrowed one — this decides what I
   *  may WRITE (§5.39h). */
  const canEditProfile = useAbility("editProfile");

  const resetForNewPatient = () => {
    if (!selected) return;
    discardEdits(selected.id);
    toast.success("Cleared local edits — refetching from Monday");
    refetch();
  };

  const handleSend = async () => {
    if (!selected) return;
    // ⚠️ The ability is checked HERE as well as on the button. The button
    // is what a rep sees; this is what stops the write, and the two are not
    // the same guarantee — §5.39g's "a gate on the tab is not a gate on the
    // page", one level down.
    if (!canEditProfile) return;
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
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className={`${isEscalated ? "bg-red-700" : "bg-gradient-navy"} text-navy-foreground border-b border-sidebar-border`}>
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button onClick={() => goBack()} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <RefreshCw className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Subscription Management</h1>
                  {selected && <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
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


          <main className="flex-1 px-6 py-6 overflow-y-auto">
            <section className="max-w-6xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <EmptyPatientPane loading={loading} error={error} queueEmpty={visiblePatients.length === 0} hint="No subscriptions are due right now." />
                </div>
              )}

              {selected && (
                <>
                  <PatientInfoCard patient={selected} onFieldChange={handleFieldChange} />
                  <SubscriptionForm patient={selected} onFieldChange={handleFieldChange} />
                  <NotesPanel key={selected.id}
                    columnRef={{ boardId: SUBSCRIPTION_BOARD_ID, columnId: SUBSCRIPTION_COL.subscriptionNotes }}
                    notes={selected.notes}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                    onSaveToMonday={(v) => sendNotesToMonday(selected.id, v)}
                    notePrefix="Subscription"
                  />
                  <EscalateButton escalated={selected.escalated} onToggle={toggleEscalate} disabled={!selected} />
                  {/* ⚠️⚠️ **`editProfile` is what saves THIS** (§5.39h). Brandon's
                      own definition of the ability is *"can change the
                      Subscription profile — Order details, visit date, MN docs,
                      address and phone; without it the profile is read-only"*,
                      and this send is exactly that: ~20 columns of order
                      details, address and phone in one write.
                      ⚠️ The profile above still RENDERS, and the fields are
                      still typeable — the ability unlocks the SAVE, it does not
                      hide the patient (§5.39c). Notes stay writable beside it
                      on purpose: a running case history is not the profile,
                      and it is how a rep records what they just learned. */}
                  {canEditProfile ? (
                    <SendToMondayButton onSend={handleSend} disabled={!selected || !validation.valid} validationErrors={validation.errors} />
                  ) : (
                    <div className="flex flex-col items-center gap-2 pt-2">
                      <SendToMondayButton onSend={handleSend} disabled validationErrors={[]} />
                      <AbilityLockNote ability="editProfile" />
                    </div>
                  )}
                </>
              )}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default SubscriptionPage;
