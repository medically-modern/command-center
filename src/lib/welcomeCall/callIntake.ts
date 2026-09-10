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
 * Welcome Call Notes column (`text_mm6vqq2k`) when they press Send to
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

/**
 * Every confirmation key the block can PARSE. Unchanged — old notes carrying
 * `primary` / `secondary` still round-trip.
 */
export const CONFIRM_KEYS: ConfirmKey[] = ["pump", "address", "primary", "secondary", "oop"];

/**
 * What the block REPORTS, which from 2026-09-09 is a shorter list.
 *
 * ⚠️ Two lists, two questions — the same split `SUPPLY_LENGTHS` vs
 * `supplyLengthOptions` needs (§5.31), and for the same reason. Brandon's
 * Insurance block removed both insurance checkboxes: primary is read-only at
 * this stage ("Corey: primary isn't confirmed at this stage") and the
 * secondary-coverage QUESTION is now the record, so a checkbox beside it would
 * be a second, contradicting one. Nothing can tick either any more — emitting
 * them would print them under "Unconfirmed:" on every patient forever, a
 * permanent false negative in the audit line. Parsing them still costs nothing
 * and preserves what old notes already say.
 */
export const REPORTED_CONFIRM_KEYS: ConfirmKey[] = ["pump", "address", "oop"];

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
export type SupplyLength = "" | "30" | "60" | "75" | "90";

/**
 * Every length the block can round-trip — NOT the list a given payer may pick
 * from. That is `payerRules.supplyLengthOptions`, which offers 75 to Aetna only.
 *
 * ⚠️ **75 must be here even though almost nobody may choose it.** It was added
 * as an Aetna option while this list still read `["30","60","90"]`, so
 * `parseIntakeBlock` dropped a saved `Supply length: 75 days (override)` on the
 * floor while still restoring `supplyLengthManual: true` — which disables the
 * payer default. After a reload the field was blank AND frozen blank, and the
 * next send wrote no supply length at all. Caught by Greptile on PR #55.
 * The two lists answer different questions: this one is "what can be stored",
 * `supplyLengthOptions` is "what may be picked".
 */
export const SUPPLY_LENGTHS: SupplyLength[] = ["30", "60", "75", "90"];

/**
 * ⚠️ Caretaker is NOTES ONLY from 2026-09-10 (§5.31d).
 *
 * Name, relationship, authorisation and the numbers are **Monday columns** now
 * — Caregiver Name `text_mm727mrm`, Caregiver Authorized `boolean_mm72tf9z`
 * and the two phone slots — so keeping them here too would be a second answer
 * that drifts from the first, exactly what moving supply length onto Order
 * Frequency avoided. Caretaker NOTES stay because they are the one caregiver
 * fact with no column, and Brandon's handoff says to keep them here.
 *
 * The parser still READS the retired lines and folds them into `notes`, so a
 * block written before this change keeps every word it carried.
 */
export interface Caretaker {
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
  /**
   * The Pump Type the rep had on screen when they ticked `confirmed.pump`.
   *
   * ⚠️ Recorded because the confirmation is about ONE MODEL — the rep said
   * "t:slim" out loud to the patient — so it cannot survive the model
   * changing. Brandon, 2026-09-09: "If Pump Type changes after it's checked,
   * uncheck it automatically." Comparing values is the only way to notice; a
   * bare boolean has nothing to compare against, and a tick left standing
   * would put an audit line in the notes claiming a conversation that never
   * happened about the pump now on order.
   *
   * ⚠️ It lives in the block rather than in component state so the tick
   * survives a reload — a rep returning to the patient tomorrow keeps a
   * confirmation they really did get. Empty whenever `confirmed.pump` is false.
   */
  pumpConfirmedModel: string;
  caretaker: Caretaker;
  authNotes: string;
}

export const EMPTY_CARETAKER: Caretaker = { notes: "" };

