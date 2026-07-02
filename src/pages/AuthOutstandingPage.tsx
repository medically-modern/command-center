/**
 * Auth Outstanding — standalone view of Samantha-checklist's "Auth Outstanding" tab.
 */
import { useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/samantha/useMondayPatients";
import { useAutoSelectPatient } from "@/hooks/useAutoSelectPatient";
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
import { RotateCcw, Stethoscope, ArrowLeft, Clock, Save, Zap, CheckCircle2 } from "lucide-react";
import { resolveHcpcs } from "@/lib/samantha/hcpcRules";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/samantha/mondayWrite";
import { writeLongText, writeStatusIndex, COL } from "@/lib/samantha/mondayApi";
import { EscalationFormModal } from "@/components/shared/EscalationFormModal";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { ESCALATION_INDEX } from "@/lib/samantha/mondayMapping";
import { FollowUpModal } from "@/components/samantha/FollowUpModal";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { viewFilterFromParams } from "@/lib/roleView";
import { sidebarVisibleList } from "@/lib/samantha/sidebarList";


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
          {dvsStatus?.toLowerCase() === "mltc" && (
            <p className="text-xs font-semibold text-red-600 mt-1.5">
              MLTC requires auth for supplies, submit auth via fax.
            </p>
          )}
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
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const isManager = searchParams.get("manager") === "1";
  const [escalationModalOpen, setEscalationModalOpen] = useState(false);
  const { patients, loading, initialLoading, error, refetch, update, clearOverlay , saveOverlay, hasOverlay } = useMondayPatients("authOutstanding", searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );
  const [followUpOpen, setFollowUpOpen] = useState(false);

  // Auto-select the first patient the sidebar actually shows (same list math
  // as PatientsSidebar), never from the pre-fetch localStorage cache.
  const viewFilter = viewFilterFromParams(searchParams);
  const visiblePatients = useMemo(
    () => sidebarVisibleList(patients, viewFilter, "authOutstanding"),
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

  // Show "Claims Paid — Mark Complete" when DVS succeeded and claims are paid.
  // Only applies to Medicaid patients with supplies (infusion sets / cartridges).
  const showClaimsPaid = useMemo(() => {
    if (!selected) return false;
    return (
      selected.claimsStatus === "Claims Paid" &&
      selected.dvsStatus === "Success"
    );
  }, [selected?.claimsStatus, selected?.dvsStatus]);

  // Whether the supplies have already been marked auth-valid via the button.
  const suppliesAlreadyMarked = useMemo(() => {
    if (!selected) return false;
    const ins = selected.insurance ?? EMPTY_INSURANCE;
    const infState = ins.codes["infusion-sets"];
    const cartState = ins.codes["cartridges"];
    // Both must be auth-valid (or the product isn't served, indicated
    // by _mondayAuthLabel). Consider "marked" if every served supply is resolved.
    const infResolved =
      infState?._mondayAuthLabel?.toLowerCase() === "not serving" ||
      infState?.authOutstandingResult === "auth-valid";
    const cartResolved =
      cartState?._mondayAuthLabel?.toLowerCase() === "not serving" ||
      cartState?.authOutstandingResult === "auth-valid";
    return !!infResolved && !!cartResolved;
  }, [selected?.insurance]);

  const handleClaimsPaidComplete = () => {
    if (!selected) return;
    // Only mark infusion sets and cartridges — NOT pump or CGM products.
    // The pump may go through a different insurance and has its own auth flow.
    // Batch both updates into a single update() call so they don't overwrite each other.
    const ins = selected.insurance ?? EMPTY_INSURANCE;
    const supplyCodeIds: ProductCodeId[] = ["infusion-sets", "cartridges"];
    let updatedCodes = { ...ins.codes };
    for (const codeId of supplyCodeIds) {
      const state = updatedCodes[codeId];
      if (state?._mondayAuthLabel?.toLowerCase() === "not serving") continue;
      const prev = updatedCodes[codeId] ?? { status: "pending" as const };
      updatedCodes[codeId] = { ...prev, authOutstandingResult: "auth-valid" };
    }
    update(selected.id, { insurance: { ...ins, codes: updatedCodes } });
    toast.success("Supplies marked as Auth Valid — hit Send to Monday to complete");
  };

  const handleSend = async () => {
    if (!selected) return;
    try {
      await sendPatientToMonday(selected, "authOutstanding");
      clearOverlay(selected.id);
      toast.success("Sent to Monday");
    } catch (e) {
      toast.error("Send to Monday failed", { description: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar patients={patients} selectedId={selectedId} onSelect={setSelectedId} loading={loading} error={error} onRefresh={refetch} activeGroup="authOutstanding" managerMode={isManager} />
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
                  <h1 className="text-2xl font-bold">Auth Outstanding</h1>{selected && (<p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">{selected.name}{selected.escalated && <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Escalated</span>}</p>)}
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
                  <DvsClaimsVisual dvsStatus={selected.dvsStatus} claimsStatus={selected.claimsStatus} />
                  <AuthOutstandingPanel patient={selected} onCodeChange={updateCode} onNotesChange={(v) => update(selected.id, { notes: v })} onSaveNotesToMonday={(v) => writeLongText(selected.id, COL.callReferenceNotes, v)} />
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

                  {showClaimsPaid && (
                    <div
                      className={
                        suppliesAlreadyMarked
                          ? "rounded-xl border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-5 text-center transition-all duration-300"
                          : "rounded-xl border-2 border-emerald-500/50 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 p-5 text-center transition-all duration-300"
                      }
                    >
                      {suppliesAlreadyMarked ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="h-10 w-10 rounded-full bg-emerald-500 flex items-center justify-center shadow-md">
                            <CheckCircle2 className="h-5 w-5 text-white" />
                          </div>
                          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                            Supplies Marked Complete
                          </p>
                          <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">
                            Hit Send to Monday to finalize
                          </p>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs uppercase tracking-wider text-emerald-700/70 dark:text-emerald-300/70 mb-3">
                            DVS Verified · Claims Paid
                          </p>
                          <Button
                            onClick={handleClaimsPaidComplete}
                            size="lg"
                            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-elevate px-8 py-3 text-base transition-transform active:scale-95"
                          >
                            <CheckCircle2 className="h-5 w-5" />
                            Mark Supplies Complete
                          </Button>
                          <p className="text-[11px] text-muted-foreground mt-2">
                            Sets infusion sets &amp; cartridges to Auth Valid. Pump auth is handled separately.
                          </p>
                        </>
                      )}
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

export default AuthOutstandingPage;
