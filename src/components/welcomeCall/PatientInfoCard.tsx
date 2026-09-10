import { useState } from "react";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { SECONDARY_INSURANCE_OPTIONS, PRIMARY_INSURANCE_OPTIONS, SERVING_OPTIONS, formatPhone, formatDateMDY, isCrossSell, effectiveNextOrder } from "@/lib/welcomeCall/workflow";
import { authWindow, secondaryAsk, secondaryAskNote, isFirstTimePumpUser } from "@/lib/welcomeCall/workflow";
import { expectedPos } from "@/lib/shared/pos";
import { servedOrderLines } from "@/lib/shared/servingLines";
import { resolveLastBill } from "@/lib/shared/lastBillDate";
import { phoneRejectionReason } from "@/lib/shared/phoneCell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CalendarDays, CheckCircle2, Pencil, Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DoctorNotesPanel } from "@/components/shared/DoctorNotesPanel";
import { CallHistoryButton } from "@/components/shared/CallHistoryButton";
import { WelcomeCallProfileStatus } from "@/components/shared/PatientProfileStatus";
import { PatientActivityCard } from "@/components/welcomeCall/PatientActivityCard";

interface Props {
  patient: Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
  onSaveSecondaryInsurance?: (label: string, index: number) => Promise<void>;
}

const dash = (v?: string) => (v && v.trim() ? v : "—");

/** The MN bar's label type, verbatim — `SendRequestHeaderCard`'s `Eyebrow`.
 *  Kept as its own component rather than a shared import because the two files
 *  are the only users and a shared one would invite drift into a third look. */
function HeaderEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

/** A call-shaping flag beside the patient's name. */
function HeaderChip({ tone, children }: { tone: "sky" | "amber"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider border",
        tone === "sky"
          ? "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800"
          : "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
      )}
    >
      {children}
    </span>
  );
}

