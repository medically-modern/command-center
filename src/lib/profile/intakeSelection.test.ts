/**
 * The 2026-09-30 wrong-patient report, as tests.
 *
 * Mary Terrell was linked from her patient screen, was not in the fetched
 * group, still carried a stale "Manager Escalation Required" from having been
 * marked stuck, and the page opened Kayla Carey instead.
 */
import { describe, it, expect } from "vitest";
import { visibleIntakeRows, intakeRowForSelection, isEscalated } from "./intakeSelection";

const MARY = { id: "12895923748", intakeEscalation: "Manager Escalation Required" };
const KAYLA = { id: "12871811687", intakeEscalation: "" };
const OTHER = { id: "3", intakeEscalation: "" };
const FINAL = { id: "4", intakeEscalation: "Final Escalation Required" };

describe("who the queue shows", () => {
  it("hides escalated patients from a rep, as it always did", () => {
    expect(visibleIntakeRows([MARY, KAYLA], null, null)).toEqual([KAYLA]);
  });

  it("⚠️ but never hides the patient the URL named", () => {
    expect(visibleIntakeRows([MARY, KAYLA], null, MARY.id)).toEqual([MARY, KAYLA]);
  });

  it("the exemption is ONE id — every other escalated patient stays hidden", () => {
    expect(visibleIntakeRows([MARY, FINAL, KAYLA], null, MARY.id)).toEqual([MARY, KAYLA]);
  });

  it("a manager column still shows only its own rung, plus the named patient", () => {
    expect(visibleIntakeRows([MARY, FINAL, KAYLA], "manager-intervention", null)).toEqual([MARY]);
    expect(visibleIntakeRows([MARY, FINAL, KAYLA], "final-decisions", null)).toEqual([FINAL]);
    // A named non-escalated patient is reachable from a manager column too.
    expect(visibleIntakeRows([MARY, FINAL, KAYLA], "final-decisions", KAYLA.id)).toEqual([FINAL, KAYLA]);
  });

  it("no deep link means the filters behave exactly as before", () => {
    expect(visibleIntakeRows([MARY, KAYLA, FINAL], null, null)).toEqual([KAYLA]);
  });

  it("a blank escalation is not escalated", () => {
    expect(isEscalated(KAYLA)).toBe(false);
    expect(isEscalated({ id: "x" })).toBe(false);
    expect(isEscalated(MARY)).toBe(true);
  });
});

describe("which row opens", () => {
  it("⚠️⚠️ a named patient who is absent opens NOTHING — never a substitute", () => {
    // The whole report: asked for Mary, list holds Kayla, got Kayla.
    expect(intakeRowForSelection([KAYLA, OTHER], MARY.id)).toBeNull();
  });

  it("opens the named patient when they are there", () => {
    expect(intakeRowForSelection([KAYLA, MARY], MARY.id)).toEqual(MARY);
  });

  it("still defaults to the first row when nothing was asked for", () => {
    // The ordinary page-open case, and the post-advance one.
    expect(intakeRowForSelection([KAYLA, OTHER], null)).toEqual(KAYLA);
  });

  it("an empty list opens nothing, asked for or not", () => {
    expect(intakeRowForSelection([], MARY.id)).toBeNull();
    expect(intakeRowForSelection([], null)).toBeNull();
  });
});

describe("the reported case, end to end", () => {
  it("Mary is admitted and opened; without the fix Kayla was opened", () => {
    const fetched = [MARY, KAYLA]; // Kayla from the group, Mary injected by id
    const shown = visibleIntakeRows(fetched, null, MARY.id);
    expect(intakeRowForSelection(shown, MARY.id)).toEqual(MARY);
  });

  it("and if she genuinely is not on the board, nothing opens", () => {
    const shown = visibleIntakeRows([KAYLA], null, MARY.id);
    expect(intakeRowForSelection(shown, MARY.id)).toBeNull();
  });
});
