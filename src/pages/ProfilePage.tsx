/**
 * Profile Send-Off — redesign face (Brandon's HTML) wrapped in the app's
 * standard chrome (navy header + PatientsSidebar), with the stepped content
 * scoped under .pf-root (see ./profile/redesign.css).
 *
 * Serves TWO roles off the same board/group (July 2026): Verified Referrals
 * (/profile) and Unverified Referrals (/unverified-referrals), split by
 * Referral Type/Source — see the `variant` prop + lib/profile/referralSplit.ts.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMondayPatients } from "@/hooks/profile/useMondayPatients";
import { useAutoSelectPatient } from "@/hooks/useAutoSelectPatient";
import { isUnverifiedReferral } from "@/lib/profile/referralSplit";
import { sidebarVisibleList } from "@/lib/profile/sidebarList";
import { viewFilterFromParams } from "@/lib/roleView";
import type { Patient } from "@/lib/profile/workflow";
import {
  hasValidZip, formatPhone, crossSellReason, canCrossSellCgm, deriveServing, addressWarning,
  titleCaseName, titleCaseAddress, normalizeEmailCase,
} from "@/lib/profile/workflow";
import {
  fetchClinicLabels, fetchItemAssets, fetchUpdates, createUpdate,
  type MondayAsset, type MondayUpdate,
} from "@/lib/profile/mondayApi";
import {
  sendPatientToMonday, sendBackToPatientIntake, writePatientProfile,
  verifyProfileWritten, writeOopEstimate, triggerStediRun, writeProfileNotes,
} from "@/lib/profile/mondayWrite";
import { NoteLog, stampNote } from "@/components/profile/NoteLog";
import {
  suggestPrimary, suggestSecondary, buildSuggestionInputs, isCoverageActive, isNyMedicaidId,
  managedMedicaidMco, primaryPayerMismatch, truthy,
} from "@/lib/profile/primaryInsurance";
import { computeFirstAndRecurring } from "@/lib/profile/oopEstimate";
import { interpretStediError } from "@/lib/profile/stediErrors";
import {
  GENERAL_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX, GENDER_INDEX,
  SERVING_INDEX, CGM_TYPE_INDEX, PUMP_TYPE_INDEX,
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
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
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

// ── Stedi run detection ──────────────────────────────────────────────────────
// The Stedi service writes its ~16 result columns to Monday ONE AT A TIME
// (~1/sec over 15–25s — confirmed in the board activity log), so there is no
// single "done" column to key on. Instead we fingerprint EVERY Stedi column
// and only reveal results once the whole set has gone quiet across polls —
// everything then renders at once (success or failure), never piecemeal.
const STEDI_SIGNATURE_KEYS: (keyof Patient)[] = [
  "stediEligibilityActive", "stediCoverageType", "stediPayerName",
  "stediMedicareAdvantage", "stediMedicareAdvantageCarrier", "stediMedicareAdvantageMemberId",
  "stediQmb", "stediMedicareJurisdiction", "stediMedicaidMltc", "stediManagedMedicaid",
  "stediPrimaryPayer",
  "stediInNetwork", "stediPriorAuthRequired", "stediCoinsurance", "stediCopay",
  "stediIndividualDeductible", "stediIndividualDeductibleRemaining",
  "stediFamilyDeductible", "stediFamilyDeductibleRemaining",
  "stediIndividualOopMax", "stediIndividualOopMaxRemaining",
  "stediFamilyOopMax", "stediFamilyOopMaxRemaining",
  "stediPlanBeginDate", "stediErrorDescription", "stediSecondaryMedicaidId",
  "stediPlanName", "stediGender", "stediMedicaidId", "stediHomePlan", "stediFacilityFlags",
  "stediAddress",
];
function stediSignature(p: Patient): string {
  return STEDI_SIGNATURE_KEYS.map((k) => String(p[k] ?? "")).join("␟");
}
/** Poll Monday every 4s while a run is in flight. */
const STEDI_POLL_MS = 4_000;
/** Results changed then went quiet this long → run complete, reveal. */
const STEDI_SETTLE_MS = 10_000;
/** Nothing changed at all (re-run returned identical values) → reveal anyway. */
const STEDI_UNCHANGED_MS = 35_000;
/** Absolute cap — never spin past this. */
const STEDI_TIMEOUT_MS = 95_000;

interface ProfilePageProps {
  /** Which referral split this page serves (same board, group, panels and
   *  writes — only the patient list differs):
   *  "verified" (/profile) — everyone EXCEPT the unverified referrals;
   *  "unverified" (/unverified-referrals) — ONLY Referral Type "Patient" or
   *  Referral Source "CareCentrix" (lib/profile/referralSplit.ts). */
  variant: "verified" | "unverified";
}

