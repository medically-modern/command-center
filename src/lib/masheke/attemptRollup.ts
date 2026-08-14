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
 * Does this stage's "Send back to pipeline" hand the rep a fresh set of
 * attempts? **Evaluate only** (Josh, 2026-08-14).
 *
 * A manager returning an EVALUATE patient is putting them back at the TOP of
 * the loop: they will be re-evaluated, a new request will go out, and the
 * office will be called again from scratch. Their spent attempts belong to the
 * cycle that just ended, so the rollup runs and the counter goes back to
 * Attempt 1.
 *
 * ⚠️ Every other stage is the opposite, on purpose. Returning a patient to
 * Chase or Confirm Receipt drops them back into the SAME cycle they were
 * escalated out of — the attempts they show are the ones they just spent, and
 * MN Attempts stays where it is. That is the documented rule the Oversight
 * charts already lean on ("MN Attempts is history, not a queue flag" — CLAUDE.md
 * §7): the Attempt 4+ charts key on escalation index 0 precisely BECAUSE a
 * returned chase patient keeps `MN Attempts = Escalate`. Resetting it here for
 * every stage would hand a rep three more chases on a request the office has
 * already refused three times, and would empty the two charts that are supposed
 * to remember it.
 */
export function returnResetsAttempts(stage: string | undefined | null): boolean {
  return stage === "evaluate";
}
