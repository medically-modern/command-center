/**
 * Attempt rollup — folding a SPENT outreach cycle into the permanent history.
 *
 * WHAT AN ATTEMPT CYCLE IS. A Medical Evaluation patient goes round a loop:
 * Evaluate MN → Send Request → Confirm Receipt → Chase Clinicals. Confirm
 * Receipt and Chase each give the rep THREE attempts, and each attempt is
 * written into its own text column on the board — `confirmAttempt1..3`
 * (text_mm2yd068 / text_mm2y9h4a / text_mm2ymtsk) and `chaseAttempt1..3`
 * (text_mm2yhpjt / text_mm2yb3rv / text_mm2ybk06). Six columns, three slots per
 * stage, and there is no seventh: the panels place an attempt by slot, so a
 * cycle that ends with all six filled has nowhere left to write.
 *
 * WHY THEY HAVE TO BE EMPTIED. When a patient comes back round to Evaluate for
 * a re-review, the NEXT cycle needs those slots free — otherwise the rep
 * arrives at Confirm Receipt looking at three greyed-out cards from a cycle
 * that closed weeks ago. But the notes in them are the record of what was
 * actually tried, so they can't just be deleted: they are rolled up into the
 * MN Workflow Notes (`long_text_mm27zjt2`) first, under a dated header, and the
 * columns are blanked in the SAME mutation.
 *
 * ⚠️ THE APPEND AND THE CLEARS MUST BE ONE WRITE. `change_multiple_column_values`
 * is all-or-nothing, so either the history gains the attempts and the columns
 * empty, or nothing happens at all. An append-then-clear pair can lose the whole
 * cycle's notes if the second call lands and the first didn't — and nothing on
 * the board would say so afterwards.
 *
 * TWO CALLERS, ONE FORMAT. The rep's Evaluate send has done this since the
 * re-eval rollup shipped (`EvaluatePanel`). A manager's **Send back to
 * pipeline** from the Evaluate page now does the same thing
 * (`returnProposedToQueue`), because that button also puts a patient at the top
 * of a fresh cycle — it just skips the rep's send to get there. Both go through
 * `buildAttemptRollup`, so the header shape a manager writes and the one a rep
 * writes can't drift apart in the same notes column.
 *
 * ⚠️ EVALUATE ONLY — see `returnResetsAttempts`. Returning a patient to Chase or
 * Confirm Receipt deliberately leaves their spent attempts alone.
 */

/** One stage's three per-attempt text columns, slot 1 → 3. Blank = never used. */
export type AttemptSlots = readonly [
  string | undefined,
  string | undefined,
  string | undefined,
];

export interface AttemptRollupInput {
  /** MN Workflow Notes exactly as the board holds them right now. */
  notes?: string;
  /** Confirm Receipt attempt columns, slots 1..3. */
  confirm: AttemptSlots;
  /** Chase Clinicals attempt columns, slots 1..3. */
  chase: AttemptSlots;
  /** ET date (YYYY-MM-DD) that closes the cycle — `etToday()` at write time. */
  dateStr: string;
}

export interface AttemptRollup {
  /**
   * True when at least one attempt column held text — i.e. there is something
   * to fold in, and the six columns are worth clearing. When false the caller
   * must NOT write the clears: blanking six already-blank columns is six
   * pointless writes on every send.
   */
  hasAttempts: boolean;
  /** The notes body to WRITE. Identical to `notes` when `hasAttempts` is false. */
  notes: string;
}

/**
 * One dated section — "--- Chase Clinicals notes (cycle thru 2026-08-14) ---"
 * followed by the filled slots, numbered by their SLOT and not by their
 * position, so a cycle where attempt 2 was skipped still reads correctly.
 * Returns "" when the stage has nothing logged.
 */
function rollupSection(title: string, slots: AttemptSlots, dateStr: string): string {
  const lines = slots
    .map((raw, i) => {
      const text = (raw ?? "").trim();
      return text ? `Attempt ${i + 1}: ${text}` : null;
    })
    .filter((l): l is string => l !== null);
  return lines.length ? `--- ${title} (cycle thru ${dateStr}) ---\n${lines.join("\n")}` : "";
}

