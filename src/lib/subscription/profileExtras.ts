/**
 * The Subscription-board columns the patient screen's Profile tab reads and
 * writes that `/subscription` does not (Brandon's pixel-match, 2026-09-24;
 * PIXEL_MATCH_PLAN.md §1 · §4.1 — Josh: *"1. YES"*).
 *
 * Every column here already exists on the board and was read back live on
 * 2026-09-24. None of them is new; what is new is that the app writes some of
 * them. Brandon's layout asks for:
 *
 *  - **Frequency** on the Order details card → Order Frequency `color_mm48kv1c`
 *    (the column the Welcome Call → Subscription hops fill; §5.31c).
 *  - **CGM qty · Cartridges qty** → `numeric_mm3sr332` · `numeric_mm3sfe56`.
 *  - **Editable Contacts** in Demographics → the five contact columns §5.31d
 *    created on this board (Primary / Alternate Contact, Caregiver Name,
 *    Caregiver Authorized, Alternate Phone).
 *  - **Last eligibility check · OOP remaining** in Insurance → read only.
 *
 * ⚠️⚠️ **`/subscription` IS UNTOUCHED BY THIS MODULE.** Its read set
 * (`READ_COLUMN_IDS`), its mapping and its send are exactly what they were:
 * these columns ride an OPTIONAL extra list on `fetchItemById` that only the
 * patient screen passes, and the send writes them only when it is handed an
 * `extras` change set, which only the patient screen builds.
 *
 * ⚠️⚠️ **ONLY WHAT THE REP CHANGED IS WRITTEN** (`diffExtras`). Unlike the
 * `Patient` send — which re-writes every board-mirrored column from a record
 * read at the press (§5.45b) — these columns are written as a delta. A value
 * read when the tab opened is never written back, so a Contacts block the
 * Welcome Call send filled in since cannot be put back to what it was.
 * A phone is compared by `phoneDigits`, so a reformat of the same number (or
 * the board's leading 1) is not a change.
 *
 * ⚠️ **Status columns are written by the LIVE label id, never a number from
 * here** — the caller resolves it through `useStatusOptions` (§5.2's rule).
 * Monday derives a new label's id from its colour, not the index asked for, and
 * drops a write to an id the column does not have at HTTP 200 with nothing in
 * the logs (§5.12 · §5.20 · §5.31c · §5.31d · §5.33 · §5.36). So this module
 * carries no label ids at all.
 *
 * ⚠️ **A blank Can Text is UNKNOWN, never a No** (§5.31d) — and it is shown,
 * never edited, here: Can Text is the starred phone slot's answer and belongs
 * to the Welcome Call stage page's rules (clearing it when a number changes).
 */
import type { MondayItem } from "./mondayApi";
import { phoneDigits, phoneRejectionReason } from "../shared/phoneCell";

/** Column ids on the Subscription board (18407459988). */
export const EXTRA_COL = {
  orderFrequency: "color_mm48kv1c",
  cgmQty: "numeric_mm3sr332",
  cartridgeQty: "numeric_mm3sfe56",
  primaryContact: "color_mm72vm7p",
  alternateContact: "color_mm723hfk",
  caregiverName: "text_mm72mdzk",
  caregiverAuthorized: "boolean_mm72nt75",
  alternatePhone: "phone_mm72r19q",
  canText: "color_mm72jg9e",
  lastPatientContact: "text_mm5frhe9",
  lastEligibilityCheck: "date_mm43n083",
  oopRemaining: "text_mm3gs345",
} as const;

/** What the patient screen adds to the one record read it makes. */
export const PROFILE_EXTRA_COLUMN_IDS: readonly string[] = Object.values(EXTRA_COL);

/** The status columns among them — resolved to LIVE label ids by the caller. */
export const EXTRA_STATUS_COLS = [
  EXTRA_COL.orderFrequency,
  EXTRA_COL.primaryContact,
  EXTRA_COL.alternateContact,
] as const;

/** The board's own values for the extra columns, as read. */
export interface ProfileExtras {
  orderFrequency: string;
  orderFrequencyIndex: number | null;
  cgmQty: string;
  cartridgeQty: string;
  primaryContact: string;
  primaryContactIndex: number | null;
  alternateContact: string;
  alternateContactIndex: number | null;
  caregiverName: string;
  caregiverAuthorized: boolean;
  /** Digits as the board stores them (the phone column's `value`). */
  alternatePhone: string;
  /** "Yes" · "No" · "" — read only (see the header). */
  canText: string;
  /** A machine string (§5.46e) — read only. */
  lastPatientContact: string;
  /** YYYY-MM-DD, or "". */
  lastEligibilityCheck: string;
  oopRemaining: string;
}

export const EMPTY_EXTRAS: ProfileExtras = {
  orderFrequency: "",
  orderFrequencyIndex: null,
  cgmQty: "",
  cartridgeQty: "",
  primaryContact: "",
  primaryContactIndex: null,
  alternateContact: "",
  alternateContactIndex: null,
  caregiverName: "",
  caregiverAuthorized: false,
  alternatePhone: "",
  canText: "",
  lastPatientContact: "",
  lastEligibilityCheck: "",
  oopRemaining: "",
};

