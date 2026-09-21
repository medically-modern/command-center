import { describe, expect, it } from "vitest";
import { noteEntries, noteStageLabel } from "./recentNotes";
import { appendStampedNote } from "@/lib/shared/noteStamp";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("reading a notes column", () => {
  it("is NEWEST FIRST — the log appends, so the last line is the latest", () => {
    // A strip showing the first three would show the OLDEST three: indefinitely
    // stale on any patient with history, while looking perfectly live.
    let log = "";
    log = appendStampedNote(log, "first", "Evaluate MN", { initials: "AA", now: new Date(2026, 0, 1, 9, 0) });
    log = appendStampedNote(log, "second", "Evaluate MN", { initials: "BB", now: new Date(2026, 0, 2, 9, 0) });
    log = appendStampedNote(log, "third", "Send Request", { initials: "CC", now: new Date(2026, 0, 3, 9, 0) });
    expect(noteEntries(log).map((e) => e.text)).toEqual(["third", "second", "first"]);
  });

  it("pulls the time, the stage and the initials off a stamped line", () => {
    const log = appendStampedNote("", "Called office, clinicals promised by Friday.", "Chase Clinicals", {
      initials: "JH",
      now: new Date(2026, 8, 15, 14, 30),
    });
    expect(noteEntries(log)[0]).toEqual({
      when: "Sep 15, 2026, 2:30 PM",
      stage: "Chase Clinicals",
      who: "JH",
      text: "Called office, clinicals promised by Friday.",
      parsed: true,
    });
  });

  it("keeps a colon in the BODY out of the stage label", () => {
    const log = "[Sep 15, 2026, 2:30 PM] Benefits: Payer said: call back after 3pm —JH";
    const e = noteEntries(log)[0];
    expect(e.stage).toBe("Benefits");
    expect(e.text).toBe("Payer said: call back after 3pm");
  });

  it("handles a stamped line with no stage and no initials", () => {
    const e = noteEntries("[Sep 15, 2026, 2:30 PM] Left a voicemail")[0];
    expect(e).toMatchObject({ when: "Sep 15, 2026, 2:30 PM", stage: "", who: "", text: "Left a voicemail", parsed: true });
  });

  it("keeps a multi-line note whole", () => {
    const log = "[Sep 15, 2026, 2:30 PM] Benefits: line one\nline two —JH";
    const e = noteEntries(log)[0];
    expect(e.text).toBe("line one\nline two");
    expect(e.who).toBe("JH");
  });
});

describe("⚠️ an unrecognised block is rendered VERBATIM, never dropped", () => {
  it("keeps a bulk-import stamp", () => {
    // Real: ~1,697 Partial Leads carry this and nothing else (§5.30).
    const raw = '=== Imported from "DME Patient Validation & Outreach" board · 8/25/26 ===';
    const [e] = noteEntries(raw);
    expect(e.parsed).toBe(false);
    expect(e.text).toBe(raw);
  });

  it("keeps a Doctor Appointments attempt line", () => {
    // ⚠️ THAT LINE IS THE COUNTER (§5.12) — its shape is a contract elsewhere,
    // so this parser must never rewrite it, only fail to decorate it.
    const raw = "8/3/26, 1:38 PM · Phone call — No answer / no response · she will call back —JH";
    const [e] = noteEntries(raw);
    expect(e.parsed).toBe(false);
    expect(e.text).toBe(raw);
  });

  it("keeps free text written before noteStamp existed", () => {
    const [e] = noteEntries("spoke to the office, nothing new");
    expect(e).toMatchObject({ parsed: false, text: "spoke to the office, nothing new" });
  });

  it("mixes parsed and unparsed in one column without losing either", () => {
    const log = "old free text\n\n[Sep 15, 2026, 2:30 PM] Benefits: new line —JH";
    const es = noteEntries(log);
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ parsed: true, text: "new line" });
    expect(es[1]).toMatchObject({ parsed: false, text: "old free text" });
  });
});

describe("splitting blocks", () => {
  it("splits a single-newline run of stamped lines", () => {
    // Several older writers appended with one newline; treating that run as ONE
    // note puts a month of history in a single entry.
    const log = "[Jan 1, 2026, 9:00 AM] A: one —AA\n[Jan 2, 2026, 9:00 AM] B: two —BB";
    expect(noteEntries(log).map((e) => e.text)).toEqual(["two", "one"]);
  });

  it("does NOT split a note whose own body starts a line with a bracket", () => {
    const log = "[Jan 1, 2026, 9:00 AM] A: header\n[see attached] detail —AA";
    const es = noteEntries(log);
    expect(es).toHaveLength(1);
    expect(es[0].text).toContain("[see attached]");
  });

  it("an empty or blank column has no entries", () => {
    expect(noteEntries("")).toEqual([]);
    expect(noteEntries(undefined)).toEqual([]);
    expect(noteEntries("   \n\n  ")).toEqual([]);
  });
});

describe("what a new note is stamped with", () => {
  it("is the SUB-STAGE where the board has one", () => {
    // Several roles share one notes column, so the label is what makes a line
    // traceable afterwards (§9).
    expect(noteStageLabel({ stageAdvancerText: "Chase Clinicals", boardName: "Medical Evaluation" })).toBe("Chase Clinicals");
  });
  it("falls back to the board when there is no advancer", () => {
    expect(noteStageLabel({ stageAdvancerText: "", boardName: "Subscription" })).toBe("Subscription");
  });
});

describe("⚠️ the composer stays in view", () => {
  it("only the LIST scrolls — the header and the add box are pinned", () => {
    // The first cut scrolled the whole strip, which put the add-a-note box
    // below the fold on any patient with three notes: an input a rep has to
    // scroll a 190px panel to find is one most of them never find. Found by
    // rendering it (§5.30d), and silent if it regresses.
    const css = src("src/pages/patient/redesign.css");
    expect(css).toMatch(/\.cc-pt \.nm-list \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.cc-pt \.nm-h \{ flex: none;/);
    expect(css).toMatch(/\.cc-pt \.nm-add \{ flex: none;/);
    // ⚠️ …and the strip itself must NOT scroll, or the pin means nothing.
    const strip = /\.cc-pt \.notes-mini \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(strip).not.toMatch(/overflow-y: auto/);
    // ⚠️ `flex: none` on the strip: `.pt-side` is a column whose tab body takes
    // `flex: 1`, so without it a long log steals the thread's height.
    expect(strip).toMatch(/flex: none/);

    const tsx = src("src/components/patient/RecentNotes.tsx");
    expect(tsx).toMatch(/className="nm-list"/);
  });

  it("renders under BOTH tabs, outside the tab body", () => {
    // A fact about the patient, not about texts or calls — so a rep switching
    // tabs does not lose a half-typed note, and the two copies cannot drift.
    const col = src("src/components/patient/PatientCommsColumn.tsx");
    expect(col).toMatch(/<RecentNotes[\s\S]{0,200}\/>\s*<\/aside>/);
    expect(col.match(/<RecentNotes/g) ?? []).toHaveLength(1);
  });
});
