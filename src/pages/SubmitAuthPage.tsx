/**
 * Submit Auth — standalone view of Samantha-checklist's "Submit Auth" tab.
 */
import { useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/samantha/useMondayPatients";
import {
  Patient,
  ProductCodeId,
  ProductCodeState,
  EMPTY_INSURANCE,
} from "@/lib/samantha/workflow";
import { AuthorizationsPanel } from "@/components/samantha/AuthorizationsPanel";
import { PatientsSidebar } from "@/components/samantha/PatientsSidebar";
import { PatientProfileCard } from "@/components/samantha/PatientProfileCard";
import { SendToMondayButton } from "@/components/samantha/SendToMondayButton";
import { Button } from "@/components/ui/button";
import { EscalateButton } from "@/components/samantha/EscalateButton";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, Stethoscope, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/samantha/mondayWrite";
import { useNavigate } from "react-router-dom";

const SubmitAuthPage = () => {
  const navigate = useNavigate();
  const { patients, loading, error, refetch, update, clearOverlay } = useMondayPatients("submitAuth");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && patients.length > 0) setSelectedId(patients[0].id);
  }, [patients, selectedId]);

  const selected: Patient | undefined = useMemo(
    () => patients.find((p) => p.id === selectedId),
    [patients, selectedId],
  );

  const updateCode = (codeId: ProductCodeId, patch: Partial<ProductCodeState>) => {
    if (!selected) return;
    const ins = selected.insurance ?? EMPTY_INSURANCE;
    const prev = ins.codes[codeId] ?? { status: "pending" as const };
    const nextCode = { ...prev, ...patch };
    const next = { ...ins, codes: { ...ins.codes, [codeId]: nextCode } };
    update(selected.id, { insurance: next });
  };

  const resetForNewPatient = () => {
    if (!selected) return;
    clearOverlay(selected.id);
    update(selected.id, { insurance: EMPTY_INSURANCE, notes: "" });
    toast.success("Cleared local edits — refetching from Monday");
    refetch();
  };

  const handleSend = async () => {
    if (!selected) return;
    try {
      await sendPatientToMonday(selected, "submitAuth");
      toast.success("Sent to Monday");
    } catch (e) {
      toast.error("Send to Monday failed", { description: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar patients={patients} selectedId={selectedId} onSelect={setSelectedId} loading={loading} error={error} onRefresh={refetch} activeGroup="submitAuth" />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button onClick={() => navigate("/?tab=dashboard")} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <Stethoscope className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Submit Auth</h1>{selected && <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>}
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
                  <PatientProfileCard patient={selected} onUpdate={(p) => update(selected.id, p)} />
                  <AuthorizationsPanel patient={selected} onCodeChange={updateCode} onNotesChange={(v) => update(selected.id, { notes: v })} />
                  <EscalateButton
                    escalated={!!selected.escalated}
                    onToggle={() => update(selected.id, { escalated: !selected.escalated })}
                  />
                  <SendToMondayButton onSend={handleSend} disabled={!selected} />
                </>
              )}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default SubmitAuthPage;
