import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COL, LIST_COLUMN_IDS, READ_COLUMN_IDS } from "./mondayApi";
import { mondayItemToPatient } from "./mondayMapping";
import { assertNotPartial, type Patient } from "./workflow";
import type { MondayItem } from "./mondayApi";

/**
 * The intake queue is read in two tiers: the sidebar list gets
 * `LIST_COLUMN_IDS`, the patient a rep opens gets all of `READ_COLUMN_IDS`.
 *
 * That is only safe while the slim set actually covers what a row renders. A
 * field read by the sidebar but missing from the slim set does NOT error — it
 * reads `""` on every row, forever, because `col()` defaults a missing column
 * to empty (the §5.11 trap). These tests are the thing that fails instead.
 */

/**
 * Patient field → the column that carries it. This IS the contract: adding a
 * field to a sidebar row means adding its column here and to LIST_COLUMN_IDS.
 */
const SLIM_FIELD_COLUMNS: Record<string, string> = {
  referralSource: COL.referralSource,
  attemptCounter: COL.attemptCounter,
  dropOffAttempt: COL.dropOffAttempt,
  followUp: COL.followUp,
  followUpDate: COL.followUpDate,
  dateOfIntake: COL.dateOfIntake,
  intakeEscalation: COL.intakeEscalation,
  ptPhone: COL.ptPhone,
};

/** Present on every item regardless of the column set — they are not columns. */
const ALWAYS_AVAILABLE = new Set(["id", "name", "groupId", "partial"]);

/** Source files whose `p.<field>` reads must be satisfied by the slim set. */
const ROW_SOURCES = [
  "src/lib/profile/sidebarList.ts",
  "src/components/profile/PatientsSidebar.tsx",
];

function fieldsReadIn(relPath: string): string[] {
  const src = readFileSync(resolve(process.cwd(), relPath), "utf8");
  const hits = src.match(/\bp\.[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  return [...new Set(hits.map((h) => h.slice(2)))];
}

describe("LIST_COLUMN_IDS covers what the sidebar renders", () => {
  for (const file of ROW_SOURCES) {
    it(`${file} reads nothing the slim fetch omits`, () => {
      const missing = fieldsReadIn(file).filter(
        (f) => !ALWAYS_AVAILABLE.has(f) && !(f in SLIM_FIELD_COLUMNS),
      );
      expect(
        missing,
        `These patient fields are read when rendering a sidebar row but are not in ` +
          `LIST_COLUMN_IDS, so they will read "" on every row with no error. Add the ` +
          `column to LIST_COLUMN_IDS and to SLIM_FIELD_COLUMNS in this test: ` +
          `${missing.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("declares a column for every field the contract names", () => {
    for (const [field, colId] of Object.entries(SLIM_FIELD_COLUMNS)) {
      expect(colId, `no column id for ${field}`).toBeTruthy();
      expect(
        LIST_COLUMN_IDS,
        `${field} (${colId}) is in the contract but missing from LIST_COLUMN_IDS`,
      ).toContain(colId);
    }
  });

  it("carries the manager-view filter column", () => {
    // UnverifiedReferralsPage's `visible` memo filters on intakeEscalation for
    // ?origin=manager-intervention / final-decisions. Omit it and both manager
    // views silently render every patient as non-escalated.
    expect(LIST_COLUMN_IDS).toContain(COL.intakeEscalation);
  });

  it("stays a strict subset of the full read set", () => {
    // A column the detail fetch does not also read would make the open patient
    // LOSE a value the list had — the opposite drift, equally silent.
    for (const id of LIST_COLUMN_IDS) {
      expect(READ_COLUMN_IDS, `${id} is not in READ_COLUMN_IDS`).toContain(id);
    }
  });

  it("is meaningfully smaller than the full set", () => {
    // The whole point. If these converge, the two-tier read has quietly been
    // undone and the queue is back to ~194k column values a poll.
    expect(LIST_COLUMN_IDS.length).toBeLessThan(READ_COLUMN_IDS.length / 4);
  });

  it("has no duplicates", () => {
    expect(new Set(LIST_COLUMN_IDS).size).toBe(LIST_COLUMN_IDS.length);
  });
});

function itemWith(cols: { id: string; text: string }[]): MondayItem {
  return {
    id: "1",
    name: "Test Patient",
    group: { id: "group_mm5z87zt" },
    column_values: cols.map((c) => ({ id: c.id, text: c.text, value: null })),
  } as unknown as MondayItem;
}

describe("partial records are marked and refused", () => {
  it("stamps partial only when told", () => {
    const narrow = mondayItemToPatient(itemWith([]), { partial: true });
    expect(narrow.partial).toBe(true);

    const full = mondayItemToPatient(itemWith([]));
    expect(full.partial).toBeUndefined();

    // Explicitly false must behave like a full record, not stamp `false` —
    // `if (p.partial)` is the whole test everywhere else.
    const notPartial = mondayItemToPatient(itemWith([]), { partial: false });
    expect(notPartial.partial).toBeUndefined();
  });

  it("a narrow read is indistinguishable from a blank board WITHOUT the marker", () => {
    // This is the reason the marker exists rather than a value check: the two
    // records below are identical apart from `partial`.
    const narrow = mondayItemToPatient(itemWith([]), { partial: true });
    expect(narrow.dob).toBe("");
    expect(narrow.generalInsurance).toBe("");
    const { partial: _p, ...narrowRest } = narrow;
    expect(narrowRest).toEqual(mondayItemToPatient(itemWith([])));
  });

  it("assertNotPartial throws on a partial record", () => {
    const p = mondayItemToPatient(itemWith([]), { partial: true });
    expect(() => assertNotPartial(p, "intakeEditsFor")).toThrow(/partially-loaded/i);
    // The id is in the message — a thrown error with no patient in it is much
    // harder to act on from a support ticket.
    expect(() => assertNotPartial(p, "intakeEditsFor")).toThrow(/1/);
  });

  it("assertNotPartial passes a full record through silently", () => {
    const p = mondayItemToPatient(itemWith([{ id: COL.dob, text: "01/02/1980" }]));
    expect(() => assertNotPartial(p, "intakeEditsFor")).not.toThrow();
  });

  it("treats a hand-built fixture (no marker) as full", () => {
    // Existing fixtures across the suite predate `partial` and must keep working.
    const fixture = { id: "9", name: "Fixture" } as unknown as Patient;
    expect(() => assertNotPartial(fixture, "intakeEditsFor")).not.toThrow();
  });
});
