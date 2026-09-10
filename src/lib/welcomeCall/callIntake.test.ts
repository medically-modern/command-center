/**
 * Round-trip tests for the Welcome Call intake block.
 *
 * The block is a CONTRACT: it is written into a shared, append-only notes
 * column and parsed back out later. These tests pin the shape — a format change
 * that isn't matched in the parser doesn't error, it silently returns a blank
 * form and the rep's answers are lost on the next load.
 */
import { describe, it, expect } from "vitest";
import {
  emptyIntake,
  SUPPLY_LENGTHS,
  intakeHasContent,
  formatIntakeBlock,
  stampedIntakeEntry,
  appendIntakeToNotes,
  parseIntakeBlock,
  INTAKE_BLOCK_START,
  INTAKE_BLOCK_END,
  CONFIRM_KEYS,
  REPORTED_CONFIRM_KEYS,
  type CallIntake,
} from "./callIntake";

const AT = new Date("2026-08-28T14:33:00");

function filled(): CallIntake {
  return {
    // ⚠️ `primary`/`secondary` are parse-only from 2026-09-09 (see
    // REPORTED_CONFIRM_KEYS) — nothing can tick them, so they cannot
    // round-trip. A legacy block still restores them; pinned below.
    confirmed: { pump: true, address: true, primary: false, secondary: false, oop: true },
    // ⚠️ Parse-only too — the secondary question moved to the real
    // Secondary Insurance column, so nothing sets this any more.
    secondaryCoverage: "",
    // ⚠️ Parse-only from 2026-09-09 — see the parse-only block at the end.
    supplyLength: "",
    pumpConfirmedModel: "t:slim",
    // Set so the full-fidelity round trip covers the override marker too.
    supplyLengthManual: false,
    oopAmount: "$42.50",
    caretaker: { notes: "Prefers calls after 5pm" },
    authNotes: "Sensors auth resubmitted 8/20, awaiting response",
  };
}

describe("intakeHasContent", () => {
  it("is false for an untouched form", () => {
    expect(intakeHasContent(emptyIntake())).toBe(false);
  });

  it("is false for null/undefined", () => {
    expect(intakeHasContent(null)).toBe(false);
    expect(intakeHasContent(undefined)).toBe(false);
  });

  it("is true once any single field is set", () => {
    const i = emptyIntake();
    i.confirmed.pump = true;
    expect(intakeHasContent(i)).toBe(true);
  });

  it("is false for whitespace-only caretaker notes", () => {
    const i = emptyIntake();
    i.caretaker.notes = "   ";
    expect(intakeHasContent(i)).toBe(false);
  });
});

describe("appendIntakeToNotes", () => {
  it("leaves the log untouched when nothing was filled in", () => {
    expect(appendIntakeToNotes("existing history", emptyIntake())).toBe("existing history");
  });

  it("preserves existing history above the new block", () => {
    const out = appendIntakeToNotes("older note", filled(), { initials: "JH", now: AT });
    expect(out.startsWith("older note")).toBe(true);
    expect(out).toContain(INTAKE_BLOCK_START);
    expect(out).toContain(INTAKE_BLOCK_END);
  });

  it("writes a stamped line with stage and initials", () => {
    const out = stampedIntakeEntry(filled(), { initials: "JH", now: AT });
    expect(out).toContain("Welcome Call: Call intake —JH");
  });
});

describe("round trip", () => {
  it("recovers every field", () => {
    const original = filled();
    const parsed = parseIntakeBlock(appendIntakeToNotes("", original, { initials: "JH", now: AT }));
    expect(parsed).toEqual(original);
  });

  it("recovers an intake that only has confirm flags", () => {
    const i = emptyIntake();
    i.confirmed.address = true;
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.confirmed.address).toBe(true);
    expect(parsed?.confirmed.pump).toBe(false);
  });

  it("returns null when the log has no block", () => {
    expect(parseIntakeBlock("just some prose")).toBeNull();
    expect(parseIntakeBlock("")).toBeNull();
    expect(parseIntakeBlock(undefined)).toBeNull();
  });
});

