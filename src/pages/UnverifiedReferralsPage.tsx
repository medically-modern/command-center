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
import { AlertTriangle, ClipboardCheck, Lock, Check, X, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
// History-first Back, same as every other stage page — returns a manager to
// their Oversight drill-down rather than a hardcoded home route (§9).
import { useBackNavigation } from "@/hooks/useBackNavigation";

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
  CGM_TYPE_INDEX, PUMP_TYPE_INDEX,
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
// Evaluate's Call + Text buttons, reused as-is.
import { PatientContact } from "@/components/masheke/mmKit";
// The same stamped-note renderer Verified Referrals uses, so the two stages
// display an identical log.
import { NoteLog } from "@/components/profile/NoteLog";
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
import { etToday, addBusinessDaysIso } from "@/lib/masheke/etDate";
import { toast } from "sonner";
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
const CGM_TYPE_OPTS = Object.keys(CGM_TYPE_INDEX);
const PUMP_TYPE_OPTS = Object.keys(PUMP_TYPE_INDEX);
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

/**
 * One named file column, rendered as the mockup's `.file-row`.
 *
 * A Monday file column's `text` is the filename, not a URL, so the row is
 * matched against the item's assets to get something the viewer can open. When
 * there's no match the name still renders, greyed and unclickable — the file IS
 * on the column, we just couldn't resolve a URL for it, and silently showing
 * nothing would read as "the patient never sent one".
 */
function FileColumnRow({
  label, filename, assets,
}: {
  label: string; filename?: string; assets: MondayAsset[] | null;
}) {
  const name = (filename ?? "").trim();
  if (!name) return null;
  // The column can list several; the assets list is the source of truth for
  // what's actually attached.
  const names = name.split(",").map((n) => n.trim()).filter(Boolean);
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="flabel">{label}</div>
      {names.map((n) => {
        const asset = assets?.find((a) => a.name === n) ?? null;
        return asset ? (
          <div
            key={n}
            className="file-row"
            onClick={() => openFileViewer({ url: asset.public_url || asset.url, name: asset.name })}
          >
            <span className="fname">{n}</span>
            <span className="fmeta">{n.split(".").pop() ?? ""}</span>
          </div>
        ) : (
          <div key={n} className="file-row" style={{ opacity: 0.6, cursor: "default" }}>
            <span className="fname">{n}</span>
            <span className="fmeta">{assets === null ? "loading" : "no preview"}</span>
          </div>
        );
      })}
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
    cgmType: p.cgmType,
    pumpType: p.pumpType,
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
    clinicAddress: p.clinicAddress,
    clinicAddressLat: p.clinicAddressLat,
    clinicAddressLng: p.clinicAddressLng,
    formProceedPreference: p.formProceedPreference,
    formCallSlot: p.formCallSlot,
    formBookingStatus: p.formBookingStatus,
    intakeCallComplete: (p.intakeCallComplete ?? "").trim().toLowerCase() === "yes",
    selfAdvocacy: p.selfAdvocacy,
    currentOopCost: p.currentOopCost,
    cgmDataAwareness: p.cgmDataAwareness,
    // followUp / followUpDate are NOT sent either. `logAttempt` owns the
    // snooze and writes both explicitly. Round-tripping them through every
    // Save only creates a way to lose one: writeDate with a blank string
    // CLEARS the column, so a save whose local copy of the date was stale
    // would silently un-snooze the patient back onto the burndown.
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
    // writeVerifiedInsurance REFUSES the advance without this, so it has to be
    // visible here — otherwise the rep only learns about it from an error after
    // pressing Advance. The mockup lists the same row.
    if ((verified.secondaryInsurance ?? "").trim() === "NY Medicaid") {
      items.push({
        label: "Member ID 2 (required for NY Medicaid)",
        ok: !!(verified.memberId2 ?? "").trim(),
      });
    }
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
  }, [selected, verified.primaryInsurance, verified.memberId1,
      verified.secondaryInsurance, verified.memberId2]);

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

  /**
   * Two rep-entered facts that also belong in the Call Log: Current
   * Out-of-Pocket Cost and Self Advocacy (Josh, 2026-08-10). They keep their
   * own columns — this just mirrors them into the log, so a manager reading it
   * sees what was learned on the call without cross-referencing two columns.
   *
   * Snapshotted per patient so a line is appended only when the value CHANGED.
   * Appending on every save would restamp the same fact each time the rep
   * pressed Save and bury the actual call notes.
   *
   * Declared ABOVE save() on purpose — naming it in save's dependency array
   * before the const initialises throws on first render.
   */
  const loggedFacts = useRef<{ oop: string; adv: string }>({ oop: "", adv: "" });
  useEffect(() => {
    loggedFacts.current = {
      oop: (selected?.currentOopCost ?? "").trim(),
      adv: (selected?.selfAdvocacy ?? "").trim(),
    };
  }, [selected?.id]);

  const logChangedFacts = useCallback(async (p: Patient) => {
    const oop = (p.currentOopCost ?? "").trim();
    const adv = (p.selfAdvocacy ?? "").trim();
    const lines: string[] = [];
    if (oop && oop !== loggedFacts.current.oop) lines.push(`Current Out-of-Pocket Cost: ${oop}`);
    if (adv && adv !== loggedFacts.current.adv) lines.push(`Self Advocacy: ${adv}`);
    if (!lines.length) return;
    // Sequential: appendIntakeNote reads the log back before appending, so
    // firing both at once would have the second overwrite the first.
    let prior: string | undefined = p.notes;
    for (const line of lines) {
      const res = await appendIntakeNote(p.id, line, prior);
      if (!res.ok) return; // snapshot untouched, so the next save retries
      prior = undefined; // force a re-read for the second line
    }
    loggedFacts.current = { oop, adv };
  }, []);

  const save = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setSaveNote(null);
    const edits: IntakeEdits = intakeEditsFor(selected);
    try {
      const res = await writeIntakeEdits(selected.id, edits);
      // Partial success is reported, not swallowed — the rep needs to know
      // exactly which field didn't make it rather than a blanket "saved".
      // Toasted as well as inlined: this writes to Monday, and the inline note
      // sits at the bottom of a long pane where a rep saving from the header
      // never sees it.
      if (res.ok) {
        // Cost + Self Advocacy also go into the Call Log, once, on change.
        await logChangedFacts(selected);
        toast.success("Saved to Monday");
        setSaveNote("Saved.");
      } else {
        const failed = res.errors.map((e) => e.label).join(", ");
        toast.error("Saved, except some columns", { description: failed });
        setSaveNote(`Saved, except: ${failed}`);
      }
      await refetch(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Save failed", { description: msg });
      setSaveNote(`Save failed — ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [selected, refetch, logChangedFacts]);

  const [escalateReason, setEscalateReason] = useState("");
  const { goBack } = useBackNavigation();

  /** The unlock checklist. One definition, rendered by BOTH branches of Ready
   *  to Advance — the badge counts blockers on a partial as well, so hiding
   *  the list there left a number nobody could act on. */
  const blockerList = (
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
  );

  /** Which rung a Propose Stuck from here lands on. Hoisted out of the click
   *  handler so the card can NAME the destination — the previous copy told the
   *  rep "Final Decisions" while the write went to Manager Intervention. */
  const stuckLevel = proposeStuckLevel(
    "unverified-intake", managerOrigin, selected?.intakeEscalation,
  );

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
            ? await proposeIntakeStuck(
                selected.id, escalateReason, notes, stuckLevel,
                managerOrigin === "manager-intervention" ? "manager-intervention"
                : managerOrigin === "final-decisions" ? "final-decisions"
                : "processor",
              )
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
    [selected, escalateReason, refetch, verified, clinicLabelId, stuckLevel],
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
   * "Start Insurance Follow-Up" opens the SAME text composer Evaluate uses,
   * prefilled with a friendly check-in.
   *
   * It used to write Follow Up + Follow Up Date. That was wrong: on this board
   * Follow Up is the SNOOZE, and `useRoleCounts` treats an intake patient as
   * active only while it's unset — so "start a follow-up" quietly took the
   * patient off today's burndown and parked them in the sidebar's Follow Up
   * section. Reaching out to someone is not the same as deferring them.
   */
  const [followUpTextOpen, setFollowUpTextOpen] = useState(false);
  /** Only set when the follow-up BUTTON opens the composer. The plain Text
   *  button beside the patient's name must open an empty box — a rep texting
   *  about something else shouldn't have to clear a template first. */
  const [followUpPrefill, setFollowUpPrefill] = useState<string | undefined>();
  useEffect(() => {
    setFollowUpTextOpen(false);
    setFollowUpPrefill(undefined);
  }, [selected?.id]);
  const followUpTemplate = useCallback(() => {
    const first = splitName(selected?.name).first || "there";
    return `Hi ${first}, it's the team at Medically Modern! We're working on your insurance `
      + `benefits for your diabetes supplies. Has anything changed with your coverage or plan `
      + `recently — new card, new insurance, anything like that? Just reply here and we'll take `
      + `care of the rest. Thank you!`;
  }, [selected?.name]);
  /** Append one stamped line to the Call Log and write it straight to Monday. */
  const [noteDraft, setNoteDraft] = useState("");
  useEffect(() => { setNoteDraft(""); }, [selected?.id]);
  const addNote = useCallback(async () => {
    if (!selected || !noteDraft.trim()) return;
    setSaving(true);
    try {
      const res = await appendIntakeNote(selected.id, noteDraft, selected.notes);
      if (res.ok) {
        toast.success("Note added to Monday");
        setNoteDraft("");
        await refetch(true);
      } else {
        toast.error("Couldn't add the note", {
          description: res.errors.map((e) => e.error).join(" · "),
        });
      }
    } finally {
      setSaving(false);
    }
  }, [selected, noteDraft, refetch]);

  const startInsuranceFollowUp = useCallback(() => {
    setFollowUpPrefill(followUpTemplate());
    setFollowUpTextOpen(true);
  }, [followUpTemplate]);

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
  const [cardUploading, setCardUploading] = useState(false);

  /** Shared by both upload affordances — the CGM drop zone and the Files
   *  card's attach button. Only the target column differs. */
  const uploadTo = useCallback(async (
    columnId: string, files: File[], setBusy: (b: boolean) => void,
  ) => {
    if (!selected || !files.length) return;
    setBusy(true);
    const failed: string[] = [];
    try {
      // Sequential: Monday's file API is a multipart POST per file, and firing
      // several at one column races them.
      for (const file of files) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          await uploadFileToColumn(
            selected.id, columnId, bytes, file.name,
            file.type || "application/octet-stream",
          );
        } catch (e) {
          console.error("[intake upload]", file.name, e);
          failed.push(file.name);
        }
      }
      const ok = files.length - failed.length;
      if (ok > 0) toast.success(`Attached ${ok} file${ok === 1 ? "" : "s"}`);
      if (failed.length) {
        toast.error(`Couldn't attach ${failed.length}`, { description: failed.join(", ") });
      }
      setAssets(null); // re-fetch so they appear in the Files card
      await refetch(true);
    } finally {
      setBusy(false);
    }
  }, [selected, refetch]);

  const uploadCgmFile = useCallback(
    (files: File[]) => uploadTo(COL.cgmDataFile, files, setCgmUploading),
    [uploadTo],
  );
  const uploadCardFile = useCallback(
    (files: File[]) => uploadTo(COL.formCardPhoto, files, setCardUploading),
    [uploadTo],
  );

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

  /**
   * Log a contact attempt and snooze the patient to the next business day.
   *
   * This board has no Next Action Date column — Follow Up (`color_mm3822qq`)
   * + Follow Up Date (`date_mm3874an`) ARE its next-action mechanism.
   * `useRoleCounts` counts an intake patient as active only while Follow Up
   * isn't set, so writing the pair is what takes them off today's burndown bar
   * and puts them in the sidebar's Follow Up section until the date lands.
   *
   * Business days, not calendar: a Friday attempt should surface on Monday,
   * not Saturday. ET, because Monday's dates are timezone-naive ET (§9).
   */
  const logAttempt = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const next = await logContactAttempt(selected.id, selected.attemptCounter);
      const due = addBusinessDaysIso(etToday(), 1);
      const res = await writeIntakeEdits(selected.id, {
        followUp: "Follow Up",
        followUpDate: due,
      });
      edit({ attemptCounter: String(next), followUp: "Follow Up", followUpDate: due });
      if (res.ok) {
        toast.success(`Attempt ${next} logged`, { description: `Back in the queue ${due}.` });
        setSaveNote(`Attempt ${next} logged — snoozed to ${due}.`);
      } else {
        // The attempt landed but the snooze didn't; say so rather than implying
        // the patient has left today's queue when they haven't.
        const failed = res.errors.map((e) => e.label).join(", ");
        toast.error(`Attempt ${next} logged, but not snoozed`, { description: failed });
        setSaveNote(`Attempt ${next} logged, but the follow-up date didn't save: ${failed}`);
      }
      await refetch(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not log attempt", { description: msg });
      setSaveNote(`Could not log attempt — ${msg}`);
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
      {/* ⚠️ `.pf-root` deliberately does NOT wrap the sidebar or the header.
          redesign.css resets bare elements under it — `.pf-root button` clears
          background, border and colour outright — which beats a Tailwind class
          on specificity. With the whole page wrapped, every shadcn control in
          the sidebar and the header rendered stripped, which is what made the
          chrome look unlike the rest of Command Center. ProfilePage scopes it
          to the stepped content for the same reason; match that. */}
      <div className="h-screen overflow-hidden flex w-full bg-gradient-subtle">
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
          /* On this stage Follow Up is the snooze that "log call attempt"
             writes, so the section would just mirror the deferred patients
             into a second list with a button that un-snoozes them. */
          hideFollowUp
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

        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border flex-none">
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              {/* Same shape as Verified Referrals' header (ProfilePage), which
                  is also what the mockup's own chrome note specifies: back
                  button, app tile, eyebrow, title, patient subtitle, and the
                  emerald Save on the right. */}
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button
                  onClick={() => goBack()}
                  className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <ClipboardCheck className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Patient Intake — DTC &amp; CareCentrix</h1>
                  {selected && (
                    <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={save}
                  disabled={!selected || saving}
                  className="bg-gradient-primary text-primary-foreground shadow-elevate"
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </header>

          {error && (
            <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm flex-none">
              {error}
            </div>
          )}

          {/* Contact strip. The NAME is not repeated here — it's already the
              header subtitle, and printing it twice at two sizes is most of
              what made this look unlike the other roles. Outside `.pf-root`
              so Evaluate's Call/Text buttons keep their own styling. */}
          {selected && (
            <div className="flex items-center gap-3 flex-wrap border-b bg-card px-6 py-3 flex-none">
              <PatientContact
                phone={selected.ptPhone}
                textPrefill={followUpPrefill}
                textOpen={followUpTextOpen}
                onTextOpenChange={(o) => {
                  setFollowUpTextOpen(o);
                  // Drop the template once the dialog closes, so the next
                  // plain "Text" click opens an empty composer.
                  if (!o) setFollowUpPrefill(undefined);
                }}
              />
              <span className="text-sm text-muted-foreground">
                {[selected.dob, selected.email].filter(Boolean).join(" · ") || "—"}
              </span>
              <span className="ml-auto text-xs font-semibold text-muted-foreground">
                {attempts === 0 ? "No contact attempts yet" : `Attempt ${attempts}`}
              </span>
            </div>
          )}

          {!selected ? (
            <div className="m-6 text-sm text-muted-foreground">Select a patient.</div>
          ) : (
            <div className="pf-root flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Two elements, not one. `.pf-root .panes-host` is a DESCENDANT
                selector — it is what sets `container-name: panes`, and the
                whole two-pane split hangs off the `@container panes` query.
                Put both classes on the same div and the rule never matches:
                the container is never named, the query never fires, and the
                page is permanently stacked with no error anywhere. */}
            <div className="panes-host flex-1 flex flex-col min-w-0">
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
                  {/* Josh, 2026-08-10: not needed. Left in place rather than
                      deleted — the updates fetch and the render below are still
                      wired, so this is the only line to restore if the referral
                      body is ever wanted on the page again.
                  <button
                    className="btn secondary sm"
                    style={{ marginTop: 12 }}
                    onClick={() => setRefOpen((o) => !o)}
                  >
                    {refOpen ? "Hide referral email / updates" : "Show referral email / updates"}
                  </button>
                  */}
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
                {/* TWO buttons, one per file column — Monday files live IN A
                    COLUMN, so an upload has to pick one and a single "Upload
                    documents" button could only guess. The two are different
                    things from different sources:
                      Insurance Card Photo — the patient can attach this on the
                        intake FORM, so it often arrives on its own.
                      CGM Data File — never from the form. HANDOFF §8.3: the rep
                        sends the patient a tokenized upload link ON THE CALL
                        and they upload from their phone. That link isn't built,
                        so this button is how the file gets there today.
                    ⚠️ <label>, not <button>: `.pf-root button` strips
                    background/border off bare buttons. And do NOT reach for
                    `.upzone` here — it is display:none until something adds
                    `.show`, which is why the first cut of this was invisible. */}
                <div style={{ padding: "0 8px 10px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <label
                    className="btn secondary sm"
                    style={{ display: "inline-flex", cursor: cardUploading ? "wait" : "pointer" }}
                    title="Saves to the Insurance Card Photo column"
                  >
                    {cardUploading ? "Uploading…" : "Upload insurance card"}
                    <input
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.heic,.pdf"
                      style={{ display: "none" }}
                      disabled={cardUploading}
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length) void uploadCardFile(files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <label
                    className="btn secondary sm"
                    style={{ display: "inline-flex", cursor: cgmUploading ? "wait" : "pointer" }}
                    title="Saves to the CGM Data File column"
                  >
                    {cgmUploading ? "Uploading…" : "Upload CGM data"}
                    <input
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.heic,.pdf,.csv"
                      style={{ display: "none" }}
                      disabled={cgmUploading}
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length) void uploadCgmFile(files);
                        e.target.value = "";
                      }}
                    />
                  </label>
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
                    {/* The DEVICE, first in the column as the mockup has it —
                        distinct from the patient's stated preference below. */}
                    <EditSelect
                      label="CGM Type"
                      value={selected.cgmType ?? ""}
                      onChange={(v) => edit({ cgmType: v })}
                      options={CGM_TYPE_OPTS}
                    />
                    <EditSelect
                      label="CGM Coverage Path"
                      value={selected.cgmCoveragePath ?? ""}
                      onChange={(v) => edit({ cgmCoveragePath: v })}
                      options={CGM_PATH_OPTS}
                    />
                    <EditSelect
                      label="CGM Preference"
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
                      label="Pump Type"
                      value={selected.pumpType ?? ""}
                      onChange={(v) => edit({ pumpType: v })}
                      options={PUMP_TYPE_OPTS}
                    />
                    <EditSelect
                      label="Pump Preference"
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
                    <FileColumnRow
                      label="CGM Data File"
                      filename={selected.cgmDataFile}
                      assets={assets}
                    />
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      Sending the patient an upload link isn’t built yet (§8.3) — for now, attach the
                      file yourself once they email or text it over.
                    </p>
                    <label
                      className={cgmDragOver ? "upzone show over" : "upzone show"}
                      onDragOver={(e) => { e.preventDefault(); setCgmDragOver(true); }}
                      onDragLeave={() => setCgmDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setCgmDragOver(false);
                        const fs = Array.from(e.dataTransfer.files ?? []);
                        if (fs.length) void uploadCgmFile(fs);
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
                          const fs = Array.from(e.target.files ?? []);
                          if (fs.length) void uploadCgmFile(fs);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                )}

                {/* The mockup's derived Request Type chip is gone. It printed
                    the same value as the editable field right below it, so the
                    card read "Request Type" twice. Nothing computes the value
                    yet, so the editable field is the real one. */}

                {/* Request Type is DERIVED from the categories above in the
                    mockup ("computed — never typed"), but nothing computes it
                    yet, so it stays editable below the strip rather than
                    becoming a read-only chip that no longer has a source. */}
                <div className="mt-4">
                  <EditSelect
                    full
                    label="Request Type"
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
                {/* What the patient actually sent, where the mockup puts it —
                    the Files rail-card lists every asset on the item, but the
                    rep shouldn't have to work out which one is the card. */}
                <FileColumnRow
                  label="Insurance Card Photo"
                  filename={selected.formCardPhoto}
                  assets={assets}
                />
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
                {/* Two actions on one row, each with its own status line below
                    rather than jammed in beside it — the messages are what made
                    this wrap raggedly. */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    onClick={runBenefitsCheck}
                    disabled={saving || stedi.isRunning || !(selected.generalInsurance ?? "").trim()}
                    className="btn primary sm"
                  >
                    {stedi.isRunning ? "Running benefits check…" : "Run benefits check"}
                  </button>
                  <button
                    onClick={startInsuranceFollowUp}
                    disabled={saving || !(selected.ptPhone ?? "").trim()}
                    className="btn secondary sm"
                    title={
                      (selected.ptPhone ?? "").trim()
                        ? "Open the text composer with an insurance check-in ready to send"
                        : "No phone number on file"
                    }
                  >
                    Start Insurance Follow-Up
                  </button>
                </div>
                {!(selected.generalInsurance ?? "").trim() && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    The benefits check needs General Insurance first.
                  </p>
                )}
                {stedi.state.message && (
                  <p className={
                    "mt-2 text-xs " +
                    (stedi.state.phase === "error" ? "text-destructive" : "text-muted-foreground")
                  }>
                    {stedi.state.message}
                  </p>
                )}
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
                  {/* Writes the VERIFIED clinic address column
                      (location_mm1xjnfv) — Josh's call: there is no separate
                      provided-address column and one isn't wanted. Picking a
                      provider in step 3 overwrites this, which is intended. */}
                  <EditText
                    full
                    label="Clinic Address"
                    placeholder="Collect on call"
                    value={selected.clinicAddress ?? ""}
                    onChange={(v) => edit({ clinicAddress: v })}
                  />
                </div>

                {/* The mockup's "Helpful Links / Identification Info" IS Doctor
                    Notes (Josh) — but the right pane's Select Correct Provider
                    already carries that panel, and it's the same MM Doctor
                    Database record either way (keyed by NPI, per-DOCTOR). A
                    second copy on this card is the same notes twice on one
                    screen, so it lives on the right only. */}
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
              <IntakeMessages patientId={selected.id} email={selected.email} />

              {/* ── Call Log & Notes ── append-only and stamped, per the note
                  under the mockup's card and CLAUDE.md §9. The log is rendered
                  read-only; the box below appends ONE line. Binding a textarea
                  straight to `notes` would replace the history on first save. */}
              {/* Same BEHAVIOUR as Evaluate's notes — append-only, stamped
                  "[ET time] Patient Intake: … —XX" through the one shared
                  `appendStampedNote`, saved to Monday with a toast — but in
                  this page's own markup.

                  Evaluate's NotesPanel is built from shadcn controls, and
                  `.pf-root button` strips background/border off every button
                  under it, so dropping it in here rendered as bare text on a
                  bare box. Sharing the stamping function rather than the
                  component is what keeps the two consistent where it counts. */}
              <Card title="Call Log & Notes">
                {(selected.notes ?? "").trim() ? (
                  <NoteLog text={selected.notes ?? ""} />
                ) : (
                  <p className="sugg-note">No notes yet.</p>
                )}
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
                  <>
                    <p className="text-sm text-muted-foreground">
                      This is an incomplete form. Advancing a partial isn't defined yet — work it as
                      outreach, or wait for the patient to finish.
                    </p>
                    {/* The badge counts blockers on a partial too, so the list
                        has to be here — a bare "4 BLOCKING" with nothing under
                        it tells the rep a number and no way to act on it. It
                        also doubles as the outreach script: these are exactly
                        the things to collect on the call. */}
                    <p className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Still needed
                    </p>
                    {blockerList}
                  </>
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
                        {blockerList}
                        {/* NOT an advance. The right pane unlocks from the
                            conditions above on its own (HANDOFF §2: "not
                            unlocked by a button click"), so all this does is
                            scroll there — and calling it "Advance" made reps
                            look for an action that doesn't exist. Reworded to
                            say what it does. */}
                        <button
                          onClick={() => cleanUpRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                          disabled={!unlock.unlocked || saving}
                          className="btn primary"
                          title={
                            unlock.unlocked
                              ? "Jump to the Profile Clean-Up pane"
                              : "Blocked by the checklist above"
                          }
                        >
                          {unlock.unlocked ? "Go to Profile Clean-Up →" : "Profile Clean-Up locked"}
                        </button>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          The pane on the right unlocks by itself once these pass — this just takes
                          you there. The send-off happens over there.
                        </p>
                      </div>

                      <div className="route intake on">
                        <h4>Insufficient — log call</h4>
                        <p>
                          Missing info → call the patient, collect it above, then log the attempt.
                          Snoozes them to the next business day.
                        </p>
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
                        <h4>Propose Stuck</h4>
                        <p>
                          Patient doesn't meet criteria for this request → send to{" "}
                          {stuckLevel === "final" ? "Final Decisions" : "Manager Intervention"} for
                          review instead of advancing.
                        </p>
                        {/* Reason is required — a manager can't action a blank
                            proposal, and the reason is the whole handover. */}
                        <div className="inline-panel" style={{ display: "block" }}>
                          <textarea
                            value={escalateReason}
                            placeholder="Why is this patient stuck?"
                            onChange={(e) => setEscalateReason(e.target.value)}
                          />
                          <button
                            onClick={() => runStageAction("proposeStuck")}
                            disabled={saving || !escalateReason.trim()}
                            className="btn rose sm"
                            style={{ marginTop: 9 }}
                          >
                            Propose Stuck
                          </button>
                        </div>
                      </div>
                    </div>

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
          </div>
          </div>
        )}
        </div>
      </div>
    </SidebarProvider>
  );
};

export default UnverifiedReferralsPage;
