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
  writeIntakeEdits, writeVerifiedInsurance, logContactAttempt, appendIntakeNote,
  advanceToMedicalNecessity, escalateIntake, proposeIntakeStuck, returnIntakeToPipeline,
  type IntakeEdits, type VerifiedEdits,
} from "@/lib/profile/unverifiedWrite";
import {
  fetchUpdates, fetchItemAssets, createUpdate, COL,
  type MondayUpdate, type MondayAsset,
} from "@/lib/profile/mondayApi";
// The worker's multipart relay to Monday's file API. Board-agnostic (item id +
// column id), so the profile board uses the same one masheke does.
import { uploadFileToColumn } from "@/lib/masheke/mondayApi";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { IntakeMessages } from "@/components/profile/IntakeMessages";
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
// First/Last are two boxes over one Monday value — this board has no name
// columns, the item name IS the name, so the split has to round-trip.
import { splitName, joinName } from "@/lib/profile/nameParts";
// Monday dates are timezone-naive ET — never date a board column from a bare
// `new Date()` in a UTC runtime (CLAUDE.md §9).
import { etToday } from "@/lib/masheke/etDate";
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

/**
 * The mockup's `.seg` segmented control — a joined 3-up (or 2-up) bar, as
 * distinct from `.pills`, which are separate rounded buttons. The mockup uses
 * both and they are not interchangeable: Provided Via and the message channel
 * are `.seg`, Self Advocacy and Proceed Preference are `.pills`.
 *
 * Re-clicking the active segment clears it, same reasoning as Pills.
 */
