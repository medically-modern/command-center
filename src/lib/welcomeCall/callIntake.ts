/**
 * lib/welcomeCall/callIntake.ts — the Welcome Call facts that have NO Monday
 * column, captured in the UI and round-tripped through the **Notes** column.
 *
 * ── WHY THIS EXISTS ──
 * The Aug-2026 ops redesign asked Welcome Call to collect nine things the board
 * cannot hold: five confirmation flags (pump type read back verbally, address,
 * primary insurance, secondary insurance, out-of-pocket reviewed), a confirmed
 * OOP amount, a supply length, a tri-state "does this patient have secondary
 * coverage", extra phone numbers with a preferred flag, a caretaker block, and
 * free-text auth notes. Adding eleven columns to a board five other stages read
 * was explicitly ruled out (Josh, 2026-08) — this is a logic change, not a
 * schema change.
 *
 * So the rep's answers are serialised into ONE delimited block appended to the
 * Welcome Call Notes column (`long_text_mm2ffsme`) when they press Send to
 * Monday, and parsed back out on load. Monday is still the store; the notes
 * column is just carrying a structured payload alongside the prose.
 *
 * ── THE FORMAT IS A CONTRACT ──
 * Human-readable AND machine-parseable, in that order of priority: this column
 * is read by reps in three stages and hop-copied forward to Subscription, so a
 * wall of opaque codes would be a real ops cost. Hence `Label: value` lines
 * between two sentinels rather than JSON.
 *
 *     [Aug 28, 2026, 2:33 PM] Welcome Call: Call intake —JH
 *     --- WC INTAKE v1 ---
 *     Confirmed: pump, address, primary
 *     Unconfirmed: secondary, oop
 *     Secondary coverage: Unknown
 *     Supply length: 90 days (override)
 *     OOP amount: $42.50
 *     Phones: 3475550101 (cell, preferred); 7185550199 (home)
 *     Caretaker: Jane Doe · Daughter · 3475550102 · jane@x.com · authorized
 *     Caretaker notes: Prefers calls after 5pm
 *     Auth notes: Sensors auth resubmitted 8/20, awaiting response
 *     --- END WC INTAKE ---
 *
 * ⚠️ **Confirm flags are stored as KEYS, not prose.** "Confirmed: pump type
 * (verbal), address" would be ambiguous to split — the pretty labels live in
 * `CONFIRM_LABELS` for the UI only. The block keeps the short keys so a comma
 * split is exact.
 *
 * ⚠️ **Both Confirmed and Unconfirmed lines are emitted**, even when one is
 * empty (rendered as `none`). What the rep did NOT confirm is the operationally
 * interesting half, and a missing line would be indistinguishable from an older
 * block written before that flag existed.
 *
 * ⚠️ **The parser reads the LAST block in the log.** Every send appends another
 * one, so the newest is current state and the older ones are history — which is
 * exactly what an append-only notes column is for. Never dedupe or rewrite the
 * earlier blocks; they are the audit trail.
 *
 * ⚠️ Free text is sanitised: newlines become " / " and the sentinels are
 * stripped. A caretaker note containing "--- END WC INTAKE ---" would otherwise
 * truncate the block and silently drop every field after it.
 *
 * ⚠️ Callers MUST run the composed notes body through
 * `assertLongTextFits` (lib/shared/longText.ts) before writing. Monday's
 * long-text columns hold 2000 characters and truncate SILENTLY, dropping the
 * newest content — i.e. exactly this block (CLAUDE.md §10).
 */
import { stampNoteEntry, appendNoteEntry } from "@/lib/shared/noteStamp";

/* ── Sentinels ── */

export const INTAKE_BLOCK_START = "--- WC INTAKE v1 ---";
export const INTAKE_BLOCK_END = "--- END WC INTAKE ---";

/** The stage label on the stamp line, matching every other Welcome Call note. */
const STAGE_LABEL = "Welcome Call";

/* ── Model ── */

/** The five things a rep reads back to the patient and ticks off. */
export type ConfirmKey = "pump" | "address" | "primary" | "secondary" | "oop";

export const CONFIRM_KEYS: ConfirmKey[] = ["pump", "address", "primary", "secondary", "oop"];

