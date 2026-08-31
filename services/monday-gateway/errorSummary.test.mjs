import { describe, it, expect } from "vitest";
import {
  redactErrorMessage,
  buildErrorGroupsQuery,
  buildTotalsQuery,
  summarize,
  MAX_HOURS,
  DEFAULT_HOURS,
  MAX_MESSAGE_LEN,
} from "./errorSummary.mjs";

/** Every $n in the SQL must have a matching entry in args — an off-by-one here
 *  is a runtime "bind message supplies N parameters" error, never a test one. */
function placeholders(sql) {
  return new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
}

describe("redactErrorMessage — the security boundary of an UNAUTHENTICATED endpoint", () => {
  it("keeps a protocol string that carries no values intact", () => {
    expect(redactErrorMessage("Item link max locks exceeded")).toBe("Item link max locks exceeded");
  });

  it("strips echoed values out of quotes, which is where Monday puts them", () => {
    // A clinic or patient name reaching a public URL is the whole thing this prevents.
    expect(redactErrorMessage(`The label 'St Anne Family Clinic' does not exist`))
      .toBe(`The label '…' does not exist`);
    expect(redactErrorMessage('Column "Patient Name" is invalid')).toBe('Column "…" is invalid');
  });

  it("strips long digit runs — item ids, board ids, phone numbers", () => {
    expect(redactErrorMessage("Item 12937566870 not found on board 18406352652"))
      .toBe("Item # not found on board #");
  });

  it("leaves short numbers alone so error codes stay legible", () => {
    expect(redactErrorMessage("HTTP 429 rate limited")).toBe("HTTP 429 rate limited");
  });

  it("redacts BEFORE truncating, so a long message cannot leak a half-quoted value", () => {
    const secret = "Marguerite Vandenberg-Whitfield";
    const long = `Some very long Monday complaint that goes on and on and on and on and on and on and on about the label '${secret}' being unacceptable for this column`;
    const out = redactErrorMessage(long);
    expect(out).not.toContain("Marguerite");
    expect(out).not.toContain("Vandenberg");
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE_LEN);
  });

  it("collapses whitespace and survives empty/nullish input", () => {
    expect(redactErrorMessage("  too   many\n spaces ")).toBe("too many spaces");
    expect(redactErrorMessage("")).toBe("(empty)");
    expect(redactErrorMessage(null)).toBe("(empty)");
    expect(redactErrorMessage(undefined)).toBe("(empty)");
  });
});

describe("query bounds", () => {
  for (const build of [buildErrorGroupsQuery, buildTotalsQuery]) {
    it(`${build.name}: clamps the window and parameterises it`, () => {
      expect(build({ hours: 1 }).hours).toBe(1);
      expect(build({ hours: 999999 }).hours).toBe(MAX_HOURS);
      // ⚠️ absent/blank/garbage must land on the DEFAULT, never the floor —
      // Number("") is 0 and Number(undefined) is NaN.
      expect(build({}).hours).toBe(DEFAULT_HOURS);
      expect(build({ hours: "" }).hours).toBe(DEFAULT_HOURS);
      expect(build({ hours: "abc" }).hours).toBe(DEFAULT_HOURS);
      expect(build({ hours: -5 }).hours).toBe(DEFAULT_HOURS);
      expect(build({ hours: 0 }).hours).toBe(DEFAULT_HOURS);
    });

    it(`${build.name}: every placeholder has an argument, and no input is concatenated`, () => {
      const { sql, args } = build({ hours: 12 });
      expect(placeholders(sql)).toEqual(new Set(args.map((_, i) => i + 1)));
      expect(args).toEqual(["12"]);
      expect(sql).not.toContain("12'"); // the window rides as a bind, not inline
    });
  }

  it("groups query only counts FAILED rows, and normalises a non-array errors value", () => {
    const { sql } = buildErrorGroupsQuery({ hours: 24 });
    expect(sql).toContain("ok IS NOT TRUE");
    expect(sql).toContain("monday_errors IS NOT NULL");
    expect(sql).toContain("jsonb_typeof");
    expect(sql).toContain("jsonb_build_array");
  });

  it("groups query is bounded — an unbounded LIMIT is how one request becomes everyone's slow query", () => {
    expect(buildErrorGroupsQuery({}).sql).toMatch(/LIMIT \d+/);
  });
});

describe("summarize", () => {
  it("merges rows whose messages collapse to the same shape, adding counts", () => {
    const out = summarize([
      { raw_message: "The label 'A Clinic' does not exist", n: 3, first_seen: "2026-08-30T10:00:00Z", last_seen: "2026-08-30T11:00:00Z" },
      { raw_message: "The label 'B Clinic' does not exist", n: 2, first_seen: "2026-08-30T09:00:00Z", last_seen: "2026-08-30T12:00:00Z" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      message: "The label '…' does not exist",
      count: 5,
      firstSeen: "2026-08-30T09:00:00Z",
      lastSeen: "2026-08-30T12:00:00Z",
    });
  });

  it("sorts by count, and never emits a raw message", () => {
    const out = summarize([
      { raw_message: "Item link max locks exceeded", n: 2, first_seen: null, last_seen: null },
      { raw_message: "The label 'Secret Clinic' does not exist", n: 9, first_seen: null, last_seen: null },
    ]);
    expect(out.map((g) => g.count)).toEqual([9, 2]);
    expect(JSON.stringify(out)).not.toContain("Secret Clinic");
  });

  it("handles an empty window", () => {
    expect(summarize([])).toEqual([]);
    expect(summarize()).toEqual([]);
  });
});
