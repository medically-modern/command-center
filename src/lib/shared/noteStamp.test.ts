/**
 * The stamped-note contract. This shape is shared by every role's note log
 * (Insurance ×4, Welcome Call, Final Confirm, Subscription, Evaluate/Send
 * Request, Profile Send-Off) and is parsed back out by the note renderers
 * that bold the "<Stage>:" label — so the format is an interface, not a
 * cosmetic choice.
 */
import { describe, it, expect } from "vitest";
import { appendNoteEntry, appendStampedNote, noteTimestamp, stampNoteEntry } from "./noteStamp";

const AT = new Date(2026, 6, 28, 14, 33); // Jul 28, 2026, 2:33 PM

describe("noteTimestamp", () => {
  it("formats as '[Mon D, YYYY, H:MM AM]' content", () => {
    expect(noteTimestamp(AT)).toBe("Jul 28, 2026, 2:33 PM");
  });
});

describe("stampNoteEntry", () => {
  it("stamps timestamp + stage + initials", () => {
    expect(stampNoteEntry("payer confirmed active", "Benefits", { initials: "JH", now: AT }))
      .toBe("[Jul 28, 2026, 2:33 PM] Benefits: payer confirmed active —JH");
  });

  it("omits the stage label when none is given", () => {
    expect(stampNoteEntry("no stage here", undefined, { initials: "JH", now: AT }))
      .toBe("[Jul 28, 2026, 2:33 PM] no stage here —JH");
  });

  it("omits the initials suffix when signed out (never a bare em dash)", () => {
    expect(stampNoteEntry("anon note", "DVS", { initials: "", now: AT }))
      .toBe("[Jul 28, 2026, 2:33 PM] DVS: anon note");
  });

  it("trims the note body", () => {
    expect(stampNoteEntry("   padded   ", "Submit Auth", { initials: "AB", now: AT }))
      .toBe("[Jul 28, 2026, 2:33 PM] Submit Auth: padded —AB");
  });
});

describe("appendNoteEntry", () => {
  it("blank-line separates from prior history", () => {
    expect(appendNoteEntry("older", "newer")).toBe("older\n\nnewer");
  });

  it("returns the entry alone when there's no history", () => {
    expect(appendNoteEntry(undefined, "first")).toBe("first");
    expect(appendNoteEntry("", "first")).toBe("first");
    expect(appendNoteEntry("   ", "first")).toBe("first");
  });

  it("never drops existing history", () => {
    const log = appendNoteEntry(appendNoteEntry("a", "b"), "c");
    expect(log).toBe("a\n\nb\n\nc");
  });
});

describe("appendStampedNote", () => {
  it("keeps each stage's provenance in a shared column", () => {
    const first = appendStampedNote("", "called payer", "Benefits", { initials: "JH", now: AT });
    const second = appendStampedNote(first, "auth submitted", "Submit Auth", { initials: "AB", now: AT });
    expect(second).toBe(
      "[Jul 28, 2026, 2:33 PM] Benefits: called payer —JH\n\n" +
        "[Jul 28, 2026, 2:33 PM] Submit Auth: auth submitted —AB",
    );
  });
});
