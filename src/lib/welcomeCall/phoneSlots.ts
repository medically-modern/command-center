/**
 * lib/welcomeCall/phoneSlots.ts — the phone-slot and caregiver rules for
 * Welcome Call, from Brandon's HANDOFF (Josh · Welcome Call phones, 2026-09-09).
 *
 * ── THE MODEL ──
 * Two slots, at most. One of them carries a STAR, and the star is the whole
 * mechanism: nothing is stored as a "preferred" flag, and at Send to Monday
 * the starred slot becomes Primary Phone while the other becomes Alternate
 * Phone. However many times the star moves during a call, only the final state
 * is written.
 *
 * That replaces the previous design, where up to four extra numbers with a
 * cell/home/work/other kind rode in the `--- WC INTAKE v1 ---` notes block and
 * no column was written at all. **The COLUMNS are the source of truth now.**
 *
 * ── WHY THE OWNER OF SLOT 2 IS STORED, NOT INFERRED ──
 * The handoff's first draft kept only the starred slot's Patient/Caregiver
 * answer (→ Primary Contact) and re-derived the other one on load from Primary
 * Contact plus whether a Caregiver Name was present. That inference is wrong
 * for a two-caregiver household with no patient number, and wrong silently.
 * Brandon offered a seventh status for it and Josh took it (2026-09-10), so
 * **Alternate Contact `color_mm72wngg` is a real column**. The screen was
 * already asking the question per slot; the schema was throwing one answer
 * away. There is no inference rule here, and there should not be one.
 *
 * ── PURE ──
 * Every rule below is a function of its arguments. `mondayWrite` maps
 * `phoneSlotWrites`' output onto column ids; the form owns the interaction.
 */
import type { Patient } from "./workflow";
import { phoneRejectionReason } from "@/lib/shared/phoneCell";

/* ─── Vocabulary ─── */

export type SlotOwner = "patient" | "caregiver" | "";
/** ⚠️ `""` is UNKNOWN — nobody has asked — and is NEVER a No. */
export type CanText = "yes" | "no" | "";

export interface PhoneSlot {
  number: string;
  owner: SlotOwner;
  starred: boolean;
  /**
   * Whether THIS NUMBER can receive texts.
   *
   * ⚠️ Held per slot rather than once for "the primary". Brandon's rule reads
   * *"if the star moves to the other slot, clear it so the rep re-answers for
   * the new primary"*, and per-slot satisfies that by construction: the other
   * slot has its own (blank) answer, so starring it shows an unanswered
   * toggle. It also avoids the perverse case the literal reading produces —
   * starring back to a number the rep already answered for would re-ask about
   * a number nothing has changed about. Only the STARRED slot's value is ever
   * written to the board, so the persisted meaning is identical.
   */
  canText: CanText;
}

export interface CaregiverDetails {
  name: string;
  relationship: string;
  authorized: boolean;
}

export const MAX_SLOTS = 2;

/**
 * Status label WRITE values, read back off the live board 2026-09-10.
 *
 * ⚠️ These are label IDs, which Monday derived from each label's COLOUR — they
 * are NOT the display order the create call asked for (Patient/Caregiver were
 * created as index 0/1 and came back as 7/4). `writeStatusIndex` sends
 * `{"index": <id>}` and `mondayItemToPatient` reads the same field back, so the
 * two are symmetric. A write to a label id that does not exist is dropped with
 * **no error** — the trap that bit Sub-Stage, Intake Sub-Stage and Order
 * Frequency (CLAUDE.md §5.12/§5.20/§5.31c). Never guess one; read `settings_str`.
 */
export const CONTACT_LABEL_ID: Record<Exclude<SlotOwner, "">, number> = {
  patient: 7,
  caregiver: 4,
};
export const CAN_TEXT_LABEL_ID: Record<Exclude<CanText, "">, number> = {
  yes: 1,
  no: 2,
};

/** Board label text → our vocabulary. An unrecognised label reads as UNSET
 *  rather than as its opposite: guessing the negative is the bug itself. */
export function ownerFromLabel(label: string): SlotOwner {
  const l = (label ?? "").trim().toLowerCase();
  if (l === "patient") return "patient";
  if (l === "caregiver") return "caregiver";
  return "";
}

/** Same rule for Can Text. ⚠️ Anything we do not recognise — a blank, a label
 *  somebody adds later — is UNKNOWN. Reporting it as "No" would route a
 *  patient's reorders to a call queue on the strength of a string we could not
 *  read (the §5.20 `networkAnswer` rule, and §5.31c's blank-secondary rule). */
