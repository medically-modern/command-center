/**
 * Chase Benefits — the redesigned Benefits tab (Brandon's July 2026 handoff;
 * JOSH_HANDOFF_BENEFITS.md + BENEFITS_REDESIGN_REVIEW.md, decisions D1–D10).
 *
 * Kept from the old page: the patients sidebar, the top bar (Clinicals /
 * Save / Reset / Report Issue), the 30s poll + local overlay machinery,
 * deep links, and the append-style Reference Notes panel (full-height rail).
 *
 * Removed on purpose: the Follow Up button (D-decision — SubmitAuth/Auth
 * Outstanding keep theirs; existing follow-ups stay clearable from the
 * sidebar), the Escalate button + modal (escalation is DERIVED on send,
 * spec §5), the Trigger DVS buttons (D3 — DVS moves to its own stage), the
 * "edits stay local" strip, every header edit control (read-only, §6), and
 * the demo scenario bar (verified 2026-07-16, then removed per Josh — the
 * Monday Board Output drawer remains the testing aid until production).
 */
import { useEffect, useMemo, useState } from "react";
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
import { anyUniversalNegative, validateBenefitsFactsForSubmit } from "@/lib/samantha/benefitsDerive";
import { isMedicareABOnly } from "@/lib/samantha/medicareJurisdiction";
import { BenefitsPanel } from "@/components/samantha/BenefitsPanel";
import { BenefitsPatientHeader } from "@/components/samantha/BenefitsPatientHeader";
import { NotesPanel } from "@/components/samantha/NotesPanel";
import { PatientsSidebar } from "@/components/samantha/PatientsSidebar";
import { Button } from "@/components/ui/button";
import "@/components/samantha/benefitsRedesign.css";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, Stethoscope, ArrowLeft, Save } from "lucide-react";
import { ClinicalsDownloadButton } from "@/components/samantha/ClinicalsDownloadButton";
import { StageActionBar } from "@/components/shared/StageActionBar";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/samantha/mondayWrite";
import { writeLongText, COL } from "@/lib/samantha/mondayApi";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import type { WriteProgressPhase } from "@/lib/shared/verifiedWrite";
import { useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { viewFilterFromParams } from "@/lib/roleView";
import { managerOriginFromParams } from "@/lib/shared/managerOrigin";
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
  /** Patient just sent successfully. Suppresses the panel until the board
   *  automation moves them off the list — otherwise the overlay clear makes
   *  the checks/auths re-hydrate blank (they aren't readable on the Benefits
   *  group) and the "Missing before send" box would flash misleadingly. */
  const [lastSentId, setLastSentId] = useState<string | null>(null);
  // Blocking save overlay (Chase Clinicals precedent): a patient switch or
  // edit while the verified send is in flight can clobber the transaction.
  const [saving, setSaving] = useState(false);
  const [savePhase, setSavePhase] = useState<WriteProgressPhase>("posting");

  // Auto-select the first patient the sidebar actually shows (same list math
  // as PatientsSidebar), never from the pre-fetch localStorage cache.
  const viewFilter = viewFilterFromParams(searchParams);
  const managerOrigin = managerOriginFromParams(searchParams);
  const visiblePatients = useMemo(
    () => sidebarVisibleList(patients, viewFilter, "benefits", undefined, managerOrigin),
    [patients, viewFilter, managerOrigin],
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

  // Handoff §1: "Medicare not Primary" only exists for Medicare A&B-only
  // patients. The payer can change under us (the header is read-only here —
  // primary/secondary arrive via the 30s poll), so a lingering answer is
  // cleared back to unanswered; Monday must never receive this value for a
  // non-Medicare-A&B patient.
  const selInNetwork = selected?.insurance?.universal["in-network"];
  useEffect(() => {
    if (!selected || selInNetwork !== "medicare-not-primary") return;
    if (!isMedicareABOnly(selected.primaryInsurance ?? "", selected.secondaryInsurance ?? "")) {
      const ins = selected.insurance ?? EMPTY_INSURANCE;
      update(selected.id, {
        insurance: { ...ins, universal: { ...ins.universal, "in-network": "" } },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.primaryInsurance, selected?.secondaryInsurance, selInNetwork]);

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
    // Failed-check path (handoff §3–§4): the patient STAYS at Benefits —
    // no automation moves them, so keep the local answers visible (no
    // overlay clear / success takeover card); the sidebar refetch moves
    // them into the Escalated section instead.
    const gatedSend = anyUniversalNegative(selected.insurance ?? EMPTY_INSURANCE);
    setSaving(true);
    setSavePhase("posting");
    try {
      await sendPatientToMonday(selected, "benefits", { onProgress: setSavePhase });
      if (gatedSend) {
        toast.success("Submitted — escalation set on Monday");
      } else {
        clearOverlay(selected.id);
        setLastSentId(selected.id);
        toast.success("Benefit check complete — sent to Monday");
      }
      refetch(true);
    } catch (e) {
      toast.error("Send to Monday failed", { description: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      <SaveProgressOverlay open={saving} phase={savePhase} />
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
                {selected && (
                  <StageActionBar
                    stage="benefits"
                    board="insurance"
                    patientId={selected.id}
                    patientName={selected.name}
                    onDone={() => refetch(true)}
                  />
                )}
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
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto">
              <div className="bnr">
                {!selected && (
                  <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                    <p className="text-sm text-muted-foreground">
                      {loading ? "Loading patients from Monday…" : error ? error : "Select a patient from the sidebar to begin."}
                    </p>
                  </div>
                )}

                {selected && (
                  <div className="layout">
                    <div className="main-col">
                      <BenefitsPatientHeader patient={selected} />

                      {selected.id === lastSentId ? (
                        <section className="card step-card">
                          <div className="empty-box">
                            <p>✓ Benefit check complete — sent to Monday</p>
                            <p className="sub">
                              The board automation is moving this patient to their next stage;
                              they'll drop off this list within a minute. Pick the next patient
                              from the sidebar.
                            </p>
                          </div>
                        </section>
                      ) : (
                        <BenefitsPanel
                          patient={selected}
                          onUniversalChange={onUniversalChange}
                          onCodeChange={updateCode}
                          onCallLogChange={updateCallLog}
                          missing={benefitsMissing}
                          onSend={handleSend}
                        />
                      )}
                    </div>

                    {/* Notes rail (sticky, full viewport height) */}
                    <aside className="notes-rail">
                      <NotesPanel
                        notes={selected.notes}
                        profileSendOffNotes={selected.profileSendOffNotes}
                        mnWorkflowNotes={selected.mnWorkflowNotes}
                        onNotesChange={(v) => update(selected.id, { notes: v })}
                        onSaveToMonday={async (v) => {
                          await writeLongText(selected.id, COL.callReferenceNotes, v);
                        }}
                        notePrefix="Benefits"
                        placeholder="Add a call reference note…"
                        description="Shared across Benefits, Submit Auth & Auth Outstanding. Auto-escalation reasons are appended here on send."
                        fillHeight
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
