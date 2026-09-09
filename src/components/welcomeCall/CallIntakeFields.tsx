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
  IntakePhone,
  PhoneKind,
  SecondaryCoverage,
  SupplyLength,
} from "@/lib/welcomeCall/callIntake";
import {
  CONFIRM_LABELS,
  MAX_EXTRA_PHONES,
  PHONE_KINDS,
} from "@/lib/welcomeCall/callIntake";
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

/* ⚠️ `SupplyLengthField` was DELETED on 2026-09-09. Brandon: "call it Order
   Frequency, not Supply length, so it matches the boards" — and "stop writing
   supply length to the notes block". The control is now an inline select in
   Subscription & Logistics writing the real Monday column
   (`color_mm71xdhj`), so this one had no call sites left. Deleted rather than
   left unimported: a dead component that still looks live is how a later edit
   lands somewhere nothing renders (§5.11). The payer-eligibility guarantee it
   carried moved with it — see `orderFrequencyOptionsSource.test.ts`. */

function PhoneRow({
  phone,
  onPhoneChange,
  onRemove,
  onMakePreferred,
}: {
  phone: IntakePhone;
  onPhoneChange: (p: IntakePhone) => void;
  onRemove: () => void;
  onMakePreferred: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="flex-1 min-w-[10rem]"
        placeholder="Phone number"
        value={phone.number}
        onChange={(e) => onPhoneChange({ ...phone, number: e.target.value })}
      />
      <Select value={phone.kind} onValueChange={(v) => onPhoneChange({ ...phone, kind: v as PhoneKind })}>
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PHONE_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant={phone.preferred ? "default" : "outline"}
        onClick={onMakePreferred}
        title="Mark this as the number the patient wants us to use"
      >
        {phone.preferred ? "Preferred" : "Set preferred"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onRemove} aria-label="Remove number">
        ✕
      </Button>
    </div>
  );
}

/* The contacts block used to be ONE section ("Contacts & Caretaker") sitting
   below the product sections. Brandon's 2026-09-09 mockup opens the call with
   it and splits it in two, which is how the call actually runs: you confirm who
   you are talking to and how to reach them before you talk about product.
   Same fields, same notes-block round-trip (§ callIntake.ts) — only the framing
   changed, so nothing downstream of `intake` can tell the difference. */

export function PhoneNumbersSection({ intake, onChange }: IntakeProps) {
  const phones = intake.phones;
  const setPhones = (next: IntakePhone[]) => onChange({ ...intake, phones: next });

  return (
    <div>
      {/* Extra phone numbers. The board's one Pt. Phone column stays the system
          of record — these are additional, with a flag saying which to ring. */}
      <p className="text-xs text-muted-foreground mb-2">
        The patient&apos;s main number stays on the profile above. Add any others here and mark
        which one they actually want us to use.
      </p>
      <div className="space-y-2">
        {phones.map((p, i) => (
          <PhoneRow
            key={i}
            phone={p}
            onPhoneChange={(next) => setPhones(phones.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setPhones(phones.filter((_, j) => j !== i))}
            // Preferred is single-select: setting one clears the others, so the
            // block can never record two "ring this one" numbers.
            onMakePreferred={() =>
              setPhones(phones.map((x, j) => ({ ...x, preferred: j === i && !x.preferred })))
            }
          />
        ))}
      </div>
      {phones.length < MAX_EXTRA_PHONES && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setPhones([...phones, { number: "", kind: "cell", preferred: false }])}
        >
          + Add number
        </Button>
      )}
    </div>
  );
}

export function CaretakerSection({ intake, onChange }: IntakeProps) {
  const setCaretaker = (patch: Partial<CallIntake["caretaker"]>) =>
    onChange({ ...intake, caretaker: { ...intake.caretaker, ...patch } });

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">
        Fill this in if someone else manages the patient&apos;s supplies or takes their calls.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Input
          placeholder="Name"
          value={intake.caretaker.name}
          onChange={(e) => setCaretaker({ name: e.target.value })}
        />
        <Input
          placeholder="Relationship (daughter, spouse…)"
          value={intake.caretaker.relationship}
          onChange={(e) => setCaretaker({ relationship: e.target.value })}
        />
        <Input
          placeholder="Phone"
          value={intake.caretaker.phone}
          onChange={(e) => setCaretaker({ phone: e.target.value })}
        />
        <Input
          placeholder="Email"
          value={intake.caretaker.email}
          onChange={(e) => setCaretaker({ email: e.target.value })}
        />
      </div>
      <label
        htmlFor="wc-caretaker-auth"
        className="flex items-center gap-2 cursor-pointer select-none text-sm mt-2"
      >
        <Checkbox
          id="wc-caretaker-auth"
          checked={intake.caretaker.authorized}
          onCheckedChange={(v) => setCaretaker({ authorized: v === true })}
        />
        <span className={intake.caretaker.authorized ? "text-foreground" : "text-muted-foreground"}>
          Authorized to discuss the patient&apos;s care
        </span>
      </label>
      <Textarea
        className="mt-2"
        rows={2}
        placeholder="Caretaker notes (best times to call, who to ask for…)"
        value={intake.caretaker.notes}
        onChange={(e) => setCaretaker({ notes: e.target.value })}
      />
    </div>
  );
}

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
