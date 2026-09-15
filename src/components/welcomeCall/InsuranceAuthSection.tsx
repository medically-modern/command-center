/**
 * Brandon's "Insurance & Authorization" section (2026-09-09), three blocks.
 *
 * A — Insurance: primary read-only, secondary as ONE question.
 * B — Authorization: read-only chips, one per served product.
 * C — Out of Pocket: shown, calculator button inert (his call).
 */
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Calculator } from "lucide-react";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { OopEstimateCard } from "@/components/welcomeCall/OopEstimateCard";
import type { CallIntake } from "@/lib/welcomeCall/callIntake";
import {
  SECONDARY_TYPES,
  secondaryStateFor,
  secondaryMissing,
  secondaryWrites,
  type SecondaryAnswer,
  type SecondaryType,
} from "@/lib/welcomeCall/secondaryCoverage";
import {
  chipStateLabel,
  servedAuthKeys,
  shortDate,
  summariseAuths,
  type AuthProduct,
} from "@/lib/welcomeCall/authChips";

const LABEL_CLS = "text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1";

function Read({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className={LABEL_CLS}>{label}</p>
      <p className="text-base font-semibold break-words">{value?.trim() || "—"}</p>
    </div>
  );
}

/* ── Block A ───────────────────────────────────────────────────────────── */

