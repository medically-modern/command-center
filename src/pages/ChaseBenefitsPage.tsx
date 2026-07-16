/**
 * Chase Benefits — the redesigned Benefits tab (Brandon's July 2026 handoff;
 * JOSH_HANDOFF_BENEFITS.md + BENEFITS_REDESIGN_REVIEW.md, decisions D1–D10).
 *
 * Kept from the old page: the patients sidebar, the top bar (Clinicals /
 * Save / Reset / Report Issue), the 30s poll + local overlay machinery,
 * deep links, and the append-style Reference Notes panel.
 *
 * Removed on purpose: the Follow Up button (D-decision — SubmitAuth/Auth
 * Outstanding keep theirs; existing follow-ups stay clearable from the
 * sidebar), the Escalate button + modal (escalation is DERIVED on send,
 * spec §5), the Trigger DVS buttons (D3 — DVS moves to its own stage), the
 * "edits stay local" strip, and every header edit control (read-only, §6).
 *
 * TESTING AIDS (strip for production together with the Board Output
 * drawer): the demo scenario bar builds local "Bob Jones [TEST]" patients
 * so every payer/serving situation can be exercised — demo patients never
 * write to Monday.
 */
import { useMemo, useState } from "react";
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
import { BENEFITS_DEMO_SCENARIOS, isDemoPatient } from "@/lib/samantha/benefitsDemo";
import { BenefitsPanel } from "@/components/samantha/BenefitsPanel";
import { BenefitsPatientHeader } from "@/components/samantha/BenefitsPatientHeader";
import { NotesPanel } from "@/components/samantha/NotesPanel";
import { PatientsSidebar } from "@/components/samantha/PatientsSidebar";
import { Button } from "@/components/ui/button";
import "@/components/samantha/benefitsRedesign.css";
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
  /** Demo scenario sandbox — a synthetic local patient; never written to Monday. */
  const [demoKey, setDemoKey] = useState<string | null>(null);
  const [demoPatient, setDemoPatient] = useState<Patient | null>(null);

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

  /** The patient the page renders: the demo sandbox when a scenario tab is
   *  active, otherwise the real Monday patient from the sidebar. */
  const active: Patient | undefined = demoPatient ?? selected;
  const demoMode = isDemoPatient(active);

  const applyPatch = (patch: Partial<Patient>) => {
    if (!active) return;
    if (demoMode) {
      setDemoPatient((prev) => (prev ? { ...prev, ...patch } : prev));
    } else {
      update(active.id, patch);
    }
  };

  const onUniversalChange = (id: "in-network" | "active" | "dme-benefits", value: UniversalChoice) => {
    if (!active) return;
    const ins = active.insurance ?? EMPTY_INSURANCE;
    applyPatch({ insurance: { ...ins, universal: { ...ins.universal, [id]: value } } });
  };

  const updateCode = (codeId: ProductCodeId, patch: Partial<ProductCodeState>) => {
    if (!active) return;
    const ins = active.insurance ?? EMPTY_INSURANCE;
    const prev = ins.codes[codeId] ?? { status: "pending" as const };
    applyPatch({
      insurance: { ...ins, codes: { ...ins.codes, [codeId]: { ...prev, ...patch } } },
    });
  };

  const updateCallLog = (section: "callsUniversal" | "callsSosAuth", rows: CallLogRow[]) => {
    if (!active) return;
    const ins = active.insurance ?? EMPTY_INSURANCE;
    applyPatch({ insurance: { ...ins, [section]: rows } });
  };

  const setScenario = (key: string | null) => {
    if (!key) {
      setDemoKey(null);
      setDemoPatient(null);
      return;
    }
    const scenario = BENEFITS_DEMO_SCENARIOS.find((s) => s.key === key);
    if (!scenario) return;
    setDemoKey(key);
    setDemoPatient(scenario.build());
  };

  const resetForNewPatient = () => {
    if (!active) return;
    if (demoMode) {
      setScenario(demoKey); // rebuild the scenario — clears all answers
      toast.success("Demo selections reset");
      return;
    }
    clearOverlay(active.id);
    update(active.id, { insurance: EMPTY_INSURANCE, notes: "" });
    toast.success("Cleared local edits — refetching from Monday");
    refetch();
  };

  const benefitsMissing = active ? validateBenefitsFactsForSubmit(active) : [];

  const handleSend = async () => {
    if (!active) return;
    if (benefitsMissing.length > 0) return;
    if (demoMode) {
      // The demo sandbox verifies derivations against the Board Output
      // drawer — nothing ever writes to Monday from a demo patient.
      toast.success("Benefit check complete — demo scenario, nothing written to Monday");
      return;
    }
    try {
      await sendPatientToMonday(active, "benefits");
      clearOverlay(active.id);
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
          onSelect={(id) => {
            setScenario(null); // leaving demo mode — back to real patients
            setSelectedId(id);
          }}
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
                  <h1 className="text-2xl font-bold">Benefits</h1>{active && (<p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">{active.name}{demoMode && <span className="inline-flex items-center rounded-full bg-sky-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Demo</span>}{active.escalated && <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Escalated</span>}</p>)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {active && !demoMode && <ClinicalsDownloadButton itemId={active.id} />}
                <Button
                  onClick={() => {
                    if (!active || demoMode) return;
                    saveOverlay(active.id);
                    toast.success("Progress saved — you can leave and come back");
                  }}
                  disabled={!active || demoMode || !hasOverlay(active.id)}
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-elevate"
                >
                  <Save className="h-4 w-4" /> Save
                </Button>
                <Button onClick={resetForNewPatient} disabled={!active} className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate">
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
                <ReportIssueButton />
              </div>
            </div>
          </header>

          <main className="flex-1 px-3 sm:px-6 py-6">
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto">
              <div className="bnr">
                {/* Demo scenario bar — testing aid, strip for production */}
                <div className="demo-bar">
                  {demoMode && <span className="demo-flag">Demo · nothing writes to Monday</span>}
                  <span className="lbl">Demo scenario</span>
                  <div className="demo-seg">
                    {BENEFITS_DEMO_SCENARIOS.map((s) => (
                      <button
                        key={s.key}
                        className={demoKey === s.key ? "on" : ""}
                        onClick={() => setScenario(demoKey === s.key ? null : s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {demoMode && (
                    <button className="reset-link" onClick={() => resetForNewPatient()}>
                      Reset selections
                    </button>
                  )}
                </div>

                {!active && (
                  <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                    <p className="text-sm text-muted-foreground">
                      {loading ? "Loading patients from Monday…" : error ? error : "Select a patient from the sidebar to begin — or pick a demo scenario above."}
                    </p>
                  </div>
                )}

                {active && (
                  <div className="layout">
                    <div className="main-col">
                      <BenefitsPatientHeader patient={active} />

                      <BenefitsPanel
                        patient={active}
                        onUniversalChange={onUniversalChange}
                        onCodeChange={updateCode}
                        onCallLogChange={updateCallLog}
                        missing={benefitsMissing}
                        onSend={handleSend}
                      />
                    </div>

                    {/* Notes rail (sticky) — append-style Reference Notes */}
                    <aside className="notes-rail" style={{ height: "auto" }}>
                      <NotesPanel
                        notes={active.notes}
                        onNotesChange={(v) => applyPatch({ notes: v })}
                        onSaveToMonday={async (v) => {
                          if (demoMode) {
                            toast.success("Demo scenario — notes not written to Monday");
                            return;
                          }
                          await writeLongText(active.id, COL.callReferenceNotes, v);
                        }}
                        placeholder="Add a call reference note…"
                        description="Shared across Benefits, Submit Auth & Auth Outstanding. Auto-escalation reasons are appended here on send."
                      />
                    </aside>
                  </div>
                )}
              </div>
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default ChaseBenefitsPage;
