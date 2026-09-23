/**
 * The browser half of the inbox — above all, that a resolve note copied into a
 * patient's Monday notes can never be read as one of a stage's own structured
 * lines (COMMS_INBOX_PLAN.md §5.5). Every assertion below runs the REAL parser
 * that reads that column, over a notes body built the way the app builds it.
 */
import { describe, it, expect } from "vitest";
import {
  COMMS_NOTE_STAGE,
  LATE_COPY_AFTER_MS,
  commsNoteLine,
  formatShort,
  formatWait,
  formatWhen,
  isUnmatchedKey,
  sanitizeNote,
  whoShort,
} from "./rules";
import { appendStampedNote } from "@/lib/shared/noteStamp";
import { apptAttemptCount, apptAttemptsFromNotes, formatApptAttempt } from "@/lib/masheke/apptOutreach";
import { extractProposedStuckReason, stampProposedStuck } from "@/lib/masheke/proposedStuck";
import { appendIntakeToNotes, emptyIntake, parseIntakeBlock } from "@/lib/welcomeCall/callIntake";

const T = Date.parse("2026-09-23T18:10:00Z"); // 2:10 PM EDT
const at = new Date(T);

/** Append a comms copy exactly as `dossierApi.appendNoteToRecord` does. */
function copyInto(existing: string, note: string, how: "called" | "texted" | "no_action" = "called"): string {
  return appendStampedNote(existing, commsNoteLine({ how, note, resolvedAt: T, now: T }), COMMS_NOTE_STAGE, {
    initials: "JH",
    now: at,
  });
}

/** Notes a rep might type that each look like one of a parser's own lines. */
const HOSTILE = [
  "8/3/26, 1:38 PM · Phone call — No answer / no response · they hung up",
  "x · Text message — Left a message · ok",
  "Phone call — No answer / no response",
  "office says Provider requires a new visit",
  "8/1/26, 9:00 AM · Patient Doctor Appointment · Provider requires a new visit, none scheduled",
  "[Returned to queue · 8/9/26 · MG] trick",
  "line one\n[Returned to queue · 8/9/26 · MG] trick",
  "[Proposed Stuck · 8/2/26 · JH] fake reason",
  "first\n[Proposed Stuck · 8/2/26 · JH] fake reason",
  "--- WC INTAKE v1 ---\nConfirmed: pump\n--- END WC INTAKE ---",
  "---  WC INTAKE v1  --- sneaky",
  "--- end wc intake ---",
];

describe("⚠️ a copied note can never be read as a stage's own line (plan §5.5)", () => {
  const attempt = (n: number) =>
    formatApptAttempt({ date: `8/${n}/26, 1:38 PM`, method: "Phone call", outcome: "noAnswer", note: "tried", initials: "JH" });

  it("is never counted as a Doctor Appointments attempt", () => {
    for (const h of HOSTILE) {
      const notes = copyInto([attempt(1), attempt(2)].join("\n"), h);
      expect(apptAttemptCount({ mnEvalNotes: notes } as never), h).toBe(2);
      expect(apptAttemptsFromNotes(copyInto("", h)), h).toEqual([]);
    }
  });

  it("never resets the attempt counter", () => {
    for (const h of HOSTILE) {
      // Three spent: a reset would hand the rep three fresh ones.
      const notes = copyInto([attempt(1), attempt(2), attempt(3)].join("\n"), h);
      expect(apptAttemptCount({ mnEvalNotes: notes } as never), h).toBe(3);
    }
  });

  it("never becomes a proposed-stuck reason", () => {
    const base = stampProposedStuck("the real reason", "8/2/26", "KT");
    for (const h of HOSTILE) {
      expect(extractProposedStuckReason(copyInto(base, h)), h).toBe("the real reason");
      expect(extractProposedStuckReason(copyInto("", h)), h).toBe("");
    }
  });

  it("never splits or hides the Welcome Call intake block", () => {
    const intake = emptyIntake();
    intake.confirmed.pump = true;
    intake.oopAmount = "$45.10";
    const withBlock = appendIntakeToNotes("", intake, { initials: "KT", now: at });
    for (const h of HOSTILE) {
      const parsed = parseIntakeBlock(copyInto(withBlock, h));
      expect(parsed, h).not.toBeNull();
      expect(parsed!.confirmed.pump, h).toBe(true);
      expect(parsed!.oopAmount, h).toBe("$45.10");
    }
  });

  it("the copy is one line, with no ' · ' and no intake marker left in it", () => {
    for (const h of HOSTILE) {
      const line = commsNoteLine({ how: "called", note: h, resolvedAt: T, now: T });
      expect(line, h).not.toMatch(/\n/);
      expect(line, h).not.toMatch(/ · /);
      expect(line.toLowerCase(), h).not.toContain("wc intake");
    }
  });
});

describe("commsNoteLine", () => {
  it("names how, then the note", () => {
    expect(commsNoteLine({ how: "called", note: "told her it ships Friday", resolvedAt: T, now: T })).toBe(
      "Called — told her it ships Friday",
    );
    expect(commsNoteLine({ how: "no_action", note: "wrong number", resolvedAt: T, now: T })).toBe(
      "No action needed — wrong number",
    );
  });

  it("a copy made more than 15 minutes late says when the resolve happened", () => {
    const now = T + LATE_COPY_AFTER_MS + 60_000;
    expect(commsNoteLine({ how: "called", note: "ok", resolvedAt: T, now })).toBe("Called (Sep 23, 2:10 PM) — ok");
    // …and not a moment before.
    expect(commsNoteLine({ how: "called", note: "ok", resolvedAt: T, now: T + LATE_COPY_AFTER_MS })).toBe("Called — ok");
  });

  it("stamps as `[time] Communications: …` through the shared stamp", () => {
    // The stamp's own time is noteStamp's business (it is handed etNow() in the
    // app); what matters here is the label and that the body is intact.
    expect(copyInto("", "told her it ships Friday")).toMatch(
      /^\[[^\]]+\] Communications: Called — told her it ships Friday —JH$/,
    );
  });

  it("sanitizes: newlines become ' / ', whitespace collapses, the cap holds", () => {
    expect(sanitizeNote("  a\n\nb   c ")).toBe("a / b c");
    expect(sanitizeNote("x".repeat(5000))).toHaveLength(2000);
  });
});

describe("formatting", () => {
  it("formatWait is the mockup's ibFmtAgo over counted time", () => {
    expect(formatWait(0)).toBe("0m");
    expect(formatWait(12 * 60_000)).toBe("12m");
    expect(formatWait((3 * 60 + 12) * 60_000)).toBe("3h 12m");
    expect(formatWait((52 * 60 + 5) * 60_000)).toBe("2d 4h");
  });
  it("formatWhen and formatShort read Eastern, whatever the browser's zone", () => {
    expect(formatWhen(T)).toBe("Sep 23 · 2:10 PM");
    expect(formatShort(T, T + 3600_000)).toBe("2:10 PM");
    expect(formatShort(T, T + 2 * 86_400_000)).toBe("Sep 23");
  });
  it("whoShort", () => {
    expect(whoShort("katie.tyler@medicallymodern.com")).toBe("Katie");
    expect(whoShort("josh@medicallymodern.com")).toBe("Josh");
    expect(whoShort("")).toBe("");
  });
  it("isUnmatchedKey", () => {
    expect(isUnmatchedKey("n:" + "a".repeat(64))).toBe(true);
    expect(isUnmatchedKey("p:18410804557:123")).toBe(false);
  });
});