/** Prefix a raw value with $ for display (e.g. "1500" → "$1,500"). No-op if empty. */
function fmtDollar(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  if (isNaN(n)) return raw; // fallback to original if unparseable
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Display coinsurance: convert decimal (e.g. "0.2") to "20%", or append % if already whole. */
function fmtCoinsurance(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.replace(/[%,\s]/g, "");
  const n = parseFloat(cleaned);
  if (isNaN(n)) return raw;
  const pct = n < 1 ? n * 100 : n;
  return `${pct}%`;
}

/**
 * One product's auth line: the status, plus the validity window under it
 * (MM-1080). The status on its own is what caused the reported confusion — an
 * auth that failed, went to the retry queue and was later approved reads
 * "Auth Valid" with nothing saying through when, and the bot writes no note.
 *
 * The window is colour-coded only when it needs attention: an expired auth is
 * positive evidence the order can't ship, and one lapsing inside a month is
 * worth saying out loud while the rep still has the patient on the phone.
 */
function AuthField({
  label,
  status,
  start,
  end,
}: {
  label: string;
  status: string;
  start: string;
  end: string;
}) {
  if (!status && !end) return null;
  const w = authWindow(start, end);
  const tone =
    w.state === "expired"
      ? "text-red-600 dark:text-red-400"
      : w.state === "expiring"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-sm font-medium" title={status}>
        {status || "—"}
      </p>
      {w.text && (
        <p className={cn("text-[11px] leading-tight", tone)}>
          {w.state === "expired"
            ? `Expired ${w.text}`
            : w.state === "expiring"
              ? `${w.text} · ${w.daysLeft === 0 ? "ends today" : `${w.daysLeft}d left`}`
              : w.text}
        </p>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-sm font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

/** Primary Insurance — pencil icon toggles to dropdown */
function EditablePrimaryInsurance({
  value,
  editedIndex,
  currentIndex,
  onFieldChange,
}: {
  value: string;
  editedIndex: number | null;
  currentIndex: number | null;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const displayValue = editedIndex !== null
    ? PRIMARY_INSURANCE_OPTIONS.find((o) => o.index === editedIndex)?.label ?? value
    : value;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Primary Insurance
      </p>
      {editing && onFieldChange ? (
        <Select
          value={
            editedIndex !== null
              ? String(editedIndex)
              : currentIndex !== null
                ? String(currentIndex)
                : ""
          }
          onValueChange={(v) => {
            const option = PRIMARY_INSURANCE_OPTIONS.find((o) => String(o.index) === v);
            if (option) {
              onFieldChange("primaryInsuranceEdited", option.label);
              onFieldChange("primaryInsuranceIndexEdited" as keyof Patient, option.index);
            }
            setEditing(false);
          }}
        >
          <SelectTrigger className="h-8 text-sm" autoFocus>
            <SelectValue placeholder="Select insurance" />
          </SelectTrigger>
          <SelectContent>
            {PRIMARY_INSURANCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.index} value={String(opt.index)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium" title={displayValue}>{displayValue || "—"}</p>
          {onFieldChange && (
            <button
              onClick={() => setEditing(true)}
              className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
              title="Edit Primary Insurance"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      {editedIndex !== null && (
        <p className="text-[10px] text-amber-600 mt-0.5">edited</p>
      )}
    </div>
  );
}

/** Member ID 1 — pencil icon toggles to text input */
function EditableMemberId1({
  value,
  editedValue,
  onFieldChange,
}: {
  value: string;
  editedValue: string | null;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const displayValue = editedValue ?? value;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Member ID 1
      </p>
      {editing && onFieldChange ? (
        <Input
          className="h-8 text-sm"
          value={editedValue ?? value}
          onChange={(e) => onFieldChange("memberId1Edited", e.target.value)}
          onBlur={() => setEditing(false)}
          autoFocus
          placeholder="Enter member ID"
        />
      ) : (
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium" title={displayValue}>{displayValue || "—"}</p>
          {onFieldChange && (
            <button
              onClick={() => setEditing(true)}
              className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
              title="Edit Member ID 1"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      {editedValue !== null && editedValue !== "" && editedValue !== value && (
        <p className="text-[10px] text-amber-600 mt-0.5">edited</p>
      )}
    </div>
  );
}

/** Add 90 days to a YYYY-MM-DD date string and return formatted + whether it's past. */
function addDaysAndFormat(dateStr: string, days: number): { formatted: string; isPast: boolean } | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  d.setDate(d.getDate() + days);
  const formatted = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { formatted, isPast: d < today };
}

function SosField({ label, dateStr }: { label: string; dateStr: string }) {
  const result = addDaysAndFormat(dateStr, 90);
  if (!result) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className={`text-sm font-medium ${result.isPast ? "text-red-600" : "text-green-600"}`}>
        {result.formatted}
      </p>
    </div>
  );
}

function OrderDateField({ label, dateStr }: { label: string; dateStr: string }) {
  if (!dateStr) return null;
  const formatted = formatDateMDY(dateStr);
  if (!formatted) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-sm font-medium">
        {formatted}
      </p>
    </div>
  );
}

function SmartNextOrderField({
  label,
  lastBillDates,
  mondayDate,
  editedDate,
  editedField,
  onFieldChange,
}: {
  label: string;
  lastBillDates: string[];
  mondayDate: string;
  editedDate: string | null;
  editedField: keyof Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}) {
  const hasLastBill = lastBillDates.some(Boolean);
  // Single source of truth with the send path: effectiveNextOrder is exactly
  // what sendPatientToMonday writes, so the date on screen — including the
  // computed default — is what lands on the board, no edit needed.
  const effectiveDate = effectiveNextOrder(editedDate, mondayDate, lastBillDates);

  const match = effectiveDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let isPast = false;
  let formatted = effectiveDate;
  if (match) {
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    isPast = d <= today;
    formatted = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  }

  return (
    <div className={cn(
      "rounded-lg border p-3 space-y-2",
      isPast ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50",
    )}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <Input
        type="date"
        className="h-8 text-sm"
        value={editedDate ?? effectiveDate}
        onChange={(e) => onFieldChange?.(editedField, e.target.value)}
      />
      {isPast ? (
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
          <p className="text-[11px] font-medium text-green-700">
            Past bill date no longer an issue
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-red-700">
            SOS — patient has to wait to get supplies till this date
          </p>
        </div>
      )}
      {!hasLastBill && (
        <p className="text-[10px] text-muted-foreground italic">No last bill date — defaulted to today</p>
      )}
    </div>
  );
}

function NextOrderDateField({
  label,
  dateStr,
  editedDateStr,
  editedField,
  onFieldChange,
}: {
  label: string;
  dateStr: string;
  editedDateStr?: string | null;
  editedField?: keyof Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const effectiveDate = editedDateStr ?? dateStr;
  if (!effectiveDate) return null;
  const match = effectiveDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isReady = d <= today;
  const formatted = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const isEdited = editedDateStr !== null && editedDateStr !== undefined && editedDateStr !== dateStr;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      {editing && editedField && onFieldChange ? (
        <Input
          type="date"
          className="h-8 text-sm w-44"
          value={editedDateStr ?? dateStr}
          onChange={(e) => onFieldChange(editedField, e.target.value)}
          onBlur={() => setEditing(false)}
          autoFocus
        />
      ) : (
        <div className="flex items-center gap-1.5">
          <p className={`text-sm font-medium ${isReady ? "text-green-600" : "text-red-600"}`}>
            {formatted}
          </p>
          {editedField && onFieldChange && (
            <button
              onClick={() => setEditing(true)}
              className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
              title={`Edit ${label}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      {isEdited && (
        <p className="text-[10px] text-amber-600 mt-0.5">edited</p>
      )}
    </div>
  );
}

/* ⚠️ `PhoneField` was DELETED on 2026-09-10 (§5.31d). Primary Phone is owned by
   the phone-slots section now — slot 1, starred — and two controls writing one
   column is how they disagree, which is exactly why the Secondary Insurance
   select was pulled out of this card the day before. Editing the number here
   would also have bypassed the rule that clears Can Text when the digits
   change, leaving a "yes, this takes texts" answer standing against a number
   nobody asked about. */

export function PatientInfoCard({ patient, onFieldChange, onSaveSecondaryInsurance }: Props) {
  const hasSecondaryInsurance = !!patient.secondaryInsurance && patient.secondaryInsurance !== "";
  const hasMemberId2 = !!patient.memberId2 && patient.memberId2 !== "";

  // Medicare A&B warnings when secondary is empty
  const isMedicareAB = patient.primaryInsurance === "Medicare A&B";
  const secondaryMissing = !hasSecondaryInsurance && !patient.secondaryInsuranceEdited;
  const showMedicareSecondaryWarning = isMedicareAB && secondaryMissing;
  const qmbYes = (patient.stediQmb || "").trim().toUpperCase() === "YES";
  const showQmbWarning = isMedicareAB && qmbYes && secondaryMissing;

  return (
    <div className="space-y-4">
      {/* ─── Patient banner ───
          Brandon, 2026-09-09: make this read like the medical-necessity top
          bar. The reference is `components/masheke/SendRequestHeaderCard` —
          same card shell (rounded-2xl, 4px teal top border), same type ramp
          (`Eyebrow` at text-sm uppercase, name at text-3xl font-black, values
          at text-lg font-semibold) and the same three info-group cards. The
          Lovable mockup supplied the CONTENT and its order; where the two
          disagreed on looks, the MN bar won. */}
      <section
        className="rounded-2xl bg-card border p-6 shadow-sm border-t-4"
        style={{ borderColor: "var(--mm-card-border)", borderTopColor: "var(--mm-teal)" }}
      >
        <HeaderEyebrow>Patient</HeaderEyebrow>
        {/* ⚠️ NO phone / text / call controls in this banner — Brandon,
            2026-09-09: "get rid of the phone text and calls in the top banner
            though, will have that lower down". They live in
            `PatientActivityCard` below, whose header is where a rep presses to
            call. Editing the number moved with them.
            Keeping them here also caused a narrow-screen overflow (Greptile,
            PR #55): the MN bar this copies puts a small pill on the right of
            this row, not a fixed-width input and two buttons. `flex-wrap`
            stays anyway — a long name plus status chips can still need it. */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <h1 className="text-3xl font-black tracking-tight break-words">{patient.name}</h1>
            <WelcomeCallProfileStatus patient={patient} />
            {/* Two call-shaping prompts that already existed in workflow.ts and
                had nowhere to render. Neither is a gate — `isFirstTimePumpUser`
                is explicitly "a prompt, never a gate", and cross-sell is what
                the rep has to raise on the call. */}
            {isFirstTimePumpUser({
              serving: patient.servingEdited ?? patient.serving,
              pumpQty: patient.pumpQty,
              ipLastBillDate: patient.ipLastBillDate,
              medicarePriorPumpDate: patient.medicarePriorPumpDate,
            }) && <HeaderChip tone="sky">First-time pump user</HeaderChip>}
            {isCrossSell({
              serving: patient.servingEdited ?? patient.serving,
              requestType: patient.requestType,
            }) && <HeaderChip tone="amber">Cross-sell</HeaderChip>}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-4 flex-wrap">
          <span className="text-lg text-muted-foreground">DOB {dash(patient.dob)}</span>
          {patient.referralReceivedDate && (
            <span className="text-lg text-muted-foreground">
              Intake {formatDateMDY(patient.referralReceivedDate)}
            </span>
          )}
        </div>

        {/* Three info groups, mirroring the MN bar's shape. These four facts are
            what the mockup puts under the name; Serving stays EDITABLE here
            because correcting it is the fix for the §5.22 pump/serving class of
            error, and this is where the rep is looking. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <div className="border rounded-xl bg-muted/30 p-4" style={{ borderColor: "var(--mm-card-border)" }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <HeaderEyebrow>Request</HeaderEyebrow>
                <div className="mt-1 text-lg font-semibold">{dash(patient.requestType)}</div>
              </div>
              <div>
                <HeaderEyebrow>Serving</HeaderEyebrow>
                <Select
                  value={
                    patient.servingIndexEdited !== null
                      ? String(patient.servingIndexEdited)
                      : patient.servingIndex !== null
                        ? String(patient.servingIndex)
                        : ""
                  }
                  onValueChange={(value) => {
                    const option = SERVING_OPTIONS.find((o) => String(o.index) === value);
                    if (onFieldChange && option) {
                      onFieldChange("servingEdited", option.label);
                      onFieldChange("servingIndexEdited" as keyof Patient, option.index);
                    }
                  }}
                >
                  <SelectTrigger className="h-9 mt-1 text-base font-semibold">
                    <SelectValue placeholder="Select serving" />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVING_OPTIONS.map((opt) => (
                      <SelectItem key={opt.index} value={String(opt.index)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="border rounded-xl bg-muted/30 p-4" style={{ borderColor: "var(--mm-card-border)" }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <HeaderEyebrow>Referral Source</HeaderEyebrow>
                <div className="mt-1 text-lg font-semibold break-words">{dash(patient.referralSource)}</div>
              </div>
              <div>
                <HeaderEyebrow>Doctor</HeaderEyebrow>
                <div className="mt-1 text-lg font-semibold break-words">{dash(patient.doctorName)}</div>
              </div>
            </div>
          </div>
          <div className="border rounded-xl bg-muted/30 p-4" style={{ borderColor: "var(--mm-card-border)" }}>
            <HeaderEyebrow>Primary Insurance</HeaderEyebrow>
            <div className="mt-1 text-lg font-semibold break-words">{dash(patient.primaryInsurance)}</div>
          </div>
        </div>
      </section>

      {/* Brandon: "put text and call history on top like corey/katie had it".
          Directly under the banner and above everything else, with the Call and
          Text buttons in its header — the "lower down" the banner note points
          at. Collapsed by default and fetches nothing until opened. */}
      <PatientActivityCard phone={patient.phoneEdited ?? patient.phone} />

      {/* Row 1: Referral/Product + SOS + Insurance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Referral Source, Request Type and Serving moved UP into the banner
            (they are four of the facts the mockup puts under the name), so this
            card is now the doctor block it always half was. The Cross Sell pill
            moved with Serving and is a header chip. */}
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Doctor Name" value={patient.doctorName} />
            <Field label="Doctor NPI" value={patient.doctorNpi} />
          </div>

          {/* Doctor-level notes from the Doctor Database */}
          {patient.doctorNpi && (
            <div className="mt-3">
              <DoctorNotesPanel doctorNpi={patient.doctorNpi} doctorName={patient.doctorName} compact />
            </div>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Last Bill Dates</p>
          <div className="grid grid-cols-1 gap-3">
            <OrderDateField label="CGM Last Bill Date" dateStr={patient.cgmLastBillDate} />
            <OrderDateField label="Sensors Last Bill Date" dateStr={patient.sensorsLastBillDate} />
            <OrderDateField label="IP Last Bill Date" dateStr={patient.ipLastBillDate} />
            <OrderDateField label="Infusion Set Last Bill Date" dateStr={patient.infusionSetLastBillDate} />
            <OrderDateField label="Cartridge Last Bill Date" dateStr={patient.cartridgeLastBillDate} />
          </div>
        </Card>

        {/* ⚠️ The Secondary Insurance select and Member ID 2 input LEFT this
            card on 2026-09-09. Brandon's Insurance block (form section 5) is
            now the single place secondary coverage is answered — one question
            with type rules — and two controls writing the same two columns is
            how they end up disagreeing. The Medicare / QMB prompts moved with
            them, to sit beside the question they are prompting. */}
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary Insurance" value={patient.primaryInsurance} />
            <Field label="Member ID 1" value={patient.memberId1} />
          </div>
        </Card>
      </div>

      {/* Row 2: Benefits + Auth Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Benefits</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deductible" value={fmtDollar(patient.deductible)} />
            <Field label="Deductible Remaining" value={fmtDollar(patient.deductibleRemaining)} />
            <Field label="Coinsurance %" value={fmtCoinsurance(patient.stediCoinsurance)} />
            <Field label="OOP Max Remaining" value={fmtDollar(patient.oopMaxRemaining)} />
          </div>
          {!patient.deductible && !patient.deductibleRemaining && !patient.stediCoinsurance && !patient.oopMaxRemaining && (
            <p className="text-sm text-muted-foreground italic">No benefits data yet.</p>
          )}
        </Card>

        {/* ⚠️ The Auth Results card left here too. Brandon's Authorization
            block (form section 6) replaces it with one chip per SERVED product
            — "a supplies-only patient sees two chips, not five" — and collapses
            to a single sentence when nothing needs attention. */}
      </div>
    </div>
  );
}

/**
 * Next Order Dates — Brandon, 2026-09-09: the dates belong "under the cards, in
 * this section", so this now renders inside Subscription & Logistics rather
 * than as a standalone card on the page.
 *
 * ⚠️ **Rows for lines not in Serving don't render** (his words). It used to draw
 * all three unconditionally, which asked a rep to date a pump reorder for a
 * patient who owns their pump. `servedOrderLines` is the same rule the send and
 * the Final Confirm checks use, so the rows and what actually ships agree.
 * Each row carries its read-only Last Bill Date beside the picker.
 */
export function NextOrderDatesCard({
  patient,
  onFieldChange,
}: {
  patient: Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}) {
  const served = servedOrderLines({
    serving: patient.servingEdited ?? patient.serving,
    subscriptionType: patient.subscriptionType,
    cgmType: patient.cgmType,
    infusionSet1: patient.infusionSet1,
    infusionSet2: patient.infusionSet2,
    pumpQty: patient.pumpQty,
    monitorQty: patient.monitorQty,
    qtyInf1: patient.qtyInf1,
    qtyInf2: patient.qtyInf2,
  });

  // ⚠️ Each product's last bill date lives in EITHER of two columns and the
  // legacy one is blank for most billed patients — see
  // shared/lastBillDate.ts. Resolve once here so the "Last Bill Date" a rep
  // reads and the date `computeNextOrder` defaults from are the same value,
  // and so both agree with what `mondayWrite` writes on send.
  const monitorLastBill = resolveLastBill(patient.sosLastBillMonitor, patient.cgmLastBillDate);
  const sensorsLastBill = resolveLastBill(patient.sosLastBillSensors, patient.sensorsLastBillDate);
  const ipLastBill = resolveLastBill(patient.sosLastBillIp, patient.ipLastBillDate);
  const infusionSetLastBill = resolveLastBill(patient.sosLastBillInfusionSet, patient.infusionSetLastBillDate);
  const cartridgeLastBill = resolveLastBill(patient.sosLastBillCartridge, patient.cartridgeLastBillDate);

  const rows = [
    served.sensors && {
      key: "sensors",
      label: "Sensors",
      lastBill: sensorsLastBill || monitorLastBill,
      lastBillDates: [sensorsLastBill, monitorLastBill],
      mondayDate: patient.sensorsNextOrderDate,
      editedDate: patient.sensorsNextOrderDateEdited,
      editedField: "sensorsNextOrderDateEdited" as keyof Patient,
    },
    served.insulinPump && {
      key: "pump",
      label: "Insulin Pump",
      lastBill: ipLastBill,
      lastBillDates: [ipLastBill],
      mondayDate: patient.ipNextOrderDate,
      editedDate: patient.ipNextOrderDateEdited,
      editedField: "ipNextOrderDateEdited" as keyof Patient,
    },
    served.supplies && {
      key: "supplies",
      label: "Supplies",
      // Brandon: the Supplies row shows the LATER of infusion set / cartridge —
      // the reorder is driven by whichever ran out most recently.
      lastBill:
        [infusionSetLastBill, cartridgeLastBill]
          .filter(Boolean)
          .sort()
          .pop() ?? "",
      lastBillDates: [infusionSetLastBill, cartridgeLastBill],
      mondayDate: patient.suppliesNextOrderDate,
      editedDate: patient.suppliesNextOrderDateEdited,
      editedField: "suppliesNextOrderDateEdited" as keyof Patient,
    },
  ].filter(Boolean) as {
    key: string;
    label: string;
    lastBill: string;
    lastBillDates: string[];
    mondayDate: string;
    editedDate: string | null;
    editedField: keyof Patient;
  }[];

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing in Serving yet, so there are no order dates to set.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          <p className="text-sm font-semibold pt-1">{r.label}</p>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Last Bill Date
            </p>
            <p
              className="text-sm font-medium"
              title={
                r.key === "supplies"
                  ? `Infusion set ${infusionSetLastBill || "—"} · Cartridge ${cartridgeLastBill || "—"}`
                  : undefined
              }
            >
              {r.lastBill || "—"}
            </p>
          </div>
          <SmartNextOrderField
            label="Next Order Date"
            lastBillDates={r.lastBillDates}
            mondayDate={r.mondayDate}
            editedDate={r.editedDate}
            editedField={r.editedField}
            onFieldChange={onFieldChange}
          />
        </div>
      ))}
    </div>
  );
}
