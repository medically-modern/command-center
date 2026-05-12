/**
 * Welcome Call — standalone view from welcome-call-checklist repo.
 */
import confetti from "canvas-confetti";
import { useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/welcomeCall/useMondayPatients";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { PatientInfoCard } from "@/components/welcomeCall/PatientInfoCard";
import { WelcomeCallForm } from "@/components/welcomeCall/WelcomeCallForm";
import { ReviewPanel } from "@/components/welcomeCall/ReviewPanel";
import { PatientsSidebar } from "@/components/welcomeCall/PatientsSidebar";
import { SendToMondayButton } from "@/components/welcomeCall/SendToMondayButton";
import { EscalateButton } from "@/components/welcomeCall/EscalateButton";
import { NotesPanel } from "@/components/welcomeCall/NotesPanel";
import { ClinicalsDownloadButton } from "@/components/welcomeCall/ClinicalsDownloadButton";
import { CallAttemptsCounter } from "@/components/welcomeCall/CallAttemptsCounter";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, ClipboardCheck, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { sendPatientToMonday, sendWelcomeCallTextToMonday, sendNotesToMonday } from "@/lib/welcomeCall/mondayWrite";
import { validatePatientForSend } from "@/lib/welcomeCall/workflow";
import { useNavigate, useSearchParams } from "react-router-dom";

const WelcomeCallPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const { patients, loading, error, refetch, update, clearOverlay } = useMondayPatients(searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );

  useEffect(() => {
    if (!selectedId && patients.length > 0) setSelectedId(patients[0].id);
  }, [patients, selectedId]);

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
    update(selected.id, {
      cgmTypeIndex: null,
      secondaryInsuranceEdited: null,
      secondaryInsuranceIndex: null,
      memberId2Edited: null,
      phoneEdited: null,
      monitorQty: "",
      pumpQty: "",
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
      escalated: false,
    } as Partial<Patient>);
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

  return (
    <SidebarProvider>
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
                <button onClick={() => navigate("/?tab=dashboard")} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <ClipboardCheck className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Welcome Call</h1>{selected && <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>}
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
                <Button onClick={resetForNewPatient} disabled={!selected} className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate">
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 px-6 py-6 overflow-y-auto">
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
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
                  <WelcomeCallForm patient={selected} onFieldChange={handleFieldChange} onSendWelcomeCallText={handleSendWelcomeCallText} />
                  <NotesPanel
                    notes={selected.notes}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                    onSaveToMonday={(v) => sendNotesToMonday(selected.id, v)}
                  />
                  <ReviewPanel patient={selected} />
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

export default WelcomeCallPage;
