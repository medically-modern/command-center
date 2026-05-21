/**
 * Evaluate — standalone view of masheke-checklist's "Evaluate" tab.
 */
import { useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/masheke/useMondayPatients";
import type { Patient } from "@/lib/masheke/workflow";
import { EvaluatePanel } from "@/components/masheke/EvaluatePanel";
import { PatientsSidebar } from "@/components/masheke/PatientsSidebar";
import { PatientProfileCard } from "@/components/masheke/PatientProfileCard";
import { ReferralEmailPanel } from "@/components/masheke/ReferralEmailPanel";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, Stethoscope, ArrowLeft, Mail, Ban , Save} from "lucide-react";
import { toast } from "sonner";
import { clearEvalState } from "@/lib/masheke/evalState";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BlockedModal } from "@/components/masheke/BlockedModal";
import { EscalationFormModal } from "@/components/shared/EscalationFormModal";
import { writeStatusIndex, writeLongText, COL } from "@/lib/masheke/mondayApi";
import { ESCALATION_INDEX } from "@/lib/masheke/mondayMapping";
import { useBackNavigation } from "@/hooks/useBackNavigation";

const EvaluatePage = () => {
  const navigate = useNavigate();
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const { patients, loading, error, refetch, update, clearOverlay , saveOverlay, hasOverlay } = useMondayPatients("evaluate", searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );
  const [resetVersion, setResetVersion] = useState(0);
  const [referralEmailOpen, setReferralEmailOpen] = useState(false);
  const [blockedModalOpen, setBlockedModalOpen] = useState(false);
  const [escalationModalOpen, setEscalationModalOpen] = useState(false);

  useEffect(() => {
    if (!selectedId && patients.length > 0) setSelectedId(patients[0].id);
  }, [patients, selectedId]);

  const selected: Patient | undefined = useMemo(
    () => patients.find((p) => p.id === selectedId),
    [patients, selectedId],
  );

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
        <PatientsSidebar patients={patients} selectedId={selectedId} onSelect={setSelectedId} loading={loading} error={error} onRefresh={refetch} activeTab="evaluate" />
        <div className="flex-1 flex flex-col min-w-0">
          <header className={`${isEscalated ? "bg-red-700" : "bg-gradient-navy"} text-navy-foreground border-b border-sidebar-border`}>
            <div className="px-3 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button onClick={() => goBack()} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <Stethoscope className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · Evaluate</p>
                  <h1 className="text-xl font-semibold">{selected ? `${selected.name} · Evaluate` : "Evaluate"}</h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setBlockedModalOpen(true)}
                  disabled={!selected}
                  className="gap-2 bg-red-600 hover:bg-red-700 text-white shadow-elevate"
                >
                  <Ban className="h-4 w-4" /> Blocked
                </Button>
                <Button
                  onClick={() => setReferralEmailOpen((o) => !o)}
                  disabled={!selected}
                  variant={referralEmailOpen ? "default" : "outline"}
                  className={referralEmailOpen
                    ? "gap-2 shadow-elevate"
                    : "gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate"
                  }
                >
                  <Mail className="h-4 w-4" />
                  {referralEmailOpen ? "Hide Referral Email" : "See Referral Email"}
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
              </div>
            </div>
          </header>

          <main className="flex-1 px-3 sm:px-6 py-6">
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">{loading ? "Loading patients from Monday…" : error ? error : "Select a patient from the sidebar to begin."}</p>
                </div>
              )}
              {selected && (
                <>
                  <PatientProfileCard patient={selected} onDoctorEdit={(patch) => update(selected.id, patch)} />
                  <EvaluatePanel patient={selected} resetVersion={resetVersion} onUpdate={(patch) => update(selected.id, patch)} />
                </>
              )}
            </section>
          </main>
        </div>

        {/* Side-by-side referral email panel */}
        {referralEmailOpen && selected && (
          <ReferralEmailPanel
            itemId={selected.id}
            patientName={selected.name}
            onClose={() => setReferralEmailOpen(false)}
          />
        )}
      </div>

      {selected && (
        <BlockedModal
          open={blockedModalOpen}
          onOpenChange={setBlockedModalOpen}
          patientId={selected.id}
          patientName={selected.name}
          onSuccess={refetch}
        />
      )}
    </SidebarProvider>
  );
};

export default EvaluatePage;