export function emptyIntake(): CallIntake {
  return {
    confirmed: { pump: false, address: false, primary: false, secondary: false, oop: false },
    secondaryCoverage: "",
    supplyLength: "",
    supplyLengthManual: false,
    oopAmount: "",
    pumpConfirmedModel: "",
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
  if ((i.pumpConfirmedModel ?? "").trim()) return true;
  return !!i.caretaker.notes.trim();
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


/**
 * The block body, WITHOUT the stamp line. Only lines with content are emitted,
 * except the Confirmed/Unconfirmed pair — see the header for why both always go.
 */
export function formatIntakeBlock(intake: CallIntake): string {
  const lines: string[] = [];

  const yes = REPORTED_CONFIRM_KEYS.filter((k) => intake.confirmed[k]);
  const no = REPORTED_CONFIRM_KEYS.filter((k) => !intake.confirmed[k]);
  lines.push(`Confirmed: ${yes.length ? yes.join(", ") : "none"}`);
  lines.push(`Unconfirmed: ${no.length ? no.join(", ") : "none"}`);

  // ⚠️ `?? ""` is not defensive noise: this runs on the send path, and callers
  // include blocks parsed from notes written before this field existed.
  const pumpModel = (intake.pumpConfirmedModel ?? "").trim();
  if (intake.confirmed.pump && pumpModel) lines.push(`Pump confirmed: ${oneLine(pumpModel)}`);
  /* ⚠️ `Secondary coverage` and `Supply length` are no longer EMITTED
     (Brandon, 2026-09-09: "stop writing supply length to the notes block").
     Both moved to real Monday columns — secondary to `color_mm241kqp` via the
     Insurance block, and supply length to Order Frequency `color_mm71xdhj` —
     and a note line beside a column is a second answer that drifts from the
     first. Both are still PARSED, so blocks already on patients keep their
     meaning; the same two-lists split `CONFIRM_KEYS` /
     `REPORTED_CONFIRM_KEYS` needs just above. */
  if (intake.oopAmount.trim()) lines.push(`OOP amount: ${oneLine(intake.oopAmount)}`);

  /* ⚠️ `Phones:`, `Caretaker:` and `Caretaker relationship:` are PARSE-ONLY
     from 2026-09-10 — six Monday columns own those facts now (§5.31d), and a
     note line beside a column is a second answer that drifts from the first.
     The parser still reads them and folds them into the notes, so blocks
     already on patients keep every word. Same two-list split as
     `CONFIRM_KEYS` / `REPORTED_CONFIRM_KEYS` above. */
  const c = intake.caretaker;
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
  /** Retired contact lines, folded into the caretaker notes below. */
  const legacy: string[] = [];

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
      case "pump confirmed":
        intake.pumpConfirmedModel = value.trim();
        break;
      case "oop amount":
        intake.oopAmount = value;
        break;
      /* The three retired contact lines. Collected VERBATIM and folded into the
         caretaker notes after the loop — the raw line IS the information, and
         re-parsing it into fields nothing renders any more would be work whose
         only possible outcome is getting it wrong. Folded after the loop rather
         than here because `Caretaker notes:` can arrive on any line and the
         fold has to sit in front of it. */
      case "phones":
      case "caretaker":
      case "caretaker relationship":
        legacy.push(`${label}: ${value}`);
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

  /* Fold whatever the retired lines carried into the caretaker notes, ahead of
     anything the rep wrote. Nothing is lost when the fields behind those lines
     stop existing, and the header says where it came from rather than leaving
     the next reader wondering why a phone number is sitting in a notes box.
     ⚠️ Measured before shipping (2026-09-10): ZERO live Welcome Call patients
     carried an intake block at all — not in the notes column, not in the
     retired `long_text_mm2ffsme` — so this protects only what a rep writes
     between that scan and the deploy. Cheap insurance, not a migration. */
  if (legacy.length) {
    const folded = `From an earlier call block — ${legacy.join("; ")}`;
    intake.caretaker.notes = intake.caretaker.notes.trim()
      ? `${folded}. ${intake.caretaker.notes}`
      : folded;
  }

  // A block with a sentinel but no recognisable content is still a block —
  // report it so the caller doesn't fall back to a blank form and re-append.
  return sawConfirmLine || intakeHasContent(intake) ? intake : null;
}
