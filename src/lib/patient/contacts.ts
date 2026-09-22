/**
 * CONTACTS — who we actually reach, and on which number (§5.46e).
 *
 * Josh, 2026-09-22: *"keep going, do the contacts block next / do everything"*,
 * under the framing that governs the whole diff list — *"he built this thinking
 * everything he was adding was already available in the command center, he just
 * wanted to change the ui"* — and, mid-build: *"it should just be re-routing
 * info for reads and writes (where applicable) … his mockup as our guide and to
 * get as close as possible without causing holes or issues"*.
 *
 * Brandon puts the same six columns in two places and live had them in neither:
 *
 * > "a **Contacts block** for patient-vs-caregiver, the columns just added to
 * > the Subscription board and mostly empty today: Primary contact
 * > color_mm72vm7p (Patient / Caregiver), Alternate contact color_mm723hfk,
 * > Caregiver name text_mm72mdzk, Caregiver authorized boolean_mm72nt75,
 * > Alternate phone phone_mm72r19q, Last patient contact text_mm5frhe9."
 *
 * > "when the board has an alternate phone phone_mm72r19q it is shown next to
 * > it with the caregiver's name and two small actions, Text alt and Call alt …
 * > Back to primary returns."
 *
 * ⚠️ **PER BOARD, because the right column serves a patient who has no
 * Subscription row yet.** The same family exists on **Welcome Call** (§5.31d
 * created both copies), which is where a rep actually fills them in on the
 * call — so a patient still in onboarding has a caregiver on that record and
 * nowhere else. Brandon names only the Subscription ids because his block is on
 * the Subscription profile; the column beside it is about the patient, not the
 * board. Every id below was read back from the live boards on 2026-09-22.
 *
 * ⚠️ **Last Patient Contact is SUBSCRIPTION-ONLY** — Welcome Call has no such
 * column (its full column list was read the same day), so that fact is `null`
 * there rather than guessed at.
 *
 * ⚠️ **Nothing here writes**, so no label INDEX is needed and none is declared.
 * That matters: the ids differ per board on every other status column in this
 * app, and a write is where that bites (§5.12 · §5.20 · §5.31c · §5.31d ·
 * §5.33 · §5.36). Reading `text` sidesteps it entirely.
 */
import { fmtPhone } from "../assignedPatients/format";

const SUBSCRIPTION_BOARD_ID = 18407459988;
const WELCOME_CALL_BOARD_ID = 18410804557;

type ContactCols = {
  primaryContact: string;
  alternateContact: string;
  caregiverName: string;
  caregiverAuthorized: string;
  alternatePhone: string;
  canText: string;
  /** Subscription only. */
  lastPatientContact: string | null;
};

export const CONTACT_COL: Record<number, ContactCols> = {
  [SUBSCRIPTION_BOARD_ID]: {
    primaryContact: "color_mm72vm7p",
    alternateContact: "color_mm723hfk",
    caregiverName: "text_mm72mdzk",
    caregiverAuthorized: "boolean_mm72nt75",
    alternatePhone: "phone_mm72r19q",
    canText: "color_mm72jg9e",
    lastPatientContact: "text_mm5frhe9",
  },
  [WELCOME_CALL_BOARD_ID]: {
    primaryContact: "color_mm72mjha",
    alternateContact: "color_mm72wngg",
    caregiverName: "text_mm727mrm",
    caregiverAuthorized: "boolean_mm72tf9z",
    alternatePhone: "phone_mm7265hp",
    canText: "color_mm72v5q7",
    lastPatientContact: null,
  },
};

/**
 * The columns this rule needs, for a board's dossier read.
 *
 * ⚠️ **Additive to the dossier and invisible in the Comms Hub**, the same shape
 * `reorderFormColumns` and `expectedItemsColumns` take: these ride
 * `dossierCols` beside `stageDetailColumns`, and `buildStageDetail` renders
 * from its own map only, so the pane a rep reads on a call is byte-identical.
 * Putting them in `stageDetail`'s maps instead would render them there as a
 * flat fact list, which is not what Brandon drew and is the two-readers hazard
 * §5.46b records for that map.
 */
export function contactsColumns(boardId: number): string[] {
  const c = CONTACT_COL[boardId];
  if (!c) return [];
  return [
    c.primaryContact,
    c.alternateContact,
    c.caregiverName,
    c.caregiverAuthorized,
    c.alternatePhone,
    c.canText,
    ...(c.lastPatientContact ? [c.lastPatientContact] : []),
  ];
}

/**
 * ⚠️ **A blank Can Text is UNKNOWN, never a No** — §5.31d's rule, and the one
 * thing on this screen that could do harm if it were read the other way: No
 * routes a patient's reorders to a call queue and, here, replaces the composer
 * with a block. Blank means nobody has asked.
 */
export type CanText = "yes" | "no" | "unknown";