/** UI-facing wording. The BLOCK stores the key, never these strings. */
export const CONFIRM_LABELS: Record<ConfirmKey, string> = {
  pump: "Pump type confirmed verbally",
  address: "Address confirmed with patient",
  primary: "Primary insurance confirmed",
  secondary: "Secondary insurance confirmed",
  oop: "Out-of-pocket reviewed with patient",
};

/** Does the patient have secondary coverage? "Unknown" is the whole point —
 *  the board's Secondary Insurance column can say None but cannot say unsure. */
export type SecondaryCoverage = "" | "yes" | "no" | "unknown";

/** Days of supply the payer allows for this order. No board column holds it. */
export type SupplyLength = "" | "30" | "60" | "90";

export const SUPPLY_LENGTHS: SupplyLength[] = ["30", "60", "90"];

export type PhoneKind = "cell" | "home" | "work" | "other";

export const PHONE_KINDS: PhoneKind[] = ["cell", "home", "work", "other"];

export interface IntakePhone {
  number: string;
  kind: PhoneKind;
  /** Marks which number the patient actually wants us to use. The board's one
   *  `Pt. Phone` column stays the system of record; this says "ring that one". */
  preferred: boolean;
}

export interface Caretaker {
  name: string;
  relationship: string;
  phone: string;
  email: string;
  /** HIPAA-relevant: may we discuss the patient's care with this person. */
  authorized: boolean;
  notes: string;
}

export interface CallIntake {
  confirmed: Record<ConfirmKey, boolean>;
  secondaryCoverage: SecondaryCoverage;
  supplyLength: SupplyLength;
  /** True once the REP picked the supply length, rather than the payer rule
   *  deriving it. Recorded because "who chose this?" cannot be recovered by
   *  comparing values: an override that happens to equal the derived number is
   *  indistinguishable from a derived one, so a later payer change would
   *  silently replace the rep's choice. It also makes the note self-describing
   *  — a reader can see whether the length was policy or a decision. */
  supplyLengthManual: boolean;
  /** What the rep actually quoted the patient, as typed. Free text on purpose —
   *  reps say "about $40" and "$0 with Medicaid" as often as a clean number. */
  oopAmount: string;
  /** Numbers BEYOND the board's `Pt. Phone`. Bounded so the block can't grow
   *  without limit against the 2000-character ceiling. */
  phones: IntakePhone[];
  caretaker: Caretaker;
  authNotes: string;
}

/** Hard cap on extra numbers — see the 2000-character note in the header. */
export const MAX_EXTRA_PHONES = 4;

export const EMPTY_CARETAKER: Caretaker = {
  name: "",
  relationship: "",
  phone: "",
  email: "",
  authorized: false,
  notes: "",
};

export function emptyIntake(): CallIntake {
  return {
    confirmed: { pump: false, address: false, primary: false, secondary: false, oop: false },
    secondaryCoverage: "",
    supplyLength: "",
    supplyLengthManual: false,
    oopAmount: "",
    phones: [],
    caretaker: { ...EMPTY_CARETAKER },
    authNotes: "",
  };
}

/** Has the rep put anything in? Nothing is written when this is false, so an
 *  untouched call never appends an empty block to the notes log. */
export function intakeHasContent(i: CallIntake | null | undefined): boolean {
  if (!i) return false;
  if (CONFIRM_KEYS.some((k) => i.confirmed[k])) return true;
  if (i.secondaryCoverage || i.supplyLength || i.oopAmount.trim() || i.authNotes.trim()) return true;
  if (i.phones.some((p) => p.number.trim())) return true;
  const c = i.caretaker;
  return !!(c.name.trim() || c.relationship.trim() || c.phone.trim() || c.email.trim() || c.notes.trim());
}

/* ── Serialise ── */

