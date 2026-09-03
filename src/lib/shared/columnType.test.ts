import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchColumnTypes,
  isCappedColumn,
  invalidateColumnTypes,
  columnTypeCached,
} from "./columnType";

function mockFetch(payload: unknown, ok = true, status = 200) {
  const spy = vi.fn().mockResolvedValue({ ok, status, json: async () => payload });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const board = (cols: { id: string; type: string }[]) => ({ data: { boards: [{ columns: cols }] } });

describe("isCappedColumn", () => {
  beforeEach(() => {
    invalidateColumnTypes();
    vi.stubEnv("VITE_MONDAY_API_TOKEN", "test-token-123");
  });

  it("is false ONLY for a plain text column", async () => {
    mockFetch(board([{ id: "text_a", type: "text" }, { id: "long_text_b", type: "long_text" }]));
    expect(await isCappedColumn(1, "text_a")).toBe(false);
    expect(await isCappedColumn(1, "long_text_b")).toBe(true);
  });

  it("does not trust the id prefix — a `long_text_` id the board now reports as text is uncapped", async () => {
    // A UI "Change column type" may keep the id. The board is the truth.
    mockFetch(board([{ id: "long_text_converted", type: "text" }]));
    expect(await isCappedColumn(1, "long_text_converted")).toBe(false);
  });

  it("treats a column the board does not have as capped, and caches that", async () => {
    const spy = mockFetch(board([]));
    expect(await isCappedColumn(1, "gone")).toBe(true);
    expect(await isCappedColumn(1, "gone")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(columnTypeCached(1, "gone")).toBeUndefined();
  });

  it("treats a failed lookup as capped and never throws", async () => {
    mockFetch({}, false, 503);
    await expect(isCappedColumn(1, "text_a")).resolves.toBe(true);
    mockFetch({ errors: [{ message: "boom" }] });
    await expect(isCappedColumn(1, "text_a")).resolves.toBe(true);
  });

  it("makes one request for concurrent callers and none for a cache hit", async () => {
    const spy = mockFetch(board([{ id: "text_a", type: "text" }]));
    await Promise.all([isCappedColumn(1, "text_a"), isCappedColumn(1, "text_a"), fetchColumnTypes(1, ["text_a"])]);
    await isCappedColumn(1, "text_a");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sends Authorization + API-Version and asks for id + type only", async () => {
    const spy = mockFetch(board([{ id: "text_a", type: "text" }]));
    await fetchColumnTypes(42, ["text_a"]);
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeTruthy();
    expect(headers["API-Version"]).toBe("2024-10");
    const body = JSON.parse(init.body as string);
    expect(body.query).toMatch(/columns\(ids: \$cols\) \{ id type \}/);
    expect(body.variables).toEqual({ boardId: ["42"], cols: ["text_a"] });
  });
});
