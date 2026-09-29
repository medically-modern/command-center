import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PSEUDO,
  diffItems,
  hashValues,
  idsPageQuery,
  incrementalSince,
  itemsByIdQuery,
  itemsPageQuery,
  labelsOf,
  normalizeItem,
  pageOf,
  parseCellValue,
  parseSettings,
  reconcileDue,
  reconcilePlan,
  shapeQuery,
  takeCreatedSince,
  takeUpdatedSince,
} from "./mirrorRules.mjs";

/* Shapes copied from the live board's answers on 2026-09-29 — values are synthetic. */
const RAW = {
  id: "13000000001",
  name: "Test Patient",
  created_at: "2026-09-28T18:25:06Z",
  updated_at: "2026-09-28T18:26:55Z",
  group: { id: "group_mm64b83h" },
  column_values: [
    { id: "color_mm2xe7r8", type: "status", text: "Yes", value: '{"index":0,"changed_at":"2026-09-28T18:25:18.934Z"}' },
    { id: "date_mm1wf43j", type: "date", text: "2026-09-28", value: '{"date":"2026-09-28"}' },
    { id: "phone_mm1x44yk", type: "phone", text: "15555550100", value: '{"phone":"15555550100","countryShortName":"US"}' },
    { id: "location_mm1xhw17", type: "location", text: "1 Main St, Brooklyn, NY 11204", value: '{"lat":"40.5","lng":"-73.9","address":"1 Main St, Brooklyn, NY 11204"}' },
    { id: "numeric_mm5ze82q", type: "numbers", text: "", value: null },
    { id: "text_mm389fs", type: "text", text: "", value: null },
    { id: "dropdown_mm594743", type: "dropdown", text: null, value: null },
  ],
};

describe("queries — every document is a query, and the shapes monday answered on 2026-09-29", () => {
  it("first page vs next page use the two item-page shapes", () => {
    const first = itemsPageQuery(18406352652, { limit: 50 });
    expect(first.query).toContain("items_page(limit: $limit)");
    expect(first.variables).toEqual({ boardId: "18406352652", limit: 50 });
    const next = itemsPageQuery(18406352652, { limit: 50, cursor: "abc" });
    expect(next.query).toContain("next_items_page(cursor: $cursor, limit: $limit)");
    expect(next.variables).toEqual({ cursor: "abc", limit: 50 });
  });

  it("the incremental page is ordered newest-updated first (measured: the order_by monday honours)", () => {
    const q = itemsPageQuery(1, { orderByUpdated: true });
    expect(q.query).toContain('order_by: [{ column_id: "__last_updated__", direction: desc }]');
  });

  it("the reconcile scan asks for ids, group and updated_at only", () => {
    expect(idsPageQuery(1).query).toContain("items { id created_at updated_at group { id } }");
    expect(idsPageQuery(1).query).not.toContain("column_values");
  });

  it("by-id reads carry ids as strings", () => {
    expect(itemsByIdQuery([1, 2]).variables).toEqual({ ids: ["1", "2"] });
  });

  it("every document asks monday for its complexity so the loop can pace itself", () => {
    for (const q of [shapeQuery(1), itemsPageQuery(1), itemsPageQuery(1, { cursor: "c" }), idsPageQuery(1), itemsByIdQuery([1])]) {
      expect(q.query).toContain("complexity { query after }");
      expect(q.query.trim().startsWith("query")).toBe(true);
    }
  });

  it("pageOf reads both page shapes", () => {
    expect(pageOf({ boards: [{ items_page: { cursor: "x", items: [1] } }] })).toEqual({ items: [1], cursor: "x" });
    expect(pageOf({ next_items_page: { cursor: null, items: [] } })).toEqual({ items: [], cursor: null });
    expect(pageOf({})).toEqual({ items: [], cursor: null });
  });
});