function Seg({
  label, value, options, onChange,
}: {
  label?: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="fld full">
      {label && <div className="flabel">{label}</div>}
      <div className="seg">
        {options.map((o) => {
          const on = value.trim() === o;
          return (
            <button
              key={o}
              type="button"
              className={on ? "on" : undefined}
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
    gender: p.gender,
    patientAddress: p.patientAddress,
    patientAddressLat: p.patientAddressLat,
    patientAddressLng: p.patientAddressLng,
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
    followUp: p.followUp,
    followUpDate: p.followUpDate,
    // `notes` is NOT sent. The Call Log appends through appendIntakeNote —
    // including it here would write the whole log back over itself, and the
    // moment a textarea was bound to it, replace the log with one line.
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

  /** First/Last are two boxes over one Monday value (the item name). */
  const nameParts = useMemo(() => splitName(selected?.name), [selected?.name]);

  /**
   * Product-category toggles. Seeded from the board — a category counts as
   * selected when the patient already has ANY value in that column group — and
   * then owned by the rep for the rest of the visit.
   *
   * Switching one OFF only hides the column; it never clears those columns.
   * A blank field means "not set", never "clear the board", and a rep
   * un-ticking CGM to tidy the view must not wipe a coverage path the form
   * collected.
   */
  const [catOverride, setCatOverride] = useState<{ cgm?: boolean; pump?: boolean }>({});
  useEffect(() => { setCatOverride({}); }, [selected?.id]);

  const cgmSeeded = !!(
    selected?.cgmCoveragePath?.trim() || selected?.formCgmPreference?.trim() ||
    selected?.cgmDataAwareness?.trim() || /cgm|monitor/i.test(selected?.requestType ?? "")
  );
  const pumpSeeded = !!(
    selected?.insulinPumpCoveragePath?.trim() || selected?.formPumpPreference?.trim() ||
    selected?.formPumpNeed?.trim() || /pump/i.test(selected?.requestType ?? "")
  );
  const cgmOn = catOverride.cgm ?? cgmSeeded;
  const pumpOn = catOverride.pump ?? pumpSeeded;
  const setCatCgm = (v: boolean) => setCatOverride((s) => ({ ...s, cgm: v }));
  const setCatPump = (v: boolean) => setCatOverride((s) => ({ ...s, pump: v }));
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

  /**
   * Flag the patient for insurance follow-up, dated TODAY in ET.
   *
   * Monday dates are timezone-naive ET (CLAUDE.md §9), so this uses etToday()
   * rather than a bare `new Date()` — in a UTC container the latter dates
   * anything after 8pm ET as tomorrow.
   */
  const startFollowUp = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setSaveNote(null);
    try {
      const res = await writeIntakeEdits(selected.id, {
        followUp: "Follow Up",
        followUpDate: etToday(),
      });
      setSaveNote(
        res.ok
          ? "Insurance follow-up started — flagged and dated today."
          : res.errors.map((e) => `${e.label}: ${e.error}`).join(" · "),
      );
      if (res.ok) await refetch(true);
    } finally {
      setSaving(false);
    }
  }, [selected, refetch]);

  // ── Referral email (Monday updates) + Files (item assets) ────────────────
  // Both fetchers already existed and had no caller. Loaded per patient and
  // only when the rep opens the card — an intake queue is long and neither is
  // needed to work the top of the page.
  const [refOpen, setRefOpen] = useState(false);
  const [updates, setUpdates] = useState<MondayUpdate[] | null>(null);
  const [assets, setAssets] = useState<MondayAsset[] | null>(null);
  useEffect(() => { setRefOpen(false); setUpdates(null); setAssets(null); }, [selected?.id]);
  useEffect(() => {
    if (!selected || !refOpen || updates !== null) return;
    let alive = true;
    fetchUpdates(selected.id)
      .then((u) => { if (alive) setUpdates(u); })
      .catch(() => { if (alive) setUpdates([]); });
    return () => { alive = false; };
  }, [selected, refOpen, updates]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    fetchItemAssets(selected.id)
      .then((a) => { if (alive) setAssets(a); })
      .catch(() => { if (alive) setAssets([]); });
    return () => { alive = false; };
  }, [selected]);

  /**
   * Attach a CGM data file to the item's file column.
   *
   * The mockup's flow is the PATIENT uploading from their phone via a tokenized
   * link (§8.3), which needs a service that doesn't exist. This is the half
   * that works today: the worker already relays multipart uploads to Monday's
   * file API, so the rep can attach what the patient emails or texts over.
   */
  const [cgmDragOver, setCgmDragOver] = useState(false);
  const [cgmUploading, setCgmUploading] = useState(false);
  const uploadCgmFile = useCallback(async (file: File) => {
    if (!selected) return;
    setCgmUploading(true);
    setSaveNote(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await uploadFileToColumn(
        selected.id, COL.cgmDataFile, bytes, file.name,
        file.type || "application/octet-stream",
      );
      setSaveNote(`Attached ${file.name}.`);
      setAssets(null); // re-fetch so it appears in the Files card
      await refetch(true);
    } catch (e) {
      setSaveNote(e instanceof Error ? `Upload failed — ${e.message}` : "Upload failed.");
    } finally {
      setCgmUploading(false);
    }
  }, [selected, refetch]);

  /** Paste a referral email → post it as a Monday update, which is where the
   *  referral already lives (the card above reads updates, not a column). */
  const [addRefOpen, setAddRefOpen] = useState(false);
  const [refDraft, setRefDraft] = useState("");
  useEffect(() => { setAddRefOpen(false); setRefDraft(""); }, [selected?.id]);
  const addReferralEmail = useCallback(async () => {
    if (!selected || !refDraft.trim()) return;
    setSaving(true);
    setSaveNote(null);
    try {
      await createUpdate(selected.id, refDraft.trim());
      setRefDraft("");
      setAddRefOpen(false);
      setUpdates(null); // force the list to re-fetch so the new one shows
      setSaveNote("Referral email posted as a Monday update.");
    } catch (e) {
      setSaveNote(e instanceof Error ? `Couldn't post it — ${e.message}` : "Couldn't post it.");
    } finally {
      setSaving(false);
    }
  }, [selected, refDraft]);

  /** Append one stamped line to the Call Log. */
  const [noteDraft, setNoteDraft] = useState("");
  useEffect(() => { setNoteDraft(""); }, [selected?.id]);
  const addNote = useCallback(async () => {
    if (!selected || !noteDraft.trim()) return;
    setSaving(true);
    setSaveNote(null);
    try {
      const res = await appendIntakeNote(selected.id, noteDraft, selected.notes);
      setSaveNote(res.ok ? "Note added." : res.errors.map((e) => `${e.label}: ${e.error}`).join(" · "));
      if (res.ok) { setNoteDraft(""); await refetch(true); }
    } finally {
      setSaving(false);
    }
  }, [selected, noteDraft, refetch]);

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

              {/* ── Referral Email rail-card ── mockup's first block. The
                  referral arrives as a Monday UPDATE, not a column, which is
                  why it needs fetchUpdates rather than a COL entry. */}
              <div className="rail-card">
                <div className="rail-head">✉ Referral Email</div>
                <div className="rail-body">
                  <div className="kv">
                    <Field label="Referral Type" value={selected.referralType} />
                    <Field label="Referral Source" value={selected.referralSource} />
                  </div>
                  <button
                    className="btn secondary sm"
                    style={{ marginTop: 12 }}
                    onClick={() => setRefOpen((o) => !o)}
                  >
                    {refOpen ? "Hide referral email / updates" : "Show referral email / updates"}
                  </button>
                  {refOpen && (
                    <div style={{ marginTop: 12 }}>
                      <div className="rail-updates">
                        {updates === null ? (
                          <div className="text-xs text-muted-foreground">Loading…</div>
                        ) : updates.length === 0 ? (
                          <div className="text-xs text-muted-foreground">No updates on this item.</div>
                        ) : (
                          updates.map((u) => (
                            <div key={u.id} className="note-entry">
                              <span className="ts">
                                [{u.created_at}] {u.creator?.name ?? "unknown"}
                              </span>
                              {/* Monday update bodies are HTML. Rendered as
                                  TEXT deliberately — dangerouslySetInnerHTML on
                                  a referral email is an XSS sink fed by an
                                  external sender. */}
                              <div style={{ marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                                {u.body.replace(/<[^>]+>/g, "").trim()}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      {/* The mockup's own toast spells this out: "Paste a
                          referral email — Save posts it as a Monday update".
                          Updates are where the referral already lives, which is
                          why the card above reads them. */}
                      {addRefOpen ? (
                        <div className="note-add" style={{ marginTop: 12 }}>
                          <textarea
                            value={refDraft}
                            placeholder="Paste the referral email…"
                            onChange={(e) => setRefDraft(e.target.value)}
                          />
                          <button
                            className="btn primary sm"
                            disabled={saving || !refDraft.trim()}
                            onClick={addReferralEmail}
                          >
                            Post
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn secondary sm"
                          style={{ marginTop: 12 }}
                          onClick={() => setAddRefOpen(true)}
                        >
                          ＋ Add referral email
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Files rail-card ── */}
              <div className="rail-card">
                <div className="rail-head">📎 Files — click to preview</div>
                <div className="rail-files">
                  {assets === null ? (
                    <div className="text-xs text-muted-foreground px-1 py-2">Loading…</div>
                  ) : assets.length === 0 ? (
                    <div className="text-xs text-muted-foreground px-1 py-2">No files on this item.</div>
                  ) : (
                    assets.map((a) => (
                      <div
                        key={a.id}
                        className="file-row"
                        onClick={() => openFileViewer({ url: a.public_url || a.url, name: a.name })}
                      >
                        <span className="fname">{a.name}</span>
                        <span className="fmeta">{a.name.split(".").pop() ?? ""}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <Card title="Referral Routing" tone="lead">
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

              <Card title="Patient Demographics" tone="lead">
                <div className="fgrid">
                  {/* First/Last are two boxes in the mockup but ONE Monday
                      value — this board has no name columns, the item name IS
                      the name. splitName/joinName round-trip it. */}
                  <EditText
                    label="First Name"
                    value={nameParts.first}
                    onChange={(v) => edit({ name: joinName({ ...nameParts, first: v }) })}
                  />
                  <EditText
                    label="Last Name"
                    value={nameParts.last}
                    onChange={(v) => edit({ name: joinName({ ...nameParts, last: v }) })}
                  />
                  <EditText label="Date of Birth" value={selected.dob ?? ""} onChange={(v) => edit({ dob: v })} />
                  <EditText label="Phone" value={selected.ptPhone ?? ""} onChange={(v) => edit({ ptPhone: v })} />
                  <EditText label="Email" value={selected.email ?? ""} onChange={(v) => edit({ email: v })} />
                  {/* Not asked on the form — rep or Stedi fills it. */}
                  <EditSelect
                    label="Gender"
                    value={selected.gender ?? ""}
                    onChange={(v) => edit({ gender: v })}
                    options={["Male", "Female", "Unknown"]}
                  />
                  <EditText
                    full
                    label="Address"
                    placeholder="122 Elderberry Ln, Central Square, NY 13036"
                    value={selected.patientAddress ?? ""}
                    onChange={(v) => edit({ patientAddress: v })}
                  />
                  <EditText label="State" value={selected.formState ?? ""} onChange={(v) => edit({ formState: v })} />
                  <Field label="Date of Intake" value={selected.dateOfIntake} />
                </div>
                {!(selected.patientAddress ?? "").trim() && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    No address on file. The form doesn’t collect one, and downstream stages need it to ship —
                    collect it on the call.
                  </p>
                )}
              </Card>

              <Card title="What They Need" tone="lead">
                {/* Reason for Inquiry is the FIRST field of What They Need in
                    the mockup. It had been split into a "Why they came" card
                    that the mockup doesn't have. */}
                <div className="mb-5">
                  <EditSelect
                    full
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

                <div className="flabel" style={{ marginBottom: 9 }}>
                  Product Categories
                  <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                    {" "}— select all that apply
                  </span>
                </div>
                <div className="needs2">
                  <button
                    type="button"
                    className={cgmOn ? "cat on" : "cat"}
                    onClick={() => setCatCgm(!cgmOn)}
                  >
                    <span className="bx">✓</span>Continuous Glucose Monitor
                  </button>
                  <button
                    type="button"
                    className={pumpOn ? "cat on" : "cat"}
                    onClick={() => setCatPump(!pumpOn)}
                  >
                    <span className="bx">✓</span>Insulin Pump / Supplies
                  </button>

                  {/* An unselected category hides its ENTIRE column (§7.1) —
                      it does not grey out, and the fields inside are not
                      individually highlighted. `.devcol.off` is that rule. */}
                  <div className={cgmOn ? "devcol" : "devcol off"}>
                    <EditSelect
                      label="CGM Coverage Path"
                      value={selected.cgmCoveragePath ?? ""}
                      onChange={(v) => edit({ cgmCoveragePath: v })}
                      options={CGM_PATH_OPTS}
                    />
                    <EditSelect
                      label="CGM preference (patient's answer)"
                      value={selected.formCgmPreference ?? ""}
                      onChange={(v) => edit({ formCgmPreference: v })}
                      options={["Freestyle Libre 3 Plus", "Dexcom G7", "Medtronic Guardian 4", "Any will work"]}
                    />
                    <EditSelect
                      label="CGM Data & Doctor Awareness"
                      value={selected.cgmDataAwareness ?? ""}
                      onChange={(v) => edit({ cgmDataAwareness: v })}
                      options={["Patient has existing data", "Doctor is aware", "Neither applies", "Both apply"]}
                    />
                  </div>

                  <div className={pumpOn ? "devcol" : "devcol off"}>
                    <EditSelect
                      label="Pump preference (patient's answer)"
                      value={selected.formPumpPreference ?? ""}
                      onChange={(v) => edit({ formPumpPreference: v })}
                      options={["Tandem t:slim X2", "Tandem Mobi", "Beta Bionics iLet", "Not sure"]}
                    />
                    <EditSelect
                      label="Pump Need"
                      value={selected.formPumpNeed ?? ""}
                      onChange={(v) => edit({ formPumpNeed: v })}
                      options={["Need a new pump", "Only need supplies"]}
                    />
                    <EditSelect
                      label="Insulin Pump Coverage Path"
                      value={selected.insulinPumpCoveragePath ?? ""}
                      onChange={(v) => edit({ insulinPumpCoveragePath: v })}
                      options={IP_PATH_OPTS}
                    />
                  </div>
                </div>

                {/* CGM data collection — full width, below the aligned rows,
                    and only while the CGM category is on (as the mockup gates
                    it). The rep-side upload works today; the patient-side
                    "send them a link" half is §8.3 and needs a service that
                    doesn't exist. */}
                {cgmOn && (
                  <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px dashed var(--border)" }}>
                    <div className="flabel">CGM Data File</div>
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      Sending the patient an upload link isn’t built yet (§8.3) — for now, attach the
                      file yourself once they email or text it over.
                    </p>
                    <label
                      className={cgmDragOver ? "upzone over" : "upzone"}
                      onDragOver={(e) => { e.preventDefault(); setCgmDragOver(true); }}
                      onDragLeave={() => setCgmDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setCgmDragOver(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) void uploadCgmFile(f);
                      }}
                    >
                      <div className="uz-t">
                        {cgmUploading ? "Uploading…" : "Drop a file here, or click to choose"}
                      </div>
                      <div className="sugg-note">PDF, CSV, or an exported report / screenshot</div>
                      <input
                        type="file"
                        style={{ display: "none" }}
                        disabled={cgmUploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadCgmFile(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                )}

                <div className="derived-strip">
                  <span className="dlabel">Request Type</span>
                  <span className="sugg-chip2">{selected.requestType?.trim() || "—"}</span>
                </div>

                {/* Request Type is DERIVED from the categories above in the
                    mockup ("computed — never typed"), but nothing computes it
                    yet, so it stays editable below the strip rather than
                    becoming a read-only chip that no longer has a source. */}
                <div className="mt-4">
                  <EditSelect
                    full
                    label="Request Type — shared with Serving & Coverage on the right"
                    value={selected.requestType ?? ""}
                    onChange={(v) => edit({ requestType: v })}
                    options={REQUEST_TYPE_OPTS}
                  />
                </div>
              </Card>

              <Card title="Provided Insurance" tone="lead">
                {/* Mockup leads with Provided Via as a segmented 3-up, above
                    the field grid — not as one dropdown inside it. */}
                <div className="mb-4">
                  <Seg
                    label="Provided Via"
                    value={selected.formInsuranceVia ?? ""}
                    onChange={(v) => edit({ formInsuranceVia: v })}
                    options={["Photo of card", "Entered manually", "Not provided"]}
                  />
                </div>
                <div className="fgrid">
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
                  {/* Both columns were already read into Patient and nothing
                      ever wrote them — this is the button they were waiting
                      for. Flags Follow Up and dates it today; the mockup's
                      "follow-up text sent" half needs the messaging wiring
                      that Patient Messages also needs. */}
                  <button
                    onClick={startFollowUp}
                    disabled={saving}
                    className="btn secondary sm"
                    title="Flag this patient for insurance follow-up, dated today"
                  >
                    Start Insurance Follow-Up
                  </button>
                  {(selected.followUp ?? "").trim() && (
                    <span className="text-xs text-muted-foreground">
                      Following up{(selected.followUpDate ?? "").trim() ? ` · ${selected.followUpDate}` : ""}
                    </span>
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

              <Card title="Proceed Preference" tone="lead">
                <Pills
                  label="How would they like to proceed?"
                  value={selected.formProceedPreference ?? ""}
                  onChange={(v) => edit({ formProceedPreference: v })}
                  options={["Send request now", "Wants a call first"]}
                />

                {/* Booking block — the mockup shows it only when the patient
                    asked for a call. */}
                {(selected.formProceedPreference ?? "") === "Wants a call first" && (
                  <div
                    style={{ marginTop: 16, paddingTop: 14, borderTop: "1px dashed var(--border)" }}
                  >
                    <div className="flabel">Call Booking</div>
                    <div className="bookrow">
                      <div>
                        <div className="eyebrow-xs">Selected on form</div>
                        <div className="bookval">{selected.formCallSlot?.trim() || "—"}</div>
                      </div>
                      {(selected.formBookingStatus ?? "").trim() && (
                        <span className={
                          (selected.formBookingStatus ?? "").trim() === "Scheduled" ? "mp green" : "mp"
                        }>
                          {selected.formBookingStatus}
                        </span>
                      )}
                    </div>

                    {/* The mockup's override is a picker of LIVE Calendly
                        openings. There is no Calendly integration, so this is
                        a free-text slot plus an explicit Confirm — the half
                        that works without one. A dropdown of invented times
                        would be worse than no dropdown: the rep would think
                        those openings were real. */}
                    <div style={{ marginTop: 14 }}>
                      <EditText
                        full
                        label="Override — enter a different opening"
                        placeholder="e.g. Thu 11:00 AM"
                        value={selected.formCallSlot ?? ""}
                        onChange={(v) => edit({ formCallSlot: v })}
                      />
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          className="btn primary sm"
                          disabled={saving || !(selected.formCallSlot ?? "").trim()}
                          onClick={() => edit({ formBookingStatus: "Scheduled" })}
                          title={
                            (selected.formCallSlot ?? "").trim()
                              ? "Mark this slot Scheduled — Save writes it"
                              : "Enter a slot first"
                          }
                        >
                          Confirm booking
                        </button>
                        {(selected.formBookingStatus ?? "") !== "Scheduled" && (
                          <button
                            className="btn secondary sm"
                            disabled={saving}
                            onClick={() => edit({ formBookingStatus: "Unscheduled" })}
                          >
                            Mark unscheduled
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Hidden when the patient already authorised us — the checkbox
                    is irrelevant then and must not be shown (HANDOFF §7.2). */}
                {(selected.formProceedPreference ?? "") !== "Send request now" && (
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px dashed var(--border)" }}>
                    <label className="checkline">
                      <input
                        type="checkbox"
                        checked={(selected.intakeCallComplete ?? "").trim().toLowerCase() === "yes"}
                        onChange={(e) => edit({ intakeCallComplete: e.target.checked ? "Yes" : "" })}
                      />
                      <span>
                        <b>Intake Call Complete</b>
                        <span className="sugg-note" style={{ display: "block", marginTop: 2 }}>
                          Check this once you have finished the intake call — required to advance.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </Card>

              {/* ── Patient Messages ── Text via the gateway (sender taken from
                  the verified token server-side), Email via the same worker
                  route Send Request uses. Sending is blocked on the shared
                  TCPA/CTIA opt-out guard. */}
              <IntakeMessages
                patientId={selected.id}
                phone={selected.ptPhone}
                email={selected.email}
              />

              {/* ── Call Log & Notes ── append-only and stamped, per the note
                  under the mockup's card and CLAUDE.md §9. The log is rendered
                  read-only; the box below appends ONE line. Binding a textarea
                  straight to `notes` would replace the history on first save. */}
              <Card title="Call Log & Notes">
                <div>
                  {(selected.notes ?? "").trim()
                    ? (selected.notes ?? "")
                        .split("\n")
                        .filter((l) => l.trim())
                        .map((line, i) => (
                          <div key={i} className="note-entry">{line}</div>
                        ))
                    : <div className="text-xs text-muted-foreground">No notes yet.</div>}
                </div>
                <div className="note-add">
                  <textarea
                    value={noteDraft}
                    placeholder="Add a note…"
                    onChange={(e) => setNoteDraft(e.target.value)}
                  />
                  <button
                    className="btn primary sm"
                    disabled={saving || !noteDraft.trim()}
                    onClick={addNote}
                  >
                    + Add
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Append-only. Each line is stamped with the ET time, the stage and your initials.
                </p>
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
                    {/* Three `.route` cards, as the mockup has them — one per
                        exit — instead of a flat button row. The Escalation card
                        that used to sit below this is folded into the third
                        route; the mockup has no separate escalation section. */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button onClick={save} disabled={saving} className="btn primary">
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        Saves the left pane without advancing.
                      </span>
                    </div>

                    <div className="route-stack" style={{ marginTop: 14 }}>
                      <div className={unlock.unlocked ? "route adv on" : "route adv"}>
                        <h4>Advance to Profile Clean-Up</h4>
                        <p>Referral info is sufficient → unlock the profile checklist on the right.</p>
                        {/* A disabled button with no explanation is the thing
                            reps escalate about (§2), so the blockers stay
                            visible rather than living in a tooltip. */}
                        <ul className="space-y-2" style={{ margin: "4px 0 12px" }}>
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
                        {/* The pane itself unlocks from the four conditions
                            (HANDOFF §2: "not unlocked by a button click"), so
                            this takes the rep TO the unlocked pane rather than
                            gating it a second time. */}
                        <button
                          onClick={() => cleanUpRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                          disabled={!unlock.unlocked || saving}
                          className="btn primary"
                          title={unlock.unlocked ? undefined : "Blocked by the checklist above"}
                        >
                          Advance to Profile Clean-Up →
                        </button>
                      </div>

                      <div className="route intake on">
                        <h4>Insufficient — log call</h4>
                        <p>Missing info → call the patient, collect it above, then log the attempt.</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={logAttempt} disabled={saving} className="btn amber">
                            Log call attempt
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {attempts} attempt{attempts === 1 ? "" : "s"} logged
                          </span>
                        </div>
                      </div>

                      <div className="route esc on">
                        <h4>Escalate — doesn't qualify</h4>
                        <p>
                          Patient doesn't meet criteria for this request → flag for supervisor review
                          instead of advancing.
                        </p>
                        {/* Reason is required — a manager can't action a blank
                            escalation. */}
                        <div className="inline-panel" style={{ display: "block" }}>
                          <textarea
                            value={escalateReason}
                            placeholder="Add context for the reviewer…"
                            onChange={(e) => setEscalateReason(e.target.value)}
                          />
                          <button
                            onClick={() => runStageAction("escalate")}
                            disabled={saving || !escalateReason.trim()}
                            className="btn rose sm"
                            style={{ marginTop: 9 }}
                          >
                            Submit escalation
                          </button>
                        </div>
                      </div>
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
