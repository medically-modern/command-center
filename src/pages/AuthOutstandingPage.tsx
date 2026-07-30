/**
 * Auth Outstanding — standalone view of Samantha-checklist's "Auth
 * Outstanding" tab, rebuilt per the July 2026 redesign
 * (JOSH_HANDOFF_AUTH_OUTSTANDING.md; rules in authOutstandingReview.ts).
 *
 * The daily-check workflow: the rep clears her bucket every day — every
 * patient due today gets either a recorded result or one click of
 * "Auth Still Outstanding" (Follow Up Date → tomorrow, nothing else).
 * "Auth Review Complete" is the ONLY stage-mover, gated client-side
 * (validateAuthReviewForComplete) and server-side (mondayWrite rules).
 *
 * Deliberately ABSENT from this page (redesign §6/§7/§11):
 *   - all DVS UI (status chips, Trigger DVS buttons, "Claims Paid — Mark
 *     Supplies Complete") — moves to the dedicated DVS view
 *   - the manual Escalate button — escalation is denial-driven only
 *   - the Follow Up modal — superseded by "Auth Still Outstanding"
 */
import { useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/samantha/useMondayPatients";
import { useAutoSelectPatient } from "@/hooks/useAutoSelectPatient";
import {
  Patient,
  ProductCodeId,
  ProductCodeState,
  EMPTY_INSURANCE,
  PRODUCT_CODES,
} from "@/lib/samantha/workflow";
import { AuthOutstandingPanel } from "@/components/samantha/AuthOutstandingPanel";
import { PatientsSidebar } from "@/components/samantha/PatientsSidebar";
import { StageActionBar } from "@/components/shared/StageActionBar";
import { BenefitsPatientHeader } from "@/components/samantha/BenefitsPatientHeader";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { RotateCcw, Stethoscope, ArrowLeft, Clock, Save, Send, Loader2 } from "lucide-react";
import { resolveHcpcs, isAutoFilledMedicaidSupply } from "@/lib/samantha/hcpcRules";
import { toast } from "sonner";
import { sendPatientToMonday, saveNoAuthNeededToMonday } from "@/lib/samantha/mondayWrite";
import { daysAuthOutstanding } from "@/lib/samantha/authOutstandingDays";
import { validateAuthReviewForComplete } from "@/lib/samantha/authOutstandingReview";
import { addDaysYmd, etTodayYmd, ymdToUs } from "@/lib/samantha/benefitsDerive";
import { writeLongText, writeDate, COL } from "@/lib/samantha/mondayApi";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { SaveProgressOverlay } from "@/components/shared/SaveProgressOverlay";
import type { WriteProgressPhase } from "@/lib/shared/verifiedWrite";
import { EmptyPatientPane } from "@/components/shared/EmptyPatientPane";
import { useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { viewFilterFromParams } from "@/lib/roleView";
import { managerOriginFromParams, managerChartFromParams, managerBucketFromParams } from "@/lib/shared/managerOrigin";
import { railFilterFor, applyRail } from "@/lib/samantha/managerRail";
import { sidebarVisibleList } from "@/lib/samantha/sidebarList";

const AuthOutstandingPage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const isManager = searchParams.get("manager") === "1";
  const { patients, loading, initialLoading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay } = useMondayPatients("authOutstanding", searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );
  // Blocking save overlay (Chase Clinicals precedent): a patient switch or
  // edit while the verified send is in flight can clobber the transaction.
  const [saving, setSaving] = useState(false);
  const [savePhase, setSavePhase] = useState<WriteProgressPhase>("posting");
  const [stillSaving, setStillSaving] = useState(false);

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
      ? sidebarVisibleList(railPatients, "all", "authOutstanding", undefined, null)
      : sidebarVisibleList(patients, viewFilter, "authOutstanding", undefined, managerOrigin)),
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
    setSaving(true);
    setSavePhase("posting");
    try {
      await sendPatientToMonday(selected, "authOutstanding", { onProgress: setSavePhase });
      clearOverlay(selected.id);
      toast.success("Auth review complete — sent to Monday");
      refetch();
    } catch (e) {
      toast.error("Auth Review Complete failed", { description: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      setSaving(false);
    }
  };

  // Per-product partial save (redesign handoff §4): persist ONE product's
  // "No Auth Needed" to Monday immediately — no Stage Advancer, no
  // Escalation, nothing else. The patient stays in Auth Outstanding; the
  // rest of the review continues locally until the page-level send.
  const handleSaveNoAuthNeeded = async (codeId: ProductCodeId) => {
    if (!selected) return;
    const label = PRODUCT_CODES.find((c) => c.id === codeId)?.name ?? codeId;
    setSaving(true);
    setSavePhase("posting");
    try {
      await saveNoAuthNeededToMonday(selected, codeId, { onProgress: setSavePhase });
      toast.success(`${label} saved as No Auth Needed — stage unchanged`);
    } catch (e) {
      toast.error(`Save No Auth Needed failed (${label})`, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  // "Auth Still Outstanding" (§12) — ONE write: Follow Up Date → tomorrow.
  // No stage change, no escalation, no per-product writes. Clears the
  // patient from today's bucket; they reappear tomorrow.
  const todayEt = etTodayYmd();
  const alreadyCleared = !!selected?.followUpDate && selected.followUpDate > todayEt;
  const handleStillOutstanding = async () => {
    if (!selected || stillSaving) return;
    setStillSaving(true);
    try {
      await writeDate(selected.id, COL.followUpDate, addDaysYmd(todayEt, 1));
      toast.success(`${selected.name} — still outstanding. Cleared from today's bucket; returns tomorrow.`);
      refetch();
    } catch (e) {
      toast.error("Failed to push the follow-up date", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setStillSaving(false);
    }
  };

  // "N days outstanding" badge — live-computed from the earliest Auth
  // Submission Date, falling back to the cron-maintained board column.
  const daysOut = useMemo(
    () => (selected ? daysAuthOutstanding(selected) : null),
    [selected],
  );

  // Client-side gating for Auth Review Complete (§6). All-DVS patients CAN
  // complete — the send routes them to the DVS stage instead of Complete
  // (dvsRouting; supersedes the old "never advances" guard).
  const missing = useMemo(
    () => (selected ? validateAuthReviewForComplete(selected) : []),
    [selected],
  );
  const nonDvsCount = useMemo(() => {
    if (!selected) return 0;
    return resolveHcpcs(
      selected.primaryInsurance || null,
      selected.serving || null,
      selected.secondaryInsurance ?? null,
    ).filter((r) => !isAutoFilledMedicaidSupply(r)).length;
  }, [selected]);
  // All-DVS patients CAN complete now — the send routes them to the DVS
  // stage (dvsRouting in mondayWrite) instead of Complete.
  const canComplete = !!selected && missing.length === 0;

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      <SaveProgressOverlay open={saving} phase={savePhase} />
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar patients={railPatients} selectedId={selectedId} onSelect={setSelectedId} loading={loading} error={error} onRefresh={refetch} activeGroup="authOutstanding" managerMode={isManager} />
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
                  <h1 className="text-2xl font-bold">Auth Outstanding</h1>{selected && (<p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">{selected.name}{selected.escalated && <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">Escalated</span>}{daysOut !== null && (<span className={`inline-flex items-center gap-1 rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 ${daysOut >= 14 ? "bg-red-500 text-white" : "bg-amber-400 text-amber-950"}`}><Clock className="h-3 w-3" />{daysOut} {daysOut === 1 ? "day" : "days"} outstanding</span>)}</p>)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selected && (
                  <StageActionBar
                    stage="auth-outstanding"
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
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <EmptyPatientPane loading={loading} error={error} queueEmpty={visiblePatients.length === 0} hint="No outstanding auths are due to review right now." />
                </div>
              )}
              {selected && (
                <>
                  {/* Daily bucket: one click clears the patient until tomorrow */}
                  <div className="flex justify-end">
                    <Button
                      onClick={handleStillOutstanding}
                      disabled={stillSaving || alreadyCleared}
                      className="gap-2 bg-amber-500 hover:bg-amber-600 text-white shadow-elevate"
                    >
                      {stillSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                      {alreadyCleared
                        ? `Cleared — returns ${selected.followUpDate ? ymdToUs(selected.followUpDate) : "tomorrow"}`
                        : "Auth Still Outstanding"}
                    </Button>
                  </div>

                  {/* Same read-only header as Benefits + Submit Auth (.bnr skin) */}
                  <div className="bnr"><BenefitsPatientHeader patient={selected} /></div>
                  <AuthOutstandingPanel
                    patient={selected}
                    onCodeChange={updateCode}
                    onNotesChange={(v) => update(selected.id, { notes: v })}
                    onSaveNotesToMonday={(v) => writeLongText(selected.id, COL.callReferenceNotes, v)}
                    onSaveNoAuthNeeded={handleSaveNoAuthNeeded}
                  />

                  {/* Auth Review Complete — the ONLY stage-mover (§6) */}
                  <div className="rounded-xl bg-card border shadow-card p-5">
                    <div className="flex items-center justify-end gap-4 flex-wrap">
                      <Button
                        size="lg"
                        onClick={handleSend}
                        disabled={saving || !canComplete}
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-elevate px-7"
                      >
                        <Send className="h-4 w-4" /> Auth Review Complete
                      </Button>
                    </div>
                    {missing.length > 0 && (
                      <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-center">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-warning-foreground">
                          Needed before Auth Review Complete
                        </p>
                        <p className="text-sm text-warning-foreground/90 mt-1">{missing.join(" · ")}</p>
                      </div>
                    )}
                    {nonDvsCount === 0 && missing.length === 0 && (
                      <p className="mt-3 text-xs text-muted-foreground text-center">
                        All of this patient's products are handled at the DVS stage — completing sends them straight to DVS.
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AuthOutstandingPage;
