/**
 * The follow-up push an attempt makes, and the one thing it must never do.
 *
 * Patient Intake lost its snooze on 2026-08-13 because writing the Follow Up
 * STATUS removed the patient from every list on the board for good (§5.10).
 * Brandon's 2026-09-14 ask brings a follow-up DATE back, read by the Care
 * Coordinator dashboard alone. The status stays untouched, and this file
 * scans the intake writer to keep it that way — the failure is silent on
 * screen (a green toast, a patient gone), so the scan is the only catch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BACK_AT_LABEL, NOON_ET_MINUTES, attemptSlot, defaultFollowUpDate, defaultFollowUpDateFor, isValidFollowUpDate,
  newestCallAttemptStamp, restsUntilNoon,
} from "./followUp";

describe("defaultFollowUpDate — the next calendar day, exactly as Welcome Call's +1", () => {
  it("adds one day, no weekend clamp, no DST drift", () => {
    expect(defaultFollowUpDate("2026-09-14")).toBe("2026-09-15");
    expect(defaultFollowUpDate("2026-09-18")).toBe("2026-09-19"); // Friday → Saturday, as the WC button does
    expect(defaultFollowUpDate("2026-03-07")).toBe("2026-03-08"); // spring-forward
    expect(defaultFollowUpDate("2026-12-31")).toBe("2027-01-01");
    expect(defaultFollowUpDate("garbage")).toBe("");
  });

  it("isValidFollowUpDate accepts today or later, YYYY-MM-DD only", () => {
    expect(isValidFollowUpDate("2026-09-15", "2026-09-14")).toBe(true);
    expect(isValidFollowUpDate("2026-09-14", "2026-09-14")).toBe(true);
    expect(isValidFollowUpDate("2026-09-13", "2026-09-14")).toBe(false);
    expect(isValidFollowUpDate("9/15/2026", "2026-09-14")).toBe(false);
    expect(isValidFollowUpDate("", "2026-09-14")).toBe(false);
  });
});

describe("the intake attempt writer touches the DATE and never the STATUS", () => {
  const src = readFileSync(resolve(__dirname, "../profile/unverifiedWrite.ts"), "utf8");

  it("logContactAttempt writes Follow Up Date", () => {
    const fn = src.slice(src.indexOf("export async function logContactAttempt"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
    expect(body).toMatch(/writeDate\(itemId, COL\.followUpDate/);
    expect(body).not.toMatch(/COL\.followUp\b(?!Date)/);
  });

  it("nothing in the file WRITES the Follow Up status — the only reference clears a stale one", () => {
    // `COL.followUp` not followed by `Date`. The one permitted use is the heal
    // in returnIntakeToPipeline, which CLEARS it.
    const refs = [...src.matchAll(/COL\.followUp\b(?!Date)/g)].map((m) => {
      const lineStart = src.lastIndexOf("\n", m.index!) + 1;
      const lineEnd = src.indexOf("\n", m.index!);
      return src.slice(lineStart, lineEnd).trim();
    });
    expect(refs.length).toBeGreaterThan(0);
    for (const line of refs) {
      expect(line).toMatch(/clearStatusColumn\(itemId, COL\.followUp\)/);
    }
  });

  it("both attempt loggers take their date from this helper", () => {
    const wc = readFileSync(resolve(__dirname, "../../components/welcomeCall/CallAttemptsCounter.tsx"), "utf8");
    const page = readFileSync(resolve(__dirname, "../../pages/UnverifiedReferralsPage.tsx"), "utf8");
    expect(wc).toMatch(/defaultFollowUpDate\(etToday\(\)\)/);
    expect(page).toMatch(/defaultFollowUpDate\(etToday\(\)\)/);
    expect(page).toMatch(/logContactAttempt\(selected\.id, selected\.attemptCounter, followUpDate\)/);
  });
});

describe("morning / afternoon attempts (Josh, 2026-09-29 — option b, the note's timestamp)", () => {
  const AM = 9 * 60 + 5;
  const PM = 13 * 60 + 40;

  it("noon ET splits the day", () => {
    expect(attemptSlot(0)).toBe("morning");
    expect(attemptSlot(NOON_ET_MINUTES - 1)).toBe("morning");
    expect(attemptSlot(NOON_ET_MINUTES)).toBe("afternoon");
    expect(attemptSlot(23 * 60)).toBe("afternoon");
  });

  it("the dialog's default: today in the morning, tomorrow in the afternoon", () => {
    expect(defaultFollowUpDateFor("2026-09-29", AM)).toBe("2026-09-29");
    expect(defaultFollowUpDateFor("2026-09-29", PM)).toBe("2026-09-30");
    expect(defaultFollowUpDateFor("garbage", AM)).toBe("");
  });

  it("reads the newest stamped Call attempt line — the app's own stamp, either column", () => {
    const intake = "[Sep 3, 2026, 11:07 AM] Patient Intake: Call attempt 1 — left a vm —MT\n[Sep 29, 2026, 9:05 AM] Patient Intake: Call attempt 2 — no answer —MT";
    expect(newestCallAttemptStamp(intake)).toEqual({ date: "2026-09-29", minutes: 545, attempt: 2 });
    const welcome = "[Sep 29, 2026, 12:00 PM] Welcome Call: Call attempt 1 — busy";
    expect(newestCallAttemptStamp(welcome)).toEqual({ date: "2026-09-29", minutes: 720, attempt: 1 });
    expect(newestCallAttemptStamp("[Sep 29, 2026, 12:30 AM] Welcome Call: Call attempt 1 — x")?.minutes).toBe(30);
  });

  it("ignores every other stamp — the duplicate check's numeric one, a plain note, blank", () => {
    expect(newestCallAttemptStamp("[9/28/2026, 2:26 PM] Duplicate Check: Duplicate\nRecommended: close it.")).toBeNull();
    expect(newestCallAttemptStamp("[Sep 29, 2026, 9:05 AM] Profile Send-Off: called the doctor —BE")).toBeNull();
    expect(newestCallAttemptStamp("")).toBeNull();
    expect(newestCallAttemptStamp(undefined)).toBeNull();
  });

  it("newest wins whatever the order the lines are in", () => {
    const notes = "[Sep 29, 2026, 11:50 AM] Patient Intake: Call attempt 3 — x\n[Sep 28, 2026, 3:00 PM] Patient Intake: Call attempt 2 — y";
    expect(newestCallAttemptStamp(notes)?.attempt).toBe(3);
  });

  it("rests only while it is morning AND the newest attempt was this morning", () => {
    const thisMorning = "[Sep 29, 2026, 9:05 AM] Patient Intake: Call attempt 1 — no answer —MT";
    expect(restsUntilNoon(thisMorning, "2026-09-29", AM)).toBe(true);
    expect(restsUntilNoon(thisMorning, "2026-09-29", 11 * 60 + 59)).toBe(true);
    // Noon: back on the list.
    expect(restsUntilNoon(thisMorning, "2026-09-29", NOON_ET_MINUTES)).toBe(false);
    expect(restsUntilNoon(thisMorning, "2026-09-29", PM)).toBe(false);
    // Yesterday's morning attempt, or an afternoon one, rests nobody.
    expect(restsUntilNoon(thisMorning, "2026-09-30", AM)).toBe(false);
    expect(restsUntilNoon("[Sep 29, 2026, 2:15 PM] Patient Intake: Call attempt 1 — x", "2026-09-29", AM)).toBe(false);
    // ⚠️ Notes not read yet ⇒ the card stays visible.
    expect(restsUntilNoon(undefined, "2026-09-29", AM)).toBe(false);
    expect(restsUntilNoon("", "2026-09-29", AM)).toBe(false);
    expect(BACK_AT_LABEL).toBe("Back at 12 PM");
  });
});

describe("wiring — the dashboard, and only the dashboard, rests morning attempts", () => {
  const page = readFileSync(resolve(__dirname, "../../pages/CareCoordinatorPage.tsx"), "utf8");
  const dialog = readFileSync(resolve(__dirname, "../../components/careCoordinator/CallPatientDialog.tsx"), "utf8");
  const wcCounter = readFileSync(resolve(__dirname, "../../components/welcomeCall/CallAttemptsCounter.tsx"), "utf8");

  it("both columns render the RESTED buckets and the header counts follow them", () => {
    expect(page).toContain("restMorningAttempts(intakeB, (id) => intakeNotes.get(id), ctx)");
    expect(page).toContain("restMorningAttempts(welcomeB, (id) => welcomeNotes.get(id), ctx)");
    expect(page).toContain("summarize(intakeShown, welcomeShown)");
    expect(page).toContain("intakeShown.unscheduledToday : intakeShown.unscheduledFuture");
    expect(page).toContain("welcomeShown.unscheduledToday : welcomeShown.unscheduledFuture");
  });

  it("the dashboard's attempt form defaults by the clock; the Welcome Call page's own +1 is untouched (tomorrow)", () => {
    expect(dialog).toContain("defaultFollowUpDateFor(etToday(), nowMinutesEt())");
    expect(dialog).not.toMatch(/defaultFollowUpDate\(etToday\(\)\)/);
    expect(wcCounter).toContain("defaultFollowUpDate(etToday())");
    expect(wcCounter).not.toContain("defaultFollowUpDateFor");
  });
});
