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
  REFERRAL_TYPE_INDEX, REFERRAL_SOURCE_INDEX,
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
// The oversight columns deep-link with ?mv= — read it through the shared
// helper rather than a hand-rolled param name, which is how this page ended
// up looking for a "?origin=" nothing ever wrote.
import { managerOriginFromParams } from "@/lib/shared/managerOrigin";
// §5.2: a value the board holds but the picker doesn't offer must still be
// visible, or the select renders blank and the field looks empty when it isn't.
import { optionsWithCurrent } from "@/lib/profile/selectOptions";
// The shared bar, so this stage's Propose Stuck / Send back to pipeline are
// literally the same component and copy Medical Evaluation uses — not a
// lookalike that can drift from it.
import { StageActionBar } from "@/components/shared/StageActionBar";
// The ladder itself, so this page's own Propose Stuck button and the bar's
// cannot disagree about which rung a proposal lands on.
import { proposeStuckLevel } from "@/lib/shared/stageActions";
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

/** This queue is the DTC form's two groups and nothing else. "Referrals"
 *  (the 1. Intake group) was a third option here and is gone: that group is
 *  Verified Referrals' queue, and it is where this stage ADVANCES patients to,
 *  so listing it here showed reps the stage they'd already handed off to. */
type Source = "completed" | "partial";

const SOURCE_GROUP: Record<Source, string> = {
  completed: GROUPS.newFormCompleted,
  partial: GROUPS.newFormPartial,
};

const SOURCE_LABEL: Record<Source, string> = {
  completed: "Completed forms",
  partial: "Partial forms",
};

/** Full board label sets. "Not Serving" is NOT stripped here — `optionsWithCurrent`
 *  hides it from the picker while keeping it visible when it's the patient's
 *  current value (§5.2), and the WRITE path uses the complete index maps, so a
 *  legitimate "Not Serving" can still be written and read back. */
const SERVING_OPTS = Object.keys(SERVING_INDEX);
const REQUEST_TYPE_OPTS = Object.keys(REQUEST_TYPE_INDEX);
const CGM_PATH_OPTS = Object.keys(CGM_COVERAGE_PATH_INDEX);
const IP_PATH_OPTS = Object.keys(INSULIN_PUMP_COVERAGE_PATH_INDEX);
const GENERAL_INSURANCE_OPTS = Object.keys(GENERAL_INSURANCE_INDEX);
const REFERRAL_TYPE_OPTS = Object.keys(REFERRAL_TYPE_INDEX);
const REFERRAL_SOURCE_OPTS = Object.keys(REFERRAL_SOURCE_INDEX);

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

// NOTE: the mockup prints a provenance stamp under every field
// (`FROM FORM → color_mm1w7pmf`). Those are BUILD NOTES for the implementer,
// not UI — HANDOFF's preamble says so explicitly: "They are NOT part of the
// design and must NOT appear in production." A <Prov> component that rendered
// them lived here unused; it is deleted so nobody wires it up by mistake.

function EditText({
  label, value, onChange, placeholder, full,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  full?: boolean;
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
    </label>
  );
}

