/**
 * Confirm Receipt — standalone view of mesheke-checklist's "Confirm Receipt" tab.
 */
import { useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/mesheke/useMondayPatients";
import type { Patient } from "@/lib/mesheke/workflow";
import { ConfirmReceiptPanel } from "@/components/mesheke/ConfirmReceiptPanel";
import { PatientsSidebar } from "@/components/mesheke/PatientsSidebar";
import { PatientProfileCard } from "@/components/mesheke/PatientProfileCard";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, Stethoscope, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { clearEvalState } from "@/lib/mesheke/evalState";
import { useNavigate } from "react-router-dom";

const ConfirmReceiptPage = () => {
  const navigate = useNavigate();
  const { patients, loading, error, refetch, update, clearOverlay } = useMondayPatients("confirmReceipt");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);

  useEffect(() => {
    if (!selectedId && patients.length > 0) setSelectedId(patients[0].id);
  }, [patients, selectedId]);

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
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar patients={patients} selectedId={selectedId} onSelect={setSelectedId} loading={loading} error={error} onRefresh={refetch} activeTab="confirmReceipt" />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button onClick={() => navigate("/")} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <Stethoscope className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · Confirm Receipt</p>
                  <h1 className="text-xl font-semibold">{selected ? `${selected.name} · Confirm Receipt` : "Confirm Receipt"}</h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={resetForNewPatient} disabled={!selected} className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate">
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 px-6 py-6">
            <section className="max-w-5xl mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">{loading ? "Loading patients from Monday…" : error ? error : "Select a patient from the sidebar to begin."}</p>
                </div>
              )}
              {selected && (
                <>
                  <PatientProfileCard patient={selected} defaultDoctorOpen />
                  <ConfirmReceiptPanel patient={selected} onUpdate={onUpdate} />
                </>
              )}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default ConfirmReceiptPage;
