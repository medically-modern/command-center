/**
 * Intake Warnings — what the benefits check says a rep must know, or must
 * confirm, before a patient leaves the intake stage (Brandon, 2026-09-24;
 * Josh's answers the same day). §5.20b.
 *
 * stedi-monday-integration writes `Intake Warnings` (`long_text_mm7g4b4h`)
 * after every SUCCESSFUL benefits check — one warning per line:
 *
 *     KEY|TYPE|message
 *
 * TYPE is `BLOCK` (the patient can't be advanced — tell them) or
 * `CONFIRM:<checkbox label>` (a rep has to tick that they checked it). A check
 * with no warnings CLEARS the column; a failed check writes nothing, so the
 * last successful check's warnings stand. KEYs on 2026-09-24:
 * MEDICAID_MCO_OON · SELF_REF_CIGNA · SELF_REF_UHC · MEDICARE_PUMP_MEDICAID_ID ·
 * UHC_AETNA_PUMP_MGMT.
 *
 * ⚠️ NOTHING HERE KNOWS A KEY OR A MESSAGE (Brandon: *"treat unknown KEYs
 * generically by TYPE; never hard-code the messages"*). The backend owns the
 * wording and the list; the screens render what it wrote. The one place a
 * label is read for MEANING is `requiresReason`, and it reads the rep-facing
 * word ("Management approved"), not a KEY.
 *
 * `Intake Warning Acks` (`text_mm7g1hr`) is OURS: the comma-separated KEYs a
 * rep ticked. The backend never writes it. `triggerStediRun` clears it when a
 * check starts from our pages, so every new check asks again (Josh:
 * *"every new stedi check should have updated info"*).
 */

import type { Patient } from "./workflow";

export type WarningType = "block" | "confirm";

export interface IntakeWarning {
  /** Stable id — what a tick is recorded against. Never contains a comma. */
  key: string;
  type: WarningType;
  /** CONFIRM only: the checkbox text (whatever followed `CONFIRM:`). */
  label: string;
  /** The backend's sentence for the rep, verbatim. */
  message: string;
}

/**
 * A tick is recorded by KEY in a comma-separated column, so a KEY must never
 * carry a comma. Real KEYs are UPPER_SNAKE already and pass through unchanged;
 * this only bites on a malformed line, whose "key" is made from its text.
 */
function safeKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

/** The checkbox text when the backend gave none, or sent a TYPE we don't know. */
export const FALLBACK_CONFIRM_LABEL = "I've read this";

/**
 * Parse the column. Blank ⇒ `[]`.
 *
 * ⚠️ A line we can't fully read is SHOWN, as a CONFIRM with the fallback label
 * — never dropped (a warning nobody sees is the failure this column exists to
 * end) and never treated as a BLOCK (a typo on the backend must not lock a
 * patient in the queue with no way out: BLOCK has no override, by Josh's
 * decision). A tick is the smallest thing that makes a rep read it.
 *
 * ⚠️ A repeated KEY keeps its FIRST line. A tick is per KEY, so two lines with
 * one KEY could only ever be ticked together.
 */
export function parseIntakeWarnings(raw: string | null | undefined): IntakeWarning[] {
  const out: IntakeWarning[] = [];
  const seen = new Set<string>();
  for (const rawLine of (raw ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split("|");
    let key = safeKey(parts[0] ?? "");
    const typeRaw = (parts[1] ?? "").trim();
    let message = parts.slice(2).join("|").trim();

    let type: WarningType;
    let label = "";
    const confirm = /^confirm\s*:?\s*(.*)$/i.exec(typeRaw);
    if (parts.length >= 3 && /^block$/i.test(typeRaw)) {
      type = "block";
    } else if (parts.length >= 3 && confirm) {
      type = "confirm";
      label = confirm[1].trim() || FALLBACK_CONFIRM_LABEL;
    } else {
      // Not `KEY|TYPE|message` — show the whole line, ask for a tick.
      type = "confirm";
      label = FALLBACK_CONFIRM_LABEL;
      message = line;
      if (parts.length < 3) key = safeKey(line);
    }
    if (!key) key = safeKey(line) || "WARNING";
    if (!message) message = label || key;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, type, label, message });
  }
  return out;
}

