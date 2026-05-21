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
import { RotateCcw, Stethoscope, ArrowLeft, Clock, Save, Zap, AlertTriangle } from "lucide-react";
import { resolveHcpcs } from "@/lib/samantha/hcpcRules";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/samantha/mondayWrite";
import { writeLongText, writeStatusIndex, COL } from "@/lib/samantha/mondayApi";
import { EscalationFormModal } from "@/components/shared/EscalationFormModal";
import { ESCALATION_INDEX } from "@/lib/samantha/mondayMapping";
import { FollowUpModal } from "@/components/samantha/FollowUpModal";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";

const CARECENTRIX_MODIFIERS: { hcpc: string; modifiers: string }[] = [
  { hcpc: "A4230", modifiers: "NU SC" },
  { hcpc: "A4232", modifiers: "NU SC" },
  { hcpc: "A4239", modifiers: "NU" },
  { hcpc: "E2103", modifiers: "NU" },
  { hcpc: "E0784", modifiers: "NU" },
];

function CarecentrixModifierNote() {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="rounded-xl bg-card border border-red-200 shadow-card p-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
        <p className="text-sm text-red-600 font-semibold">
          Check Modifiers for carecentrix here.
        </p>
        <button
          onMouseEnter={() => setShowTable(true)}
          onMouseLeave={() => setShowTable(false)}
          onClick={() => setShowTable((v) => !v)}
          className="ml-2 px-3 py-1 text-xs font-medium rounded-md border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
        >
          View Modifiers
        </button>
      </div>
      {showTable && (
        <table className="mt-3 ml-8 text-sm">
          <thead>
            <tr className="border-b border-muted">
              <th className="pr-6 pb-1 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">HCPC</th>
              <th className="pb-1 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Modifiers</th>
            </tr>
          </thead>
          <tbody>
            {CARECENTRIX_MODIFIERS.map((row) => (
              <tr key={row.hcpc} className="border-b border-muted/40 last:border-0">
                <td className="pr-6 py-1 font-mono font-medium">{row.hcpc}</td>
                <td className="py-1 font-mono">{row.modifiers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const SubmitAuthPage = () => {
  const navigate = useNavigate();
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const [escalationModalOpen, setEscalationModalOpen] = useState(false);
  const { patients, loading, error, refetch, update, clearOverlay , saveOverlay, hasOverlay } = useMondayPatients("submitAuth", searchParams.get("patientId"));
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

  // Show "Trigger DVS" when Medicaid appears in either insurance AND
  // the serving includes supplies (infusion sets / cartridges).
  const showTriggerDvs = useMemo(() => {
    if (!selected) return false;
    const pri = (selected.primaryInsurance ?? "").toLowerCase();
    const sec = (selected.secondaryInsurance ?? "").toLowerCase();
    const hasMedicaid = pri.includes("medicaid") || sec.includes("medicaid");
    if (!hasMedicaid) return false;
    const resolved = resolveHcpcs(selected.primaryInsurance || null, selected.serving || null, selected.secondaryInsurance ?? null);
    return resolved.some((r) => r.product === "infusion_set" || r.product === "cartridge");
  }, [selected?.primaryInsurance, selected?.secondaryInsurance, selected?.serving]);

  const handleSend = async () => {
    if (!selected) return;
    try {
      await sendPatientToMonday(selected, "submitAuth");
      clearOverlay(selected.id);
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
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Submit Auth</h1>{selected && <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => setFollowUpOpen(true)} disabled={!selected} className="gap-2 bg-white/90 text-blue-700 hover:bg-white shadow-elevate">
                  <Clock className="h-4 w-4" /> Follow Up
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
                  <PatientProfileCard patient={selected} onUpdate={(p) => update(selected.id, p)} />
                  {(selected.referralSource || "").toLowerCase().includes("carecentrix") && (
                    <CarecentrixModifierNote />
                  )}
                  <AuthorizationsPanel patient={selected} onCodeChange={updateCode} onNotesChange={(v) => update(selected.id, { notes: v })} onSaveNotesToMonday={(v) => writeLongText(selected.id, COL.callReferenceNotes, v)} />
                  <EscalateButton
                    escalated={!!selected.escalated}
                    onToggle={() => update(selected.id, { escalated: !selected.escalated })}
                    onOpenForm={() => setEscalationModalOpen(true)}
                  />

                  {showTriggerDvs && (
                    <div className="flex justify-center">
                      <Button
                        onClick={() => update(selected.id, { triggerDvs: !selected.triggerDvs })}
                        variant="outline"
                        className={
                          selected.triggerDvs
                            ? "gap-2 bg-blue-100 hover:bg-blue-200 !text-blue-700 border-blue-400 shadow-md"
                            : "gap-2 border-blue-300 !text-blue-600 hover:bg-blue-50"
                        }
                      >
                        <Zap className="h-4 w-4" />
                        {selected.triggerDvs ? "DVS Triggered" : "Trigger DVS"}
                      </Button>
                    </div>
                  )}

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
    {selected && (
        <EscalationFormModal
          open={escalationModalOpen}
          onOpenChange={setEscalationModalOpen}
          patientId={selected.id}
          patientName={selected.name}
          writeEscalationStatus={async (id) => { await writeStatusIndex(id, COL.escalation, ESCALATION_INDEX.required); }}
          writeEscalationNotes={async (id, text) => { await writeLongText(id, COL.escalationNotes, text); }}
          onSuccess={refetch}
        />
      )}
    </SidebarProvider>
  );
};

export default SubmitAuthPage;
