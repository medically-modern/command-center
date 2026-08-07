/**
 * Unverified Referrals — the DTC + CareCentrix intake stage.
 *
 * A SEPARATE page from ProfilePage on purpose. ProfilePage serves the Verified
 * Referrals send-off and Already In System, and this stage's redesign must not
 * change either of them — the only way to guarantee that is to not share the
 * component. Shared building blocks (DoctorSection, the insurance engine) are
 * imported rather than copied.
 *
 * Two panes (HANDOFF §2):
 *   Left  — Patient Info Collection. Everything the patient gave us, rep-editable.
 *   Right — Patient Profile Clean-Up. Locked until all four unlock conditions pass.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, Lock, Check, X } from "lucide-react";

import { useMondayPatients } from "@/hooks/profile/useMondayPatients";
import { GROUPS, fetchClinicLabels } from "@/lib/profile/mondayApi";
// §6.1: this is the EXISTING component, unchanged. Search, Parachute panel,
// location grid, order count and notes all behave exactly as on /profile —
// rebuilding it would fork behaviour reps already rely on.
import { DoctorSection } from "@/components/profile/DoctorSection";
import { evaluateUnlock } from "@/lib/profile/intakeUnlock";
import {
  PRIMARY_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX, SERVING_INDEX,
  GENERAL_INSURANCE_INDEX, REQUEST_TYPE_INDEX,
  CGM_COVERAGE_PATH_INDEX, INSULIN_PUMP_COVERAGE_PATH_INDEX,
} from "@/lib/profile/mondayMapping";
import {
  writeIntakeEdits, writeVerifiedInsurance, logContactAttempt,
  advanceToMedicalNecessity, escalateIntake, proposeIntakeStuck, returnIntakeToPipeline,
  type IntakeEdits, type VerifiedEdits,
} from "@/lib/profile/unverifiedWrite";
import { useStediRun, STEDI_POLL_MS } from "@/hooks/profile/useStediRun";
import {
  suggestPrimary, suggestSecondary, buildSuggestionInputs,
} from "@/lib/profile/primaryInsurance";
import type { Patient } from "@/lib/profile/workflow";
// The shared bar, so this stage's Propose Stuck / Send back to pipeline are
// literally the same component and copy Medical Evaluation uses — not a
// lookalike that can drift from it.
import { StageActionBar } from "@/components/shared/StageActionBar";
// The live sidebar and header, so this page sits in the same chrome as every
// other Command Center stage instead of inventing its own.
import { PatientsSidebar } from "@/components/profile/PatientsSidebar";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
// redesign.css is the shared design system (DoctorSection's markup is scoped
// under .pf-root too, so it looks identical here and on send-off).
// intake.css adds the two-pane shell and lock that only this page uses.
import "./profile/redesign.css";
import "./profile/intake.css";

/** Which pool is on screen. This role is the DTC + CareCentrix queue: "intake"
 *  is the 1. Intake group (CareCentrix + legacy referrals); the other two are
 *  the DTC intake form's own groups on the same board. */
type Source = "intake" | "completed" | "partial";

const SOURCE_GROUP: Record<Source, string | undefined> = {
  intake: undefined, // hook default — GROUPS.intake
  completed: GROUPS.newFormCompleted,
  partial: GROUPS.newFormPartial,
};

const SOURCE_LABEL: Record<Source, string> = {
  intake: "Referrals",
  completed: "Completed forms",
  partial: "Partial forms",
};

/** "Not Serving" is a real board label but never a pickable option — same rule
 *  ProfilePage applies, so the two pages offer identical choices. */
const noNotServing = (labels: string[]) => labels.filter((l) => l !== "Not Serving");
const SERVING_OPTS = noNotServing(Object.keys(SERVING_INDEX));
const REQUEST_TYPE_OPTS = noNotServing(Object.keys(REQUEST_TYPE_INDEX));
const CGM_PATH_OPTS = noNotServing(Object.keys(CGM_COVERAGE_PATH_INDEX));
const IP_PATH_OPTS = noNotServing(Object.keys(INSULIN_PUMP_COVERAGE_PATH_INDEX));
const GENERAL_INSURANCE_OPTS = Object.keys(GENERAL_INSURANCE_INDEX);

/** Read-only field. Used for anything the patient told us that the rep is not
 *  expected to retype — the left pane should be a confirmation, not data entry. */
function Field({ label, value, full }: { label: string; value?: string; full?: boolean }) {
  return (
    <div className={full ? "f full" : "f"}>
      <div className="k">{label}</div>
      <div className="v">{value?.trim() || "—"}</div>
    </div>
  );
}

/** Where a value came from and where it lands. The mockup puts this under
 *  every field so a rep can tell at a glance what the patient typed versus
 *  what someone here entered. */
