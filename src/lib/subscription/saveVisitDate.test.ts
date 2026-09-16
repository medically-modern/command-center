/**
 * Pins the two-write contract of Update Clinicals' "Save Visit Date"
 * (mondayWrite.saveVisitDateVerified):
 *
 *   1. MN Expiry  (date_mkp09gra)   — data, written and READ BACK first
 *   2. MR         (color_mktyr8xg)  — the trigger column, written last
 *
 * IN THAT ORDER, with the read-back in between. Both halves matter:
 *
 *  - Webhook 637064239 on this board fires on any change to the MR column, and
 *    Monday returns 200 on a write BEFORE the value is indexed (§5.2). Writing
 *    MR first hands that consumer an item still carrying the OLD MN Expiry.
 *  - A half-failure has to leave the safer state. Date-first means a failed
 *    date write claims nothing; the reverse would assert a patient's records
 *    are current on a row whose expiry never moved.
 *
 * A regression here is silent on every surface — green toast, right date on
 * the board, a status that is either stale or a lie.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { COL } from "./mondayApi";
import { MR_STATUS_INDEX } from "./mrStatus";

const calls = vi.hoisted(() => [] as string[]);
/** Simulated board state, so read-back verification sees the write land. */
const board = vi.hoisted(() => ({ cols: {} as Record<string, string> }));

vi.mock("./mondayApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mondayApi")>();
  return {
    ...actual,
    writeDate: vi.fn(async (_itemId: string, columnId: string, date: string) => {
      calls.push(`date:${columnId}:${date}`);
      board.cols[columnId] = date;
    }),
    writeStatusIndex: vi.fn(async (_itemId: string, columnId: string, index: number) => {
      calls.push(`status:${columnId}:${index}`);
      board.cols[columnId] = String(index);
    }),
    readColumnTexts: vi.fn(async (_itemId: string, columnIds: string[]) => {
      calls.push(`read:${columnIds.join(",")}`);
      return columnIds.map((id) => ({ id, text: board.cols[id] ?? "" }));
    }),
  };
});

import { saveVisitDateVerified } from "./mondayWrite";

/** Comfortably past the 30-day rung, as visit-date + 6 months always is. */
const FAR = "2027-03-16";

describe("saveVisitDateVerified", () => {
  beforeEach(() => {
    calls.length = 0;
    board.cols = { [COL.mnExpiry]: "2026-03-01", [COL.mr]: "MR Expired" };
  });

  it("writes MN Expiry, reads it back, and only THEN writes MR", async () => {
    await saveVisitDateVerified("42", FAR);

    const dateAt = calls.indexOf(`date:${COL.mnExpiry}:${FAR}`);
    const mrAt = calls.indexOf(`status:${COL.mr}:${MR_STATUS_INDEX.valid}`);

    expect(dateAt, "MN Expiry was written").toBeGreaterThanOrEqual(0);
    expect(mrAt, "MR was written").toBeGreaterThanOrEqual(0);
    expect(mrAt, "MR must be written AFTER MN Expiry").toBeGreaterThan(dateAt);

    // A read-back of MN Expiry sits between the two — that is the whole point
    // of routing this through verifiedWrite rather than firing both writes.
    const verifyRead = calls
      .slice(dateAt, mrAt)
      .some((c) => c.startsWith("read:") && c.includes(COL.mnExpiry));
    expect(verifyRead, "MN Expiry is read back before MR is written").toBe(true);
  });

  it("sets MR Valid for a date past the 30-day rung", async () => {
    await saveVisitDateVerified("42", FAR);
    expect(calls).toContain(`status:${COL.mr}:${MR_STATUS_INDEX.valid}`);
    // 1, not 0 — 0 is "MR <30 Days" on this column. Monday drops a write to an
    // id the column does not have at HTTP 200, so the wrong id here would look
    // exactly like the bug this fixes.
    expect(MR_STATUS_INDEX.valid).toBe(1);
  });

  // ⚠️ The status follows the DATE, not the button. An old visit date lands
  // mid-ladder, and writing "Valid" there would un-expire a patient the board
  // is about to expire again.
  it("sets the mid-ladder rung for an old visit rather than MR Valid", async () => {
    const soon = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    await saveVisitDateVerified("42", soon);
    expect(calls).toContain(`status:${COL.mr}:${MR_STATUS_INDEX.days20}`);
    expect(calls).not.toContain(`status:${COL.mr}:${MR_STATUS_INDEX.valid}`);
  });

  // No readable date ⇒ no status claim. Guessing a rung from a value we could
  // not parse is the one direction that costs something.
  it("writes no status at all when the date cannot be read", async () => {
    await saveVisitDateVerified("42", "not-a-date");
    expect(calls.some((c) => c.startsWith(`status:${COL.mr}`))).toBe(false);
  });

  it("targets the columns the board's automations actually use", () => {
    expect(COL.mnExpiry).toBe("date_mkp09gra");
    expect(COL.mr).toBe("color_mktyr8xg");
  });
});