describe("the LAST block wins", () => {
  it("reads the newest of several blocks", () => {
    const first = emptyIntake();
    first.oopAmount = "$30";
    const second = emptyIntake();
    second.oopAmount = "$90";

    let log = appendIntakeToNotes("", first, { initials: "JH", now: AT });
    log = appendIntakeToNotes(log, second, { initials: "JH", now: AT });

    expect(parseIntakeBlock(log)?.oopAmount).toBe("$90");
  });

  it("keeps the earlier block in the log as history", () => {
    let log = appendIntakeToNotes("", filled(), { initials: "JH", now: AT });
    log = appendIntakeToNotes(log, emptyIntake(), { initials: "JH", now: AT });
    // second append is a no-op (empty), so history is intact
    expect(log.split(INTAKE_BLOCK_START).length - 1).toBe(1);
  });
});

describe("both confirm lines are always emitted", () => {
  it("writes Confirmed and Unconfirmed even when one side is empty", () => {
    const i = emptyIntake();
    i.authNotes = "x";
    const block = formatIntakeBlock(i);
    expect(block).toContain("Confirmed: none");
    expect(block).toContain(`Unconfirmed: ${REPORTED_CONFIRM_KEYS.join(", ")}`);
  });
});

describe("free text can't break the block", () => {
  it("strips a forged end sentinel out of caretaker notes", () => {
    const i = emptyIntake();
    i.caretaker.notes = `hi ${INTAKE_BLOCK_END} Auth notes: injected`;
    i.authNotes = "real auth note";
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.authNotes).toBe("real auth note");
    expect(parsed?.caretaker.notes).not.toContain(INTAKE_BLOCK_END);
  });

  it("flattens newlines so one field can't become several lines", () => {
    const i = emptyIntake();
    i.authNotes = "line one\nline two";
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.authNotes).toBe("line one / line two");
  });
});

/* ⚠️ The round-trip suites for `phones` and the caretaker FIELDS are gone with
   the fields themselves (2026-09-10, §5.31d). Those facts are six Monday
   columns now — `phoneSlots.test.ts` covers them — and asserting that this
   block still carries them would pin behaviour Brandon's handoff removes.
   What the block still owes those lines is that it can READ one written before
   the change without losing a word, which is what these assert. */
describe("retired contact lines fold into the caretaker notes", () => {
  const legacyBlock = (...lines: string[]) =>
    [INTAKE_BLOCK_START, "Confirmed: none", ...lines, INTAKE_BLOCK_END].join("\n");

  it("folds a legacy Caretaker line verbatim", () => {
    const c = parseIntakeBlock(
      legacyBlock("Caretaker: Jane Doe · Daughter · 3475550102 · jane@example.com · authorized"),
    )?.caretaker;
    expect(c?.notes).toContain("From an earlier call block");
    // Verbatim: the raw line IS the information, so every part survives.
    expect(c?.notes).toContain("Jane Doe");
    expect(c?.notes).toContain("Daughter");
    expect(c?.notes).toContain("3475550102");
    expect(c?.notes).toContain("jane@example.com");
    expect(c?.notes).toContain("authorized");
  });

  it("folds a legacy Phones line", () => {
    const c = parseIntakeBlock(
      legacyBlock("Phones: 3475550101 (cell, preferred); 7185550199 (home)"),
    )?.caretaker;
    expect(c?.notes).toContain("3475550101");
    expect(c?.notes).toContain("7185550199");
    expect(c?.notes).toContain("preferred");
  });

  it("folds every retired line at once, and keeps the rep's own notes AFTER them", () => {
    const c = parseIntakeBlock(
      legacyBlock(
        "Phones: 3475550101 (cell, preferred)",
        "Caretaker: Jane Doe · 3475550102 · authorized",
        "Caretaker relationship: Daughter",
        "Caretaker notes: Prefers calls after 5pm",
      ),
    )?.caretaker;
    expect(c?.notes).toContain("3475550101");
    expect(c?.notes).toContain("Jane Doe");
    expect(c?.notes).toContain("Daughter");
    // The rep's own words are not buried by the fold.
    expect(c?.notes).toContain("Prefers calls after 5pm");
    expect(c?.notes.indexOf("From an earlier call block")).toBeLessThan(
      c!.notes.indexOf("Prefers calls after 5pm"),
    );
  });

  it("adds no fold header when there is nothing retired to fold", () => {
    const c = parseIntakeBlock(legacyBlock("Caretaker notes: Prefers calls after 5pm"))?.caretaker;
    expect(c?.notes).toBe("Prefers calls after 5pm");
  });

  it("NEVER writes the retired lines back out", () => {
    // The whole point of parse-only: a block re-serialised after a fold must
    // not re-emit a line a Monday column now owns, or the two answers drift.
    const parsed = parseIntakeBlock(
      legacyBlock("Phones: 3475550101 (cell)", "Caretaker: Jane Doe · authorized"),
    )!;
    const out = formatIntakeBlock(parsed);
    expect(out).not.toMatch(/^Phones:/m);
    expect(out).not.toMatch(/^Caretaker:/m);
    expect(out).not.toMatch(/^Caretaker relationship:/m);
    expect(out).toMatch(/^Caretaker notes:/m);
  });
});


