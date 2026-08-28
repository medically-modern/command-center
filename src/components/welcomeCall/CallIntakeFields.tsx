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
  SUPPLY_LENGTHS,
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
}: IntakeProps & { field: ConfirmKey; className?: string }) {
  const id = `wc-confirm-${field}`;
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-2 cursor-pointer select-none text-sm ${className}`}
    >
      <Checkbox
        id={id}
        checked={intake.confirmed[field]}
        onCheckedChange={(v) =>
          onChange({ ...intake, confirmed: { ...intake.confirmed, [field]: v === true } })
        }
      />
      <span className={intake.confirmed[field] ? "text-foreground" : "text-muted-foreground"}>
        {CONFIRM_LABELS[field]}
      </span>
    </label>
  );
}

/* ── Supply length — sits with Subscription Type, it describes the order ── */

export function SupplyLengthField({
  intake,
  onChange,
  derivedNote,
}: IntakeProps & { derivedNote?: string }) {
  return (
    <div>
      <label className={LABEL_CLS}>Supply Length</label>
      <Select
        value={intake.supplyLength || undefined}
        // Picking from this control is what makes the value the rep's — see
        // `supplyLengthManual` in callIntake.ts for why that is recorded rather
        // than inferred from the value.
        onValueChange={(v) =>
          onChange({ ...intake, supplyLength: v as SupplyLength, supplyLengthManual: true })
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          {SUPPLY_LENGTHS.map((d) => (
            <SelectItem key={d} value={d}>
              {d} days
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* The payer rule decides this; the select is an override the rep can
          make on the call, and whichever value ends up here is what lands in
          the notes block. */}
      {derivedNote && <p className="mt-1 text-[11px] text-muted-foreground">{derivedNote}</p>}
    </div>
  );
}

/* ── Section: extra phone numbers + caretaker ── */

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

export function ContactsSection({ intake, onChange }: IntakeProps) {
  const phones = intake.phones;

  const setPhones = (next: IntakePhone[]) => onChange({ ...intake, phones: next });
  const setCaretaker = (patch: Partial<CallIntake["caretaker"]>) =>
    onChange({ ...intake, caretaker: { ...intake.caretaker, ...patch } });

  return (
    <div className="space-y-5">
      {/* Extra phone numbers. The board's one Pt. Phone column stays the system
          of record — these are additional, with a flag saying which to ring. */}
      <div>
        <label className={LABEL_CLS}>Additional Phone Numbers</label>
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

      {/* Caretaker */}
      <div>
        <label className={LABEL_CLS}>Caretaker / Alternate Contact</label>
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
    </div>
  );
}

/* ── Section: insurance confirmation, cost, auth notes ── */

const SECONDARY_OPTIONS: { value: SecondaryCoverage; label: string }[] = [
  { value: "yes", label: "Yes — has secondary" },
  { value: "no", label: "No secondary" },
  { value: "unknown", label: "Unknown / patient unsure" },
];

export function InsuranceCostSection({ intake, onChange }: IntakeProps) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          {/* The board's Secondary Insurance column can say None but has no way
              to say "we asked and the patient didn't know" — that gap is why
              this lives here rather than being written to the column. */}
          <label className={LABEL_CLS}>Secondary Coverage</label>
          <Select
            value={intake.secondaryCoverage || undefined}
            onValueChange={(v) => onChange({ ...intake, secondaryCoverage: v as SecondaryCoverage })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Not asked" />
            </SelectTrigger>
            <SelectContent>
              {SECONDARY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value as string}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className={LABEL_CLS}>Out-of-Pocket Quoted</label>
          <Input
            placeholder="e.g. $42.50, or $0 with Medicaid"
            value={intake.oopAmount}
            onChange={(e) => onChange({ ...intake, oopAmount: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <ConfirmCheck intake={intake} onChange={onChange} field="primary" />
        <ConfirmCheck intake={intake} onChange={onChange} field="secondary" />
        <ConfirmCheck intake={intake} onChange={onChange} field="oop" />
      </div>

      <div>
        <label className={LABEL_CLS}>Auth Notes</label>
        <Textarea
          rows={3}
          placeholder="Anything the auth results above don't say — resubmissions, retry queue, what the payer told us."
          value={intake.authNotes}
          onChange={(e) => onChange({ ...intake, authNotes: e.target.value })}
        />
      </div>
    </div>
  );
}
