import { describe, it, expect } from "vitest";
import {
  describeReadFailure, fieldsFromGraphQLErrors, statusFromMessage, staleNoticeText,
} from "./mondayError";

describe("statusFromMessage", () => {
  it("reads the status the shared gql() wrappers embed", () => {
    expect(statusFromMessage("Monday request failed (503)")).toBe(503);
    expect(statusFromMessage("Monday request failed (429)")).toBe(429);
  });
  it("is null when there is no status to read", () => {
    expect(statusFromMessage("Internal Server Error")).toBe(null);
  });
});

describe("describeReadFailure", () => {
  it("classifies the real 2026-09-01 13:55 failures (HTTP 503)", () => {
    const f = describeReadFailure(new Error("Monday request failed (503)"));
    expect(f.kind).toBe("outage");
    expect(f.transient).toBe(true);
  });

  it("classifies the real 2026-09-01 12:07 failures (200 + Internal Server Error)", () => {
    // gql() joins errors[].message, so this is the string the hook receives.
    const f = describeReadFailure(new Error("Internal Server Error"));
    expect(f.kind).toBe("outage");
    expect(f.transient).toBe(true);
  });

  it("separates a throttle from an outage — different fix, different advice", () => {
    expect(describeReadFailure(new Error("Monday request failed (429)")).kind).toBe("throttled");
    expect(describeReadFailure(new Error("Complexity budget exhausted")).kind).toBe("throttled");
  });

  it("treats a dropped connection as ours, not Monday's", () => {
    for (const m of ["Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed"]) {
      expect(describeReadFailure(new TypeError(m)).kind).toBe("offline");
    }
  });

  it("a 4xx is NOT transient — retrying will not fix it", () => {
    const f = describeReadFailure(new Error("Monday request failed (401)"));
    expect(f.kind).toBe("rejected");
    expect(f.transient).toBe(false);
  });

  it("an unrecognised error is 'unknown', never silently transient", () => {
    const f = describeReadFailure(new Error("something nobody has seen"));
    expect(f.kind).toBe("unknown");
    expect(f.transient).toBe(false);
  });

  it("survives a non-Error being thrown", () => {
    expect(describeReadFailure("boom").kind).toBe("unknown");
    expect(describeReadFailure(undefined).kind).toBe("unknown");
  });
});

describe("fieldsFromGraphQLErrors", () => {
  it("names the field when Monday supplies a path", () => {
    expect(fieldsFromGraphQLErrors([{ path: ["boards", 0, "items_page"] }]))
      .toEqual(["boards.items_page"]);
  });

  it("drops list indices — a number means nothing to a rep", () => {
    expect(fieldsFromGraphQLErrors([{ path: [0, 1] }])).toEqual([]);
  });

  it("claims NOTHING for the errors Monday actually sent that day", () => {
    // Every real failure on 2026-09-01 looked like this: no path at all.
    // Inventing a field list here would send a rep hunting for a problem the
    // payload never described.
    expect(fieldsFromGraphQLErrors([
      { message: "Internal Server Error", extensions: { code: "INTERNAL_SERVER_ERROR" } },
    ])).toEqual([]);
    expect(fieldsFromGraphQLErrors(undefined)).toEqual([]);
    expect(fieldsFromGraphQLErrors(null)).toEqual([]);
  });

  it("de-duplicates repeated paths", () => {
    expect(fieldsFromGraphQLErrors([{ path: ["a"] }, { path: ["a"] }])).toEqual(["a"]);
  });
});

describe("staleNoticeText", () => {
  it("names the part of the screen and tells them it retries", () => {
    const t = staleNoticeText("The patient list", describeReadFailure(new Error("Monday request failed (503)")));
    expect(t).toContain("The patient list may be out of date");
    expect(t).toContain("Monday didn't respond");
    expect(t).toContain("retry automatically");
  });

  it("says reload plainly when retrying will not help", () => {
    const t = staleNoticeText("This patient's details", describeReadFailure(new Error("Monday request failed (401)")));
    expect(t).toContain("Reload the page.");
    expect(t).not.toContain("retry automatically");
  });

  it("includes field names only when Monday actually named them", () => {
    const withPath = staleNoticeText("The patient list",
      describeReadFailure(new Error("Monday request failed (500)"), { errors: [{ path: ["boards", "items_page"] }] }));
    expect(withPath).toContain("(boards.items_page)");
    const without = staleNoticeText("The patient list", describeReadFailure(new Error("Monday request failed (500)")));
    expect(without).not.toContain("(");
  });
});