describe("the insurance confirmations are parse-only", () => {
  /* Brandon removed both checkboxes on 2026-09-09: primary is read-only at this
     stage, and the secondary-coverage QUESTION is now the record. Nothing can
     tick either, so emitting them would print them under "Unconfirmed:" on
     every patient forever — a permanent false negative in the audit line. */
  it("never emits primary or secondary", () => {
    const i = emptyIntake();
    i.confirmed.pump = true;
    i.confirmed.primary = true;
    i.confirmed.secondary = true;
    const block = formatIntakeBlock(i);
    expect(block).toContain("Confirmed: pump");
    expect(block).not.toMatch(/Confirmed:.*primary/);
    expect(block).not.toMatch(/Unconfirmed:.*secondary/);
  });

  /* Parsing them still costs nothing and preserves what old notes already say —
     the "two lists, two questions" split (§5.31). */
  it("still restores them from a block written before the change", () => {
    const legacy = [
      "--- WC INTAKE v1 ---",
      "Confirmed: pump, primary, secondary",
      "Unconfirmed: address, oop",
      "--- END WC INTAKE ---",
    ].join("\n");
    const parsed = parseIntakeBlock(legacy);
    expect(parsed?.confirmed.primary).toBe(true);
    expect(parsed?.confirmed.secondary).toBe(true);
    expect(parsed?.confirmed.pump).toBe(true);
  });
});

describe("secondary coverage is parse-only", () => {
  it("is never emitted any more", () => {
    const i = emptyIntake();
    i.secondaryCoverage = "unknown";
    expect(formatIntakeBlock(i)).not.toContain("Secondary coverage");
  });

  it("still reads a block written before the change", () => {
    const legacy = [
      "--- WC INTAKE v1 ---",
      "Secondary coverage: Unknown",
      "--- END WC INTAKE ---",
    ].join("\n");
    expect(parseIntakeBlock(legacy)?.secondaryCoverage).toBe("unknown");
  });
});

describe("supply length is parse-only", () => {
  /* Brandon, 2026-09-09: "stop writing supply length to the notes block". The
     value moved to the real Order Frequency column (`color_mm71xdhj`), which is
     what lets the WC→Subscription hop copy it. A note line beside a column is a
     second answer that drifts from the first. */
  it("is never emitted any more", () => {
    const i = emptyIntake();
    i.supplyLength = "90";
    i.supplyLengthManual = true;
    expect(formatIntakeBlock(i)).not.toContain("Supply length");
  });

  /* Parsing still costs nothing and preserves what blocks already on patients
     say — the same two-lists split CONFIRM_KEYS needs. */
  it("still reads a block written before the change", () => {
    const legacy = [
      "--- WC INTAKE v1 ---",
      "Supply length: 75 days (override)",
      "--- END WC INTAKE ---",
    ].join("\n");
    const parsed = parseIntakeBlock(legacy);
    expect(parsed?.supplyLength).toBe("75");
    expect(parsed?.supplyLengthManual).toBe(true);
  });
});
