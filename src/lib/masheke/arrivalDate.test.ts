/**
 * A patient ARRIVING in a stage is due the NEXT BUSINESS DAY, not today.
 *
 * Josh, 2026-09-22, about both Evaluate and Auth Outstanding: *"Whenever a new
 * patient shows up in this bucket, make sure the Action Date is the next day,
 * not today, so it doesn't grow Masheke's evaluate bar"*. A patient who lands
 * at 4pm cannot be worked that afternoon, and stamping today put them straight
 * into the day's count — the bar grew by work nobody could have done.
 *
 * ⚠️ ONE EXCEPTION, and it is the other half of the same note: *"For upload
 * clinicals - that should show up same day, it's just ones coming from Katie
 * that should show up next day"*. That path writes its own date explicitly and
 * never reaches the blank-NAD stamp below, so it is preserved by construction
 * rather than by a condition. This file pins that it stays that way.
 *
 * Run: npx vitest run src/lib/masheke/arrivalDate.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { addBusinessDaysIso } from "./etDate";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("addBusinessDaysIso(today, 1) — what 'the next day' means here", () => {
  it("is the next WEEKDAY, so a Friday arrival is due Monday", () => {
    expect(addBusinessDaysIso("2026-09-22", 1)).toBe("2026-09-23"); // Tue → Wed
    expect(addBusinessDaysIso("2026-09-25", 1)).toBe("2026-09-28"); // Fri → Mon
    expect(addBusinessDaysIso("2026-09-26", 1)).toBe("2026-09-28"); // Sat → Mon
    expect(addBusinessDaysIso("2026-09-27", 1)).toBe("2026-09-28"); // Sun → Mon
  });

  it("crosses a year boundary without building a Date in local time", () => {
    expect(addBusinessDaysIso("2026-12-31", 1)).toBe("2027-01-01"); // Thu → Fri
  });
});

describe("Evaluate (and every masheke sub-stage) — the blank-NAD arrival stamp", () => {
  const src = read("../../hooks/masheke/useMondayPatients.ts");

  it("stamps the next business day, not today", () => {
    expect(src).toMatch(/const arrivalStr = addBusinessDaysIso\(todayStr, 1\)/);
    expect(src).toMatch(/writeDate\(p\.id, COL\.nextActionDate, dueStr\)/);
  });

  it("…unless a manager EXPEDITED them — then it is today (§5.56)", () => {
    // Decided per PATIENT from the column hop 7917676280 copies forward; the
    // next-day wait above is exactly what the mark exists to skip.
    expect(src).toMatch(/const dueStr = isExpedited\(p\.expedited\) \? todayStr : arrivalStr/);
  });

  it("only ever fills a BLANK Next Action Date", () => {
    // Overwriting a real date would drag a snoozed patient forward, or push a
    // due one out — the stamp exists for arrivals alone.
    expect(src).toMatch(/!p\.nextActionDate &&/);
  });

  it("stamps each patient once, and retries only when the write failed", () => {
    expect(src).toMatch(/stampedRef\.current\.add\(p\.id\)/);
    expect(src).toMatch(/stampedRef\.current\.delete\(p\.id\)/);
  });

  it("⚠️ Update Clinicals still lands SAME DAY — it writes its own date", () => {
    // `returnToEvaluateVerified` sets the NAD explicitly, so the patient never
    // arrives with a blank one and the +1 stamp above cannot reach them. If
    // this ever starts writing a blank, Katie's next-day rule would swallow the
    // same-day one Josh carved out.
    const writer = read("./mondayWrite.ts");
    const fn = writer.slice(writer.indexOf("export async function returnToEvaluateVerified"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
    expect(body).toMatch(/COL\.nextActionDate/);
    expect(body).not.toMatch(/addBusinessDaysIso/);
  });
});
