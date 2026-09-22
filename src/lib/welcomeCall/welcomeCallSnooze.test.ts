/**
 * The Welcome Call queue is a PURE DATE BUCKET — §5.8's counting contract for
 * one stage, in one file.
 *
 * Josh, 2026-09-22: *"log attempts should be at bottom - press when attempted,
 * and then move next action date"* and *"when patient arrives, should only show
 * up tomorrow"*. Both asks rest on the same fact, and until that day it was not
 * true: the queue bucketed on the Follow Up STATUS, and nothing on this board
 * ever read the DATE back. So pressing "Log call attempt" wrote both columns,
 * the status removed the patient from the sidebar AND the role bar, and the day
 * the toast promised them back on passed with nothing to wake them — hidden
 * until a human cleared the column by hand. §5.10's Patient-Intake one-way
 * door, one board over.
 *
 * ⚠️ FOUR PLACES APPLY THIS RULE and they must agree or the bar and the list
 * disagree all day (§5.8). Two are TypeScript and import the function; two are
 * plain Node baseline generators that cannot, so they carry the comparison as a
 * literal and this file SCANS them. A drift there is silent — the Operations
 * tab just grows phantom +in/-out chips — so the scan is the only catch.
 *
 * Run: npx vitest run src/lib/welcomeCall/welcomeCallSnooze.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isWelcomeCallSnoozed } from "./sidebarList";
import type { Patient } from "./workflow";

const TODAY = "2026-09-22";
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

const pt = (followUpDate: string) => ({ followUpDate }) as Pick<Patient, "followUpDate">;

describe("isWelcomeCallSnoozed — the rule itself", () => {
  it("a FUTURE date snoozes; today, the past and a blank are all DUE", () => {
    expect(isWelcomeCallSnoozed(pt("2026-09-23"), TODAY)).toBe(true);
    expect(isWelcomeCallSnoozed(pt("2026-12-01"), TODAY)).toBe(true);
    expect(isWelcomeCallSnoozed(pt(TODAY), TODAY)).toBe(false);
    expect(isWelcomeCallSnoozed(pt("2026-09-21"), TODAY)).toBe(false);
    expect(isWelcomeCallSnoozed(pt(""), TODAY)).toBe(false);
  });

  it("⚠️ A BLANK DATE IS DUE, never snoozed — same as Auth Outstanding", () => {
    // The direction matters: reading a blank as snoozed hides a patient nothing
    // will ever bring back, which is the bug this rule replaced.
    expect(isWelcomeCallSnoozed(pt(""), TODAY)).toBe(false);
  });

  it("compares as YYYY-MM-DD strings, so it is ET-naive and DST-proof", () => {
    // Lexical order IS date order in this format — no Date object is built, so
    // a UTC container cannot shift the boundary (§5.15's standing trap).
    expect(isWelcomeCallSnoozed(pt("2026-03-08"), "2026-03-07")).toBe(true);
    expect(isWelcomeCallSnoozed(pt("2027-01-01"), "2026-12-31")).toBe(true);
  });
});

describe("the four places that apply it (§5.8 counting contract)", () => {
  it("1/4 — the sidebar owns the rule and exports it", () => {
    const src = read("./sidebarList.ts");
    expect(src).toMatch(/export function isWelcomeCallSnoozed/);
    expect(src).toMatch(/p\.followUpDate > todayYmd/);
  });

  it("2/4 — useRoleCounts IMPORTS it rather than restating it", () => {
    const src = read("../../hooks/useRoleCounts.ts");
    expect(src).toMatch(/import \{ isWelcomeCallSnoozed \} from "@\/lib\/welcomeCall\/sidebarList"/);
    expect(src).toMatch(/isWelcomeCallSnoozed\(/);
    // It must read the DATE column, not the status one.
    expect(src).toMatch(/WC_FOLLOWUP_DATE_COL = "date_mm38a7k7"/);
  });

  for (const [n, rel] of [
    ["3/4 — the build-time baseline", "../../../scripts/snapshot-baseline.mjs"],
    ["4/4 — the 9 AM cron baseline", "../../../services/baseline-cron/index.mjs"],
  ] as const) {
    it(`${n} carries the same comparison as a literal`, () => {
      const src = read(rel);
      // The date column, and a strictly-greater-than against an ET "today".
      expect(src).toMatch(/WC_FOLLOWUP_DATE_COL = "date_mm38a7k7"/);
      expect(src).toMatch(/i\.cols\[WC_FOLLOWUP_DATE_COL\] > todayEt/);
      expect(src).toMatch(/timeZone: "America\/New_York"/);
    });

    it(`${n} no longer buckets on the Follow Up STATUS`, () => {
      // A status-based filter left behind here is the drift this scan exists
      // for: the bar would keep hiding patients the sidebar now shows.
      expect(read(rel)).not.toMatch(/WC_FOLLOWUP_COL\b/);
    });
  }
});

describe("a new arrival comes back TOMORROW, not today", () => {
  const src = read("../../hooks/welcomeCall/useMondayPatients.ts");

  it("stamps a blank Follow Up Date with the next business day", () => {
    expect(src).toMatch(/addBusinessDaysIso\(etToday\(\), 1\)/);
    expect(src).toMatch(/writeDate\(p\.id, COL\.followUpDate, arrivalStr\)/);
  });

  it("⚠️ THE DATE ONLY — it must never write the Follow Up STATUS", () => {
    // Writing the status would file every arrival under Follow Up and read as
    // Paused in Profile Status (§5.18), which is the column this stage stopped
    // depending on in the first place.
    expect(src).not.toMatch(/COL\.followUp\b(?!Date)/);
  });

  it("stamps each patient ONCE and retries only on failure", () => {
    expect(src).toMatch(/stampedRef/);
    expect(src).toMatch(/stampedRef\.current\.add\(p\.id\)/);
    expect(src).toMatch(/stampedRef\.current\.delete\(p\.id\)/);
  });

  it("only fills a BLANK date — it never overwrites a real follow-up", () => {
    expect(src).toMatch(/if \(!p\.followUpDate && !stampedRef\.current\.has\(p\.id\)\)/);
  });
});
