/**
 * Auth Outstanding — standalone view of Samantha-checklist's "Auth Outstanding" tab.
 */
import { useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/samantha/useMondayPatients";
import {
  Patient,
  ProductCodeId,
  ProductCodeState,
  EMPTY_INSURANCE,
} from "@/lib/samantha/workflow";
import { AuthOutstandingPanel } from "@/components/samantha/AuthOutstandingPanel";
import { PatientsSidebar } from "@/components/samantha/PatientsSidebar";
import { PatientProfileCard } from "@/components/samantha/PatientProfileCard";
import { SendToMondayButton } from "@/components/samantha/SendToMondayButton";
import { Button } from "@/components/ui/button";
import { EscalateButton } from "@/components/samantha/EscalateButton";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, Stethoscope, ArrowLeft, Clock } from "lucide-react";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/samantha/mondayWrite";
import { FollowUpModal } from "@/components/samantha/FollowUpModal";
import { useNavigate, useSearchParams } from "react-router-dom";


/* ── DVS + Claims Status Visual ─────────────────────────────────── */

function DvsClaimsVisual({ dvsStatus, claimsStatus }: { dvsStatus?: string; claimsStatus?: string }) {
  if (!dvsStatus) return null;

  const statusColor = (label: string | undefined) => {
    if (!label) return "bg-muted text-muted-foreground";
    const l = label.toLowerCase();
    if (l.includes("success") || l.includes("paid")) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
    if (l.includes("failed") || l.includes("denied") || l.includes("error")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    if (l.includes("running") || l.includes("trigger") || l.includes("submit")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    if (l.includes("review") || l.includes("incorrect") || l.includes("retry")) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  };

  return (
    <div className="rounded-xl bg-card border shadow-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Verification Status</p>
      <div className="flex items-stretch gap-4">
        <div className="flex-1 rounded-lg border p-3 text-center space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">DVS</p>
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${statusColor(dvsStatus)}`}>
            {dvsStatus}
          </span>
        </div>
        <div className="flex-1 rounded-lg border p-3 text-center space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Claim</p>
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${statusColor(claimsStatus)}`}>
            {claimsStatus || "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

const AuthOutstandingPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const { patients, loading, error, refetch, update, clearOverlay } = useMondayPatients("authOutstanding", searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );
  const [followUpOpen, setFollowUpOpen] = useState(false);

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
      await sendPatientToMonday(selected, "authOutstanding");
      toast.success("Sent to Monday");
    } catch (e) {
      toast.error("Send to Monday failed", { description: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar patients={patients} selectedId={selectedId} onSelect={setSelectedId} loading={loading} error={error} onRefresh={refetch} activeGroup="authOutstanding" />
        <div className="flex-1 flex flex-col min-w-0">
          <header className={`${isEscalated ? "bg-red-700" : "bg-gradient-navy"} text-navy-foreground border-b border-sidebar-border`}>
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
                  <h1 className="text-2xl font-bold">Auth Outstanding</h1>{selected && <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => setFollowUpOpen(true)} disabled={!selected} className="gap-2 bg-white/90 text-blue-700 hover:bg-white shadow-elevate">
                  <Clock className="h-4 w-4" /> Follow Up
                </Button>
                <Button onClick={resetForNewPatient} disabled={!selected} className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate">
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 px-6 py-6">
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">{loading ? "Loading patients from Monday…" : error ? error : "Select a patient from the sidebar to begin."}</p>
                </div>
              )}
              {selected && (
                <>
                  <PatientProfileCard patient={selected} onUpdate={(p) => update(selected.id, p)} />
                  <DvsClaimsVisual dvsStatus={selected.dvsStatus} claimsStatus={selected.claimsStatus} />
                  <AuthOutstandingPanel patient={selected} onCodeChange={updateCode} onNotesChange={(v) => update(selected.id, { notes: v })} />
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

export default AuthOutstandingPage;