/** The ticked KEYs, in the order they were ticked. Blank ⇒ `[]`. */
export function parseAcks(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const k = part.trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * The column's new value after ticking (`on`) or unticking one KEY. Every
 * other KEY is kept as it was — including ones no current warning names,
 * because the column is shared with whatever ticked them and dropping them is
 * not this click's business.
 */
export function withAck(raw: string | null | undefined, key: string, on: boolean): string {
  const acks = parseAcks(raw).filter((k) => k !== key);
  if (on) acks.push(key);
  return acks.join(",");
}

/**
 * Which CONFIRM ticks need a typed reason (Josh, 2026-09-24: *"let's have her
 * add a note of why it was overridden and it can be added to the intake notes
 * section"*). Read off the checkbox LABEL — the rep-facing words — because the
 * backend owns the KEYs and may add more override-type warnings; a label that
 * reads as an approval or an override is one.
 */
export function requiresReason(w: Pick<IntakeWarning, "type" | "label">): boolean {
  return w.type === "confirm" && /\b(management|approv\w*|override\w*)\b/i.test(w.label);
}

/** What a BLOCK row tells the rep (Brandon's wording). */
export const BLOCK_HINT = "This patient can't be advanced. Let them know.";

export interface WarningCondition {
  id: `warn:${string}`;
  label: string;
  passed: boolean;
  hint: string;
  type: WarningType;
  key: string;
}

/**
 * One advance-gate row per current warning (Brandon's spec, item 4):
 *  - BLOCK   → never passes; the label IS the message. No override — Josh:
 *              *"let's leave it blocked for now"*.
 *  - CONFIRM → passes once its KEY is ticked; the label is the checkbox text,
 *              the hint is the message.
 *
 * ⚠️ Pass the patient with the acks the SCREEN is showing (the page's
 * optimistic copy), or a box the rep just ticked leaves Advance greyed out
 * until the next poll.
 */
export function warningConditions(
  p: Pick<Patient, "intakeWarnings" | "intakeWarningAcks"> | null | undefined,
): WarningCondition[] {
  if (!p) return [];
  const acks = parseAcks(p.intakeWarningAcks);
  return parseIntakeWarnings(p.intakeWarnings).map((w) => ({
    id: `warn:${w.key}` as const,
    key: w.key,
    type: w.type,
    label: w.type === "block" ? w.message : w.label,
    passed: w.type === "confirm" && acks.includes(w.key),
    hint: w.type === "block" ? BLOCK_HINT : w.message,
  }));
}

/**
 * The line a tick stamps into the intake notes (Josh accepted "every tick adds
 * a short line — who, when, which warning"). The note stamp supplies who and
 * when; this is the what. An override carries the rep's reason.
 */
export function ackNoteLine(
  w: Pick<IntakeWarning, "key" | "label">, on: boolean, reason?: string,
): string {
  const what = `${w.label} (${w.key})`;
  if (!on) return `Intake warning un-ticked: ${what}`;
  const why = (reason ?? "").trim();
  return why ? `Intake warning overridden: ${what} — ${why}` : `Intake warning confirmed: ${what}`;
}

/* ── The Care Coordinator card ─────────────────────────────────────────── */

export interface CardWarning {
  tone: "block" | "confirm";
  text: string;
  /** The backend's full sentence — the line's tooltip. */
  title: string;
}

/**
 * What a card says about the warnings (Josh, 2026-09-24: "yes" — show them on
 * Masani's cards too). Every BLOCK; each CONFIRM that is not ticked yet. A
 * ticked CONFIRM is handled and says nothing.
 */
export function cardWarnings(
  p: { intakeWarnings?: string | null; intakeWarningAcks?: string | null },
): CardWarning[] {
  const acks = parseAcks(p.intakeWarningAcks);
  const out: CardWarning[] = [];
  for (const w of parseIntakeWarnings(p.intakeWarnings)) {
    if (w.type === "block") out.push({ tone: "block", text: `Can't advance: ${w.message}`, title: w.message });
    else if (!acks.includes(w.key)) out.push({ tone: "confirm", text: `Confirm: ${w.label}`, title: w.message });
  }
  return out;
}
