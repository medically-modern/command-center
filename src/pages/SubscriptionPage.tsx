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
import { sendPatientToMonday, sendNotesToMonday } from "@/lib/subscription/mondayWrite";
import { validatePatientForSend } from "@/lib/subscription/workflow";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";

const SubscriptionPage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const { patients, loading, initialLoading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay } = useMondayPatients(searchParams.get("patientId"));
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

  const resetForNewPatient = () => {
    if (!selected) return;
    clearOverlay(selected.id);
    toast.success("Cleared local edits — refetching from Monday");
    refetch();
  };

  const handleSend = async () => {
    if (!selected) return;
    try {
      await sendPatientToMonday(selected);
      toast.success("Sent to Monday");
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
              </div>
            </div>
          </header>

          <main className="flex-1 px-6 py-6 overflow-y-auto">
            <section className="max-w-6xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {loading ? "Loading patients from Monday…" : error ? error : "Select a patient from the sidebar to begin."}
                  </p>
                </div>
              )}

              {selected && (
                <>
                  <PatientInfoCard patient={selected} onFieldChange={handleFieldChange} />
                  <SubscriptionForm patient={selected} onFieldChange={handleFieldChange} />
                  <NotesPanel
                    notes={selected.notes}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                    onSaveToMonday={(v) => sendNotesToMonday(selected.id, v)}
                  />
                  <EscalateButton escalated={selected.escalated} onToggle={toggleEscalate} disabled={!selected} />
                  <SendToMondayButton onSend={handleSend} disabled={!selected || !validation.valid} validationErrors={validation.errors} />
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
