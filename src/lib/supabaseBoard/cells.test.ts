import { describe, expect, it } from "vitest";
import {
  BLANK_STATUS_HEX,
  batterySegments,
  columnWidth,
  columnsWithData,
  formatMondayDate,
  formatPhone,
  matchesSearch,
  relativeTime,
  statusHex,
} from "./cells";
import type { MirrorItem } from "./boardApi";

/* Synthetic items — no real patient. */
const item = (id: string, name: string, cells: MirrorItem["cells"]): MirrorItem => ({
  id, name, groupId: "g1", createdAt: null, updatedAt: null, cells,
});
const LABELS = { color_x: { "0": { label: "Yes", hex: "#df2f4a" }, "1": { label: "No", hex: "#00c875" } } };

describe("formatMondayDate — the board's own short form, read by date parts", () => {
  it("drops this year, keeps another, and adds a time only when monday has one", () => {
    expect(formatMondayDate("2026-09-28", "2026-09-29")).toBe("Sep 28");
    expect(formatMondayDate("2025-12-01", "2026-09-29")).toBe("Dec 1, 2025");
    expect(formatMondayDate("2026-09-28 14:30", "2026-09-29")).toBe("Sep 28, 2:30 PM");
    expect(formatMondayDate("2026-09-28 00:05", "2026-09-29")).toBe("Sep 28, 12:05 AM");
    expect(formatMondayDate("2026-09-28 12:00", "2026-09-29")).toBe("Sep 28, 12:00 PM");
  });
  it("never shifts a day across a time zone (no new Date on a date-only value)", () => {
    expect(formatMondayDate("2026-01-01", "2026-09-29")).toBe("Jan 1");
  });
  it("gives back anything it can't read as monday wrote it", () => {
    expect(formatMondayDate("next week", "2026-09-29")).toBe("next week");
    expect(formatMondayDate(undefined, "2026-09-29")).toBe("");
  });
});

describe("formatPhone", () => {
  it("formats a US number with or without the leading 1; leaves anything else alone", () => {
    expect(formatPhone("15555550100")).toBe("(555) 555-0100");
    expect(formatPhone("5555550100")).toBe("(555) 555-0100");
    expect(formatPhone("+44 20 7946 0000")).toBe("+44 20 7946 0000");
  });
});

describe("status colours and batteries", () => {
  it("a status cell takes its label's own colour; blank or unknown is monday's grey", () => {
    expect(statusHex(LABELS, "color_x", { t: "No", i: 1 })).toBe("#00c875");
    expect(statusHex(LABELS, "color_x", undefined)).toBe(BLANK_STATUS_HEX);
    expect(statusHex(LABELS, "color_x", { t: "Gone", i: 9 })).toBe(BLANK_STATUS_HEX);
  });
  it("the battery counts each label, widest first, blanks last", () => {
    const items = [
      item("1", "A", { color_x: { t: "No", i: 1 } }),
      item("2", "B", { color_x: { t: "No", i: 1 } }),
      item("3", "C", { color_x: { t: "Yes", i: 0 } }),
      item("4", "D", {}),
    ];
    expect(batterySegments(LABELS, "color_x", items).map((s) => [s.label, s.count, s.hex])).toEqual([
      ["No", 2, "#00c875"],
      ["Yes", 1, "#df2f4a"],
      ["Blank", 1, BLANK_STATUS_HEX],
    ]);
  });
});

describe("search, empty columns, freshness, widths", () => {
  const items = [item("1", "Test Person", { text_x: { t: "Called twice" } }), item("2", "Other Person", {})];
  it("search matches the name or any cell's text, ignoring case", () => {
    expect(items.filter((i) => matchesSearch(i, "test")).map((i) => i.id)).toEqual(["1"]);
    expect(items.filter((i) => matchesSearch(i, "CALLED")).map((i) => i.id)).toEqual(["1"]);
    expect(items.filter((i) => matchesSearch(i, "  ")).length).toBe(2);
  });
  it("a column counts as having data when any item has a value in it", () => {
    expect([...columnsWithData(items)]).toEqual(["text_x"]);
  });
  it("freshness reads as minutes, then hours", () => {
    const now = Date.parse("2026-09-29T21:00:00Z");
    expect(relativeTime("2026-09-29T20:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-09-29T20:56:00Z", now)).toBe("4 min ago");
    expect(relativeTime("2026-09-29T18:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime(null, now)).toBe("never");
  });
  it("widths follow monday's rough defaults", () => {
    expect(columnWidth("status")).toBe(140);
    expect(columnWidth("text")).toBe(170);
  });
});