const ProfilePage = ({ variant }: ProfilePageProps) => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const {
    patients: allProfilePatients, loading, initialLoading, error, refetch,
    updateLocal, clearOverlay, removeOverlayKeys, saveOverlay, hasOverlay, getReceived,
  } = useMondayPatients(searchParams.get("patientId"));

  // Role split: unverified = Referral Type "Patient" OR Referral Source
  // "CareCentrix"; verified = everyone else. Deep-linked patients
  // (?patientId=) stay visible regardless of split — mirrors the Chase
  // Clinicals fax/parachute pattern.
  const deepLinkedId = searchParams.get("patientId");
  const patients = useMemo(
    () =>
      allProfilePatients.filter(
        (p) =>
          p.id === deepLinkedId ||
          isUnverifiedReferral(p.referralType, p.referralSource) === (variant === "unverified"),
      ),
    [allProfilePatients, variant, deepLinkedId],
  );

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
  // Fingerprint of ALL Stedi columns at Run-click time + the last-seen
  // fingerprint with when it was first observed (the "settle" tracker).
  const stediRunStartSigRef = useRef("");
  const stediSettleRef = useRef<{ sig: string; at: number } | null>(null);
  // Fast poll + hard-stop timers for the in-flight run.
  const stediPollRef = useRef<{ interval: number; timeout: number } | null>(null);
  const [assets, setAssets] = useState<MondayAsset[]>([]);
  const [clinicLabels, setClinicLabels] = useState<{ id: number; name: string }[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState<number | null>(null);

  useEffect(() => { fetchClinicLabels().then(setClinicLabels).catch(console.error); }, []);
  // Auto-select the first patient the sidebar actually shows (same list math
  // as PatientsSidebar), never from the pre-fetch localStorage cache.
  const viewFilter = viewFilterFromParams(searchParams);
  const visiblePatients = useMemo(
    () => sidebarVisibleList(patients, viewFilter),
    [patients, viewFilter],
  );
  useAutoSelectPatient(
    initialLoading, patients, visiblePatients, selectedId, setSelectedId,
    searchParams.get("patientId"),
  );

  // The clinic pick belongs to one patient — reset it on EVERY selection
  // change (sidebar click or auto-advance), or a clinic chosen for patient A
  // could be written to the next patient's Monday item on submit.
  useEffect(() => {
    setSelectedClinicId(null);
  }, [selectedId]);

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

  const stopStediPolling = useCallback(() => {
    const timers = stediPollRef.current;
    if (timers) {
      clearInterval(timers.interval);
      clearTimeout(timers.timeout);
      stediPollRef.current = null;
    }
  }, []);
  useEffect(() => () => stopStediPolling(), [stopStediPolling]);

  // Watcher — reveal results only when the ENTIRE Stedi column set has gone
  // quiet. The service writes columns one at a time (~1/sec for 15–25s), so a
  // single "new value" is a partial result: track the fingerprint across the
  // 4s polls and clear the running state once it has been stable for
  // STEDI_SETTLE_MS. A terminal signal (plan name / error / a changed
  // eligibility value) must also be present, so the trigger's own clearing of
  // the completion columns never reveals an empty card mid-run.
  useEffect(() => {
    if (!selected || stediRunningId !== selected.id) return;
    const sig = stediSignature(selected);
    const now = Date.now();
    const settle = stediSettleRef.current;
    if (!settle || settle.sig !== sig) {
      stediSettleRef.current = { sig, at: now };
      return;
    }
    const stableFor = now - settle.at;
    const snap = stediRunSnapshotRef.current;
    const terminal =
      !!selected.stediPlanName || !!selected.stediErrorDescription ||
      (!!selected.stediEligibilityActive && selected.stediEligibilityActive !== snap.eligibilityActive);
    const changedSinceRun = sig !== stediRunStartSigRef.current;
    if (terminal && changedSinceRun && stableFor >= STEDI_SETTLE_MS) {
      stopStediPolling();
      setStediRunningId(null);
      return;
    }
    // Nothing moved at all — a re-run that returned byte-identical values.
    // Reveal what's there after a longer quiet window instead of timing out.
    if (!changedSinceRun && stableFor >= STEDI_UNCHANGED_MS) {
      stopStediPolling();
      setStediRunningId(null);
      if (!terminal) {
        toast.error("Stedi returned no new results", {
          description: "The check may not have run — verify the inputs and try again.",
        });
      }
    }
  }, [selected, stediRunningId, stopStediPolling]);


  const checklist = useMemo(() => {
    if (!selected) return [] as { label: string; ok: boolean }[];
    const serv = selected.serving || "";
    const items: { label: string; ok: boolean }[] = [
      { label: "Gender", ok: !!selected.gender?.trim() },
      { label: "Address", ok: !!selected.patientAddress?.trim() },
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
    // Pump Type is also required for supplies orders — infusion sets and
    // cartridges are pump-specific. IP Coverage Path stays pump-only.
    // "Not Serving" is a real board label but not a pickable option, so it
    // must not satisfy the check (the dropdown renders blank for it).
    if (servingIncludes(serv, "insulin pump") || servingIncludes(serv, "supplies")) {
      const pumpType = (selected.pumpType || "").trim();
      items.push({ label: "Pump Type", ok: !!pumpType && pumpType !== "Not Serving" });
    }
    if (servingIncludes(serv, "insulin pump")) {
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
    // Snapshot the terminal signals + the full column fingerprint as they are
    // now (before we clear them) so the watcher can distinguish a fresh
    // result from a stale read — and reset the settle tracker for this run.
    stediRunSnapshotRef.current = {
      planName: patient.stediPlanName ?? "",
      errorDescription: patient.stediErrorDescription ?? "",
      eligibilityActive: patient.stediEligibilityActive ?? "",
    };
    stediRunStartSigRef.current = stediSignature(patient);
    stediSettleRef.current = null;
    stopStediPolling();
    setStediRunningId(runId);
    // Clear the terminal signals locally so the "running" card shows and the
    // prior result doesn't satisfy the completion check…
    onUpdate({ stediPlanName: "", stediErrorDescription: "", stediEligibilityActive: "" });
    // …then drop the read-only Stedi keys from the overlay so the next poll
    // renders Monday's freshly-written values instead of the blanks above.
    removeOverlayKeys(runId, [
      "stediPlanName", "stediErrorDescription", "stediEligibilityActive",
      "stediPayerName", "stediPlanBeginDate", "stediCoverageType", "stediHomePlan",
      "stediMedicaidId", "stediAddress", "stediQmb", "stediManagedMedicaid", "stediCoinsurance",
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
      // Poll fast while the run is in flight; the settle watcher above stops
      // this the moment the full result set has landed and gone quiet.
      const interval = window.setInterval(() => refetch(true), STEDI_POLL_MS);
      // Hard stop — never spin forever.
      const timeout = window.setTimeout(() => {
        stopStediPolling();
        setStediRunningId((cur) => {
          if (cur === runId) {
            toast.error("Stedi check timed out", {
              description: "No results after 90 seconds. Check Monday for details.",
            });
            return null;
          }
          return cur;
        });
      }, STEDI_TIMEOUT_MS);
      stediPollRef.current = { interval, timeout };
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
      // Only the SELECTED Secondary Insurance feeds the estimate — the
      // advisory suggestion must never silently flip a patient to the
      // "secondary Medicaid covers everything → $0" rule.
      const { first, recurring } = computeFirstAndRecurring({
        serving: selected.serving,
        primaryInsurance: primary,
        secondaryInsurance: selected.secondaryInsurance || "",
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
          onSelect={setSelectedId}
          loading={loading}
          error={error}
          onRefresh={refetch}
          hasOverlay={hasOverlay}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Already-in-system patients turn the ENTIRE header red (Josh, 2026-07 —
              the small badge alone was too easy to miss). */}
          <header className={`${selected?.alreadyInSystem?.toLowerCase() === "yes" ? "bg-gradient-to-b from-red-700 to-red-900" : "bg-gradient-navy"} text-navy-foreground border-b border-sidebar-border`}>
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
                  <h1 className="text-2xl font-bold">
                    Profile Send-Off — {variant === "unverified" ? "Unverified" : "Verified"} Referrals
                  </h1>
                  {selected && (
                    <p className="text-sm opacity-80 mt-0.5 flex items-center gap-2">
                      {selected.name}
                      {selected.alreadyInSystem?.toLowerCase() === "yes" && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white text-red-700 text-sm font-extrabold uppercase tracking-wide px-3 py-1 shadow">
                          <AlertTriangle className="h-4 w-4" /> Already In System
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
                <ReportIssueButton />
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
                received={getReceived(selected.id) ?? selected}
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
  /** As-received snapshot (first-seen Monday values) — feeds the left
   *  "What We Received" cards so they stay frozen while the right is edited. */
  received: Patient;
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

/** Turn a hand-pasted referral email into a Monday update body: trim, escape
 *  HTML (updates render via dangerouslySetInnerHTML, so stray <, &, > from a
 *  pasted email must not break the markup), preserve the email's line breaks,
 *  and append the same "-Profile Checklist" signature the role has always used
 *  on posted updates. */
function referralEmailToUpdateBody(text: string): string {
  const esc = text
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, "<br>");
  return `${esc}<br><br><i>-Profile Checklist</i>`;
}

/** Inline referral email / Monday updates, rendered in the rail below Files.
 *  Reads existing Monday updates for the item AND lets a rep paste a referral
 *  email in by hand — Save posts it as a new update on the SAME item, so it
 *  lands in the same list. Serves BOTH profile roles (verified + unverified)
 *  unchanged — one board/item, one updates feed. */
function RailReferral({ patient }: { patient: Patient }) {
  const [open, setOpen] = useState(false);
  const [updates, setUpdates] = useState<MondayUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Load the item's updates. `autoOpen` expands the section when there's
  // already referral data (first load / patient change); a manual Save
  // re-fetches with autoOpen=false so it never fights the user's toggle.
  const loadUpdates = useCallback((autoOpen: boolean) => {
    let cancelled = false;
    setLoading(true);
    fetchUpdates(patient.id)
      .then((u) => { if (!cancelled) { setUpdates(u); if (autoOpen && u.length > 0) setOpen(true); } })
      .catch(() => { if (!cancelled) setUpdates([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patient.id]);

  // Fetch on load / patient change and auto-expand when there's referral data.
  useEffect(() => loadUpdates(true), [loadUpdates]);

  const handleSaveReferral = async () => {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    try {
      await createUpdate(patient.id, referralEmailToUpdateBody(text));
      toast.success("Referral email saved to Monday");
      setDraft("");
      setComposing(false);
      setOpen(true);
      loadUpdates(false); // re-fetch so the new update shows in the list below
    } catch (e) {
      toast.error("Failed to save referral email", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

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
              /* Own bounded scroll area — the sticky rail's viewport math can
                 leave its tail unreachable on short pages, so a long referral
                 email must scroll INSIDE this box, not the rail. */
              <div className="rail-updates">
                {updates.map((u) => (
                  <div key={u.id} className="note-entry">
                    <span className="ts">[{u.created_at ? new Date(u.created_at).toLocaleString() : ""}] {u.creator?.name || ""}</span>
                    <div style={{ marginTop: 4 }} dangerouslySetInnerHTML={{ __html: u.body }} />
                  </div>
                ))}
              </div>
            )}

            {/* Add a referral email by hand — paste it in and Save posts it as
                a Monday update on this item, landing in the same list above. */}
            {composing ? (
              <div className="note-add" style={{ marginTop: 12 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Paste the referral email here…"
                  autoFocus
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn primary sm" onClick={handleSaveReferral} disabled={saving || !draft.trim()}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button className="btn secondary sm" onClick={() => { setComposing(false); setDraft(""); }} disabled={saving}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn secondary sm" style={{ marginTop: 12 }} onClick={() => setComposing(true)}>
                ＋ Add referral email
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileBody(p: BodyProps) {
  const pt = p.patient;
  const rcv = p.received; // frozen "as received" values for the left cards
  const serv = pt.serving || "";
  const cgm = servingIncludes(serv, "cgm");
  const ip = servingIncludes(serv, "insulin pump");
  // Supplies orders (infusion sets/cartridges) are pump-specific, so they
  // need a Pump Type too — but no IP Coverage Path (we're not placing a pump).
  const supplies = servingIncludes(serv, "supplies");
  // Rendered from two slots: the pump position for pump servings, or as the
  // third box after the CGM pair for supplies-without-pump servings.
  const pumpTypeField = (
    <Field label="Pump Type" required><select value={pt.pumpType} onChange={(e) => p.onUpdate({ pumpType: e.target.value })}><option value="" disabled hidden>Select…</option>{PUMP_TYPE_OPTS.map((l) => <option key={l}>{l}</option>)}</select></Field>
  );
  const stediFailed = !!pt.stediErrorDescription && !pt.stediPlanName;
  // Error code + description + recommended solution for the failure banner.
  const stediError = interpretStediError(pt.stediErrorDescription);
  // Managed-Medicaid MCO (e.g. "MOLINA HEALTHCARE OF NY INC MAINSTR"). Keyed
  // on the dedicated column — real Stedi writes Coverage Type as plain
  // "Medicaid", so a covtype check would never fire on real data.
  const managedMedicaid = managedMedicaidMco(pt.stediManagedMedicaid);
  // The check named a DIFFERENT payer as primary than the payer checked
  // (e.g. Fidelis EP reporting a UHC StudentResources COB record). Drives
  // the red Primary Payer cell + the generic mismatch banner.
  const ppMismatch = primaryPayerMismatch(pt.stediPrimaryPayer ?? "", pt.stediPayerName ?? "");
  // Referral-claimed Secondary Insurance — an UNVERIFIED intake claim, shown
  // as its own "From referral:" chip, never dressed up as a Suggestion.
  // Hidden when it duplicates the engine suggestion or the rep's pick, and
  // SUPPRESSED when Stedi contradicts it: a Medicaid-family claim with no
  // valid CIN returned is wrong (e.g. a CHP kid whose referral said Medicaid).
  const referralSecondary = (() => {
    const claim = (rcv.secondaryInsurance || "").trim();
    if (!claim || claim === pt.secondaryInsurance || claim === p.secondarySuggestion) return "";
    const medid = (pt.stediMedicaidId || pt.stediSecondaryMedicaidId || "").trim();
    if (/medicaid/i.test(claim) && !isNyMedicaidId(medid)) return "";
    return claim;
  })();
  // The "Enter correct insurance information" box (and the Request card that
  // rides to its left) show once a check has completed and didn't fail.
  const showInsuranceEntry = !p.stediRunning && !stediFailed && !!(pt.stediPlanName || pt.stediEligibilityActive);
  // Why the saved OOP figures are what they are — recompute the estimate from
  // the current inputs to surface the reason line (e.g. "Secondary NY
  // Medicaid covers remaining balance" behind a $0, or which benefits fields
  // Stedi is missing). Mirrors handleCalcOop's inputs.
  const oopNote = (() => {
    const primary = pt.primaryInsurance || p.suggestion?.value || "";
    if (!primary || !pt.serving) return "";
    const { first } = computeFirstAndRecurring({
      serving: pt.serving,
      primaryInsurance: primary,
      secondaryInsurance: pt.secondaryInsurance || "",
      stediCoinsurance: pt.workingCoinsurance || pt.stediCoinsurance,
      deductibleRemaining: pt.workingDeductibleRemaining || pt.stediIndividualDeductibleRemaining,
      oopMaxRemaining: pt.workingOopMaxRemaining || pt.stediIndividualOopMaxRemaining,
    });
    return first.note;
  })();
  const [readyOpen, setReadyOpen] = useState(false);
  // Member ID 1 is always entered fresh by the rep (never auto-filled).
  const [mid1Input, setMid1Input] = useState("");
  // Secondary Insurance and Serving are rep DECISIONS — intake/board values
  // must only ever surface as suggestions (Josh, 2026-07). Demote
  // board-sourced values on load: clear the working copies so both selects
  // start on "Select…"; the suggestion chips re-offer a value in one click,
  // and send-off skips blanks (statusWriteTask — the board keeps its values
  // until the rep actively picks). ProfileBody is keyed by patient id, so
  // this runs once per patient and never fights a selection made this session.
  useEffect(() => {
    const patch: Partial<Patient> = {};
    if (pt.secondaryInsurance) patch.secondaryInsurance = "";
    if (pt.serving) patch.serving = "";
    // Autoscraped intake data often arrives ALL CAPS (Josh, 2026-07) —
    // normalize the working copies once per patient load. The rep can still
    // edit, and the normalized values ride the existing write paths to Monday.
    const fixedName = titleCaseName(pt.name);
    if (fixedName !== pt.name) patch.name = fixedName;
    const fixedAddress = titleCaseAddress(pt.patientAddress);
    if (fixedAddress !== pt.patientAddress) patch.patientAddress = fixedAddress;
    const fixedEmail = normalizeEmailCase(pt.email);
    if (fixedEmail !== pt.email) patch.email = fixedEmail;
    if (Object.keys(patch).length) p.onUpdate(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Benefits Check inputs ALWAYS start blank — the as-received insurance shows
  // in the "What We Received" card to the left, and the rep enters the values
  // fresh. Local state (ProfileBody is keyed by patient id, so it resets per
  // patient); the rep's entry still flows to Monday via onUpdate.
  const [giInput, setGiInput] = useState("");
  const [midInput, setMidInput] = useState("");

  // ── CGM cross-sell — same auto-derivation the original ServingPanel ran ──
  // The status itself is no longer shown in the UI (it's folded into the
  // Serving suggestion below), but the column still auto-derives and writes
  // to Monday on send-off. Re-derive whenever Primary Insurance or Request
  // Type changes: eligible (non-Medicaid/United/Cigna) → Cross-Sell + default
  // Dexcom G7 on the Insulin path; blocked → Couldn't Cross-Sell + Not
  // Serving. Manual "Already Serving CGM" is respected and never overwritten.
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
  // Serving is NEVER auto-filled (Josh, 2026-07) — the cross-sell derivation
  // above only surfaces as the advisory chip below; the rep picks Serving
  // (clicking the chip applies it in one click). Hidden once Serving matches.
  // The hint explains the cross-sell decision inline (the status dropdown is gone).
  const servingSuggestion = deriveServing(crossSell, pt.requestType || "") || pt.requestType || "";
  const xsellHint = (() => {
    const reason = crossSellReason(primaryIns);
    if (crossSell === "Cross-Sell" && reason === "eligible") return "Primary insurance is a non-Medicaid plan, so this patient is eligible for CGM cross-sell";
    if (crossSell === "Already Serving CGM") return "Already serving CGM — no cross-sell added";
    if (crossSell === "Couldn't Cross-Sell") {
      if (reason === "jlj") return "No CGM cross-sell: primary insurance is an Anthem JLJ plan — JLJ plans cannot do CGM";
      if (reason === "medicaid") return "No CGM cross-sell: primary insurance is a Medicaid plan";
      if (reason === "united") return "No CGM cross-sell: primary insurance is United, and we choose not to cross-sell United patients";
      if (reason === "cigna") return "No CGM cross-sell: primary insurance is Cigna, and we choose not to cross-sell Cigna patients";
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
            <RailReferral patient={rcv} />
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
                    <div className="f"><div className="k">Name</div><div className="v">{rcv.name}</div></div>
                    <div className="f"><div className="k">Date of Birth</div><div className="v">{rcv.dob || "—"}</div></div>
                    <div className="f"><div className="k">Phone</div><div className="v">{rcv.ptPhone || "—"}</div></div>
                    <div className="f"><div className="k">Email</div><div className="v">{rcv.email || "—"}</div></div>
                    <div className="f"><div className="k">Gender</div><div className="v">{rcv.gender || "—"}</div></div>
                    <div className="f full"><div className="k">Address</div><div className="v">{rcv.patientAddress || "—"}</div></div>
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
                  <Field label="Address" required warn={addressWarning(pt.patientAddress)}>
                    <AddressAutocomplete value={pt.patientAddress} className={pt.patientAddress?.trim() ? "pf-input filled" : "pf-input need"}
                      onChange={(r) => p.onUpdate({ patientAddress: r.address, patientAddressLat: r.lat || null, patientAddressLng: r.lng || null })}
                      placeholder="Start typing address…" />
                  </Field>
                </div>
              </section>
            </div>

            {/* Row 2 — benefits. Stretched so the Request card can bottom-align
                with the "Enter correct insurance information" box across the row. */}
            <div className="duo" style={{ alignItems: "stretch" }}>
              <div className="leftcol" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <section className="card recv-card">
                  <div className="recv-title"><h3>Provided Insurance</h3></div>
                  <div className="kv">
                    <div className="f full"><div className="k">General Insurance</div><div className="v">{rcv.generalInsurance || "—"}</div></div>
                    <div className="f"><div className="k">Member ID 1</div><div className="v">{rcv.memberId1 || "—"}</div></div>
                    <div className="f"><div className="k">Member ID 2</div><div className="v">{rcv.memberId2 || "—"}</div></div>
                    {/* Referral-claimed secondary — received data, NOT a suggestion */}
                    <div className="f full"><div className="k">Secondary Insurance</div><div className="v">{rcv.secondaryInsurance || "—"}</div></div>
                  </div>
                </section>
                {/* Request type rides DIRECTLY beside the "Enter correct insurance
                    information" box (bottom of the right card) — it can change
                    which Primary we pick. Only shows when that box shows. */}
                {showInsuranceEntry && (
                  <section className="card recv-card" style={{ marginTop: "auto" }}>
                    <div className="recv-title"><h3>Request</h3></div>
                    <div className="kv">
                      <div className="f full"><div className="k">Request Type</div><div className="v">{rcv.requestType || "—"}</div></div>
                    </div>
                  </section>
                )}
              </div>
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

                {p.stediRunning && (
                  <div className="stedi-running">
                    <span className="stedi-spinner" aria-hidden />
                    <div>
                      <div className="sr-title">Saving profile &amp; running eligibility check…</div>
                      <div className="sugg-note">Name, insurance &amp; Member ID are written to Monday first, then Stedi runs. Results appear all at once when the check completes (usually 20–40 seconds).</div>
                    </div>
                  </div>
                )}

                {/* Failure — show ONLY the failure banner, none of the outputs */}
                {!p.stediRunning && stediFailed && stediError && (
                  <div className="err-banner" style={{ marginTop: 16 }}>
                    <div className="et">
                      Stedi check failed{stediError.code ? ` — error ${stediError.code}` : ""}
                    </div>
                    <div className="ed">{stediError.description}</div>
                    <div className="ed" style={{ marginTop: 8 }}>
                      <b>What to do:</b> {stediError.solution}
                    </div>
                    {stediError.isConnectionError && (
                      <div className="ea">
                        <button className="btn primary sm" onClick={p.onRunStedi}>Try Again</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Eligibility results — live from Monday's Stedi columns */}
                {!p.stediRunning && !stediFailed && (pt.stediPlanName || pt.stediEligibilityActive) && (
                  <>
                    {/* Managed Medicaid — suppressed when Stedi flags Medicare
                        Advantage. An MA dual's MCO name can wrongly land in the
                        Managed Medicaid column, and "supplies through Medicaid"
                        is backwards for a member whose claims belong to the MA
                        payer (Samira Delacruz, 2026-07-16). Belt-and-suspenders
                        for the backend Y2 gate — protects even on stale data. */}
                    {managedMedicaid && !truthy(pt.stediMedicareAdvantage) && (
                      <div className="warn-banner" style={{ marginTop: 16 }}>
                        <AlertTriangle className="h-4 w-4" />
                        <span><b>Managed Medicaid detected — {managedMedicaid}.</b> Supplies Only eligible — set Serving accordingly.</span>
                      </div>
                    )}
                    {/* Medicare Advantage / dual — rendered from the MA columns
                        the backend already writes (previously invisible in the
                        UI, same class of bug as the original Managed Medicaid
                        column). QMB dual gets the stronger D-SNP wording. */}
                    {truthy(pt.stediMedicareAdvantage) && (
                      <div className="warn-banner" style={{ marginTop: 16 }}>
                        <AlertTriangle className="h-4 w-4" />
                        {truthy(pt.stediQmb) ? (
                          <span><b>Medicare Advantage detected — {pt.stediMedicareAdvantageCarrier || pt.stediPayerName}.</b> QMB dual — likely D-SNP; Medicaid is cost-share secondary only. Bill this payer (not Medicare A&B, not straight Medicaid) — verify network before serving.</span>
                        ) : (
                          <span><b>Medicare Advantage detected — {pt.stediMedicareAdvantageCarrier || pt.stediPayerName}.</b> Bill this payer — not straight Medicare A&B.</span>
                        )}
                      </div>
                    )}
                    {/* §1b MSP — Medicare is SECONDARY per CMS's COB file (MSP
                        type 12/13/43: employer group health / ESRD; situational
                        auto/WC records never reach this column). Soft block —
                        the record can be stale (Jacqueline Fuller: added via
                        claim processing after the coverage had ended), so the
                        rep verifies with the patient and disputes via BCRC
                        rather than being hard-stopped. The CMS name is a
                        detection signal, not billing truth (Anthony Thompson:
                        CMS said "BCBS S.C.", the billable home plan resolved to
                        Florida Blue via the payer-side check).
                        TODO(§1b columns): when the Stedi MSP COB Date / Record
                        Updated / Source columns are created on the board, show
                        them here ("COB from {date}; record updated {date},
                        source: {code}") and add the structured override that
                        writes "MSP disputed — BCRC needed" to the status
                        column gating claims release. */}
                    {!truthy(pt.stediMedicareAdvantage)
                      && (pt.stediCoverageType || "").trim() === "Medicare A&B"
                      && !!(pt.stediPrimaryPayer || "").trim()
                      && !/^medicare\b/i.test((pt.stediPrimaryPayer || "").trim()) && (
                      <div className="warn-banner" style={{ marginTop: 16 }}>
                        <AlertTriangle className="h-4 w-4" />
                        <span><b>Medicare's file shows {pt.stediPrimaryPayer.trim()} as PRIMARY.</b> Medicare will DENY primary claims while this MSP record is open — even if that coverage has ended. Get the commercial card and run the payer-side check (the CMS name is often the claims processor, not the member-facing brand). If the patient confirms the coverage ended: BCRC 855-798-2627, then re-run the Stedi check in 72 hours — a clean re-check is the all-clear.</span>
                      </div>
                    )}
                    {/* Facility flags (Brandon, 2026-07-20) — active Hospice
                        election / Hospital-SNF stay from the Medicare 271
                        (mirror of the Subscription Board column). Medicare A&B
                        only: hospice transfers Part B DME to the hospice
                        benefit and a covered inpatient stay bundles DME, so
                        claims deny while either is open. The backend clears
                        the column on a clean re-check. */}
                    {(pt.stediCoverageType || "").trim() === "Medicare A&B"
                      && !!(pt.stediFacilityFlags || "").trim() && (
                      <div className="warn-banner" style={{ marginTop: 16 }}>
                        <AlertTriangle className="h-4 w-4" />
                        <span>
                          {/Hospice/i.test(pt.stediFacilityFlags)
                            ? <><b>Active hospice election on file.</b> Medicare Part B DME will DENY while the election is open — supplies fall under the hospice benefit. Verify status with the patient before serving; a clean re-check clears this flag.</>
                            : <><b>Active Hospital/SNF stay on file.</b> DME billed during a covered inpatient stay will deny — confirm discharge before shipping; a clean re-check clears this flag.</>}
                          {/Hospice/i.test(pt.stediFacilityFlags) && /Hospital\/SNF/i.test(pt.stediFacilityFlags)
                            ? <> Also shows an active Hospital/SNF stay.</> : null}
                        </span>
                      </div>
                    )}
                    {/* Non-Medicare COB mismatch — the check itself named a
                        different PRIMARY payer (e.g. Fidelis EP reporting a UHC
                        StudentResources record — Ryan Impellizeri, 2026-07-20).
                        Medicare A&B checks keep the richer MSP banner above. */}
                    {ppMismatch && (pt.stediCoverageType || "").trim() !== "Medicare A&B" && (
                      <div className="warn-banner" style={{ marginTop: 16 }}>
                        <AlertTriangle className="h-4 w-4" />
                        <span><b>{pt.stediPayerName || "This payer"} reports {pt.stediPrimaryPayer.trim()} as PRIMARY.</b> This plan pays second — get the primary card, run the check against that payer, and verify coordination of benefits before billing.</span>
                      </div>
                    )}
                    <div className="res-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginTop: 16 }}>
                      <ResCell label="Active?" value={pt.stediEligibilityActive} bad={!!pt.stediEligibilityActive && !p.stediActive} />
                      <ResCell label="Payer Name" value={pt.stediPayerName} />
                      {/* Always shown (Brandon, 2026-07-20): who is actually
                          PRIMARY per the check. Red when it names a different
                          payer than the one checked. */}
                      <ResCell label="Primary Payer" value={pt.stediPrimaryPayer} bad={ppMismatch} />
                      <ResCell label="Plan Begin Date" value={pt.stediPlanBeginDate} />
                    </div>
                    <div className="res-grid" style={{ gridTemplateColumns: `repeat(${4 + (pt.stediQmb ? 1 : 0) + (pt.generalInsurance === "Medicaid" ? 1 : 0)},1fr)`, marginTop: 10 }}>
                      <ResCell label="Coverage Type" value={pt.stediCoverageType} />
                      <ResCell label="Plan Name" value={pt.stediPlanName} />
                      <ResCell label="Home Plan" value={pt.stediHomePlan} />
                      <ResCell label="Medicaid ID" value={isNyMedicaidId(pt.stediMedicaidId) ? pt.stediMedicaidId : ""} />
                      {pt.stediQmb && <ResCell label="QMB?" value={pt.stediQmb} />}
                      {pt.generalInsurance === "Medicaid" && <ResCell label="Managed Medicaid" value={managedMedicaid} />}
                    </div>
                    {/* Address + Gender parsed by the Stedi check. Address keeps
                        the bulk of the row so the whole street/city/state/zip
                        still fits (Josh, 2026-07-21); Gender rides in a box
                        beside it, pulled from the Stedi gender column (Josh,
                        2026-07-22). */}
                    <div className="res-grid" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)", marginTop: 10 }}>
                      <ResCell label="Address" value={pt.stediAddress} />
                      <ResCell label="Gender" value={pt.stediGender} />
                    </div>
                  </>
                )}

                {/* Cost Sharing — read-only, live from Monday */}
                {!p.stediRunning && !stediFailed && (pt.stediPlanName || pt.stediEligibilityActive) && <CostShare pt={pt} />}

                {/* Enter correct insurance information */}
                {showInsuranceEntry && (
                  <div id="post-stedi" style={{ marginTop: 22, border: "1.5px solid var(--amber-ring)", borderRadius: 12, background: "oklch(0.96 0.04 90 / 0.35)", padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                      <span style={{ display: "grid", placeItems: "center", height: 26, width: 26, borderRadius: "50%", fontSize: ".8rem", fontWeight: 800, background: "var(--amber)", color: "#fff" }}>!</span>
                      <span style={{ fontSize: "1rem", fontWeight: 800, color: "oklch(0.4 0.1 75)" }}>Enter correct insurance information <span className="req-star">*</span></span>
                    </div>
                    <div className="fgrid">
                      <Field label="Primary Insurance" required>
                        <select className={pt.primaryInsurance ? "filled" : "need"} value={pt.primaryInsurance} onChange={(e) => p.onUpdate({ primaryInsurance: e.target.value })}>
                          <option value="" disabled hidden>Select…</option>
                          {/* §1a hard block: an MA member can never bill straight
                              Medicare A&B (EB*U is authoritative — Hollander
                              picked A&B past the warning banner). */}
                          {groupPrimaryInsuranceLabels().map(({ group, labels }) => (
                            <optgroup key={group} label={group}>{labels.map((l) => <option key={l} disabled={l === "Medicare A&B" && truthy(pt.stediMedicareAdvantage)}>{l}</option>)}</optgroup>
                          ))}
                        </select>
                        <SuggestionInline sg={p.suggestion} onPick={(v) => p.onUpdate({ primaryInsurance: v })} />
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
                        {/* Suggestion = ENGINE OUTPUT ONLY. The intake-pre-filled
                            board value must never wear the Suggestion label — a
                            wrong referral claim once shipped as "Suggestion: NY
                            Medicaid" on a CHP kid with no CIN. */}
                        {p.secondarySuggestion && (
                          <div className="sugg-line" style={{ marginTop: 8 }}>
                            <span className="sugg-lead2">Suggestion:</span>
                            <button type="button" className="sugg-chip2 clickable" onClick={() => p.onUpdate({ secondaryInsurance: p.secondarySuggestion })}>{p.secondarySuggestion}</button>
                          </div>
                        )}
                        {referralSecondary && (
                          <div className="sugg-line" style={{ marginTop: 8 }}>
                            <span className="sugg-lead2">From referral:</span>
                            <button type="button" className="sugg-chip2 office clickable" onClick={() => p.onUpdate({ secondaryInsurance: referralSecondary })}>{referralSecondary}</button>
                            <span className="sugg-note">unverified referral claim — confirm before using</span>
                          </div>
                        )}
                      </Field>
                      {/* Member ID 2 is mandatory when Secondary is NY Medicaid (the
                          send-off checklist already blocks on it) — the field must
                          SAY so: required star, red/green border, no "(optional)". */}
                      <Field label="Member ID 2" required={pt.secondaryInsurance === "NY Medicaid"}>
                        <input type="text"
                          className={pt.secondaryInsurance === "NY Medicaid" ? (pt.memberId2?.trim() ? "filled" : "need") : undefined}
                          value={pt.memberId2} onChange={(e) => p.onUpdate({ memberId2: e.target.value })}
                          placeholder={pt.secondaryInsurance === "NY Medicaid" ? "Member ID… (required)" : "Member ID… (optional)"} />
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
                  <div className="f"><div className="k">Request Type</div><div className="v">{rcv.requestType || "—"}</div></div>
                  <div className="f"><div className="k">Referral Source</div><div className="v">{rcv.referralSource || "—"}</div></div>
                  <div className="f"><div className="k">CGM Type (provided)</div><div className="v">{rcv.cgmType || "—"}</div></div>
                  <div className="f"><div className="k">CGM Coverage Path (provided)</div><div className="v">{rcv.cgmCoveragePath || "—"}</div></div>
                  <div className="f"><div className="k">Pump Type (provided)</div><div className="v">{rcv.pumpType || "—"}</div></div>
                  <div className="f"><div className="k">IP Coverage Path (provided)</div><div className="v">{rcv.insulinPumpCoveragePath || "—"}</div></div>
                </div>
              </section>
              <div className="work-col">
                <section className="card step-card">
                  <header className="step-head"><span className="step-num">3</span><h2>Serving &amp; Coverage</h2></header>
                  {/* Supplies + CGM shows exactly three boxes (CGM Type · CGM
                      Coverage Path · Pump Type) — render them as one 3-up row. */}
                  <div className={cgm && supplies && !ip ? "fgrid trio" : "fgrid"}>
                    <div className="full">
                      {servingSuggestion && servingSuggestion !== serv && (
                        <div className="sugg-line" style={{ marginBottom: 8 }}>
                          <span className="sugg-lead2">Suggestion:</span>
                          <button type="button" className="sugg-chip2 clickable" onClick={() => p.onUpdate({ serving: servingSuggestion })}>{servingSuggestion}</button>
                          {xsellHint && <span className="sugg-note">{xsellHint}</span>}
                        </div>
                      )}
                      <Field label="Serving" required>
                        <select className={serv ? "filled" : "need"} value={serv} onChange={(e) => p.onUpdate({ serving: e.target.value })}>
                          <option value="" disabled hidden>Select what we're serving…</option>
                          {SERVING_OPTS.map((l) => <option key={l}>{l}</option>)}
                        </select>
                        {serv && xsellHint && servingSuggestion === serv && (
                          <div className="sugg-note" style={{ marginTop: 6 }}>{xsellHint}</div>
                        )}
                      </Field>
                    </div>
                    {cgm && <Field label="CGM Type" required><select value={pt.cgmType} onChange={(e) => p.onUpdate({ cgmType: e.target.value })}><option value="" disabled hidden>Select…</option>{CGM_TYPE_OPTS.map((l) => <option key={l}>{l}</option>)}</select></Field>}
                    {ip && pumpTypeField}
                    {cgm && <Field label="CGM Coverage Path" required><select value={pt.cgmCoveragePath} onChange={(e) => p.onUpdate({ cgmCoveragePath: e.target.value })}><option value="" disabled hidden>Select…</option>{CGM_PATH_OPTS.map((l) => <option key={l}>{l}</option>)}</select></Field>}
                    {supplies && !ip && pumpTypeField}
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
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
                        <div className="rcell" style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}>
                          <div className="rl">First Order</div>
                          <div className="rv set" style={{ fontSize: "1.4rem" }}>{pt.oopFirst || "—"}</div>
                          {ip && <div className="rl" style={{ marginTop: 4, textTransform: "none", letterSpacing: 0, color: "var(--mm-teal)", fontWeight: 700 }}>Includes Pump</div>}
                        </div>
                        <div className="rcell" style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}><div className="rl">Recurring · 90-day</div><div className="rv set" style={{ fontSize: "1.4rem" }}>{pt.oopRecurring || "—"}</div></div>
                      </div>
                      {oopNote && <div className="sugg-note" style={{ marginTop: 8 }}>{oopNote}</div>}
                    </>
                  )}
                </section>
              </div>
            </div>

            {/* Row 4 — doctor */}
            <div className="duo">
              <section className="card recv-card">
                <div className="recv-title"><h3>Provided Doctor Info</h3></div>
                <div className="kv">
                  <div className="f"><div className="k">Doctor Name</div><div className="v">{rcv.doctorName || "—"}</div></div>
                  <div className="f"><div className="k">Clinic Phone</div><div className="v">{rcv.doctorPhone || "—"}</div></div>
                  <div className="f full"><div className="k">Clinic Address</div><div className="v">{rcv.clinicAddress || "—"}</div></div>
                </div>
              </section>
              <div className="work-col">
                <section className="card step-card">
                  <header className="step-head"><span className="step-num">4</span><h2>Select Correct Provider</h2></header>
                  <DoctorSection patient={pt} received={rcv} onUpdate={p.onUpdate} clinicLabels={p.clinicLabels} onClinicSelect={p.onClinicSelect} />
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
 *  selects the insurance manually, or clicks the pill to apply it. */
function SuggestionInline({ sg, onPick }: { sg: ReturnType<typeof suggestPrimary>; onPick?: (v: string) => void }) {
  if (!sg) return null;
  // CGM-only + Medicaid (any flavor) — advisory alert pill, no apply action:
  // "Can't Serve" is not a board label and must never reach the Primary select.
  if (sg.cantServe) {
    return (
      <div className="sugg-line" style={{ marginTop: 8 }}>
        <span className="sugg-chip2" style={{ background: "#fdecef", color: "var(--mm-rose)", boxShadow: "inset 0 0 0 1px var(--mm-rose)" }}>Can't Serve</span>
        <span className="sugg-note" style={{ color: "var(--mm-rose)", fontWeight: 600 }}>CGM-only request with Medicaid coverage — route the referral (send back) instead of completing insurance</span>
      </div>
    );
  }
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
          {onPick && PRIMARY_LABELS.has(sg.value) ? (
            <button type="button" className="sugg-chip2 clickable" onClick={() => onPick(sg.value!)}>{sg.value}</button>
          ) : (
            <span className="sugg-chip2">{sg.value}</span>
          )}
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
