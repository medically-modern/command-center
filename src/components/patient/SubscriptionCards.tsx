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
import { payerAllows75Days } from "@/lib/welcomeCall/payerRules";
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
  hint?: string | null;
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
      {hint && <span className="xs muted">{hint}</span>}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: "text" | "number" | "date" | "tel";
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="ef">
      <span className="k">{label}</span>
      <input
        className={`input sm${mono ? " mono" : ""}`}
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
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

/** The status classes his markup names — good / warn / bad. */
function authCls(status: string): string {
  if (/valid|no auth/i.test(status)) return "good";
  if (/expir|denied|required/i.test(status)) return "warn";
  return "";
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
      <div className="xs muted" style={{ marginTop: 8 }}>
        {canEdit
          ? "Who we reach, and on which number · saves with Send to Monday · Can text is answered on the Welcome Call page"
          : `Read-only — editing the profile isn't enabled for ${readOnlyName}`}
      </div>
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

/* ── Medical necessity & auth ───────────────────────────────────────────── */

function authLine(status: string, end: string): ReactNode {
  if (!status) return "";
  return (
    <>
      {status}
      {end && <div className="xs muted">to {usDate(end)}</div>}
    </>
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
        files.map((f) => (
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
        ))
      )}
    </div>
  );

  return (
    <section className="card pad">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Medical necessity &amp; auth
      </div>
      <div className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
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
        <div className="fact">
          <div className="k">Files</div>
          {filesNode}
        </div>
        <F k="Diagnosis" v={patient.diagnosis} />
        <F
          k="Sensors auth"
          v={authLine(patient.sensorsAuthStatus, patient.sensorsEndAuth)}
          cls={authCls(patient.sensorsAuthStatus)}
        />
        <F
          k="Supplies auth"
          v={authLine(patient.suppliesAuthStatus, patient.suppliesEndAuth)}
          cls={authCls(patient.suppliesAuthStatus)}
        />
        <F
          k="Infusion set auth ID"
          v={patient.infusionSetAuthId ? <span className="mono">{patient.infusionSetAuthId}</span> : ""}
        />
        <F
          k="Cartridge auth ID"
          v={patient.cartridgeAuthId ? <span className="mono">{patient.cartridgeAuthId}</span> : ""}
        />
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
            <div className="k">Visit date</div>
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

/** His `reorderLine` — the chip, not the whole card (§5.46c keeps the rest on the Orders tab). */
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
    <div className="rf">
      {form.link && (
        <a className="plink" href={form.link} target="_blank" rel="noreferrer" style={{ whiteSpace: "nowrap" }}>
          Open form
        </a>
      )}
      {form.textSent && <span className="xs muted">texted {form.textSent}</span>}
      <span className={`chip${answered && tone ? ` ${tone}` : answered ? "" : " amber"}`}>
        {answered ? form.orderResponse : "No response yet"}
      </span>
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
}: {
  patient: SubPatient;
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

  /* ⚠️ 75-Days is Aetna-only — the app's existing payer rule for this very
     cadence (`payerRules.payerAllows75Days`, §5.31). A value the board already
     holds is always shown. */
  const freqIdx =
    extrasEdit.orderFrequencyIndex !== undefined ? extrasEdit.orderFrequencyIndex : extras?.orderFrequencyIndex ?? null;
  const freqOpts = (frequencyOpts.options[EXTRA_COL.orderFrequency] ?? []).filter(
    (o) => !/^75/.test(o.label) || payerAllows75Days(patient.primaryInsurance) || o.index === freqIdx,
  );
  const freqOff = !frequencyOpts.ready || !extras;
  const cgmQty = extrasEdit.cgmQty ?? extras?.cgmQty ?? "";
  const cartQty = extrasEdit.cartridgeQty ?? extras?.cartridgeQty ?? "";

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
          hint={!ro && frequencyOpts.error ? "Couldn't load options from Monday" : null}
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
          label="Cartridges qty"
          type="number"
          value={cartQty}
          disabled={ro || !extras}
          onChange={(v) => onExtras({ cartridgeQty: v })}
        />
        <Sel
          label="Infusion set 1"
          value={patient.infusionSet1Index}
          currentLabel={patient.infusionSet1}
          options={inf1}
          disabled={ro || infOff}
          hint={ro ? null : infHint}
          onChange={(i) => setStatus("infusionSet1Index", "infusionSet1", inf1, i)}
        />
        <Inp
          label="Inf. qty 1"
          type="number"
          value={patient.infQty1}
          disabled={ro}
          onChange={(v) => onFieldChange("infQty1", v)}
        />
        <Sel
          label="Infusion set 2"
          value={patient.infusionSet2Index}
          currentLabel={patient.infusionSet2}
          options={inf2}
          disabled={ro || infOff}
          onChange={(i) => setStatus("infusionSet2Index", "infusionSet2", inf2, i)}
        />
        <Inp
          label="Inf. qty 2"
          type="number"
          value={patient.infQty2}
          disabled={ro}
          onChange={(v) => onFieldChange("infQty2", v)}
        />
      </div>
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
