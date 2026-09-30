/**
 * A patient arriving in AUTH OUTSTANDING is due the next business day.
 *
 * Josh, 2026-09-22: *"Whenever a new patient shows up in this bucket, make sure
 * the Action Date is the next day, not today, so it doesn't grow Masheke's
 * evaluate bar"* — the same note that moved Evaluate's arrival stamp
 * (lib/masheke/arrivalDate.test.ts).
 *
 * ⚠️ THIS REVERSES the Submit Auth redesign's §7 rule ("same-day, not +1",
 * reasoned from payers that answer immediately), so the date is pinned here
 * rather than left to be re-derived from that document. Submitting an auth and
 * chasing it are different days' work: stamping today put the patient into the
 * Auth Outstanding bar the moment the rep pressed Send.
 *
 * ⚠️ Auth Outstanding is a PURE DATE BUCKET (§5.8) — the Follow Up STATUS is
 * ignored there and a blank date counts as DUE — so this one write is what
 * decides the day the patient first appears. The counting contract itself is
 * untouched: this writes a board value the three readers already read.
 *
 * Run: npx vitest run src/lib/samantha/authArrivalDate.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "./mondayWrite.ts"), "utf8");

describe("the Submit Auth send stamps the NEXT BUSINESS DAY", () => {
  it("writes Follow Up Date from addBusinessDaysIso(today, 1)", () => {
    expect(src).toMatch(/import \{ addBusinessDaysIso \} from "@\/lib\/masheke\/etDate"/);
    expect(src).toMatch(
      /const authFollowUpEt = todayEt\s*\?\s*\(isExpedited\(p\.expedited\) \? todayEt : addBusinessDaysIso\(todayEt, 1\)\)\s*:\s*todayEt/,
    );
    expect(src).toMatch(/fn: \(\) => writeDate\(p\.id, COL\.followUpDate, authFollowUpEt\)/);
  });

  it("…unless a manager EXPEDITED them — then it is today (§5.56)", () => {
    // Josh, 2026-09-30: "same day for auth outstanding". Read off the patient's
    // own Insurance column, which hop 7918295320 copies forward.
    expect(src).toMatch(/import \{ isExpedited \} from "@\/lib\/shared\/expedited"/);
    expect(src).toMatch(/isExpedited\(p\.expedited\) \? todayEt :/);
  });

  it("the declared task value matches what the client path writes", () => {
    // The gateway's durable fast path sends the DECLARED value (§5.2), so a
    // task whose `value` disagreed with its `fn` would write one date through
    // one path and another through the other.
    expect(src).toMatch(/value: authFollowUpEt \? \{ date: authFollowUpEt \} : \{\}/);
  });

  it("⚠️ it does NOT touch the Follow Up STATUS column", () => {
    // Auth Outstanding ignores that column, and writing it would read as
    // Paused in Profile Status (§5.18) for a patient who is simply dated.
    const block = src.slice(src.indexOf("const authFollowUpEt"), src.indexOf('} else if (context === "authOutstanding")'));
    expect(block).not.toMatch(/COL\.followUp\b(?!Date)/);
  });

  it("a missing ET today degrades to a clear, never to a guessed date", () => {
    // `todayEt` empty ⇒ `{}`, which clears the column. Inventing a date from a
    // container's local clock is what §5.15 exists to prevent.
    expect(src).toMatch(/authFollowUpEt \? \{ date: authFollowUpEt \} : \{\}/);
  });
});
