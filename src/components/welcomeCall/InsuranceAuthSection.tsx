/**
 * Brandon's "Insurance & Authorization" section (2026-09-09), three blocks.
 *
 * A — Insurance: primary read-only, secondary as ONE question.
 * B — Authorization: read-only chips, one per served product.
 * C — Out of Pocket: shown, calculator button inert (his call).
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Calculator } from "lucide-react";
import type { Patient } from "@/lib/welcomeCall/workflow";
import type { CallIntake } from "@/lib/welcomeCall/callIntake";
import {
  SECONDARY_TYPES,
  secondaryStateFromBoard,
  secondaryMissing,
  secondaryWrites,
  type SecondaryAnswer,
  type SecondaryType,
} from "@/lib/welcomeCall/secondaryCoverage";
import { servedAuthKeys, summariseAuths, type AuthProduct } from "@/lib/welcomeCall/authChips";

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
  onFieldChange: (field: keyof Patient, value: string | number | null) => void;
}) {
  /* ⚠️ Unknown needs somewhere to live. It writes NOTHING to Monday (Brandon:
     "patients often don't know"), so with no local state the click set both
     edited fields to null, `secondaryStateFromBoard` re-read the board, and the
     control snapped straight back to No or Yes — a three-answer question with
     two working answers (Greptile, PR #56).
     ⚠️ Held per PATIENT id, not as a bare boolean: this component survives a
     sidebar click, so an un-keyed flag would carry one patient's "they didn't
     know" onto the next patient's record. It is deliberately session-only —
     there is no column for it, which is the point. */
  const [unknownFor, setUnknownFor] = useState<string | null>(null);
  const boardSecondary = patient.secondaryInsuranceEdited ?? patient.secondaryInsurance;
  const state =
    unknownFor === patient.id
      ? { answer: "unknown" as const, type: null }
      : secondaryStateFromBoard(boardSecondary);
  const memberId2 = patient.memberId2Edited ?? patient.memberId2;
  const notes = patient.insuranceNotesEdited ?? patient.insuranceNotes ?? "";
  const missing = secondaryMissing({ ...state, memberId2, insuranceNotes: notes });
  const isMedicareAB = (patient.primaryInsuranceEdited ?? patient.primaryInsurance) === "Medicare A&B";
  const qmbYes = (patient.stediQmb || "").trim().toUpperCase() === "YES";

  /** Apply an answer to the board-bound fields. Absent keys leave a column
   *  alone — see `secondaryWrites` for why Unknown writes nothing. */
  const answer = (next: { answer: SecondaryAnswer; type: SecondaryType | null }) => {
    setUnknownFor(next.answer === "unknown" ? patient.id : null);
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
    <div className="space-y-5">
      {/* Read-only. Corey: primary isn't confirmed at this stage, so there is
          deliberately no checkbox here.
          ⚠️ Brandon also asked for "date of last stedi check" as the verified-on
          stamp. There is NO such column — not on Welcome Call, not on Profile
          Send Off (checked 2026-09-09; "Stedi Plan Begin Date" is the plan's
          start, and "Run Stedi Eligibility" is a trigger, not a timestamp). A
          date rendered here would be a confidence signal backed by nothing,
          which is worse than its absence (§5.26). */}
      <div>
        <p className={LABEL_CLS}>Primary — from the benefits stage</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg border border-input bg-muted/20 p-4">
          <Read label="Primary Insurance" value={patient.primaryInsurance} />
          <Read label="Plan Name" value={patient.planName} />
          <Read label="Member ID 1" value={patient.memberId1} />
        </div>
      </div>

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
        <div className="space-y-4 rounded-lg border border-input bg-muted/20 p-4">
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

          {/* Medicare Supplement is a TAG ONLY — claims cross over from
              Medicare, so asking for an ID wastes a question on the call. */}
          {state.type === "Medicare Supplement" && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
              No details needed — tagging it as a Medicare supplement is the whole job.
            </p>
          )}

          {(state.type === "NY Medicaid" || state.type === "Other") && (
            <div>
              <label className={LABEL_CLS}>
                Member ID 2 {state.type === "NY Medicaid" && "(CIN)"}
              </label>
              <Input
                value={memberId2}
                placeholder={state.type === "NY Medicaid" ? "AB12345C" : "Member ID"}
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
  );
}

/* ── Block B ───────────────────────────────────────────────────────────── */

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
    { key: "cgm", label: "CGM", result: patient.cgmAuthResult, end: patient.cgmAuthEnd, authId: "", start: patient.cgmAuthStart },
    { key: "sensors", label: "Sensors", result: patient.sensorsAuthResult, end: patient.sensorsAuthEnd, authId: "", start: patient.sensorsAuthStart },
    { key: "pump", label: "Insulin Pump", result: patient.ipAuthResult, end: patient.ipAuthEnd, authId: "", start: patient.ipAuthStart },
    { key: "infusionSet", label: "Infusion Set", result: patient.infusionSetAuthResult, end: patient.infusionSetAuthEnd, authId: "", start: patient.infusionSetAuthStart },
    { key: "cartridge", label: "Cartridge", result: patient.cartridgeAuthResult, end: patient.cartridgeAuthEnd, authId: "", start: patient.cartridgeAuthStart },
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
      {/* Brandon: "chips only appear when something isn't clear" — an all-clear
          patient gets one sentence, not five rows a rep has to read past. */}
      {allClear ? (
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{sentence}</p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {chips.map((c) => (
              <span
                key={c.key}
                // Brandon: a hover can carry Auth ID + Auth Start. Kept to a
                // title rather than a field — it is context for one chip, not a
                // row of its own.
                title={[c.authId && `Auth ID ${c.authId}`, c.start && `from ${c.start}`]
                  .filter(Boolean)
                  .join(" · ")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold",
                  TONE_CLS[c.tone],
                )}
              >
                {c.label} {c.state}
              </span>
            ))}
          </div>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{banner}</p>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Read-only — auth results are the benefits stage&apos;s output and sync from the board.
      </p>
    </div>
  );
}

/* ── Block C ───────────────────────────────────────────────────────────── */

export function OopBlock({
  intake,
  onChange,
}: {
  intake: CallIntake;
  onChange: (next: CallIntake) => void;
}) {
  return (
    <div className="space-y-4">
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
      <div>
        <label className={LABEL_CLS}>Confirmed amount from calculator</label>
        <Input
          placeholder="e.g. $42.50, or $0 with Medicaid"
          value={intake.oopAmount}
          onChange={(e) => onChange({ ...intake, oopAmount: e.target.value })}
        />
      </div>
      <label
        htmlFor="wc-oop-reviewed"
        className="flex items-center gap-2 cursor-pointer select-none text-sm"
      >
        <Checkbox
          id="wc-oop-reviewed"
          checked={intake.confirmed.oop}
          onCheckedChange={(v) =>
            onChange({ ...intake, confirmed: { ...intake.confirmed, oop: v === true } })
          }
        />
        <span className={intake.confirmed.oop ? "text-foreground" : "text-muted-foreground"}>
          Reviewed with patient
        </span>
      </label>
    </div>
  );
}
