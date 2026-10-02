/**
 * The Oversight drill-down's Escalation / Proposed Reason column, read against
 * what each board's WRITER actually puts in the notes.
 *
 * ⚠️ Every input here is built by calling the real writer, never typed by hand.
 * The reader used to be tested only against `[Proposed Stuck · …]` lines, while
 * intake writes `[<time>] Patient Intake: Proposed stuck: <reason> —MT`
 * (`appendIntakeNote` stamps `proposeStuckNoteLine`). Both sides passed their
 * own tests and every intake escalation reason read blank on Pipeline
 * Oversight (found 2026-10-02, live board: 200 of 200 sampled carried one).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CHART_DEFS } from "./oversightApi";
import {
  extractEscalationReason,
  intakeDecisionLine,
  stampProposedStuck,
  stampReturnedToQueue,
  appendStampedLine,
} from "@/lib/masheke/proposedStuck";
import { appendStampedNote } from "@/lib/shared/noteStamp";
import { proposeStuckNoteLine } from "@/lib/profile/unverifiedWrite";

const NOW = new Date("2026-08-27T15:45:00Z");
/** What `appendIntakeNote` writes for a decision line. */
const intakeLog = (prior: string, line: string, initials = "MT") =>
  appendStampedNote(prior, line, "Patient Intake", { initials, now: NOW });

/** One writer per board that has a reason column, each producing notes whose
 *  reason is "the real reason". */
const WRITERS: Record<number, { name: string; notes: string }[]> = {
  18406352652: [
    { name: "intake Propose Stuck", notes: intakeLog("call 1 —MT", proposeStuckNoteLine("the real reason", "processor")) },
    { name: "intake Propose Stuck from Manager Intervention", notes: intakeLog("", proposeStuckNoteLine("the real reason", "manager-intervention")) },
    // escalateIntake's line (unverifiedWrite.escalateIntake)
    { name: "intake Escalate", notes: intakeLog("", "Escalated: the real reason") },
  ],
  18406060017: [{ name: "Medical Evaluation stamp", notes: appendStampedLine("older note", stampProposedStuck("the real reason", "2026-09-29", "MS")) }],
  18410601299: [
    { name: "Insurance stamp", notes: stampProposedStuck("the real reason", "2026-09-29", "SA") },
    // samantha/benefitsDerive.composeEscalationReason's head
    { name: "Benefits auto-escalation", notes: "[Auto-escalated · 2026-09-01 · SA] the real reason\n[Sep 1, 2026, 11:07 AM] Benefits call: … —SA" },
  ],
  18410804557: [{ name: "Welcome Call stamp", notes: appendStampedLine("[Aug 20, 2026, 11:21 AM] Welcome Call: x —JB", stampProposedStuck("the real reason", "2026-09-28", "JH")) }],
};

describe("Oversight escalation reason ⇄ each board's writer", () => {
  const boards = [...new Set(CHART_DEFS.filter((c) => c.reasonColId).map((c) => c.boardId))];

  it("has a writer case for every board whose charts show a reason", () => {
    // A new board with a reason column must add its writer above.
    for (const b of boards) expect(WRITERS[b], `board ${b}`).toBeDefined();
  });

  for (const [board, cases] of Object.entries(WRITERS)) {
    for (const c of cases) {
      it(`${board}: ${c.name}`, () => {
        expect(extractEscalationReason(c.notes)).toBe("the real reason");
      });
    }
  }

  it("takes the LAST decision, across formats", () => {
    const notes = intakeLog(intakeLog("", "Escalated: first"), proposeStuckNoteLine("second", "processor"));
    expect(extractEscalationReason(notes)).toBe("second");
    const stamped = appendStampedLine(
      appendStampedLine(stampProposedStuck("first", "2026-07-01"), stampReturnedToQueue("fixed", "2026-07-10")),
      stampProposedStuck("second", "2026-07-27"),
    );
    expect(extractEscalationReason(stamped)).toBe("second");
  });

  it("keeps a colon inside the reason", () => {
    expect(extractEscalationReason(intakeLog("", proposeStuckNoteLine("OBC: wrong phone number", "processor"))))
      .toBe("OBC: wrong phone number");
  });

  it("is blank when no reason was written, and ignores ordinary notes", () => {
    expect(extractEscalationReason(undefined)).toBe("");
    expect(extractEscalationReason(intakeLog("", "Left voicemail, will call back"))).toBe("");
    expect(extractEscalationReason(intakeLog("", "Spoke with pt, Escalated: not a decision"))).toBe("");
    expect(intakeDecisionLine("[Proposed Stuck · 2026-09-29 · MS] r")).toBeNull();
  });

  it("is what the drill-down calls", () => {
    const tab = readFileSync("src/components/oversight/OversightTab.tsx", "utf8");
    expect(tab).toMatch(/__proposedReason__:\s*extractEscalationReason\(/);
    expect(tab).not.toContain("extractProposedStuckReason");
  });
});
