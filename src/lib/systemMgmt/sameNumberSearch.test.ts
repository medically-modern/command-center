/**
 * The same-number pass: how a name search finds the records filed under a
 * DIFFERENT name for the same patient.
 *
 * The fixtures are the real boards as of 2026-09-11. One woman, one number
 * (406) 223-7445, one DOB 08/28/1956, five items, two spellings — a one-letter
 * first-name typo and a Spanish double surname kept on some boards and not
 * others. `contains_text` is a contiguous substring ANDed per word, so no name
 * query returns both halves, and the rep searching either one is told about
 * half of her. Reported by Josh the same day, after the half nobody could see
 * had been advanced into Medical Necessity as a brand-new patient.
 */
import { describe, it, expect } from "vitest";
import {
  SAME_NUMBER_MAX_PHONES,
  mergeSameNumberRows,
  phoneNeedle,
  sameNumberNeedles,
  type SystemPatient,
} from "./mondayApi";

function patient(over: Partial<SystemPatient> & { id: string; name: string }): SystemPatient {
  return {
    phone: "",
    boardId: 18406352652,
    boardName: "Profile Send Off",
    groupId: "group_mm1xf2jb",
    groupTitle: "Intake",
    roleRoute: "/profile",
    pipelineStage: "Intake",
    escalated: false,
    escalationText: "",
    escalationLevel: null,
    escalationNotes: "",
    hasPage: true,
    isCompleted: false,
    daysSinceStage: "0–2 Days",
    notes: "",
    stageAdvancerText: "",
    nextActionDate: "",
    ...over,
  };
}

const HER_NUMBER = "4062237445";

/** The three records carrying the name a rep would type. */
const AUGUSTINA = [
  patient({ id: "12601880131", name: "Augustina Rodriguez", phone: HER_NUMBER, boardId: 18392794310, boardName: "DTC Intake" }),
  patient({ id: "12601854667", name: "Augustina Rodriguez", phone: HER_NUMBER }),
  patient({ id: "13029591500", name: "Augustina Rodriguez", phone: HER_NUMBER, boardId: 18406060017, boardName: "Medical Evaluation" }),
];
/** The two the name query can never reach — and the live subscription. */
const AGUSTINA = [
  patient({ id: "11812621880", name: "Agustina Rodriguez Hernandez", phone: HER_NUMBER, boardId: 18407459988, boardName: "Subscription Board", roleRoute: "/subscription" }),
  patient({ id: "12528631023", name: "Agustina Rodriguez Hernandez", phone: HER_NUMBER, boardId: 18413019028, boardName: "Secondary Claims", roleRoute: "" }),
];

describe("phoneNeedle", () => {
  it("reduces however the board stored it to the same ten digits", () => {
    // This account holds both shapes in the same column (§5.29), so the last
    // ten is the only needle a `contains_text` finds in either.
    expect(phoneNeedle(HER_NUMBER)).toBe(HER_NUMBER);
    expect(phoneNeedle("1" + HER_NUMBER)).toBe(HER_NUMBER);
    expect(phoneNeedle("(406) 223-7445")).toBe(HER_NUMBER);
    expect(phoneNeedle("+1 406-223-7445")).toBe(HER_NUMBER);
  });

  it("refuses anything that is not a whole number", () => {
    // A partial number would match strangers: "223-7445" is inside plenty of
    // other numbers, and the pass would fan out on all of them.
    expect(phoneNeedle("")).toBe("");
    expect(phoneNeedle("2237445")).toBe("");
    expect(phoneNeedle("n/a")).toBe("");
  });
});

describe("sameNumberNeedles", () => {
  it("fans out on the one number a narrowed name query found", () => {
    expect(sameNumberNeedles(AUGUSTINA)).toEqual([HER_NUMBER]);
  });

  it("does NOT fan out on a surname", () => {
    // "Rodriguez" returns forty rows and forty numbers — forty people, none of
    // them the one being looked up. Skipping is the point: the pass exists for
    // a lookup that has already narrowed, not for browsing a name.
    const many = Array.from({ length: SAME_NUMBER_MAX_PHONES + 1 }, (_, i) =>
      patient({ id: `r${i}`, name: `Rodriguez ${i}`, phone: `406223744${i}` }),
    );
    expect(sameNumberNeedles(many)).toEqual([]);
  });

  it("fans out at exactly the cap — a household is still a lookup", () => {
    const rows = Array.from({ length: SAME_NUMBER_MAX_PHONES }, (_, i) =>
      patient({ id: `r${i}`, name: `Rodriguez ${i}`, phone: `406223744${i}` }),
    );
    expect(sameNumberNeedles(rows)).toHaveLength(SAME_NUMBER_MAX_PHONES);
  });

  it("a blank phone column is not evidence of a person", () => {
    // Rows with no readable number must not count against the cap, or a board
    // that returns a blank phone quietly switches the whole pass off.
    const blanks = Array.from({ length: 20 }, (_, i) => patient({ id: `b${i}`, name: "No Phone" }));
    expect(sameNumberNeedles([...blanks, ...AUGUSTINA])).toEqual([HER_NUMBER]);
    expect(sameNumberNeedles(blanks)).toEqual([]);
  });
});

describe("mergeSameNumberRows", () => {
  it("adds the records the name query could not see, and marks them", () => {
    // The number pass returns HER — every record on the line, including the
    // three the name query already had.
    const merged = mergeSameNumberRows(AUGUSTINA, [...AUGUSTINA, ...AGUSTINA]);
    expect(merged).toHaveLength(5);

    const subscription = merged.find((p) => p.boardId === 18407459988);
    expect(subscription?.name).toBe("Agustina Rodriguez Hernandez");
    expect(subscription?.matchedBy).toBe("phone");
    // …and it is a workable row, so searching her name now reaches the
    // subscription profile, which is what was asked for.
    expect(subscription?.roleRoute).toBe("/subscription");
  });

  it("leaves the name rows exactly as they were", () => {
    const merged = mergeSameNumberRows(AUGUSTINA, [...AUGUSTINA, ...AGUSTINA]);
    for (const row of merged.slice(0, AUGUSTINA.length)) {
      expect(row.matchedBy).toBeUndefined();
    }
  });

  it("never repeats a row the name query already returned", () => {
    const merged = mergeSameNumberRows(AUGUSTINA, AUGUSTINA);
    expect(merged).toEqual(AUGUSTINA);
  });

  it("keys on board AND item — the same id on two boards is two records", () => {
    // Monday ids are unique, but the key must not narrow to one of them by
    // accident: every patient here IS several items, and collapsing them would
    // drop the very stage the rep is looking for.
    const same = patient({ id: "12601854667", name: "Augustina Rodriguez", phone: HER_NUMBER, boardId: 18410601299 });
    const merged = mergeSameNumberRows(AUGUSTINA, [same]);
    expect(merged).toHaveLength(4);
    expect(merged[3].matchedBy).toBe("phone");
  });
});