export type Contacts = {
  /** "Patient" · "Caregiver" · "" — the board's own label, read verbatim. */
  primaryContact: string;
  alternateContact: string;
  caregiverName: string;
  /** The checkbox is two-state: ticked, or not ticked by anybody. */
  caregiverAuthorized: boolean;
  /** Formatted for display; "" when the board has none. */
  alternatePhone: string;
  /** The digits, for a `tel:` href and for the thread. */
  alternatePhoneRaw: string;
  canText: CanText;
  /** Formatted; "" when the board has none or the column does not exist. */
  lastPatientContact: string;
  /** Whether ANY of the six is filled in — what decides if the block has
   *  anything to say beyond em dashes. */
  any: boolean;
};

const EMPTY: Contacts = {
  primaryContact: "",
  alternateContact: "",
  caregiverName: "",
  caregiverAuthorized: false,
  alternatePhone: "",
  alternatePhoneRaw: "",
  canText: "unknown",
  lastPatientContact: "",
  any: false,
};

export function buildContacts(
  boardId: number,
  cols: Record<string, string> | undefined,
): Contacts | null {
  const c = CONTACT_COL[boardId];
  if (!c) return null;
  const get = (id: string | null) => (id ? (cols?.[id] ?? "").trim() : "");

  const rawAlt = get(c.alternatePhone);
  const primaryContact = get(c.primaryContact);
  const alternateContact = get(c.alternateContact);
  const caregiverName = get(c.caregiverName);
  // ⚠️ Monday returns a ticked checkbox's `text` as the literal **"v"**, not
  // "Yes"/"true" — measured on the live board. Anything non-blank is ticked;
  // the exact glyph is not depended on.
  const caregiverAuthorized = !!get(c.caregiverAuthorized);
  const canText = readCanText(get(c.canText));
  const lastPatientContact = formatLastContact(get(c.lastPatientContact));

  return {
    primaryContact,
    alternateContact,
    caregiverName,
    caregiverAuthorized,
    alternatePhone: rawAlt ? fmtPhone(rawAlt) : "",
    alternatePhoneRaw: rawAlt,
    canText,
    lastPatientContact,
    any: !!(
      primaryContact ||
      alternateContact ||
      caregiverName ||
      caregiverAuthorized ||
      rawAlt ||
      canText !== "unknown" ||
      lastPatientContact
    ),
  };
}

/**
 * The record the RIGHT COLUMN's phone line is about.
 *
 * Prefer the patient's LIVE record — it is what the notes strip above already
 * reads, so the column stays about one record — and fall back to any record
 * that carries a filled-in block. ⚠️ The fallback is the point: a patient
 * sitting in Insurance has no contacts columns on their live board at all, and
 * their caregiver is on the Welcome Call record. Contacts are a fact about the
 * human, not about the cycle, so an older record is still right.
 *
 * ⚠️ Returns `null` only when NO record maps — never an invented blank block,
 * because "this board does not carry contacts" and "nobody has filled them in"
 * are different answers and the column renders differently for each.
 */
export function contactsFor(
  items: readonly { itemId: string; boardId: number; cols?: Record<string, string> }[],
  activeItemId?: string,
): Contacts | null {
  const active = activeItemId ? items.find((i) => i.itemId === activeItemId) : undefined;
  const fromActive = active ? buildContacts(active.boardId, active.cols) : null;
  if (fromActive?.any) return fromActive;

  for (const it of items) {
    if (it.itemId === activeItemId) continue;
    const c = buildContacts(it.boardId, it.cols);
    if (c?.any) return c;
  }
  return fromActive;
}

/** ⚠️ An unrecognised label is UNKNOWN, never a No (§5.20's `networkLabel`
 *  rule, and §5.31d's for this exact column). */
export function readCanText(label: string): CanText {
  const v = label.trim().toLowerCase();
  if (v === "yes") return "yes";
  if (v === "no") return "no";
  return "unknown";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LAST_CONTACT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?:\s+in\s+(.+))?$/;

/**
 * Last Patient Contact arrives as a machine string — `2026-09-17T19:59 in call`
 * — written by something outside this repo, so it is formatted rather than
 * re-derived.
 *
 * ⚠️ **Never through `new Date()`.** These boards' timestamps are naive Eastern
 * wall clock (§5.15) and this one carries no zone at all, so parsing it as an
 * instant shifts it by the container's offset and lands on the wrong day either
 * side of midnight. The parts are reassembled arithmetically.
 *
 * ⚠️ **A value that matches no shape is returned VERBATIM** (§5.20): the column
 * has one writer today and a formatter that guesses at an unfamiliar string
 * prints a wrong time rather than an ugly one.
 */
export function formatLastContact(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const m = LAST_CONTACT.exec(v);
  if (!m) return v;
  const [, y, mo, d, hh, mm, channel] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return v;
  const h24 = Number(hh);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const when = `${month} ${Number(d)}, ${y}, ${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
  return channel ? `${when} · ${channel.trim()}` : when;
}
