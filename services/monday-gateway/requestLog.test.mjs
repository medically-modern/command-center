import { describe, it, expect } from "vitest";
import {
  buildRequestLogQuery,
  clip,
  shouldLogRequest,
  stripQuery,
  SKIP_EXACT,
  MAX_HOURS,
  MAX_LIMIT,
  DEFAULT_HOURS,
  DEFAULT_LIMIT,
} from "./requestLog.mjs";

function placeholders(sql) {
  return [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
}
function placeholdersAgreeWithArgs(q) {
  const used = new Set(placeholders(q.sql));
  return used.size === q.args.length && Math.max(...used) === q.args.length;
}

// ⚠️ THE security test of this module. EventSource cannot set headers, so
// /calls/stream carries the caller's Google ID token in the URL. If the logger
// ever stores raw URLs it writes live bearer tokens into Postgres.
describe("stripQuery — credentials and identifiers never reach the table", () => {
  it("drops the Google ID token on the SSE stream URL", () => {
    const url = "/calls/stream?token=eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.PAYLOAD.SIG";
    expect(stripQuery(url)).toBe("/calls/stream");
    expect(stripQuery(url)).not.toMatch(/eyJ|token/);
  });

  it("drops patient identifiers from query strings", () => {
    expect(stripQuery("/calls/history?last4=2514&hours=168")).toBe("/calls/history");
    expect(stripQuery("/rc/fetch?url=https%3A%2F%2Fmedia.ringcentral.com%2Fx%2Fcontent")).toBe(
      "/rc/fetch",
    );
  });

  it("keeps a path that has no query string", () => {
    expect(stripQuery("/calls/claim")).toBe("/calls/claim");
    expect(stripQuery("/rc/restapi/v1.0/account/~/extension/~/message-store")).toBe(
      "/rc/restapi/v1.0/account/~/extension/~/message-store",
    );
  });

  it("drops a fragment too, and a bare '?' leaves the path clean", () => {
    expect(stripQuery("/x#frag")).toBe("/x");
    expect(stripQuery("/x?")).toBe("/x");
    expect(stripQuery("/x?a=1#frag")).toBe("/x");
  });

  it("survives null and undefined", () => {
    expect(stripQuery(undefined)).toBe("");
    expect(stripQuery(null)).toBe("");
  });
});

describe("shouldLogRequest", () => {
  it("skips /gql — gql_log already records it with far more detail", () => {
    expect(shouldLogRequest("POST", "/gql")).toBe(false);
    expect(SKIP_EXACT.has("/gql")).toBe(true);
  });

  it("skips the liveness probe", () => {
    expect(shouldLogRequest("GET", "/health")).toBe(false);
  });

  // Every cross-origin POST is preceded by one; logging them ~doubles the table
  // to record a 204 that says nothing the POST beside it doesn't.
  it("skips CORS preflight, whatever the path", () => {
    expect(shouldLogRequest("OPTIONS", "/calls/claim")).toBe(false);
    expect(shouldLogRequest("options", "/send")).toBe(false);
  });

  it("logs everything else — the routes with no durable record before this", () => {
    for (const p of [
      "/calls/claim",
      "/calls/webhook",
      "/calls/stream",
      "/rc/restapi/v1.0/account/~/extension/~/message-store",
      "/rc/fetch",
      "/messaging/conversation",
      "/send",
      "/audit",
    ]) {
      expect(shouldLogRequest("POST", p)).toBe(true);
    }
  });

  // The skip list holds PATHS, so it must survive a query string.
  it("skips a listed path even when it arrives with a query string", () => {
    expect(shouldLogRequest("POST", "/gql?x=1")).toBe(false);
    expect(shouldLogRequest("GET", "/health?probe=1")).toBe(false);
  });

  it("does not skip a path that merely starts with a skipped one", () => {
    expect(shouldLogRequest("GET", "/healthcheck")).toBe(true);
    expect(shouldLogRequest("POST", "/gql-proxy")).toBe(true);
  });
});

describe("clip", () => {
  it("bounds a runaway value", () => {
    expect(clip("x".repeat(1000), 512)).toHaveLength(512);
  });
  it("leaves short values and null alone", () => {
    expect(clip("GET", 10)).toBe("GET");
    expect(clip(null, 10)).toBeNull();
    expect(clip(undefined, 10)).toBeNull();
  });
});

describe("buildRequestLogQuery", () => {
  it("defaults to the last 24h, 500 rows", () => {
    const q = buildRequestLogQuery({});
    expect(q.hours).toBe(DEFAULT_HOURS);
    expect(q.limit).toBe(DEFAULT_LIMIT);
    expect(q.args).toEqual(["24", 500]);
    expect(q.sql).toContain("FROM request_log");
    expect(placeholdersAgreeWithArgs(q)).toBe(true);
  });

  it("path is a PREFIX match, so /rc covers the whole proxy surface", () => {
    const q = buildRequestLogQuery({ path: "/rc" });
    expect(q.sql).toContain("path LIKE $2");
    expect(q.args).toEqual(["24", "/rc%", 500]);
  });

  it("stacks filters and keeps placeholders in step with args", () => {
    const q = buildRequestLogQuery({
      hours: 168,
      path: "/calls",
      actor: "janelle",
      method: "post",
      status: 410,
      limit: 50,
    });
    expect(q.args).toEqual(["168", "/calls%", "%janelle%", "POST", 410, 50]);
    expect(placeholdersAgreeWithArgs(q)).toBe(true);
  });

  // 204 and 304 are successes; "not 200" would flag them as failures.
  it("failed=1 means 4xx/5xx, not 'anything but 200'", () => {
    expect(buildRequestLogQuery({ failed: "1" }).sql).toContain("status >= 400");
    expect(buildRequestLogQuery({}).sql).not.toContain("status >=");
  });

  it("clamps the window and the page", () => {
    expect(buildRequestLogQuery({ hours: 10 ** 6 }).hours).toBe(MAX_HOURS);
    expect(buildRequestLogQuery({ limit: 10 ** 6 }).limit).toBe(MAX_LIMIT);
  });

  it("absent, empty and junk values fall back to the DEFAULT, not the floor", () => {
    for (const bad of [undefined, null, "", "  ", "abc", 0, -3]) {
      const q = buildRequestLogQuery({ hours: bad, limit: bad });
      expect(q.hours).toBe(DEFAULT_HOURS);
      expect(q.limit).toBe(DEFAULT_LIMIT);
    }
  });

  it("ignores a junk status rather than filtering on NaN", () => {
    const q = buildRequestLogQuery({ status: "abc" });
    expect(q.args).toEqual(["24", 500]);
  });

  it("never interpolates caller input into the SQL", () => {
    const nasty = "'; DROP TABLE request_log; --";
    const q = buildRequestLogQuery({ path: nasty, actor: nasty });
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.args).toContain(`${nasty}%`);
  });
});
