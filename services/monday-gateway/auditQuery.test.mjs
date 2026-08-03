import { describe, it, expect } from "vitest";
import { buildAuditQuery, MAX_LIMIT, MAX_SINCE_DAYS } from "./auditQuery.mjs";

/** The placeholders in `where` must match the params array exactly. */
function placeholderNumbers(where) {
  return [...where.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
}

describe("buildAuditQuery — defaults", () => {
  it("shows writes only, newest 1000, no other filter", () => {
    const q = buildAuditQuery({});
    expect(q.where).toBe("WHERE operation = 'mutation'");
    expect(q.params).toEqual([1000]); // just the LIMIT
    expect(q.onlyWrites).toBe(true);
    expect(q.onlyFailed).toBe(false);
  });

  it("all=1 drops the mutation filter", () => {
    const q = buildAuditQuery({ all: "1" });
    expect(q.where).toBe("");
    expect(q.params).toEqual([1000]);
  });
});

describe("buildAuditQuery — failures", () => {
  it("failed=1 filters on ok = false, not on monday_status", () => {
    // Monday returns HTTP 200 with an errors[] body for a rejected column, so
    // filtering on status would miss every failure worth looking at.
    const q = buildAuditQuery({ failed: "1" });
    expect(q.where).toContain("ok = false");
    expect(q.where).not.toContain("monday_status");
    expect(q.onlyFailed).toBe(true);
  });

  it("combines with the writes-only default", () => {
    const q = buildAuditQuery({ failed: "1" });
    expect(q.where).toBe("WHERE operation = 'mutation' AND ok = false");
  });
});

describe("buildAuditQuery — targeted lookups", () => {
  it("filters by item id as a bound param", () => {
    const q = buildAuditQuery({ item: "12582145458" });
    expect(q.where).toBe("WHERE operation = 'mutation' AND item_id = $1");
    expect(q.params).toEqual(["12582145458", 1000]);
  });

  it("filters by actor with a case-insensitive contains", () => {
    const q = buildAuditQuery({ actor: "janelle" });
    expect(q.where).toContain("actor ILIKE $1");
    expect(q.params[0]).toBe("%janelle%");
  });

  it("filters by age using a bound interval string", () => {
    const q = buildAuditQuery({ since: "7" });
    expect(q.where).toContain("created_at > now() - $1::interval");
    expect(q.params[0]).toBe("7 days");
  });

  it("numbers placeholders correctly with every filter at once", () => {
    const q = buildAuditQuery({
      failed: "1", item: "123", actor: "jb@medicallymodern.com", since: "3", limit: "50",
    });
    expect(q.where).toBe(
      "WHERE operation = 'mutation' AND ok = false AND item_id = $1 AND actor ILIKE $2 AND created_at > now() - $3::interval",
    );
    expect(q.params).toEqual(["123", "%jb@medicallymodern.com%", "3 days", 50]);
    // $1..$3 in the clause, and LIMIT takes $4 — the last slot, always.
    expect(placeholderNumbers(q.where)).toEqual([1, 2, 3]);
    expect(q.params.length).toBe(4);
  });

  it("keeps LIMIT as the final param when no filters are set", () => {
    const q = buildAuditQuery({});
    expect(q.params[q.params.length - 1]).toBe(q.limit);
  });
});

describe("buildAuditQuery — bounds and junk input", () => {
  it("caps the limit", () => {
    expect(buildAuditQuery({ limit: "999999" }).limit).toBe(MAX_LIMIT);
  });

  it("caps the lookback", () => {
    expect(buildAuditQuery({ since: "99999" }).sinceDays).toBe(MAX_SINCE_DAYS);
  });

  it("falls back to the default limit on unparseable input", () => {
    expect(buildAuditQuery({ limit: "abc" }).limit).toBe(1000);
    expect(buildAuditQuery({ limit: "0" }).limit).toBe(1000);
  });

  it("ignores blank and whitespace-only filters", () => {
    const q = buildAuditQuery({ item: "   ", actor: "", since: "0" });
    expect(q.where).toBe("WHERE operation = 'mutation'");
    expect(q.params).toEqual([1000]);
  });

  it("does not interpolate a quote-injection attempt into the SQL", () => {
    const evil = "1' OR '1'='1";
    const q = buildAuditQuery({ item: evil });
    expect(q.where).toBe("WHERE operation = 'mutation' AND item_id = $1");
    expect(q.where).not.toContain(evil);
    expect(q.params[0]).toBe(evil); // bound, not inlined
  });
});