export function InsuranceBlock({
  patient,
  onFieldChange,
}: {
  patient: Patient;
  onFieldChange: (field: keyof Patient, value: string | number | boolean | null) => void;
}) {
  /* ⚠️ Unknown needs somewhere to live. It writes NOTHING to Monday (Brandon:
     "patients often don't know"), so with no state at all the click set both
     edited fields to null, the board was re-read, and the control snapped
     straight back to No or Yes — a three-answer question with two working
     answers (Greptile, PR #56).
     ⚠️ It lives on the page OVERLAY, not in this component. A flag held here
     was invisible to `unmetSendRequirements`, which went on reading the column:
     a patient already carrying NY Medicaid showed **Unknown** on screen while
     Advance stayed shut on a CIN the rep had just said nobody knew. Same
     reader for both now (`secondaryStateFor`), and the overlay keys it per
     patient by construction, so it cannot follow a sidebar click. */
  const state = secondaryStateFor(patient);
  const memberId2 = patient.memberId2Edited ?? patient.memberId2;
  const notes = patient.insuranceNotesEdited ?? patient.insuranceNotes ?? "";
  const missing = secondaryMissing({ ...state, memberId2, insuranceNotes: notes });
  const isMedicareAB = (patient.primaryInsuranceEdited ?? patient.primaryInsurance) === "Medicare A&B";
  const qmbYes = (patient.stediQmb || "").trim().toUpperCase() === "YES";

  /** Apply an answer to the board-bound fields. Absent keys leave a column
   *  alone — see `secondaryWrites` for why Unknown writes nothing. */
  const answer = (next: { answer: SecondaryAnswer; type: SecondaryType | null }) => {
    onFieldChange("secondaryUnknown", next.answer === "unknown");
    const w = secondaryWrites(next);
    if (w.secondaryInsurance !== undefined) {
      onFieldChange("secondaryInsuranceEdited", w.secondaryInsurance);
      // The send writes the INDEX, so it has to move with the label. Read off
      // the live column 2026-09-09: None 0 · NY Medicaid 1 · Medicare
      // Supplement 2 · Other 4. (3 is "Done" and is deactivated on the board.)
      const index = { None: 0, "NY Medicaid": 1, "Medicare Supplement": 2, Other: 4 }[
        w.secondaryInsurance
      ];
      onFieldChange("secondaryInsuranceIndex" as keyof Patient, index ?? null);
    }
    if (w.memberId2 !== undefined) onFieldChange("memberId2Edited", w.memberId2);
    // Unknown: nothing is written, and the control simply shows the answer.
    if (next.answer === "unknown") {
      onFieldChange("secondaryInsuranceEdited", null);
      onFieldChange("secondaryInsuranceIndex" as keyof Patient, null);
    }
  };

  return (
    /* Brandon, 2026-09-11: *"insurance, i think we can split into 2 columns for
       primary and secondary, rather than 2 rows (helps save space)"*. The two
       are independent questions, so nothing about the logic moves — only the
       track they sit in. Stacks back to one column under `lg`, where two
       columns of policy detail are narrower than the CIN they have to hold. */
    /* ⚠️ NOT `items-start` (Josh, 2026-09-14: *"let's make member id2 box end
       at same height as primary box - like when ny medicaid is selected"*). The
       two columns stretch to the row height and each card is `flex-1`, so the
       primary card's bottom edge and the secondary panel's bottom edge land on
       the same line whatever either one holds. With `items-start` the secondary
       panel was only as tall as its contents and stopped short. */
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Read-only. Corey: primary isn't confirmed at this stage, so there is
          deliberately no checkbox here.
          ⚠️ Brandon also asked for "date of last stedi check" as the verified-on
          stamp. There is NO such column — not on Welcome Call, not on Profile
          Send Off (checked 2026-09-09; "Stedi Plan Begin Date" is the plan's
          start, and "Run Stedi Eligibility" is a trigger, not a timestamp). A
          date rendered here would be a confidence signal backed by nothing,
          which is worse than its absence (§5.26). */}
      <div className="flex flex-col">
        <p className={LABEL_CLS}>Primary — from the benefits stage</p>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-4 content-start rounded-lg border border-input bg-muted/20 p-4">
          <Read label="Primary Insurance" value={patient.primaryInsurance} />
          <Read label="Plan Name" value={patient.planName} />
          <Read label="Member ID 1" value={patient.memberId1} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
      <div>
        <p className={LABEL_CLS}>Secondary coverage?</p>
        <div className="flex items-center gap-2 flex-wrap">
          {(
            [
              { id: "no", label: "No" },
              { id: "yes", label: "Yes" },
              { id: "unknown", label: "Unknown" },
            ] as { id: SecondaryAnswer; label: string }[]
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => answer({ answer: o.id, type: o.id === "yes" ? state.type : null })}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold border transition-colors",
                state.answer === o.id
                  ? "bg-[color:var(--mm-teal)] text-white border-transparent"
                  : "border-input text-muted-foreground hover:bg-muted",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        {/* The two prompts that used to sit under the old dropdown. They moved
            here with it, because their whole job is to tell the rep to ASK —
            which is this question. */}
        {isMedicareAB && state.answer !== "yes" && (
          <p className="text-xs text-red-600 font-semibold mt-1.5">
            Medicare A&amp;B — this patient likely has a secondary. Ask on the call.
          </p>
        )}
        {isMedicareAB && qmbYes && state.answer !== "yes" && (
          <p className="text-xs text-red-600 font-semibold mt-1">
            Stedi QMB returned YES — very likely a secondary supplement plan.
          </p>
        )}
        {/* Brandon: "patients often don't know" — Unknown is a complete answer
            and deliberately does not gate Advance. */}
        {state.answer === "unknown" && (
          <p className="text-xs text-muted-foreground mt-1.5">
            Nothing is written for Unknown, and it won&apos;t hold up the call.
          </p>
        )}
      </div>

      {state.answer === "yes" && (
        <div className="flex-1 space-y-4 rounded-lg border border-input bg-muted/20 p-4">
          <div>
            <p className={LABEL_CLS}>Type</p>
            <div className="flex items-center gap-2 flex-wrap">
              {SECONDARY_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => answer({ answer: "yes", type: t })}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-semibold border transition-colors",
                    state.type === t
                      ? "bg-[color:var(--mm-teal)] text-white border-transparent"
                      : "border-input text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* ⚠️ Medicare Supplement SHOWS this field from 2026-09-14 (Josh:
              *"if medicare supplement is chosen - member id 2 should populate as
              an optional"*). It used to render nothing here but a green *"no
              details needed"* line, on the reasoning that claims cross over from
              Medicare so the ID is never needed — which is still true, and is why
              it is OPTIONAL rather than required. `secondaryMissing` already
              returns [] for this type, so nothing gates on it; a rep who has the
              number simply has somewhere to put it. `mondayWrite` writes Member
              ID 2 on any string, so no write-path change was needed. */}
          {state.type && (
            <div>
              <label className={LABEL_CLS}>
                Member ID 2 {state.type === "NY Medicaid" && "(CIN)"}
                {state.type === "Medicare Supplement" && (
                  <span className="normal-case tracking-normal font-normal">
                    — optional, claims cross over from Medicare
                  </span>
                )}
              </label>
              <Input
                value={memberId2}
                placeholder={
                  state.type === "NY Medicaid"
                    ? "AB12345C"
                    : state.type === "Medicare Supplement"
                      ? "Member ID, if they have it"
                      : "Member ID"
                }
                onChange={(e) => onFieldChange("memberId2Edited", e.target.value)}
              />
            </div>
          )}

          {state.type === "Other" && (
            <div>
              <label className={LABEL_CLS}>Insurance Notes — payer name and group</label>
              <Textarea
                rows={2}
                value={notes}
                placeholder="Payer name and group number"
                onChange={(e) =>
                  onFieldChange("insuranceNotesEdited" as keyof Patient, e.target.value)
                }
              />
            </div>
          )}

          {missing.length > 0 && (
            <ul className="text-xs font-medium text-amber-700 dark:text-amber-400 space-y-1">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

/* ── Block B ───────────────────────────────────────────────────────────── */

/** Text-only tone for a column that needs no attention — the card itself stays
 *  neutral, so the eye lands on the exceptions (Brandon's own ordering rule). */
const TEXT_TONE: Record<string, string> = {
  green: "text-emerald-700 dark:text-emerald-400",
  grey: "text-muted-foreground",
  amber: "text-amber-700 dark:text-amber-400",
  red: "text-rose-700 dark:text-rose-400",
};

const TONE_CLS: Record<string, string> = {
  green:
    "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  grey: "bg-muted text-muted-foreground border-input",
  amber:
    "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  red: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800",
};

export function authProductsFor(patient: Patient): AuthProduct[] {
  const serving = patient.servingEdited ?? patient.serving;
  const all: AuthProduct[] = [
    /* ⚠️ `authId` is deliberately "". Brandon: "a hover/tooltip CAN show Auth
       ID + Auth Start" — CAN, not must. The five Auth ID columns are not in the
       read set, and adding them costs query complexity on every poll of the
       whole queue for a value that isn't actionable without opening Monday
       anyway. Auth Start IS already read, so the tooltip still carries it. Add
       the ids to COL + READ_COLUMN_IDS if the hover ever needs to be more. */
    { key: "cgm", label: "CGM", result: patient.cgmAuthResult, end: patient.cgmAuthEnd, authId: "", start: patient.cgmAuthStart, units: patient.cgmAuthUnits },
    { key: "sensors", label: "Sensors", result: patient.sensorsAuthResult, end: patient.sensorsAuthEnd, authId: "", start: patient.sensorsAuthStart, units: patient.sensorsAuthUnits },
    { key: "pump", label: "Insulin Pump", result: patient.ipAuthResult, end: patient.ipAuthEnd, authId: "", start: patient.ipAuthStart, units: patient.ipAuthUnits },
    { key: "infusionSet", label: "Infusion Set", result: patient.infusionSetAuthResult, end: patient.infusionSetAuthEnd, authId: "", start: patient.infusionSetAuthStart, units: patient.infusionSetAuthUnits },
    { key: "cartridge", label: "Cartridge", result: patient.cartridgeAuthResult, end: patient.cartridgeAuthEnd, authId: "", start: patient.cartridgeAuthStart, units: patient.cartridgeAuthUnits },
  ];
  const served = new Set(servedAuthKeys(serving));
  return all.filter((p) => served.has(p.key));
}

export function AuthBlock({ patient }: { patient: Patient }) {
  const { allClear, sentence, banner, chips } = summariseAuths(authProductsFor(patient));

  if (chips.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing in Serving yet, so there are no auths to show.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Brandon, 2026-09-11: *"show the different products and the auth start
          and end dates / units for each one — but it should fit in one row and
          just have like 5 columns (dynamic number of columns based on products
          serving)"*. One track per SERVED product, so a supplies-only patient
          gets two columns and not five.
          ⚠️ `auto-fit` with a minimum rather than a fixed count: five equal
          tracks at phone width would each be ~70px and unreadable, so they wrap
          instead. `servedAuthKeys` already decided how many there are. */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {chips.map((c) => (
          <div
            key={c.key}
            className={cn(
              "rounded-lg border px-3 py-2.5",
              c.exception ? TONE_CLS[c.tone] : "border-input bg-muted/20",
            )}
          >
            {/* ⚠️ Josh, 2026-09-14: *"a lot of the text is unnecessarily small
                - like look at insurance box - let's have authorization box match
                that font size and format"*. Same ramp as `Read` above — a
                `text-xs` uppercase label over a `text-base font-semibold` value
                — rather than the 11px this card used throughout. */}
            <p className="text-xs font-semibold uppercase tracking-wider truncate" title={c.label}>
              {c.label}
            </p>
            <p className={cn("text-base font-semibold mt-0.5", !c.exception && TEXT_TONE[c.tone])}>
              {chipStateLabel(c.state)}
            </p>
            <dl className="mt-2 space-y-1 text-sm leading-snug">
              <AuthFact label="Start" value={shortDate(c.start)} />
              <AuthFact label="End" value={shortDate(c.end)} />
              {/* ⚠️ Blank on nearly every patient until automation 7918324247
                  copies the units across from Insurance — see authChips. */}
              <AuthFact label="Units" value={c.units} />
            </dl>
          </div>
        ))}
      </div>

      {allClear ? (
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{sentence}</p>
      ) : (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{banner}</p>
      )}
    </div>
  );
}

/** One label/value line inside an auth column. A missing value reads "—"
 *  rather than vanishing: an absent auth date and an absent ROW look the same
 *  otherwise, and only one of them is a problem. */
function AuthFact({ label, value }: { label: string; value: string }) {
  return (
    /* ⚠️ `gap-1.5`, NOT `justify-between` (Josh, 2026-09-14: *"info of
       start / end / units - make closer to the label - not one on far left and
       one on far right"*). Pushed apart, a two-word label and a six-character
       date sat at opposite edges of the card and the eye had to travel. */
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
        {label}
      </dt>
      <dd className="font-semibold tabular-nums">{value?.trim() || "\u2014"}</dd>
    </div>
  );
}

/* ── Block C ───────────────────────────────────────────────────────────── */

export function OopBlock({
  patient,
  intake,
  onChange,
}: {
  patient: Patient;
  intake: CallIntake;
  onChange: (next: CallIntake) => void;
}) {
  return (
    <div className="space-y-4">
      {/* The estimate itself (Josh, 2026-09-15 — put back after four days with
          nothing on this page quoting a number). It renders HERE rather than as
          a row at the top of the page, so it sits beside the field that records
          what the rep actually quoted. `OopEstimateCard` returns null when it
          has no primary insurance or serving to work from, and swaps itself for
          a routing note on CareCentrix. */}
      <OopEstimateCard patient={patient} />
      <p className="text-sm text-muted-foreground">
        Benefit details aren&apos;t shown here. Open the calculator to confirm what the patient owes.
      </p>
      {/* ⚠️ Inert on purpose — Brandon: "skip for now… show what loveable shows,
          but button won't work". Disabled rather than absent so the shape of the
          finished step is visible, and disabled rather than a dead click so
          nobody reports it as broken. */}
      <Button type="button" variant="outline" disabled className="gap-2">
        <Calculator className="h-4 w-4" /> Open out-of-pocket calculator
      </Button>

      {/* ⚠️ These two ride in the call-intake NOTES block, because Brandon's own
          note says the Monday columns for them "should be added" and they do not
          exist yet. That keeps a rep's answer durable today and means the only
          change when the columns land is where it is written. */}
      {/* Josh, 2026-09-14: *"let's make confirmed amount from calculator and
          reviewed with patient on same line"*. `sm:items-end` so the tick box
          and the input sit on the same baseline; the tick keeps its own width
          rather than stretching, so the amount field gets the space. */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1 min-w-0">
          <label className={LABEL_CLS}>Confirmed amount from calculator</label>
          <Input
            placeholder="e.g. $42.50, or $0 with Medicaid"
            value={intake.oopAmount}
            onChange={(e) => onChange({ ...intake, oopAmount: e.target.value })}
          />
        </div>
        {/* Same treatment as the two gating confirmations (see `ConfirmCheck`) —
            a row you have to notice rather than a 16px tick in a line of text. */}
        <label
          htmlFor="wc-oop-reviewed"
          className={cn(
            "flex items-center gap-3 shrink-0 h-10 cursor-pointer select-none rounded-lg border px-3 transition-colors",
            intake.confirmed.oop
              ? "border-emerald-400 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
              : "border-input bg-muted/20 hover:bg-muted/40",
          )}
        >
          <Checkbox
            className="h-5 w-5 shrink-0"
            id="wc-oop-reviewed"
            checked={intake.confirmed.oop}
            onCheckedChange={(v) =>
              onChange({ ...intake, confirmed: { ...intake.confirmed, oop: v === true } })
            }
          />
          <span
            className={cn(
              "text-sm font-medium leading-snug whitespace-nowrap",
              intake.confirmed.oop ? "text-emerald-900 dark:text-emerald-200" : "text-foreground",
            )}
          >
            Reviewed with patient
          </span>
        </label>
      </div>
    </div>
  );
}