export function canTextFromLabel(label: string): CanText {
  const l = (label ?? "").trim().toLowerCase();
  if (l === "yes") return "yes";
  if (l === "no") return "no";
  return "";
}

/** Slot 2 opens on the opposite of slot 1 (the handoff's default). */
export function oppositeOwner(owner: SlotOwner): SlotOwner {
  if (owner === "patient") return "caregiver";
  if (owner === "caregiver") return "patient";
  return "";
}

/* ─── Building the slots ─── */

type PhoneSource = Pick<
  Patient,
  "phone" | "alternatePhone" | "primaryContact" | "alternateContact" | "canText"
>;

/**
 * Board columns → the two slots the screen edits.
 *
 * Slot 1 is Primary Phone and is starred; slot 2 is Alternate Phone and only
 * exists when the board holds one. Can Text belongs to the primary number, so
 * only slot 1 loads with it — slot 2's is blank until somebody stars it and
 * answers, which is the correct starting state rather than a lost value.
 */
export function slotsFromPatient(p: PhoneSource): PhoneSlot[] {
  const slots: PhoneSlot[] = [
    {
      number: (p.phone ?? "").trim(),
      owner: ownerFromLabel(p.primaryContact),
      starred: true,
      canText: canTextFromLabel(p.canText),
    },
  ];
  const alt = (p.alternatePhone ?? "").trim();
  if (alt) {
    slots.push({
      number: alt,
      owner: ownerFromLabel(p.alternateContact),
      starred: false,
      canText: "",
    });
  }
  return slots;
}

/** "+ Add number" — capped at two. The new slot opens on the opposite owner. */
export function addSlot(slots: PhoneSlot[]): PhoneSlot[] {
  if (slots.length >= MAX_SLOTS) return slots;
  return [
    ...slots,
    {
      number: "",
      owner: oppositeOwner(slots[0]?.owner ?? ""),
      starred: false,
      canText: "",
    },
  ];
}

/** Move the star. Exactly one slot is starred afterwards. */
export function starSlot(slots: PhoneSlot[], index: number): PhoneSlot[] {
  if (index < 0 || index >= slots.length) return slots;
  return slots.map((s, i) => ({ ...s, starred: i === index }));
}

/**
 * Delete a slot.
 *
 * ⚠️ Deleting the starred slot leaves the survivor as the only number, and
 * therefore the primary — the handoff says so outright ("Deleting slot 1
 * leaves slot 2 as the only number, so it's the primary"). Without this the
 * list would carry no star at all and the send would have no Primary Phone to
 * write.
 */
export function removeSlot(slots: PhoneSlot[], index: number): PhoneSlot[] {
  if (index < 0 || index >= slots.length) return slots;
  const rest = slots.filter((_, i) => i !== index);
  if (rest.length === 0) return rest;
  return rest.some((s) => s.starred) ? rest : starSlot(rest, 0);
}

/**
 * Change a slot's number.
 *
 * ⚠️ **Editing the number clears that slot's Can Text**, because the answer was
 * about the OLD number. This is not in the handoff — it covers the star moving
 * and not the digits changing — but it is the same staleness the pump
 * confirmation has (`sendGates.pumpConfirmationStale`): a rep who confirms
 * "yes, this cell takes texts" and then corrects the number to a landline
 * would otherwise carry the Yes onto a number nobody asked about, and the
 * Day-20 reorder text would go to a line that cannot receive it.
 *
 * Compared on DIGITS, so reformatting `(555) 555-0100` to `555-555-0100` is
 * not a change and does not cost the rep their answer.
 */
export function setSlotNumber(slots: PhoneSlot[], index: number, next: string): PhoneSlot[] {
  if (index < 0 || index >= slots.length) return slots;
  return slots.map((s, i) => {
    if (i !== index) return s;
    const changed = digits(s.number) !== digits(next);
    return { ...s, number: next, canText: changed ? "" : s.canText };
  });
}

export function setSlotOwner(slots: PhoneSlot[], index: number, owner: SlotOwner): PhoneSlot[] {
  if (index < 0 || index >= slots.length) return slots;
  return slots.map((s, i) => (i === index ? { ...s, owner } : s));
}

export function setSlotCanText(slots: PhoneSlot[], index: number, canText: CanText): PhoneSlot[] {
  if (index < 0 || index >= slots.length) return slots;
  return slots.map((s, i) => (i === index ? { ...s, canText } : s));
}

