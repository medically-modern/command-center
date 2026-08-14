/**
 * The Escalations tab's description of an escalation.
 *
 * The bug these guard against: the tab read a retired "Escalation Notes" column
 * whose structured form was populated for 3 of 58 live escalated patients, so
 * the Details modal said "no data" for nearly everyone and every row rendered
 * the same default urgency colour. The reason actually lives in the stage's
 * NOTES column as a stamped line, or — for an auto-escalation — as the attempt
 * log. These tests pin that, and pin that the level derivation can never
 * disagree with the membership test about who is escalated.
 */
import { describe, it, expect } from "vitest";
import {
  escalationLevelFrom,
  escalationTimeline,
  proposedStuckReason,
  parseAttemptNotes,
  buildEscalationDetail,
  LEVEL_LABEL,
} from "./escalationDetail";
import {
  stampProposedStuck,
  stampReturnedToQueue,
  stampApprovedStuck,
  stampEscalatedToFinal,
  stampReturnedToManager,
  appendStampedLine,
} from "../masheke/proposedStuck";

const ME = 18406060017;
const INSURANCE = 18410601299;
const WELCOME_CALL = 18410804557;

describe("escalationLevelFrom", () => {
  it("reads the split labels on Medical Evaluation and Insurance", () => {
    for (const board of [ME, INSURANCE]) {
      expect(escalationLevelFrom(board, "Manager Escalation Required", 0)).toBe("manager");
      expect(escalationLevelFrom(board, "Final Escalation Required", 2)).toBe("final");
    }
  });

  it("falls back to the raw index when the label was renamed", () => {
    // The whole point of the index path: detection survives a board rename.
    expect(escalationLevelFrom(ME, "Renamed By Somebody", 0)).toBe("manager");
    expect(escalationLevelFrom(ME, "Renamed By Somebody", 2)).toBe("final");
    expect(escalationLevelFrom(INSURANCE, "", 2)).toBe("final");
  });

  it("does NOT apply the index fallback to unsplit boards", () => {
    // Welcome Call's index 0 is its only escalation label; a board that never
    // split must not be described with a manager/final rung it has no concept
    // of — but it must still resolve to a level, or it drops out of the tab.
    expect(escalationLevelFrom(WELCOME_CALL, "Escalation Required", 0)).toBe("flat");
    expect(escalationLevelFrom(WELCOME_CALL, "", 0)).toBeNull();
  });

  it("returns null for Done, blank and the grey unlabelled index", () => {
    expect(escalationLevelFrom(ME, "Done", 1)).toBeNull();
    expect(escalationLevelFrom(ME, "", null)).toBeNull();
    expect(escalationLevelFrom(ME, "", 5)).toBeNull();
    expect(escalationLevelFrom(INSURANCE, "Done", 1)).toBeNull();
  });

  it("agrees with the tab's membership test on every escalated state", () => {
    // mondayApi's `escalated` flag and this level must never disagree: an
    // escalated patient with a null level would render an empty badge, and a
    // level on a non-escalated patient would colour a row nobody escalated.
    const membershipMatches = (boardId: number, text: string, index: number | null) =>
      text === "Escalation Required" ||
      text === "Escalate" ||
      text === "Manager Escalation Required" ||
      text === "Final Escalation Required" ||
      ((boardId === ME || boardId === INSURANCE) && (index === 0 || index === 2));

    const cases: [number, string, number | null][] = [
      [ME, "Manager Escalation Required", 0],
      [ME, "Final Escalation Required", 2],
      [ME, "Done", 1],
      [ME, "", 0],
      [ME, "", 2],
      [ME, "", 5],
      [ME, "", null],
      [INSURANCE, "Manager Escalation Required", 0],
      [INSURANCE, "Final Escalation Required", 2],
      [INSURANCE, "Done", 1],
      [WELCOME_CALL, "Escalation Required", 0],
      [WELCOME_CALL, "Done", 1],
      [WELCOME_CALL, "", 0],
    ];
    for (const [boardId, text, index] of cases) {
      expect(escalationLevelFrom(boardId, text, index) !== null).toBe(
        membershipMatches(boardId, text, index),
      );
    }
  });

  it("labels every level", () => {
    expect(LEVEL_LABEL.manager).toBe("Manager Intervention");
    expect(LEVEL_LABEL.final).toBe("Final Decisions");
    expect(LEVEL_LABEL.flat).toBe("Escalated");
  });
});

