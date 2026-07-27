import { describe, it, expect } from "vitest";
import { extractColumns, coerceColumnValue } from "./columns.mjs";

/**
 * The mutation strings below are copied verbatim from the shapes the SPA
 * actually sends (src/lib/profile/mondayApi.ts and its per-role siblings).
 * If a helper's mutation changes, these tests are what catches the audit log
 * silently going blind again.
 */

const CHANGE_COLUMN_VALUE = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;

const CHANGE_SIMPLE_NAME = `
    mutation ($boardId: ID!, $itemId: ID!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id }
    }
  `;

const CHANGE_MULTIPLE = `
      mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
      }
    `;

describe("coerceColumnValue", () => {
  it("decodes JSON-encoded strings and objects, keeps raw text as-is", () => {
    expect(coerceColumnValue('"LINDSAY GAETANI"')).toBe("LINDSAY GAETANI");
    expect(coerceColumnValue('{"index":3}')).toEqual({ index: 3 });
    expect(coerceColumnValue("Catherine Raska")).toBe("Catherine Raska");
  });

  it("never throws on odd input", () => {
    expect(coerceColumnValue(null)).toBeNull();
    expect(coerceColumnValue(undefined)).toBeNull();
    expect(coerceColumnValue("{not json")).toBe("{not json");
    expect(coerceColumnValue(42)).toBe(42);
  });
});

describe("extractColumns — variable-based writes (the regression)", () => {
  it("captures writeText, the helper that writes Member ID 1", () => {
    // This is the exact call that logged columns=NULL on 2026-07-24.
    expect(
      extractColumns(CHANGE_COLUMN_VALUE, {
        boardId: 18406352652,
        itemId: "12624053600",
        columnId: "text_mm1x2qk2",
        value: JSON.stringify("LINDSAY GAETANI"),
      }),
    ).toEqual({ text_mm1x2qk2: "LINDSAY GAETANI" });
  });

  it("captures the correct value it replaced, too", () => {
    expect(
      extractColumns(CHANGE_COLUMN_VALUE, {
        columnId: "text_mm4t8gbq",
        value: JSON.stringify("743735619"),
      }),
    ).toEqual({ text_mm4t8gbq: "743735619" });
  });

  it("captures writeStatusIndex", () => {
    expect(
      extractColumns(CHANGE_COLUMN_VALUE, {
        columnId: "color_mm24ap4j",
        value: JSON.stringify({ index: 3 }),
      }),
    ).toEqual({ color_mm24ap4j: { index: 3 } });
  });

  it("captures writeDate / writePhone / writeLocation object values", () => {
    expect(
      extractColumns(CHANGE_COLUMN_VALUE, {
        columnId: "date_mm1wf43j",
        value: JSON.stringify({ date: "2026-07-24" }),
      }),
    ).toEqual({ date_mm1wf43j: { date: "2026-07-24" } });

    expect(
      extractColumns(CHANGE_COLUMN_VALUE, {
        columnId: "phone_mm1xz8c0",
        value: JSON.stringify({ phone: "5184713636", countryShortName: "US" }),
      }),
    ).toEqual({ phone_mm1xz8c0: { phone: "5184713636", countryShortName: "US" } });
  });

  it("captures the item name, which previously logged {name: null}", () => {
    expect(extractColumns(CHANGE_SIMPLE_NAME, { value: "Catherine Raska" })).toEqual({
      name: "Catherine Raska",
    });
  });

  it("captures bulk change_multiple_column_values via variables", () => {
    expect(
      extractColumns(CHANGE_MULTIPLE, {
        columnValues: JSON.stringify({
          text_mm1x2qk2: "743735619",
          color_mm24ap4j: { label: "Fidelis" },
        }),
      }),
    ).toEqual({ text_mm1x2qk2: "743735619", color_mm24ap4j: { label: "Fidelis" } });
  });
});

describe("extractColumns — inline writes keep working", () => {
  it("still captures writeDropdownLabels (inline, create_labels_if_missing)", () => {
    const q = `
    mutation {
      change_column_value(
        board_id: 18406352652,
        item_id: 12624053600,
        column_id: "dropdown_mm1y2x75",
        value: ${JSON.stringify(JSON.stringify({ labels: ["Essential Plan 1"] }))},
        create_labels_if_missing: true
      ) { id }
    }
  `;
    expect(extractColumns(q, {})).toEqual({
      dropdown_mm1y2x75: { labels: ["Essential Plan 1"] },
    });
  });

  it("still captures inline change_multiple_column_values", () => {
    const payload = JSON.stringify({ text_mm2nfwjs: "[Auto] Columns dropped: x" });
    const q = `mutation { change_multiple_column_values(board_id: 1, item_id: 2, column_values: ${JSON.stringify(payload)}) { id } }`;
    expect(extractColumns(q, {})).toEqual({ text_mm2nfwjs: "[Auto] Columns dropped: x" });
  });
});

describe("extractColumns — must never throw or invent data", () => {
  it("returns null for reads and column-less mutations", () => {
    expect(extractColumns(`query { boards(ids: [1]) { name } }`, {})).toBeNull();
    expect(extractColumns(`mutation { move_item_to_group(item_id: 1, group_id: "g") { id } }`, {})).toBeNull();
  });

  it("does not mistake the $value declaration or column_values for a value", () => {
    // `$value: JSON!` in the signature and the substring inside
    // `column_values:` must not be picked up as the written value.
    const got = extractColumns(CHANGE_COLUMN_VALUE, { columnId: "text_x", value: '"ok"' });
    expect(got).toEqual({ text_x: "ok" });
  });

  it("records the column with a null value when the variable is missing", () => {
    expect(extractColumns(CHANGE_COLUMN_VALUE, { columnId: "text_x" })).toEqual({ text_x: null });
  });

  it("survives junk input of every shape", () => {
    expect(extractColumns(null, null)).toBeNull();
    expect(extractColumns(undefined, undefined)).toBeNull();
    // Non-object vars: nothing resolves, so nothing is claimed.
    expect(extractColumns(CHANGE_COLUMN_VALUE, "not-an-object")).toBeNull();
    expect(extractColumns(CHANGE_MULTIPLE, { columnValues: "{broken json" })).toBeNull();
    expect(extractColumns(CHANGE_MULTIPLE, { columnValues: JSON.stringify([1, 2]) })).toBeNull();
  });
});
