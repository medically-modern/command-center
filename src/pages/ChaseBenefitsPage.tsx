/**
 * Chase Benefits — the redesigned Benefits tab (Brandon's July 2026 handoff;
 * JOSH_HANDOFF_BENEFITS.md + BENEFITS_REDESIGN_REVIEW.md, decisions D1–D10).
 *
 * Kept from the old page: the patients sidebar, the top bar (Clinicals /
 * Save / Reset / Report Issue), the 30s poll + local overlay machinery,
 * deep links, and the Reference Notes panel.
 *
 * Removed on purpose: the Follow Up button (D-decision — SubmitAuth/Auth
 * Outstanding keep theirs; existing follow-ups stay clearable from the
 * sidebar), the Escalate button + modal (escalation is DERIVED on send,
 * spec §5), the Trigger DVS buttons (D3 — DVS moves to its own stage), the
 * "edits stay local" strip, and every header edit control (read-only, §6).
 */
import { useMemo } from "react";
import { useMondayPatients } from "@/hooks/samantha/useMondayPatients";
import { useAutoSelectPatient } from "@/hooks/useAutoSelectPatient";
import type {
  CallLogRow,
  Patient,
  ProductCodeId,
  ProductCodeState,
  UniversalChoice,
} from "@/lib/samantha/workflow";
import { EMPTY_INSURANCE } from "@/lib/samantha/workflow";
import { validateBenefitsFactsForSubmit } from "@/lib/samantha/benefitsDerive";
import { BenefitsPanel } from "@/components/samantha/BenefitsPanel";
import { BenefitsPatientHeader } from "@/components/samantha/BenefitsPatientHeader";
import { NotesPanel } from "@/components/samantha/NotesPanel";
import { PatientsSidebar } from "@/components/samantha/PatientsSidebar";
import { SendToMondayButton } from "@/components/samantha/SendToMondayButton";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, Stethoscope, ArrowLeft, Save } from "lucide-react";
import { ClinicalsDownloadButton } from "@/components/samantha/ClinicalsDownloadButton";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/samantha/mondayWrite";
import { writeLongText, COL } from "@/lib/samantha/mondayApi";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { viewFilterFromParams } from "@/lib/roleView";
import { sidebarVisibleList } from "@/lib/samantha/sidebarList";
import { useState } from "react";

const ChaseBenefitsPage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const isManager = searchParams.get("manager") === "1";
  const { patients, loading, initialLoading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay } =
    useMondayPatients("benefits", searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );

  // Auto-select the first patient the sidebar actually shows (same list math
  // as PatientsSidebar), never from the pre-fetch localStorage cache.
  const viewFilter = viewFilterFromParams(searchParams);
  const visiblePatients = useMemo(
    () => sidebarVisibleList(patients, viewFilter, "benefits"),
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

  const onUniversalChange = (id: "in-network" | "active" | "dme-benefits", value: UniversalChoice) => {
    if (!selected) return;
    const ins = selected.insurance ?? EMPTY_INSURANCE;
    update(selected.id, { insurance: { ...ins, universal: { ...ins.universal, [id]: value } } });
  };

  const updateCode = (codeId: ProductCodeId, patch: Partial<ProductCodeState>) => {
    if (!selected) return;
    const ins = selected.insurance ?? EMPTY_INSURANCE;
    const prev = ins.codes[codeId] ?? { status: "pending" as const };
    update(selected.id, {
      insurance: { ...ins, codes: { ...ins.codes, [codeId]: { ...prev, ...patch } } },
    });
  };

  const updateCallLog = (section: "callsUniversal" | "callsSosAuth", rows: CallLogRow[]) => {
    if (!selected) return;
    const ins = selected.insurance ?? EMPTY_INSURANCE;
    update(selected.id, { insurance: { ...ins, [section]: rows } });
  };

  const resetForNewPatient = () => {
    if (!selected) return;
    clearOverlay(selected.id);
    update(selected.id, { insurance: EMPTY_INSURANCE, notes: "" });
    toast.success("Cleared local edits — refetching from Monday");
    refetch();
  };

  const benefitsMissing = selected ? validateBenefitsFactsForSubmit(selected) : [];

  const handleSend = async () => {
    if (!selected) return;
    if (benefitsMissing.length > 0) return;
    try {
      await sendPatientToMonday(selected, "benefits");
      clearOverlay(selected.id);
      toast.success("Benefit check complete — sent to Monday");
      refetch(true);
    } catch (e) {
      toast.error("Send to Monday failed", { description: e instanceof Error ? e.message : String(e) });
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
          activeGroup="benefits"
          managerMode={isManager}
        />

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
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · Insurance Verification</p>
                  <h1 className="text-2xl font-bold">Benefits</h1>{selected && (<p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">{selected.name}{selected.escalated && <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Escalated</span>}</p>)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selected && <ClinicalsDownloadButton itemId={selected.id} />}
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

          <main className="flex-1 px-3 sm:px-6 py-6">
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
                  <BenefitsPatientHeader patient={selected} />

                  <BenefitsPanel
                    patient={selected}
                    onUniversalChange={onUniversalChange}
                    onCodeChange={updateCode}
                    onCallLogChange={updateCallLog}
                  />

                  <NotesPanel
                    notes={selected.notes}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                    onSaveToMonday={async (v) => {
                      await writeLongText(selected.id, COL.callReferenceNotes, v);
                    }}
                    description="Shared notes across Benefits, Submit Auth, and Auth Outstanding. Auto-escalation reasons are appended here on send."
                  />

                  <SendToMondayButton onSend={handleSend} disabled={!selected || benefitsMissing.length > 0} />
                  {benefitsMissing.length > 0 && (
                    <div className="max-w-xl mx-auto rounded-md border border-warning/40 bg-warning/10 px-4 py-2 text-center">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-warning-foreground/80">Missing before send</p>
                      <p className="mt-0.5 text-xs text-warning-foreground">{benefitsMissing.join(" · ")}</p>
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

export default ChaseBenefitsPage;
