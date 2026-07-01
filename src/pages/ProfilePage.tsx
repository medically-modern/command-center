/**
 * Profile Send-Off — redesign face (Brandon's HTML) wrapped in the app's
 * standard chrome (navy header + PatientsSidebar), with the stepped content
 * scoped under .pf-root (see ./profile/redesign.css).
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMondayPatients } from "@/hooks/profile/useMondayPatients";
import type { Patient } from "@/lib/profile/workflow";
import {
  hasValidZip, formatPhone, crossSellReason, canCrossSellCgm, deriveServing, addressWarning,
} from "@/lib/profile/workflow";
import {
  fetchClinicLabels, fetchItemAssets, fetchUpdates,
  type MondayAsset, type MondayUpdate,
} from "@/lib/profile/mondayApi";
import {
  sendPatientToMonday, sendBackToPatientIntake, writePatientProfile,
  verifyProfileWritten, writeOopEstimate, triggerStediRun, writeProfileNotes,
} from "@/lib/profile/mondayWrite";
import { NoteLog, stampNote } from "@/components/profile/NoteLog";
import {
  suggestPrimary, suggestSecondary, buildSuggestionInputs, isCoverageActive, isNyMedicaidId,
} from "@/lib/profile/primaryInsurance";
import { computeFirstAndRecurring } from "@/lib/profile/oopEstimate";
import {
  GENERAL_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX, GENDER_INDEX,
  SERVING_INDEX, CGM_TYPE_INDEX, PUMP_TYPE_INDEX, CGM_CROSS_SELL_INDEX,
  CGM_COVERAGE_PATH_INDEX, INSULIN_PUMP_COVERAGE_PATH_INDEX,
  groupPrimaryInsuranceLabels,
} from "@/lib/profile/mondayMapping";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { DoctorSection } from "@/components/profile/DoctorSection";
import { AddressAutocomplete } from "@/components/profile/AddressAutocomplete";
import { PatientsSidebar } from "@/components/profile/PatientsSidebar";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ClipboardCheck, ArrowLeft, Save, AlertTriangle, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import "./profile/redesign.css";

const noNotServing = (labels: string[]) => labels.filter((l) => l !== "Not Serving");
const SERVING_OPTS = noNotServing(Object.keys(SERVING_INDEX));
const CGM_TYPE_OPTS = noNotServing(Object.keys(CGM_TYPE_INDEX));
const PUMP_TYPE_OPTS = noNotServing(Object.keys(PUMP_TYPE_INDEX));
const CGM_PATH_OPTS = noNotServing(Object.keys(CGM_COVERAGE_PATH_INDEX));
const IP_PATH_OPTS = noNotServing(Object.keys(INSULIN_PUMP_COVERAGE_PATH_INDEX));
const GENDER_OPTS = Object.keys(GENDER_INDEX);
const GENERAL_INS_OPTS = Object.keys(GENERAL_INSURANCE_INDEX);
const SECONDARY_OPTS = Object.keys(SECONDARY_INSURANCE_INDEX);
const PRIMARY_LABELS = new Set(groupPrimaryInsuranceLabels().flatMap((g) => g.labels));

function servingIncludes(serving: string, token: string): boolean {
  return (serving || "").toLowerCase().includes(token);
}

const ProfilePage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const {
    patients, loading, initialLoading, error, refetch,
    updateLocal, clearOverlay, removeOverlayKeys, saveOverlay, hasOverlay,
  } = useMondayPatients(searchParams.get("patientId"));

  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("patientId") ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  // Which patient a Stedi run is in-flight for (null = none). Kept per-patient
  // so switching patients while a check polls doesn't leak the spinner.
  const [stediRunningId, setStediRunningId] = useState<string | null>(null);
  const [calcOop, setCalcOop] = useState(false);
  // Completion-signal values captured the instant Run is clicked, so the
  // watcher below can tell a fresh Stedi result from a stale read-replica poll.
  const stediRunSnapshotRef = useRef({ planName: "", errorDescription: "", eligibilityActive: "" });
  const [assets, setAssets] = useState<MondayAsset[]>([]);
  const [clinicLabels, setClinicLabels] = useState<{ id: number; name: string }[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState<number | null>(null);

  useEffect(() => { fetchClinicLabels().then(setClinicLabels).catch(console.error); }, []);
  useEffect(() => { if (!selectedId && patients.length > 0) setSelectedId(patients[0].id); }, [patients, selectedId]);

  const selected: Patient | undefined = useMemo(
    () => patients.find((p) => p.id === selectedId), [patients, selectedId],
  );

  useEffect(() => {
    if (!selected) { setAssets([]); return; }
    let cancelled = false;
    fetchItemAssets(selected.id).then((a) => { if (!cancelled) setAssets(a); }).catch(() => setAssets([]));
    return () => { cancelled = true; };
  }, [selected?.id]);

  const onUpdate = useCallback((patch: Partial<Patient>) => {
    if (selected) updateLocal(selected.id, patch);
  }, [selected, updateLocal]);

  const suggestion = useMemo(() => selected ? suggestPrimary(buildSuggestionInputs(selected)) : null, [selected]);
  const secondarySuggestion = useMemo(() => selected ? suggestSecondary(buildSuggestionInputs(selected)) : "", [selected]);
  const stediActive = useMemo(() => selected ? isCoverageActive(buildSuggestionInputs(selected).stedi) : false, [selected]);

  // A Stedi run is "in flight" for the selected patient only.
  const stediRunning = !!selected && stediRunningId === selected.id;

  // Watcher — clear the running state once Monday returns a NEW terminal
  // signal (plan name / error / eligibility) that differs from the snapshot
  // taken at Run-click time. A stale-read poll returning the previous run's
  // value won't satisfy this, so the spinner stays up until the real result.
  useEffect(() => {
    if (!selected || stediRunningId !== selected.id) return;
    const complete =
      !!selected.stediPlanName || !!selected.stediErrorDescription || !!selected.stediEligibilityActive;
    if (!complete) return;
    const snap = stediRunSnapshotRef.current;
    const isNew =
      (selected.stediPlanName ?? "") !== snap.planName ||
      (selected.stediErrorDescription ?? "") !== snap.errorDescription ||
      (selected.stediEligibilityActive ?? "") !== snap.eligibilityActive;
    if (isNew) setStediRunningId(null);
  }, [selected, stediRunningId]);


  const checklist = useMemo(() => {
    if (!selected) return [] as { label: string; ok: boolean }[];
    const serv = selected.serving || "";
    const items: { label: string; ok: boolean }[] = [
      { label: "Gender", ok: !!selected.gender?.trim() },
      { label: "Phone", ok: !!selected.ptPhone?.trim() },
      { label: "Primary Insurance", ok: !!selected.primaryInsurance?.trim() },
      { label: "Member ID 1", ok: !!(selected.memberId1?.trim() || selected.workingMemberId?.trim()) },
      { label: "Secondary Insurance", ok: !!selected.secondaryInsurance?.trim() },
    ];
    if (selected.secondaryInsurance === "NY Medicaid") items.push({ label: "Member ID 2 (NY Medicaid)", ok: !!selected.memberId2?.trim() });
    items.push({ label: "Benefits verified active", ok: (selected.stediEligibilityActive || "").toLowerCase().trim() === "yes" });
    items.push({ label: "Serving", ok: !!serv.trim() });
    if (servingIncludes(serv, "cgm")) {
      items.push({ label: "CGM Type", ok: !!selected.cgmType?.trim() });
      items.push({ label: "CGM Coverage Path", ok: !!selected.cgmCoveragePath?.trim() });
    }
    if (servingIncludes(serv, "insulin pump")) {
      items.push({ label: "Pump Type", ok: !!selected.pumpType?.trim() });
      items.push({ label: "IP Coverage Path", ok: !!selected.insulinPumpCoveragePath?.trim() });
    }
    if (selected.clinicalsMethod === "Fax") items.push({ label: "Doctor Fax", ok: !!selected.doctorFax?.trim() });
    return items;
  }, [selected]);

  const missing = checklist.filter((i) => !i.ok);
  const canSubmit = missing.length === 0;

  const handleRunStedi = async () => {
    if (!selected) return;
    const workingId = (selected.workingMemberId || selected.memberId1).trim();
    if (!selected.name.trim() || !selected.dob.trim() || !selected.generalInsurance || !workingId) {
      toast.error("Fill in Name, DOB, General Insurance and Member ID first");
      return;
    }
    const runId = selected.id;
    const patient = selected;
    // Snapshot the terminal signals as they are now (before we clear them) so
    // the watcher can distinguish a fresh result from a stale read.
    stediRunSnapshotRef.current = {
      planName: patient.stediPlanName ?? "",
      errorDescription: patient.stediErrorDescription ?? "",
      eligibilityActive: patient.stediEligibilityActive ?? "",
    };
    setStediRunningId(runId);
    // Clear the terminal signals locally so the "running" card shows and the
    // prior result doesn't satisfy the completion check…
    onUpdate({ stediPlanName: "", stediErrorDescription: "", stediEligibilityActive: "" });
    // …then drop the read-only Stedi keys from the overlay so the next poll
    // renders Monday's freshly-written values instead of the blanks above.
    removeOverlayKeys(runId, [
      "stediPlanName", "stediErrorDescription", "stediEligibilityActive",
      "stediPayerName", "stediPlanBeginDate", "stediCoverageType", "stediHomePlan",
      "stediMedicaidId", "stediQmb", "stediCoinsurance",
      "stediIndividualDeductibleRemaining", "stediIndividualOopMaxRemaining",
    ]);
    try {
      // Stedi reads Name, DOB, General Insurance and the working Member ID from
      // Monday — so write the whole profile (incl. any edited name) and confirm
      // it actually landed BEFORE firing the check.
      await writePatientProfile(patient);
      let verify = { ok: false, mismatches: ["not checked"] as string[] };
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 1500));
        verify = await verifyProfileWritten(runId, {
          name: patient.name,
          dob: patient.dob,
          generalInsurance: patient.generalInsurance,
          workingMemberId: workingId,
        });
        if (verify.ok) break;
      }
      if (!verify.ok) {
        setStediRunningId((cur) => (cur === runId ? null : cur));
        toast.error("Profile didn't fully sync to Monday — Stedi not started", {
          description: verify.mismatches.join(" · "),
        });
        return;
      }
      await triggerStediRun(runId);
      toast.success("Profile saved — Stedi eligibility check triggered");
      [3000, 8000, 15000, 25000, 40000, 55000].forEach((ms) => setTimeout(() => refetch(true), ms));
      // Hard stop at 65s — never spin forever.
      setTimeout(() => {
        setStediRunningId((cur) => {
          if (cur === runId) {
            toast.error("Stedi check timed out", {
              description: "No results after 60 seconds. Check Monday for details.",
            });
            return null;
          }
          return cur;
        });
      }, 65000);
    } catch (e) {
      setStediRunningId((cur) => (cur === runId ? null : cur));
      toast.error("Failed to run Stedi", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleCalcOop = async () => {
    if (!selected) return;
    const primary = selected.primaryInsurance || suggestion?.value || "";
    if (!stediActive || !primary || !selected.serving) {
      toast.error("Need an active Stedi check, a Primary Insurance, and Serving first");
      return;
    }
    setCalcOop(true);
    try {
      const { first, recurring } = computeFirstAndRecurring({
        serving: selected.serving,
        primaryInsurance: primary,
        secondaryInsurance: selected.secondaryInsurance || secondarySuggestion || "",
        stediCoinsurance: selected.workingCoinsurance || selected.stediCoinsurance,
        deductibleRemaining: selected.workingDeductibleRemaining || selected.stediIndividualDeductibleRemaining,
        oopMaxRemaining: selected.workingOopMaxRemaining || selected.stediIndividualOopMaxRemaining,
      });
      await writeOopEstimate(selected.id, first.val, recurring.val);
      onUpdate({ oopFirst: first.val, oopRecurring: recurring.val });
      toast.success("OOP estimate calculated & saved");
    } catch (e) {
      toast.error("Failed to calculate OOP", { description: e instanceof Error ? e.message : String(e) });
    } finally { setCalcOop(false); }
  };

  const handleAdvance = async () => {
    if (!selected) return;
    if (selected.clinicAddress && !hasValidZip(selected.clinicAddress)) {
      toast.error("Clinic address must include a valid 5-digit zip code");
      return;
    }
    setSubmitting(true);
    try {
      await sendPatientToMonday(selected, selectedClinicId);
      clearOverlay(selected.id);
      toast.success(`${selected.name} advanced to MN`);
      setSelectedId(patients.find((p) => p.id !== selected.id)?.id ?? null);
      setTimeout(refetch, 1500);
    } catch (e) {
      toast.error("Failed to advance", { description: e instanceof Error ? e.message : String(e) });
    } finally { setSubmitting(false); }
  };

  const handleSendBack = async () => {
    if (!selected) return;
    setSendingBack(true);
    try {
      await sendBackToPatientIntake(selected, selectedClinicId);
      clearOverlay(selected.id);
      toast.success(`${selected.name} sent back to Patient Intake`);
      setSelectedId(patients.find((p) => p.id !== selected.id)?.id ?? null);
      setTimeout(refetch, 1500);
    } catch (e) {
      toast.error("Failed to send back", { description: e instanceof Error ? e.message : String(e) });
    } finally { setSendingBack(false); }
  };

  const openAsset = (a: MondayAsset) => {
    try { openFileViewer({ url: a.public_url || a.url, name: a.name }); }
    catch { toast.error("Could not open file"); }
  };

  const handleSave = () => {
    if (!selected) return;
    saveOverlay(selected.id);
    toast.success("Progress saved — you can leave and come back");
  };

  const handleAppendNote = useCallback(async (fullText: string) => {
    if (!selected) return;
    try {
      await writeProfileNotes(selected.id, fullText);
      updateLocal(selected.id, { notes: fullText });
      toast.success("Note added");
    } catch (e) {
      toast.error("Failed to add note", { description: e instanceof Error ? e.message : String(e) });
    }
  }, [selected, updateLocal]);

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar
          patients={patients}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); setSelectedClinicId(null); }}
          loading={loading}
          error={error}
          onRefresh={refetch}
          hasOverlay={hasOverlay}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button onClick={() => goBack()} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <ClipboardCheck className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Profile Send-Off</h1>
                  {selected && (
                    <p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">
                      {selected.name}
                      {selected.alreadyInSystem?.toLowerCase() === "yes" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">
                          <AlertTriangle className="h-3 w-3" /> Already In System
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSave}
                  disabled={!selected || !hasOverlay(selected.id)}
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-elevate"
                >
                  <Save className="h-4 w-4" /> Save
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 min-w-0">
            {!selected ? (
              <div style={{ padding: 40 }}>
                <p className="text-sm text-muted-foreground">{loading ? "Loading patients from Monday…" : error || "Select a patient to begin."}</p>
              </div>
            ) : (
              <ProfileBody
                key={selected.id}
                patient={selected}
                onUpdate={onUpdate}
                assets={assets}
                openAsset={openAsset}
                clinicLabels={clinicLabels}
                onClinicSelect={(id, name) => { setSelectedClinicId(id); onUpdate({ clinicName: name }); }}
                suggestion={suggestion}
                secondarySuggestion={secondarySuggestion}
                stediActive={stediActive}
                stediRunning={stediRunning}
                onRunStedi={handleRunStedi}
                calcOop={calcOop}
                onCalcOop={handleCalcOop}
                checklist={checklist}
                canSubmit={canSubmit}
                missing={missing.map((m) => m.label)}
                submitting={submitting}
                sendingBack={sendingBack}
                onAdvance={handleAdvance}
                onSendBack={handleSendBack}
                onAddNote={handleAppendNote}
              />
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

interface BodyProps {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  assets: MondayAsset[];
  openAsset: (a: MondayAsset) => void;
  clinicLabels: { id: number; name: string }[];
  onClinicSelect: (id: number, name: string) => void;
  suggestion: ReturnType<typeof suggestPrimary>;
  secondarySuggestion: string;
  stediActive: boolean;
  stediRunning: boolean;
  onRunStedi: () => void;
  calcOop: boolean;
  onCalcOop: () => void;
  checklist: { label: string; ok: boolean }[];
  canSubmit: boolean;
  missing: string[];
  submitting: boolean;
  sendingBack: boolean;
  onAdvance: () => void;
  onSendBack: () => void;
  onAddNote: (fullText: string) => Promise<void>;
}

function Field({ label, required, children, warn }: { label: string; required?: boolean; children: ReactNode; warn?: string }) {
  return (
    <div>
      <div className="flabel">{label} {required && <span className="req-star">*</span>}</div>
      {children}
      {warn && <div className="fwarn">{warn}</div>}
    </div>
  );
}

/** Inline referral email / Monday updates (read-only), rendered in the rail below Files. */
function RailReferral({ patient }: { patient: Patient }) {
  const [open, setOpen] = useState(false);
  const [updates, setUpdates] = useState<MondayUpdate[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch on load / patient change and auto-expand when there's referral data.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchUpdates(patient.id)
      .then((u) => { if (!cancelled) { setUpdates(u); if (u.length > 0) setOpen(true); } })
      .catch(() => { if (!cancelled) setUpdates([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patient.id]);

  return (
    <div className="rail-card">
      <div className="rail-head">✉ Referral Email</div>
      <div className="rail-body">
        <div className="kv">
          <div className="f"><div className="k">Referral Type</div><div className="v">{patient.referralType || "—"}</div></div>
          <div className="f"><div className="k">Referral Source</div><div className="v">{patient.referralSource || "—"}</div></div>
        </div>
        <button className="btn secondary sm" style={{ marginTop: 12 }} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"} referral email / updates
        </button>
        {open && (
          <div style={{ marginTop: 12 }}>
            {loading ? (
              <p className="sugg-note">Loading…</p>
            ) : updates.length === 0 ? (
              <p className="sugg-note">No referral email / updates on file.</p>
            ) : (
              <div style={{ maxHeight: "calc(100vh - 320px)", overflow: "auto" }}>
                {updates.map((u) => (
                  <div key={u.id} className="note-entry">
                    <span className="ts">[{u.created_at ? new Date(u.created_at).toLocaleString() : ""}] {u.creator?.name || ""}</span>
                    <div style={{ marginTop: 4 }} dangerouslySetInnerHTML={{ __html: u.body }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileBody(p: BodyProps) {
  const pt = p.patient;
  const serv = pt.serving || "";
  const cgm = servingIncludes(serv, "cgm");
  const ip = servingIncludes(serv, "insulin pump");
  const stediComplete = !!(pt.stediPlanName || pt.stediEligibilityActive || pt.stediErrorDescription);
  const stediFailed = !!pt.stediErrorDescription && !pt.stediPlanName;
  const [readyOpen, setReadyOpen] = useState(false);
  // Member ID 1 is always entered fresh by the rep (never auto-filled).
  const [mid1Input, setMid1Input] = useState("");
  // Benefits Check inputs: patient self-referrals already carry insurance from
  // intake, so pre-fill General Insurance + Member ID for them; every other
  // referral source starts blank for fresh rep entry. Local state (ProfileBody
  // is keyed by patient id, so it resets per patient); the rep's entry still
  // flows to Monday via onUpdate.
  const patientReferral = (pt.referralSource || "").trim().toLowerCase() === "patient";
  const [giInput, setGiInput] = useState(patientReferral ? pt.generalInsurance : "");
  const [midInput, setMidInput] = useState(patientReferral ? (pt.workingMemberId || pt.memberId1) : "");

  // ── CGM cross-sell — same auto-derivation the original ServingPanel ran ──
  // Re-derive whenever Primary Insurance or Request Type changes: eligible
  // (non-Medicaid/United/Cigna) → Cross-Sell + default Dexcom G7 on the
  // Insulin path; blocked → Couldn't Cross-Sell + Not Serving. Manual
  // "Already Serving CGM" is respected and never overwritten.
  const primaryIns = pt.primaryInsurance;
  const crossSell = pt.cgmCrossSell;
  useEffect(() => {
    if (!primaryIns) return;
    if (crossSell === "Already Serving CGM") return;
    if (canCrossSellCgm(primaryIns)) {
      if (crossSell !== "Cross-Sell") p.onUpdate({ cgmCrossSell: "Cross-Sell", cgmType: "Dexcom G7", cgmCoveragePath: "Insulin" });
    } else if (crossSell !== "Couldn't Cross-Sell") {
      p.onUpdate({ cgmCrossSell: "Couldn't Cross-Sell", cgmType: "Not Serving", cgmCoveragePath: "Not Serving" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryIns, pt.requestType]);
  // Auto-derive Serving from cross-sell + request type (original behavior).
  useEffect(() => {
    if (!crossSell || !pt.requestType) return;
    const derived = deriveServing(crossSell, pt.requestType);
    if (derived && derived !== pt.serving) p.onUpdate({ serving: derived });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossSell, pt.requestType]);
  const xsellHint = (() => {
    const reason = crossSellReason(primaryIns);
    if (crossSell === "Cross-Sell" && reason === "eligible") return "Primary insurance is a non-Medicaid plan, so this patient is eligible for CGM cross-sell";
    if (crossSell === "Couldn't Cross-Sell") {
      if (reason === "medicaid") return "Primary insurance is a Medicaid plan";
      if (reason === "united") return "Primary insurance is United, so we choose not to cross-sell United patients";
      if (reason === "cigna") return "Primary insurance is Cigna, so we choose not to cross-sell Cigna patients";
    }
    return null;
  })();

  return (
    <div className="pf-root">
      <div className="page" style={{ maxWidth: "none", paddingTop: 24 }}>
        <div className="layout">
          <div className="layout-head">
            <div className="dh lh-recv">What We Received</div>
            <div className="dh lh-work">Profile Completion</div>
          </div>

          {/* Left rail */}
          <aside className="leftrail">
            <RailReferral patient={pt} />
            <div className="rail-card">
              <div className="rail-head">📎 Files — click to preview</div>
              <div className="rail-files">
                {p.assets.length === 0 && <p className="sugg-note" style={{ padding: "6px 8px" }}>No files attached.</p>}
                {p.assets.map((a) => (
                  <div key={a.id} className="file-row" onClick={() => p.openAsset(a)}>
                    <span className="fname">{a.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="maincol">
            {/* Row 1 — demographics */}
            <div className="duo duo-stretch">
              <div className="leftcol">
                <section className="card recv-card">
                  <div className="recv-title"><h3>Patient Demographics</h3></div>
                  <div className="kv">
                    <div className="f"><div className="k">Name</div><div className="v">{pt.name}</div></div>
                    <div className="f"><div className="k">Date of Birth</div><div className="v">{pt.dob || "—"}</div></div>
                    <div className="f"><div className="k">Phone</div><div className="v">{pt.ptPhone || "—"}</div></div>
                    <div className="f"><div className="k">Email</div><div className="v">{pt.email || "—"}</div></div>
                    <div className="f"><div className="k">Gender</div><div className="v">{pt.gender || "—"}</div></div>
                    <div className="f full"><div className="k">Address</div><div className="v">{pt.patientAddress || "—"}</div></div>
                  </div>
                </section>
              </div>
              <section className="card step-card">
                <header className="step-head"><span className="step-num">1</span><h2>Demographics</h2></header>
                <div className="fgrid">
                  <Field label="Name" required><input type="text" value={pt.name} onChange={(e) => p.onUpdate({ name: e.target.value })} /></Field>
                  <Field label="DOB" required><input type="text" value={pt.dob} onChange={(e) => p.onUpdate({ dob: e.target.value })} placeholder="MM/DD/YYYY" /></Field>
                  <Field label="Phone" required><input type="text" value={pt.ptPhone} onChange={(e) => p.onUpdate({ ptPhone: formatPhone(e.target.value) })} /></Field>
                  <Field label="Email"><input type="text" value={pt.email} onChange={(e) => p.onUpdate({ email: e.target.value })} /></Field>
                  <Field label="Gender" required>
                    <select className={pt.gender ? "filled" : "need"} value={pt.gender} onChange={(e) => p.onUpdate({ gender: e.target.value })}>
                      <option value="" disabled hidden>Select…</option>
                      {GENDER_OPTS.map((g) => <option key={g}>{g}</option>)}
                    </select>
                  </Field>
                  <Field label="Address" warn={addressWarning(pt.patientAddress)}>
                    <AddressAutocomplete value={pt.patientAddress} className="pf-input"
                      onChange={(r) => p.onUpdate({ patientAddress: r.address, patientAddressLat: r.lat || null, patientAddressLng: r.lng || null })}
                      placeholder="Start typing address…" />
                  </Field>
                </div>
              </section>
            </div>

            {/* Row 2 — benefits */}
            <div className="duo">
              <div className="leftcol" />
              <section className="card step-card">
                <header className="step-head"><span className="step-num">2</span><h2>Benefits Check</h2></header>
                <div className="fgrid">
                  <Field label="General Insurance" required>
                    <select value={giInput} onChange={(e) => { setGiInput(e.target.value); p.onUpdate({ generalInsurance: e.target.value }); }}>
                      <option value="" disabled hidden>Select insurance…</option>
                      {GENERAL_INS_OPTS.map((l) => <option key={l}>{l}</option>)}
                    </select>
                  </Field>
                  <Field label="Member ID" required>
                    <input type="text" value={midInput}
                      onChange={(e) => { setMidInput(e.target.value); p.onUpdate({ workingMemberId: e.target.value }); }} placeholder="Member ID…" />
                  </Field>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
                  <button className="btn primary" onClick={p.onRunStedi} disabled={p.stediRunning}>
                    {p.stediRunning ? "Running…" : "Run Stedi Check"}
                  </button>
                </div>

                {p.stediRunning && !stediComplete && (
                  <div className="stedi-running">
                    <span className="stedi-spinner" aria-hidden />
                    <div>
                      <div className="sr-title">Saving profile &amp; running eligibility check…</div>
                      <div className="sugg-note">Name, insurance &amp; Member ID are written to Monday first, then Stedi runs. Results appear here (usually 5–15 seconds).</div>
                    </div>
                  </div>
                )}

                {/* Failure — show ONLY the failure banner, none of the outputs */}
                {!p.stediRunning && stediFailed && (
                  <div className="err-banner" style={{ marginTop: 16 }}>
                    <div className="et">Possible Stedi error — please try again</div>
                    <div className="ed">{pt.stediErrorDescription}</div>
                  </div>
                )}

                {/* Eligibility results — live from Monday's Stedi columns */}
                {!p.stediRunning && !stediFailed && (pt.stediPlanName || pt.stediEligibilityActive) && (
                  <>
                    <div className="res-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: 16 }}>
                      <ResCell label="Active?" value={pt.stediEligibilityActive} bad={!!pt.stediEligibilityActive && !p.stediActive} />
                      <ResCell label="Payer Name" value={pt.stediPayerName} />
                      <ResCell label="Plan Begin Date" value={pt.stediPlanBeginDate} />
                    </div>
                    <div className="res-grid" style={{ gridTemplateColumns: `repeat(${pt.stediQmb ? 5 : 4},1fr)`, marginTop: 10 }}>
                      <ResCell label="Coverage Type" value={pt.stediCoverageType} />
                      <ResCell label="Plan Name" value={pt.stediPlanName} />
                      <ResCell label="Home Plan" value={pt.stediHomePlan} />
                      <ResCell label="Medicaid ID" value={isNyMedicaidId(pt.stediMedicaidId) ? pt.stediMedicaidId : ""} />
                      {pt.stediQmb && <ResCell label="QMB?" value={pt.stediQmb} />}
                    </div>
                  </>
                )}

                {/* Cost Sharing — read-only, live from Monday */}
                {!p.stediRunning && !stediFailed && (pt.stediPlanName || pt.stediEligibilityActive) && <CostShare pt={pt} />}

                {/* Enter correct insurance information */}
                {!p.stediRunning && !stediFailed && (pt.stediPlanName || pt.stediEligibilityActive) && (
                  <div id="post-stedi" style={{ marginTop: 22, border: "1.5px solid var(--amber-ring)", borderRadius: 12, background: "oklch(0.96 0.04 90 / 0.35)", padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                      <span style={{ display: "grid", placeItems: "center", height: 26, width: 26, borderRadius: "50%", fontSize: ".8rem", fontWeight: 800, background: "var(--amber)", color: "#fff" }}>!</span>
                      <span style={{ fontSize: "1rem", fontWeight: 800, color: "oklch(0.4 0.1 75)" }}>Enter correct insurance information <span className="req-star">*</span></span>
                    </div>
                    <div className="fgrid">
                      <Field label="Primary Insurance" required>
                        <select className={pt.primaryInsurance ? "filled" : "need"} value={pt.primaryInsurance} onChange={(e) => p.onUpdate({ primaryInsurance: e.target.value })}>
                          <option value="" disabled hidden>Select…</option>
                          {groupPrimaryInsuranceLabels().map(({ group, labels }) => (
                            <optgroup key={group} label={group}>{labels.map((l) => <option key={l}>{l}</option>)}</optgroup>
                          ))}
                        </select>
                        <SuggestionInline sg={p.suggestion} />
                      </Field>
                      <Field label="Member ID 1" required>
                        <input type="text" value={mid1Input}
                          onChange={(e) => { setMid1Input(e.target.value); p.onUpdate({ memberId1: e.target.value }); }} placeholder="Member ID…" />
                      </Field>
                      <Field label="Secondary Insurance" required>
                        <select className={pt.secondaryInsurance ? "filled" : "need"} value={pt.secondaryInsurance} onChange={(e) => p.onUpdate({ secondaryInsurance: e.target.value })}>
                          <option value="" disabled hidden>Select…</option>
                          {SECONDARY_OPTS.map((l) => <option key={l}>{l}</option>)}
                        </select>
                        {p.secondarySuggestion && (
                          <div className="sugg-line" style={{ marginTop: 8 }}>
                            <span className="sugg-lead2">Suggestion:</span>
                            <span className="sugg-chip2">{p.secondarySuggestion}</span>
                          </div>
                        )}
                      </Field>
                      <Field label={pt.secondaryInsurance === "NY Medicaid" ? "Member ID 2 (required)" : "Member ID 2"}>
                        <input type="text" value={pt.memberId2} onChange={(e) => p.onUpdate({ memberId2: e.target.value })} placeholder="Member ID… (optional)" />
                      </Field>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Row 3 — serving + OOP */}
            <div className="duo duo-stretch">
              <section className="card recv-card">
                <div className="recv-title"><h3>Initial Request</h3></div>
                <div className="kv">
                  <div className="f"><div className="k">Request Type</div><div className="v">{pt.requestType || "—"}</div></div>
                  <div className="f"><div className="k">CGM Type (provided)</div><div className="v">{pt.cgmType || "—"}</div></div>
                  <div className="f"><div className="k">Pump Type (provided)</div><div className="v">{pt.pumpType || "—"}</div></div>
                  <div className="f full"><div className="k">Referral Source</div><div className="v">{pt.referralSource || "—"}</div></div>
                </div>
              </section>
              <div className="work-col">
                <section className="card step-card">
                  <header className="step-head"><span className="step-num">3</span><h2>Serving &amp; Coverage</h2></header>
                  <div className="fgrid">
                    <div className="full">
                      <Field label="Serving" required>
                        <select className={serv ? "filled" : "need"} value={serv} onChange={(e) => p.onUpdate({ serving: e.target.value })}>
                          <option value="" disabled hidden>Select what we're serving…</option>
                          {SERVING_OPTS.map((l) => <option key={l}>{l}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div className="full">
                      <Field label="CGM Cross-Sell Status" required>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <select style={{ flex: 1 }} className={crossSell ? "filled" : "need"} value={crossSell} onChange={(e) => p.onUpdate({ cgmCrossSell: e.target.value })}>
                            <option value="" disabled hidden>Select…</option>
                            {Object.keys(CGM_CROSS_SELL_INDEX).map((l) => <option key={l}>{l}</option>)}
                          </select>
                          {crossSell && (
                            <span className={`method-pill ${crossSell === "Cross-Sell" ? "chute" : crossSell === "Couldn't Cross-Sell" ? "fax" : "mail"}`} style={{ marginTop: 0, flexShrink: 0 }}>
                              {crossSell}
                            </span>
                          )}
                        </div>
                        {xsellHint && <div className="sugg-note" style={{ marginTop: 6 }}>{xsellHint}</div>}
                        {crossSell === "Evaluate" && !primaryIns && (
                          <div className="sugg-note" style={{ marginTop: 6 }}>Set Primary Insurance in Benefits Check to auto-evaluate cross-sell eligibility</div>
                        )}
                      </Field>
                    </div>
                    {cgm && <Field label="CGM Type" required><select value={pt.cgmType} onChange={(e) => p.onUpdate({ cgmType: e.target.value })}><option value="" disabled hidden>Select…</option>{CGM_TYPE_OPTS.map((l) => <option key={l}>{l}</option>)}</select></Field>}
                    {ip && <Field label="Pump Type" required><select value={pt.pumpType} onChange={(e) => p.onUpdate({ pumpType: e.target.value })}><option value="" disabled hidden>Select…</option>{PUMP_TYPE_OPTS.map((l) => <option key={l}>{l}</option>)}</select></Field>}
                    {cgm && <Field label="CGM Coverage Path" required><select value={pt.cgmCoveragePath} onChange={(e) => p.onUpdate({ cgmCoveragePath: e.target.value })}><option value="" disabled hidden>Select…</option>{CGM_PATH_OPTS.map((l) => <option key={l}>{l}</option>)}</select></Field>}
                    {ip && <Field label="Insulin Pump Coverage Path" required><select value={pt.insulinPumpCoveragePath} onChange={(e) => p.onUpdate({ insulinPumpCoveragePath: e.target.value })}><option value="" disabled hidden>Select…</option>{IP_PATH_OPTS.map((l) => <option key={l}>{l}</option>)}</select></Field>}
                  </div>
                </section>
                <section className="card step-card">
                  <header className="step-head"><h2 style={{ margin: 0 }}>Out-of-Pocket Estimate</h2></header>
                  <button className="btn primary" onClick={p.onCalcOop} disabled={p.calcOop}>{p.calcOop ? "Calculating…" : "Calculate OOP Estimate"}</button>
                  {/carecentrix/i.test(pt.referralSource || "") && (
                    <div className="warn-banner" style={{ marginTop: 12 }}><span><b>CareCentrix referral</b> — confirm the final out-of-pocket with CareCentrix directly.</span></div>
                  )}
                  {(pt.oopFirst || pt.oopRecurring) && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
                      <div className="rcell" style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}>
                        <div className="rl">First Order</div>
                        <div className="rv set" style={{ fontSize: "1.4rem" }}>{pt.oopFirst || "—"}</div>
                        {ip && <div className="rl" style={{ marginTop: 4, textTransform: "none", letterSpacing: 0, color: "var(--mm-teal)", fontWeight: 700 }}>Includes Pump</div>}
                      </div>
                      <div className="rcell" style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}><div className="rl">Recurring · 90-day</div><div className="rv set" style={{ fontSize: "1.4rem" }}>{pt.oopRecurring || "—"}</div></div>
                    </div>
                  )}
                </section>
              </div>
            </div>

            {/* Row 4 — doctor */}
            <div className="duo">
              <section className="card recv-card">
                <div className="recv-title"><h3>Provided Doctor Info</h3></div>
                <div className="kv">
                  <div className="f"><div className="k">Doctor Name</div><div className="v">{pt.doctorName || "—"}</div></div>
                  <div className="f"><div className="k">Clinic Phone</div><div className="v">{pt.doctorPhone || "—"}</div></div>
                  <div className="f full"><div className="k">Clinic Address</div><div className="v">{pt.clinicAddress || "—"}</div></div>
                </div>
              </section>
              <div className="work-col">
                <section className="card step-card">
                  <header className="step-head"><span className="step-num">4</span><h2>Select Correct Provider</h2></header>
                  <DoctorSection patient={pt} onUpdate={p.onUpdate} clinicLabels={p.clinicLabels} onClinicSelect={p.onClinicSelect} />
                </section>
              </div>
            </div>

            {/* Row 5 — notes */}
            <div className="duo"><div className="leftcol" />
              <section className="card step-card">
                <header className="step-head"><span className="step-num">5</span><h2>Notes</h2></header>
                <NotesComposer notes={pt.notes} onAppend={p.onAddNote} />
              </section>
            </div>

            {/* Row 6 — ready to send off */}
            <div className="duo"><div className="leftcol" />
              <section className="card" style={{ borderLeft: "4px solid var(--mm-teal)" }}>
                <header className="step-head clickable" style={{ marginBottom: 0 }} onClick={() => setReadyOpen((o) => !o)} aria-expanded={readyOpen}>
                  <span className="step-num">6</span><h2>Ready to Send Off?</h2>
                  {p.canSubmit ? <span className="mp green">Ready</span> : <span className="mp">{p.missing.length} missing</span>}
                  <div className="right"><ChevronDown className={`chev ${readyOpen ? "open" : ""}`} width={22} height={22} /></div>
                </header>
                {readyOpen && (
                  <div>
                    <div style={{ height: 16 }} />
                    <div id="checklist">
                      {p.checklist.map((it) => (
                        <div key={it.label} className={`ci ${it.ok ? "done" : ""}`}>
                          <span className="cb">{it.ok ? "✓" : "✕"}</span><span>{it.label}</span>
                          <span className="ctag">{it.ok ? "ok" : "missing"}</span>
                        </div>
                      ))}
                    </div>
                    <div className="miss-pills">
                      {p.missing.length
                        ? p.missing.map((m) => <span key={m} className="mp">{m}</span>)
                        : <span className="mp green">Nothing outstanding — ready to advance</span>}
                    </div>
                  </div>
                )}
                <div className="route-grid">
                  <div className={`route adv ${p.canSubmit ? "on" : ""}`}>
                    <h4>Advance to MN</h4>
                    <p>Everything checks out → save to Monday and move to Medical Necessity.</p>
                    <button className="btn primary" onClick={p.onAdvance} disabled={!p.canSubmit || p.submitting || p.sendingBack}>
                      {p.submitting ? "Advancing…" : "Advance to MN →"}
                    </button>
                  </div>
                  <div className="route intake on">
                    <h4>Send back to Patient Intake</h4>
                    <p>Still missing info → move back to Patient Intake.</p>
                    <button className="btn amber" onClick={p.onSendBack} disabled={p.submitting || p.sendingBack}>
                      {p.sendingBack ? "Sending…" : "Send back to Patient Intake"}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

/** Patient notes as an append-only log (date · stage bold, signed w/ initials),
 *  mirroring the Evaluate role. Each add stamps + persists to Monday. */
function NotesComposer({ notes, onAppend }: { notes: string; onAppend: (full: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const add = async () => {
    if (!draft.trim() || adding) return;
    setAdding(true);
    try { await onAppend(stampNote(notes, draft)); setDraft(""); }
    finally { setAdding(false); }
  };
  return (
    <>
      {notes ? <NoteLog text={notes} /> : <span className="sugg-note">No notes yet.</span>}
      <div className="note-add">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note…" />
        <button className="btn primary sm" onClick={add} disabled={!draft.trim() || adding}>{adding ? "Adding…" : "+ Add"}</button>
      </div>
    </>
  );
}

function ResCell({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rcell">
      <div className="rl">{label}</div>
      <div className={`rv ${value ? "set" : ""} ${bad ? "bad" : ""}`}>{value || "—"}</div>
    </div>
  );
}

/** Prototype's fmtPct/fmtUsd — display-only formatting of Stedi cost values. */
function fmtPct(x: string): string {
  if (x == null || x === "") return "—";
  const n = Number(String(x).replace(/[^0-9.-]/g, ""));
  if (isNaN(n)) return String(x);
  const p = n <= 1 ? n * 100 : n;
  return `${Math.round(p * 10) / 10}%`;
}
function fmtUsd(x: string): string {
  if (x == null || x === "") return "—";
  const n = Number(String(x).replace(/[^0-9.-]/g, ""));
  if (isNaN(n)) return String(x);
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Cost Sharing — read-only, live from Monday's Stedi columns, with an
 *  Individual/Family toggle (mirrors the prototype's #cost-share block). */
function CostShare({ pt }: { pt: Patient }) {
  const [level, setLevel] = useState<"individual" | "family">("individual");
  const ded = level === "family" ? pt.stediFamilyDeductibleRemaining : pt.stediIndividualDeductibleRemaining;
  const oop = level === "family" ? pt.stediFamilyOopMaxRemaining : pt.stediIndividualOopMaxRemaining;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
        <span className="flabel" style={{ margin: 0 }}>Cost Sharing</span>
        <span className="seg-mini">
          <button className={level === "individual" ? "on" : ""} onClick={() => setLevel("individual")}>Individual</button>
          <button className={level === "family" ? "on" : ""} onClick={() => setLevel("family")}>Family</button>
        </span>
      </div>
      <div className="res-grid" style={{ marginTop: 12, gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="rcell"><div className="rl">Co-insurance</div><div className="rv set">{fmtPct(pt.stediCoinsurance)}</div></div>
        <div className="rcell"><div className="rl">Co-pay</div><div className="rv set">{fmtUsd(pt.stediCopay)}</div></div>
        <div className="rcell"><div className="rl">Deductible Remaining</div><div className="rv set">{fmtUsd(ded)}</div></div>
        <div className="rcell"><div className="rl">OOP Max Remaining</div><div className="rv set">{fmtUsd(oop)}</div></div>
      </div>
    </>
  );
}

/** Primary-insurance suggestion shown BELOW the Primary select (mirrors the
 *  prototype's #pins-suggest / suggestionCardHTML). Advisory only — the rep
 *  selects the insurance manually. */
function SuggestionInline({ sg }: { sg: ReturnType<typeof suggestPrimary> }) {
  if (!sg) return null;
  const codes = (sg.warnings || []).map((w) => w.code);
  if (codes.includes("INACTIVE")) {
    return (
      <div className="sugg-line" style={{ marginTop: 8 }}>
        <span className="sugg-chip2" style={{ background: "#fdecef", color: "var(--mm-rose)", boxShadow: "inset 0 0 0 1px var(--mm-rose)" }}>No suggestion</span>
        <span className="sugg-note" style={{ color: "var(--mm-rose)", fontWeight: 600 }}>coverage came back INACTIVE — verify before selecting a Primary Insurance</span>
      </div>
    );
  }
  if (!sg.value && codes.includes("ADDRESS_UNRESOLVED")) {
    return (
      <div className="sugg-line" style={{ marginTop: 8 }}>
        <span className="sugg-chip2 muted">No suggestion</span>
        <span className="sugg-note">patient address is missing</span>
      </div>
    );
  }
  const SKIP: Record<string, number> = { ADDRESS_UNRESOLVED: 1, POS_11: 1, OUT_OF_STATE: 1 };
  return (
    <>
      {sg.value ? (
        <div className="sugg-line" style={{ marginTop: 8 }}>
          <span className="sugg-lead2">Suggestion:</span>
          <span className="sugg-chip2">{sg.value}</span>
          {sg.pos === "11" && <span className="sugg-chip2 office">{sg.posReason || "POS 11"}</span>}
        </div>
      ) : sg.reason ? (
        <div className="sugg-line" style={{ marginTop: 8 }}>
          <span className="sugg-chip2 muted">Check card</span>
          <span className="sugg-note">{sg.reason}</span>
        </div>
      ) : null}
      {sg.alternatives?.length > 0 && (
        <div className="sugg-line">{sg.alternatives.map((a) => <span key={a} className="sugg-chip2 alt2">{a}</span>)}</div>
      )}
      {(sg.warnings || []).filter((w) => !SKIP[w.code]).map((w, i) => (
        <div key={i} className="sugg-caveat"><AlertTriangle className="h-3.5 w-3.5" />{w.message}</div>
      ))}
    </>
  );
}

export default ProfilePage;
