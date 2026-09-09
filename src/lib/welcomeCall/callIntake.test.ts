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
    phones: [
      { number: "3475550101", kind: "cell", preferred: true },
      { number: "7185550199", kind: "home", preferred: false },
    ],
    caretaker: {
      name: "Jane Doe",
      relationship: "Daughter",
      phone: "3475550102",
      email: "jane@example.com",
      authorized: true,
      notes: "Prefers calls after 5pm",
    },
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

  it("ignores a phone row with a blank number", () => {
    const i = emptyIntake();
    i.phones = [{ number: "   ", kind: "cell", preferred: false }];
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

describe("phones", () => {
  it("keeps kind and preferred flags", () => {
    const i = emptyIntake();
    i.phones = [
      { number: "3475550101", kind: "work", preferred: false },
      { number: "7185550199", kind: "cell", preferred: true },
    ];
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.phones).toEqual(i.phones);
  });

  it("drops blank rows on the way out", () => {
    const i = emptyIntake();
    i.phones = [
      { number: "3475550101", kind: "cell", preferred: false },
      { number: "", kind: "home", preferred: false },
    ];
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.phones).toHaveLength(1);
  });
});

describe("caretaker", () => {
  it("round-trips a caretaker with no email", () => {
    const i = emptyIntake();
    i.caretaker = {
      name: "Bob Smith", relationship: "Son", phone: "2125550188",
      email: "", authorized: false, notes: "",
    };
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.caretaker.name).toBe("Bob Smith");
    expect(parsed?.caretaker.relationship).toBe("Son");
    expect(parsed?.caretaker.phone).toBe("2125550188");
    expect(parsed?.caretaker.authorized).toBe(false);
  });
});

describe("caretaker fields never shift position (Greptile #1)", () => {
  it("keeps a relationship recorded without a name", () => {
    // Blank fields are dropped from the line, so with both parts bare the
    // reader could only tell them apart by position: "Daughter · not
    // authorized" came back as name="Daughter" with no relationship, and the
    // corrupted record was persisted on the next send.
    const i = emptyIntake();
    i.caretaker.relationship = "Daughter";
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.caretaker.relationship).toBe("Daughter");
    expect(parsed?.caretaker.name).toBe("");
  });

  it("round-trips every subset of the caretaker fields", () => {
    const full = {
      name: "Jane Doe", relationship: "Daughter", phone: "3475550102",
      email: "jane@example.com", authorized: true, notes: "",
    };
    const keys = ["name", "relationship", "phone", "email"] as const;
    for (let mask = 0; mask < 16; mask++) {
      const i = emptyIntake();
      keys.forEach((k, bit) => {
        if (mask & (1 << bit)) i.caretaker[k] = full[k];
      });
      if (!intakeHasContent(i)) continue;
      const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
      expect(parsed?.caretaker).toEqual(i.caretaker);
    }
  });

  it("does not mistake a parenthesised phone for a relationship", () => {
    const i = emptyIntake();
    i.caretaker = { ...i.caretaker, name: "Jane Doe", phone: "(347) 555-0102" };
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.caretaker.phone).toBe("(347) 555-0102");
    expect(parsed?.caretaker.relationship).toBe("");
  });

  it("still reads a legacy block written before the relationship was marked", () => {
    const log = [
      INTAKE_BLOCK_START,
      "Confirmed: none",
      "Unconfirmed: pump, address, oop",
      "Caretaker: Jane Doe · Daughter · 3475550102 · jane@example.com · authorized",
      INTAKE_BLOCK_END,
    ].join("\n");
    const c = parseIntakeBlock(log)?.caretaker;
    expect(c?.name).toBe("Jane Doe");
    expect(c?.relationship).toBe("Daughter");
    expect(c?.phone).toBe("3475550102");
    expect(c?.email).toBe("jane@example.com");
    expect(c?.authorized).toBe(true);
  });
});

describe("free text never changes field (Greptile round 2)", () => {
  it("keeps a parenthesised caretaker NAME as the name", () => {
    // Marking the relationship with parens only moved the ambiguity: a rep
    // whose caretaker is "(AJ)" had that read as a relationship instead.
    const i = emptyIntake();
    i.caretaker.name = "(AJ)";
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.caretaker.name).toBe("(AJ)");
    expect(parsed?.caretaker.relationship).toBe("");
  });

  it("round-trips a name and relationship that are both awkward", () => {
    const i = emptyIntake();
    i.caretaker.name = "(AJ)";
    i.caretaker.relationship = "step-daughter (primary)";
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.caretaker.name).toBe("(AJ)");
    expect(parsed?.caretaker.relationship).toBe("step-daughter (primary)");
  });

  it("still reads the interim marked format", () => {
    const log = [
      INTAKE_BLOCK_START,
      "Confirmed: none",
      "Unconfirmed: pump, address, oop",
      "Caretaker: Jane Doe · (Daughter) · 3475550102 · authorized",
      INTAKE_BLOCK_END,
    ].join("\n");
    const c = parseIntakeBlock(log)?.caretaker;
    expect(c?.name).toBe("Jane Doe");
    expect(c?.relationship).toBe("Daughter");
  });
});


describe("⚠️ the confirmed pump model round-trips (Josh, 2026-09-09)", () => {
  it("records which model the rep confirmed", () => {
    const i = emptyIntake();
    i.confirmed.pump = true;
    i.pumpConfirmedModel = "t:slim";
    const parsed = parseIntakeBlock(appendIntakeToNotes("", i, { initials: "JH", now: AT }));
    expect(parsed?.confirmed.pump).toBe(true);
    expect(parsed?.pumpConfirmedModel).toBe("t:slim");
  });

  it("writes nothing when the box isn't ticked", () => {
    const i = emptyIntake();
    i.pumpConfirmedModel = "t:slim";
    const log = appendIntakeToNotes("", i, { initials: "JH", now: AT });
    expect(log).not.toContain("Pump confirmed:");
  });

  it("⚠️ survives a block written before the field existed", () => {
    // The notes column carries history. An older block has no "Pump confirmed"
    // line at all; parsing must yield "" rather than undefined, because
    // pumpConfirmationStale reads it and a crash here breaks the send.
    const legacy = [
      "--- WC INTAKE v1 ---",
      "Confirmed: pump, address",
      "Unconfirmed: oop",
      "--- END WC INTAKE ---",
    ].join("\n");
    const parsed = parseIntakeBlock(legacy);
    expect(parsed?.confirmed.pump).toBe(true);
    expect(parsed?.pumpConfirmedModel).toBe("");
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
