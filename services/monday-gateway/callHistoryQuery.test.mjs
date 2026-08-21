import { describe, it, expect } from "vitest";
import { last4 } from "./callRules.mjs";
import {
  buildHistoryQuery,
  MAX_HOURS,
  MAX_LIMIT,
  DEFAULT_HOURS,
  DEFAULT_LIMIT,
} from "./callHistoryQuery.mjs";

/** Every $n in the SQL must have a matching entry in args — an off-by-one here
 *  is a runtime "bind message supplies N parameters" error, never a test one. */
function placeholders(sql) {
  return [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
}
function placeholdersAgreeWithArgs(q) {
  const used = new Set(placeholders(q.sql));
  return used.size === q.args.length && Math.max(...used) === q.args.length;
}

describe("buildHistoryQuery — defaults", () => {
  it("is the last 24h, 200 rows, no other filter", () => {
    const q = buildHistoryQuery({});
    expect(q.hours).toBe(DEFAULT_HOURS);
    expect(q.limit).toBe(DEFAULT_LIMIT);
    expect(q.args).toEqual(["24", 200]);
    expect(q.sql).toContain("FROM call_events");
    expect(q.sql).toContain("ORDER BY at DESC");
    expect(placeholdersAgreeWithArgs(q)).toBe(true);
  });

  it("called with no argument at all", () => {
    const q = buildHistoryQuery();
    expect(q.args).toEqual(["24", 200]);
  });
});

describe("buildHistoryQuery — filters", () => {
  it("session narrows to one call and numbers its placeholder correctly", () => {
    const q = buildHistoryQuery({ session: "sess-1" });
    expect(q.sql).toContain("session_id = $2");
    expect(q.args).toEqual(["24", "sess-1", 200]);
    expect(placeholdersAgreeWithArgs(q)).toBe(true);
  });

  it("last4 narrows by the display hint", () => {
    const q = buildHistoryQuery({ last4: "2514" });
    expect(q.sql).toContain("last4 = $2");
    expect(q.args).toEqual(["24", "2514", 200]);
  });

  it("both filters keep args and placeholders in step", () => {
    const q = buildHistoryQuery({ session: "s", last4: "(717) 424-2514", hours: 168 });
    expect(q.sql).toContain("session_id = $2");
    expect(q.sql).toContain("last4 = $3");
    expect(q.args).toEqual(["168", "s", "2514", 200]);
    expect(placeholdersAgreeWithArgs(q)).toBe(true);
  });

  it("a blank/whitespace session is not a filter", () => {
    expect(buildHistoryQuery({ session: "   " }).args).toEqual(["24", 200]);
  });

  // Nothing is concatenated, so a hostile value lands in args as a plain string.
  it("never interpolates caller input into the SQL", () => {
    const nasty = "'; DROP TABLE call_events; --";
    const q = buildHistoryQuery({ session: nasty });
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.args).toContain(nasty);
  });
});

describe("buildHistoryQuery — bounds", () => {
  it("clamps hours to the 90-day ceiling", () => {
    expect(buildHistoryQuery({ hours: 99999 }).hours).toBe(MAX_HOURS);
  });

  it("clamps limit to the page ceiling", () => {
    expect(buildHistoryQuery({ limit: 10 ** 6 }).limit).toBe(MAX_LIMIT);
  });

  // ⚠️ The reason clamp() checks `n <= 0` rather than flooring: an absent or
  // junk param must mean "the default window", never "the smallest one".
  it("absent, empty and junk values fall back to the DEFAULT, not the floor", () => {
    for (const bad of [undefined, null, "", "  ", "abc", NaN]) {
      const q = buildHistoryQuery({ hours: bad, limit: bad });
      expect(q.hours).toBe(DEFAULT_HOURS);
      expect(q.limit).toBe(DEFAULT_LIMIT);
    }
  });

  it("zero and negatives fall back too", () => {
    expect(buildHistoryQuery({ hours: 0 }).hours).toBe(DEFAULT_HOURS);
    expect(buildHistoryQuery({ hours: -5 }).hours).toBe(DEFAULT_HOURS);
    expect(buildHistoryQuery({ limit: -1 }).limit).toBe(DEFAULT_LIMIT);
  });

  it("accepts numeric strings, as they arrive from a query string", () => {
    const q = buildHistoryQuery({ hours: "168", limit: "50" });
    expect(q.hours).toBe(168);
    expect(q.limit).toBe(50);
    expect(q.args[0]).toBe("168"); // interval cast takes text
  });

  it("floors fractional input", () => {
    expect(buildHistoryQuery({ hours: 2.9 }).hours).toBe(2);
  });
});

// ⚠️ The query must normalise last4 with the SAME helper that stamped the
// column on the way in (callRules.last4, used by recordEvent). A second copy of
// the rule would drift and the filter would silently match nothing.
describe("last4 filtering matches the writer's own normalisation", () => {
  it("accepts every shape a number arrives in", () => {
    for (const shape of ["(717) 424-2514", "+17174242514", "717-424-2514", "2514"]) {
      expect(buildHistoryQuery({ last4: shape }).args).toEqual(["24", last4(shape), 200]);
      expect(last4(shape)).toBe("2514");
    }
  });

  it("anything that cannot supply four digits is not a filter at all", () => {
    for (const bad of ["", "abc", "251", undefined, null]) {
      expect(buildHistoryQuery({ last4: bad }).args).toEqual(["24", 200]);
    }
  });
});
