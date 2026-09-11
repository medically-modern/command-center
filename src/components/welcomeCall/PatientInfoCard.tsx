import type { Patient } from "@/lib/welcomeCall/workflow";
import { SERVING_OPTIONS, formatDateMDY, isCrossSell, effectiveNextOrder } from "@/lib/welcomeCall/workflow";
import { isFirstTimePumpUser } from "@/lib/welcomeCall/workflow";
import { CallScheduledChip } from "@/components/welcomeCall/CallScheduledChip";
import { servedOrderLines } from "@/lib/shared/servingLines";
import { resolveLastBill } from "@/lib/shared/lastBillDate";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

/* ⚠️ `fmtDollar`, `fmtCoinsurance`, `Field`, `AuthField`, `SosField`,
   `OrderDateField`, `EditablePrimaryInsurance`, `EditableMemberId1`,
   `NextOrderDateField` and `addDaysAndFormat` were DELETED on 2026-09-11 with
   the three rows they rendered (see the note further down). Deleted rather
   than left unused, per §5.11: a helper that still compiles is one a later
   edit wires back up, and these drew a benefits/insurance/last-bill block the
   page deliberately no longer has. `SmartNextOrderField` survives — it is what
   `NextOrderDatesCard` renders. */

/** Prefix a raw value with $ for display (e.g. "1500" → "$1,500"). No-op if empty. */
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
            Past bill date clear
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
      {/* ⚠️ "No last bill date — defaulted to today" was removed (Brandon,
          2026-09-11). The DEFAULT is unchanged — `effectiveNextOrder` still
          falls back to today and the send still writes exactly the date shown
          — this only stopped narrating it. */}
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
            {/* Brandon's "call scheduled — date/day/time" chip (§5.31b), read
                from Calendly rather than from the INTAKE mirror that got the
                first attempt reverted. Silent for a patient with nothing
                booked, which is most of them. */}
            <CallScheduledChip email={patient.email} />
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

      {/* ⚠️ THE THREE ROWS UNDER THE ACTIVITY CARD WERE DELETED (Brandon,
          2026-09-11: *"get rid of the next 3 rows … right after ringcentral
          should be the 'to fill in' section"*). They were:
            · Doctor Name / Doctor NPI  (+ the Doctor Database notes panel)
            · Last Bill Dates, all five
            · Primary Insurance / Member ID 1
            · Benefits — deductible, remaining, coinsurance, OOP max
          Nothing was lost, which is why this was safe: each last bill date
          still renders beside its own Next Order Date, primary insurance and
          Member ID 1 repeat read-only in the form's Insurance block, and the
          out-of-pocket figure has its own step there. Do not restore them
          without checking that first — the point of the cut is that the call
          starts at the fill-in section. */}
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
    /* Brandon, 2026-09-11: *"improve format of the order dates section — lots
       of white space — maybe we do columns instead?"*. Each served line was a
       full-width three-part row stacked under the last, which is where the
       space came from. One COLUMN per served line instead, so at most three
       sit side by side and the block is a third of the height. `auto-fit` with
       a minimum rather than a fixed three, because a supplies-only patient has
       one line and it should not stretch across the card. */
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
      {rows.map((r) => (
        <div key={r.key} className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{r.label}</p>
            <p
              className="text-[11px] text-muted-foreground tabular-nums"
              title={
                r.key === "supplies"
                  ? `Infusion set ${infusionSetLastBill || "—"} · Cartridge ${cartridgeLastBill || "—"}`
                  : undefined
              }
            >
              {/* The last bill date keeps its place beside the line it belongs
                  to — it is the input the next order date is computed from. */}
              last bill {r.lastBill || "—"}
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
