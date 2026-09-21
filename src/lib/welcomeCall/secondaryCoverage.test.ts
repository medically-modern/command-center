import { describe, it, expect } from "vitest";
import {
  secondaryStateFromBoard,
  secondaryStateFor,
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

describe("secondaryStateFor", () => {
  const board = {
    secondaryUnknown: undefined as boolean | undefined,
    secondaryInsuranceEdited: null as string | null,
    secondaryInsurance: "",
  };

  it("reads the column when the rep has not answered Unknown", () => {
    expect(secondaryStateFor({ ...board, secondaryInsurance: "NY Medicaid" })).toEqual({
      answer: "yes",
      type: "NY Medicaid",
    });
    expect(secondaryStateFor({ ...board, secondaryInsurance: "None" })).toEqual({
      answer: "no",
      type: null,
    });
  });

  it("prefers a live edit over the column, as every other field does", () => {
    expect(
      secondaryStateFor({
        ...board,
        secondaryInsurance: "NY Medicaid",
        secondaryInsuranceEdited: "None",
      }),
    ).toEqual({ answer: "no", type: null });
  });

  /* ⚠️ THE WHOLE POINT. Unknown writes nothing, so the column still says
     NY Medicaid — and the send gate used to re-read it, demanding a CIN the
     rep had just recorded as unknown. Advance had no passing move
     (Greptile, PR #56). */
  it("lets the rep's Unknown beat a column that still holds a policy", () => {
    const p = { ...board, secondaryInsurance: "NY Medicaid", secondaryUnknown: true };
    expect(secondaryStateFor(p)).toEqual({ answer: "unknown", type: null });
    expect(
      secondaryMissing({ ...secondaryStateFor(p), memberId2: "", insuranceNotes: "" }),
    ).toEqual([]);
  });

  it("does the same for an 'Other' secondary, whose gate wants an ID and notes", () => {
    const p = { ...board, secondaryInsurance: "Other", secondaryUnknown: true };
    expect(
      secondaryMissing({ ...secondaryStateFor(p), memberId2: "", insuranceNotes: "" }),
    ).toEqual([]);
    // and without the flag that same patient IS gated, so the carve-out is
    // the flag rather than the module going quiet.
    expect(
      secondaryMissing({
        ...secondaryStateFor({ ...p, secondaryUnknown: false }),
        memberId2: "",
        insuranceNotes: "",
      }),
    ).toHaveLength(2);
  });

  it("still writes nothing for Unknown, so the policy on the board survives", () => {
    expect(secondaryWrites(secondaryStateFor({ ...board, secondaryInsurance: "NY Medicaid", secondaryUnknown: true }))).toEqual({});
  });
});

/* ⚠️⚠️ THE BUG MASANI REPORTED, 2026-09-21 (Barbara Mussomele `12950395348`,
   Medicare A&B, a real BCBS secondary): *"the options to update the
   information for 2ndary coverage won't allow me to change to yes"*.
   `secondaryWrites` has no label for a typeless Yes — correctly, since the
   board has no "yes, kind unknown" label — so the click wrote nothing, the
   state was re-derived from a column still saying `None`, and the button
   snapped back to No. Unreachable for 29 of the 41 live patients, and a CLOSED
   loop: the Type buttons that would give Yes a label only render once the
   answer is already yes. */
describe("the rep's Yes, before a type is picked", () => {
  const board = {
    secondaryUnknown: undefined as boolean | undefined,
    secondaryYes: undefined as boolean | undefined,
    secondaryInsuranceEdited: null as string | null,
    secondaryInsurance: "",
  };

  it("is reachable from a board that says None", () => {
    const p = { ...board, secondaryInsurance: "None", secondaryYes: true };
    expect(secondaryStateFor(p)).toEqual({ answer: "yes", type: null });
  });

  it("is reachable from a blank board — nobody asked, and now they have", () => {
    expect(secondaryStateFor({ ...board, secondaryYes: true })).toEqual({
      answer: "yes",
      type: null,
    });
  });

  /* A rep who clicked No first and then corrected themselves. The overlay is
     carrying "None" from that earlier click, so the flag has to beat the EDIT
     as well as the column. */
  it("is reachable after the rep has already clicked No", () => {
    const p = { ...board, secondaryInsurance: "", secondaryInsuranceEdited: "None", secondaryYes: true };
    expect(secondaryStateFor(p)).toEqual({ answer: "yes", type: null });
  });

  /* ⚠️ Without a passing move this is just the old dead end wearing a Yes. The
     gate asks for the type, and the Type buttons render precisely because the
     answer is now yes — so the ask can be answered on screen. */
  it("leaves ONE thing outstanding, and it is answerable", () => {
    const p = { ...board, secondaryInsurance: "None", secondaryYes: true };
    expect(secondaryMissing({ ...secondaryStateFor(p), memberId2: "", insuranceNotes: "" })).toEqual([
      "Pick the secondary coverage type.",
    ]);
  });

  it("resolves once a type is picked, and only then writes a label", () => {
    // What the control does on a type click: `answer({answer:"yes", type:t})`.
    const w = secondaryWrites({ answer: "yes", type: "Other" });
    expect(w).toEqual({ secondaryInsurance: "Other" });
    const p = { ...board, secondaryInsuranceEdited: "Other", secondaryYes: true };
    expect(secondaryStateFor(p)).toEqual({ answer: "yes", type: "Other" });
    expect(
      secondaryMissing({
        ...secondaryStateFor(p),
        memberId2: "R10000000",
        insuranceNotes: "Horizon BCBS, group 12345",
      }),
    ).toEqual([]);
  });

  /* ⚠️ The flag must NOT flatten a policy already on the row: that would hide
     the Member ID 2 field and ask the rep to re-pick a type the board names. */
  it("never overrides a type the board already holds", () => {
    const p = { ...board, secondaryInsurance: "NY Medicaid", secondaryYes: true };
    expect(secondaryStateFor(p)).toEqual({ answer: "yes", type: "NY Medicaid" });
  });

  /* The control writes both flags on every click so they cannot both be true;
     if a stale overlay ever managed it, the answer that writes NOTHING wins. */
  it("loses to Unknown, the safer of the two no-write answers", () => {
    const p = { ...board, secondaryInsurance: "None", secondaryYes: true, secondaryUnknown: true };
    expect(secondaryStateFor(p)).toEqual({ answer: "unknown", type: null });
  });

  it("still fabricates no board label — the column is left as it was", () => {
    const p = { ...board, secondaryInsurance: "None", secondaryYes: true };
    expect(secondaryWrites(secondaryStateFor(p))).toEqual({});
  });
});
