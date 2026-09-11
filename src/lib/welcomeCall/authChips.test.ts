import { describe, it, expect } from "vitest";
import { authChipState, servedAuthKeys, summariseAuths, shortDate, type AuthProduct } from "./authChips";

const p = (over: Partial<AuthProduct>): AuthProduct => ({
  key: "cgm", label: "CGM", result: "Auth Valid", end: "2026-12-31", authId: "", start: "", units: "", ...over,
});

describe("servedAuthKeys", () => {
  /* ⚠️ Brandon's own example, and this assertion used to pin THREE while its
     own name said two. The pump DEVICE is gated on `servingSellsPumpDevice`;
     `servingIncludesPump` is true for "Supplies" and decides the SUPPLIES
     lines only. A patient who owns their pump has no device auth to get, and
     a blank or Denied device result was claiming the order couldn't ship. */
  it("shows two chips for a supplies-only patient, not five", () => {
    expect(servedAuthKeys("Supplies")).toEqual(["infusionSet", "cartridge"]);
    expect(servedAuthKeys("Supplies + CGM")).toEqual(["cgm", "sensors", "infusionSet", "cartridge"]);
    expect(servedAuthKeys("CGM")).toEqual(["cgm", "sensors"]);
  });

  it("includes the pump device only when one is being sold", () => {
    expect(servedAuthKeys("Insulin Pump")).toContain("pump");
    expect(servedAuthKeys("Supplies")).not.toContain("pump");
  });
  it("shows everything for a full serving", () => {
    expect(servedAuthKeys("Insulin Pump + CGM")).toHaveLength(5);
  });
});

describe("authChipState", () => {
  it("maps the live board labels the way Brandon spelled them", () => {
    expect(authChipState("Auth Valid", "2026-12-31")).toEqual({ tone: "green", state: "thru 12/31/26" });
    expect(authChipState("No Auth Needed", "")).toEqual({ tone: "grey", state: "not required" });
    expect(authChipState("Submitted", "")).toEqual({ tone: "amber", state: "pending" });
    expect(authChipState("Denied", "")).toEqual({ tone: "red", state: "denied" });
    expect(authChipState("Required", "")).toEqual({ tone: "amber", state: "not started" });
    expect(authChipState("Evaluate", "")).toEqual({ tone: "amber", state: "not started" });
  });

  /* ⚠️ The safe direction. A label we have no rule for is an unknown, and a
     wrong green on an authorisation reads as "cleared to ship". */
  it("never reads an unrecognised result as green", () => {
    expect(authChipState("Something New", "").tone).toBe("amber");
    expect(authChipState("", "").tone).toBe("amber");
  });

  it("says 'valid' rather than a broken date when Auth End is blank", () => {
    expect(authChipState("Auth Valid", "")).toEqual({ tone: "green", state: "valid" });
  });
});

describe("shortDate", () => {
  it("formats by string surgery, never a Date", () => {
    // A Date would reinterpret the board's naive-ET value in the viewer's zone.
    expect(shortDate("2026-12-31")).toBe("12/31/26");
    expect(shortDate("2026-01-05")).toBe("1/5/26");
    expect(shortDate("")).toBe("");
  });
});

describe("summariseAuths", () => {
  it("collapses to one sentence when everything is clear", () => {
    const s = summariseAuths([p({}), p({ key: "sensors", label: "Sensors" })]);
    expect(s.allClear).toBe(true);
    expect(s.sentence).toBe("Auths clear — cgm & sensors valid through 12/31/26.");
    expect(s.banner).toBe("");
  });

  it("counts grey as clear", () => {
    const s = summariseAuths([p({ result: "No Auth Needed", end: "" })]);
    expect(s.allClear).toBe(true);
  });

  /* "Exceptions sort first so the problem is the first thing the eye hits." */
  it("sorts exceptions first, worst first", () => {
    const s = summariseAuths([
      p({}),
      p({ key: "sensors", label: "Sensors", result: "Submitted", end: "" }),
      p({ key: "pump", label: "Insulin Pump", result: "Denied", end: "" }),
    ]);
    expect(s.allClear).toBe(false);
    expect(s.chips.map((c) => c.label)).toEqual(["Insulin Pump", "Sensors", "CGM"]);
    expect(s.banner).toContain("Insulin Pump auth denied");
  });

  it("says nothing at all when nothing is served", () => {
    expect(summariseAuths([]).chips).toEqual([]);
  });
});