/** Collapse to one line and remove anything that could break the block. */
function oneLine(text: string): string {
  return text
    .replace(/\r?\n+/g, " / ")
    .split(INTAKE_BLOCK_END).join("")
    .split(INTAKE_BLOCK_START).join("")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function formatPhone(p: IntakePhone): string {
  const flags = [p.kind, p.preferred ? "preferred" : ""].filter(Boolean).join(", ");
  return `${oneLine(p.number)} (${flags})`;
}

/**
 * ⚠️ The relationship is NOT on this line — it has one of its own.
 *
 * Name and relationship are the only free-text caretaker fields; phone, email
 * and the authorized keyword all identify themselves. With both on one
 * positional line, blank fields are dropped and the reader mixes them up:
 * "Daughter · not authorized" came back as name="Daughter".
 *
 * Marking the relationship instead — "(Daughter)" — only MOVED the ambiguity:
 * a rep whose caretaker is named "(AJ)" then has that read as a relationship
 * and the name cleared. Any rule that infers a field from the SHAPE of free
 * text has some value that defeats it.
 *
 * So the name is the only free-text field on this line, and the relationship
 * gets its own labelled one. Nothing is guessed, and both round-trip whatever
 * the rep types.
 */
function formatCaretaker(c: Caretaker): string {
  return [
    oneLine(c.name),
    oneLine(c.phone),
    oneLine(c.email),
    c.authorized ? "authorized" : "not authorized",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The block body, WITHOUT the stamp line. Only lines with content are emitted,
 * except the Confirmed/Unconfirmed pair — see the header for why both always go.
 */
export function formatIntakeBlock(intake: CallIntake): string {
  const lines: string[] = [];

  const yes = CONFIRM_KEYS.filter((k) => intake.confirmed[k]);
  const no = CONFIRM_KEYS.filter((k) => !intake.confirmed[k]);
  lines.push(`Confirmed: ${yes.length ? yes.join(", ") : "none"}`);
  lines.push(`Unconfirmed: ${no.length ? no.join(", ") : "none"}`);

  if (intake.secondaryCoverage) lines.push(`Secondary coverage: ${titleCase(intake.secondaryCoverage)}`);
  if (intake.supplyLength)
    lines.push(`Supply length: ${intake.supplyLength} days${intake.supplyLengthManual ? " (override)" : ""}`);
  if (intake.oopAmount.trim()) lines.push(`OOP amount: ${oneLine(intake.oopAmount)}`);

  const phones = intake.phones.filter((p) => p.number.trim());
  if (phones.length) lines.push(`Phones: ${phones.map(formatPhone).join("; ")}`);

  const c = intake.caretaker;
  if (c.name.trim() || c.phone.trim() || c.email.trim() || c.relationship.trim()) {
    lines.push(`Caretaker: ${formatCaretaker(c)}`);
  }
  if (c.relationship.trim()) lines.push(`Caretaker relationship: ${oneLine(c.relationship)}`);
  if (c.notes.trim()) lines.push(`Caretaker notes: ${oneLine(c.notes)}`);
  if (intake.authNotes.trim()) lines.push(`Auth notes: ${oneLine(intake.authNotes)}`);

  return [INTAKE_BLOCK_START, ...lines, INTAKE_BLOCK_END].join("\n");
}

/**
 * The full stamped entry — stamp line, then the block. `opts` is injectable so
 * tests don't depend on the clock or the signed-in user.
 */
export function stampedIntakeEntry(
  intake: CallIntake,
  opts?: { initials?: string; now?: Date },
): string {
  const stamp = stampNoteEntry("Call intake", STAGE_LABEL, opts);
  return `${stamp}\n${formatIntakeBlock(intake)}`;
}

/**
 * Append the intake block to an existing notes log. Returns the log unchanged
 * when there is nothing to record, so a rep who never touched these fields
 * doesn't get an empty block on every send.
 */
export function appendIntakeToNotes(
  notes: string | undefined,
  intake: CallIntake | null | undefined,
  opts?: { initials?: string; now?: Date },
): string {
  if (!intakeHasContent(intake)) return notes ?? "";
  return appendNoteEntry(notes, stampedIntakeEntry(intake!, opts));
}

/* ── Parse ── */

function splitKv(line: string): [string, string] | null {
  const i = line.indexOf(":");
  if (i <= 0) return null;
  return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}

function parsePhone(chunk: string): IntakePhone | null {
  const m = chunk.trim().match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const number = (m ? m[1] : chunk).trim();
  if (!number) return null;
  const flags = (m ? m[2] : "").split(",").map((f) => f.trim().toLowerCase()).filter(Boolean);
  const kind = (PHONE_KINDS.find((k) => flags.includes(k)) ?? "other") as PhoneKind;
  return { number, kind, preferred: flags.includes("preferred") };
}

function parseCaretaker(value: string): Caretaker {
  const parts = value.split("·").map((p) => p.trim());
  const c: Caretaker = { ...EMPTY_CARETAKER };
  for (const part of parts) {
    if (!part) continue;
    const low = part.toLowerCase();
    if (low === "authorized") { c.authorized = true; continue; }
    if (low === "not authorized") { c.authorized = false; continue; }
    if (part.includes("@")) { c.email = part; continue; }
    // A part that is mostly digits is the phone.
    if (/^[+()\d\s.-]{7,}$/.test(part)) { c.phone = part; continue; }
    // The name is the only free-text field this line carries. A SECOND
    // free-text part can only come from a block written before the
    // relationship moved to its own line, so it is read positionally, with any
    // wrapping parens from the interim marked format stripped off.
    if (!c.name) c.name = part;
    else if (!c.relationship) c.relationship = part.replace(/^\((.*)\)$/, "$1").trim();
  }
  return c;
}

/**
 * Read the LAST intake block out of a notes log. Returns null when the log has
 * none — an older patient, or one whose rep never filled these in.
 *
 * Tolerant by design: an unrecognised label is ignored rather than throwing, so
 * a future field added to the writer can't break an older reader.
 */
export function parseIntakeBlock(notes: string | undefined | null): CallIntake | null {
  if (!notes) return null;
  const startIdx = notes.lastIndexOf(INTAKE_BLOCK_START);
  if (startIdx === -1) return null;
  const after = notes.slice(startIdx + INTAKE_BLOCK_START.length);
  const endIdx = after.indexOf(INTAKE_BLOCK_END);
  const body = endIdx === -1 ? after : after.slice(0, endIdx);

  const intake = emptyIntake();
  let sawConfirmLine = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const kv = splitKv(line);
    if (!kv) continue;
    const [label, value] = kv;

    switch (label.toLowerCase()) {
      case "confirmed": {
        sawConfirmLine = true;
        const keys = value.split(",").map((k) => k.trim().toLowerCase());
        for (const k of CONFIRM_KEYS) if (keys.includes(k)) intake.confirmed[k] = true;
        break;
      }
      case "unconfirmed":
        sawConfirmLine = true;
        break;
      case "secondary coverage": {
        const v = value.toLowerCase();
        if (v === "yes" || v === "no" || v === "unknown") intake.secondaryCoverage = v;
        break;
      }
      case "supply length": {
        const m = value.match(/\d+/);
        const v = m ? (m[0] as SupplyLength) : "";
        if (SUPPLY_LENGTHS.includes(v)) intake.supplyLength = v;
        intake.supplyLengthManual = /\(override\)/i.test(value);
        break;
      }
      case "oop amount":
        intake.oopAmount = value;
        break;
      case "phones":
        intake.phones = value
          .split(";")
          .map(parsePhone)
          .filter((p): p is IntakePhone => p !== null)
          .slice(0, MAX_EXTRA_PHONES);
        break;
      case "caretaker": {
        // Keep what the dedicated lines already set — line order is not
        // guaranteed, and those values are exact where this line's are inferred.
        const parsed = parseCaretaker(value);
        intake.caretaker = {
          ...parsed,
          relationship: intake.caretaker.relationship || parsed.relationship,
          notes: intake.caretaker.notes,
        };
        break;
      }
      case "caretaker relationship":
        intake.caretaker.relationship = value;
        break;
      case "caretaker notes":
        intake.caretaker.notes = value;
        break;
      case "auth notes":
        intake.authNotes = value;
        break;
      default:
        break;
    }
  }

  // A block with a sentinel but no recognisable content is still a block —
  // report it so the caller doesn't fall back to a blank form and re-append.
  return sawConfirmLine || intakeHasContent(intake) ? intake : null;
}
