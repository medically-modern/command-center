/**
 * The Subscription › Profile cards in Brandon's layout (pixel-match,
 * 2026-09-24 — `_reference/brandon-redesign/PIXEL_MATCH_INSTRUCTIONS_2026-09-24.txt`
 * items 5–12, his `profilePage` markup).
 *
 * Josh, the same day: *"its so so critical that we are just changing the
 * visuals and not the backend or label options … he just cares about how shit
 * looks"*. So these cards are PRESENTATIONAL, and every rule below is about
 * keeping what they write identical to what the screen wrote before:
 *
 * ⚠️⚠️ **SAME FIELDS, SAME VALUES, SAME WRITER.** Every control writes the
 * `Patient` field the `/subscription` page's own components write —
 * `SubscriptionForm` (Next order, Subscription, the product types, the sets and
 * quantities) and `PatientInfoCard` (address, insurance, doctor) — in the same
 * shape (an index for a status, the label beside it, a string for text), and
 * the one Send still hands the result to `sendPatientToMonday`. Nothing here
 * talks to Monday except the notes box (the Comms Hub's `appendNoteToRecord`,
 * the writer the right column's Recent notes already uses) and the files list
 * (read-only).
 *
 * ⚠️⚠️ **SAME OPTIONS.** A select offers exactly the list the app offered for
 * that column before: the same hardcoded lists `SubscriptionForm` uses, the
 * same live board labels where it read them live (the infusion sets), the same
 * `usePayerOptions` for Primary Insurance. The mockup's own option lists are
 * invented (PIXEL_MATCH_PLAN.md §2.7) and are not used. The one addition to a
 * list is the patient's CURRENT value when a list does not carry it — shown so
 * a real board value never renders as a different option (§5.31b's
 * `withCurrentSelection`); picking it writes the value the board already holds.
 *
 * ⚠️ Read-only is Brandon's own mechanism — every control `disabled`, the Order
 * details card `.readonly`, the drop zone `.off` — and the writer the page
 * hands down is a no-op as well. View and Download stay live: reading a file is
 * not editing the profile (§5.39c: abilities unlock buttons, they never hide
 * information).
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Eye, File as FileIcon, Send, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { DossierItem } from "@/lib/commsHub/dossier";
import { appendNoteToRecord } from "@/lib/commsHub/dossierApi";
import { noteEntries, noteStageLabel } from "@/lib/patient/recentNotes";
import { daysUntil, usDate } from "@/lib/patient/subscriptionOverview";
import { formatLastContact } from "@/lib/patient/contacts";
import { responseTone, type ReorderForm } from "@/lib/patient/reorderForm";
import {
  FAX_PARACHUTE_OPTIONS,
  PRIMARY_INSURANCE_OPTIONS,
  SECONDARY_INSURANCE_OPTIONS,
  SENSORS_TYPE_OPTIONS,
  SUBSCRIPTION_OPTIONS,
  SUPPLIES_TYPE_OPTIONS,
  formatPhone,
  subscriptionIncludesSensors,
  subscriptionIncludesSupplies,
  type Patient as SubPatient,
} from "@/lib/subscription/workflow";
import { EXTRA_COL, type ExtrasEdit, type ProfileExtras } from "@/lib/subscription/profileExtras";
import { COL, type MondayFileEntry } from "@/lib/subscription/mondayApi";
import { expiryForVisitDate, mrRungForExpiry } from "@/lib/subscription/mrStatus";
import { profileFrequencyDays, profileFrequencyRefusal } from "@/lib/welcomeCall/payerRules";
import { infusionSetCap, infusionSetTotal, payerCapNote } from "@/lib/shared/infusionCap";
import { stockVerdict } from "@/lib/welcomeCall/infusionStock";
import { useInfusionStock } from "@/hooks/welcomeCall/useInfusionStock";
import { etTodayYmd } from "@/lib/shared/monitorSale";
import { usePayerOptions } from "@/hooks/shared/usePayerOptions";
import { AddressAutocomplete, type AddressResult } from "@/components/welcomeCall/AddressAutocomplete";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { fetchAssetBytes } from "@/lib/shared/mondayAssets";
import { usePendingNoteReport } from "@/components/shared/pendingNoteGuard";

export type FieldChange = (field: keyof SubPatient, value: string | number | null) => void;
export interface StatusOpt {
  index: number;
  label: string;
}

/** Live status options for one group of columns, as `useStatusOptions` hands them over. */
export interface LiveOptions {
  options: Record<string, StatusOpt[]>;
  ready: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/* ── small pieces, Brandon's markup ─────────────────────────────────────── */

const isBlank = (v: ReactNode) => v === null || v === undefined || v === "" || v === false;

/** His `F(k, v, cls)` — a read-only fact; a blank is an em dash. */
function F({ k, v, cls }: { k: string; v: ReactNode; cls?: string }) {
  return (
    <div className="fact">
      <div className="k">{k}</div>
      <div className={`v${cls ? ` ${cls}` : ""}`}>{isBlank(v) ? "—" : v}</div>
    </div>
  );
}

/**
 * The board's value is always offered, even when the list does not carry it —
 * otherwise a native select shows the FIRST option for a value it cannot find,
 * i.e. a different product than the patient has (§5.31b).
 */
function withCurrent(opts: StatusOpt[], index: number | null, label: string): StatusOpt[] {
  if (index === null || opts.some((o) => o.index === index)) return opts;
  return [...opts, { index, label: label || "Current value" }];
}

/** His `sel(label, val, opts)` — `<label class="ef">` + `select.input.sm`. */
function Sel({
  label,
  value,
  currentLabel = "",
  options,
  onChange,
  disabled,
  allowBlank = false,
  hint,
  hintTone,
}: {
  label: string;
  value: number | null;
  currentLabel?: string;
  options: StatusOpt[];
  onChange: (index: number | null) => void;
  disabled?: boolean;
  /** Offer "—" as a real choice (it CLEARS the column). Otherwise "—" is only
   *  the placeholder shown while the column is blank. */
  allowBlank?: boolean;
  /** A string is drawn muted (or amber with `hintTone="warn"`); a node is drawn as is. */
  hint?: ReactNode;
  hintTone?: "warn";
}) {
  const opts = withCurrent(options, value, currentLabel);
  return (
    <label className="ef">
      <span className="k">{label}</span>
      <select
        className="input sm"
        aria-label={label}
        value={value === null ? "" : String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        {(allowBlank || value === null) && (
          <option value="" disabled={!allowBlank}>
            {"—"}
          </option>
        )}
        {opts.map((o) => (
          <option key={o.index} value={String(o.index)}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (typeof hint === "string" ? <span className={`xs ${hintTone === "warn" ? "hint-warn" : "muted"}`}>{hint}</span> : hint)}
    </label>
  );
}

/** His `num(label, val)` / a text box, same frame. */
function Inp({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  mono,
  placeholder,
  max,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: "text" | "number" | "date" | "tel";
  mono?: boolean;
  placeholder?: string;
  /** A number box's ceiling (the payer cap on the quantities). */
  max?: number;
  /** An amber line under the box — a refused value says why. */
  hint?: string | null;
}) {
  return (
    <label className="ef">
      <span className="k">{label}</span>
      <input
        className={`input sm${mono ? " mono" : ""}`}
        type={type}
        min={type === "number" ? 0 : undefined}
        max={type === "number" ? max : undefined}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="xs hint-warn">{hint}</span>}
    </label>
  );
}

/**
 * Cardinal stock for an infusion set a rep has just PICKED on the profile
 * (Josh, 2026-10-01: *"when changing infusion set on profile view … flag if the
 * new infusion set selected is not in stock as a warning"*).
 *
 * ⚠️ Its own component so the Cardinal SKU Tracker is read only once a set is
 * actually CHANGED — mounting `useInfusionStock` in the card would read it for
 * every profile anybody opens. The read itself is Welcome Call's: one shared
 * module-scope load, 30-minute TTL (INCIDENT_2026-08-20's rules), and the
 * verdict is `stockVerdict`'s — STATUS decides, so a Backordered set with 220
 * on hand is still "not in stock", and a set with no tracker row is UNKNOWN,
 * never in stock (§5.31b / `infusionStock.ts`).
 */
function SetStockFlag({ label }: { label: string }) {
  const stock = useInfusionStock();
  if (!stock.index) {
    return (
      <span className="xs muted">
        {stock.error ? "Couldn't check Cardinal stock for this set." : "Checking Cardinal stock…"}
      </span>
    );
  }
  const v = stockVerdict(label, stock.index, etTodayYmd());
  if (!v.label) return null;
  if (v.blocked) {
    return (
      <span className="xs hint-warn" role="alert">
        Not in stock — {v.detail}
      </span>
    );
  }
  return (
    <span className="xs muted" title={v.detail}>
      {v.tone === "green" ? `In stock at Cardinal · ${v.label}` : v.tone === "amber" ? `Low stock at Cardinal · ${v.label}` : v.detail}
    </span>
  );
}

/** His address box: a grey `.input.sm` for a reader, the live autocomplete for an editor. */
function AddressBox({
  value,
  canEdit,
  resetKey,
  onPick,
  placeholder,
}: {
  value: string;
  canEdit: boolean;
  /** Bumped by Discard — the autocomplete is uncontrolled, so a new key is
   *  what puts the board's value back in the box. */
  resetKey: string;
  onPick: (r: AddressResult) => void;
  placeholder: string;
}) {
  if (!canEdit) {
    return (
      <div className="input sm ro-box" style={{ marginTop: 4 }}>
        {value || "—"}
      </div>
    );
  }
  return (
    <div className="addr-sm" style={{ marginTop: 4 }}>
      <AddressAutocomplete key={resetKey} value={value} onChange={onPick} placeholder={placeholder} />
    </div>
  );
}

/** "Yes" green / "No" / verbatim — his `yn()`. A blank is unknown, never a No (§5.31d). */
function yn(v: string): ReactNode {
  const t = (v ?? "").trim();
  if (!t) return "";
  if (/^(yes|true|1)$/i.test(t)) return <span className="good">Yes</span>;
  if (/^(no|false|0)$/i.test(t)) return "No";
  return t;
}

/** "$1,234.50" — his `money()`; blank or unreadable is an em dash, never $0.00. */
function money(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "—";
  const s = String(raw).replace(/[$,\s]/g, "");
  if (!s) return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return String(raw);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


/* ── Demographics (+ Contacts) ──────────────────────────────────────────── */

export function DemographicsCard({
  patient,
  extras,
  extrasEdit,
  onExtras,
  canEdit,
  onFieldChange,
  contactOpts,
  resetKey,
  readOnlyName,
}: {
  patient: SubPatient;
  extras: ProfileExtras | null;
  extrasEdit: ExtrasEdit;
  onExtras: (patch: ExtrasEdit) => void;
  canEdit: boolean;
  onFieldChange: FieldChange;
  /** Live labels for Primary / Alternate Contact. */
  contactOpts: LiveOptions;
  resetKey: string;
  readOnlyName: string;
}) {
  const x = extras;
  const addr = patient.addressEdited ?? patient.address;
  const primaryIdx =
    extrasEdit.primaryContactIndex !== undefined ? extrasEdit.primaryContactIndex : x?.primaryContactIndex ?? null;
  const altIdx =
    extrasEdit.alternateContactIndex !== undefined ? extrasEdit.alternateContactIndex : x?.alternateContactIndex ?? null;
  const cgName = extrasEdit.caregiverName ?? x?.caregiverName ?? "";
  const cgAuth = extrasEdit.caregiverAuthorized ?? x?.caregiverAuthorized ?? false;
  const altPhone = extrasEdit.alternatePhone ?? (x?.alternatePhone ? formatPhone(x.alternatePhone) : "");
  /* ⚠️ The controls render for a READER too, disabled — Brandon's read-only
     mechanism for a block he made editable ("disabled controls + notes").
     Only a record whose extras did not arrive falls back to plain facts. */
  const contactsLive = !!x;
  const optsOff = !contactOpts.ready;
  const optsHint = contactOpts.error
    ? "Couldn't load the options from Monday"
    : contactOpts.loading && optsOff
      ? "Loading options from Monday…"
      : null;

  return (
    <section className="card pad">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Demographics
      </div>
      <div className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <F k="Gender" v={patient.gender} />
        <F
          k="Email"
          v={patient.email ? <a href={`mailto:${patient.email}`} className="plink">{patient.email}</a> : ""}
        />
      </div>
      <div className="fact" style={{ marginTop: 12 }}>
        <div className="k">Address</div>
        <AddressBox
          value={addr}
          canEdit={canEdit}
          resetKey={`addr-${patient.id}-${resetKey}`}
          placeholder="Search for address..."
          onPick={(r) => {
            onFieldChange("addressEdited", r.address);
            onFieldChange("addressLat", r.lat);
            onFieldChange("addressLng", r.lng);
          }}
        />
      </div>
      <div className="facts" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
        <F k="Referral source" v={patient.referral} />
        <F k="Can text" v={yn(x?.canText ?? "")} />
      </div>

      <div className="eyebrow contacts-h">Contacts</div>
      {contactsLive ? (
        /* ⚠️ His three columns WHEN THEY FIT (`.facts.contacts.ctl`): a select is
           wider than the fact it replaced, and in the 1440 card three of them
           cut "Patient" to "Patien". The facts below keep his fixed three. */
        <div className="facts contacts ctl">
          <Sel
            label="Primary contact"
            value={primaryIdx}
            currentLabel={x?.primaryContact ?? ""}
            options={contactOpts.options[EXTRA_COL.primaryContact] ?? []}
            allowBlank
            disabled={!canEdit || optsOff}
            hint={canEdit ? optsHint : null}
            onChange={(i) => onExtras({ primaryContactIndex: i })}
          />
          <Sel
            label="Alternate contact"
            value={altIdx}
            currentLabel={x?.alternateContact ?? ""}
            options={contactOpts.options[EXTRA_COL.alternateContact] ?? []}
            allowBlank
            disabled={!canEdit || optsOff}
            onChange={(i) => onExtras({ alternateContactIndex: i })}
          />
          <Inp
            label="Caregiver name"
            value={cgName}
            disabled={!canEdit}
            onChange={(v) => onExtras({ caregiverName: v })}
          />
          {/* ⚠️ A checkbox has two states, so this is "—" or "Yes", never "No":
              unticked means nobody recorded an authorisation (§5.46e). */}
          <label className="ef">
            <span className="k">Caregiver authorized</span>
            <select
              className="input sm"
              aria-label="Caregiver authorized"
              value={cgAuth ? "yes" : ""}
              disabled={!canEdit}
              onChange={(e) => onExtras({ caregiverAuthorized: e.target.value === "yes" })}
            >
              <option value="">{"—"}</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          <Inp
            label="Alternate phone"
            type="tel"
            value={altPhone}
            placeholder="(555) 555-0100"
            disabled={!canEdit}
            onChange={(v) => onExtras({ alternatePhone: v })}
          />
          <F k="Last patient contact" v={formatLastContact(x?.lastPatientContact ?? "")} />
        </div>
      ) : (
        <div className="facts contacts" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
          <F k="Primary contact" v={x?.primaryContact} />
          <F k="Alternate contact" v={x?.alternateContact} />
          <F k="Caregiver name" v={x?.caregiverName} />
          <F k="Caregiver authorized" v={x?.caregiverAuthorized ? <span className="good">Yes</span> : ""} />
          <F k="Alternate phone" v={x?.alternatePhone ? formatPhone(x.alternatePhone) : ""} />
          <F k="Last patient contact" v={formatLastContact(x?.lastPatientContact ?? "")} />
        </div>
      )}
      {/* The editable caption is gone (Josh, 2026-09-25: "Delete 'Who we
          reach, and on which number …'"); a reader still needs to know WHY the
          controls are grey. */}
      {!canEdit && (
        <div className="xs muted" style={{ marginTop: 8 }}>
          {`Read-only — editing the profile isn't enabled for ${readOnlyName}`}
        </div>
      )}
    </section>
  );
}

/* ── Insurance ──────────────────────────────────────────────────────────── */

export function InsuranceCard({
  patient,
  extras,
  canEdit,
  onFieldChange,
}: {
  patient: SubPatient;
  extras: ProfileExtras | null;
  canEdit: boolean;
  onFieldChange: FieldChange;
}) {
  /* The same live source `SubscriptionInsuranceCard` reads (§5.33) — the
     Subscription board numbers its payer labels on its own. */
  const payers = usePayerOptions("subscription");
  const primaryOpts = payers.optionsFor(
    PRIMARY_INSURANCE_OPTIONS,
    patient.primaryInsurance,
    patient.primaryInsuranceIndex,
  );
  const primaryIdx = patient.primaryInsuranceEdited ?? patient.primaryInsuranceIndex;
  const secondaryIdx = patient.secondaryInsuranceEdited ?? patient.secondaryInsuranceIndex;
  const active = patient.stediActive ?? "";
  const activeCls = /^active$/i.test(active) ? "good" : /inactive|failed|^no$/i.test(active) ? "bad" : "";

  return (
    <section className="card pad">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Insurance
      </div>
      {canEdit ? (
        <div className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Sel
            label="Primary insurance"
            value={primaryIdx}
            currentLabel={patient.primaryInsurance}
            options={primaryOpts}
            onChange={(i) => onFieldChange("primaryInsuranceEdited", i)}
          />
          <Inp
            label="Member ID 1"
            mono
            value={patient.memberId1Edited ?? patient.memberId1}
            onChange={(v) => onFieldChange("memberId1Edited", v)}
          />
          <Sel
            label="Secondary insurance"
            value={secondaryIdx}
            currentLabel={patient.secondaryInsurance || "None"}
            options={SECONDARY_INSURANCE_OPTIONS}
            onChange={(i) => onFieldChange("secondaryInsuranceEdited", i)}
          />
          <Inp
            label="Member ID 2"
            mono
            value={patient.memberId2Edited ?? patient.memberId2}
            onChange={(v) => onFieldChange("memberId2Edited", v)}
          />
        </div>
      ) : (
        <div className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <F k="Primary insurance" v={patient.primaryInsurance} />
          <F k="Member ID 1" v={patient.memberId1 ? <span className="mono">{patient.memberId1}</span> : ""} />
          <F k="Secondary insurance" v={patient.secondaryInsurance || "None"} />
          <F k="Member ID 2" v={patient.memberId2 ? <span className="mono">{patient.memberId2}</span> : ""} />
        </div>
      )}
      <div className="facts split wide" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <F k="Last eligibility check" v={extras?.lastEligibilityCheck ? usDate(extras.lastEligibilityCheck) : ""} />
        <F k="Active status" v={active} cls={activeCls} />
        <F k="Deductible left" v={patient.stediDedRemaining} />
        <F k="OOP remaining" v={extras?.oopRemaining} />
      </div>
    </section>
  );
}

/* ── Medical necessity & auth — Brandon's v3 layout (2026-09-25) ────────────
   Josh: *"I changed the medical necessity & auth box a little bit in a new
   redesign mockup - let's use that updated one."* His v3: Diagnosis |
   Medical records on top, then Sensors auth | Supplies auth — the STATUS,
   then a line per HCPCS code (`code: auth id` + `units (start – end)`) —
   then the MN documents block, whose right column carries the FILES above
   the visit date. Every value is a field this slice already reads
   (`READ_COLUMN_IDS` — sensors/supplies auth ids, units and date ranges);
   nothing was widened for it. */

/** His `authStatus`: the status with its "Auth. " prefix said once by the
 *  column, not repeated per row. Tone: valid/no-auth green · expiring,
 *  denied, required, pending amber · Not Serving muted. An unrecognised
 *  label renders verbatim, untinted (§5.20). */
function authStatusNode(status: string): ReactNode {
  const t = (status ?? "").trim();
  if (!t) return "";
  const label = t.replace(/^auth\.?\s+/i, "");
  const cls = /valid|no auth/i.test(t)
    ? "good"
    : /expir|denied|required|pending|outstanding/i.test(t)
      ? "warn"
      : /not serving/i.test(t)
        ? "muted"
        : "";
  return cls ? <span className={cls}>{label}</span> : label;
}

/** One HCPCS line: `A4239: <id>` and `N units (start – end)`. Renders only
 *  when there is an id or a date — his own conditional, which is what keeps
 *  a Not Serving column from growing three em-dash rows. */
function AuthLine({ code, id, units, start, end }: { code: string; id: string; units: string; start: string; end: string }) {
  if (!id && !start && !end) return null;
  const range = start || end ? `(${start ? usDate(start) : "?"} – ${end ? usDate(end) : "?"})` : "";
  return (
    <div className="auth-line">
      <div>
        <span className="code">{code}</span>: <span className="mono">{id || "—"}</span>
      </div>
      {(units || range) && (
        <div className="xs muted">
          {units ? `${units} units ` : ""}
          {range}
        </div>
      )}
    </div>
  );
}

function extOf(name: string): string {
  const e = name.split(".").pop() ?? "";
  return e && e !== name ? e.toUpperCase() : "File";
}

async function downloadFile(f: MondayFileEntry) {
  const url = f.public_url || f.url;
  if (!url) {
    toast.error(`No download link for "${f.name}"`);
    return;
  }
  try {
    const bytes = await fetchAssetBytes(url, f.name);
    const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  } catch (e) {
    toast.error(`Couldn't download "${f.name}"`, { description: e instanceof Error ? e.message : String(e) });
  }
}

export function MnAuthCard({
  patient,
  files,
  filesLoading,
  filesError,
  queued,
  onQueue,
  onUnqueue,
  visitDate,
  onVisitDate,
  canEdit,
}: {
  patient: SubPatient;
  files: MondayFileEntry[] | null;
  filesLoading: boolean;
  filesError: string;
  queued: File[];
  onQueue: (files: File[]) => void;
  onUnqueue: (index: number) => void;
  visitDate: string;
  onVisitDate: (v: string) => void;
  canEdit: boolean;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  /* ⚠️ ONE row of files at first (Josh, 2026-09-25: *"if there's a bunch of
     files, it needs to not show all of them immediately … should only be one
     row of files, with ability to click in to view all"* — a long list was
     stretching the whole page). Nothing is hidden for good: the toggle names
     the count, and View/Download work the same either way. */
  const [showAllFiles, setShowAllFiles] = useState(false);
  const mr = patient.mr ?? "";
  const mrCls = /expired|invalid/i.test(mr) ? "bad" : /<\d+/.test(mr) ? "warn" : mr ? "good" : "";
  const dte = patient.mnExpiry ? daysUntil(patient.mnExpiry.slice(0, 10)) : null;
  const expiry = visitDate ? expiryForVisitDate(visitDate) : null;
  const rung = mrRungForExpiry(expiry);

  const filesNode = (
    <div className="files">
      {filesError ? (
        <div className="xs muted" style={{ padding: "4px 0" }}>
          Couldn&apos;t read the files — {filesError}
        </div>
      ) : files === null ? (
        <div className="xs muted" style={{ padding: "4px 0" }}>
          {filesLoading ? "Reading the files…" : "—"}
        </div>
      ) : files.length === 0 ? (
        <div className="xs muted" style={{ padding: "4px 0" }}>
          No files yet.
        </div>
      ) : (
        <>
          {(showAllFiles ? files : files.slice(0, 1)).map((f) => (
            <div className="f" key={f.assetId}>
              <span className="ico">
                <FileIcon style={{ width: 13, height: 13 }} />
              </span>
              <span className="grow truncate">
                <b title={f.name}>{f.name}</b>
                <div className="xs muted">{extOf(f.name)}</div>
              </span>
              <button
                type="button"
                className="btn ghost xs"
                title="View"
                onClick={() => {
                  const url = f.public_url || f.url;
                  if (url) openFileViewer({ url, name: f.name });
                  else toast.error(`No link for "${f.name}"`);
                }}
              >
                <Eye style={{ width: 12, height: 12 }} /> View
              </button>
              <button type="button" className="btn ghost xs" title="Download" onClick={() => void downloadFile(f)}>
                <Download style={{ width: 12, height: 12 }} />
              </button>
            </div>
          ))}
          {files.length > 1 && (
            <button
              type="button"
              className="btn ghost xs files-toggle"
              onClick={() => setShowAllFiles((v) => !v)}
            >
              {showAllFiles ? "Show fewer" : `View all ${files.length} files`}
            </button>
          )}
        </>
      )}
    </div>
  );

  /* His v3 Supplies column: the infusion set's HCPCS code follows the set —
     steel cannulas are A4231, soft are A4230 — and the cartridge line is
     A4232. Sensors are A4239. */
  const infCode = /trusteel|steel/i.test(patient.infusionSet1 || "") ? "A4231" : "A4230";

  return (
    <section className="card pad">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Medical necessity &amp; auth
      </div>
      <div className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <F k="Diagnosis" v={patient.diagnosis} />
        <F
          k="Medical records"
          v={
            mr || patient.mnExpiry ? (
              <>
                <span className={mrCls}>{mr || "—"}</span>
                {patient.mnExpiry && (
                  <div className="xs muted">
                    Expires {usDate(patient.mnExpiry)}
                    {dte !== null && ` · ${dte < 0 ? `${Math.abs(dte)} days ago` : `in ${dte} days`}`}
                  </div>
                )}
              </>
            ) : (
              ""
            )
          }
        />
      </div>
      <div className="facts split" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="fact">
          <div className="k">Sensors auth</div>
          <div className="v">{authStatusNode(patient.sensorsAuthStatus) || "—"}</div>
          <div className="auth-lines">
            <AuthLine
              code="A4239"
              id={patient.sensorsAuthId}
              units={patient.sensorsUnits}
              start={patient.sensorsStartAuth}
              end={patient.sensorsEndAuth}
            />
          </div>
        </div>
        <div className="fact">
          <div className="k">Supplies auth</div>
          <div className="v">{authStatusNode(patient.suppliesAuthStatus) || "—"}</div>
          <div className="auth-lines">
            <AuthLine
              code={infCode}
              id={patient.infusionSetAuthId}
              units={patient.suppliesUnits}
              start={patient.suppliesStartAuth}
              end={patient.suppliesEndAuth}
            />
            <AuthLine
              code="A4232"
              id={patient.cartridgeAuthId}
              units=""
              start={patient.suppliesStartAuth}
              end={patient.suppliesEndAuth}
            />
          </div>
        </div>
      </div>

      <div className="fact" style={{ marginTop: 14 }}>
        <div className="k">Medical necessity documents</div>
        <div className="mndocs">
          <div>
            <div
              className={`drop${canEdit ? "" : " off"}${over ? " over" : ""}`}
              role="button"
              /* ⚠️ Named explicitly: without it the accessible name is every
                 line inside, "…when you press Send to Monday" included — a
                 screen reader then announces a second Send button, and so does
                 anything that finds the real one by its name. */
              aria-label="Upload MN documents"
              tabIndex={canEdit ? 0 : -1}
              aria-disabled={canEdit ? undefined : true}
              title={canEdit ? undefined : "Editing the profile isn't enabled for you — ask an admin"}
              onClick={() => canEdit && input.current?.click()}
              onKeyDown={(e) => {
                if (!canEdit) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  input.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (canEdit) setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                if (!canEdit || !e.dataTransfer?.files?.length) return;
                onQueue(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload style={{ width: 20, height: 20 }} />
              <b>Upload MN Docs</b>
              <div className="xs muted">Drag or click · written to the Monday item when you press Send to Monday</div>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                disabled={!canEdit}
                onChange={(e) => {
                  if (e.target.files?.length) onQueue(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
            </div>
            {queued.length > 0 && (
              <div className="files queued">
                {queued.map((f, i) => (
                  <div className="f" key={`${f.name}-${i}`}>
                    <span className="ico">
                      <FileIcon style={{ width: 13, height: 13 }} />
                    </span>
                    <span className="grow truncate">
                      <b title={f.name}>{f.name}</b>
                      <div className="xs muted">Uploads when you press Send to Monday</div>
                    </span>
                    <button
                      type="button"
                      className="btn ghost xs"
                      title="Remove"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => onUnqueue(i)}
                    >
                      <X style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="visit">
            {/* His v3 right column: the files ABOVE the visit date. */}
            <div className="k">MN file</div>
            {filesNode}
            <div className="k" style={{ marginTop: 10 }}>
              Visit date
            </div>
            <input
              className="input sm"
              type="date"
              aria-label="Visit date"
              style={{ width: "100%" }}
              value={visitDate}
              disabled={!canEdit}
              onChange={(e) => onVisitDate(e.target.value)}
            />
            <div className="xs muted" style={{ marginTop: 6 }}>
              Saved with the page&apos;s Send to Monday button: sets MN expiry to visit + 6 months and refreshes
              Medical Records.
            </div>
            {expiry && (
              <div className="xs good" style={{ marginTop: 4 }}>
                New MN expiry {usDate(expiry)}
                {rung ? ` · Medical Records → ${rung.label}` : ""}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Order details ──────────────────────────────────────────────────────── */

/**
 * `Sep 18, 2026, 2:00 PM ET` → `9/18/26` — the short date the one-line chip
 * wears. ⚠️ Anything that does not match comes back VERBATIM (§5.20's rule):
 * the column is written by the reorder service, not by us.
 */
export function shortSentDate(raw: string): string {
  const s = (raw ?? "").trim();
  const m = /^([A-Z][a-z]{2})\w* (\d{1,2}), (\d{4})/.exec(s);
  if (!m) return s;
  const months: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const mo = months[m[1]];
  if (!mo) return s;
  return `${mo}/${Number(m[2])}/${m[3].slice(2)}`;
}

/**
 * His `reorderLine` — the chip, not the whole card (§5.46c keeps the rest on
 * the Orders tab). ⚠️ ONE LINE since 2026-09-25 (Josh: *"just shows the pill
 * of 'Confirmed', 'No Response', 'Delay' with a ' - sent 9/16/26', so it all
 * fits on one line, and frequency drop-down now aligns with it"*): the Open
 * form link is gone — the Orders tab's reorder card still carries Copy link —
 * and the date is compressed. "No Response" is the board's own label for the
 * awaiting state (§5.46c: `No Response` and a blank are the same fact).
 */
function ReorderChip({ form }: { form: ReorderForm | null }) {
  if (!form || form.state === "not-sent") {
    return (
      <div className="rf">
        <span className="xs muted">Not sent yet</span>
      </div>
    );
  }
  const answered = form.state === "responded";
  const tone = responseTone(form.orderResponse);
  return (
    <div className="rf oneline">
      <span className={`chip${answered && tone ? ` ${tone}` : answered ? "" : " amber"}`}>
        {answered ? form.orderResponse : "No Response"}
      </span>
      {form.textSent && <span className="xs muted">· sent {shortSentDate(form.textSent)}</span>}
    </div>
  );
}

export function OrderDetailsCard({
  patient,
  extras,
  extrasEdit,
  onExtras,
  canEdit,
  onFieldChange,
  infusionOpts,
  frequencyOpts,
  reorder,
  readOnlyName,
  saved = null,
}: {
  patient: SubPatient;
  /** The infusion sets as the BOARD holds them — a set that differs was just
   *  picked here, and only that one gets the Cardinal stock check. */
  saved?: { infusionSet1: string; infusionSet2: string } | null;
  extras: ProfileExtras | null;
  extrasEdit: ExtrasEdit;
  onExtras: (patch: ExtrasEdit) => void;
  canEdit: boolean;
  onFieldChange: FieldChange;
  /** Live labels for Infusion Set 1 / 2 — the same read `SubscriptionForm` makes. */
  infusionOpts: LiveOptions;
  /** Live labels for Order Frequency. */
  frequencyOpts: LiveOptions;
  reorder: ReorderForm | null;
  readOnlyName: string;
}) {
  const ro = !canEdit;
  const setStatus = (
    idxField: keyof SubPatient,
    labelField: keyof SubPatient,
    opts: StatusOpt[],
    i: number | null,
  ) => {
    if (i === null) return; // no blank choice on these — same as SubscriptionForm
    onFieldChange(idxField, i);
    onFieldChange(labelField, opts.find((o) => o.index === i)?.label ?? "");
  };

  const infOff = !infusionOpts.ready;
  const infHint = infusionOpts.error
    ? "Couldn't load options from Monday"
    : infusionOpts.loading && infOff
      ? "Loading options from Monday…"
      : null;
  const inf1 = infusionOpts.options[COL.infusionSet1] ?? [];
  const inf2 = infusionOpts.options[COL.infusionSet2] ?? [];

  /* ⚠️ THE PAYER'S MAX FREQUENCY (Josh, 2026-10-01, §5.59): Medicaid and
     Fidelis Low-Cost — those two PRIMARY labels, nothing else — go up to 60;
     Aetna Commercial up to 75; everyone else up to 90. 30 and 60 are always
     offered; 75 only to Aetna Commercial (`payerRules.profileFrequencyDays`).
     ⚠️ The value the BOARD holds is always shown, even above the max — 66
     Fidelis Low-Cost subscribers were on 90 the day this shipped — and this
     card never rewrites it on its own; the max only limits a NEW pick. */
  const boardFreqIdx = extras?.orderFrequencyIndex ?? null;
  const freqIdx = extrasEdit.orderFrequencyIndex !== undefined ? extrasEdit.orderFrequencyIndex : boardFreqIdx;
  const allFreq = frequencyOpts.options[EXTRA_COL.orderFrequency] ?? [];
  const daysOf = (label: string | null | undefined) => Number(/^(\d+)/.exec((label ?? "").trim())?.[1] ?? NaN);
  const allowedDays = profileFrequencyDays(patient.primaryInsurance);
  const freqOpts = allFreq.filter(
    (o) => allowedDays.includes(daysOf(o.label)) || o.index === boardFreqIdx || o.index === freqIdx,
  );
  const freqLabel =
    allFreq.find((o) => o.index === freqIdx)?.label ?? (freqIdx === boardFreqIdx ? extras?.orderFrequency : "");
  const freqRefusal = freqIdx === null ? null : profileFrequencyRefusal(patient.primaryInsurance, daysOf(freqLabel));
  const freqSaved = freqIdx === boardFreqIdx;
  const freqHint =
    !ro && frequencyOpts.error
      ? "Couldn't load options from Monday"
      : freqRefusal
        ? freqSaved
          ? `${freqRefusal} Saved before this rule — it stays until it's changed.`
          : `${freqRefusal} Pick ${allowedDays.join(", ")} days.`
        : null;
  const freqOff = !frequencyOpts.ready || !extras;
  const cgmQty = extrasEdit.cgmQty ?? extras?.cgmQty ?? "";
  const cartQty = extrasEdit.cartridgeQty ?? extras?.cartridgeQty ?? "";

  /* ⚠️ THE PAYER CAP on infusion sets and cartridges — the SAME table Welcome
     Call and Final Confirm use (`lib/shared/infusionCap.ts`, §5.32g): Anthem
     BCBS Commercial and Horizon 9, Aetna Commercial 4, everyone else 3. A
     number above it is REFUSED as typed (Welcome Call's 2026-09-17 rule:
     "most plans should limit ability to go above 3") and says why; a value
     the board already holds above it stays shown, and the SETS' total is
     flagged below as Welcome Call's C31 does.
     ⚠️ The payer alone: the Subscription board's "Referral" dropdown is rep
     names, with no CareCentrix label — and every CareCentrix patient is
     Horizon (already 9), §5.32g. */
  const cap = infusionSetCap(patient.primaryInsurance, "");
  const [refused, setRefused] = useState<"" | "infQty1" | "infQty2" | "cartridgeQty">("");
  const capped = (field: "infQty1" | "infQty2" | "cartridgeQty", v: string, apply: (v: string) => void) => {
    const n = Number((v ?? "").trim());
    if ((v ?? "").trim() !== "" && Number.isFinite(n) && n > cap.cap) {
      setRefused(field);
      return;
    }
    setRefused("");
    apply(v);
  };
  const refusedHint = `Over the cap — ${payerCapNote(cap)}`;
  const capSuffix = ro ? "" : ` · max ${cap.cap}`;
  const setsTotal = infusionSetTotal(patient.infQty1, patient.infQty2, patient.primaryInsurance, "");
  const cartN = Number((cartQty ?? "").trim());
  const cartOver = Number.isFinite(cartN) && cartN > cap.cap;
  const capWho = cap.payerLabel ?? "this payer";
  const set1Changed = !ro && !!saved && !!patient.infusionSet1 && patient.infusionSet1 !== saved.infusionSet1;
  const set2Changed = !ro && !!saved && !!patient.infusionSet2 && patient.infusionSet2 !== saved.infusionSet2;

  return (
    <section className={`card pad${ro ? " readonly" : ""}`}>
      <div className="section-h" style={{ marginBottom: 10 }}>
        <span className="eyebrow">Order details</span>
        <span className="xs muted">
          {canEdit
            ? "editable · saves to the Subscription board"
            : `read-only — editing the profile isn't enabled for ${readOnlyName}`}
        </span>
      </div>
      <div className="editgrid">
        <Inp
          label="Next order date"
          type="date"
          value={patient.nextOrder}
          disabled={ro}
          onChange={(v) => onFieldChange("nextOrder", v)}
        />
        <Sel
          label="Subscription"
          value={patient.subscriptionIndex}
          currentLabel={patient.subscription}
          options={SUBSCRIPTION_OPTIONS}
          disabled={ro}
          onChange={(i) => setStatus("subscriptionIndex", "subscription", SUBSCRIPTION_OPTIONS, i)}
        />
        <Sel
          label="Frequency"
          value={freqIdx}
          currentLabel={extras?.orderFrequency ?? ""}
          options={freqOpts}
          disabled={ro || freqOff}
          hint={freqHint}
          hintTone={freqRefusal && !freqSaved ? "warn" : undefined}
          onChange={(i) => i !== null && onExtras({ orderFrequencyIndex: i })}
        />
        <div className="ef">
          <span className="k">Reorder form</span>
          <ReorderChip form={reorder} />
        </div>
        <Sel
          label="Sensors type"
          value={patient.sensorsTypeIndex}
          currentLabel={patient.sensorsType}
          options={SENSORS_TYPE_OPTIONS}
          disabled={ro}
          onChange={(i) => setStatus("sensorsTypeIndex", "sensorsType", SENSORS_TYPE_OPTIONS, i)}
        />
        <Inp
          label="CGM qty"
          type="number"
          value={cgmQty}
          disabled={ro || !extras}
          onChange={(v) => onExtras({ cgmQty: v })}
        />
        <Sel
          label="Supplies type (pump)"
          value={patient.suppliesTypeIndex}
          currentLabel={patient.suppliesType}
          options={SUPPLIES_TYPE_OPTIONS}
          disabled={ro}
          onChange={(i) => setStatus("suppliesTypeIndex", "suppliesType", SUPPLIES_TYPE_OPTIONS, i)}
        />
        <Inp
          label={`Cartridges qty${capSuffix}`}
          type="number"
          value={cartQty}
          disabled={ro || !extras}
          max={cap.cap}
          hint={refused === "cartridgeQty" ? refusedHint : null}
          onChange={(v) => capped("cartridgeQty", v, (x) => onExtras({ cartridgeQty: x }))}
        />
        <Sel
          label="Infusion set 1"
          value={patient.infusionSet1Index}
          currentLabel={patient.infusionSet1}
          options={inf1}
          disabled={ro || infOff}
          hint={ro ? null : infHint ?? (set1Changed ? <SetStockFlag label={patient.infusionSet1} /> : null)}
          onChange={(i) => setStatus("infusionSet1Index", "infusionSet1", inf1, i)}
        />
        <Inp
          label={`Inf. qty 1${capSuffix}`}
          type="number"
          value={patient.infQty1}
          disabled={ro}
          max={cap.cap}
          hint={refused === "infQty1" ? refusedHint : null}
          onChange={(v) => capped("infQty1", v, (x) => onFieldChange("infQty1", x))}
        />
        <Sel
          label="Infusion set 2"
          value={patient.infusionSet2Index}
          currentLabel={patient.infusionSet2}
          options={inf2}
          disabled={ro || infOff}
          hint={set2Changed ? <SetStockFlag label={patient.infusionSet2} /> : null}
          onChange={(i) => setStatus("infusionSet2Index", "infusionSet2", inf2, i)}
        />
        <Inp
          label={`Inf. qty 2${capSuffix}`}
          type="number"
          value={patient.infQty2}
          disabled={ro}
          max={cap.cap}
          hint={refused === "infQty2" ? refusedHint : null}
          onChange={(v) => capped("infQty2", v, (x) => onFieldChange("infQty2", x))}
        />
      </div>
      {/* The pair TOTAL, as Welcome Call's C31 checks it — each box can be
          within the cap while the two add up past it, and a value the board
          already holds above the cap is shown here rather than hidden. */}
      {(setsTotal.over || cartOver) && (
        <div className="cap-warn" role="note">
          {setsTotal.over && (
            <div>
              Infusion sets add up to <b>{setsTotal.total}</b> — over {capWho}'s {setsTotal.cap} per order.
            </div>
          )}
          {cartOver && (
            <div>
              Cartridges are <b>{cartN}</b> — over {capWho}'s {cap.cap} per order.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Doctor info ────────────────────────────────────────────────────────── */

export function DoctorCard({
  patient,
  canEdit,
  onFieldChange,
  resetKey,
}: {
  patient: SubPatient;
  canEdit: boolean;
  onFieldChange: FieldChange;
  resetKey: string;
}) {
  const docAddr = patient.doctorAddressEdited ?? patient.doctorAddress;
  const method = patient.faxParachuteEdited ?? patient.faxParachute;
  const methodIdx = FAX_PARACHUTE_OPTIONS.find((o) => o.label === method)?.index ?? null;

  return (
    <section className="card pad">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Doctor info
      </div>
      {canEdit ? (
        <div className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Inp label="Doctor" value={patient.doctorEdited ?? patient.doctor} onChange={(v) => onFieldChange("doctorEdited", v)} />
          <Inp label="NPI" mono value={patient.npiEdited ?? patient.npi} onChange={(v) => onFieldChange("npiEdited", v)} />
        </div>
      ) : (
        <div className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <F k="Doctor" v={patient.doctor} />
          <F k="NPI" v={patient.npi ? <span className="mono">{patient.npi}</span> : ""} />
        </div>
      )}
      <div className="fact" style={{ marginTop: 12 }}>
        <div className="k">Doctor address</div>
        <AddressBox
          value={docAddr}
          canEdit={canEdit}
          resetKey={`docaddr-${patient.id}-${resetKey}`}
          placeholder="Search for doctor address..."
          onPick={(r) => {
            onFieldChange("doctorAddressEdited", r.address);
            onFieldChange("doctorAddressLat", r.lat);
            onFieldChange("doctorAddressLng", r.lng);
          }}
        />
      </div>
      {canEdit ? (
        <div className="facts" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
          <Inp
            label="Doctor phone"
            type="tel"
            placeholder="(555) 555-5555"
            value={patient.doctorPhoneEdited ?? (patient.doctorPhone ? formatPhone(patient.doctorPhone) : "")}
            onChange={(v) => onFieldChange("doctorPhoneEdited", v)}
          />
          <Inp
            label="Doctor fax"
            placeholder="(555) 555-5555"
            value={patient.doctorFaxEdited ?? patient.doctorFax}
            onChange={(v) => onFieldChange("doctorFaxEdited", v)}
          />
          <Sel
            label="Fax / Parachute"
            value={methodIdx}
            currentLabel={method}
            options={FAX_PARACHUTE_OPTIONS}
            onChange={(i) =>
              i !== null &&
              onFieldChange("faxParachuteEdited", FAX_PARACHUTE_OPTIONS.find((o) => o.index === i)?.label ?? "")
            }
          />
        </div>
      ) : (
        <div className="facts" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
          <F k="Doctor phone" v={patient.doctorPhone ? formatPhone(patient.doctorPhone) : ""} />
          <F k="Doctor fax" v={patient.doctorFax} />
          <F k="Fax / Parachute" v={patient.faxParachute} />
        </div>
      )}
    </section>
  );
}

/* ── Financials ─────────────────────────────────────────────────────────── */

/**
 * ⚠️ Every figure is the board's own column — the 12 the app has always read
 * and `/subscription` shows. His card hardcodes one "Supplies" block; this
 * draws it once per line the patient is served or has figures for, so a
 * sensors-only patient's Sensors figures are not left off (plan §2.4).
 * Lifetime revenue has no column, so it is an em dash, never a guess.
 */
export function FinancialsCard({
  patient,
  orderCount,
  firstOrder,
}: {
  patient: SubPatient;
  /** Orders on the order board, or null while they are being read. */
  orderCount: number | null;
  firstOrder: string;
}) {
  const sub = patient.subscription ?? "";
  const lines: { name: string; rev: string; cost: string; gp: string }[] = [];
  if (subscriptionIncludesSensors(sub) || patient.sensorsRevenue || patient.sensorsCost || patient.sensorsGP)
    lines.push({ name: "Sensors", rev: patient.sensorsRevenue, cost: patient.sensorsCost, gp: patient.sensorsGP });
  if (subscriptionIncludesSupplies(sub) || patient.suppliesRevenue || patient.suppliesCost || patient.suppliesGP)
    lines.push({ name: "Supplies", rev: patient.suppliesRevenue, cost: patient.suppliesCost, gp: patient.suppliesGP });

  return (
    <section className="card pad">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Financials
      </div>
      {lines.map((l, i) => (
        <div key={l.name} style={i ? { marginTop: 12 } : undefined}>
          <div className="xs muted" style={{ marginBottom: 6 }}>
            {l.name}
          </div>
          <div className="facts" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <F k="Revenue" v={money(l.rev)} />
            <F k="Cost" v={money(l.cost)} />
            <F k="GP" v={money(l.gp)} />
          </div>
        </div>
      ))}
      <div className={`facts${lines.length ? " split" : ""}`} style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <F k="Total revenue" v={money(patient.totalRevenue)} />
        <F k="Total cost" v={money(patient.totalCost)} />
        <F k="Total GP" v={money(patient.totalGP)} />
      </div>
      <div className="facts" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 12 }}>
        <F k="Shipping" v={money(patient.shippingCost)} />
        <F k="ARR" v={money(patient.arr)} />
        <F k="ARP" v={money(patient.arp)} />
      </div>
      <div className="facts split" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <F k="Lifetime revenue" v="" />
        <F
          k="Total orders"
          v={
            orderCount === null ? (
              ""
            ) : (
              <>
                {orderCount}
                {firstOrder && <span className="xs muted"> since {firstOrder}</span>}
              </>
            )
          }
        />
      </div>
    </section>
  );
}

/* ── Subscription notes ─────────────────────────────────────────────────── */

/**
 * His notes card — composer, Add note, newest first.
 *
 * ⚠️ **The same writer as the right column's Recent notes**
 * (`appendNoteToRecord`, §5.39c3): it re-reads the column before appending, asks
 * the live board about the 2,000 cap and stamps the time and initials. Two
 * boxes on one screen writing one column through ONE writer — Josh kept the
 * right column's box (2026-09-24). The page lays the returned body over the
 * record, so both lists show the note at once.
 * ⚠️ Not gated on Edit profile: a running case history is not the profile
 * (§5.39h), exactly as on `/subscription` and the right column.
 */
export function SubscriptionNotesCard({
  item,
  phone,
  onAppended,
}: {
  item: DossierItem;
  phone: string;
  onAppended: (itemId: string, notes: string) => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const entries = useMemo(() => noteEntries(item.notes), [item.notes]);
  const stage = noteStageLabel(item);
  // A draft here blocks the Send until it is added or cleared (§9).
  usePendingNoteReport(`patient-subnotes:${item.itemId}`, text);

  async function add() {
    const body = text.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      const next = await appendNoteToRecord({
        boardId: item.boardId,
        itemId: item.itemId,
        columnId: item.notesColId,
        columnType: item.notesColType,
        text: body,
        stage,
        phone,
      });
      onAppended(item.itemId, next);
      setText("");
      toast.success("Note added");
    } catch (e) {
      // ⚠️ The draft is KEPT — the 2,000-character refusal is the one error a
      // rep must read and act on (§10).
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card pad subnotes">
      <div className="section-h" style={{ marginBottom: 10 }}>
        <div>
          <span className="eyebrow">Subscription notes</span>
          <div className="xs muted">
            The running log on this patient&apos;s Subscription-board item (Subscription Patient Notes) · newest
            first · a note posts as soon as you add it, stamped with the time and your initials
          </div>
        </div>
        <span className="chip">
          {entries.length} note{entries.length === 1 ? "" : "s"}
        </span>
      </div>
      {item.notesColId && (
        <div className="row" style={{ alignItems: "flex-start", gap: 8, marginBottom: 12 }}>
          <textarea
            className="input grow"
            rows={2}
            value={text}
            disabled={saving}
            aria-label="Add a subscription note"
            placeholder="Add a note — e.g. spoke with patient, sets backordered, swapped to AutoSoft XC and texted the ETA"
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="button"
            className="btn primary sm"
            disabled={!text.trim() || saving}
            onClick={() => void add()}
          >
            <Send style={{ width: 13, height: 13 }} /> {saving ? "Adding…" : "Add note"}
          </button>
        </div>
      )}
      <div className="notes">
        {entries.length ? (
          entries.map((n, i) => (
            // Keyed by position: two identical lines are legitimate.
            <div className="note" key={i}>
              {(n.when || n.who) && <div className="who">{[n.when, n.who].filter(Boolean).join(" · ")}</div>}
              <div className="nm-body">{n.text}</div>
            </div>
          ))
        ) : (
          <div className="note muted">
            <i>No notes on this item yet.</i>
          </div>
        )}
      </div>
    </section>
  );
}
