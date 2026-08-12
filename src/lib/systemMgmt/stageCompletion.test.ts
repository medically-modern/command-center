import { describe, it, expect } from "vitest";
import {
  activityLogMs,
  completedAtFromLogs,
  completedStageUrl,
  formatStageCompletedAt,
  COMPLETED_STAGE_ROUTES,
  STAGE_COMPLETION_COLUMNS,
  type ActivityLogEntry,
} from "./stageCompletion";
import { buildCompletionMap } from "./mondayApi";
import type { SystemPatient } from "./mondayApi";

/** Real shapes, trimmed to the fields the parser reads. */
function groupMove(createdAt: string, destGroupId: string): ActivityLogEntry {
  return {
    event: "move_pulse_from_group",
    created_at: createdAt,
    data: JSON.stringify({
      source_group: { id: "group_mm1xf2jb", title: "2. Medical Necessity" },
      dest_group: { id: destGroupId, title: "Completed" },
      pulse_id: 11910600481,
    }),
  };
}

function statusWrite(createdAt: string, columnId: string, text: string): ActivityLogEntry {
  return {
    event: "update_column_value",
    created_at: createdAt,
    data: JSON.stringify({
      column_id: columnId,
      column_title: "Stage Advancer",
      value: { label: { index: 14, text } },
    }),
  };
}

const MASHEKE = 18406060017;
const MASHEKE_DONE = "group_mm1x5q4e";
const masheke = { completedGroupIds: [MASHEKE_DONE], column: STAGE_COMPLETION_COLUMNS[MASHEKE] };

describe("activityLogMs", () => {
  it("reads Monday's 100-nanosecond ticks, not milliseconds", () => {
    // The real value logged when Sophia Wingfield's MN item was completed.
    expect(activityLogMs("17778527595987346")).toBe(1777852759599);
    expect(new Date(activityLogMs("17778527595987346")).getUTCFullYear()).toBe(2026);
  });
});

describe("completedAtFromLogs", () => {
  it("uses the move into the board's Completed group", () => {
    const at = completedAtFromLogs([groupMove("17778527595987346", MASHEKE_DONE)], masheke);
    expect(at).toBe(new Date(1777852759599).toISOString());
  });

  it("ignores a move into some OTHER group", () => {
    expect(
      completedAtFromLogs([groupMove("17778527595987346", "group_mm4vhqff")], masheke),
    ).toBeNull();
  });

  it("falls back to the completion status write when no move was logged", () => {
    // The Welcome Call board really does this: a batch move logs no
    // move_pulse_* event, leaving the Stage Advancer flip as the only signal.
    const wc = {
      completedGroupIds: ["group_mm1x5s5d"],
      column: STAGE_COMPLETION_COLUMNS[18410804557],
    };
    const at = completedAtFromLogs(
      [statusWrite("17775007050080602", "color_mm1ws96t", "Completed")],
      wc,
    );
    expect(at).toBe(new Date(1777500705008).toISOString());
  });

  it("matches each board's own completion vocabulary", () => {
    // Insurance says "Complete", Profile Send Off exits via a different column
    // entirely ("Advance to MN") — a shared /^completed$/ rule would miss both.
    const ins = { completedGroupIds: ["group_mm2vw3c0"], column: STAGE_COMPLETION_COLUMNS[18410601299] };
    expect(
      completedAtFromLogs([statusWrite("17774964433438612", "color_mm1ws96t", "Complete")], ins),
    ).not.toBeNull();

    const pso = { completedGroupIds: ["group_mm1y57sz"], column: STAGE_COMPLETION_COLUMNS[18406352652] };
    expect(
      completedAtFromLogs([statusWrite("17750502908708786", "color_mm1zmeb3", "Advance to MN")], pso),
    ).not.toBeNull();
  });

  it("ignores the same label written to a DIFFERENT column", () => {
    expect(
      completedAtFromLogs([statusWrite("17778527595987346", "color_mm1wz0vg", "Completed")], masheke),
    ).toBeNull();
  });

  it("takes the LATEST completion when a patient finished the board twice", () => {
    const at = completedAtFromLogs(
      [
        groupMove("17800000000000000", MASHEKE_DONE), // re-completed
        statusWrite("17778527497581738", "color_mm1wyr92", "Completed"),
        groupMove("17778527595987346", MASHEKE_DONE), // first time through
      ],
      masheke,
    );
    expect(at).toBe(new Date(activityLogMs("17800000000000000")).toISOString());
  });

  it("returns null (never a guess) when the log has aged out", () => {
    expect(completedAtFromLogs([], masheke)).toBeNull();
    expect(
      completedAtFromLogs([statusWrite("17778527595987346", "color_mm1wyr92", "Chase Clinicals")], masheke),
    ).toBeNull();
  });

  it("skips malformed entries instead of failing the whole lookup", () => {
    const at = completedAtFromLogs(
      [
        { event: "update_column_value", created_at: "1", data: "{not json" },
        groupMove("17778527595987346", MASHEKE_DONE),
      ],
      masheke,
    );
    expect(at).not.toBeNull();
  });
});

