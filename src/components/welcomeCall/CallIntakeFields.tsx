/**
 * components/welcomeCall/CallIntakeFields.tsx — inputs for the Welcome Call
 * facts that have NO Monday column.
 *
 * These write into `patient.callIntake`, which `sendPatientToMonday` serialises
 * into the Notes column as one parseable block (lib/welcomeCall/callIntake.ts).
 * Nothing here maps to a board column, so nothing here can be verified by
 * `executeWritesWithVerification` the way a status write is — the notes body is
 * the record.
 *
 * Split into the pieces the form drops in at different points rather than one
 * block, because these questions belong next to the field they qualify: the
 * pump confirmation under Pump Type, the address confirmation under Address.
 * A single "confirmations" panel at the bottom would ask the rep to scroll away
 * from what they are reading to the patient.
 */
import type {
  CallIntake,
  ConfirmKey,
  SecondaryCoverage,
  SupplyLength,
} from "@/lib/welcomeCall/callIntake";
import { CONFIRM_LABELS } from "@/lib/welcomeCall/callIntake";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface IntakeProps {
  intake: CallIntake;
  onChange: (next: CallIntake) => void;
}

const LABEL_CLS = "text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1";

/* ── One confirmation tick, dropped in beside the field it qualifies ── */

export function ConfirmCheck({
  intake,
  onChange,
  field,
  className = "",
  label,
  recordPumpModel,
}: IntakeProps & {
  field: ConfirmKey;
  className?: string;
  /** Overrides `CONFIRM_LABELS[field]` — the pump check names the model. */
  label?: string;
  /**
   * The Pump Type on screen, passed by the `pump` check only.
   *
   * ⚠️ Ticking has to RECORD the model, not just the boolean. The confirmation
   * is about one device — the rep said "t:slim" out loud — and
   * `sendGates.pumpConfirmationStale` compares this against the current Pump
   * Type to notice a later correction. A tick saved without it reads as stale
   * forever, which is the safe direction but costs the rep a needless re-ask.
   */
  recordPumpModel?: string;
}) {
  const id = `wc-confirm-${field}`;
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-2 cursor-pointer select-none text-sm ${className}`}
    >
      <Checkbox
        id={id}
        checked={intake.confirmed[field]}
        onCheckedChange={(v) => {
          const on = v === true;
          const next = { ...intake, confirmed: { ...intake.confirmed, [field]: on } };
          if (recordPumpModel !== undefined) {
            // Cleared on untick as well: a stored model with no tick behind it
            // would be read back as a confirmation nobody made.
            next.pumpConfirmedModel = on ? recordPumpModel.trim() : "";
          }
          onChange(next);
        }}
      />
      <span className={intake.confirmed[field] ? "text-foreground" : "text-muted-foreground"}>
        {label ?? CONFIRM_LABELS[field]}
      </span>
    </label>
  );
}

/* ⚠️ `PhoneRow`, `PhoneNumbersSection` and `CaretakerSection` were DELETED on
   2026-09-10 (§5.31d). Phone numbers and the caregiver are six MONDAY COLUMNS
   now, so they are not intake fields and do not belong in this file, whose job
   is the facts with no column. They live in
   `components/welcomeCall/PhoneSlotsSection.tsx`, reading and writing the page
   overlay rather than the notes block.

   Deleted rather than left unimported, per §5.11 — a dead section that still
   compiles is one a later reader wires back up. Caretaker NOTES survive, as a
   textarea inside the new caregiver panel. */


/* ── Section: insurance confirmation, cost, auth notes ── */

const SECONDARY_OPTIONS: { value: SecondaryCoverage; label: string }[] = [
  { value: "yes", label: "Yes — has secondary" },
  { value: "no", label: "No secondary" },
  { value: "unknown", label: "Unknown / patient unsure" },
];

/* ⚠️ `InsuranceSection` and `AuthCostSection` were DELETED on 2026-09-09.
   Brandon's Insurance & Authorization section replaced them: secondary coverage
   is now one board-writing question (`InsuranceAuthSection.InsuranceBlock`),
   the auth results are read-only chips (`AuthBlock`), and the out-of-pocket
   pair moved to `OopBlock`. They are gone rather than left unimported — a dead
   component that still looks live is how a later edit lands somewhere nothing
   renders (§5.11). */
