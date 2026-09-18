import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * `sendEmailToMonday` — the board half of the Welcome Call email editor (§5.31h).
 *
 * Two properties, and both are about a write that would otherwise LOOK fine:
 *
 *  1. **The refusal runs before the write.** A malformed address lands on the
 *     board at HTTP 200 like any other text, and everything downstream joins on
 *     the string verbatim — the Calendly mirror (§5.15), the "Call scheduled"
 *     chip (§5.31e), the Gmail thread search. So a typo does not error, it reads
 *     as "not booked" and "no previous emails" for ever.
 *  2. **`writeText`, never an `email_` column's `{email, text}` shape.**
 *     `COL.email` `text_mm1xc140` is a plain TEXT column; the object shape is
 *     refused at HTTP 200 with a GraphQL `errors[]` — the app's most common
 *     silent failure (§10).
 */

const writeText = vi.fn().mockResolvedValue(undefined);

vi.mock("./mondayApi", async () => {
  const actual = await vi.importActual<typeof import("./mondayApi")>("./mondayApi");
  return { ...actual, writeText: (...a: unknown[]) => writeText(...a) };
});

const { sendEmailToMonday } = await import("./mondayWrite");
const { COL } = await import("./mondayApi");

beforeEach(() => writeText.mockClear());

describe("sendEmailToMonday", () => {
  it("writes the Email column as plain text", async () => {
    await sendEmailToMonday("42", "pat@example.com");
    expect(writeText).toHaveBeenCalledWith("42", COL.email, "pat@example.com");
  });

  it("trims — the Calendly and Gmail joins match verbatim", async () => {
    await sendEmailToMonday("42", "  pat@example.com \n");
    expect(writeText).toHaveBeenCalledWith("42", COL.email, "pat@example.com");
  });

  it("REFUSES a malformed address without touching the board", async () => {
    await expect(sendEmailToMonday("42", "pat.example.com")).rejects.toThrow(/email address/i);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("refuses an address with a space in it — the one thing the shared rule must catch", async () => {
    await expect(sendEmailToMonday("42", "pat @example.com")).rejects.toThrow();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("accepts a machine address, because the shared rule has to (§5.5)", async () => {
    // `<digits>@rcfax.com` is how this company faxes; a stricter rule than
    // `shared/emailCell`'s would start refusing real, working addresses.
    await sendEmailToMonday("42", "5555550100@rcfax.com");
    expect(writeText).toHaveBeenCalledWith("42", COL.email, "5555550100@rcfax.com");
  });

  it("treats a blank as a deliberate clear", async () => {
    await sendEmailToMonday("42", "   ");
    expect(writeText).toHaveBeenCalledWith("42", COL.email, "");
  });
});

/**
 * ⚠️ The rule is `shared/emailCell`'s, not a second regex — the normalizer, the
 * splitter and the validator must not disagree (§5.19b's reasoning for the fax
 * address, one column over).
 */
describe("the shape rule is shared, not re-implemented", () => {
  it("calls isEmailAddress rather than testing its own pattern", () => {
    const src = readFileSync("src/lib/welcomeCall/mondayWrite.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function sendEmailToMonday"));
    expect(fn).toMatch(/isEmailAddress\(value\)/);
    expect(fn.slice(0, 500)).not.toMatch(/@\[\^|\/\^\[\^\\s@\]/);
  });
});
