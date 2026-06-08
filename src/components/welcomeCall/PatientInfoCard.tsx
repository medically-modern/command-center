import { useEffect, useState } from "react";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { SECONDARY_INSURANCE_OPTIONS, PRIMARY_INSURANCE_OPTIONS, SERVING_OPTIONS, formatPhone, formatDateMDY, isCrossSell } from "@/lib/welcomeCall/workflow";
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

interface Props {
  patient: Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
  onSavePhone?: (phone: string) => Promise<void>;
  onSaveSecondaryInsurance?: (label: string, index: number) => Promise<void>;
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

/** Compute next order date from last bill dates: latest bill + 90 days, or today if none. */
function computeNextOrder(lastBillDates: string[]): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const dates = lastBillDates
    .filter(Boolean)
    .map((d) => {
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    })
    .filter((d): d is Date => d !== null);

  if (dates.length === 0) return todayStr;

  // Use the latest last bill date
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  latest.setDate(latest.getDate() + 90);
  return latest.toISOString().slice(0, 10);
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
  const computed = computeNextOrder(lastBillDates);
  const hasLastBill = lastBillDates.some(Boolean);
  // Priority: edited > Monday value > computed
  const effectiveDate = editedDate ?? (mondayDate || computed);

  // Always pre-populate the edited field with the computed value on first
  // render: last bill + 90 days if a bill date exists, otherwise today.
  // This ensures empty last-bill products default to today's date.
  useEffect(() => {
    if (editedDate === null && onFieldChange) {
      onFieldChange(editedField, computed);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

function PhoneField({
  phone,
  phoneEdited,
  onFieldChange,
  onSavePhone,
}: {
  phone: string;
  phoneEdited: string | null;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
  onSavePhone?: (phone: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const displayPhone = phoneEdited ?? phone;

  if (!phone && !phoneEdited) return null;

  const handleSave = async () => {
    const val = phoneEdited ?? phone;
    if (!val || !onSavePhone) return;
    setSaving(true);
    try {
      await onSavePhone(val);
      toast.success(`Phone updated to ${formatPhone(val)}`);
      setEditing(false);
    } catch (e) {
      toast.error("Failed to update phone", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    onFieldChange?.("phoneEdited", null);
    setEditing(false);
  };

  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
        Phone
      </p>
      {editing ? (
        <div className="flex items-center justify-end gap-1.5">
          <Input
            className="h-9 text-sm font-semibold w-44"
            value={phoneEdited ?? phone}
            onChange={(e) => onFieldChange?.("phoneEdited", e.target.value)}
            autoFocus
            placeholder="(555) 555-5555"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700 border border-emerald-300 transition-colors disabled:opacity-50"
            title="Save phone to Monday"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-1.5">
          <a href={`tel:${displayPhone}`} className="text-lg font-semibold text-primary hover:underline">
            {formatPhone(displayPhone)}
          </a>
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Edit phone number"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function PatientInfoCard({ patient, onFieldChange, onSavePhone, onSaveSecondaryInsurance }: Props) {
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
      {/* Patient name + DOB + phone + intake date */}
      <Card className="p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Patient Name
          </p>
          <p className="text-lg font-semibold">{patient.name}</p>
        </div>

        {patient.dob && (
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              DOB
            </p>
            <p className="text-lg font-semibold">{patient.dob}</p>
          </div>
        )}

        {patient.referralReceivedDate && (
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Intake Date
            </p>
            <p className="text-lg font-semibold">{formatDateMDY(patient.referralReceivedDate)}</p>
          </div>
        )}

        <PhoneField
          phone={patient.phone}
          phoneEdited={patient.phoneEdited}
          onFieldChange={onFieldChange}
          onSavePhone={onSavePhone}
        />
      </Card>

      {/* Row 1: Referral/Product + SOS + Insurance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Referral Source" value={patient.referralSource} />
            <Field label="Doctor Name" value={patient.doctorName} />
            <Field label="Request Type" value={patient.requestType} />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Serving
              </p>
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
                <SelectTrigger className="h-8 text-sm">
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
              {isCrossSell({ serving: patient.servingEdited ?? patient.serving, requestType: patient.requestType }) && (
                <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border border-amber-300 mt-1">
                  Cross Sell
                </span>
              )}
            </div>
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

        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Primary Insurance — read-only */}
            <Field label="Primary Insurance" value={patient.primaryInsurance} />

            {/* Member ID 1 — read-only */}
            <Field label="Member ID 1" value={patient.memberId1} />

            {/* Secondary Insurance — always editable dropdown */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Secondary Insurance
              </p>
              <Select
                value={
                  patient.secondaryInsuranceEdited !== null
                    ? String(
                        SECONDARY_INSURANCE_OPTIONS.find(
                          (o) => o.label === patient.secondaryInsuranceEdited
                        )?.index ?? ""
                      )
                    : hasSecondaryInsurance
                      ? String(
                          SECONDARY_INSURANCE_OPTIONS.find(
                            (o) => o.label === patient.secondaryInsurance
                          )?.index ?? ""
                        )
                      : ""
                }
                onValueChange={(value) => {
                  const option = SECONDARY_INSURANCE_OPTIONS.find(
                    (o) => String(o.index) === value
                  );
                  if (option) {
                    onFieldChange?.("secondaryInsuranceEdited", option.label);
                    onFieldChange?.("secondaryInsuranceIndex", option.index);
                  }
                }}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select insurance" />
                </SelectTrigger>
                <SelectContent>
                  {SECONDARY_INSURANCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.index} value={String(opt.index)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showMedicareSecondaryWarning && (
                <p className="text-xs text-red-600 font-semibold mt-1.5">
                  Patient likely has a secondary insurance, ask on welcome call.
                </p>
              )}
              {showQmbWarning && (
                <p className="text-xs text-red-600 font-semibold mt-1">
                  Stedi QMB returned YES — patient very likely has a secondary supplement plan.
                </p>
              )}
            </div>

            {/* Member ID 2 — always editable text input */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Member ID 2
              </p>
              <Input
                className="h-8 text-sm"
                value={patient.memberId2Edited ?? patient.memberId2}
                onChange={(e) => {
                  onFieldChange?.("memberId2Edited", e.target.value);
                }}
                placeholder="Enter member ID"
              />
            </div>
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

        {(patient.cgmAuthResult || patient.sensorsAuthResult || patient.ipAuthResult || patient.infusionSetAuthResult || patient.cartridgeAuthResult) && (
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Auth Results</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="CGM" value={patient.cgmAuthResult} />
              <Field label="Sensors" value={patient.sensorsAuthResult} />
              <Field label="Insulin Pump" value={patient.ipAuthResult} />
              <Field label="Infusion Set" value={patient.infusionSetAuthResult} />
              <Field label="Cartridge" value={patient.cartridgeAuthResult} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Standalone Next Order Dates card — rendered separately in the page layout. */
export function NextOrderDatesCard({
  patient,
  onFieldChange,
}: {
  patient: Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}) {
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3 flex items-center gap-2">
        <CalendarDays className="h-3.5 w-3.5" /> Next Order Dates
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SmartNextOrderField
          label="Sensors Next Order Date"
          lastBillDates={[patient.sensorsLastBillDate, patient.cgmLastBillDate]}
          mondayDate={patient.sensorsNextOrderDate}
          editedDate={patient.sensorsNextOrderDateEdited}
          editedField="sensorsNextOrderDateEdited"
          onFieldChange={onFieldChange}
        />
        <SmartNextOrderField
          label="IP Next Order Date"
          lastBillDates={[patient.ipLastBillDate]}
          mondayDate={patient.ipNextOrderDate}
          editedDate={patient.ipNextOrderDateEdited}
          editedField="ipNextOrderDateEdited"
          onFieldChange={onFieldChange}
        />
        <SmartNextOrderField
          label="Supplies Next Order Date"
          lastBillDates={[patient.infusionSetLastBillDate, patient.cartridgeLastBillDate]}
          mondayDate={patient.suppliesNextOrderDate}
          editedDate={patient.suppliesNextOrderDateEdited}
          editedField="suppliesNextOrderDateEdited"
          onFieldChange={onFieldChange}
        />
      </div>
    </Card>
  );
}