function EditSelect({
  label, value, options, onChange, full,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
  full?: boolean;
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
        {optionsWithCurrent(options, value).map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * The mockup's segmented pill control (`.pills` / `.pillbtn`, already in
 * intake.css). Used where the mockup shows a short, closed set of choices as
 * buttons rather than a `<select>` — Self Advocacy is the worked example.
 *
 * Clicking the active pill CLEARS it. These fields are optional in the mockup
 * ("— optional"), and with no other affordance a rep who mis-clicked would have
 * no way back to "not set": a status column the app can set but never unset is
 * the `intakeCallComplete` trap (write-only-when-truthy) in a new place.
 */
function Pills({
  label, value, options, onChange, hint,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="fld full">
      <div className="flabel">
        {label}
        {hint && (
          <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}> — {hint}</span>
        )}
      </div>
      <div className="pills">
        {options.map((o) => {
          const on = value.trim() === o;
          return (
            <button
              key={o}
              type="button"
              className={on ? "pillbtn on" : "pillbtn"}
              aria-pressed={on}
              onClick={() => onChange(on ? "" : o)}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A section card inside a pane. `tone` maps to the mockup's coloured left
 *  border: lead = green (what we already know), decide = teal (an action). */
function Card({
  title, children, tone, right, step,
}: {
  title: string; children: React.ReactNode;
  tone?: "lead" | "decide" | "hilite"; right?: React.ReactNode;
  /** Right-pane cards are numbered steps 1-4 in the mockup. */
  step?: number;
}) {
  return (
    <section className={tone ? `sect ${tone}` : "sect"}>
      {step === undefined ? (
        <div className="sect-title">
          {title}
          {right && <span className="rt">{right}</span>}
        </div>
      ) : (
        <div className="step-head">
          <span className="step-num">{step}</span>
          <h2>{title}</h2>
          {right && <div className="right">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The left pane's edits, as the write layer wants them.
 *
 * Module-level and shared by BOTH the Save button and Advance, deliberately:
 * Advance used to call `save()` and then advance separately, so the two paths
 * each had their own idea of which columns to send. One list means a field
 * can't be saved by one and dropped by the other.
 */
function intakeEditsFor(p: Patient): IntakeEdits {
  return {
    name: p.name,
    ptPhone: p.ptPhone,
    dob: p.dob,
    email: p.email,
    formState: p.formState,
    referralType: p.referralType,
    referralSource: p.referralSource,
    // Product decision — shared with the right pane's Serving & Coverage card.
    requestType: p.requestType,
    cgmCoveragePath: p.cgmCoveragePath,
    insulinPumpCoveragePath: p.insulinPumpCoveragePath,
    workingMemberId: p.workingMemberId,
    generalInsurance: p.generalInsurance,
    formInsuranceVia: p.formInsuranceVia,
    formInsuranceOther: p.formInsuranceOther,
    formSecondaryProvided: p.formSecondaryProvided,
    formSecondaryMemberId: p.formSecondaryMemberId,
    formReasonForInquiry: p.formReasonForInquiry,
    formPumpNeed: p.formPumpNeed,
    formCgmPreference: p.formCgmPreference,
    formPumpPreference: p.formPumpPreference,
    formProvidedDoctorName: p.formProvidedDoctorName,
    formProvidedClinicPhone: p.formProvidedClinicPhone,
    formProceedPreference: p.formProceedPreference,
    formCallSlot: p.formCallSlot,
    formBookingStatus: p.formBookingStatus,
    intakeCallComplete: (p.intakeCallComplete ?? "").trim().toLowerCase() === "yes",
    selfAdvocacy: p.selfAdvocacy,
    currentOopCost: p.currentOopCost,
    cgmDataAwareness: p.cgmDataAwareness,
    notes: p.notes,
  };
}

const UnverifiedReferralsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const sourceParam = searchParams.get("source");
  const source: Source = sourceParam === "partial" ? "partial" : "completed";

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
  const managerOrigin = managerOriginFromParams(searchParams);
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
    setClinicLabelId(null);
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
    if (next === "completed") params.delete("source");
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
    const edits: IntakeEdits = intakeEditsFor(selected);
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
  /** Right pane, so "Advance to Profile Clean-Up" can bring the rep to it. */
  const cleanUpRef = useRef<HTMLDivElement | null>(null);

  // Doctor DB clinic dropdown labels — fetched once, same source as /profile.
  const [clinicLabels, setClinicLabels] = useState<{ id: number; name: string }[]>([]);
  /** Set when the rep picks a clinic the board dropdown already knows, so the
   *  send can write the option id rather than create a duplicate label. */
  const [clinicLabelId, setClinicLabelId] = useState<number | null>(null);
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
        // The SAME ladder the shared StageActionBar climbs. This call used to
        // omit the level, so it always wrote Manager Intervention while the
        // message below told the rep it had gone to Final Decisions. Computed
        // once and used for both the write and what we claim about it.
        const stuckLevel = proposeStuckLevel(
          "unverified-intake", managerOrigin, selected.intakeEscalation,
        );
        const res =
          // ONE verified transaction. The left pane, the verified insurance and
          // the doctor columns are now all written and read back BEFORE Move to
          // Onboarding flips — nothing is written ahead of it. Previously the
          // first two went out unverified and a partial failure still advanced
          // the patient, because save() reports its errors instead of throwing.
          kind === "advance" ? await advanceToMedicalNecessity(selected, {
            edits: intakeEditsFor(selected),
            verified: { ...verified, serving: selected.serving },
            clinicLabelId,
          })
          : kind === "escalate" ? await escalateIntake(selected.id, escalateReason, notes)
          : kind === "proposeStuck"
            ? await proposeIntakeStuck(selected.id, escalateReason, notes, stuckLevel)
          : await returnIntakeToPipeline(selected.id, escalateReason, notes);
        setSaveNote(
          res.ok
            ? kind === "advance" ? "Advanced to Medical Necessity."
              : kind === "escalate" ? "Escalated to Manager Intervention."
              : kind === "proposeStuck"
                ? stuckLevel === "final"
                  ? "Proposed stuck — sent to Final Decisions."
                  : "Proposed stuck — sent to Manager Intervention."
              : "Sent back to the pipeline."
            : kind === "advance"
              ? `Not advanced — ${res.errors.map((e) => `${e.label}: ${e.error}`).join(" · ")}`
              : res.errors.map((e) => `${e.label}: ${e.error}`).join(" · "),
        );
        if (res.ok) { setEscalateReason(""); await refetch(true); }
      } finally {
        setSaving(false);
      }
    },
    [selected, escalateReason, refetch, verified, clinicLabelId, managerOrigin],
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
          filters={(Object.keys(SOURCE_GROUP) as Source[]).map((sKey) => (
            <button
              key={sKey}
              type="button"
              onClick={() => switchSource(sKey)}
              className={
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors " +
                (source === sKey
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70")
              }
            >
              {SOURCE_LABEL[sKey]}
            </button>
          ))}
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
              <Card title="Referral Routing">
                <div className="grid grid-cols-2 gap-3">
                  <EditSelect
                    label="Referral Source"
                    value={selected.referralSource ?? ""}
                    onChange={(v) => edit({ referralSource: v })}
                    options={REFERRAL_SOURCE_OPTS}
                  />
                  <EditSelect
                    label="Referral Type"
                    value={selected.referralType ?? ""}
                    onChange={(v) => edit({ referralType: v })}
                    options={REFERRAL_TYPE_OPTS}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  These two decide which intake queue the patient lands in — Referral
                  Type “Patient” or Source “CareCentrix” is what makes this an Unverified
                  Referral. Changing them can move the patient to another queue.
                </p>
              </Card>

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
                  {/* Mockup keeps this in the CGM column of What They Need,
                      next to the CGM Data File — not in a separate card. */}
                  <EditSelect
                    label="CGM Data & Doctor Awareness"
                    value={selected.cgmDataAwareness ?? ""}
                    onChange={(v) => edit({ cgmDataAwareness: v })}
                    options={["Patient has existing data", "Doctor is aware", "Neither applies", "Both apply"]}
                  />
                </div>
              </Card>

              <Card title="Provided Insurance">
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

              <Card title="Provided Doctor Info">
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

              {/* Two cards, not one. "On the call" was invented by an earlier
                  build and merged these; the mockup has Care Assessment and
                  Cost & Coverage as separate `.sect.lead` sections in this
                  order, and Self Advocacy as segmented pills rather than a
                  dropdown. CGM Data & Doctor Awareness moved up into What They
                  Need, which is where the mockup keeps it (beside the CGM Data
                  File, in the CGM column). */}
              <Card title="Care Assessment" tone="lead">
                <Pills
                  label="Self Advocacy"
                  hint="optional"
                  value={selected.selfAdvocacy ?? ""}
                  onChange={(v) => edit({ selfAdvocacy: v })}
                  options={["High", "Low"]}
                />
              </Card>

              <Card title="Cost & Coverage" tone="lead">
                <EditText
                  full
                  label="Current Out-of-Pocket Cost — optional"
                  placeholder="e.g. $75/month"
                  value={selected.currentOopCost ?? ""}
                  onChange={(v) => edit({ currentOopCost: v })}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Free text, not a number — the board column is text, so “$75/month” is the expected shape.
                </p>
              </Card>

              <Card title="Proceed Preference">
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

              {/* HANDOFF §2 "Left-pane exits" — all three live here, at the
                  bottom of the pane they belong to, as the mockup has them. */}
              <Card
                title="Ready to Advance?"
                tone="decide"
                right={
                  <span className={unlock.unlocked ? "pill ok" : "pill warn"}>
                    {unlock.unlocked ? "Ready" : `${unlock.conditions.filter((c) => !c.passed).length} blocking`}
                  </span>
                }
              >
                {isPartial ? (
                  <p className="text-sm text-muted-foreground">
                    This is an incomplete form. Advancing a partial isn't defined yet — work it as
                    outreach, or wait for the patient to finish.
                  </p>
                ) : (
                  <>
                    {/* A disabled button with no explanation is the thing reps
                        escalate about (§2), so the blockers are always visible. */}
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
                            {!c.passed && <div className="text-[11px] text-amber-700">{c.hint}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button onClick={save} disabled={saving} className="btn primary">
                        {saving ? "Saving…" : "Save"}
                      </button>
                      {/* The pane itself unlocks from the four conditions
                          (HANDOFF §2: "not unlocked by a button click"), so this
                          takes the rep TO the unlocked pane rather than gating
                          it a second time. */}
                      <button
                        onClick={() => cleanUpRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        disabled={!unlock.unlocked || saving}
                        className="btn primary"
                        title={unlock.unlocked ? undefined : "Blocked by the checklist above"}
                      >
                        Advance to Profile Clean-Up →
                      </button>
                      <button onClick={logAttempt} disabled={saving} className="btn secondary">
                        Insufficient — log call attempt
                      </button>
                      {/* The mockup's home for this is Call Log & Notes, which
                          isn't built yet. Parked next to the button that
                          increments it so the count stays on screen — a rep
                          logging an attempt has to be able to see the total. */}
                      <span className="self-center text-xs text-muted-foreground">
                        {attempts} attempt{attempts === 1 ? "" : "s"} logged
                      </span>
                    </div>

                    {/* Exit 3. Reason is required — a manager can't action a
                        blank escalation. */}
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

                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Advancing moves the patient into Verified Referrals (1. Intake). That stage
                      finishes the send-off and is what advances them to Medical Necessity.
                    </p>
                  </>
                )}
                {(saveNote || loading) && (
                  <div className="mt-3 flex items-center gap-2">
                    {saveNote && <span className="text-sm text-muted-foreground">{saveNote}</span>}
                    {loading && <span className="text-xs text-muted-foreground">refreshing…</span>}
                  </div>
                )}
              </Card>
            </div>

            {/* ── RIGHT: Patient Profile Clean-Up ──
                The mockup's whole point: the right pane is blurred and inert
                until the left one is done. `.panewrap.locked` does the blur,
                the overlay and the pointer-events block in CSS, so there is no
                second copy of that rule in JSX to drift out of sync. */}
            <div ref={cleanUpRef} className={unlock.unlocked ? "panewrap" : "panewrap locked"}>
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

              {/* The advance decision lives at the bottom of the LEFT pane
                  ("Ready to Advance?"), which is where HANDOFF §2 puts all
                  three of this stage's exits. This pane is the work you do
                  AFTER advancing is unblocked, not the place you trigger it. */}

              {/* The blur + pointer-events block now come from
                  .panewrap.locked on the pane itself, so this no longer
                  hand-rolls a second overlay that could disagree with it. */}
              <div className="stack">
                <div>
                  <Card step={1} title="Verified Insurance" tone="lead">
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
                    {/* The engine's reasoning, always readable. It was a
                        <details> the rep had to click open, so in practice the
                        pre-fill arrived unexplained — the opposite of §4's
                        "PRE-FILLS, it does not suggest" intent. */}
                    {suggestion?.primary && (
                      <div className="why">
                        <div className="why-h">
                          Why {suggestion.primary.value || "this"}?
                          <span className="conf">{suggestion.primary.confidence} confidence</span>
                        </div>
                        <p className="why-b">{suggestion.primary.reason}</p>
                      </div>
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

                  {/* Step 2 — the one decision this card owns. The mockup has
                      Serving and nothing else: Request Type and the coverage
                      paths are the patient's answers and live on the left, so
                      duplicating them here just created two controls for one
                      column and a note explaining which button saved which. */}
                  <Card step={2} title="Serving & Coverage" tone="lead">
                    <div className="grid grid-cols-2 gap-3">
                      <EditSelect
                        label="Serving"
                        value={selected.serving ?? ""}
                        onChange={(v) => edit({ serving: v })}
                        options={SERVING_OPTS}
                      />
                    </div>
                  </Card>

                  {/* Select Correct Provider — turns the free text the patient
                      typed into a real NPI + location + clinicals method. It
                      writes the VERIFIED doctor columns; the Provided * fields
                      on the left are untouched by it (§6.0). */}
                  <Card step={3} title="Select Correct Provider" tone="lead">
                  <div className="pf-root">
                    <DoctorSection
                      patient={selected}
                      onUpdate={edit}
                      clinicLabels={clinicLabels}
                      onClinicSelect={(id, name) => { setClinicLabelId(id); edit({ clinicName: name }); }}
                    />
                  </div>
                  </Card>

                  {/* Ready to Send Off? — the send-off page's checklist, same
                      derived-not-stored rule. Sits last because it summarises
                      everything above it, doctor included. */}
                  <Card
                    step={4}
                    title="Ready to Send Off?"
                    tone="decide"
                    right={
                      <span className={readyMissing === 0 ? "pill ok" : "mp"}>
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

                    {/* The stage's two real exits, as the mockup lays them out. */}
                    <div className="route-grid" style={{ gridTemplateColumns: "1fr" }}>
                      <div className={readyMissing === 0 ? "route adv on" : "route adv"}>
                        <h4>Advance to MN</h4>
                        <p>Profile is complete — hand the patient to Medical Necessity.</p>
                        <button
                          onClick={() => runStageAction("advance")}
                          disabled={readyMissing > 0 || saving}
                          className="btn primary justify-center"
                        >
                          Advance to MN →
                        </button>
                      </div>
                    </div>
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
                  {/* "Escalate — doesn't qualify" is a LEFT-pane exit (§2) and
                      lives in Ready to Advance?. What stays here is the shared
                      manager ladder: Propose Stuck / Approve / Send back. */}
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
