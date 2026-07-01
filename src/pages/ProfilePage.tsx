/**
 * Profile Send-Off — redesign face.
 *
 * Faithful port of `profile-sendoff-redesign-v2.html` (the delivered UI) wired to
 * the real backend: useMondayPatients (poll + overlay), the suggestion engine,
 * the OOP estimator, and the verified write paths. Styling is the prototype's own
 * stylesheet, scoped under `.pf-root` (see ./profile/redesign.css).
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useMondayPatients } from "@/hooks/profile/useMondayPatients";
import type { Patient } from "@/lib/profile/workflow";
import { hasValidZip, formatPhone, crossSellReason } from "@/lib/profile/workflow";
import { fetchClinicLabels, fetchItemAssets, type MondayAsset } from "@/lib/profile/mondayApi";
import {
  sendPatientToMonday, sendBackToPatientIntake, writeBenefitsInputs,
  writeOopEstimate, triggerStediRun,
} from "@/lib/profile/mondayWrite";
import {
  suggestPrimary, suggestSecondary, buildSuggestionInputs, isCoverageActive,
} from "@/lib/profile/primaryInsurance";
import { computeFirstAndRecurring } from "@/lib/profile/oopEstimate";
import {
  GENERAL_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX, GENDER_INDEX,
  SERVING_INDEX, CGM_TYPE_INDEX, PUMP_TYPE_INDEX,
  CGM_COVERAGE_PATH_INDEX, INSULIN_PUMP_COVERAGE_PATH_INDEX,
  groupPrimaryInsuranceLabels,
} from "@/lib/profile/mondayMapping";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { ParachuteLookupPanel } from "@/components/profile/ParachuteLookupPanel";
import { DoctorFollowers } from "@/components/profile/DoctorFollowers";
import { DoctorNotesPanel } from "@/components/shared/DoctorNotesPanel";
import { AddressAutocomplete } from "@/components/profile/AddressAutocomplete";
import { ReferralEmailPanel } from "@/components/profile/ReferralEmailPanel";
import { FollowUpModal } from "@/components/profile/FollowUpModal";
import { createDoctorItem } from "@/lib/shared/doctorDb";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { useBackNavigation } from "@/hooks/useBackNavigation";
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
    updateLocal, clearOverlay, saveOverlay, hasOverlay,
  } = useMondayPatients(searchParams.get("patientId"));

  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("patientId") ?? null);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [stediRunning, setStediRunning] = useState(false);
  const [calcOop, setCalcOop] = useState(false);
  const [addingDoc, setAddingDoc] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
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

  // ── Suggestions + checklist ──
  const suggestion = useMemo(() => selected ? suggestPrimary(buildSuggestionInputs(selected)) : null, [selected]);
  const secondarySuggestion = useMemo(() => selected ? suggestSecondary(buildSuggestionInputs(selected)) : "", [selected]);
  const stediActive = useMemo(() => selected ? isCoverageActive(buildSuggestionInputs(selected).stedi) : false, [selected]);

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

  // ── Handlers ──
  const handleRunStedi = async () => {
    if (!selected) return;
    const workingId = (selected.workingMemberId || selected.memberId1).trim();
    if (!selected.name.trim() || !selected.dob.trim() || !selected.generalInsurance || !workingId) {
      toast.error("Fill in Name, DOB, General Insurance and Member ID first");
      return;
    }
    setStediRunning(true);
    onUpdate({ stediPlanName: "", stediErrorDescription: "", stediEligibilityActive: "" });
    try {
      await writeBenefitsInputs(selected.id, selected.generalInsurance, workingId);
      await triggerStediRun(selected.id);
      toast.success("Stedi eligibility check triggered");
      [3000, 8000, 15000, 25000, 40000, 55000].forEach((ms) => setTimeout(() => refetch(true), ms));
    } catch (e) {
      toast.error("Failed to trigger Stedi run", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setStediRunning(false);
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

  const handleAddDoctor = async () => {
    if (!selected) return;
    if (!selected.doctorName?.trim() || !selected.doctorNpi?.trim()) {
      toast.error("Doctor Name and NPI are required");
      return;
    }
    setAddingDoc(true);
    try {
      await createDoctorItem({
        name: selected.doctorName.trim(), npi: selected.doctorNpi.trim(),
        address: selected.clinicAddress, phone: selected.doctorPhone,
        fax: selected.doctorFax, email: selected.doctorEmail, method: selected.clinicalsMethod,
      });
      toast.success(`${selected.doctorName} added to the Doctor Database`);
    } catch (e) {
      toast.error("Failed to add provider", { description: e instanceof Error ? e.message : String(e) });
    } finally { setAddingDoc(false); }
  };

  const openAsset = (a: MondayAsset) => {
    try { openFileViewer({ url: a.public_url || a.url, name: a.name }); }
    catch { toast.error("Could not open file"); }
  };

  // ── Sidebar list ──
  const listed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? patients.filter((p) => p.name.toLowerCase().includes(q)) : patients;
  }, [patients, search]);

  return (
    <div className="pf-root" style={{ minHeight: "100vh", background: "var(--background)" }}>
      <PageLoadingOverlay show={initialLoading} />
      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* Sidebar */}
        <aside style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--border)", background: "#0b1a2b", color: "#fff", display: "flex", flexDirection: "column", maxHeight: "100vh", position: "sticky", top: 0 }}>
          <div style={{ padding: "16px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <b style={{ fontSize: ".95rem" }}>Patients ({patients.length})</b>
            <button onClick={() => refetch()} title="Refresh" style={{ color: "#cbd5e1" }}>⟳</button>
          </div>
          <div style={{ padding: "0 12px 10px" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patients…"
              style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid #22304a", background: "#0f2136", color: "#fff", fontSize: ".9rem" }} />
          </div>
          <div style={{ overflow: "auto", flex: 1, padding: "4px 8px 16px" }}>
            {listed.map((p) => (
              <button key={p.id} onClick={() => { setSelectedId(p.id); setSelectedClinicId(null); }}
                style={{ width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 10, marginBottom: 4, color: "#e2e8f0", background: p.id === selectedId ? "#16324f" : "transparent", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ fontSize: ".72rem", color: "#94a3b8" }}>{p.dateOfIntake || ""}</span>
                </span>
                {hasOverlay(p.id) && <span title="Unsaved edits" style={{ width: 8, height: 8, borderRadius: 999, background: "#f59e0b" }} />}
              </button>
            ))}
            {listed.length === 0 && <p style={{ color: "#94a3b8", fontSize: ".85rem", padding: "8px 12px" }}>{loading ? "Loading…" : error || "No patients"}</p>}
          </div>
        </aside>

        {/* Main */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selected ? (
            <div style={{ padding: 40 }}>
              <p style={{ color: "var(--muted-foreground)" }}>{loading ? "Loading patients from Monday…" : error || "Select a patient to begin."}</p>
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
              addingDoc={addingDoc}
              onAddDoctor={handleAddDoctor}
              checklist={checklist}
              canSubmit={canSubmit}
              missing={missing.map((m) => m.label)}
              submitting={submitting}
              sendingBack={sendingBack}
              onAdvance={handleAdvance}
              onSendBack={handleSendBack}
              onSave={() => { saveOverlay(selected.id); toast.success("Progress saved locally"); }}
              hasOverlay={hasOverlay(selected.id)}
              onFollowUp={() => setFollowUpOpen(true)}
              onReferral={() => setReferralOpen((o) => !o)}
              onBack={goBack}
            />
          )}
        </div>
      </div>

      {referralOpen && selected && (
        <ReferralEmailPanel itemId={selected.id} patientName={selected.name} onClose={() => setReferralOpen(false)} />
      )}
      {selected && (
        <FollowUpModal open={followUpOpen} onOpenChange={setFollowUpOpen} patientId={selected.id} patientName={selected.name} onSuccess={refetch} />
      )}
    </div>
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
  addingDoc: boolean;
  onAddDoctor: () => void;
  checklist: { label: string; ok: boolean }[];
  canSubmit: boolean;
  missing: string[];
  submitting: boolean;
  sendingBack: boolean;
  onAdvance: () => void;
  onSendBack: () => void;
  onSave: () => void;
  hasOverlay: boolean;
  onFollowUp: () => void;
  onReferral: () => void;
  onBack: () => void;
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

function ProfileBody(p: BodyProps) {
  const pt = p.patient;
  const serv = pt.serving || "";
  const cgm = servingIncludes(serv, "cgm");
  const ip = servingIncludes(serv, "insulin pump");
  const primaryApplicable = !!p.suggestion?.value && PRIMARY_LABELS.has(p.suggestion.value);
  // Advisory serving suggestion: base = requested product; add CGM when cross-sell eligible.
  const servingSuggestion = (() => {
    const req = pt.requestType || "";
    if (/cgm/i.test(req)) return req;
    if (crossSellReason(pt.primaryInsurance) === "eligible") {
      return req === "Supplies Only" ? "Supplies + CGM" : req === "Insulin Pump" ? "Insulin Pump + CGM" : req;
    }
    return req;
  })();

  return (
    <div className="page" style={{ maxWidth: "104rem" }}>
      {/* Header */}
      <section className="card header-card">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 24, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <button className="btn secondary sm" onClick={p.onBack}>← Back</button>
              <p className="eyebrow" style={{ margin: 0 }}>Patient · Profile Send-Off</p>
            </div>
            <h1 className="ph-name">{pt.name}</h1>
            <p className="ph-dob">DOB {pt.dob || "—"} · {pt.ptPhone || "—"}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div className="hgroup" style={{ margin: 0 }}><div className="pair">
              <div><div className="eyebrow">Referral Type</div><div className="hval">{pt.referralType || "—"}</div></div>
              <div><div className="eyebrow">Referral Source</div><div className="hval">{pt.referralSource || "—"}</div></div>
            </div></div>
            <span className="stage-chip" style={pt.alreadyInSystem?.toLowerCase() === "yes" ? { background: "var(--mm-rose-soft)", color: "var(--mm-rose)" } : undefined}>
              {pt.alreadyInSystem?.toLowerCase() === "yes" ? "Already In System" : "New Patient"}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn secondary sm" onClick={p.onFollowUp}>◷ Follow Up</button>
              <button className="btn primary sm" onClick={p.onSave} disabled={!p.hasOverlay}>Save</button>
            </div>
          </div>
        </div>
      </section>

      <div className="layout">
        <div className="layout-head">
          <div className="dh lh-recv">What We Received</div>
          <div className="dh lh-work">Profile Completion</div>
        </div>

        {/* Left rail */}
        <aside className="leftrail">
          <div className="rail-card">
            <div className="rail-head">✉ Referral Email</div>
            <div className="rail-body">
              <p className="sugg-note" style={{ marginBottom: 10 }}>Referral thread &amp; updates for this patient.</p>
              <button className="btn secondary sm" onClick={p.onReferral}>Open referral email / updates</button>
            </div>
          </div>
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
                <Field label="Address">
                  <AddressAutocomplete value={pt.patientAddress}
                    onChange={(r) => p.onUpdate({ patientAddress: r.address, patientAddressLat: r.lat || null, patientAddressLng: r.lng || null })}
                    placeholder="Start typing address…" className="" />
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
                  <select value={pt.generalInsurance} onChange={(e) => p.onUpdate({ generalInsurance: e.target.value })}>
                    <option value="" disabled hidden>Select insurance…</option>
                    {GENERAL_INS_OPTS.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Member ID" required>
                  <input type="text" value={pt.workingMemberId || pt.memberId1}
                    onChange={(e) => p.onUpdate({ workingMemberId: e.target.value })} placeholder="Member ID…" />
                </Field>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
                <button className="btn primary" onClick={p.onRunStedi} disabled={p.stediRunning}>
                  {p.stediRunning ? "Running…" : "Run Stedi Check"}
                </button>
                {pt.stediErrorDescription && !pt.stediPlanName && <span className="method-pill fax" style={{ background: "var(--mm-rose-soft)", color: "var(--mm-rose)" }}>Failed</span>}
                {pt.stediEligibilityActive && <span className={`method-pill ${p.stediActive ? "chute" : "fax"}`}>{p.stediActive ? "Active" : pt.stediEligibilityActive}</span>}
              </div>

              {/* Eligibility results */}
              {(pt.stediPlanName || pt.stediEligibilityActive || pt.stediErrorDescription) && (
                <div className="res-grid">
                  <ResCell label="Active?" value={pt.stediEligibilityActive} bad={!!pt.stediEligibilityActive && !p.stediActive} />
                  <ResCell label="Payer Name" value={pt.stediPayerName} />
                  <ResCell label="Plan Begin Date" value={pt.stediPlanBeginDate} />
                  <ResCell label="Coverage Type" value={pt.stediCoverageType} />
                  <ResCell label="Plan Name" value={pt.stediPlanName} />
                  <ResCell label="Home Plan" value={pt.stediHomePlan} />
                  <ResCell label="Medicaid ID" value={pt.stediMedicaidId} />
                  <ResCell label="QMB?" value={pt.stediQmb} />
                </div>
              )}
              {pt.stediErrorDescription && !pt.stediPlanName && (
                <div className="err-banner" style={{ marginTop: 16 }}>
                  <div className="et">Eligibility check failed</div>
                  <div className="ed">{pt.stediErrorDescription}</div>
                </div>
              )}

              {/* Post-Stedi — insurance + suggestions */}
              {(pt.stediPlanName || pt.stediEligibilityActive) && (
                <div id="post-stedi" style={{ marginTop: 22, border: "1.5px solid var(--amber-ring)", borderRadius: 12, background: "oklch(0.96 0.04 90 / 0.35)", padding: "18px 20px" }}>
                  {p.suggestion && (
                    <div className="sugg-chip" style={{ marginTop: 0, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <b>Suggested from Stedi:</b>
                      {p.suggestion.value ? <span className="sugg-chip2">{p.suggestion.value}</span> : <span className="sugg-note">{p.suggestion.reason || "Check the card"}</span>}
                      {p.suggestion.value && primaryApplicable && pt.primaryInsurance !== p.suggestion.value && (
                        <button className="btn secondary sm" onClick={() => p.onUpdate({ primaryInsurance: p.suggestion!.value! })}>Use</button>
                      )}
                      {p.secondarySuggestion && <span className="sugg-note">· secondary: {p.secondarySuggestion}
                        {pt.secondaryInsurance !== p.secondarySuggestion && <button className="btn secondary sm" style={{ marginLeft: 6 }} onClick={() => p.onUpdate({ secondaryInsurance: p.secondarySuggestion })}>Use</button>}</span>}
                    </div>
                  )}
                  <div className="fgrid">
                    <Field label="Primary Insurance" required>
                      <select className={pt.primaryInsurance ? "filled" : "need"} value={pt.primaryInsurance} onChange={(e) => p.onUpdate({ primaryInsurance: e.target.value })}>
                        <option value="" disabled hidden>Select…</option>
                        {groupPrimaryInsuranceLabels().map(({ group, labels }) => (
                          <optgroup key={group} label={group}>{labels.map((l) => <option key={l}>{l}</option>)}</optgroup>
                        ))}
                      </select>
                    </Field>
                    <Field label="Member ID 1" required>
                      <input type="text" value={pt.memberId1 || pt.workingMemberId} onChange={(e) => p.onUpdate({ memberId1: e.target.value })} placeholder="Member ID…" />
                    </Field>
                    <Field label="Secondary Insurance" required>
                      <select className={pt.secondaryInsurance ? "filled" : "need"} value={pt.secondaryInsurance} onChange={(e) => p.onUpdate({ secondaryInsurance: e.target.value })}>
                        <option value="" disabled hidden>Select…</option>
                        {SECONDARY_OPTS.map((l) => <option key={l}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label={pt.secondaryInsurance === "NY Medicaid" ? "Member ID 2 (required)" : "Member ID 2"}>
                      <input type="text" value={pt.memberId2} onChange={(e) => p.onUpdate({ memberId2: e.target.value })} placeholder="Member ID…" />
                    </Field>
                  </div>
                  {/* Working cost-sharing */}
                  <div className="fgrid" style={{ marginTop: 14 }}>
                    <Field label="Co-insurance %"><input type="text" value={pt.workingCoinsurance || pt.stediCoinsurance} onChange={(e) => p.onUpdate({ workingCoinsurance: e.target.value })} /></Field>
                    <Field label="Deductible Remaining"><input type="text" value={pt.workingDeductibleRemaining || pt.stediIndividualDeductibleRemaining} onChange={(e) => p.onUpdate({ workingDeductibleRemaining: e.target.value })} /></Field>
                    <Field label="OOP Max Remaining"><input type="text" value={pt.workingOopMaxRemaining || pt.stediIndividualOopMaxRemaining} onChange={(e) => p.onUpdate({ workingOopMaxRemaining: e.target.value })} /></Field>
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
                <div className="f full"><div className="k">Referral Source</div><div className="v">{pt.referralSource || "—"}</div></div>
              </div>
            </section>
            <div className="work-col">
              <section className="card step-card">
                <header className="step-head"><span className="step-num">3</span><h2>Serving &amp; Coverage</h2></header>
                <div className="fgrid">
                  <div className="full">
                    {servingSuggestion && servingSuggestion !== serv && (
                      <div className="sugg-line" style={{ marginBottom: 8 }}>
                        <span className="sugg-lead2">Suggestion:</span>
                        <span className="sugg-chip2">{servingSuggestion}</span>
                        <button className="btn secondary sm" onClick={() => p.onUpdate({ serving: servingSuggestion })}>Use</button>
                      </div>
                    )}
                    <Field label="Serving" required>
                      <select className={serv ? "filled" : "need"} value={serv} onChange={(e) => p.onUpdate({ serving: e.target.value })}>
                        <option value="" disabled hidden>Select what we're serving…</option>
                        {SERVING_OPTS.map((l) => <option key={l}>{l}</option>)}
                      </select>
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
                <div className="f"><div className="k">NPI</div><div className="v">{pt.doctorNpi || "—"}</div></div>
                <div className="f"><div className="k">Clinic Phone</div><div className="v">{pt.doctorPhone || "—"}</div></div>
                <div className="f full"><div className="k">Clinic Address</div><div className="v">{pt.clinicAddress || "—"}</div></div>
              </div>
            </section>
            <div className="work-col">
              <section className="card step-card">
                <header className="step-head"><span className="step-num">4</span><h2>Select Correct Provider</h2></header>
                <div className="fgrid">
                  <Field label="Doctor Name"><input type="text" value={pt.doctorName} onChange={(e) => p.onUpdate({ doctorName: e.target.value })} /></Field>
                  <Field label="Doctor NPI"><input type="text" value={pt.doctorNpi} onChange={(e) => p.onUpdate({ doctorNpi: e.target.value })} /></Field>
                  <Field label="Doctor Phone"><input type="text" value={pt.doctorPhone} onChange={(e) => p.onUpdate({ doctorPhone: e.target.value })} /></Field>
                  <Field label="Clinicals Method">
                    <select value={pt.clinicalsMethod} onChange={(e) => p.onUpdate({ clinicalsMethod: e.target.value })}>
                      <option value="" disabled hidden>Select…</option>
                      <option>Fax</option><option>Parachute</option><option>Email</option>
                    </select>
                  </Field>
                  <Field label="Doctor Email"><input type="text" value={pt.doctorEmail} onChange={(e) => p.onUpdate({ doctorEmail: e.target.value })} /></Field>
                  <Field label={pt.clinicalsMethod === "Fax" ? "Doctor Fax (required)" : "Doctor Fax (@rcfax)"}>
                    <input type="text" className={pt.clinicalsMethod === "Fax" && !pt.doctorFax ? "need" : ""} value={pt.doctorFax} onChange={(e) => p.onUpdate({ doctorFax: e.target.value })} />
                  </Field>
                  <Field label="Clinic Name">
                    <select value={pt.clinicName} onChange={(e) => {
                      const l = p.clinicLabels.find((c) => c.name === e.target.value);
                      if (l) p.onClinicSelect(l.id, l.name);
                    }}>
                      <option value="" disabled hidden>Select clinic…</option>
                      {pt.clinicName && !p.clinicLabels.some((c) => c.name === pt.clinicName) && <option>{pt.clinicName}</option>}
                      {p.clinicLabels.map((c) => <option key={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <div className="full"><Field label="Clinic Address">
                    <AddressAutocomplete value={pt.clinicAddress} onChange={(r) => p.onUpdate({ clinicAddress: r.address, clinicAddressLat: r.lat || null, clinicAddressLng: r.lng || null })} placeholder="Start typing clinic address…" className="" />
                  </Field></div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button className="btn secondary sm" onClick={p.onAddDoctor} disabled={p.addingDoc}>{p.addingDoc ? "Adding…" : "Add Doctor to Database"}</button>
                </div>
                {/* Records contact / Doctor Notes (Option A) — reads + edits Doctor DB by NPI */}
                <div style={{ marginTop: 14 }}><DoctorNotesPanel doctorNpi={pt.doctorNpi} doctorName={pt.doctorName} /></div>
                <div style={{ marginTop: 14 }}>
                  <ParachuteLookupPanel defaultTerm={pt.doctorName} phoneHint={pt.doctorPhone}
                    onPick={(d) => {
                      const method = d.doctor_contact === "parachute" ? "Parachute" : "Fax";
                      p.onUpdate({ doctorName: `${d.first_name} ${d.last_name}`, doctorNpi: d.npi, clinicalsMethod: method });
                      toast.success(`Doctor filled: ${d.first_name} ${d.last_name} — NPI ${d.npi}`);
                    }} />
                </div>
                <div style={{ marginTop: 14 }}><DoctorFollowers doctorNpi={pt.doctorNpi} /></div>
              </section>
            </div>
          </div>

          {/* Row 5 — notes */}
          <div className="duo"><div className="leftcol" />
            <section className="card step-card">
              <header className="step-head"><span className="step-num">5</span><h2>Notes</h2></header>
              <textarea value={pt.notes} onChange={(e) => p.onUpdate({ notes: e.target.value })} style={{ minHeight: 90 }} placeholder="Notes…" />
            </section>
          </div>

          {/* Row 6 — ready to send off */}
          <div className="duo"><div className="leftcol" />
            <section className="card" style={{ borderLeft: "4px solid var(--mm-teal)" }}>
              <header className="step-head"><span className="step-num">6</span><h2>Ready to Send Off?</h2>
                <span className="right">{p.canSubmit ? <span className="mp green">Ready</span> : <span className="mp">{p.missing.length} missing</span>}</span>
              </header>
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

export default ProfilePage;
