/**
 * One editable fact in the patient screen's top bar — Email or Phone (§5.46g).
 *
 * Brandon's card is *Patient name · DOB · Email · Phone with the edit pencil*.
 * Live rendered name · DOB · phone, read-only, and the email was not on the
 * screen at all — while §5.31h had just made that same column editable one
 * stage over, precisely because three things on this screen are dead without
 * it (the Calendly chip, the Messages tab's email side, and the booking
 * mirror's only join).
 */
import { useEffect, useState } from "react";
import { Check, Mail, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { updatePatientContact } from "@/lib/commsHub/dossierApi";
import { formatPhoneParen } from "@/lib/shared/phoneDisplay";
import {
  contactWrites,
  emailRefusal,
  phoneRefusal,
  type ContactField,
  type ContactTarget,
} from "@/lib/patient/contactEdit";

interface Props {
  label: string;
  value: string;
  missing?: boolean;
  field: ContactField;
  /** Which record a save writes to, and why it may not. Null while loading. */
  target: ContactTarget | null;
  /** The number the dossier was looked up by — the cache key. */
  lookupPhone: string;
  canEdit: boolean;
  /** Re-read the record, so every other reader of these columns agrees. */
  onSaved: () => void;
}

export function TopBarContact({
  label,
  value,
  missing,
  field,
  target,
  lookupPhone,
  canEdit,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  // ⚠️ §9's notes-box rule: a draft that outlives the value it was started
  // from would be saved onto whatever is on screen now. The caller keys the
  // whole card on the record, and this closes on any change of the value too.
  useEffect(() => {
    setOpen(false);
    setDraft(value);
  }, [value]);

  const column = field === "email" ? target?.emailColId : target?.phoneColId;
  const why = !canEdit
    ? "Edit profile is not assigned — ask an admin on the Users page."
    : !target
      ? "This patient's record hasn't loaded yet."
      : target.refusal
        ? target.refusal
        : !column
          ? `The ${target.item.boardName} board has no ${label.toLowerCase()} column, so there is nothing to write to.`
          : "";

  const refusal = field === "email" ? emailRefusal(draft) : phoneRefusal(draft);

  async function save() {
    if (!target || why || refusal || saving) return;
    setSaving(true);
    try {
      const values = contactWrites(target, field, draft);
      await updatePatientContact({
        boardId: target.item.boardId,
        itemId: target.item.itemId,
        values,
        phone: lookupPhone,
        ...(field === "phone" ? { nextPhone: draft.trim() } : {}),
      });
      toast.success(draft.trim() ? `${label} saved` : `${label} cleared`);
      setOpen(false);
      onSaved();
    } catch (e) {
      // ⚠️ The box STAYS OPEN holding what they typed, so a rep fixes it rather
      // than retyping an address they just read off a call (§5.31h).
      toast.error(e instanceof Error ? e.message : `Couldn't save the ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="fact">
        <div className="k">{label}</div>
        <div className={`v tbc${missing ? " gone" : ""}`}>
          {/* Brandon renders the address as a mailto and the number in the
              primary colour; a blank is the em dash every other fact uses. */}
          {missing ? (
            value
          ) : field === "email" ? (
            <a href={`mailto:${value}`}>{value}</a>
          ) : (
            /* Printed as (xxx) xxx-xxxx (Brandon's pixel-match, item 2); the
               pencil still edits the value exactly as the board holds it. */
            <b>{formatPhoneParen(value) || value}</b>
          )}
          {/* ⚠️ SHOWN and inert rather than hidden when it may not be pressed —
              §5.39h's AbilityLock rule, because a control that simply vanishes
              teaches a rep the screen cannot do the thing at all. */}
          <button
            type="button"
            className="btn ghost xs tbpen"
            aria-disabled={why ? true : undefined}
            title={why || `Edit ${label.toLowerCase()}`}
            onClick={() => !why && setOpen(true)}
          >
            <Pencil style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fact">
      <div className="k">{label}</div>
      <div className="v tbc tbedit">
        <input
          className="tbinput"
          value={draft}
          autoFocus
          type={field === "email" ? "email" : "tel"}
          placeholder={field === "email" ? "name@example.com" : "(555) 555-0100"}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <button
          type="button"
          className="btn ghost xs tbpen"
          disabled={saving || !!refusal}
          title={refusal || "Save"}
          onClick={() => void save()}
        >
          <Check style={{ width: 12, height: 12 }} />
        </button>
        <button
          type="button"
          className="btn ghost xs tbpen"
          disabled={saving}
          title="Cancel"
          onClick={() => {
            setDraft(value);
            setOpen(false);
          }}
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>
      {/* ⚠️ Named BEFORE the write, never after: `planPhoneWrite` and
          `planEmailWrite` skip a value they cannot parse rather than throwing,
          so an unchecked save comes back green having written nothing. */}
      {refusal && <div className="xs tbwhy">{refusal}</div>}
      {field === "email" && !refusal && draft.trim() !== value.trim() && (
        <div className="xs tbwhy muted">
          <Mail style={{ width: 10, height: 10, verticalAlign: -1 }} /> Calendly and the Messages
          tab join on this exact address.
        </div>
      )}
    </div>
  );
}
