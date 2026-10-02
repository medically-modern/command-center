import { describe, it, expect } from "vitest";
import { buildItemSpans } from "./holders";
import { ev, item, move } from "../__fixtures__/builders";
import { OO_CONFIG as C } from "../config";

const NOW = Date.parse("2026-10-01T14:00:00-04:00");
const MN = C.stageColumn.MN, ESC = C.escalationColumn.MN, INS = C.stageColumn.INS, ESC_INS = C.escalationColumn.INS;

describe("holder states (HS/TL/CR)", () => {
  it("HS-1 treats an exited MN item with Manager Escalation as EXITED (a stale flag), not parked", () => {
    const it0 = item("MN", "9000000001", "2026-09-01T10:00:00-04:00", { group: "group_mm1x5q4e", values: { [MN]: 14, [ESC]: 0 } });
    const r = buildItemSpans("MN", it0, [ev("MN", "9000000001", MN, null, 8, "2026-09-01T10:00:00-04:00"), ev("MN", "9000000001", ESC, null, 0, "2026-09-02T10:00:00-04:00"), ev("MN", "9000000001", MN, 8, 14, "2026-09-03T10:00:00-04:00")], NOW);
    expect(r.spans[r.spans.length - 1].kind).toBe("EXITED");
  });
  it("TL-2 applies stage before escalation at the same instant, so approve goes FINAL -> STUCK", () => {
    const it0 = item("MN", "9000000002", "2026-09-01T10:00:00-04:00", { values: { [MN]: 15, [ESC]: 1 } });
    const evs = [ev("MN", "9000000002", MN, null, 11, "2026-09-01T10:00:00-04:00"), ev("MN", "9000000002", ESC, null, 2, "2026-09-02T10:00:00-04:00"),
      ev("MN", "9000000002", ESC, 2, 1, "2026-09-05T10:00:00-04:00"), ev("MN", "9000000002", MN, 11, 15, "2026-09-05T10:00:00-04:00")];
    expect(buildItemSpans("MN", it0, evs, NOW).spans.map((s) => s.kind)).toEqual(["QUEUE", "FINAL", "STUCK"]);
  });
  it("TL-3 creates a synthetic MGR span when escalation is set now but never logged", () => {
    const it0 = item("INS", "9000000003", "2026-09-01T10:00:00-04:00", { values: { [INS]: 3, [ESC_INS]: 0 } });
    const r = buildItemSpans("INS", it0, [ev("INS", "9000000003", INS, null, 3, "2026-09-01T10:00:00-04:00")], NOW);
    const last = r.spans[r.spans.length - 1];
    expect(last.kind).toBe("MGR"); expect(last.synthetic).toBe(true); expect(r.historyMismatch).toBe(true);
  });
  it("CR-1/CR-2 split chase by CC's predicate: Fax or blank -> 1.1.2.4F, Parachute/Email/Dashboard -> 1.1.2.4P", () => {
    for (const [m, code] of [[0, "1.1.2.4F"], [null, "1.1.2.4F"], [1, "1.1.2.4P"], [2, "1.1.2.4P"], [3, "1.1.2.4P"]] as const) {
      const it0 = item("MN", "9000000004", "2026-09-01T10:00:00-04:00", { values: { [MN]: 11, [C.clinicalsMethodColumn]: m } });
      expect(buildItemSpans("MN", it0, [ev("MN", "9000000004", MN, null, 11, "2026-09-01T10:00:00-04:00")], NOW).spans[0].code).toBe(code);
    }
  });
  it("CR-3 splits INS Benefits/SoS at the DME Benefits? event into 1.1.3.1 then 1.1.3.2", () => {
    const it0 = item("INS", "9000000005", "2026-09-01T10:00:00-04:00", { values: { [INS]: 4 } });
    const evs = [ev("INS", "9000000005", INS, null, 3, "2026-09-01T10:00:00-04:00"), ev("INS", "9000000005", C.insBenefitsMarkerColumn, null, 1, "2026-09-01T12:00:00-04:00"), ev("INS", "9000000005", INS, 3, 4, "2026-09-01T15:00:00-04:00")];
    expect(buildItemSpans("INS", it0, evs, NOW).spans.map((s) => s.code)).toEqual(["1.1.3.1", "1.1.3.2", "1.1.3.3"]);
  });
  it("CR-5 maps re-submission after a denial to Auth Remediation (1.1.3.6)", () => {
    const it0 = item("INS", "9000000006", "2026-09-01T10:00:00-04:00", { group: "group_mm2vw3c0", values: { [INS]: 7 } });
    const evs = [ev("INS", "9000000006", INS, null, 6, "2026-09-01T10:00:00-04:00"), ev("INS", "9000000006", INS, 6, 0, "2026-09-03T10:00:00-04:00"),
      ev("INS", "9000000006", INS, 0, 4, "2026-09-04T10:00:00-04:00"), ev("INS", "9000000006", INS, 4, 6, "2026-09-04T12:00:00-04:00"), ev("INS", "9000000006", INS, 6, 7, "2026-09-08T10:00:00-04:00")];
    expect(buildItemSpans("INS", it0, evs, NOW).spans.map((s) => s.code ?? s.kind)).toEqual(["1.1.3.4", "1.1.3.5", "1.1.3.6", "EXITED"]);
  });
  it("HS-5 uses a group-move event (destination = Stuck group) as the start of a group-only STUCK span", () => {
    const it0 = item("WC", "9000000007", "2026-09-01T10:00:00-04:00", { group: "group_mm1xyczx", values: { [C.stageColumn.WC]: 7 } });
    const evs = [ev("WC", "9000000007", C.stageColumn.WC, null, 7, "2026-09-01T10:00:00-04:00"), move("WC", "9000000007", "group_mm1wvq8p", "group_mm1xyczx", "2026-09-10T10:00:00-04:00")];
    const last = buildItemSpans("WC", it0, evs, NOW).spans.at(-1)!;
    expect(last).toMatchObject({ kind: "STUCK", byGroup: true, synthetic: false, startMs: Date.parse("2026-09-10T10:00:00-04:00") });
  });
  it("HS-9 merges an accidental 1-minute flip between two identical queue spans", () => {
    const it0 = item("MN", "9000000008", "2026-09-01T10:00:00-04:00", { values: { [MN]: 11, [ESC]: 1 } });
    const evs = [ev("MN", "9000000008", MN, null, 11, "2026-09-01T10:00:00-04:00"), ev("MN", "9000000008", ESC, null, 0, "2026-09-02T10:00:00-04:00"), ev("MN", "9000000008", ESC, 0, 1, "2026-09-02T10:01:00-04:00")];
    expect(buildItemSpans("MN", it0, evs, NOW).spans).toHaveLength(1);
  });
});