function Prov({ src, col, isNew }: { src: "form" | "rep" | "derived"; col: string; isNew?: boolean }) {
  const label = src === "form" ? "From form" : src === "rep" ? "Rep enters" : "Derived";
  return (
    <div className="prov">
      <span className={`src ${src}`}>{label}</span>
      <span className="arw">→</span>
      <span className={isNew ? "col isnew" : "col"}>{col}</span>
    </div>
  );
}

function EditText({
  label, value, onChange, placeholder, prov, full,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  prov?: React.ReactNode; full?: boolean;
}) {
  return (
    <label className={full ? "fld full" : "fld"}>
      <div className="flabel">{label}</div>
      <input
        type="text"
        className={value.trim() ? "filled" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {prov}
    </label>
  );
}

function EditSelect({
  label, value, options, onChange, prov, full,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
  prov?: React.ReactNode; full?: boolean;
}) {
  return (
    <label className={full ? "fld full" : "fld"}>
      <div className="flabel">{label}</div>
      <select
        className={value.trim() ? "filled" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {/* Blank board labels are dropped: Monday leaves an empty slot behind
            when a status is removed, and it would render as a nameless option. */}
        {options.filter((o) => o.trim() !== "").map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {prov}
    </label>
  );
}

/** A section card inside a pane. `tone` maps to the mockup's coloured left
 *  border: lead = green (what we already know), decide = teal (an action). */
function Card({
  title, children, tone, right,
}: {
  title: string; children: React.ReactNode;
  tone?: "lead" | "decide" | "hilite"; right?: React.ReactNode;
}) {
  return (
    <section className={tone ? `sect ${tone}` : "sect"}>
      <div className="sect-title">
        {title}
        {right && <span className="rt">{right}</span>}
      </div>
      {children}
    </section>
  );
}

const UnverifiedReferralsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const sourceParam = searchParams.get("source");
  const source: Source =
    sourceParam === "completed" || sourceParam === "partial" ? sourceParam : "intake";

  const {
    patients, loading, initialLoading, error, refetch, updateLocal, hasOverlay,
  } = useMondayPatients(searchParams.get("patientId"), SOURCE_GROUP[source]);

  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("patientId"));
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  // An escalated patient is a manager's problem, not the rep's — same rule the
  // Medical Evaluation queues apply. Managers clicking in from an oversight
  // column carry ?origin=, and for them the escalated patients are the ONLY
  // ones worth showing, so the filter inverts rather than disappearing.
  const managerOrigin = searchParams.get("origin");
  const visible = useMemo(() => {
    const escalated = (p: Patient) =>
      p.intakeEscalation === "Manager Escalation Required" ||
      p.intakeEscalation === "Final Escalation Required";
    if (managerOrigin === "manager-intervention") {
      return patients.filter((p) => p.intakeEscalation === "Manager Escalation Required");
    }
    if (managerOrigin === "final-decisions") {
      return patients.filter((p) => p.intakeEscalation === "Final Escalation Required");
    }
    return patients.filter((p) => !escalated(p));
  }, [patients, managerOrigin]);

  const selected = useMemo(
    () => visible.find((p) => p.id === selectedId) ?? visible[0] ?? null,
    [visible, selectedId],
  );

  const unlock = useMemo(() => evaluateUnlock(selected), [selected]);

  const [verified, setVerified] = useState<VerifiedEdits>({});

  /** "Ready to Send Off?" — what still has to be true before this patient can
   *  go to Medical Necessity. Same shape as the send-off page's checklist, and
   *  like that one it is DERIVED, never stored: the only way it can disagree
   *  with the board is if a field below it is wrong.
   *  Coverage paths are conditional on what we're actually serving — asking for
   *  a pump path on a CGM-only patient is noise. */
  const readiness = useMemo(() => {
    if (!selected) return [] as { label: string; ok: boolean }[];
    const serving = (selected.serving || "").trim();
    const items = [
      { label: "Primary Insurance", ok: !!(verified.primaryInsurance ?? "").trim() },
      { label: "Member ID 1", ok: !!(verified.memberId1 ?? "").trim() },
      { label: "Serving", ok: !!serving },
    ];
    if (/CGM/i.test(serving)) {
      items.push({ label: "CGM Coverage Path", ok: !!(selected.cgmCoveragePath ?? "").trim() });
    }
    if (/Pump/i.test(serving)) {
      items.push({
        label: "Insulin Pump Coverage Path",
        ok: !!(selected.insulinPumpCoveragePath ?? "").trim(),
      });
    }
    // The doctor carries to Medical Necessity and is what Send Request needs.
    items.push({ label: "Doctor selected", ok: !!(selected.doctorNpi ?? "").trim() });
    return items;
  }, [selected, verified.primaryInsurance, verified.memberId1]);

  const readyMissing = readiness.filter((i) => !i.ok).length;

  // ── Benefits check ──────────────────────────────────────────────────────
  const stedi = useStediRun();

  // While a run is in flight the service streams results back one column at a
  // time, so poll and let the hook decide when the whole set has settled.
  useEffect(() => {
    if (!stedi.isRunning) return;
    const id = window.setInterval(() => { void refetch(true); }, STEDI_POLL_MS);
    return () => window.clearInterval(id);
  }, [stedi.isRunning, refetch]);

  useEffect(() => { stedi.observe(selected); }, [selected, stedi]);

  // ── Right pane pre-fill ─────────────────────────────────────────────────
  // The derived values arrive already entered, not as a chip the rep has to
  // click (HANDOFF §4). The engine resolves home state from patientAddress,
  // which a form patient doesn't have — feed them the State they gave us, or
  // it returns no suggestion at all (§8.2).
  const suggestion = useMemo(() => {
    if (!selected) return null;
    const forEngine = {
      ...selected,
      patientAddress: selected.patientAddress?.trim() || selected.formState || "",
    } as Patient;
    const inputs = buildSuggestionInputs(forEngine);
    return { primary: suggestPrimary(inputs), secondary: suggestSecondary(inputs) };
  }, [selected]);

  const seededFor = useRef<string | null>(null);

  // Seed once per patient: what's on the board wins, the engine fills the
  // blanks. Re-seeding on every render would fight the rep's typing.
  useEffect(() => {
    if (!selected) return;
    const key = `${selected.id}:${suggestion?.primary?.value ?? ""}`;
    if (seededFor.current === key) return;
    seededFor.current = key;
    setVerified({
      primaryInsurance: selected.primaryInsurance || suggestion?.primary?.value || "",
      memberId1: selected.memberId1 || selected.workingMemberId || "",
      secondaryInsurance: selected.secondaryInsurance || suggestion?.secondary || "",
      memberId2: selected.memberId2 || "",
      // serving deliberately NOT seeded here — it lives on the patient, because
      // the Serving & Coverage card and the left pane's product fields edit the
      // same Monday columns. Two copies of that state is how they drift.
    });
  }, [selected, suggestion]);

  const saveVerified = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setSaveNote(null);
    try {
      // Serving rides along from the patient, not from `verified` — same value
      // the left pane and the Serving & Coverage card both edit.
      const res = await writeVerifiedInsurance(selected.id, {
        ...verified,
        serving: selected.serving,
      });
      setSaveNote(res.ok ? "Verified insurance saved." : res.errors.map((e) => `${e.label}: ${e.error}`).join(" · "));
      if (res.ok) await refetch(true);
    } finally {
      setSaving(false);
    }
  }, [selected, verified, refetch]);

  /** A partial fill-out is an incomplete form, not a workable referral. The
   *  advance path is meaningless for them — parked until that flow is designed. */
  const isPartial = source === "partial";

  const switchSource = useCallback((next: Source) => {
    const params = new URLSearchParams(searchParams);
    if (next === "intake") params.delete("source");
    else params.set("source", next);
    // Selection is per-pool; carrying it over would deep-link a patient that
    // isn't in the list being switched to.
    params.delete("patientId");
    setSearchParams(params, { replace: true });
    setSelectedId(null);
    setSaveNote(null);
  }, [searchParams, setSearchParams]);

  const edit = useCallback((patch: Partial<Patient>) => {
    if (!selected) return;
    updateLocal(selected.id, patch);
  }, [selected, updateLocal]);

  const save = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setSaveNote(null);
    const edits: IntakeEdits = {
      name: selected.name,
      ptPhone: selected.ptPhone,
      dob: selected.dob,
      email: selected.email,
      formState: selected.formState,
      // Product decision — shared with the right pane's Serving & Coverage card.
      requestType: selected.requestType,
      cgmCoveragePath: selected.cgmCoveragePath,
      insulinPumpCoveragePath: selected.insulinPumpCoveragePath,
      workingMemberId: selected.workingMemberId,
      generalInsurance: selected.generalInsurance,
      formInsuranceVia: selected.formInsuranceVia,
      formInsuranceOther: selected.formInsuranceOther,
      formSecondaryProvided: selected.formSecondaryProvided,
      formSecondaryMemberId: selected.formSecondaryMemberId,
      formReasonForInquiry: selected.formReasonForInquiry,
      formPumpNeed: selected.formPumpNeed,
      formCgmPreference: selected.formCgmPreference,
      formPumpPreference: selected.formPumpPreference,
      formProvidedDoctorName: selected.formProvidedDoctorName,
      formProvidedClinicPhone: selected.formProvidedClinicPhone,
      formProceedPreference: selected.formProceedPreference,
      formCallSlot: selected.formCallSlot,
      formBookingStatus: selected.formBookingStatus,
      intakeCallComplete: (selected.intakeCallComplete ?? "").trim().toLowerCase() === "yes",
      selfAdvocacy: selected.selfAdvocacy,
      currentOopCost: selected.currentOopCost,
      cgmDataAwareness: selected.cgmDataAwareness,
      notes: selected.notes,
    };
    try {
      const res = await writeIntakeEdits(selected.id, edits);
      // Partial success is reported, not swallowed — the rep needs to know
      // exactly which field didn't make it rather than a blanket "saved".
      setSaveNote(
        res.ok
          ? "Saved."
          : `Saved, except: ${res.errors.map((e) => e.label).join(", ")}`,
      );
      await refetch(true);
    } catch (e) {
      setSaveNote(e instanceof Error ? `Save failed — ${e.message}` : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [selected, refetch]);

  const [escalateReason, setEscalateReason] = useState("");

  // Doctor DB clinic dropdown labels — fetched once, same source as /profile.
  const [clinicLabels, setClinicLabels] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    fetchClinicLabels()
      .then((l) => { if (alive) setClinicLabels(l); })
      .catch(() => { /* dropdown just stays empty — not worth blocking the page */ });
    return () => { alive = false; };
  }, []);

  const runStageAction = useCallback(
    async (kind: "advance" | "escalate" | "proposeStuck" | "return") => {
      if (!selected) return;
      if (kind !== "advance" && !escalateReason.trim()) {
        setSaveNote("Add a reason first — a manager can't action a blank escalation.");
        return;
      }
      setSaving(true);
      setSaveNote(null);
      try {
        const notes = selected.intakeEscalationNotes;
        const res =
          kind === "advance" ? await advanceToMedicalNecessity(selected.id)
          : kind === "escalate" ? await escalateIntake(selected.id, escalateReason, notes)
          : kind === "proposeStuck" ? await proposeIntakeStuck(selected.id, escalateReason, notes)
          : await returnIntakeToPipeline(selected.id, escalateReason, notes);
        setSaveNote(
          res.ok
            ? kind === "advance" ? "Advanced to Medical Necessity."
              : kind === "escalate" ? "Escalated to Manager Intervention."
              : kind === "proposeStuck" ? "Proposed stuck — sent to Final Decisions."
              : "Sent back to the pipeline."
            : res.errors.map((e) => `${e.label}: ${e.error}`).join(" · "),
        );
        if (res.ok) { setEscalateReason(""); await refetch(true); }
      } finally {
        setSaving(false);
      }
    },
    [selected, escalateReason, refetch],
  );

  // Declared after save() deliberately: naming it in the dependency array
  // before the const initialises would throw on first render.
  const runBenefitsCheck = useCallback(async () => {
    if (!selected) return;
    setSaveNote(null);
    // Persist the rep's edits first — the check reads General Insurance and
    // Member ID off the BOARD, not off this page's local state.
    await save();
    await stedi.start(selected);
  }, [selected, stedi, save]);

  const logAttempt = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const next = await logContactAttempt(selected.id, selected.attemptCounter);
      edit({ attemptCounter: String(next) });
      setSaveNote(`Attempt ${next} logged.`);
      await refetch(true);
    } catch (e) {
      setSaveNote(e instanceof Error ? `Could not log attempt — ${e.message}` : "Could not log attempt.");
    } finally {
      setSaving(false);
    }
  }, [selected, edit, refetch]);

  const attempts = Number(selected?.attemptCounter || 0);

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      {/* .pf-root scopes the whole Command Center design system (redesign.css)
          plus this page's additions (intake.css). Without it every class below
          is inert — which is exactly how this page shipped the first time. */}
      {/* h-screen, not min-h-screen: the panes below scroll INTERNALLY, which
          needs a definite height to shrink against. With min-h-screen the
          chain has no upper bound, the panes grow to content, and the wheel
          stops working over them entirely. */}
      <div className="pf-root h-screen overflow-hidden flex w-full bg-gradient-subtle">
        <PatientsSidebar
          patients={visible}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          error={error}
          onRefresh={refetch}
          /* Verified Referrals passes this too — it's what draws the
             unsaved-edit marker. Without it this sidebar silently loses a
             cue reps rely on, which is most of why it read as "odd". */
          hasOverlay={hasOverlay}
        />

        {/* panes-host is the CONTAINER the two-pane split queries against, so
            the layout keys off the width the panes actually have rather than
            the window's — the sidebar takes ~256px of that, and collapses. */}
        <div className="panes-host flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border flex-none">
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <ClipboardCheck className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Patient Intake — DTC &amp; CareCentrix</h1>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {(Object.keys(SOURCE_GROUP) as Source[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => switchSource(s)}
                        className={
                          "rounded-full px-3 py-1 text-xs font-semibold transition-colors " +
                          (source === s ? "bg-white text-navy shadow" : "bg-white/10 text-white/80 hover:bg-white/20")
                        }
                      >
                        {SOURCE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </header>

          {error && (
            <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm flex-none">
              {error}
            </div>
          )}

          {/* Patient header strip — who you are working, and how many times
              anyone has tried to reach them. The badge goes solid teal once a
              call has actually been logged. */}
          {selected && (
            <div className="phdr">
              <div className="who">
                <div className="nm">{selected.name}</div>
                <div className="sub">
                  {[selected.dob, selected.ptPhone, selected.email].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div className="spacer" />
              <span className={attempts > 0 ? "attempt-badge" : "attempt-badge auto"}>
                <span className="dot" />
                {attempts === 0 ? "No contact attempts yet" : `Attempt ${attempts}`}
              </span>
            </div>
          )}

          {!selected ? (
            <div className="sect m-6 text-sm text-muted-foreground">Select a patient.</div>
          ) : (
            <div className="panes">
              {/* ── LEFT: Patient Info. Collection ── */}
              <div className="pane">
                <div className="pane-head">
                  <h2>Patient Info. Collection</h2>
                  <span className="st open">Open</span>
                </div>
              <Card title="Patient Demographics">
                <div className="grid grid-cols-2 gap-3">
                  {/* Name and phone are form-typed, so they are correctable —
                      and the benefits check runs against the name. */}
                  <EditText label="Name" value={selected.name ?? ""} onChange={(v) => edit({ name: v })} />
                  <EditText label="Phone" value={selected.ptPhone ?? ""} onChange={(v) => edit({ ptPhone: v })} />
                  <EditText label="Date of Birth" value={selected.dob ?? ""} onChange={(v) => edit({ dob: v })} />
                  <EditText label="Email" value={selected.email ?? ""} onChange={(v) => edit({ email: v })} />
                  <EditText label="State" value={selected.formState ?? ""} onChange={(v) => edit({ formState: v })} />
                  <Field label="Date of Intake" value={selected.dateOfIntake} />
                </div>
              </Card>

              <Card title="Why they came">
                <div className="grid grid-cols-2 gap-3">
                  <EditSelect
                    label="Reason for Inquiry"
                    value={selected.formReasonForInquiry ?? ""}
                    onChange={(v) => edit({ formReasonForInquiry: v })}
                    options={[
                      "Pharmacy is too expensive",
                      "Denied by insurance",
                      "I need a new supplier",
                      "I want off the finger prick / try a pump",
                    ]}
                  />
                </div>
              </Card>

              <Card title="What they need">
                <div className="grid grid-cols-2 gap-3">
                  {/* Same Monday column as the Serving & Coverage card on the
                      right — one value, edited from whichever pane you're in. */}
                  <EditSelect
                    label="Request Type"
                    value={selected.requestType ?? ""}
                    onChange={(v) => edit({ requestType: v })}
                    options={REQUEST_TYPE_OPTS}
                  />
                  <EditSelect
                    label="Pump Need"
                    value={selected.formPumpNeed ?? ""}
                    onChange={(v) => edit({ formPumpNeed: v })}
                    options={["Need a new pump", "Only need supplies"]}
                  />
                  <EditSelect
                    label="CGM preference (patient's answer)"
                    value={selected.formCgmPreference ?? ""}
                    onChange={(v) => edit({ formCgmPreference: v })}
                    options={["Freestyle Libre 3 Plus", "Dexcom G7", "Medtronic Guardian 4", "Any will work"]}
                  />
                  <EditSelect
                    label="Pump preference (patient's answer)"
                    value={selected.formPumpPreference ?? ""}
                    onChange={(v) => edit({ formPumpPreference: v })}
                    options={["Tandem t:slim X2", "Tandem Mobi", "Beta Bionics iLet", "Not sure"]}
                  />
                  <EditSelect
                    label="CGM Coverage Path"
                    value={selected.cgmCoveragePath ?? ""}
                    onChange={(v) => edit({ cgmCoveragePath: v })}
                    options={CGM_PATH_OPTS}
                  />
                  <EditSelect
                    label="Insulin Pump Coverage Path"
                    value={selected.insulinPumpCoveragePath ?? ""}
                    onChange={(v) => edit({ insulinPumpCoveragePath: v })}
                    options={IP_PATH_OPTS}
                  />
                </div>
              </Card>

              <Card title="Insurance — as provided">
                <div className="grid grid-cols-2 gap-3">
                  {/* Editable, and written by Save — which the benefits check
                      runs FIRST, because Stedi reads this column off the board
                      rather than off this page. */}
                  <EditSelect
                    label="General Insurance"
                    value={selected.generalInsurance ?? ""}
                    onChange={(v) => edit({ generalInsurance: v })}
                    options={GENERAL_INSURANCE_OPTS}
                  />
                  <EditText
                    label="Member ID (Stedi reads this)"
                    value={selected.workingMemberId ?? ""}
                    onChange={(v) => edit({ workingMemberId: v })}
                  />
                  <EditSelect
                    label="Provided via"
                    value={selected.formInsuranceVia ?? ""}
                    onChange={(v) => edit({ formInsuranceVia: v })}
                    options={["Photo of card", "Entered manually", "Not provided"]}
                  />
                  <EditText
                    label="Insurance (Other) — as typed"
                    value={selected.formInsuranceOther ?? ""}
                    onChange={(v) => edit({ formInsuranceOther: v })}
                  />
                  <EditSelect
                    label="Secondary (as provided)"
                    value={selected.formSecondaryProvided ?? ""}
                    onChange={(v) => edit({ formSecondaryProvided: v })}
                    options={[
                      "Anthem or Blue Cross Blue Shield", "UnitedHealthcare", "Aetna", "Cigna",
                      "Humana", "Medicare", "Fidelis", "NYSHIP Empire", "Other", "None", "NYS Medicaid",
                    ]}
                  />
                  <EditText
                    label="Secondary Member ID"
                    value={selected.formSecondaryMemberId ?? ""}
                    onChange={(v) => edit({ formSecondaryMemberId: v })}
                  />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={runBenefitsCheck}
                    disabled={saving || stedi.isRunning || !(selected.generalInsurance ?? "").trim()}
                    className="btn primary sm"
                  >
                    {stedi.isRunning ? "Running benefits check…" : "Run benefits check"}
                  </button>
                  {stedi.state.message && (
                    <span className={"text-xs " + (stedi.state.phase === "error" ? "text-destructive" : "text-muted-foreground")}>
                      {stedi.state.message}
                    </span>
                  )}
                  {!(selected.generalInsurance ?? "").trim() && (
                    <span className="text-xs text-muted-foreground">Needs General Insurance first.</span>
                  )}
                </div>
                {selected.stediErrorDescription?.trim() && (
                  <p className="mt-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                    Last check failed: {selected.stediErrorDescription}
                  </p>
                )}
                {(selected.formInsuranceVia ?? "") === "Not provided" && (
                  <p className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                    No card provided — the patient was asked to text a photo to (347) 503-7148.
                  </p>
                )}
              </Card>

              <Card title="Doctor — as provided by the patient">
                <div className="grid grid-cols-2 gap-3">
                  <EditText
                    label="Provided Doctor Name"
                    value={selected.formProvidedDoctorName ?? ""}
                    onChange={(v) => edit({ formProvidedDoctorName: v })}
                  />
                  <EditText
                    label="Provided Clinic Phone / Location"
                    value={selected.formProvidedClinicPhone ?? ""}
                    onChange={(v) => edit({ formProvidedClinicPhone: v })}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Write-once reference. Picking a provider on the right does not overwrite these.
                </p>
              </Card>

              <Card title="On the call">
                <div className="grid grid-cols-2 gap-3">
                  <EditSelect
                    label="Self Advocacy"
                    value={selected.selfAdvocacy ?? ""}
                    onChange={(v) => edit({ selfAdvocacy: v })}
                    options={["High", "Low"]}
                  />
                  <EditText
                    label="Current out-of-pocket cost"
                    placeholder="$75/month"
                    value={selected.currentOopCost ?? ""}
                    onChange={(v) => edit({ currentOopCost: v })}
                  />
                  <EditSelect
                    label="CGM Data & Doctor Awareness"
                    value={selected.cgmDataAwareness ?? ""}
                    onChange={(v) => edit({ cgmDataAwareness: v })}
                    options={["Patient has existing data", "Doctor is aware", "Neither applies", "Both apply"]}
                  />
                  <Field label="Contact attempts" value={selected.attemptCounter} />
                </div>
              </Card>

              <Card title="Call handling">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Proceed preference" value={selected.formProceedPreference} />
                  <Field label="Slot picked on form" value={selected.formCallSlot} />
                  <Field label="Booking status" value={selected.formBookingStatus} />
                </div>
                {/* Hidden when the patient already authorised us — the checkbox
                    is irrelevant then and must not be shown (HANDOFF §7.2). */}
                {(selected.formProceedPreference ?? "") !== "Send request now" && (
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={(selected.intakeCallComplete ?? "").trim().toLowerCase() === "yes"}
                      onChange={(e) => edit({ intakeCallComplete: e.target.checked ? "Yes" : "" })}
                    />
                    Intake call complete
                  </label>
                )}
              </Card>

              <div className="flex items-center gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="btn primary"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={logAttempt}
                  disabled={saving}
                  className="btn secondary"
                >
                  Insufficient — log call attempt
                </button>
                {saveNote && <span className="text-sm text-muted-foreground">{saveNote}</span>}
                {loading && <span className="text-xs text-muted-foreground">refreshing…</span>}
              </div>
            </div>

            {/* ── RIGHT: Patient Profile Clean-Up ──
                The mockup's whole point: the right pane is blurred and inert
                until the left one is done. `.panewrap.locked` does the blur,
                the overlay and the pointer-events block in CSS, so there is no
                second copy of that rule in JSX to drift out of sync. */}
            <div className={unlock.unlocked ? "panewrap" : "panewrap locked"}>
              <div className="lockover">
                <div className="lockmsg">
                  <div className="li"><Lock className="h-6 w-6 mx-auto" /></div>
                  <div className="lt">Finish Patient Info. Collection</div>
                  <div className="ls">
                    {unlock.conditions.find((c) => !c.passed)?.hint
                      ?? "Complete the checklist on the left to unlock this pane."}
                  </div>
                </div>
              </div>

              <div className="pane pane-inner">
                <div className="pane-head">
                  <h2>Patient Profile Clean-Up</h2>
                  <span className={unlock.unlocked ? "st open" : "st"}>
                    {unlock.unlocked ? "Open" : "Locked"}
                  </span>
                </div>

              <Card title="Advance to Profile Clean-Up" tone="decide">
                {isPartial ? (
                  <p className="text-sm text-muted-foreground">
                    This is an incomplete form. Advancing a partial isn't defined yet — work it as
                    outreach, or wait for the patient to finish.
                  </p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {unlock.conditions.map((c) => (
                        <li key={c.id} className="flex items-start gap-2 text-sm">
                          {c.passed ? (
                            <Check className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
                          ) : (
                            <X className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className={c.passed ? "" : "text-muted-foreground"}>{c.label}</div>
                            {!c.passed && (
                              <div className="text-[11px] text-amber-700">{c.hint}</div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => runStageAction("advance")}
                      disabled={!unlock.unlocked || saving}
                      className="btn primary mt-4 w-full justify-center"
                    >
                      {unlock.unlocked ? "Advance to Medical Necessity" : "Locked"}
                    </button>
                  </>
                )}
              </Card>

              {/* The blur + pointer-events block now come from
                  .panewrap.locked on the pane itself, so this no longer
                  hand-rolls a second overlay that could disagree with it. */}
              <div className="stack">
                <div>
                  <Card title="Verified Insurance" tone="lead">
                    <div className="grid grid-cols-2 gap-3">
                      <EditSelect
                        label="Primary Insurance"
                        value={verified.primaryInsurance ?? ""}
                        onChange={(v) => setVerified((s) => ({ ...s, primaryInsurance: v }))}
                        options={Object.keys(PRIMARY_INSURANCE_INDEX)}
                      />
                      <EditText
                        label="Member ID 1"
                        value={verified.memberId1 ?? ""}
                        onChange={(v) => setVerified((s) => ({ ...s, memberId1: v }))}
                      />
                      <EditSelect
                        label="Secondary Insurance"
                        value={verified.secondaryInsurance ?? ""}
                        onChange={(v) => setVerified((s) => ({ ...s, secondaryInsurance: v }))}
                        options={Object.keys(SECONDARY_INSURANCE_INDEX)}
                      />
                      <EditText
                        label={"Member ID 2" + ((verified.secondaryInsurance ?? "") === "NY Medicaid" ? " (required)" : "")}
                        value={verified.memberId2 ?? ""}
                        onChange={(v) => setVerified((s) => ({ ...s, memberId2: v }))}
                      />
                    </div>

                    {/* Why the engine landed there. Replaces the suggestion
                        chip / confidence label / alternates furniture (§4).
                        Hard blocks stay visible banners below — the hover is
                        for explaining a normal pick, never for hiding a problem. */}
                    {suggestion?.primary && (
                      <details className="mt-3 rounded-md border bg-muted/40 px-3 py-2">
                        <summary className="cursor-pointer text-xs font-medium">
                          Why {suggestion.primary.value || "this"}? ({suggestion.primary.confidence} confidence)
                        </summary>
                        <p className="mt-2 text-xs text-muted-foreground">{suggestion.primary.reason}</p>
                      </details>
                    )}
                    {suggestion?.primary?.warnings?.map((w, i) => (
                      <p key={i} className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                        {typeof w === "string" ? w : w.message}
                      </p>
                    ))}

                    <button
                      onClick={saveVerified}
                      disabled={saving}
                      className="btn primary mt-3"
                    >
                      Save verified insurance
                    </button>
                  </Card>

                  {/* Serving & Coverage — the product decision that carries to
                      Medical Necessity. These are the SAME Monday columns the
                      left pane's "What they need" edits, deliberately: the left
                      is what the patient asked for, this is what we commit to,
                      and they are one value so a save can't write two answers. */}
                  <Card title="Serving & Coverage" tone="lead">
                    <div className="grid grid-cols-2 gap-3">
                      <EditSelect
                        label="Serving"
                        value={selected.serving ?? ""}
                        onChange={(v) => edit({ serving: v })}
                        options={SERVING_OPTS}
                      />
                      <EditSelect
                        label="Request Type"
                        value={selected.requestType ?? ""}
                        onChange={(v) => edit({ requestType: v })}
                        options={REQUEST_TYPE_OPTS}
                      />
                      <EditSelect
                        label="CGM Coverage Path"
                        value={selected.cgmCoveragePath ?? ""}
                        onChange={(v) => edit({ cgmCoveragePath: v })}
                        options={CGM_PATH_OPTS}
                      />
                      <EditSelect
                        label="Insulin Pump Coverage Path"
                        value={selected.insulinPumpCoveragePath ?? ""}
                        onChange={(v) => edit({ insulinPumpCoveragePath: v })}
                        options={IP_PATH_OPTS}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Serving saves with “Save verified insurance”; Request Type and the
                      coverage paths save with “Save” on the left.
                    </p>
                  </Card>

                  {/* Select Correct Provider — turns the free text the patient
                      typed into a real NPI + location + clinicals method. It
                      writes the VERIFIED doctor columns; the Provided * fields
                      on the left are untouched by it (§6.0). */}
                  <div className="pf-root mt-4">
                    <DoctorSection
                      patient={selected}
                      onUpdate={edit}
                      clinicLabels={clinicLabels}
                      onClinicSelect={(_id, name) => edit({ clinicName: name })}
                    />
                  </div>

                  {/* Ready to Send Off? — the send-off page's checklist, same
                      derived-not-stored rule. Sits last because it summarises
                      everything above it, doctor included. */}
                  <Card
                    title="Ready to Send Off?"
                    tone={readyMissing === 0 ? "lead" : "decide"}
                    right={
                      <span className={readyMissing === 0 ? "pill ok" : "pill warn"}>
                        {readyMissing === 0 ? "Ready" : `${readyMissing} missing`}
                      </span>
                    }
                  >
                    <ul className="space-y-2">
                      {readiness.map((it) => (
                        <li key={it.label} className="flex items-center gap-2 text-sm">
                          {it.ok ? (
                            <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className={it.ok ? "" : "text-muted-foreground"}>{it.label}</span>
                          <span
                            className={
                              "ml-auto text-xs font-semibold " +
                              (it.ok ? "text-emerald-600" : "text-amber-700")
                            }
                          >
                            {it.ok ? "ok" : "missing"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              </div>

              <div className="mt-4">
                <Card title="Escalation">
                  {selected.intakeEscalation?.trim() ? (
                    <p className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                      Currently: <strong>{selected.intakeEscalation}</strong>
                      {selected.intakeEscalation === "Manager Escalation Required" && " — with Manager Intervention."}
                      {selected.intakeEscalation === "Final Escalation Required" && " — awaiting a Final Decision."}
                    </p>
                  ) : null}
                  <StageActionBar
                    stage="unverified-intake"
                    board="profile"
                    patientId={selected.id}
                    patientName={selected.name}
                    escalationLabel={selected.intakeEscalation}
                    onDone={() => { void refetch(true); }}
                  />
                  {/* Escalate is this stage's own exit — it has no equivalent
                      on the shared bar, which starts at Propose Stuck. */}
                  <div className="mt-3">
                    <EditText
                      label="Escalate — reason"
                      value={escalateReason}
                      placeholder="What's blocking this patient?"
                      onChange={setEscalateReason}
                    />
                    <button
                      onClick={() => runStageAction("escalate")}
                      disabled={saving}
                      className="btn amber sm mt-2"
                    >
                      Escalate — doesn't qualify
                    </button>
                  </div>
                  {selected.intakeEscalationNotes?.trim() && (
                    <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-[11px]">
                      {selected.intakeEscalationNotes}
                    </pre>
                  )}
                </Card>
              </div>

              {(selected.alreadyInSystem ?? "").toLowerCase() === "yes" && (
                <div className="mt-4 flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm font-semibold text-red-800">
                  <AlertTriangle className="h-4 w-4" /> Already In System
                </div>
              )}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </SidebarProvider>
  );
};

export default UnverifiedReferralsPage;