function digits(v: string): string {
  return (v ?? "").replace(/\D/g, "");
}

/* ─── Caregiver name ⟷ column value ─── */

/**
 * `{name, relationship}` → `"Jane Doe (daughter)"`.
 *
 * Two boxes on screen, one column on the board (the handoff's §1). A name with
 * no relationship is written bare rather than with an empty bracket, so the
 * value stays something a human reading the board would have typed.
 */
export function formatCaregiver(name: string, relationship: string): string {
  const n = (name ?? "").trim();
  const r = (relationship ?? "").trim();
  if (!n) return "";
  return r ? `${n} (${r})` : n;
}

/**
 * `"Jane Doe (daughter)"` → `{name, relationship}`.
 *
 * ⚠️ Splits on the LAST bracketed group, so a name that itself contains
 * brackets — `"Bob Smith (Sr) (son)"` — keeps them on the name side and yields
 * the relationship a rep actually typed. Anything without a trailing group is
 * all name.
 */
export function parseCaregiver(value: string): { name: string; relationship: string } {
  const v = (value ?? "").trim();
  if (!v) return { name: "", relationship: "" };
  const m = v.match(/^(.*)\(([^()]*)\)$/);
  if (!m) return { name: v, relationship: "" };
  return { name: m[1].trim(), relationship: m[2].trim() };
}

/* ─── What the screen shows ─── */

/**
 * The caregiver panel appears when EITHER slot is a caregiver — not only the
 * starred one. A caregiver on the alternate number still needs a name and a
 * HIPAA answer.
 */
export function caregiverPanelVisible(slots: PhoneSlot[]): boolean {
  return slots.some((s) => s.owner === "caregiver");
}

/**
 * Unmet phone requirements, as sentences for `sendGates.unmetSendRequirements`.
 *
 * ⚠️ The Can Text answer is required on the STARRED slot only — it is the one
 * that reaches the board, and it is what the Day-20 reorder text keys on. The
 * handoff makes it a send requirement outright.
 *
 * ⚠️ A slot with no number is not reported: an empty second slot is a rep who
 * pressed "+ Add number" and changed their mind, and `phoneSlotWrites` drops
 * it. Only a slot carrying a real number has to be answered for.
 */
export function phoneSlotGaps(slots: PhoneSlot[]): string[] {
  const filled = slots.filter((s) => s.number.trim());
  const out: string[] = [];
  if (filled.length === 0) {
    out.push("Add the patient's phone number in the Phone Numbers section.");
    return out;
  }
  for (const s of filled) {
    /* ⚠️ In the GATE, not only in the input's red ring. `writePhone` SKIPS a
       number it cannot parse rather than throwing, so without this the send
       reports success having written nothing — the silent half-save
       `unwritableDoctorFields` exists to prevent on the DVS page (§7). */
    const rejection = phoneRejectionReason(s.number);
    if (rejection) out.push(`${s.number.trim()} can't be saved — ${rejection}`);
    if (s.owner === "") {
      out.push(
        `Say whether ${s.number.trim()} is the patient's or a caregiver's in the Phone Numbers section.`,
      );
    }
  }
  const starred = filled.find((s) => s.starred);
  if (starred && starred.canText === "") {
    out.push(`Answer whether ${starred.number.trim()} can receive texts.`);
  }
  return out;
}

/* ─── What gets written ─── */

export interface PhoneSlotWrites {
  /** Primary Phone — the starred slot. */
  primaryPhone: string;
  /** Alternate Phone — the other slot, `""` to clear when there is only one. */
  alternatePhone: string;
  /** Status label ids. ⚠️ `null` means CLEAR, not "skip": the columns are the
   *  source of truth, so a removed caregiver has to remove their record too.
   *  Only the final state of the call is written. */
  primaryContactId: number | null;
  alternateContactId: number | null;
  canTextId: number | null;
  caregiverName: string;
  caregiverAuthorized: boolean;
}

/**
 * The six column values for Send to Monday.
 *
 * ⚠️ Slots with no number are dropped first, so an abandoned "+ Add number"
 * cannot write a blank Alternate Phone alongside a live Alternate Contact —
 * a value attached to no number is the §5.12 shape where a record and its
 * columns disagree.
 *
 * ⚠️ The caregiver fields are cleared when no slot is a caregiver any more.
 * Leaving a stale name and an authorisation tick against a patient nobody
 * shares an account with is a HIPAA record that says the wrong thing.
 */
