import { describe, it, expect } from "vitest";
import {
  secondaryStateFromBoard,
  secondaryMissing,
  secondaryWrites,
  isValidCin,
  SECONDARY_NONE,
} from "./secondaryCoverage";

describe("secondaryStateFromBoard", () => {
  /* ⚠️ The distinction the whole question rests on: blank means nobody has
     asked, "None" means somebody asked and the patient said no. Collapsing them
     reports an unasked question as answered — and because No WRITES "None", the
     next save would make that fabricated answer permanent. */
  it("reads a blank column as unknown, never as No", () => {
    expect(secondaryStateFromBoard("")).toEqual({ answer: "unknown", type: null });
    expect(secondaryStateFromBoard("   ")).toEqual({ answer: "unknown", type: null });
  });

  it("reads None as a real No", () => {
    expect(secondaryStateFromBoard("None")).toEqual({ answer: "no", type: null });
  });

  it("reads each type as Yes with the type selected", () => {
    expect(secondaryStateFromBoard("NY Medicaid")).toEqual({ answer: "yes", type: "NY Medicaid" });
    expect(secondaryStateFromBoard("Medicare Supplement")).toEqual({
      answer: "yes",
      type: "Medicare Supplement",
    });
    expect(secondaryStateFromBoard("Other")).toEqual({ answer: "yes", type: "Other" });
  });

  /* A rename, or the deactivated "Done" left on an old row, is an answer we
     cannot read — not an absent one. Reporting it as Yes/untyped makes the rep
     re-state it; reporting it as unknown would let a later save clear a real
     secondary policy. */
  it("treats an unrecognised label as Yes with no type", () => {
    expect(secondaryStateFromBoard("Done")).toEqual({ answer: "yes", type: null });
  });
});

describe("isValidCin", () => {
  it("accepts 2 letters, 5 digits, 1 letter", () => {
    expect(isValidCin("AB12345C")).toBe(true);
    expect(isValidCin(" ab12345c ")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isValidCin("A12345C")).toBe(false);
    expect(isValidCin("AB1234C")).toBe(false);
    expect(isValidCin("AB123456")).toBe(false);
    expect(isValidCin("")).toBe(false);
  });
});

describe("secondaryMissing", () => {
  const base = { memberId2: "", insuranceNotes: "" };

  /* ⚠️ Brandon: "patients often don't know". Unknown is a COMPLETE answer and
     must never hold up the call. */
  it("asks nothing of No or Unknown", () => {
    expect(secondaryMissing({ answer: "no", type: null, ...base })).toEqual([]);
    expect(secondaryMissing({ answer: "unknown", type: null, ...base })).toEqual([]);
  });

  it("wants a type once the answer is Yes", () => {
    expect(secondaryMissing({ answer: "yes", type: null, ...base })).toHaveLength(1);
  });

  it("wants a valid CIN for NY Medicaid", () => {
    expect(secondaryMissing({ answer: "yes", type: "NY Medicaid", ...base })).toHaveLength(1);
    expect(
      secondaryMissing({ answer: "yes", type: "NY Medicaid", ...base, memberId2: "nope" }),
    ).toHaveLength(1);
    expect(
      secondaryMissing({ answer: "yes", type: "NY Medicaid", ...base, memberId2: "AB12345C" }),
    ).toEqual([]);
  });

  /* Tag only — claims cross over from Medicare, so asking for an ID wastes a
     question on a call. */
  it("asks nothing of a Medicare supplement", () => {
    expect(secondaryMissing({ answer: "yes", type: "Medicare Supplement", ...base })).toEqual([]);
  });

  it("wants an ID and notes for Other", () => {
    expect(secondaryMissing({ answer: "yes", type: "Other", ...base })).toHaveLength(2);
    expect(
      secondaryMissing({ answer: "yes", type: "Other", memberId2: "X1", insuranceNotes: "Aetna 55" }),
    ).toEqual([]);
  });
});

describe("secondaryWrites", () => {
  /* ⚠️ Unknown writes NOTHING. Writing anything would turn "we asked and they
     didn't know" into a statement about their coverage. */
  it("writes nothing for Unknown", () => {
    expect(secondaryWrites({ answer: "unknown", type: null })).toEqual({});
  });

  /* ⚠️ No CLEARS Member ID 2 — a leftover ID under "None" is a contradiction
     the next reader has to resolve. This is why the send's guard had to stop
     dropping empty edits. */
  it("writes None and clears Member ID 2 for No", () => {
    expect(secondaryWrites({ answer: "no", type: null })).toEqual({
      secondaryInsurance: SECONDARY_NONE,
      memberId2: "",
    });
  });

  it("writes the type for Yes, and leaves an existing ID alone", () => {
    expect(secondaryWrites({ answer: "yes", type: "NY Medicaid" })).toEqual({
      secondaryInsurance: "NY Medicaid",
    });
    // Medicare Supplement carries no ID, but one already on the row is somebody's
    // record of something and this answer is not evidence it is wrong.
    expect(secondaryWrites({ answer: "yes", type: "Medicare Supplement" }).memberId2).toBeUndefined();
  });

  it("writes nothing for Yes with no type yet", () => {
    expect(secondaryWrites({ answer: "yes", type: null })).toEqual({});
  });
});