function parse(v: string | null | undefined): Record<string, unknown> | null {
  if (!v) return null;
  try {
    const o = JSON.parse(v);
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Read the extra columns off a record fetched with `PROFILE_EXTRA_COLUMN_IDS`. */
export function readProfileExtras(item: MondayItem | null | undefined): ProfileExtras {
  if (!item) return EMPTY_EXTRAS;
  const cv = (id: string) => item.column_values.find((c) => c.id === id);
  const text = (id: string) => (cv(id)?.text ?? "").trim();
  /* ⚠️ A status label's id lives only in `value`; an unreadable one is NULL,
     never 0 — 0 is a real label id on these columns (§5.43). */
  const index = (id: string): number | null => {
    const n = parse(cv(id)?.value)?.index;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  /* ⚠️ A ticked Monday checkbox reads "v" as text (§5.46e), and its `value`
     carries `checked: "true"`. Either is enough; an unticked box is false —
     a checkbox has two states, not three. */
  const checked = (id: string): boolean => {
    const v = parse(cv(id)?.value);
    if (v && (v.checked === "true" || v.checked === true)) return true;
    return text(id) !== "";
  };
  const phone = (id: string): string => {
    const p = parse(cv(id)?.value)?.phone;
    return typeof p === "string" && p ? p : text(id);
  };
  return {
    orderFrequency: text(EXTRA_COL.orderFrequency),
    orderFrequencyIndex: index(EXTRA_COL.orderFrequency),
    cgmQty: text(EXTRA_COL.cgmQty),
    cartridgeQty: text(EXTRA_COL.cartridgeQty),
    primaryContact: text(EXTRA_COL.primaryContact),
    primaryContactIndex: index(EXTRA_COL.primaryContact),
    alternateContact: text(EXTRA_COL.alternateContact),
    alternateContactIndex: index(EXTRA_COL.alternateContact),
    caregiverName: text(EXTRA_COL.caregiverName),
    caregiverAuthorized: checked(EXTRA_COL.caregiverAuthorized),
    alternatePhone: phone(EXTRA_COL.alternatePhone),
    canText: text(EXTRA_COL.canText),
    lastPatientContact: text(EXTRA_COL.lastPatientContact),
    lastEligibilityCheck: text(EXTRA_COL.lastEligibilityCheck),
    oopRemaining: text(EXTRA_COL.oopRemaining),
  };
}

/**
 * A rep's edit to the writable extras. A status `null` means CLEAR the column,
 * a blank string clears a number, text or phone column.
 */
export interface ExtrasEdit {
  orderFrequencyIndex?: number | null;
  cgmQty?: string;
  cartridgeQty?: string;
  primaryContactIndex?: number | null;
  alternateContactIndex?: number | null;
  caregiverName?: string;
  caregiverAuthorized?: boolean;
  alternatePhone?: string;
}

/**
 * Keep only the fields that really differ from the board, so nothing the rep
 * did not change is written (see the header). A phone compared on DIGITS, so a
 * reformat of the same number is not a change.
 */
export function diffExtras(base: ProfileExtras, edit: ExtrasEdit): ExtrasEdit {
  const out: ExtrasEdit = {};
  if (edit.orderFrequencyIndex !== undefined && edit.orderFrequencyIndex !== base.orderFrequencyIndex)
    out.orderFrequencyIndex = edit.orderFrequencyIndex;
  if (edit.cgmQty !== undefined && edit.cgmQty.trim() !== base.cgmQty.trim()) out.cgmQty = edit.cgmQty.trim();
  if (edit.cartridgeQty !== undefined && edit.cartridgeQty.trim() !== base.cartridgeQty.trim())
    out.cartridgeQty = edit.cartridgeQty.trim();
  if (edit.primaryContactIndex !== undefined && edit.primaryContactIndex !== base.primaryContactIndex)
    out.primaryContactIndex = edit.primaryContactIndex;
  if (edit.alternateContactIndex !== undefined && edit.alternateContactIndex !== base.alternateContactIndex)
    out.alternateContactIndex = edit.alternateContactIndex;
  if (edit.caregiverName !== undefined && edit.caregiverName.trim() !== base.caregiverName.trim())
    out.caregiverName = edit.caregiverName.trim();
  if (edit.caregiverAuthorized !== undefined && edit.caregiverAuthorized !== base.caregiverAuthorized)
    out.caregiverAuthorized = edit.caregiverAuthorized;
  if (edit.alternatePhone !== undefined && phoneDigits(edit.alternatePhone) !== phoneDigits(base.alternatePhone))
    out.alternatePhone = edit.alternatePhone.trim();
  return out;
}

export function hasExtras(edit: ExtrasEdit): boolean {
  return Object.keys(edit).length > 0;
}

/** A whole, non-negative number of boxes, or blank. */
function qtyRefusal(label: string, v: string | undefined): string {
  if (v === undefined) return "";
  const t = v.trim();
  if (!t) return "";
  return /^\d+$/.test(t) ? "" : `${label} must be a whole number (or blank)`;
}

/**
 * Why a change set cannot be written, checked BEFORE the write.
 *
 * ⚠️ `writePhone` SKIPS a number it cannot parse rather than throwing (the
 * skip protects the big verified sends, §5.32d), so an unchecked alternate
 * phone would save green having written nothing. Same for a quantity that is
 * not a number: `String(Number("3 boxes"))` is "NaN", and the column would
 * take neither.
 */
export function extrasRefusals(edit: ExtrasEdit): string[] {
  const out: string[] = [];
  const q1 = qtyRefusal("CGM qty", edit.cgmQty);
  if (q1) out.push(q1);
  const q2 = qtyRefusal("Cartridges qty", edit.cartridgeQty);
  if (q2) out.push(q2);
  if (edit.alternatePhone !== undefined && edit.alternatePhone.trim()) {
    const why = phoneRejectionReason(edit.alternatePhone);
    if (why) out.push(`Alternate phone: ${why}`);
  }
  return out;
}
