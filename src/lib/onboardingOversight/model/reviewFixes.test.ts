/** Regression tests for prototype review pass 1 (architect, red-team). */
import { describe, it, expect } from "vitest";
import { buildItemSpans } from "./holders";
import { ev, item, move } from "../__fixtures__/builders";
import { OO_CONFIG as C } from "../config";
import { parseEvent } from "../data/parseEvent";

const NOW = Date.parse("2026-10-01T14:00:00-04:00");
const WC = C.stageColumn.WC, MN = C.stageColumn.MN, ESC = C.escalationColumn.MN;

describe("prototype review fixes", () => {
  it("HS-13 a first logged move OUT of Stuck keeps earlier queue history and makes the Stuck span synthetic from the move window", () => {
    const it0 = item("WC", "9000000201", "2026-07-01T10:00:00-04:00", { group: "group_mm1wvq8p", values: { [WC]: 7 } });
    const evs = [ev("WC", "9000000201", WC, null, 7, "2026-07-01T10:00:00-04:00"), move("WC", "9000000201", "group_mm1xyczx", "group_mm1wvq8p", "2026-09-21T10:00:00-04:00")];
    const spans = buildItemSpans("WC", it0, evs, NOW).spans;
    expect(spans[0].kind).toBe("QUEUE");
    const stuck = spans.find((s) => s.kind === "STUCK")!;
    expect(stuck.synthetic).toBe(true);
    expect(stuck.startMs).toBe(NOW - C.groupMoves.lookbackDays * 86400000);
  });
  it("ES-lag a label clear followed by the group move 3 s later is one return, not a hand-down plus a resolve", () => {
    const it0 = item("MN", "9000000202", "2026-09-01T10:00:00-04:00", { values: { [MN]: 11, [ESC]: 1 } });
    const evs = [ev("MN", "9000000202", MN, null, 11, "2026-09-01T10:00:00-04:00"), ev("MN", "9000000202", ESC, null, 2, "2026-09-02T10:00:00-04:00"),
      move("MN", "9000000202", "group_mm1xf2jb", "group_mm33pdpm", "2026-09-02T10:00:03-04:00"),
      ev("MN", "9000000202", ESC, 2, 1, "2026-09-05T10:00:00-04:00"), move("MN", "9000000202", "group_mm33pdpm", "group_mm1xf2jb", "2026-09-05T10:00:03-04:00")];
    expect(buildItemSpans("MN", it0, evs, NOW).spans.map((s) => s.kind)).toEqual(["QUEUE", "FINAL", "QUEUE"]);
  });
  it("R-1 an item with no stage history has an unknown (synthetic) start, so it cannot show a known long age", () => {
    const it0 = item("WC", "9000000203", "2026-05-01T10:00:00-04:00", { values: { [WC]: 2 } });
    const sp = buildItemSpans("WC", it0, [], NOW).spans;
    expect(sp[0]).toMatchObject({ kind: "STUCK", synthetic: true });
  });
  it("R-2 resolves a text-only stage label through config.labelText", () => {
    const e = parseEvent("MN", { id: "x", event: "update_column_value", created_at: "17592000000000000", user_id: "100161122",
      data: JSON.stringify({ pulse_id: 1, column_id: MN, value: { label: { text: "Send Request" } }, previous_value: null }) });
    expect(e?.toIndex).toBe(9); expect(e?.userId).toBe(100161122);
  });
});
