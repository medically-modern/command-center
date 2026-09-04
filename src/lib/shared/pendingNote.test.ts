import { describe, it, expect, beforeEach } from "vitest";
import { reportPendingNote, clearPendingNote, hasPendingNote, pendingNoteText, resetPendingNotesForTests } from "./pendingNote";

describe("pendingNote store", () => {
  beforeEach(() => resetPendingNotesForTests());

  it("is empty until a box reports text", () => {
    expect(hasPendingNote()).toBe(false);
    reportPendingNote("18410804557:text_mm6vqq2k", "called the patient, left a voicemail");
    expect(hasPendingNote()).toBe(true);
    expect(pendingNoteText()).toContain("voicemail");
  });

  it("treats whitespace as empty — a stray newline must not block a send", () => {
    reportPendingNote("k", "  \n ");
    expect(hasPendingNote()).toBe(false);
  });

  it("clears when the box is emptied or unmounts", () => {
    reportPendingNote("k", "draft");
    reportPendingNote("k", "");
    expect(hasPendingNote()).toBe(false);
    reportPendingNote("k", "draft again");
    clearPendingNote("k");
    expect(hasPendingNote()).toBe(false);
  });

  it("keeps boxes independent", () => {
    reportPendingNote("a", "one");
    reportPendingNote("b", "two");
    clearPendingNote("a");
    expect(pendingNoteText()).toBe("two");
  });
});