describe("normalizeItem", () => {
  it("parses each cell's value and keeps its text; blank is null, not ''", () => {
    const row = normalizeItem(RAW, 18406352652);
    expect(row.item_id).toBe(13000000001);
    expect(row.group_id).toBe("group_mm64b83h");
    expect(row.column_values.color_mm2xe7r8).toEqual({ text: "Yes", value: { index: 0, changed_at: "2026-09-28T18:25:18.934Z" } });
    expect(row.column_values.phone_mm1x44yk.value.phone).toBe("15555550100");
    expect(row.column_values.numeric_mm5ze82q).toEqual({ text: "", value: null });
    expect(row.column_values.dropdown_mm594743).toEqual({ text: null, value: null });
    expect(row.values_hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("the hash is stable across column order and changes with any cell", () => {
    const a = normalizeItem(RAW, 1);
    const b = normalizeItem({ ...RAW, column_values: [...RAW.column_values].reverse() }, 1);
    expect(a.values_hash).toBe(b.values_hash);
    const c = normalizeItem({ ...RAW, column_values: RAW.column_values.map((cv) => (cv.id === "text_mm389fs" ? { ...cv, text: "note" } : cv)) }, 1);
    expect(c.values_hash).not.toBe(a.values_hash);
    expect(hashValues("x", "g", {})).not.toBe(hashValues("x", "h", {}));
  });

  it("parseCellValue tolerates monday's non-JSON oddities", () => {
    expect(parseCellValue(null)).toBeNull();
    expect(parseCellValue("")).toBeNull();
    expect(parseCellValue("not json")).toBeNull();
    expect(parseCellValue('"a bare string"')).toBe("a bare string");
  });
});

describe("diffItems — one change per differing column, plus name / group / state", () => {
  const prev = { ...normalizeItem(RAW, 1), state: "active" };

  it("no changes for the same item; none at all for a new item", () => {
    expect(diffItems(prev, { ...prev })).toEqual([]);
    expect(diffItems(null, prev)).toEqual([]);
  });

  it("a status flip, a group move and a rename are three changes", () => {
    const next = normalizeItem({ ...RAW, name: "Renamed", group: { id: "group_mm1xf2jb" }, column_values: RAW.column_values.map((cv) => (cv.id === "color_mm2xe7r8" ? { ...cv, text: "No", value: '{"index":1}' } : cv)) }, 1);
    const changes = diffItems(prev, { ...next, state: "active" });
    expect(changes.map((c) => c.column_id)).toEqual([PSEUDO.name, PSEUDO.group, "color_mm2xe7r8"]);
    expect(changes[2]).toMatchObject({ old_text: "Yes", new_text: "No", new_value: { index: 1 } });
  });

  it("a column the mirror never saw counts as a change from blank; a missing→active item records the state", () => {
    const next = normalizeItem({ ...RAW, column_values: [...RAW.column_values, { id: "text_new", type: "text", text: "x", value: '"x"' }] }, 1);
    expect(diffItems(prev, { ...next, state: "active" }).map((c) => c.column_id)).toEqual(["text_new"]);
    expect(diffItems({ ...prev, state: "missing" }, { ...prev, state: "active" })).toEqual([{ column_id: PSEUDO.state, old_text: "missing", new_text: "active", old_value: null, new_value: null }]);
  });
});

describe("labels", () => {
  it("reads the MCP snapshot's array shape and the API's object shape", () => {
    expect(labelsOf({ settings: { labels: [{ id: 0, label: "Yes", hex: "#df2f4a" }, { id: 1, label: "No" }] } })).toEqual([
      { label_id: 0, label: "Yes", hex: "#df2f4a", is_done: null, is_deactivated: null },
      { label_id: 1, label: "No", hex: null, is_done: null, is_deactivated: null },
    ]);
    const api = labelsOf({ settings_str: '{"done_colors":[1],"labels":{"0":"Yes","1":"No","7":"Info Collection"},"labels_colors":{"0":{"color":"#df2f4a","border":"#ce3048","var_name":"red-shadow"},"1":{"color":"#00c875","border":"#00b461","var_name":"green-shadow"}}}' });
    expect(api.map((l) => [l.label_id, l.label, l.hex, l.is_done])).toEqual([
      [0, "Yes", "#df2f4a", null],
      [1, "No", "#00c875", true],
      [7, "Info Collection", null, null],
    ]);
    expect(labelsOf({ settings_str: '[{"id":1,"name":"Hospital/SNF"},{"id":2,"name":"Hospice"}]' })).toEqual([]);
    expect(labelsOf({ settings_str: '{"labels":[{"id":1,"name":"Hospital/SNF"},{"id":2,"name":"Hospice"}]}' }).map((l) => l.label)).toEqual(["Hospital/SNF", "Hospice"]);
  });
  it("parseSettings never throws", () => {
    expect(parseSettings("")).toEqual({});
    expect(parseSettings("{bad")).toEqual({});
    expect(parseSettings('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("pacing", () => {
  it("the incremental watermark is the last pass minus the overlap", () => {
    expect(incrementalSince("2026-09-29T12:00:00.000Z", 300)).toBe("2026-09-29T11:55:00.000Z");
    expect(incrementalSince(null)).toBeNull();
    expect(incrementalSince("garbage")).toBeNull();
  });

  it("takeUpdatedSince keeps the newest-first prefix and says when the page crossed the watermark", () => {
    const items = [{ id: 1, updated_at: "2026-09-29T12:00:00Z" }, { id: 2, updated_at: "2026-09-29T11:56:00Z" }, { id: 3, updated_at: "2026-09-29T11:00:00Z" }, { id: 4, updated_at: "2026-09-29T10:00:00Z" }];
    const r = takeUpdatedSince(items, "2026-09-29T11:55:00Z");
    expect(r.items.map((i) => i.id)).toEqual([1, 2]);
    expect(r.done).toBe(true);
    expect(takeUpdatedSince(items, null)).toEqual({ items, done: false });
    expect(takeUpdatedSince(items.slice(0, 2), "2026-09-29T11:00:00Z").done).toBe(false);
  });

  it("takeCreatedSince (start-empty scope): blank keeps all; otherwise only items created on/after; unknown created_at is out", () => {
    const items = [{ id: 1, created_at: "2026-10-02T09:00:00Z" }, { id: 2, created_at: "2026-09-28T09:00:00Z" }, { id: 3 }];
    expect(takeCreatedSince(items, null)).toEqual(items);
    expect(takeCreatedSince(items, "")).toEqual(items);
    expect(takeCreatedSince(items, "2026-10-01T00:00:00Z").map((i) => i.id)).toEqual([1]);
    expect(takeCreatedSince(items, "2026-09-01T00:00:00Z").map((i) => i.id)).toEqual([1, 2]);
    expect(takeCreatedSince(items, "2026-10-02T09:00:00Z").map((i) => i.id)).toEqual([1]); // on the instant is in
  });

  it("wiring: the scope is applied at the item-write choke point and to the reconcile scan", () => {
    const src = readFileSync(join(process.cwd(), "services/supabase-mirror/index.mjs"), "utf8");
    expect(src).toContain("takeCreatedSince(rawItems, CONFIG.createdSince)");
    expect(src).toContain("takeCreatedSince(scanned, CONFIG.createdSince)");
    expect(src).toMatch(/startRun\(pool, boardId, "full", CONFIG.createdSince\)/);
  });

  it("reconcile is due when never run or a day old", () => {
    expect(reconcileDue(null)).toBe(true);
    const now = Date.parse("2026-09-29T12:00:00Z");
    expect(reconcileDue("2026-09-29T00:00:00Z", now, 24)).toBe(false);
    expect(reconcileDue("2026-09-28T11:00:00Z", now, 24)).toBe(true);
  });

  it("reconcilePlan: missing = in the mirror, not listed; stale = group or updated_at disagree, or unknown to the mirror", () => {
    const mirror = [
      { item_id: 1, group_id: "a", state: "active", monday_updated_at: new Date("2026-09-29T10:00:00Z") },
      { item_id: 2, group_id: "a", state: "active", monday_updated_at: new Date("2026-09-29T10:00:00Z") },
      { item_id: 3, group_id: "a", state: "active", monday_updated_at: new Date("2026-09-29T10:00:00Z") },
      { item_id: 4, group_id: "a", state: "missing", monday_updated_at: null },
    ];
    const scanned = [
      { id: "1", updated_at: "2026-09-29T10:00:00Z", group: { id: "a" } },
      { id: "2", updated_at: "2026-09-29T10:00:00Z", group: { id: "b" } },
      { id: "5", updated_at: "2026-09-29T10:00:00Z", group: { id: "a" } },
    ];
    expect(reconcilePlan(mirror, scanned)).toEqual({ missing: [3], stale: [2, 5] });
  });
});
