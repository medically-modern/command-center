import { describe, it, expect } from "vitest";
import { parseSettings, HIDDEN_LABELS } from "./boardLabels";

/** Shaped like a real Monday status column's settings_str. */
const settings = (labels: Record<string, string>, pos?: Record<string, number>) =>
  JSON.stringify({ labels, ...(pos ? { labels_positions_v2: pos } : {}) });

describe("parseSettings", () => {
  it("builds label → index from the board", () => {
    const r = parseSettings(settings({ "0": "iLet", "1": "Mobi", "2": "t:slim" }));
    expect(r?.index).toEqual({ iLet: 0, Mobi: 1, "t:slim": 2 });
  });

  it("orders options by labels_positions_v2, not by index", () => {
    // Index order and display order are different things; the picker must use
    // the board's display order.
    const r = parseSettings(
      settings({ "0": "iLet", "1": "Mobi", "4": "Minimed 780G" }, { "0": 2, "1": 0, "4": 1 }),
    );
    expect(r?.options).toEqual(["Mobi", "Minimed 780G", "iLet"]);
  });

  it("falls back to index order when positions are absent", () => {
    const r = parseSettings(settings({ "4": "Minimed 780G", "0": "iLet", "1": "Mobi" }));
    expect(r?.options).toEqual(["iLet", "Mobi", "Minimed 780G"]);
  });

  it("hides 'Not Serving' from the picker but KEEPS it writable", () => {
    // The whole §5.2 trap: filtering it out of the write map would stop the
    // cross-sell derivation being able to write it.
    const r = parseSettings(settings({ "0": "Insulin", "1": "Hypoglycemia", "2": "Not Serving" }));
    expect(r?.options).toEqual(["Insulin", "Hypoglycemia"]);
    expect(r?.index["Not Serving"]).toBe(2);
    expect(HIDDEN_LABELS).toContain("Not Serving");
  });

  it("drops empty label slots Monday leaves behind", () => {
    const r = parseSettings(settings({ "0": "Insulin", "1": "", "2": "Hypoglycemia", "3": "   " }));
    expect(r?.options).toEqual(["Insulin", "Hypoglycemia"]);
    expect(Object.keys(r?.index ?? {})).toEqual(["Insulin", "Hypoglycemia"]);
  });

  it("returns null on anything unusable, so the caller falls back", () => {
    expect(parseSettings(null)).toBeNull();
    expect(parseSettings("")).toBeNull();
    expect(parseSettings("not json")).toBeNull();
    expect(parseSettings(settings({}))).toBeNull();
    expect(parseSettings(settings({ "0": "", "1": "  " }))).toBeNull();
  });
});
