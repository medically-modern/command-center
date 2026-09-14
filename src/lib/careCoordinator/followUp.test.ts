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

import { defaultFollowUpDate, isValidFollowUpDate } from "./followUp";

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
