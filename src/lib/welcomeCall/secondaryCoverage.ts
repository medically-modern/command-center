/**
 * Block A of Brandon's Insurance section (2026-09-09) — secondary coverage as
 * ONE question, and what each answer writes to the board.
 *
 * *"One question: Secondary coverage? No / Yes / Unknown. Pre-fill from the
 * board… Yes reveals Type: NY Medicaid / Medicare Supplement / Other."*
 *
 * ⚠️ **Unknown writes NOTHING, and never gates Advance** — Brandon: *"patients
 * often don't know"*. That is the whole reason the question has three answers
 * rather than a checkbox: a rep who asked and got a shrug has somewhere to put
 * it, and a patient is not stranded over a fact they cannot supply. Do not
 * "simplify" Unknown into No; No is a positive answer that CLEARS the board.
 *
 * ⚠️ Nothing else in this section writes. The primary policy is read-only
 * (Corey: primary isn't confirmed at this stage), and the auth block beside it
 * is the Insurance stage's output, not something a rep sets on a call.
 */

/** The three answers, and the board labels behind Yes. */
export type SecondaryAnswer = "yes" | "no" | "unknown";
export type SecondaryType = "NY Medicaid" | "Medicare Supplement" | "Other";

export const SECONDARY_TYPES: SecondaryType[] = ["NY Medicaid", "Medicare Supplement", "Other"];

/** Board labels on Secondary Insurance `color_mm241kqp`, verified live
 *  2026-09-09: None · NY Medicaid · Medicare Supplement · Other. ("Done" exists
 *  at index 3 but is DEACTIVATED on the board and is deliberately not offered.) */
export const SECONDARY_NONE = "None";

export interface SecondaryState {
  answer: SecondaryAnswer;
  /** Only meaningful when `answer === "yes"`. */
  type: SecondaryType | null;
}

/**
 * Pre-fill the question from what the board already holds.
 *
 * ⚠️ A blank column is **unknown**, never No. Blank means nobody has asked;
 * `None` means somebody asked and the patient said no. Collapsing the two would
 * report an unasked question as answered, and — because No WRITES `None` — a
 * later save would make that fabricated answer permanent.
 */
export function secondaryStateFromBoard(secondaryInsurance: string): SecondaryState {
  const v = (secondaryInsurance ?? "").trim();
  if (!v) return { answer: "unknown", type: null };
  if (v === SECONDARY_NONE) return { answer: "no", type: null };
  const match = SECONDARY_TYPES.find((t) => t.toLowerCase() === v.toLowerCase());
  if (match) return { answer: "yes", type: match };
  // A label we don't recognise (a rename, or the deactivated "Done" left on an
  // old row) is an ANSWER we can't read, not an absent one — report it as Yes /
  // untyped so the rep re-states it rather than having it silently cleared.
  return { answer: "yes", type: null };
}

/** 2 letters, 5 digits, 1 letter — e.g. `AB12345C`. Brandon's format. */
const CIN = /^[A-Za-z]{2}\d{5}[A-Za-z]$/;

export function isValidCin(raw: string): boolean {
  return CIN.test((raw ?? "").trim());
}

export interface SecondaryInput extends SecondaryState {
  memberId2: string;
  insuranceNotes: string;
}

/**
 * What is still missing before this answer is complete, in rep-facing words.
 *
 * Empty means nothing is outstanding — including for **Unknown**, which is a
 * complete answer even though it writes nothing.
 */
export function secondaryMissing(i: SecondaryInput): string[] {
  if (i.answer !== "yes") return [];
  const out: string[] = [];
  if (!i.type) {
    out.push("Pick the secondary coverage type.");
    return out;
  }
  const id = (i.memberId2 ?? "").trim();
  if (i.type === "NY Medicaid") {
    if (!id) out.push("NY Medicaid needs Member ID 2 (the CIN).");
    else if (!isValidCin(id)) {
      out.push("Member ID 2 doesn't look like a CIN — 2 letters, 5 digits, 1 letter (AB12345C).");
    }
  }
  if (i.type === "Other") {
    if (!id) out.push("An 'Other' secondary needs Member ID 2.");
    if (!(i.insuranceNotes ?? "").trim()) {
      out.push("An 'Other' secondary needs the payer name and group in Insurance Notes.");
    }
  }
  // Medicare Supplement is a TAG ONLY — claims cross over from Medicare, so
  // there is no ID to collect and asking for one wastes a question on the call.
  return out;
}

export interface SecondaryWrites {
  secondaryInsurance?: string;
  memberId2?: string;
}

/**
 * The board writes for an answer. Absent keys mean "leave the column alone".
 *
 * ⚠️ Unknown returns `{}` — not a clear. Writing anything for Unknown would
 * turn "we asked and they didn't know" into a statement about their coverage.
 * ⚠️ No CLEARS Member ID 2: a leftover ID under "None" is a contradiction the
 * next reader has to resolve, and Brandon asked for it explicitly.
 */
export function secondaryWrites(i: SecondaryState): SecondaryWrites {
  if (i.answer === "unknown") return {};
  if (i.answer === "no") return { secondaryInsurance: SECONDARY_NONE, memberId2: "" };
  if (!i.type) return {};
  // Medicare Supplement carries no ID, but an ID already on the row is left
  // alone rather than cleared — it is somebody's record of something, and this
  // answer is not evidence it is wrong.
  return { secondaryInsurance: i.type };
}

/**
 * The answer as the REP has it, which is not always what the column holds.
 *
 * ⚠️ **Unknown is the one answer with no board representation.** A blank column
 * reads Unknown on its own, but "the patient didn't know" on top of an existing
 * `NY Medicaid` cannot clear that column — clearing would destroy a real policy
 * record (`secondaryWrites` returns `{}` for exactly this reason). So the rep's
 * Unknown rides the page overlay as `secondaryUnknown`, and BOTH the control
 * and the send gate read it through here rather than off the column.
 *
 * They used to disagree. The control was rendered from a flag local to
 * `InsuranceBlock` while `unmetSendRequirements` re-read the board, so a rep who
 * answered Unknown for a patient already carrying NY Medicaid saw **Unknown** on
 * screen and an Advance button held shut by a CIN they had just said nobody
 * knew: a gate with no passing move, which is the dead end §5.10 and §5.20 each
 * record reversing (Greptile, PR #56). One reader, so the card and the send can
 * no longer hold two opinions of one question.
 */
export function secondaryStateFor(p: {
  secondaryUnknown?: boolean;
  secondaryInsuranceEdited: string | null;
  secondaryInsurance: string;
}): SecondaryState {
  if (p.secondaryUnknown) return { answer: "unknown", type: null };
  return secondaryStateFromBoard(p.secondaryInsuranceEdited ?? p.secondaryInsurance);
}
