/**
 * The DTC form lead's "Already In System" pill (§5.21).
 *
 * The property worth pinning is not the string list — it is WHICH COLUMN the
 * flag reads. Partial leads are flagged and deliberately never filed, so
 * `alreadyInSystem` is blank for them by design; a version of this that read
 * that column would render a pill that is permanently absent for exactly the
 * population it exists to serve, and nothing would error.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isAlreadyInSystemResult } from "./dupCheckFlag";

describe("isAlreadyInSystemResult", () => {
  it("flags every verdict that means we matched an existing patient", () => {
    for (const v of ["Duplicate", "Duplicate — updated info", "New order — different serving"]) {
      expect(isAlreadyInSystemResult(v), v).toBe(true);
    }
  });

  it("does NOT flag a checked-and-clear lead", () => {
    // "New" is stamped precisely so a BLANK column keeps meaning "never
    // checked" — the ambiguity the whole DTC gap hid behind.
    expect(isAlreadyInSystemResult("New")).toBe(false);
  });

  it("does NOT flag a failed or uncorroborated check", () => {
    expect(isAlreadyInSystemResult("Check failed")).toBe(false);
    // "Needs review" is an item somebody FILED as in-system that the matcher
    // could not corroborate. Those sit in the Already In System group with
    // their own role and their own banner.
    expect(isAlreadyInSystemResult("Needs review")).toBe(false);
  });

  it("treats blank, missing and unknown as not flagged", () => {
    for (const v of ["", "   ", null, undefined, "Something else"]) {
      expect(isAlreadyInSystemResult(v)).toBe(false);
    }
  });

  it("is whitespace-tolerant but never a substring match", () => {
    expect(isAlreadyInSystemResult("  Duplicate  ")).toBe(true);
    // "Not a duplicate" contains "Duplicate"; matching loosely would invert it.
    expect(isAlreadyInSystemResult("Not a duplicate")).toBe(false);
  });
});

describe("keep-in-agreement", () => {
  it("reads the Dup Check verdict column, never Already In System", () => {
    const src = readFileSync("src/lib/profile/dupCheckFlag.ts", "utf8");
    const body = src.slice(src.indexOf("export function isAlreadyInSystemResult"));
    expect(body).not.toContain("alreadyInSystem");
  });

  it("the verdict column is fetched, or the pill can never render", () => {
    // READ_COLUMN_IDS is the whole fetch: a column missing from it reads
    // permanently blank with no error (§5.11's five-places rule).
    const api = readFileSync("src/lib/profile/mondayApi.ts", "utf8");
    expect(api).toContain('dupCheckResult: "color_mm65tv1m"');
    // Slice to the array's own closing bracket rather than a fixed character
    // count — the read set is ~60 columns long and a short window passes for
    // the wrong reason (or fails for it, which is how this test first ran).
    const start = api.indexOf("export const READ_COLUMN_IDS");
    const readSet = api.slice(start, api.indexOf("\n];", start));
    expect(readSet).toContain("COL.dupCheckResult");
  });

  it("is mapped onto Patient, and rendered on the intake page", () => {
    expect(readFileSync("src/lib/profile/mondayMapping.ts", "utf8"))
      .toContain("dupCheckResult: col(item, COL.dupCheckResult)");
    expect(readFileSync("src/pages/UnverifiedReferralsPage.tsx", "utf8"))
      .toContain("isAlreadyInSystemResult(selected.dupCheckResult)");
  });
});
