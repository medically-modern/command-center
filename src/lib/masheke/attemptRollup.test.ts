import { describe, it, expect } from "vitest";
import { buildAttemptRollup, returnResetsAttempts, type AttemptSlots } from "./attemptRollup";

const NONE: AttemptSlots = [undefined, undefined, undefined];
const DATE = "2026-08-14";

describe("buildAttemptRollup", () => {
  it("is a no-op when every attempt column is empty", () => {
    const r = buildAttemptRollup({ notes: "existing history", confirm: NONE, chase: NONE, dateStr: DATE });
    expect(r.hasAttempts).toBe(false);
    // The notes come back UNCHANGED — the caller writes no clears and appends
    // no empty header.
    expect(r.notes).toBe("existing history");
  });

  it("treats whitespace-only columns as empty", () => {
    const r = buildAttemptRollup({ notes: "", confirm: ["   ", "", undefined], chase: ["\n", undefined, undefined], dateStr: DATE });
    expect(r.hasAttempts).toBe(false);
    expect(r.notes).toBe("");
  });

  it("folds both stages in under dated headers, after the existing history", () => {
    const r = buildAttemptRollup({
      notes: "6/1/26 · Evaluate: first pass —JH",
      confirm: ["6/2/26 · Confirmed · spoke to Dana", undefined, undefined],
      chase: ["6/5/26 · No answer", "6/9/26 · Left VM", "6/12/26 · Refax sent"],
      dateStr: DATE,
    });
    expect(r.hasAttempts).toBe(true);
    expect(r.notes).toBe(
      [
        "6/1/26 · Evaluate: first pass —JH",
        "",
        `--- Confirm Receipt notes (cycle thru ${DATE}) ---`,
        "Attempt 1: 6/2/26 · Confirmed · spoke to Dana",
        "",
        `--- Chase Clinicals notes (cycle thru ${DATE}) ---`,
        "Attempt 1: 6/5/26 · No answer",
        "Attempt 2: 6/9/26 · Left VM",
        "Attempt 3: 6/12/26 · Refax sent",
      ].join("\n"),
    );
  });

  it("numbers lines by SLOT, not by position — a skipped slot keeps its neighbours honest", () => {
    const r = buildAttemptRollup({ notes: "", confirm: NONE, chase: [undefined, "6/9/26 · Left VM", "6/12/26 · Refax"], dateStr: DATE });
    expect(r.notes).toContain("Attempt 2: 6/9/26 · Left VM");
    expect(r.notes).toContain("Attempt 3: 6/12/26 · Refax");
    expect(r.notes).not.toContain("Attempt 1:");
  });

  it("emits only the stage that has attempts", () => {
    const r = buildAttemptRollup({ notes: "", confirm: ["6/2/26 · Confirmed", undefined, undefined], chase: NONE, dateStr: DATE });
    expect(r.notes).toBe(`--- Confirm Receipt notes (cycle thru ${DATE}) ---\nAttempt 1: 6/2/26 · Confirmed`);
    expect(r.notes).not.toContain("Chase Clinicals notes");
  });

  it("starts the body with the header when there is no prior history (no leading blank line)", () => {
    const r = buildAttemptRollup({ notes: undefined, confirm: NONE, chase: ["6/5/26 · No answer", undefined, undefined], dateStr: DATE });
    expect(r.notes.startsWith("--- Chase Clinicals notes")).toBe(true);
  });

  it("never drops the existing history", () => {
    const history = "line one\n\nline two";
    const r = buildAttemptRollup({ notes: history, confirm: ["a", undefined, undefined], chase: NONE, dateStr: DATE });
    expect(r.notes.startsWith(history)).toBe(true);
  });

  it("is idempotent in the way that matters: a second run over cleared columns changes nothing", () => {
    const first = buildAttemptRollup({ notes: "hist", confirm: ["a", undefined, undefined], chase: NONE, dateStr: DATE });
    // After the write the columns are blank, so a retry re-reads them empty.
    const second = buildAttemptRollup({ notes: first.notes, confirm: NONE, chase: NONE, dateStr: DATE });
    expect(second.hasAttempts).toBe(false);
    expect(second.notes).toBe(first.notes);
  });
});

describe("returnResetsAttempts", () => {
  it("resets on Evaluate — the patient is going back to the top of the loop", () => {
    expect(returnResetsAttempts("evaluate")).toBe(true);
  });

  it("does NOT reset on any other Medical Evaluation stage", () => {
    // Chase/Confirm returns land back in the SAME cycle: the attempts on screen
    // are the ones just spent, and MN Attempts stays "Escalate" so the Oversight
    // Attempt 4+ charts keep remembering them (CLAUDE.md §7).
    for (const stage of ["send-request", "confirm-receipt", "chase-fax", "chase-parachute", "doctor-appointments"]) {
      expect(returnResetsAttempts(stage)).toBe(false);
    }
  });

  it("does not reset for the other boards' stages, or for a missing stage", () => {
    for (const stage of ["benefits", "submit-auth", "auth-outstanding", "dvs", "unverified-intake", undefined, null, ""]) {
      expect(returnResetsAttempts(stage)).toBe(false);
    }
  });
});
