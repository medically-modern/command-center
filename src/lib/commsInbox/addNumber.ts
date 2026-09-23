/**
 * "This number is that patient" — an unmatched item's three ways out
 * (COMMS_INBOX_PLAN.md §6, Josh's D1: *"fine"*):
 *
 *   [Add as alternate phone]  (replaces (555) 555-0100)
 *   Use as primary phone instead
 *   Pick someone else
 *
 * ⚠️⚠️ **THROUGH THE EXISTING WRITERS ONLY — never a hand-rolled mutation.**
 * The values come from `contactEdit` (`contactWrites` for the primary, which
 * clears Can Text; `alternatePhoneWrites` for the alternate, which touches the
 * Alternate Phone column and nothing else) and go out through the one mutation,
 * `dossierApi.updatePatientContact`.
 *
 * ⚠️ **The refusal is checked BEFORE the write** (§5.32d): `planPhoneWrite`
 * skips a number it cannot parse, so an unchecked save would report success
 * having written nothing.
 *
 * ⚠️ **Monday first, the link second.** If the Monday write fails, nothing
 * else happens and the rep retries; the link is written only once the number is
 * on the record, so the inbox never claims a number the record does not carry.
 * A LINK-ONLY pick (no Edit profile, no Alternate Phone column, a completed
 * record) writes the link alone — that is inbox state, and writes nothing to
 * Monday at all.
 */
import { alternatePhoneColId, alternatePhoneWrites, contactWrites, currentAlternatePhone, phoneRefusal, type ContactTarget } from "@/lib/patient/contactEdit";

export type AddAs = "alternate" | "primary" | "link";

export interface AddNumberOptions {
  /** "Add as alternate phone" — null when the board has no such column. */
  alternate: { replaces: string } | null;
  /** "Use as primary phone instead". */
  primary: boolean;
  /** Why a Monday write is not offered, or "" — shown beside "Link to <name>". */
  writeRefusal: string;
}

/**
 * What the card offers for this patient.
 *
 * ⚠️ Gated on Edit profile, like the phone pencil (§5.39h). Without it the rep
 * can still LINK the number — that is the inbox's own state, never the record.
 */
export function addNumberOptions(target: ContactTarget | null, canEdit: boolean): AddNumberOptions {
  if (!target) return { alternate: null, primary: false, writeRefusal: "There is no record to write the number to." };
  if (target.refusal) return { alternate: null, primary: false, writeRefusal: target.refusal };
  if (!canEdit) {
    return { alternate: null, primary: false, writeRefusal: "Adding a number to a patient's record needs Edit profile." };
  }
  const alt = alternatePhoneColId(target);
  return {
    alternate: alt ? { replaces: currentAlternatePhone(target) } : null,
    primary: true,
    writeRefusal: alt
      ? ""
      : `This patient's ${boardNoun(target)} record has no alternate phone, so the number can be linked here or made their primary.`,
  };
}

function boardNoun(t: ContactTarget): string {
  return t.item.boardName || "current";
}

export interface AddNumberDeps {
  updatePatientContact: (opts: {
    boardId: number;
    itemId: string;
    values: Record<string, unknown>;
    phone: string;
    nextPhone?: string;
  }) => Promise<void>;
  linkNumber: (opts: {
    key: string;
    boardId: number;
    itemId: string;
    name: string;
    anchorNumber: string;
    last4: string;
  }) => Promise<{ key: string }>;
  forgetDirectoryName: (key: string) => void;
}

/**
 * Do it: the Monday write (unless link-only), then the link, then forget the
 * browser's cached "Unknown" for the number.
 *
 * @param key      the unmatched item's key (`n:<hmac>`)
 * @param number   the item's full number (E.164)
 * @param target   the picked patient's anchor record (`contactTarget`)
 * @param name     the patient's name, for the link
 * @returns the key the item lives under now — the patient's
 * @throws on a refusal or a failed write, with a sentence for the rep
 */
export async function addNumberToPatient(
  as: AddAs,
  { key, number, target, name }: { key: string; number: string; target: ContactTarget; name: string },
  deps: AddNumberDeps,
): Promise<{ key: string }> {
  const refusal = phoneRefusal(number);
  if (refusal) throw new Error(refusal);
  const item = target.item;
  const digits = String(number).replace(/\D/g, "");
  const last4 = digits.slice(-4);

  if (as !== "link") {
    if (target.refusal) throw new Error(target.refusal);
    const values = as === "alternate" ? alternatePhoneWrites(target, number) : contactWrites(target, "phone", number);
    if (!Object.keys(values).length) throw new Error("This record has no column for that number.");
    await deps.updatePatientContact({
      boardId: item.boardId,
      itemId: item.itemId,
      values,
      phone: item.phone || number,
      nextPhone: as === "primary" ? number : undefined,
    });
  }

  // The link follows the patient through their OWN primary number — which,
  // after "Use as primary", is this one.
  const anchorNumber = as === "primary" ? number : item.phone || number;
  const out = await deps.linkNumber({ key, boardId: item.boardId, itemId: item.itemId, name, anchorNumber, last4 });
  deps.forgetDirectoryName(digits.slice(-10));
  return out;
}
