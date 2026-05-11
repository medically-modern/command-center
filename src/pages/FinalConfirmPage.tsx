/**
 * Final Profile Confirmation — pre-check before Monday automations
 * advance the patient to Subscription & Order boards.
 */
import confetti from "canvas-confetti";
import { useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/finalConfirm/useMondayPatients";
import type { Patient, SplitSide } from "@/lib/finalConfirm/workflow";
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
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, ShieldCheck, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/finalConfirm/mondayWrite";
import { duplicateItem } from "@/lib/finalConfirm/mondayApi";
import { useNavigate } from "react-router-dom";

const FinalConfirmPage = () => {
  const navigate = useNavigate();
  const { patients, loading, error, refetch, update, clearOverlay, addPatient } = useMondayPatients();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && patients.length > 0) setSelectedId(patients[0].id);
  }, [patients, selectedId]);

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
      const newId = await duplicateItem(selected.id);

      // Apply overrides to the existing (original) patient.
      const originalOverrides = getSplitOverrides(originalSide, selected);
      update(selected.id, originalOverrides);

      // Build the duplicate patient locally (clone of original + opposite-side overrides).
      const otherOverrides = getSplitOverrides(otherSide, selected);
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
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button
                  onClick={() => navigate("/?tab=dashboard")}
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
                  {selected && <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>}
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
              </div>
            </div>
          </header>

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
                  <NotesPanel
                    notes={selected.notes}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                  />
                  <SplitOrderButton patient={selected} onSplit={handleSplit} />
                  <EscalateButton
                    escalated={selected.escalated}
                    onToggle={toggleEscalate}
                    disabled={!selected}
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
    </SidebarProvider>
  );
};

export default FinalConfirmPage;
