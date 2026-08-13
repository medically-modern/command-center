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
import { AlertTriangle, ClipboardCheck, Lock, Check, X, ArrowLeft, CalendarClock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
// History-first Back, same as every other stage page — returns a manager to
// their Oversight drill-down rather than a hardcoded home route (§9).
import { useBackNavigation } from "@/hooks/useBackNavigation";

import { useMondayPatients } from "@/hooks/profile/useMondayPatients";
import { GROUPS, fetchClinicLabels, clearFileColumn } from "@/lib/profile/mondayApi";
// §6.1: this is the EXISTING component, unchanged. Search, Parachute panel,
// location grid, order count and notes all behave exactly as on /profile —
// rebuilding it would fork behaviour reps already rely on.
import { DoctorSection } from "@/components/profile/DoctorSection";
import { AddressAutocomplete } from "@/components/profile/AddressAutocomplete";
import BookingLinkDialog from "@/components/scheduledCalls/BookingLinkDialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
// `coverageActive` / `inNetwork` are imported so the benefits-check readout
// renders from the SAME predicates the unlock checklist gates on — a second
// copy of "is this in network" is how a green readout ends up sitting next to
// a blocked advance.
import { evaluateUnlock, coverageActive, inNetwork } from "@/lib/profile/intakeUnlock";
import {
  PRIMARY_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX, SERVING_INDEX,
  GENERAL_INSURANCE_INDEX,
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
  suggestPrimary, suggestSecondary, buildSuggestionInputs, isNyMedicaidId,
} from "@/lib/profile/primaryInsurance";
import type { Patient } from "@/lib/profile/workflow";
import { addressWarning } from "@/lib/profile/workflow";
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
import {
  generateUploadLink, uploadLinkMessage, uploadLinksConfigured,
  getRescheduleLink, formatBookedCall,
} from "@/lib/profile/uploadLink";
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
import { useAccessContext } from "@/components/AccessProvider";
import { managerPeople, processorPeople } from "@/lib/people";
import { coordinatorNoteLine, extractCoordinator } from "@/lib/profile/careCoordinator";
import { fetchBoardLabels, HIDDEN_LABELS, type LiveLabels } from "@/lib/profile/boardLabels";
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
/**
 * Yes / No for a Stedi flag — or "—" when the column is blank.
 *
 * ⚠️ Blank must NOT render as "No". An empty column means the check hasn't
 * produced an answer for that field; "No" is a negative RESULT, and on this
 * card the difference is "we don't know yet" vs "this plan is out of network".
 * The predicates themselves are boolean and can't express the gap, so the raw
 * value is what decides whether there is anything to report.
 */
const stediYesNo = (raw: string | undefined, decided: boolean): string =>
  (raw ?? "").trim() ? (decided ? "Yes" : "No") : "—";

const SERVING_OPTS = Object.keys(SERVING_INDEX);
// No REQUEST_TYPE_OPTS: Request Type is display-only on this page (it arrives
// set from the referral and drives four board automations), so there is no
// picker to build.
const CGM_PATH_OPTS = Object.keys(CGM_COVERAGE_PATH_INDEX);
const IP_PATH_OPTS = Object.keys(INSULIN_PUMP_COVERAGE_PATH_INDEX);
const GENERAL_INSURANCE_OPTS = Object.keys(GENERAL_INSURANCE_INDEX);
const CGM_TYPE_OPTS = Object.keys(CGM_TYPE_INDEX);
const PUMP_TYPE_OPTS = Object.keys(PUMP_TYPE_INDEX);
const REFERRAL_TYPE_OPTS = Object.keys(REFERRAL_TYPE_INDEX);
const REFERRAL_SOURCE_OPTS = Object.keys(REFERRAL_SOURCE_INDEX);

/** Read-only field. Used for anything the patient told us that the rep is not
 *  expected to retype — the left pane should be a confirmation, not data entry. */
/**
 * A read-only value.
 *
 * `boxed` is for the ones that sit INSIDE a field grid next to real inputs
 * (Date of Intake, verified Primary Insurance). The bare label-over-text form
 * is shorter than an input and has no border, so it broke the row: one cell
 * floating at a different height and weight than its neighbours. Boxed matches
 * the input's metrics exactly — same padding, radius and height — while a
 * dashed border and muted fill say "you can't type here", so the grid reads as
 * one thing without pretending the value is editable.
 *
 * Unboxed stays the default: in the rail-card `.kv` lists there are no inputs
 * to line up with, and a box there would be noise.
 */
function Field(
  { label, value, full, boxed }:
  { label: string; value?: string; full?: boolean; boxed?: boolean },
) {
  if (boxed) {
    return (
      <div className={full ? "fld full" : "fld"}>
        <div className="flabel">{label}</div>
        <div className="ro">{value?.trim() || "—"}</div>
      </div>
    );
  }
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

/**
 * Address, with Google Places completion — the same widget Welcome Call and the
 * Doctor card use, not a second implementation of it.
 *
 * Worth the wiring here more than anywhere else on the page: the intake form
 * never asks for an address, so this one is ALWAYS typed on the call, from
 * someone reading it aloud — and it's the field a shipment bounces on. Places
 * also returns lat/lng, which is what makes the column a real Monday location
 * pin rather than a string; hand-typed, it was always 0,0.
 */
function EditAddress({
  label, value, placeholder, onChange,
}: {
  label: string; value: string; placeholder?: string;
  onChange: (r: { address: string; lat: number; lng: number }) => void;
}) {
  return (
    <label className="fld full">
      <div className="flabel">{label}</div>
      {/* .pf-input, not the bare `input[type=text]` rule: the widget renders an
          UNTYPED <input>, which that attribute selector doesn't match, so
          without this the field loses its border and padding entirely.
          redesign.css keeps .pf-input in step with it for exactly this. */}
      <AddressAutocomplete
        value={value}
        placeholder={placeholder}
        className={value.trim() ? "pf-input filled" : "pf-input"}
        onChange={onChange}
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
  label, filename, assetIds, assets, onRemove,
}: {
  label: string; filename?: string; assetIds?: string; assets: MondayAsset[] | null;
  /** Clears the WHOLE column (see `remove`). Omit to render without a ✕. */
  onRemove?: () => void | Promise<void>;
}) {
  const raw = (filename ?? "").trim();
  if (!raw) return null;

  /**
   * ⚠️ Monday has no per-ASSET delete for file columns. `add_file_to_column`
   * appends and `update_assets_on_item` takes fresh uploads, not existing
   * asset ids — the only removal the API offers is `{"clearAll": true}`, which
   * empties the column. So the ✕ is honest about its blast radius: on a
   * single-file column it reads "remove this file" because that IS the whole
   * column, and on a multi-file one it says how many it will take with it.
   * Confirmed either way — these are a patient's documents.
   */
  const remove = (count: number) => {
    const msg = count > 1
      ? `Remove all ${count} files from ${label}?\n\nMonday can only clear this column as a whole — there's no way to delete just one file.`
      : `Remove this file from ${label}?`;
    if (!window.confirm(msg)) return;
    void onRemove?.();
  };

  /** Label + the column-level ✕. Deliberately ONE button beside the label
   *  rather than one per row: a per-row ✕ on a two-file column would offer two
   *  controls that both do the same thing (clear both). */
  const head = (count: number) => (
    <div className="flabel" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span>{label}</span>
      {onRemove && (
        <button
          type="button"
          className="frm"
          title={count > 1 ? `Clear all ${count} files on this column` : "Remove this file"}
          aria-label={count > 1 ? `Remove all ${count} files from ${label}` : `Remove file from ${label}`}
          onClick={() => remove(count)}
        >
          ✕ {count > 1 ? `Remove all ${count}` : "Remove"}
        </button>
      )}
    </div>
  );

  // PREFERRED path: join on the column's asset IDs. Exact, and it yields the
  // asset's SIGNED public_url — the column's own protected_static link needs a
  // Monday session, which is why clicking it can never work on its own.
  const ids = (assetIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length && assets) {
    const matched = ids
      .map((id) => assets.find((a) => String(a.id) === id))
      .filter((a): a is MondayAsset => !!a);
    if (matched.length) {
      return (
        <div style={{ marginBottom: 16 }}>
          {head(matched.length)}
          {matched.map((a) => (
            <div
              key={a.id}
              className="file-row"
              title="Click to preview"
              onClick={() => openFileViewer({ url: a.public_url || a.url, name: a.name })}
            >
              <span className="fname">{a.name}</span>
              <span className="fmeta">{a.name.includes(".") ? a.name.split(".").pop() : ""}</span>
            </div>
          ))}
        </div>
      );
    }
  }

  // ⚠️ A Monday FILE column's `text` is a URL, not a filename —
  // "https://…/protected_static/…/card.jpg". Matching that against asset
  // NAMES never hit, so every row rendered the full URL and "no preview".
  // Take the last path segment as the name, and keep the URL as a fallback
  // target for the viewer when the asset list hasn't resolved.
  const entries = raw
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => {
      const isUrl = /^https?:\/\//i.test(v);
      let name = v;
      if (isUrl) {
        try {
          name = decodeURIComponent(new URL(v).pathname.split("/").filter(Boolean).pop() ?? v);
        } catch {
          name = v.split("/").pop() ?? v;
        }
      }
      return { name, url: isUrl ? v : null };
    });

  return (
    <div style={{ marginBottom: 16 }}>
      {head(entries.length)}
      {entries.map((e, i) => {
        // Prefer the asset: its public_url is signed, where the column's raw
        // URL is a protected_static path that can 403 on its own.
        const asset = assets?.find((a) => a.name === e.name) ?? null;
        const url = asset ? (asset.public_url || asset.url) : e.url;
        const ext = e.name.includes(".") ? e.name.split(".").pop() : "";
        return url ? (
          <div
            key={`${e.name}-${i}`}
            className="file-row"
            title="Click to preview"
            onClick={() => openFileViewer({ url, name: e.name })}
          >
            <span className="fname">{e.name}</span>
            <span className="fmeta">{ext}</span>
          </div>
        ) : (
          <div key={`${e.name}-${i}`} className="file-row" style={{ opacity: 0.6, cursor: "default" }}>
            <span className="fname">{e.name}</span>
            <span className="fmeta">{assets === null ? "loading" : ext}</span>
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
    // requestType is NOT sent, for the same reason clinicAddress and Call Slot
    // aren't: nothing on this page edits it any more (it's display-only now),
    // so passing the hydrated value back would let a Save overwrite whatever
    // the board holds with whatever this tab loaded. That matters more here
    // than elsewhere — Request Type is the CONDITION on four board automations
    // and gets copied forward to Medical Evaluation, so a stale re-write
    // re-drives them. The referral owns this column.
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
    // clinicAddress is NOT sent. Its control is commented out, and writeLocation
    // with a blank address CLEARS the column — so a Save would wipe whatever
    // the step-3 provider put there. buildDoctorTasks still writes it from the
    // picked provider on advance, which is the only thing that should.
    formProceedPreference: p.formProceedPreference,
    // Call Slot and Booking Status are NOT sent, for the same reason
    // clinicAddress isn't: nothing on this page edits them any more. They are
    // owned by the dtc-mm-form Calendly webhook now, and this passed the
    // HYDRATED value straight back — so a rep who loaded the page, watched the
    // patient book, and then hit Save would overwrite "Scheduled" with the
    // "Unscheduled" their tab was still holding. A booking erased by an
    // unrelated Save, with nothing shown. Read-only here; the webhook writes.
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
    patients, loading, initialLoading, error, refetch, updateLocal, hasOverlay, getReceived,
    saveOverlay, clearOverlay,
  } = useMondayPatients(searchParams.get("patientId"), SOURCE_GROUP[source]);

  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("patientId"));
  const [saving, setSaving] = useState(false);
  // Outcomes are TOASTS, like every other role. There used to be a `saveNote`
  // string rendered as grey text at the bottom of the left pane — which on a
  // full patient sits below the fold, so "Advanced to Medical Necessity." was
  // invisible at the one moment the rep needed it. Half the call sites already
  // fired a toast AND set the note, so the same outcome appeared twice for some
  // actions and nowhere visible for others. Don't reintroduce an inline status
  // line: if an outcome is worth saying, it goes to the toaster.

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

  // An address that's on file but won't ship — a missing state code, no comma
  // before the city, a bare zip. Surfaced beside the input AND at the send-off
  // block; unlike the profile role this page only warns, since its exits stay
  // open by design.
  const addressIssue = (selected?.patientAddress ?? "").trim()
    ? addressWarning(selected!.patientAddress)
    : undefined;

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
    try {
      // Serving rides along from the patient, not from `verified` — same value
      // the left pane and the Serving & Coverage card both edit.
      const res = await writeVerifiedInsurance(selected.id, {
        ...verified,
        serving: selected.serving,
      });
      if (res.ok) toast.success("Verified insurance saved");
      else {
        toast.error("Couldn't save verified insurance", {
          description: res.errors.map((e) => `${e.label}: ${e.error}`).join(" · "),
        });
      }
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
  }, [searchParams, setSearchParams]);

  const edit = useCallback((patch: Partial<Patient>) => {
    if (!selected) return;
    updateLocal(selected.id, patch);
  }, [selected, updateLocal]);

  /**
   * §5.2 — the four product dropdowns read their options from the BOARD, so a
   * status added or renamed on Monday appears without a code edit. The
   * hardcoded maps stay as the fallback: a failed fetch must degrade to
   * today's behaviour, never to an empty select.
   *
   * Everything from here to logChangedFacts is declared ABOVE save() and the
   * action handler on purpose: both name these in a dependency array, which is
   * evaluated during render, so a later `const` would throw on first render.
   */
  const [liveLabels, setLiveLabels] = useState<Record<string, LiveLabels>>({});
  useEffect(() => {
    let alive = true;
    fetchBoardLabels([COL.cgmType, COL.pumpType, COL.cgmCoveragePath, COL.insulinPumpCoveragePath])
      .then((l) => { if (alive) setLiveLabels(l); })
      .catch(() => { /* hardcoded fallback already in place */ });
    return () => { alive = false; };
  }, []);
  /** Options for one product dropdown: live if we have them, hardcoded if not.
   *  Hidden labels are filtered for DISPLAY only. */
  const productOptions = useCallback(
    (columnId: string, fallback: string[]) =>
      liveLabels[columnId]?.options ?? fallback.filter((l) => !HIDDEN_LABELS.includes(l)),
    [liveLabels],
  );
  /**
   * The WRITE half of the same fetch, and deliberately a different shape from
   * `productOptions`: the full label→index map per column, hidden labels
   * included. A label the picker hides ("Not Serving") is still written by the
   * cross-sell derivation, so filtering here would silently drop that write
   * (§5.2). Empty until the fetch lands — buildIntakeTasks falls back to the
   * hardcoded maps for any column it doesn't find.
   */
  const liveIndex = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const [id, l] of Object.entries(liveLabels)) out[id] = l.index;
    return out;
  }, [liveLabels]);

  /**
   * The call slot the PATIENT picked on the form.
   *
   * Call Booking is one Monday column (`text_mm5za6zx`) doing two jobs — the
   * form's answer and the rep's override — so confirming a different opening
   * overwrites the patient's pick with no record that they ever asked for
   * something else. Rather than add a second column, the as-received snapshot
   * keeps the original on SCREEN and the Call Log keeps it on the BOARD (see
   * logChangedFacts), which is where §9 says free text belongs anyway.
   */
  const currentPatientId = selected?.id;
  const formSlotAsReceived = useMemo(
    // getReceived is a stable ref reader; the snapshot only changes with the patient.
    () => (currentPatientId ? (getReceived(currentPatientId)?.formCallSlot ?? "").trim() : ""),
    [currentPatientId, getReceived],
  );

  /**
   * The one fact that decides whether a booking exists.
   *
   * Derived from the Calendly mirror, never from Booking Status: the form sets
   * that column to "Scheduled" as soon as the patient picks a time STRING, and
   * a genuine booking sets the same label later, so it cannot tell the two
   * apart. Blank here means no Calendly event — nothing to reschedule, and
   * nothing the Scheduled Calls day grid will ever show.
   */
  const bookedCall = useMemo(
    () => formatBookedCall(selected?.scheduledCallTime),
    [selected?.scheduledCallTime],
  );

  /**
   * Rep-entered facts that also belong in the Call Log: Current Out-of-Pocket
   * Cost, Self Advocacy (Josh, 2026-08-10) and the call slot. They keep their
   * own columns — this mirrors them into the log, so a manager reading it sees
   * what was learned on the call without cross-referencing three columns.
   *
   * Snapshotted per patient so a line is appended only when the value CHANGED.
   * Appending on every save would restamp the same fact each time the rep
   * pressed Save and bury the actual call notes.
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
    // Call-slot logging lived here because the old free-text override
    // overwrote the patient's own answer, so the log was the only surviving
    // copy. Rescheduling now happens in Calendly, which keeps its own history
    // and re-mirrors the result — nothing on this page can change the slot, so
    // the branch could never fire.
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

  /**
   * The HEADER Save — local only, matching every other role (ProfilePage's
   * `handleSave` is the same two lines).
   *
   * Edits already live in the in-memory overlay via `edit()`; this persists
   * that overlay so the rep can leave the page, or reload, and come back to
   * their work. It writes NOTHING to Monday.
   *
   * The header and the left pane both called the Monday save before this, so
   * the same button meant "push to Monday" in one place and — by every other
   * role's convention — "keep my progress" in the other. A rep who pressed the
   * familiar one mid-call was writing a half-filled record to the board.
   *
   * Monday writes live where the work ends: the left pane's Save, Advance to
   * Medical Necessity, Save verified insurance, and the Call Log.
   */
  const saveLocal = useCallback(() => {
    if (!selected) return;
    saveOverlay(selected.id);
    toast.success("Progress saved — you can leave and come back");
  }, [selected, saveOverlay]);

  const save = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    const edits: IntakeEdits = intakeEditsFor(selected);
    try {
      const res = await writeIntakeEdits(selected.id, edits, liveIndex);
      // Partial success is reported, not swallowed — the rep needs to know
      // exactly which field didn't make it rather than a blanket "saved".
      // Toasted as well as inlined: the inline note sits at the bottom of a
      // long pane, so a rep who scrolled away would otherwise miss it.
      if (res.ok) {
        // Cost + Self Advocacy also go into the Call Log, once, on change.
        await logChangedFacts(selected);
        // These edits ARE Monday's now, so drop the local copy — including any
        // the header's Save persisted. Left in place it would keep masking the
        // board's own values on every reload, and the rep would be looking at
        // a snapshot of their own typing rather than at the record.
        // Only on a CLEAN save: a partial failure leaves the overlay alone so
        // the columns that didn't land are still there to retry.
        clearOverlay(selected.id);
        toast.success("Saved to Monday");
      } else {
        const failed = res.errors.map((e) => e.label).join(", ");
        toast.error("Saved, except some columns", { description: failed });
      }
      await refetch(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Save failed", { description: msg });
    } finally {
      setSaving(false);
    }
  }, [selected, refetch, logChangedFacts, liveIndex, clearOverlay]);

  const [escalateReason, setEscalateReason] = useState("");
  const { goBack } = useBackNavigation();

  /* The two exits that need detail before they can run open a popup (Katie,
     2026-08-13); Advance takes no input, so it has none. Both are reset on a
     patient change — a reason typed for one patient must never be sitting in
     the box armed against the next one. */
  const [attemptOpen, setAttemptOpen] = useState(false);
  const [attemptNote, setAttemptNote] = useState("");
  const [stuckOpen, setStuckOpen] = useState(false);
  useEffect(() => {
    setAttemptOpen(false);
    setAttemptNote("");
    setStuckOpen(false);
    setEscalateReason("");
  }, [selected?.id]);

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

  /**
   * What the LEFT pane is responsible for: the unlock conditions, and nothing
   * else.
   *
   * ⚠️ Serving, Member IDs, coverage paths and the doctor are the RIGHT pane's
   * checklist ("Ready for send off") and are deliberately NOT repeated here
   * (Josh, 2026-08-13). This card asks "is the patient info done" — the profile
   * being built is a different question, asked next to the fields that answer
   * it. Listing them in both places had the left pane demanding a confirmed
   * doctor before the rep had reached the pane that picks one.
   */
  const intakeBlockers = unlock.conditions
    .filter((c) => !c.passed)
    .map((c) => ({ label: c.label, hint: c.hint }));

  /**
   * The advance itself still needs BOTH halves — it is the exit from the whole
   * stage. It fires from the right pane's button, which sits beside the
   * readiness list, so the half a rep can't see from there is the half this
   * gate already showed them on the way in.
   */
  const canAdvance = unlock.unlocked && readyMissing === 0;

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
    // Returns whether the action actually landed, so the popups that trigger
    // these can close on success and STAY OPEN on failure with the rep's typed
    // reason still in the box — closing regardless would throw away the text
    // they'd have to retype.
    async (kind: "advance" | "escalate" | "proposeStuck" | "return"): Promise<boolean> => {
      if (!selected) return false;
      if (kind !== "advance" && !escalateReason.trim()) {
        toast.error("Add a reason first", {
          description: "A manager can't action a blank escalation.",
        });
        return false;
      }
      setSaving(true);
        try {
        // BEFORE the transaction, not after: the advancer triggers the Move to
        // Onboarding automation, which copies columns to a fresh Masheke item.
        // A note appended afterwards lands on an item nobody works again.
        // logChangedFacts reports nothing on failure by design — a note that
        // didn't land must not stop a patient advancing.
        if (kind === "advance") await logChangedFacts(selected);
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
            liveIndex,
          })
          : kind === "escalate" ? await escalateIntake(selected.id, escalateReason)
          : kind === "proposeStuck"
            ? await proposeIntakeStuck(
                selected.id, escalateReason, stuckLevel,
                managerOrigin === "manager-intervention" ? "manager-intervention"
                : managerOrigin === "final-decisions" ? "final-decisions"
                : "processor",
              )
          : await returnIntakeToPipeline(selected.id, escalateReason);
        if (res.ok) {
          // Where the patient WENT, not "done" — each of these removes them
          // from this queue, and the rep's next question is always which
          // column they'll find them in.
          toast.success(
            kind === "advance" ? "Advanced to Medical Necessity"
              : kind === "escalate" ? "Escalated to Manager Intervention"
              : kind === "proposeStuck"
                ? stuckLevel === "final"
                  ? "Proposed stuck — sent to Final Decisions"
                  : "Proposed stuck — sent to Manager Intervention"
              : "Sent back to the pipeline",
          );
        } else {
          toast.error(
            kind === "advance" ? "Not advanced" : "That didn't go through",
            { description: res.errors.map((e) => `${e.label}: ${e.error}`).join(" · ") },
          );
        }
        if (res.ok) {
          setEscalateReason("");
          // Advance is the other path that writes the left pane, so it owns the
          // same overlay clear the plain Save does — otherwise the local copy
          // outlives the patient's departure from this stage. The escalation
          // exits don't touch those columns, so their edits stay pending.
          if (kind === "advance") clearOverlay(selected.id);
          await refetch(true);
        }
        return res.ok;
      } finally {
        setSaving(false);
      }
    },
    [selected, escalateReason, refetch, verified, clinicLabelId, stuckLevel, liveIndex,
      logChangedFacts, clearOverlay],
  );

  // Declared after save() deliberately: naming it in the dependency array
  // before the const initialises would throw on first render.
  const runBenefitsCheck = useCallback(async () => {
    if (!selected) return;
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
  /** Shared by every button that opens the composer with something in it —
   *  Start Insurance Follow-Up and Generate CGM data link (§8.3). Named for
   *  what it is rather than for the first feature that used it, so the next one
   *  doesn't add a third parallel pair of flags. */
  const [textComposerOpen, setTextComposerOpen] = useState(false);
  /** Only set when a BUTTON opens the composer. The plain Text button beside
   *  the patient's name must open an empty box — a rep texting about something
   *  else shouldn't have to clear a template first. */
  const [textPrefill, setTextPrefill] = useState<string | undefined>();
  useEffect(() => {
    setTextComposerOpen(false);
    setTextPrefill(undefined);
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

  /**
   * Care Coordinator — §9's "who owns this patient", assigned by the rep and
   * stamped into the Call Log instead of a new column (see careCoordinator.ts
   * for why notes and not updates).
   *
   * The roster is everyone with Command Center access: managers plus
   * processors, de-duplicated by email because a dual person appears in both
   * lists. Names come from access.json, so the picker follows the team without
   * a second list to maintain.
   */
  const { config: accessConfig } = useAccessContext();
  const coordinatorRoster = useMemo(() => {
    const byEmail = new Map<string, string>();
    for (const p of [...managerPeople(accessConfig), ...processorPeople(accessConfig)]) {
      if (!byEmail.has(p.email)) byEmail.set(p.email, p.name);
    }
    return [...byEmail.values()].sort((a, b) => a.localeCompare(b));
  }, [accessConfig]);
  /** Currently assigned, read back out of the log — there is no column. */
  const coordinator = useMemo(
    () => extractCoordinator(selected?.notes),
    [selected?.notes],
  );
  const assignCoordinator = useCallback(async (name: string) => {
    if (!selected || !name.trim() || name === coordinator) return;
    setSaving(true);
    try {
      const res = await appendIntakeNote(selected.id, coordinatorNoteLine(name), selected.notes);
      if (res.ok) {
        toast.success(`Care Coordinator set to ${name}`);
        await refetch(true);
      } else {
        toast.error("Couldn't assign the coordinator", {
          description: res.errors.map((e) => e.error).join(" · "),
        });
      }
    } finally {
      setSaving(false);
    }
  }, [selected, coordinator, refetch]);

  const startInsuranceFollowUp = useCallback(() => {
    setTextPrefill(followUpTemplate());
    setTextComposerOpen(true);
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
   * Attach a file to one of the item's file columns, as the rep.
   *
   * The patient-side half — they upload from their phone via a texted link —
   * is `generateCgmLink` below (§8.3). This stays as the manual fallback for
   * when the patient can't use the link, which §8.3 asks for explicitly.
   *
   * ⚠️ What makes a patient's upload APPEAR without a refresh (a §8.3
   * requirement — the rep is still on the call) is the 15s `useMondayPatients`
   * poll: it rebuilds `selected`, and the assets effect above keys on it. If
   * that effect is ever memoised on `selected.id` instead, this stops working
   * and nothing errors — the file just never shows up until the rep clicks away
   * and back.
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

  /**
   * "Generate CGM data link" — §8.3, the patient-side half.
   *
   * Mint a one-off link on the dtc-mm-form service, then open the ordinary text
   * composer with it. Deliberately TWO steps rather than one auto-send: the
   * composer is where the opt-out guard lives and where the rep can see the
   * thread, and a button that fired a text on its own would bypass both.
   *
   * The mint is not written to Monday. A link the rep never sent is not a fact
   * about the patient, and stamping one would leave the Call Log claiming an
   * outreach that didn't happen — so the note is written by the SEND path
   * (`PatientContact`'s composer), not here.
   */
  /**
   * Stamp the Call Log whenever a text goes out from this page (Josh,
   * 2026-08-11 — §8.3's "log link sent").
   *
   * The RingCentral thread already holds the message, but the Call Log is what
   * a rep reads on THIS screen and what carries to Medical Necessity, so an
   * outreach that only exists in RingCentral is invisible where it matters.
   *
   * The FILE coming back deliberately gets no line of its own: it lands in the
   * CGM Data File column, shows in the Files card labelled "from patient", and
   * carries Monday's own timestamp — receipt is evidenced by the file itself
   * rather than by a note claiming it.
   *
   * Best-effort: the text is already sent, so a failed note must never read as
   * a failed send. It is logged and swallowed.
   */
  const logTextSent = useCallback((body: string) => {
    if (!selected) return;
    const line = body.includes("/u/")
      ? `Texted CGM data upload link to the patient — ${body}`
      : `Text to patient: ${body}`;
    void appendIntakeNote(selected.id, line, selected.notes)
      .then((res) => { if (res.ok) void refetch(true); })
      .catch((e) => console.error("[intake] couldn't log sent text", e));
  }, [selected, refetch]);

  /** "Booking link" in the header — for a patient with no appointment yet. */
  const [bookingLinkOpen, setBookingLinkOpen] = useState(false);
  useEffect(() => { setBookingLinkOpen(false); }, [selected?.id]);

  /**
   * "Reschedule appointment" — open Calendly's own page for this booking.
   *
   * ⚠️ The link is fetched BEFORE any tab is opened. The first cut opened a
   * blank tab synchronously and set its location afterwards, to dodge popup
   * blocking — so every failure showed the rep a blank page instead of the
   * reason, and the commonest failure is "this patient never actually booked".
   * A blank tab reads as a broken feature; a toast reads as an answer.
   *
   * Popup blocking is handled where it happens instead: if `window.open`
   * returns null, the toast carries the link, and the rep's click on THAT is a
   * fresh user gesture no browser blocks.
   */
  const [rescheduling, setRescheduling] = useState(false);
  const openReschedule = useCallback(async () => {
    if (!selected || rescheduling) return;
    setRescheduling(true);
    try {
      const r = await getRescheduleLink(selected.id);
      if ("noBooking" in r) {
        toast.info("No appointment is booked yet", {
          description: "Send them a booking link and they'll pick a time.",
          action: { label: "Send link", onClick: () => setBookingLinkOpen(true) },
        });
        return;
      }
      if (!window.open(r.url, "_blank", "noopener")) {
        toast.warning("Your browser blocked the pop-up", {
          description: "Open Calendly to move this appointment.",
          action: { label: "Open Calendly", onClick: () => { window.open(r.url, "_blank", "noopener"); } },
        });
      }
    } catch (e) {
      toast.error("Couldn't open the reschedule page", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRescheduling(false);
    }
  }, [selected, rescheduling]);

  const [linkGenerating, setLinkGenerating] = useState(false);
  const generateCgmLink = useCallback(async () => {
    if (!selected || linkGenerating) return;
    setLinkGenerating(true);
    try {
      const { url } = await generateUploadLink(selected.id);
      setTextPrefill(uploadLinkMessage(selected.name, url));
      setTextComposerOpen(true);
    } catch (e) {
      // Every failure here is actionable by the rep (wrong stage, service
      // unreachable, unconfigured build), so the reason is the message.
      toast.error("Couldn't generate an upload link", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLinkGenerating(false);
    }
  }, [selected, linkGenerating]);

  /** Backs the ✕ on a file row. Clears the whole column — see FileColumnRow
   *  for why per-file removal isn't on offer. Stamped into the Call Log,
   *  because deleting a patient's document should leave a trace: the file is
   *  gone from Monday and nothing else would say who took it or when. */
  const clearFiles = useCallback(async (columnId: string, label: string) => {
    if (!selected) return;
    try {
      await clearFileColumn(selected.id, columnId);
      await appendIntakeNote(selected.id, `Removed file(s) from ${label}`, selected.notes);
      setAssets(null);
      await refetch(true);
      toast.success(`${label} cleared`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Couldn't clear ${label}`, { description: msg });
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
    try {
      await createUpdate(selected.id, refDraft.trim());
      setRefDraft("");
      setAddRefOpen(false);
      setUpdates(null); // force the list to re-fetch so the new one shows
      toast.success("Referral email posted as a Monday update");
    } catch (e) {
      toast.error("Couldn't post the referral email", {
        description: e instanceof Error ? e.message : String(e),
      });
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
  const logAttempt = useCallback(async (note: string): Promise<boolean> => {
    if (!selected) return false;
    const body = note.trim();
    // A note is REQUIRED on every attempt (Katie, 2026-08-13) — the same rule
    // Doctor Appointments enforces in `canLogAttempt`. The counter alone
    // records THAT someone called, never what was said, so a note-less attempt
    // is indistinguishable from no attempt to whoever picks the patient up
    // next. The dialog disables its own button; this is the backstop.
    if (!body) {
      toast.error("Add a note first", {
        description: "Every call attempt has to say what happened.",
      });
      return false;
    }
    setSaving(true);
    try {
      const next = await logContactAttempt(selected.id, selected.attemptCounter);
      // Stamped into the Call Log — the one free-text field that carries to
      // Medical Necessity. Written BEFORE the snooze: if the snooze fails the
      // rep still has a record of the call, whereas a note skipped behind a
      // failed snooze is gone for good.
      const noted = await appendIntakeNote(
        selected.id, `Call attempt ${next} — ${body}`, selected.notes,
      );
      const due = addBusinessDaysIso(etToday(), 1);
      const res = await writeIntakeEdits(selected.id, {
        followUp: "Follow Up",
        followUpDate: due,
      });
      edit({ attemptCounter: String(next), followUp: "Follow Up", followUpDate: due });
      // Name whichever half fell over rather than implying the patient has left
      // today's queue when they haven't — or that the note landed when it didn't.
      const problems = [
        ...(noted.ok ? [] : ["note not saved"]),
        ...(res.ok ? [] : res.errors.map((e) => e.label)),
      ];
      if (problems.length === 0) {
        toast.success(`Attempt ${next} logged`, { description: `Back in the queue ${due}.` });
      } else {
        toast.error(`Attempt ${next} logged, with problems`, {
          description: problems.join(", "),
        });
      }
      await refetch(true);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not log attempt", { description: msg });
      return false;
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
                  {/* No patient name here — the Evaluate-style block directly
                      below carries it at full size. Printing it in both is
                      what made this page look off the first time. */}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* LOCAL save, like every other role's header. Disabled with
                    nothing pending, so it reads as "you have unsaved work"
                    rather than a button that always looks available. */}
                <Button
                  onClick={saveLocal}
                  disabled={!selected || !hasOverlay(selected.id)}
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-elevate"
                  title="Keeps your edits on this device — the left pane's Save writes them to Monday"
                >
                  <Save className="h-4 w-4" /> Save
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
          {/* Eyebrow + name + DOB · gender · contact — ported from Evaluate's
              PatientProfileCard so the two stages read identically. Outside
              `.pf-root`, so PatientContact keeps its own styling. */}
          {selected && (
            <div className="border-b bg-card px-6 py-4 flex-none">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Patient
                  </p>
                  <h1
                    className="text-3xl font-black tracking-tight mt-0.5 truncate"
                    title={selected.name}
                  >
                    {selected.name}
                  </h1>
                  <div className="mt-1 flex items-center gap-3 flex-wrap">
                    <span className="text-lg text-muted-foreground">
                      DOB {selected.dob || "—"}{selected.gender ? ` · ${selected.gender}` : ""}
                    </span>
                    <PatientContact
                      phone={selected.ptPhone}
                      textPrefill={textPrefill}
                      textOpen={textComposerOpen}
                      onTextSent={logTextSent}
                      onTextOpenChange={(o) => {
                        setTextComposerOpen(o);
                        // Drop the template once the dialog closes, so the next
                        // plain "Text" click opens an empty composer.
                        if (!o) setTextPrefill(undefined);
                      }}
                    />
                    {/* Up here with Call and Text rather than in the booking
                        block below, because that block only renders for "Wants
                        a call first" — and the patients most worth sending a
                        booking link to are the ones who never answered that
                        question. This is a per-patient action like the other
                        two, so it belongs beside them.

                        A patient who already has a call gets a STATUS in the
                        same slot instead of the action. The button offered the
                        one thing that shouldn't happen to them — a second
                        booking link, which Calendly answers with a second
                        event, and now the rep has two appointments and no way
                        to tell which one the patient will show up to. It is
                        deliberately not a disabled button: a greyed-out
                        "Booking link" reads as "this is broken" rather than
                        "this is done", and the rep goes hunting for why. */}
                    {/* The booked time is ON the chip, not in a tooltip.
                        "Booked" alone answers the wrong question — the rep
                        already knows they're calling about a booking; what
                        they need off this row is WHEN, and a hover doesn't
                        survive reading it aloud to the patient. */}
                    {bookedCall ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        Booked
                        <span className="font-bold">{bookedCall}</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold hover:bg-accent"
                        onClick={() => setBookingLinkOpen(true)}
                        title="Text or email this patient a link to book a call"
                      >
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" /> Booking link
                      </button>
                    )}
                  </div>
                  {selected.email?.trim() && (
                    <p className="mt-1 text-sm text-muted-foreground truncate">{selected.email}</p>
                  )}
                </div>
                <span className="text-xs font-semibold text-muted-foreground shrink-0">
                  {attempts === 0 ? "No contact attempts yet" : `Attempt ${attempts}`}
                </span>
              </div>
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
                    assets.map((a) => {
                      /* Say WHERE each file came from, not just its extension.
                         An item carries referral-email attachments, the card
                         photo and the patient's CGM upload side by side, and
                         "png" tells the rep nothing about which is which — the
                         one they're waiting on mid-call is the CGM one. Matched
                         on the file column's own asset ids (`fileAssetIds`), so
                         a rename can't break it. */
                      const inCol = (ids: string | undefined) =>
                        (ids ?? "").split(",").filter(Boolean).includes(String(a.id));
                      const source = inCol(selected.cgmDataFileIds)
                        ? "CGM data — from patient"
                        : inCol(selected.formCardPhotoIds)
                          ? "Insurance card"
                          : (a.name.split(".").pop() ?? "");
                      return (
                        <div
                          key={a.id}
                          className="file-row"
                          onClick={() => openFileViewer({ url: a.public_url || a.url, name: a.name })}
                        >
                          <span className="fname">{a.name}</span>
                          <span className="fmeta">{source}</span>
                        </div>
                      );
                    })
                  )}
                </div>
                {/* Two affordances, and they are NOT symmetrical:
                      Insurance Card Photo — the patient can attach this on the
                        intake FORM, so it often arrives on its own; the rep
                        uploads it here when it didn't.
                      CGM Data File — never from the form (§8.2 keeps it
                        phone-call only), so the rep sends the patient a link
                        mid-call and they upload from their phone (§8.3). The
                        manual fallback for this column is the drop zone in What
                        They Need — deliberately not a second button here, which
                        is what this slot used to hold.
                    ⚠️ <label>, not <button>, for the UPLOAD one: `.pf-root
                    button` strips background/border off bare buttons, so the
                    link button below carries `btn secondary sm` explicitly. And
                    do NOT reach for `.upzone` here — it is display:none until
                    something adds `.show`, which is why the first cut of this
                    was invisible. */}
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
                  {/* Hidden rather than disabled when the build has no service
                      URL: a permanently dead button invites a support ticket,
                      and the drop zone below still covers the column. */}
                  {uploadLinksConfigured() && (
                    <button
                      type="button"
                      className="btn secondary sm"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                      onClick={() => void generateCgmLink()}
                      disabled={linkGenerating || !(selected.ptPhone ?? "").trim()}
                      title={
                        (selected.ptPhone ?? "").trim()
                          ? "Create a one-off upload link and open the text composer with it"
                          : "No phone number on file to text"
                      }
                    >
                      {linkGenerating && (
                        <span
                          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                          aria-hidden
                        />
                      )}
                      {linkGenerating ? "Generating…" : "Generate CGM data link"}
                    </button>
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
                  <EditAddress
                    label="Address"
                    placeholder="122 Elderberry Ln, Central Square, NY 13036"
                    value={selected.patientAddress ?? ""}
                    onChange={({ address, lat, lng }) =>
                      // Coordinates travel with the address or not at all. The
                      // column is a Monday LOCATION (writeLocation), so a
                      // hand-edited line keeping the old pin would put the map
                      // on the previous address — worse than an unpinned one.
                      edit({
                        patientAddress: address,
                        patientAddressLat: lat || null,
                        patientAddressLng: lng || null,
                      })
                    }
                  />
                  <EditText label="State" value={selected.formState ?? ""} onChange={(v) => edit({ formState: v })} />
                  <Field boxed label="Date of Intake" value={selected.dateOfIntake} />
                </div>
                {!(selected.patientAddress ?? "").trim() ? (
                  <p className="mt-2 text-[11px] text-amber-700">
                    No address on file. The form doesn’t collect one, and downstream stages need it to ship —
                    collect it on the call.
                  </p>
                ) : addressIssue ? (
                  <p className="mt-2 text-[11px] text-amber-700">{addressIssue}</p>
                ) : null}
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
                    {/* QUALIFIER FIRST, then the device (Katie, 2026-08-13).
                        The coverage path is what the patient is eligible for and
                        it gates everything under it, so asking "which sensor"
                        before "do they even qualify" is backwards on a live
                        call. The pump column leads with Pump Need for the same
                        reason, which keeps the two `.devcol` columns paired
                        row-for-row: qualifier / device / preference / extra. */}
                    <EditSelect
                      label="CGM Coverage Path"
                      value={selected.cgmCoveragePath ?? ""}
                      onChange={(v) => edit({ cgmCoveragePath: v })}
                      options={productOptions(COL.cgmCoveragePath, CGM_PATH_OPTS)}
                    />
                    <EditSelect
                      label="CGM Type"
                      value={selected.cgmType ?? ""}
                      onChange={(v) => edit({ cgmType: v })}
                      options={productOptions(COL.cgmType, CGM_TYPE_OPTS)}
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
                    {/* Pump Need leads the column (Katie, 2026-08-13): "new pump
                        vs supplies only" decides what the rest of these fields
                        even mean — it is the input to Request Type and forces
                        `Supplies Only` on the coverage path below. */}
                    <EditSelect
                      label="Pump Need"
                      value={selected.formPumpNeed ?? ""}
                      onChange={(v) => edit({ formPumpNeed: v })}
                      options={["Need a new pump", "Only need supplies"]}
                    />
                    <EditSelect
                      label="Pump Type"
                      value={selected.pumpType ?? ""}
                      onChange={(v) => edit({ pumpType: v })}
                      options={productOptions(COL.pumpType, PUMP_TYPE_OPTS)}
                    />
                    <EditSelect
                      label="Pump Preference"
                      value={selected.formPumpPreference ?? ""}
                      onChange={(v) => edit({ formPumpPreference: v })}
                      options={["Tandem t:slim X2", "Tandem Mobi", "Beta Bionics iLet", "Not sure"]}
                    />

                    <EditSelect
                      label="Insulin Pump Coverage Path"
                      value={selected.insulinPumpCoveragePath ?? ""}
                      onChange={(v) => edit({ insulinPumpCoveragePath: v })}
                      options={productOptions(COL.insulinPumpCoveragePath, IP_PATH_OPTS)}
                    />
                  </div>
                </div>

                {/* CGM data collection — full width, below the aligned rows,
                    and only while the CGM category is on (as the mockup gates
                    it). Both halves of §8.3 now exist: the patient uploads from
                    a texted link (Generate CGM data link, in the Files card),
                    and this drop zone is the rep's manual fallback. */}
                {cgmOn && (
                  <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px dashed var(--border)" }}>
                    <FileColumnRow
                      label="CGM Data File"
                      filename={selected.cgmDataFile}
                      assetIds={selected.cgmDataFileIds}
                      assets={assets}
                      onRemove={() => clearFiles(COL.cgmDataFile, "CGM Data File")}
                    />
                    {/* Name the file AND the destination. "attach the file"
                        alone reads as the insurance card, which is a different
                        column with a different source. */}
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      This is the patient’s <strong>CGM data</strong> — a glucose report, hypo log or
                      screenshot. On a call, <strong>Generate CGM data link</strong> in the Files card
                      texts them a link they can upload from their phone; whatever they send lands
                      here. Use the box below to attach it yourself instead.
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
                        {cgmUploading ? "Uploading…" : "Drop CGM data here, or click to choose"}
                      </div>
                      <div className="sugg-note">
                        PDF, CSV, photo or an exported report → CGM Data File
                      </div>
                      <input
                        type="file"
                        multiple
                        accept=".jpg,.jpeg,.png,.heic,.pdf,.csv"
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

                {/* READ-ONLY, because Monday already owns this value (Katie,
                    2026-08-13 — "Request type is auto-populated").

                    It is NOT computed here and must not be: it arrives with the
                    referral. The intake form writes DTC Intake's `Request`
                    (`color_mky1a991`), and the board's "Move to Intake Board"
                    automation copies it into Request Type `color_mm1w1978` when
                    the Profile Send Off item is created — every item in the
                    intake group has it populated before a rep ever opens it.

                    ⚠️ It is also an automation INPUT, not just a field: FOUR
                    board automations read `color_mm1w1978` as their condition
                    (7917886676 pump/supplies, 7917886678 cgm-already-serving,
                    7917886811 + 7917886813 → Serving `color_mm1w1cm9`), and
                    7917676280 copies it forward to Medical Evaluation. A rep
                    overwriting it here silently re-drives all of that, which is
                    why this is display-only rather than an editable dropdown.
                    Corrections belong upstream on the referral. */}
                <div className="mt-4">
                  <Field
                    full
                    boxed
                    label="Request Type"
                    value={selected.requestType ?? ""}
                  />
                  <p className="sugg-note" style={{ marginTop: 6 }}>
                    Set from the referral before it reaches this queue — board
                    automations key off it, so it isn't editable here.
                  </p>
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
                  assetIds={selected.formCardPhotoIds}
                  assets={assets}
                  onRemove={() => clearFiles(COL.formCardPhoto, "Insurance Card Photo")}
                />
                {!(selected.formCardPhoto ?? "").trim()
                  && (selected.formInsuranceVia ?? "") === "Photo of card" && (
                  <p className="mb-3 text-[11px] text-amber-700">
                    Provided Via says “Photo of card” but no card is attached. If they texted or
                    emailed it, add it with <strong>Upload insurance card</strong> in the Files card
                    at the top.
                  </p>
                )}
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
                  {/* Primary Insurance — READ-ONLY here, and only when the
                      board actually has one. It's the VERIFIED payer, owned by
                      step 1 on the right; showing it blank would read as a
                      field the rep forgot to fill, and making it editable
                      would give one value two owners. */}
                  {(selected.primaryInsurance ?? "").trim() && (
                    <Field boxed label="Primary Insurance (verified)" value={selected.primaryInsurance} />
                  )}
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
                    this wrap raggedly. Ruled off and spaced away from the field
                    grid: they sat flush against the Secondary Member ID input,
                    which read as part of that field rather than actions on the
                    whole card. */}
                <div
                  className="flex flex-wrap items-center gap-3"
                  style={{ marginTop: 24, paddingTop: 18, borderTop: "1px dashed var(--border)" }}
                >
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

                {/* ── Benefits check output ──
                    FOUR fields, deliberately (Josh, 2026-08-13). The board
                    carries ~33 `stedi*` columns and every other one stays
                    hidden: HANDOFF §3 defers the full eligibility grid, cost
                    sharing and the OOP estimate pending Corey's plan-level
                    research, so this is an unhide of what's useful on a call,
                    not the redesign of this section.

                    Nothing was added to the read path — all four were already
                    in READ_COLUMN_IDS and on the Patient, just never rendered.

                    ⚠️ Yes/No comes from `inNetwork()` / `coverageActive()`, the
                    same predicates `evaluateUnlock` gates the advance on, so
                    this readout cannot disagree with the blocker list. */}
                {[
                  selected.stediInNetwork,
                  selected.stediEligibilityActive,
                  selected.stediPrimaryPayer,
                ].some((v) => (v ?? "").trim()) && (
                  <div className="fgrid" style={{ marginTop: 18 }}>
                    <Field
                      boxed
                      label="In Network"
                      value={stediYesNo(selected.stediInNetwork, inNetwork(selected))}
                    />
                    <Field
                      boxed
                      label="Active"
                      value={stediYesNo(selected.stediEligibilityActive, coverageActive(selected))}
                    />
                    <Field boxed full label="Primary Payor" value={selected.stediPrimaryPayer ?? ""} />
                    {/* Only when it's a real NY Medicaid CIN — 2 letters, 5
                        digits, 1 letter. Payers return other identifiers in
                        this field, and one rendered under a "Medicaid ID"
                        label is worse than nothing: a rep would read it as a
                        Medicaid enrolment the patient may not have.
                        `isNyMedicaidId` is the same test the insurance
                        suggestion engine already uses to decide exactly that. */}
                    {isNyMedicaidId(selected.stediSecondaryMedicaidId ?? "") && (
                      <Field
                        boxed
                        full
                        label="Stedi Secondary / Medicaid ID"
                        value={selected.stediSecondaryMedicaidId ?? ""}
                      />
                    )}
                  </div>
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
                  {/* Clinic Address — commented out, Josh 2026-08-10: not
                      needed here. Picking a provider in step 3 sets the
                      verified clinic address anyway, which is the value that
                      carries forward.
                      ⚠️ If this comes back, re-add `clinicAddress` to
                      intakeEditsFor as well — it was removed so a Save with no
                      control behind it can't write a blank location and CLEAR
                      the column (the same trap followUpDate had).
                  <EditText
                    full
                    label="Clinic Address"
                    placeholder="Collect on call"
                    value={selected.clinicAddress ?? ""}
                    onChange={(v) => edit({ clinicAddress: v })}
                  />
                  */}
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
                {/* No "free text, not a number" note — the placeholder already
                    shows the expected shape, and the column being text is a
                    fact about the board, not something the rep needs told. */}
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
                        {/* Booked-or-not is derived from the Calendly MIRROR —
                            the same column the Scheduled Calls day grid reads,
                            so the two can never tell the rep different things.

                            ⚠️ The Booking Status column is deliberately NOT
                            shown. The form writes it "Scheduled" the moment the
                            patient picks a time STRING (server.js buildColumns:
                            `callBooked ? 'Scheduled' : 'Unscheduled'`), which
                            happens before any Calendly event exists — and the
                            real mirror writes the same label later. One label,
                            two meanings. Rendering it produced "Not booked"
                            beside a green "Scheduled" pill on the same row. */}
                        <div className="eyebrow-xs">Booked appointment</div>
                        <div className="bookval">{bookedCall || "Not booked"}</div>
                        {formSlotAsReceived && (
                          <div className="sugg-note" style={{ marginTop: 4 }}>
                            {bookedCall
                              ? `Asked for on the form: ${formSlotAsReceived}`
                              : `They asked for ${formSlotAsReceived} on the form, but never confirmed a time — send them a booking link.`}
                          </div>
                        )}
                      </div>
                      <span className={bookedCall ? "mp green" : "mp"}>
                        {bookedCall ? "Booked" : "Not booked"}
                      </span>
                    </div>

                    {/* Reschedule, for real.
                        The rep is only on this page with the patient on the
                        phone or mid-text, so "move my appointment" has to be
                        answerable here — but it has to MOVE THE BOOKING, not
                        describe one. This opens Calendly's own reschedule page
                        for that invitee; Calendly swaps the event and its
                        webhook updates the mirror below.

                        ⚠️ What used to be here was a free-text slot plus a
                        Confirm button that wrote Booking Status = Scheduled.
                        Nothing about that created a Calendly event, so the
                        patient read "Scheduled" here while never appearing in
                        the Scheduled Calls day grid — which reads the mirror,
                        not this text — and the call simply never happened.
                        Don't reintroduce a typed time: the Scheduling API is
                        off on this account, so a local time can never become a
                        real booking. */}
                    {/* Only when there is something to move. Offering
                        "Reschedule" against no booking is what sent a rep to a
                        blank tab — the button has nothing to open. */}
                    {bookedCall ? (
                      <div style={{ marginTop: 14 }} className="flex items-center gap-2 flex-wrap">
                        <button
                          className="btn secondary sm"
                          disabled={rescheduling}
                          onClick={() => void openReschedule()}
                          title="Open this patient's Calendly booking to move it"
                        >
                          {rescheduling ? "Opening…" : "Reschedule appointment"}
                        </button>
                        <span className="sugg-note">
                          Opens Calendly — the new time syncs back on its own.
                        </span>
                      </div>
                    ) : (
                      <div style={{ marginTop: 14 }} className="flex items-center gap-2 flex-wrap">
                        <button
                          className="btn secondary sm"
                          onClick={() => setBookingLinkOpen(true)}
                        >
                          Send booking link
                        </button>
                        <span className="sugg-note">
                          They pick a time; it appears here once they book.
                        </span>
                      </div>
                    )}
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

              {/* ── Patient Messages ── Tabbed Text / Email (Katie,
                  2026-08-13). The Text tab shows the recent RingCentral thread
                  inline so the rep can read the conversation while working the
                  fields, instead of opening the header's Text popup over them.
                  That popup stays — both send through the same helpers, both
                  honour the opt-out guard, and both stamp the Call Log via
                  `logTextSent`, so neither is a composer without a history.
                  Text goes through the gateway (sender taken from the verified
                  token server-side); Email uses the same worker route Send
                  Request does. */}
              <IntakeMessages
                patientId={selected.id}
                email={selected.email}
                phone={selected.ptPhone}
                onTextSent={logTextSent}
              />

              {/* Opened from the header button. Prefilled from the patient on
                  screen; the booking lands on the board via the Calendly
                  webhook, so nothing here writes to Monday. */}
              <BookingLinkDialog
                open={bookingLinkOpen}
                onOpenChange={setBookingLinkOpen}
                patientName={selected.name}
                phone={selected.ptPhone}
                email={selected.email}
              />

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

              {/* Brandon §9 asked for a Care Coordinator Owner COLUMN so a
                  later phase could route by owner. Josh's call: no new column
                  — the assignment is stamped into the log above, which is the
                  one free-text field that survives the hop to Medical
                  Necessity, so any later stage can key off the stamp. */}
              <Card title="Care Coordinator">
                <div className="bookrow" style={{ marginBottom: 12 }}>
                  <div>
                    <div className="eyebrow-xs">Assigned</div>
                    <div className="bookval">{coordinator || "Nobody yet"}</div>
                  </div>
                  {coordinator && <span className="mp green">Owned</span>}
                </div>
                <EditSelect
                  full
                  label={coordinator ? "Reassign" : "Assign a coordinator"}
                  value=""
                  options={coordinatorRoster}
                  onChange={(v) => { void assignCoordinator(v); }}
                />
              </Card>

              {/* HANDOFF §2 "Left-pane exits" — all three live here, at the
                  bottom of the pane they belong to, as the mockup has them. */}
              <Card
                title="Ready to Advance?"
                tone="decide"
                right={
                  /* Counts the list actually rendered below it — this pane's
                     conditions — on both branches. A number that doesn't match
                     the list under it is worse than no number. */
                  <span className={intakeBlockers.length === 0 ? "pill ok" : "pill warn"}>
                    {intakeBlockers.length === 0 ? "Ready" : `${intakeBlockers.length} still needed`}
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
                    {/* ── The gate, ABOVE the actions ──
                        What's blocking is the thing a rep reads first and acts
                        on, so it leads the card in a panel of its own instead
                        of trailing the buttons as 11px grey text. Set at
                        readable size, and the panel itself carries the state:
                        amber while something is outstanding, mint once it
                        isn't. Covers BOTH panes, because that is what the
                        advance is gated on. */}
                    <div className={intakeBlockers.length === 0 ? "gate ready" : "gate blocking"}>
                      <div className="gate-head">
                        {intakeBlockers.length === 0 ? (
                          <><Check className="h-4 w-4" /> Patient info complete</>
                        ) : (
                          <><X className="h-4 w-4" /> Still needed
                            <span className="gate-count">{intakeBlockers.length}</span></>
                        )}
                      </div>

                      {intakeBlockers.length === 0 ? (
                        <p className="gate-note">
                          {canAdvance
                            ? "Profile is built too — advance from the Profile Clean-Up pane."
                            : "Finish the profile on the right, then advance from there."}
                        </p>
                      ) : (
                        <ul className="gate-list">
                          {intakeBlockers.map((b) => (
                            <li key={b.label}>
                              <X className="h-4 w-4 shrink-0" />
                              <div className="min-w-0">
                                <div className="gl-label">{b.label}</div>
                                {b.hint && <div className="gl-hint">{b.hint}</div>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* The right pane still unlocks on its own from the left
                          pane's conditions (HANDOFF §2: "not unlocked by a
                          button click") — this only scrolls there. Shown
                          whenever the pane is open, INCLUDING when everything
                          passes: that is exactly when the rep wants to go press
                          Advance, and the button is only over there. */}
                      {unlock.unlocked && (
                        <button
                          onClick={() => cleanUpRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                          className="btn secondary sm"
                        >
                          Go to Profile Clean-Up →
                        </button>
                      )}
                    </div>

                    {/* ── The three actions, one even row ──
                        Equal widths, side by side, nothing interleaved between
                        them: the captions that used to sit inline are collected
                        underneath, which is what let the row read as three
                        different-sized things.

                        ⚠️ ADVANCE IS DELIBERATELY NOT HERE (Josh, 2026-08-13).
                        There is exactly ONE advance button and it lives at the
                        bottom of the right pane, where the profile work ends. A
                        copy here was the same action under the same gate in two
                        places — which is how the two drift apart and start
                        disagreeing about whether the patient may leave. */}
                    <div className="exit-row">
                      {/* THE Monday write for the left pane. Named so it can't
                          be mistaken for the header's local Save. */}
                      <button onClick={save} disabled={saving} className="btn primary">
                        {saving ? "Saving…" : "Save to Monday"}
                      </button>
                      <button
                        onClick={() => setAttemptOpen(true)}
                        disabled={saving}
                        className="btn amber"
                      >
                        Log call attempt
                      </button>
                      <button
                        onClick={() => setStuckOpen(true)}
                        disabled={saving}
                        className="btn rose"
                      >
                        Propose Stuck
                      </button>
                    </div>
                    <p className="exit-note">
                      Save writes the left pane to the board without advancing
                      <span className="dot">·</span>
                      {attempts} attempt{attempts === 1 ? "" : "s"} logged
                    </p>

                  </>
                )}
              </Card>

              {/* ── The two exits that need a sentence from the rep ──
                  Popups rather than inline panels (Katie, 2026-08-13). Both
                  render through the shadcn Dialog, which portals to the body —
                  outside `.pf-root`, so its own button styling survives (the
                  trap that keeps shadcn panels off this page otherwise).
                  Neither closes on failure: the rep's typed text stays in the
                  box so a retry doesn't mean retyping it. */}
              <Dialog open={attemptOpen} onOpenChange={setAttemptOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Log a call attempt</DialogTitle>
                    <DialogDescription>
                      Snoozes {selected.name || "this patient"} to the next business day and adds
                      attempt {attempts + 1} to the Call Log.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="attempt-note">
                      What happened on the call?
                    </label>
                    <textarea
                      id="attempt-note"
                      className="w-full min-h-[96px] rounded-md border border-input bg-background p-2 text-sm"
                      value={attemptNote}
                      placeholder="No answer, left voicemail…"
                      onChange={(e) => setAttemptNote(e.target.value)}
                    />
                    {/* Required, and said out loud — the counter on its own
                        never records what was said. */}
                    <p className="text-xs text-muted-foreground">
                      Required. The attempt counter records that someone called; this is the only
                      record of what came of it.
                    </p>
                  </div>
                  <DialogFooter>
                    <button
                      className="btn secondary sm"
                      disabled={saving}
                      onClick={() => setAttemptOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn amber sm"
                      disabled={saving || !attemptNote.trim()}
                      onClick={() => {
                        void logAttempt(attemptNote).then((ok) => {
                          if (ok) { setAttemptNote(""); setAttemptOpen(false); }
                        });
                      }}
                    >
                      {saving ? "Logging…" : "Log attempt"}
                    </button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={stuckOpen} onOpenChange={setStuckOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Propose stuck</DialogTitle>
                    <DialogDescription>
                      Sends {selected.name || "this patient"} to{" "}
                      {stuckLevel === "final" ? "Final Decisions" : "Manager Intervention"} for
                      review instead of advancing. They leave your queue.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="stuck-reason">
                      Why is this patient stuck?
                    </label>
                    <textarea
                      id="stuck-reason"
                      className="w-full min-h-[96px] rounded-md border border-input bg-background p-2 text-sm"
                      value={escalateReason}
                      placeholder="Doesn't meet criteria because…"
                      onChange={(e) => setEscalateReason(e.target.value)}
                    />
                    {/* Required: a manager can't action a blank proposal, and
                        the reason IS the handover — it's all they'll see. */}
                    <p className="text-xs text-muted-foreground">
                      Required. This is what the reviewing manager sees.
                    </p>
                  </div>
                  <DialogFooter>
                    <button
                      className="btn secondary sm"
                      disabled={saving}
                      onClick={() => setStuckOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn rose sm"
                      disabled={saving || !escalateReason.trim()}
                      onClick={() => {
                        void runStageAction("proposeStuck").then((ok) => {
                          if (ok) setStuckOpen(false);
                        });
                      }}
                    >
                      {saving ? "Sending…" : "Propose Stuck"}
                    </button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
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

                    {/* Set off from the fields above with the same dashed rule
                        the rest of the page uses for "this is an action, not
                        another input". Butted straight under the engine's
                        reasoning box it read as part of that box. */}
                    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed var(--border)" }}>
                      <button
                        onClick={saveVerified}
                        disabled={saving}
                        className="btn primary"
                      >
                        Save verified insurance
                      </button>
                    </div>
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

                    {/* Address, loudly, at the last moment it is cheap to fix.
                        WARNS, never blocks — the intake form doesn't ask for an
                        address, so a blocking row would stop literally every
                        patient and reps would learn to ignore the checklist.
                        It sits here rather than only beside the input on the
                        left because that note is two panes away from the button
                        that ships the patient: once they're on the Medical
                        Necessity board, getting an address means calling them
                        back, and by then nobody remembers whether we ever had
                        one. Amber elsewhere on this page means "worth a look";
                        this one is rose because it costs a phone call later. */}
                    {!(selected.patientAddress ?? "").trim() && (
                      <div
                        className="mt-4 flex items-start gap-3 rounded-lg border-2 border-rose-300 bg-rose-50 px-4 py-3"
                        role="alert"
                      >
                        <AlertTriangle className="h-6 w-6 shrink-0 text-rose-600" />
                        <div>
                          <div className="text-sm font-black uppercase tracking-wide text-rose-800">
                            No address on file
                          </div>
                          <p className="mt-0.5 text-sm text-rose-900">
                            The form never asks for one. Get it on this call — Medical Necessity
                            and every stage after it need it to ship, and chasing it later means
                            calling the patient back.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* An address that IS on file but won't ship. Same rose, same
                        reason — a bad address costs the same call-back as no
                        address, and it is likelier to slip through because the
                        box looks full. Warns, never blocks, like its neighbour:
                        this page's exits stay open by design. */}
                    {addressIssue && (
                      <div
                        className="mt-4 flex items-start gap-3 rounded-lg border-2 border-rose-300 bg-rose-50 px-4 py-3"
                        role="alert"
                      >
                        <AlertTriangle className="h-6 w-6 shrink-0 text-rose-600" />
                        <div>
                          <div className="text-sm font-black uppercase tracking-wide text-rose-800">
                            Address won’t ship
                          </div>
                          <p className="mt-0.5 text-sm text-rose-900">{addressIssue}</p>
                        </div>
                      </div>
                    )}

                    {/* THE advance — the only one on the page (Josh,
                        2026-08-13). It lives here because this is where the
                        profile work ends; the left pane shows what's still
                        blocking and links down to it.
                        ⚠️ Gated on `canAdvance`, not `readyMissing`. Keying on
                        readiness alone let this button go live while the left
                        pane's unlock conditions still failed, so the patient
                        could leave the stage without the checks the pane exists
                        to enforce. */}
                    <div className="route-grid" style={{ gridTemplateColumns: "1fr" }}>
                      <div className={canAdvance ? "route adv on" : "route adv"}>
                        <h4>Advance to MN</h4>
                        <p>Profile is complete — hand the patient to Medical Necessity.</p>
                        <button
                          onClick={() => { void runStageAction("advance"); }}
                          disabled={!canAdvance || saving}
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
                      manager ladder: Propose Stuck / Approve / Send back.

                      The escalation log used to be echoed here from its own
                      column. That column is gone (Josh, 2026-08-11) — decisions
                      are stamped into the Call Log with their rung named, so
                      the reason sits in the same place as every other note on
                      this patient rather than in a second box saying the same
                      thing twice. */}
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
