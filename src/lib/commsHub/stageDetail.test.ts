import { describe, it, expect } from "vitest";
import { STAGE_DETAIL, buildStageDetail, hasStageDetail, stageDetailColumns } from "./stageDetail";
import { PIPELINE_ORDER } from "./pipelineOrder";

const SUBSCRIPTION = 18407459988;
const WELCOME_CALL = 18410804557;
const DTC_INTAKE = 18392794310;

describe("stageDetailColumns", () => {
  it("names every column its sections read, deduped", () => {
    const cols = stageDetailColumns(SUBSCRIPTION);
    const all = STAGE_DETAIL[SUBSCRIPTION].flatMap((s) => s.fields.map((f) => f.col));
    expect(new Set(cols)).toEqual(new Set(all));
    expect(cols.length).toBe(new Set(cols).size);
  });

  it("returns nothing for a board with no detail mapped", () => {
    expect(stageDetailColumns(DTC_INTAKE)).toEqual([]);
    expect(hasStageDetail(DTC_INTAKE)).toBe(false);
  });
});

describe("the maps themselves", () => {
  it("covers every stage a rep actually calls from", () => {
    // DTC Intake is read-only top-of-funnel (§3); everything downstream of it
    // is a stage somebody rings a patient or an office about.
    const mapped = PIPELINE_ORDER.filter((b) => hasStageDetail(b.boardId)).map((b) => b.short);
    expect(mapped).toEqual(["Profile", "MN", "Insurance", "Welcome Call", "Subscription"]);
  });

  it("uses column IDs, never titles — ids are the contract", () => {
    for (const sections of Object.values(STAGE_DETAIL)) {
      for (const f of sections.flatMap((s) => s.fields)) {
        expect(f.col).toMatch(/^[a-z_]+_[a-z0-9]+$/);
      }
    }
  });

  it("never repeats a column inside one board", () => {
    for (const [boardId, sections] of Object.entries(STAGE_DETAIL)) {
      const cols = sections.flatMap((s) => s.fields.map((f) => f.col));
      expect(new Set(cols).size, `board ${boardId} repeats a column`).toBe(cols.length);
    }
  });
});

describe("buildStageDetail", () => {
  it("renders only the fields that have a value", () => {
    const out = buildStageDetail(SUBSCRIPTION, {
      color_mm2t7tdy: "Active",
      date_mkp0nvf1: "2026-09-20",
    });
    const fields = out.flatMap((s) => s.fields);
    expect(fields.map((f) => f.label)).toEqual(["Status", "Next order"]);
    expect(fields.every((f) => f.value)).toBe(true);
  });

  it("drops a section once every field in it is empty", () => {
    // A pane full of em-dashes is what makes a rep slow, so an empty section
    // is removed rather than rendered blank.
    const out = buildStageDetail(SUBSCRIPTION, { color_mm2t7tdy: "Active" });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Next order");
  });

  it("treats whitespace as empty", () => {
    expect(buildStageDetail(SUBSCRIPTION, { color_mm2t7tdy: "   " })).toEqual([]);
  });

  it("returns nothing for an unmapped board or missing values", () => {
    expect(buildStageDetail(DTC_INTAKE, { anything: "x" })).toEqual([]);
    expect(buildStageDetail(SUBSCRIPTION, undefined)).toEqual([]);
  });

  it("keeps the author's section and field order", () => {
    const out = buildStageDetail(WELCOME_CALL, {
      text_mm1xdzxw: "$250",
      color_mm1w1cm9: "Insulin Pump + CGM",
      location_mm1xhw17: "9 Brentwood Rd, Bay Shore, NY 11706",
    });
    expect(out.map((s) => s.title)).toEqual(["The order", "What it costs them", "Ship to / doctor"]);
  });

  it("carries the lead flag through, so the pane can weight what matters", () => {
    const out = buildStageDetail(WELCOME_CALL, { text_mm1xdzxw: "$250" });
    expect(out[0].fields[0].lead).toBe(true);
  });
});
