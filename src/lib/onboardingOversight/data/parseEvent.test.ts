import { describe, it, expect } from "vitest";
import { parseEvent, ticksToMs, markBulk } from "./parseEvent";
import { ev } from "../__fixtures__/builders";

describe("event parsing (PE)", () => {
  it("PE-1 converts monday's 17-digit 100ns ticks to milliseconds exactly", () => {
    expect(ticksToMs("17592000000000000")).toBe(1759200000000);
  });
  it("PE-2 reads label indexes from value and previous_value", () => {
    const e = parseEvent("MN", { id: "1", event: "update_column_value", created_at: "17592000000000000", user_id: -4,
      data: JSON.stringify({ pulse_id: 9000000001, column_id: "color_mm1wyr92", value: { label: { index: 9 } }, previous_value: { label: { index: 8 } } }) });
    expect(e).toMatchObject({ itemId: "9000000001", toIndex: 9, fromIndex: 8, userId: -4 });
  });
  it("PE-3 returns null for a malformed data payload instead of throwing", () => {
    expect(parseEvent("MN", { id: "2", event: "update_column_value", created_at: "1", user_id: 1, data: "{not json" })).toBeNull();
  });
  it("PE-group takes the DESTINATION from dest_group.id and never from group_id (which is the source)", () => {
    const e = parseEvent("WC", { id: "3", event: "move_pulse_from_group", created_at: "17592000000000000", user_id: 1,
      data: JSON.stringify({ pulse_id: 5, group_id: "group_mm1xyczx", source_group: { id: "group_mm1xyczx" }, dest_group: { id: "group_mm1x5s5d" }, is_batch_action: false }) });
    expect(e).toMatchObject({ fromGroupId: "group_mm1xyczx", toGroupId: "group_mm1x5s5d", event: "move_pulse_from_group" });
  });
  it("PE-6 marks 10 identical changes by one user within 5 seconds as bulk", () => {
    const evs = Array.from({ length: 10 }, (_, i) => ev("INS", `90000002${i}`, "color_mm2vsh2f", 0, null, `2026-08-02T10:00:0${i % 5}-04:00`, { user: 75450505 }));
    expect(markBulk(evs).every((e) => e.bulk)).toBe(true);
  });
  it("PE-6c nine identical changes within 5 seconds are not bulk (they stay logged actions; BUILD-SPEC §0.2, red-team r16)", () => {
    const evs = Array.from({ length: 9 }, (_, i) => ev("INS", `90000004${i}`, "color_mm2vsh2f", 0, null, `2026-08-02T10:00:0${i % 5}-04:00`, { user: 75450505 }));
    expect(markBulk(evs).some((e) => e.bulk)).toBe(false);
  });
  it("PE-6b does NOT mark ten reps' identical moves spread over a minute as bulk", () => {
    const evs = Array.from({ length: 10 }, (_, i) => ev("MN", `90000003${i}`, "color_mm1wyr92", 8, 9, `2026-08-02T10:00:${String(i * 6).padStart(2, "0")}-04:00`));
    expect(markBulk(evs).some((e) => e.bulk)).toBe(false);
  });
});
