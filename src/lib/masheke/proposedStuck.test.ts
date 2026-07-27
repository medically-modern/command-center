/**
 * The stamped-note contract. These tag strings are the interface between the
 * writers (ProposeStuckModal / ProposeStuckButton / the oversight decision
 * writers) and the reader (the Oversight drill-down's "Proposed Reason"
 * column), so a change to either side has to keep this round-trip intact.
 */
import { describe, it, expect } from "vitest";
import {
  stampProposedStuck,
  stampReturnedToQueue,
  stampApprovedStuck,
  appendStampedLine,
  extractProposedStuckReason,
} from "./proposedStuck";

describe("stampProposedStuck / extractProposedStuckReason", () => {
  it("round-trips a reason", () => {
    const line = stampProposedStuck("doctor unreachable", "2026-07-27");
    expect(extractProposedStuckReason(line)).toBe("doctor unreachable");
  });

  it("returns empty when nothing is stamped", () => {
    expect(extractProposedStuckReason(undefined)).toBe("");
    expect(extractProposedStuckReason("just some ordinary call notes")).toBe("");
  });

  it("takes the LAST proposal when a patient was returned then re-proposed", () => {
    const notes = appendStampedLine(
      appendStampedLine(
        stampProposedStuck("first try", "2026-07-01"),
        stampReturnedToQueue("new clinicals arrived", "2026-07-10"),
      ),
      stampProposedStuck("second try", "2026-07-27"),
    );
    expect(extractProposedStuckReason(notes)).toBe("second try");
  });
});

describe("stampApprovedStuck", () => {
  it("stamps a manager's approval note with the same shape as the other tags", () => {
    const line = stampApprovedStuck("  no path forward with the payer  ", "2026-07-27");
    expect(line).toBe("[Approved Stuck · 2026-07-27] no path forward with the payer");
  });

  it("appends without disturbing the rep's stamped reason", () => {
    const notes = appendStampedLine(
      stampProposedStuck("doctor unreachable", "2026-07-20"),
      stampApprovedStuck("agreed, closing out", "2026-07-27"),
    );
    // The proposal must still be extractable after the approval is appended —
    // the Oversight "Proposed Reason" column reads it back from this same body.
    expect(extractProposedStuckReason(notes)).toBe("doctor unreachable");
    expect(notes).toContain("[Approved Stuck · 2026-07-27]");
  });
});

describe("appendStampedLine", () => {
  it("keeps existing notes and blank-line separates", () => {
    expect(appendStampedLine("existing", "new")).toBe("existing\n\nnew");
  });

  it("does not lead with blank lines when there are no existing notes", () => {
    expect(appendStampedLine(undefined, "new")).toBe("new");
    expect(appendStampedLine("", "new")).toBe("new");
  });
});