describe("escalationTimeline", () => {
  it("picks up all five stamped decision types, newest first", () => {
    let notes = "some ordinary call note";
    notes = appendStampedLine(notes, stampProposedStuck("office refuses", "2026-08-01", "JH"));
    notes = appendStampedLine(notes, stampReturnedToQueue("try once more", "2026-08-02", "KB"));
    notes = appendStampedLine(notes, stampEscalatedToFinal("needs a call", "2026-08-03", "JH"));
    notes = appendStampedLine(notes, stampReturnedToManager("re-ran DVS", "2026-08-04", "KB"));
    notes = appendStampedLine(notes, stampApprovedStuck("letting go", "2026-08-05", "KB"));

    const t = escalationTimeline(notes);
    expect(t.map((e) => e.label)).toEqual([
      "Approved Stuck",
      "Returned to manager",
      "Escalated to Final",
      "Returned to queue",
      "Proposed Stuck",
    ]);
    expect(t[0]).toMatchObject({ kind: "approve", date: "2026-08-05", initials: "KB", body: "letting go" });
    expect(t[4]).toMatchObject({ kind: "propose", date: "2026-08-01", initials: "JH", body: "office refuses" });
  });

  it("does not confuse 'Returned to queue' with 'Returned to manager'", () => {
    const notes = appendStampedLine(
      stampReturnedToQueue("a", "2026-08-01"),
      stampReturnedToManager("b", "2026-08-02"),
    );
    expect(escalationTimeline(notes).map((e) => e.label)).toEqual([
      "Returned to manager",
      "Returned to queue",
    ]);
  });

  it("handles a stamp with no initials", () => {
    const t = escalationTimeline(stampProposedStuck("no signature", "2026-08-01"));
    expect(t[0]).toMatchObject({ date: "2026-08-01", initials: "", body: "no signature" });
  });

  it("keeps a body containing brackets intact", () => {
    // The split is at the FIRST "]" by contract, so the reason can say anything.
    const t = escalationTimeline(stampProposedStuck("pt said [see chart] no", "2026-08-01", "JH"));
    expect(t[0].body).toBe("pt said [see chart] no");
  });

  it("ignores ordinary notes and returns [] for a blank body", () => {
    expect(escalationTimeline("just a normal note\nand another")).toEqual([]);
    expect(escalationTimeline("")).toEqual([]);
    expect(escalationTimeline(undefined)).toEqual([]);
  });
});

describe("proposedStuckReason", () => {
  it("returns the LATEST reason when a patient was returned and re-proposed", () => {
    let notes = stampProposedStuck("first time", "2026-07-01", "JH");
    notes = appendStampedLine(notes, stampReturnedToQueue("try again", "2026-07-10", "KB"));
    notes = appendStampedLine(notes, stampProposedStuck("second time", "2026-08-01", "JH"));
    expect(proposedStuckReason(notes)).toBe("second time");
  });

  it("is empty for an auto-escalation", () => {
    expect(proposedStuckReason("Chase Clinicals Attempt 3: no answer")).toBe("");
  });
});

describe("buildEscalationDetail", () => {
  it("treats an auto-escalation with an attempt log as EXPLAINED, not empty", () => {
    // The old modal called this "no escalation form data found". It is in fact
    // the normal shape for ~2/3 of escalations, and the attempt log IS the
    // explanation — reporting it as missing data is what made the tab useless.
    const notes = [
      "[Aug 1, 2026, 9:00 AM]",
      "Chase Clinicals Attempt 1: no answer",
      "",
      "[Aug 5, 2026, 9:00 AM]",
      "Chase Clinicals Attempt 2: left voicemail",
    ].join("\n");
    const d = buildEscalationDetail("manager", notes);
    expect(d.reason).toBe("");
    expect(d.attempts).toHaveLength(2);
    expect(d.empty).toBe(false);
  });

  it("surfaces the proposed reason and the decisions together", () => {
    let notes = "Chase Clinicals Attempt 1: no answer";
    notes = appendStampedLine(notes, stampProposedStuck("office refuses to send", "2026-08-01", "JH"));
    const d = buildEscalationDetail("final", notes);
    expect(d.reason).toBe("office refuses to send");
    expect(d.timeline).toHaveLength(1);
    expect(d.attempts).toHaveLength(1);
    expect(d.empty).toBe(false);
  });

  it("does not repeat a stamped or attempt line as an ordinary note", () => {
    // The stamp head is itself a bracketed run containing a year, so the entry
    // parser lifts it into `header` — this is the case that regressed once.
    // Ordinary notes carry their own ET-timestamp header (lib/shared/noteStamp).
    let notes = "[Aug 1, 2026, 9:00 AM]\nChase Clinicals Attempt 1: no answer";
    notes = appendStampedLine(notes, stampProposedStuck("office refuses", "2026-08-01", "JH"));
    notes = appendStampedLine(notes, "[Aug 2, 2026, 10:00 AM]\nChase Clinicals: spoke to the clinic manager —JH");
    const d = buildEscalationDetail("final", notes);
    expect(d.recentNotes.map((n) => n.body)).toEqual([
      "Chase Clinicals: spoke to the clinic manager —JH",
    ]);
    // …and the pieces it was split out of are still reported by their own readers.
    expect(d.reason).toBe("office refuses");
    expect(d.attempts).toHaveLength(1);
  });

  it("is empty only when the notes column really has nothing", () => {
    expect(buildEscalationDetail("manager", "").empty).toBe(true);
    expect(buildEscalationDetail("manager", undefined).empty).toBe(true);
  });
});

describe("parseAttemptNotes", () => {
  it("reads both current and legacy attempt prefixes", () => {
    const notes = [
      "[Aug 1, 2026, 9:00 AM]",
      "C.R. Attempt 1: called, no answer",
      "",
      "[Aug 5, 2026, 9:00 AM]",
      "Chase Clinicals Attempt 2: faxed again",
    ].join("\n");
    const a = parseAttemptNotes(notes);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ label: "C.R. Attempt 1", body: "called, no answer" });
    expect(a[1]).toMatchObject({ label: "Chase Clinicals Attempt 2", body: "faxed again" });
  });
});
