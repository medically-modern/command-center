/** FA-4 cursor safety and CA-4 reset-during-refresh, with injected fetchers (no network). */
import { describe, it, expect, vi } from "vitest";
import { refreshSnapshot, bumpGeneration, type CacheBlob } from "./loadSnapshot";
import { memoryKV } from "./cache";
import { cacheKey } from "./cache";

const okDeps = (failBoard?: string) => ({
  fetchBoardItems: vi.fn(async () => []), fetchExcludedIntCounts: vi.fn(async () => ({ total: 0, escalated: 0 })),
  fetchColumnEvents: vi.fn(async (b: string) => { if (b === failBoard) throw new Error("page 3 failed"); return []; }),
  fetchGroupMoves: vi.fn(async () => []), fetchFax: vi.fn(async () => ({ weeks: [], neverClosed: {} })), fetchCommsSla: vi.fn(async () => null),
});

describe("snapshot loader", () => {
  it("FA-4 keeps a failed board's cursor and advances the others", async () => {
    await memoryKV.del(cacheKey());
    const now = Date.parse("2026-10-01T18:00:00Z");
    const s = await refreshSnapshot({ access: null, periodDays: 28, kv: memoryKV, now, deps: okDeps("INS") });
    expect(s.cursors.MN).toBe(now); expect(s.cursors.INS).toBeUndefined();
    expect(s.fetchErrors.some((e) => e.board === "INS")).toBe(true);
  });
  it("CA-4 a cache reset during a refresh is not undone by that refresh", async () => {
    await memoryKV.del(cacheKey());
    const deps = okDeps(); let release: () => void = () => {};
    deps.fetchFax = vi.fn(() => new Promise((r) => { release = () => r({ weeks: [], neverClosed: {} }); }));
    const p = refreshSnapshot({ access: null, periodDays: 28, kv: memoryKV, deps });
    await new Promise((r) => setTimeout(r, 10));
    bumpGeneration(); release(); await p;
    expect(await memoryKV.get(cacheKey()) as CacheBlob | undefined).toBeUndefined();
  });
  it("LV-1 live escalation kinds: classes are attached to items (one word, cached); a failed notes read is reported and leaves them unclassified", async () => {
    await memoryKV.del(cacheKey());
    const esc = (id: string) => ({ boardKey: "WC" as const, itemId: id, groupId: "g", createdAtMs: 0, uid: null, values: { color_mm1x7997: { index: 0, nonEmpty: true } } });
    const deps = { ...okDeps(), fetchBoardItems: vi.fn(async (b: string) => (b === "WC" ? [esc("9200001")] : [])), fetchEscClasses: vi.fn(async (b: string) => (b === "WC" ? { "9200001": "proposedStuck" as const } : {})) };
    const s = await refreshSnapshot({ access: null, periodDays: 28, kv: memoryKV, deps });
    expect(s.items.find((i) => i.itemId === "9200001")?.escClass).toBe("proposedStuck");
    const blob = await memoryKV.get(cacheKey()) as CacheBlob; expect(JSON.stringify(blob)).not.toMatch(/\[Proposed Stuck/);
    await memoryKV.del(cacheKey());
    const bad = { ...deps, fetchEscClasses: vi.fn(async () => { throw new Error("gateway 502"); }) };
    const s2 = await refreshSnapshot({ access: null, periodDays: 28, kv: memoryKV, deps: bad });
    expect(s2.items.find((i) => i.itemId === "9200001")?.escClass).toBeUndefined();
    expect(s2.fetchErrors.some((e) => /escalation kinds unavailable/.test(e.message))).toBe(true);
  });
});
