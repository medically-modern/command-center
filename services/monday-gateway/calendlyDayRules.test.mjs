import { describe, it, expect } from "vitest";

import { KNOWN_KINDS, cacheKey, makeCache, normalizeKinds, validDate } from "./calendlyDayRules.mjs";

describe("validDate", () => {
  it("takes YYYY-MM-DD and nothing else", () => {
    expect(validDate("2026-09-10")).toBe(true);
    expect(validDate(" 2026-09-10 ")).toBe(true);
    expect(validDate("9/10/2026")).toBe(false);
    expect(validDate("")).toBe(false);
    expect(validDate(undefined)).toBe(false);
  });
});

describe("normalizeKinds", () => {
  it("sorts, so the same request is one cache entry however it was typed", () => {
    expect(normalizeKinds("welcome,intake")).toBe("intake,welcome");
    expect(normalizeKinds("intake,welcome")).toBe("intake,welcome");
  });

  it("dedupes and trims", () => {
    expect(normalizeKinds(" welcome , welcome ")).toBe("welcome");
  });

  it("REJECTS an unknown kind rather than dropping it", () => {
    // Silently narrowing the request would come back as a quiet day, which is
    // the answer a coordinator acts on by not calling anybody.
    expect(normalizeKinds("welcome,cabbage")).toBeNull();
    expect(normalizeKinds("cabbage")).toBeNull();
  });

  it("rejects an empty ask", () => {
    expect(normalizeKinds("")).toBeNull();
    expect(normalizeKinds(",  ,")).toBeNull();
    expect(normalizeKinds(undefined)).toBeNull();
  });

  it("knows the kinds the upstream declares", () => {
    expect([...KNOWN_KINDS]).toEqual(["intake", "welcome"]);
  });
});

describe("makeCache", () => {
  const setup = () => {
    let t = 1_000;
    const cache = makeCache({ ttlMs: 100, max: 3, now: () => t });
    return { cache, tick: (ms) => { t += ms; } };
  };

  it("returns a stored answer inside the TTL and forgets it after", () => {
    const { cache, tick } = setup();
    cache.set("a", { ok: true });
    expect(cache.get("a")).toEqual({ ok: true });
    tick(101);
    expect(cache.get("a")).toBeNull();
    expect(cache.size).toBe(0); // expiry evicts rather than leaking
  });

  it("stays bounded — a client paging through days can't grow it forever", () => {
    const { cache } = setup();
    for (const k of ["a", "b", "c", "d", "e"]) cache.set(k, k);
    expect(cache.size).toBeLessThanOrEqual(3);
    expect(cache.get("e")).toBe("e"); // newest survives
    expect(cache.get("a")).toBeNull(); // oldest evicted
  });

  it("re-writing a key refreshes it rather than adding a second entry", () => {
    const { cache } = setup();
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("keys a day and its kinds together", () => {
    expect(cacheKey("2026-09-10", "welcome")).not.toBe(cacheKey("2026-09-10", "intake,welcome"));
    expect(cacheKey("2026-09-10", "welcome")).not.toBe(cacheKey("2026-09-11", "welcome"));
  });
});
