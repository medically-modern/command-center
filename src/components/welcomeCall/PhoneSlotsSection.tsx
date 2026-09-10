/**
 * components/welcomeCall/PhoneSlotsSection.tsx — Brandon's phone slots and the
 * caregiver panel (HANDOFF Josh · Welcome Call phones, 2026-09-09).
 *
 * Two slots and a star. The starred slot is Primary Phone, the other is
 * Alternate Phone, and the star is the whole mechanism — nothing is stored as a
 * "preferred" flag and only the final state of the call is written.
 *
 * ⚠️ Deliberately NOT in `CallIntakeFields.tsx`, whose stated job is the facts
 * with **no Monday column**. Every field here has one now, so the notes block
 * is no longer the record and these controls are not intake fields.
 *
 * ⚠️ Every value is read through `phoneSlotsFor` / `caregiverFor` and written
 * back through `onFieldChange`, so it lands on the PAGE overlay. See the long
 * note on `phoneSlotsFor`: state held locally here would leave the send gate
 * reading columns the rep has already edited past, which is exactly the
 * gate-with-no-passing-move §5.31c records shipping once.
 */
import type { Patient } from "@/lib/welcomeCall/workflow";
import {
  addSlot,
  caregiverFor,
  caregiverPanelVisible,
  phoneSlotsFor,
  removeSlot,
  setSlotCanText,
  setSlotNumber,
  setSlotOwner,
  starSlot,
  MAX_SLOTS,
  type CanText,
  type PhoneSlot,
  type SlotOwner,
} from "@/lib/welcomeCall/phoneSlots";
import { phoneRejectionReason } from "@/lib/shared/phoneCell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Star, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CallIntake } from "@/lib/welcomeCall/callIntake";

const LABEL_CLS = "text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1";

interface Props {
  patient: Patient;
  onFieldChange: (field: keyof Patient, value: unknown) => void;
  /** Caretaker NOTES stay in the notes block — the one caregiver fact with no
   *  column, and the handoff says to keep it there. */
  intake: CallIntake;
  onIntakeChange: (next: CallIntake) => void;
}

export function PhoneSlotsSection({ patient, onFieldChange, intake, onIntakeChange }: Props) {
  const slots = phoneSlotsFor(patient);
  const caregiver = caregiverFor(patient);
  const setSlots = (next: PhoneSlot[]) => onFieldChange("phoneSlotsEdited", next);
  const setCaregiver = (patch: Partial<typeof caregiver>) =>
    onFieldChange("caregiverEdited", { ...caregiver, ...patch });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The starred number is the one we call and text, and the one every automation uses.
        Star the other slot to swap them — the number it replaces becomes the alternate.
      </p>

      <div className="space-y-3">
        {slots.map((slot, i) => (
          <SlotRow
            key={i}
            slot={slot}
            canDelete={slots.length > 1}
            onNumber={(v) => setSlots(setSlotNumber(slots, i, v))}
            onOwner={(v) => setSlots(setSlotOwner(slots, i, v))}
            onCanText={(v) => setSlots(setSlotCanText(slots, i, v))}
            onStar={() => setSlots(starSlot(slots, i))}
            onRemove={() => setSlots(removeSlot(slots, i))}
          />
        ))}
      </div>

      {slots.length < MAX_SLOTS && (
        <Button type="button" size="sm" variant="outline" onClick={() => setSlots(addSlot(slots))}>
          + Add number
        </Button>
      )}

      {/* ⚠️ Either slot, not just the starred one — a caregiver on the alternate
          number still needs a name and a HIPAA answer. */}
      {caregiverPanelVisible(slots) && (
        <div className="rounded-lg border border-input bg-muted/20 p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Caregiver
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Two boxes, ONE column — written as "Jane Doe (daughter)". */}
            <Input
              placeholder="Name"
              value={caregiver.name}
              onChange={(e) => setCaregiver({ name: e.target.value })}
            />
            <Input
              placeholder="Relationship (daughter, spouse…)"
              value={caregiver.relationship}
              onChange={(e) => setCaregiver({ relationship: e.target.value })}
            />
          </div>
          <label
            htmlFor="wc-caregiver-auth"
            className="flex items-center gap-2 cursor-pointer select-none text-sm"
          >
            <Checkbox
              id="wc-caregiver-auth"
              checked={caregiver.authorized}
              onCheckedChange={(v) => setCaregiver({ authorized: v === true })}
            />
            <span className={caregiver.authorized ? "text-foreground" : "text-muted-foreground"}>
              Authorized to discuss the patient&apos;s account (verbal HIPAA consent)
            </span>
          </label>
          {/* No phone and no email here on purpose — Brandon: "the caretaker's
              number lives in a slot, and there's no email column". */}
          <Textarea
            rows={2}
            placeholder="Caregiver notes (best times to call, who to ask for…)"
            value={intake.caretaker.notes}
            onChange={(e) =>
              onIntakeChange({
                ...intake,
                caretaker: { ...intake.caretaker, notes: e.target.value },
              })
            }
          />
        </div>
      )}
    </div>
  );
}