export function phoneSlotWrites(
  slots: PhoneSlot[],
  caregiver: CaregiverDetails,
): PhoneSlotWrites {
  const filled = slots.filter((s) => s.number.trim());
  const starred = filled.find((s) => s.starred) ?? filled[0] ?? null;
  const other = filled.find((s) => s !== starred) ?? null;
  const hasCaregiver = caregiverPanelVisible(filled);

  return {
    primaryPhone: starred?.number.trim() ?? "",
    alternatePhone: other?.number.trim() ?? "",
    primaryContactId: starred && starred.owner ? CONTACT_LABEL_ID[starred.owner] : null,
    alternateContactId: other && other.owner ? CONTACT_LABEL_ID[other.owner] : null,
    canTextId: starred && starred.canText ? CAN_TEXT_LABEL_ID[starred.canText] : null,
    caregiverName: hasCaregiver ? formatCaregiver(caregiver.name, caregiver.relationship) : "",
    caregiverAuthorized: hasCaregiver ? caregiver.authorized : false,
  };
}

/* ─── The overlay seam ─── */

/**
 * The slots the screen edits, and the ONLY thing the send gate may read.
 *
 * ⚠️⚠️ **Slot state lives on the page overlay (`phoneSlotsEdited`), never in the
 * phone component.** This mirrors `secondaryCoverage.secondaryStateFor`, and it
 * mirrors it because that pattern exists to fix a bug that already shipped
 * (§5.31c, Greptile PR #56): `InsuranceBlock` held the secondary "Unknown"
 * answer in `useState`, invisible to the page, so the page's send gate went on
 * reading the column — and a patient already carrying NY Medicaid showed
 * Unknown on screen while Advance stayed shut on a CIN the rep had just
 * recorded as unknown. **A gate with no passing move.** `tsc` was happy with
 * both files; only the PAIR was wrong.
 *
 * The exposure here is larger, because `phoneSlotGaps` IS a gate input: slots
 * trapped in the component would leave the gate reading columns the rep had
 * just edited past. Both ends call this function; `phoneSlotsSource.test.ts`
 * fails the build if either reaches for the columns directly.
 *
 * ⚠️ Keyed per patient by construction — the overlay is per item id — which is
 * what retires the hand-rolled "did the patient change?" guard the secondary
 * answer needed before it moved here.
 */
export function phoneSlotsFor(
  p: PhoneSource & { phoneSlotsEdited?: PhoneSlot[] | null },
): PhoneSlot[] {
  return p.phoneSlotsEdited ?? slotsFromPatient(p);
}

type CaregiverSource = { caregiverName: string; caregiverAuthorized: boolean };

/**
 * The caregiver details the screen edits — same overlay rule as the slots.
 * Board columns until the rep touches them, `caregiverEdited` afterwards.
 */
export function caregiverFor(
  p: CaregiverSource & { caregiverEdited?: CaregiverDetails | null },
): CaregiverDetails {
  if (p.caregiverEdited) return p.caregiverEdited;
  const { name, relationship } = parseCaregiver(p.caregiverName);
  return { name, relationship, authorized: p.caregiverAuthorized };
}

/**
 * Has the HIPAA tick just gone from off to on?
 *
 * ⚠️ Compared against what the BOARD holds, not against "is it ticked now" —
 * otherwise every subsequent send re-stamps the same consent line into the
 * notes and the log fills with claims about one conversation. The same
 * before-the-write comparison `advancerNoop` makes, and for the same reason:
 * "already true" and "just became true" are different facts.
 */
export function caregiverConsentJustGiven(
  p: CaregiverSource & { caregiverEdited?: CaregiverDetails | null },
): boolean {
  return !p.caregiverAuthorized && caregiverFor(p).authorized;
}

/**
 * The audit line stamped into Welcome Call notes when the tick goes on.
 *
 * ⚠️ Deliberately carries NO date and NO initials of its own: every note in
 * this app goes through `shared/noteStamp`, whose stamp is
 * `[ET timestamp] <Stage>: <text> —<initials>`. Brandon's handoff spells the
 * line out as "…, [date], [rep]" because he was describing the whole record,
 * not asking for a second copy of two fields the stamp already supplies —
 * repeating them would read as a different date from the one beside it the
 * moment anything drifted.
 */
export function caregiverConsentNote(): string {
  return "Caregiver authorized — verbal consent on welcome call";
}
