/**
 * Submit Auth — the redesigned single-step auth-submission tab
 * (HANDOFF-Josh-Submit-Auth.md + submit-auth-redesign.html, July 2026).
 *
 * Kept from the old page: the patients sidebar, the navy top bar (Save /
 * Reset / Report Issue + Clinicals), the 30s poll + local overlay
 * machinery, deep links.
 *
 * Changed per the handoff: the editable PatientProfileCard is replaced by
 * the read-only BenefitsPatientHeader (§8 — header is fed by Profile
 * Send-Off); the Carecentrix modifier table is replaced by per-card
 * modifier chips + a one-line banner (§4); the Trigger DVS buttons are
 * gone (DVS moves to its own stage, §10); SoS UI is gone (§3); sends are
 * gated on every card having Method + Date (+ number for Call/Fax, §7);
 * Reference Notes move to the sticky rail (Benefits pattern).
 *
 * Removed 2026-07-20 (Josh): the Follow Up button + modal and the
 * Escalate button + form. Follow-up is automatic — the send stamps
 * Follow Up Date = today. (The sidebar's per-patient "+1d" snooze was
 * later removed from Submit Auth too, 2026-07; it remains on Auth
 * Outstanding.)
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
import { validateSubmitAuthForSubmit, submitAuthCards, productCodeId } from "@/lib/samantha/submitAuthRules";
import { AuthorizationsPanel } from "@/components/samantha/AuthorizationsPanel";
import { AuthFaxPanel } from "@/components/samantha/AuthFaxPanel";
import { BenefitsPatientHeader } from "@/components/samantha/BenefitsPatientHeader";
import { NotesPanel } from "@/components/samantha/NotesPanel";
import { PatientsSidebar } from "@/components/samantha/PatientsSidebar";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, Stethoscope, ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { sendPatientToMonday } from "@/lib/samantha/mondayWrite";
import { writeLongText, COL } from "@/lib/samantha/mondayApi";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import type { WriteProgressPhase } from "@/lib/shared/verifiedWrite";
import { EmptyPatientPane } from "@/components/shared/EmptyPatientPane";
import { useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { ClinicalsDownloadButton } from "@/components/samantha/ClinicalsDownloadButton";
import { StageActionBar } from "@/components/shared/StageActionBar";
import { viewFilterFromParams } from "@/lib/roleView";
import { managerOriginFromParams, managerChartFromParams, managerBucketFromParams } from "@/lib/shared/managerOrigin";
import { railFilterFor, applyRail } from "@/lib/samantha/managerRail";
import { sidebarVisibleList } from "@/lib/samantha/sidebarList";
import { cn } from "@/lib/utils";
import "@/components/samantha/benefitsRedesign.css";
import "@/components/samantha/submitAuthRedesign.css";

const SubmitAuthPage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const isManager = searchParams.get("manager") === "1";
  const { patients, loading, initialLoading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay } =
    useMondayPatients("submitAuth", searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );
  /** Patient just sent successfully — suppress the panel until the board
   *  automation moves them off this list (same pattern as Benefits). */
  const [lastSentId, setLastSentId] = useState<string | null>(null);
  // Blocking save overlay (Chase Clinicals precedent): a patient switch or
  // edit while the verified send is in flight can clobber the transaction.
  const [saving, setSaving] = useState(false);
  const [savePhase, setSavePhase] = useState<WriteProgressPhase>("posting");

  // Auto-select the first patient the sidebar actually shows (same list math
  // as PatientsSidebar), never from the pre-fetch localStorage cache.
  const viewFilter = viewFilterFromParams(searchParams);
  const managerOrigin = managerOriginFromParams(searchParams);
  // Opened from an oversight bar: narrow the list to that bar's patients so
  // the sidebar matches the chart the manager clicked (lib/samantha/managerRail).
  const rail = useMemo(
    () => railFilterFor(managerChartFromParams(searchParams), managerBucketFromParams(searchParams)),
    [searchParams],
  );
  const railPatients = useMemo(
    () => applyRail(patients, rail, searchParams.get("patientId")),
    [patients, rail, searchParams],
  );
  const visiblePatients = useMemo(
    () => (rail
      ? sidebarVisibleList(railPatients, "all", "submitAuth", undefined, null)
      : sidebarVisibleList(patients, viewFilter, "submitAuth", undefined, managerOrigin)),
    [patients, railPatients, rail, viewFilter, managerOrigin],
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
    update(selected.id, {
      insurance: { ...ins, codes: { ...ins.codes, [codeId]: { ...prev, ...patch } } },
    });
  };

  const resetForNewPatient = () => {
    if (!selected) return;
    clearOverlay(selected.id);
    update(selected.id, { insurance: EMPTY_INSURANCE, notes: "" });
    toast.success("Cleared local edits — refetching from Monday");
    refetch();
  };

  const missing = selected ? validateSubmitAuthForSubmit(selected) : [];

  // "Fax to Payer" tab — shown only when a product's Auth Submission Method is
  // Fax. Send-only (no record/advance); the rep still submits from the
  // Authorizations tab.
  const [authTab, setAuthTab] = useState<"authorizations" | "fax">("authorizations");
  const hasFaxProduct = useMemo(() => {
    if (!selected) return false;
    const ins = selected.insurance ?? EMPTY_INSURANCE;
    return submitAuthCards(selected).some(
      (r) => ins.codes[productCodeId(r.product)]?.authSubmissionMethod === "Fax",
    );
  }, [selected]);
  const activeTab = hasFaxProduct ? authTab : "authorizations";

  const handleSend = async () => {
    if (!selected) return;
    if (missing.length > 0) return;
    setSaving(true);
    setSavePhase("posting");
    try {
      await sendPatientToMonday(selected, "submitAuth", { onProgress: setSavePhase });
      clearOverlay(selected.id);
      setLastSentId(selected.id);
      toast.success("Auth submission complete — sent to Monday");
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
          patients={railPatients}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          error={error}
          onRefresh={refetch}
          activeGroup="submitAuth"
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
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · Authorization</p>
                  <h1 className="text-2xl font-bold">Submit Auth</h1>{selected && (<p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">{selected.name}{selected.escalated && <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Escalated</span>}</p>)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selected && <ClinicalsDownloadButton itemId={selected.id} />}
                {selected && (
                  <StageActionBar
                    stage="submit-auth"
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
                    <EmptyPatientPane loading={loading} error={error} queueEmpty={visiblePatients.length === 0} hint="No auths are due to submit right now." />
                  </div>
                )}

                {selected && (
                  <div className="layout">
                    <div className="main-col">
                      <BenefitsPatientHeader patient={selected} />

                      {selected.id === lastSentId ? (
                        <section className="card step-card">
                          <div className="empty-box">
                            <p>✓ Auth submission complete — sent to Monday</p>
                          </div>
                        </section>
                      ) : (
                        <>
                          {hasFaxProduct && (
                            <div className="flex gap-1 p-1 rounded-lg bg-muted w-fit" role="tablist" aria-label="Submit Auth view">
                              {(["authorizations", "fax"] as const).map((t) => (
                                <button
                                  key={t}
                                  role="tab"
                                  aria-selected={activeTab === t}
                                  onClick={() => setAuthTab(t)}
                                  className={cn(
                                    "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                                    activeTab === t
                                      ? "bg-background shadow text-foreground"
                                      : "text-muted-foreground hover:text-foreground",
                                  )}
                                >
                                  {t === "authorizations" ? "Authorizations" : "Fax to Payer"}
                                </button>
                              ))}
                            </div>
                          )}
                          {activeTab === "fax" ? (
                            <AuthFaxPanel key={selected.id} patient={selected} />
                          ) : (
                            <AuthorizationsPanel
                              patient={selected}
                              onCodeChange={updateCode}
                              onIntakeIdChange={(v) => update(selected.id, { carecentrixIntakeId: v })}
                              missing={missing}
                              onSend={handleSend}
                            />
                          )}
                        </>
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
                        notePrefix="Submit Auth"
                        placeholder="Auth submission notes, confirmation numbers, any rep feedback…"
                        description="Carries over from the Benefits tab. Add anything new from the auth submission step."
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

export default SubmitAuthPage;