function SlotRow({
  slot,
  canDelete,
  onNumber,
  onOwner,
  onCanText,
  onStar,
  onRemove,
}: {
  slot: PhoneSlot;
  canDelete: boolean;
  onNumber: (v: string) => void;
  onOwner: (v: SlotOwner) => void;
  onCanText: (v: CanText) => void;
  onStar: () => void;
  onRemove: () => void;
}) {
  /* ⚠️ Shown here rather than left to the writer. `writePhone` SKIPS a number
     it cannot parse instead of throwing, so a typo would otherwise save green
     having written nothing — the silent half-save `unwritableDoctorFields`
     exists to prevent on the DVS page (§7). */
  const rejection = slot.number.trim() ? phoneRejectionReason(slot.number) : null;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-3",
        slot.starred ? "border-[color:var(--mm-teal)] bg-muted/20" : "border-input",
      )}
    >
      <div className="flex items-start gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={slot.starred ? "Primary number" : "Make this the primary number"}
          aria-pressed={slot.starred}
          onClick={onStar}
          className="mt-5 shrink-0"
        >
          <Star
            className={cn(
              "h-4 w-4",
              slot.starred ? "fill-amber-400 text-amber-500" : "text-muted-foreground",
            )}
          />
        </Button>

        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>
              {slot.starred ? "Primary phone" : "Alternate phone"}
            </label>
            <Input
              value={slot.number}
              placeholder="(555) 555-0100"
              onChange={(e) => onNumber(e.target.value)}
              className={rejection ? "border-red-500 focus-visible:ring-red-500" : ""}
            />
            {rejection && (
              <p className="mt-1 text-xs font-medium text-red-600">{rejection}</p>
            )}
          </div>

          <div>
            <label className={LABEL_CLS}>Whose number is this?</label>
            <Select
              value={slot.owner || undefined}
              onValueChange={(v) => onOwner(v as SlotOwner)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Patient or caregiver" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="patient">Patient</SelectItem>
                <SelectItem value="caregiver">Caregiver</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove this number"
            onClick={onRemove}
            className="mt-5 shrink-0 text-muted-foreground hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* ⚠️ The starred slot ONLY. It is the answer that reaches the board, and
          it is what the Day-20 reorder text keys on. */}
      {slot.starred && (
        <div className="pl-12">
          <label className={LABEL_CLS}>Can this number receive texts?</label>
          <div className="flex items-center gap-2">
            {(
              [
                { id: "yes", label: "Yes" },
                { id: "no", label: "No" },
              ] as { id: CanText; label: string }[]
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onCanText(o.id)}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-sm font-semibold border transition-colors",
                  slot.canText === o.id
                    ? "bg-[color:var(--mm-teal)] text-white border-transparent"
                    : "border-input text-muted-foreground hover:bg-muted",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {slot.canText === "no" && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                Reorders will go to a call queue instead of the Day-20 text.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
