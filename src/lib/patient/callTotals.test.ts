/**
 * The patient screen's "We called · They called" — merged per patient from the
 * per-number answers of the route the Care Coordinator cards read. Each rule
 * here is one whose failure is silent on screen.
 */
import { describe, expect, it } from "vitest";
import type { ContactTotals } from "@/lib/assignedPatients/messagingApi";
import { callTotalsKey, formatSinceDate, patientCallTotals } from "./callTotals";

const t = (over: Partial<ContactTotals> = {}): ContactTotals => ({
  callsOut: 0,
  callsIn: 0,
  textsOut: 0,
  textsIn: 0,
  reachedByCall: false,
  ...over,
});
const map = (entries: Record<string, ContactTotals>) => new Map(Object.entries(entries));

const P = "(555) 555-0100";
const A = "5555550199";

describe("patientCallTotals", () => {
  it("adds the two numbers and says how many were with the alternate", () => {
    const s = patientCallTotals(
      map({
        "5555550100": t({ callsOut: 10, callsIn: 4, reachedByCall: true }),
        "5555550199": t({ callsOut: 2, callsIn: 1 }),
      }),
      P,
      A,
      true,
    );
    expect(s).toEqual({
      kind: "ready",
      totals: { weCalled: 12, theyCalled: 5, total: 17, reached: true, altTotal: 3 },
    });
  });

  it("⚠️ ALL OR NOTHING — no total from one of the two numbers", () => {
    const s = patientCallTotals(map({ "5555550100": t({ callsOut: 10 }) }), P, A, true);
    expect(s).toEqual({ kind: "waiting" });
  });

  it("⚠️ a null count is the archive being OFF — never drawn as zero", () => {
    const s = patientCallTotals(map({ "5555550100": t({ callsOut: null, callsIn: null }) }), P, "", true);
    expect(s).toEqual({ kind: "off" });
  });

  it("zero calls is a real answer once the number has answered", () => {
    const s = patientCallTotals(map({ "5555550100": t() }), P, "", true);
    expect(s).toMatchObject({ kind: "ready", totals: { total: 0, weCalled: 0, theyCalled: 0 } });
  });

  it("the same number twice, or reformatted, is one number", () => {
    const s = patientCallTotals(map({ "5555550100": t({ callsIn: 2 }) }), P, "+1 555-555-0100", true);
    expect(s).toMatchObject({ kind: "ready", totals: { total: 2, altTotal: 0 } });
  });

  it("nothing to ask: no gateway, or no usable number", () => {
    expect(patientCallTotals(map({}), P, A, false)).toEqual({ kind: "none" });
    expect(patientCallTotals(map({}), "555-0100", "", true)).toEqual({ kind: "none" });
    expect(patientCallTotals(map({}), "", A, true)).toEqual({ kind: "none" });
  });

  it("picked up is ANY of the numbers' outbound calls connecting", () => {
    const s = patientCallTotals(
      map({ "5555550100": t({ callsOut: 3 }), "5555550199": t({ callsOut: 1, reachedByCall: true }) }),
      P,
      A,
      true,
    );
    expect(s.kind === "ready" && s.totals.reached).toBe(true);
  });
});

describe("keys and dates", () => {
  it("keys a number on its last ten digits and refuses a short one", () => {
    expect(callTotalsKey("+1 (555) 555-0100")).toBe("5555550100");
    expect(callTotalsKey("555-0100")).toBe("");
  });

  it("⚠️ the since-date is EASTERN — an evening timestamp is not moved a day (§5.15)", () => {
    expect(formatSinceDate("2026-06-19T01:30:00.000Z")).toBe("Jun 18, 2026");
    expect(formatSinceDate(null)).toBe("");
    expect(formatSinceDate("nope")).toBe("");
  });
});