describe("completedStageUrl", () => {
  it("opens the completed ITEM in review mode, with Back still pointing home", () => {
    expect(
      completedStageUrl({
        label: "MN",
        itemId: "111",
        boardId: MASHEKE,
        boardName: "Medical Evaluation",
        route: "/evaluate",
      }),
    ).toBe("/evaluate?patientId=111&completedStage=18406060017&from=system-mgmt");
  });
});

describe("formatStageCompletedAt", () => {
  it("renders the instant in ET, not the runtime's zone", () => {
    // 2026-05-04T03:59:19Z is still May 3rd, 11:59 PM in New York.
    expect(formatStageCompletedAt("2026-05-04T03:59:19.000Z")).toBe("May 3, 2026 at 11:59 PM");
  });

  it("returns an empty string for an unparseable value", () => {
    expect(formatStageCompletedAt("nope")).toBe("");
  });
});

// ── The badges themselves ────────────────────────────────────

function patient(over: Partial<SystemPatient>): SystemPatient {
  return {
    id: "1", name: "Jane Doe", phone: "", boardId: MASHEKE, boardName: "Medical Evaluation",
    groupId: MASHEKE_DONE, groupTitle: "Completed", roleRoute: "", pipelineStage: "Completed",
    escalated: false, escalationText: "", escalationNotes: "", hasPage: false, isCompleted: true,
    daysSinceStage: "", notes: "", stageAdvancerText: "Completed", nextActionDate: "",
    ...over,
  };
}

describe("buildCompletionMap", () => {
  it("points a badge at the COMPLETED item, not the row it renders on", () => {
    // The live row is the patient's Insurance item; the MN badge must open the
    // Medical Evaluation item, which is a different id on a different board.
    const map = buildCompletionMap([
      patient({ id: "111", boardId: MASHEKE, boardName: "Medical Evaluation" }),
      patient({ id: "222", boardId: 18410601299, boardName: "Insurance", isCompleted: false }),
    ]);
    const stages = map.get("jane doe")!;
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ label: "MN", itemId: "111", route: "/evaluate" });
  });

  it("gives every completed board a route to open", () => {
    for (const boardId of Object.keys(STAGE_COMPLETION_COLUMNS).map(Number)) {
      expect(COMPLETED_STAGE_ROUTES[boardId]).toBeTruthy();
    }
  });

  it("keeps one badge per board when a patient ran the board twice", () => {
    const map = buildCompletionMap([
      patient({ id: "111" }),
      patient({ id: "999" }), // second pass through Medical Evaluation
    ]);
    expect(map.get("jane doe")).toHaveLength(1);
  });

  it("ignores patients who are still working a board", () => {
    const map = buildCompletionMap([patient({ isCompleted: false })]);
    expect(map.size).toBe(0);
  });

  it("matches names case- and whitespace-insensitively, like search does", () => {
    const map = buildCompletionMap([patient({ name: "  Jane Doe  " })]);
    expect(map.get("jane doe")).toHaveLength(1);
  });
});