/**
 * Merge whatever the six attempt columns hold into the MN Workflow Notes body.
 * Sections are blank-line separated and appended AFTER the existing history, so
 * the notes stay chronological.
 */
export function buildAttemptRollup(input: AttemptRollupInput): AttemptRollup {
  const sections = [
    rollupSection("Confirm Receipt notes", input.confirm, input.dateStr),
    rollupSection("Chase Clinicals notes", input.chase, input.dateStr),
  ].filter((s) => s.length > 0);
  const base = input.notes ?? "";
  if (sections.length === 0) return { hasAttempts: false, notes: base };
  return { hasAttempts: true, notes: [base, ...sections].filter((s) => s.length > 0).join("\n\n") };
}

/**
 * Which attempt columns a stage's "Send back to pipeline" clears — and with
 * them, whether MN Attempts goes back to Attempt 1 (Josh, 2026-08-14).
 *
 * ── WHY ANY OF THIS IS NEEDED ──
 * MN Attempts (`color_mm1wz0vg`) is what Confirm Receipt and Chase derive the
 * current slot from — NOT which columns are filled. `Escalate` means
 * `currentAttempt === null` ⇒ `isEscalated` ⇒ `locked = isEscalated &&
 * !managerMode`, and `managerMode` is only ever `?manager=1`, which a
 * processor's own role bar never sets. So a returned patient landed in the
 * rep's sidebar, due today, showing a rose card reading "Escalated — all 3
 * attempts came back unsuccessful" while the escalation had in fact just been
 * cleared. The rep could edit notes and nothing else: no attempt, no re-send,
 * no way to move the Next Action Date. The patient sat there forever.
 *
 * ── THE SCOPES ──
 *  - `"all"` — Evaluate, Send Request, Confirm Receipt. The whole outreach loop
 *    restarts from the top: a new request goes out and the office is called
 *    from scratch, so both stages' columns belong to the cycle that just ended.
 *  - `"chaseOnly"` — the two Chase roles. The rep is being sent back to chase
 *    again, not to re-confirm receipt. ⚠️ The Confirm Receipt columns must
 *    SURVIVE: `ChaseClinicalsPanel` parses them for the "who actually confirmed
 *    receipt" banner it shows the chase rep, and clearing them would silently
 *    blank that.
 *  - `null` — Doctor Appointments and every non-ME stage. Doctor Appointments
 *    keeps no attempt columns at all: its counter is the attempt LINES in the
 *    notes, reset by the `[Returned to queue` stamp that every return now
 *    writes (`apptOutreach.RESET_MARKERS`).
 *
 * Nothing is lost by clearing: the columns are folded into the MN Workflow
 * Notes in the same all-or-nothing mutation first.
 *
 * ⚠️ This does NOT disturb the Oversight "Attempt 4+" charts, despite CLAUDE.md
 * §7's note that MN Attempts survives a return. Those charts require escalation
 * index 0, and a return clears the escalation — so a returned patient is off
 * them either way, whatever the counter says.
 */
export type AttemptResetScope = "all" | "chaseOnly";

/**
 * ⚠️ TWO VOCABULARIES, one table. The stage pages pass a `StageKey`
 * (`lib/shared/stageActions`) and the Oversight drill-down passes the chart's
 * `rowOf` — and the Email & Parachute chase is called **`chase-parachute`** in
 * the first and **`chase-email-parachute`** in the second. A table holding only
 * one spelling doesn't error on the other, it silently returns null: the
 * manager's return looks like it worked and the rep is still locked out. Both
 * spellings are listed, and `attemptRollup.test.ts` pins every key from both
 * sources.
 */
const RESET_SCOPES: Record<string, AttemptResetScope> = {
  evaluate: "all",
  "send-request": "all",
  "confirm-receipt": "all",
  "chase-fax": "chaseOnly",
  "chase-parachute": "chaseOnly",        // StageKey spelling
  "chase-email-parachute": "chaseOnly",  // Oversight ChartDef.rowOf spelling
};

export function returnAttemptReset(stage: string | undefined | null): AttemptResetScope | null {
  return (stage && RESET_SCOPES[stage]) || null;
}
