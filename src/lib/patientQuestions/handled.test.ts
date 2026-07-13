import { describe, it, expect } from "vitest";
import {
  isQuestionOpen,
  mondayDateValueToIso,
  newestTimestamp,
  nowAsMondayDateValue,
} from "./handled";

describe("isQuestionOpen", () => {
  it("is open when never handled", () => {
    expect(isQuestionOpen("2026-07-13T10:00:00Z", "")).toBe(true);
    expect(isQuestionOpen("", "")).toBe(true);
  });

  it("is closed when handled after the message", () => {
    expect(isQuestionOpen("2026-07-13T10:00:00Z", "2026-07-13T11:00:00Z")).toBe(false);
  });

  it("is closed when handled at exactly the message time", () => {
    expect(isQuestionOpen("2026-07-13T10:00:00Z", "2026-07-13T10:00:00Z")).toBe(false);
  });

  it("reopens when the patient writes after it was handled", () => {
    expect(isQuestionOpen("2026-07-13T12:00:00Z", "2026-07-13T11:00:00Z")).toBe(true);
  });

  it("trusts the handled mark when the message time is unknown", () => {
    expect(isQuestionOpen("", "2026-07-13T11:00:00Z")).toBe(false);
    expect(isQuestionOpen("not a date", "2026-07-13T11:00:00Z")).toBe(false);
  });

  it("never hides a question over an unreadable handled mark", () => {
    expect(isQuestionOpen("2026-07-13T10:00:00Z", "not a date")).toBe(true);
  });
});

describe("mondayDateValueToIso", () => {
  it("builds an ISO from Monday's {date, time} value (time is UTC)", () => {
    expect(mondayDateValueToIso('{"date":"2026-07-13","time":"14:30:00"}')).toBe("2026-07-13T14:30:00Z");
  });

  it("defaults a date-only value to midnight UTC", () => {
    expect(mondayDateValueToIso('{"date":"2026-07-13"}')).toBe("2026-07-13T00:00:00Z");
  });

  it("returns empty for null / cleared / malformed values", () => {
    expect(mondayDateValueToIso(null)).toBe("");
    expect(mondayDateValueToIso(undefined)).toBe("");
    expect(mondayDateValueToIso("{}")).toBe("");
    expect(mondayDateValueToIso("not json")).toBe("");
  });
});

describe("nowAsMondayDateValue → mondayDateValueToIso round trip", () => {
  it("survives the round trip to the second", () => {
    const now = new Date("2026-07-13T18:05:09.123Z");
    const value = nowAsMondayDateValue(now);
    expect(value).toEqual({ date: "2026-07-13", time: "18:05:09" });
    const iso = mondayDateValueToIso(JSON.stringify(value));
    expect(Date.parse(iso)).toBe(Date.parse("2026-07-13T18:05:09Z"));
  });

  it("a message right after handling reads as open, right before as closed", () => {
    const handled = mondayDateValueToIso(JSON.stringify(nowAsMondayDateValue(new Date("2026-07-13T18:05:09.500Z"))));
    expect(isQuestionOpen("2026-07-13T18:05:10Z", handled)).toBe(true);
    expect(isQuestionOpen("2026-07-13T18:05:08Z", handled)).toBe(false);
  });
});

describe("newestTimestamp", () => {
  it("picks the newest parseable candidate", () => {
    expect(newestTimestamp("2026-07-13T10:00:00Z", "2026-07-13T12:00:00Z")).toBe("2026-07-13T12:00:00Z");
    expect(newestTimestamp("2026-07-13T12:00:00Z", "garbage")).toBe("2026-07-13T12:00:00Z");
  });

  it("returns empty when nothing parses", () => {
    expect(newestTimestamp("", "garbage")).toBe("");
  });
});
