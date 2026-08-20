import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  cooldownFor,
  createCoalescer,
  createRcGuard,
  retryAfterMs,
} from "./rcLimiter.mjs";

/**
 * These rules are the only thing standing between a bad render loop and a
 * shared production phone system. On 2026-08-20 one component sent ~1,166
 * requests/sec at a route that fans out ten deep into RingCentral, and the
 * gateway forwarded every one — so each test below is a way that must not
 * happen again, plus the ways this guard must NOT make an outage worse.
 */
const cfg = { ...DEFAULTS, maxPerWindow: 10, maxPerCallerPerWindow: 4, backgroundFloor: 0.7 };
const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
};

describe("the budget", () => {
  it("stops a runaway caller dead", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    const verdicts = Array.from({ length: 50 }, () =>
      g.check({ tier: "interactive", caller: "rep@mm.com" }));
    expect(verdicts.filter((v) => v.ok).length).toBe(cfg.maxPerCallerPerWindow);
    expect(verdicts.at(-1).reason).toBe("caller");
  });

  // The per-caller cap must not become a global outage: one looping tab is one
  // caller, and everyone else has to keep working through it.
  it("does not let one caller consume everyone else's budget", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    for (let i = 0; i < 50; i++) g.check({ tier: "interactive", caller: "looping-tab" });
    expect(g.check({ tier: "interactive", caller: "someone-else" }).ok).toBe(true);
  });

  it("still caps the gateway as a whole", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    let ok = 0;
    for (let i = 0; i < 40; i++) {
      if (g.check({ tier: "interactive", caller: `rep${i}` }).ok) ok += 1;
    }
    expect(ok).toBe(cfg.maxPerWindow);
  });

  it("refills as the window rolls forward", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    for (let i = 0; i < 20; i++) g.check({ tier: "interactive", caller: "rep" });
    k.advance(cfg.windowMs + 1);
    expect(g.check({ tier: "interactive", caller: "rep" }).ok).toBe(true);
  });

  it("sheds background polling before interactive work", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    for (let i = 0; i < 7; i++) g.check({ tier: "interactive", caller: `rep${i}` });
    expect(g.check({ tier: "background", caller: "poller" }).reason).toBe("background-shed");
    expect(g.check({ tier: "interactive", caller: "rep-x" }).ok).toBe(true);
  });
});

/**
 * ⚠️ The most important tests here. A limiter that blocks a ringing call is
 * worse than no limiter: there is no retry, the caller is on the line, and the
 * whole inbound-calls feature is that forward.
 */
describe("what must never be shed", () => {
  it("lets a call claim through a full budget", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    for (let i = 0; i < 100; i++) g.check({ tier: "interactive", caller: `rep${i}` });
    expect(g.check({ tier: "critical", caller: "rep" }).ok).toBe(true);
  });

  it("lets a call claim through an OPEN breaker", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 429 });
    expect(g.check({ tier: "background", caller: "poller" }).ok).toBe(false);
    expect(g.check({ tier: "critical", caller: "rep" }).ok).toBe(true);
  });

  // Invisible load is unmanageable load: critical calls bypass the checks but
  // must still show up in the accounting.
  it("still counts critical calls", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.check({ tier: "critical", caller: "rep" });
    expect(g.snapshot().callsInWindow).toBe(1);
  });
});

describe("the breaker", () => {
  it("opens on a 429 and refuses background work", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    expect(g.check({ tier: "background", caller: "p" }).ok).toBe(true);
    g.note({ status: 429 });
    const v = g.check({ tier: "background", caller: "p" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("breaker");
    expect(v.retryAfterMs).toBeGreaterThan(0);
  });

  it("waits longer each time RingCentral keeps refusing", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    const first = g.note({ status: 429 }).waitMs;
    k.advance(first + 1);
    const second = g.note({ status: 429 }).waitMs;
    expect(second).toBeGreaterThan(first);
  });

  it("obeys RingCentral's Retry-After when it is longer", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    const r = g.note({ status: 429, retryAfter: 10 * 60_000 });
    expect(r.waitMs).toBe(10 * 60_000);
  });

  it("never sits out longer than the cap", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    expect(g.note({ status: 429, retryAfter: 6 * 60 * 60_000 }).waitMs).toBe(cfg.maxCooldownMs);
  });

  // A throttle is over the moment a call gets through. Staying shut after that
  // would turn RingCentral's 60-second window into our own outage.
  it("closes on the first success", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 429 });
    k.advance(cfg.cooldownsMs[0] + 1);
    g.note({ status: 200 });
    expect(g.check({ tier: "background", caller: "p" }).ok).toBe(true);
    expect(g.snapshot().breakerOpen).toBe(false);
  });

  it("reopens cleanly after recovering", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 429 });
    k.advance(cfg.cooldownsMs[0] + 1);
    g.note({ status: 200 });
    expect(g.note({ status: 429 }).waitMs).toBe(cfg.cooldownsMs[0]);
  });

  // A 5xx is not a rate limit; treating it as one would shut off RingCentral
  // for minutes over a single blip, and treating it as success would reset a
  // real backoff. It does neither.
  it("ignores a 5xx for breaker purposes", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 429 });
    g.note({ status: 503 });
    expect(g.snapshot().consecutive429s).toBe(1);
  });
});

describe("cooldownFor / retryAfterMs", () => {
  it("climbs and caps", () => {
    expect(cooldownFor(1, 0, cfg)).toBe(cfg.cooldownsMs[0]);
    expect(cooldownFor(99, 0, cfg)).toBe(cfg.cooldownsMs.at(-1));
    expect(cooldownFor(1, 99 * 60_000, cfg)).toBe(cfg.maxCooldownMs);
  });

  it("reads seconds, ignores junk", () => {
    expect(retryAfterMs("30")).toBe(30_000);
    expect(retryAfterMs(null)).toBe(0);
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBe(0);
  });
});

/** The layer that actually matches the failure: the same read, over and over. */
describe("coalescing", () => {
  it("collapses a burst of identical reads into ONE upstream call", async () => {
    const k = clock();
    const co = createCoalescer(5_000, k.now);
    let calls = 0;
    const fn = () => new Promise((r) => setTimeout(() => { calls += 1; r("thread"); }, 5));
    const results = await Promise.all(
      Array.from({ length: 500 }, () => co.run("conversation:+15551234567", fn)),
    );
    expect(calls).toBe(1);
    expect(results.every((r) => r.value === "thread")).toBe(true);
  });

  it("keeps different keys apart", async () => {
    const k = clock();
    const co = createCoalescer(5_000, k.now);
    let calls = 0;
    const fn = async () => { calls += 1; return "x"; };
    await Promise.all([co.run("a", fn), co.run("b", fn)]);
    expect(calls).toBe(2);
  });

  it("goes back upstream once the TTL passes", async () => {
    const k = clock();
    const co = createCoalescer(5_000, k.now);
    let calls = 0;
    const fn = async () => { calls += 1; return calls; };
    await co.run("k", fn);
    k.advance(5_001);
    await co.run("k", fn);
    expect(calls).toBe(2);
  });

  // ⚠️ Caching a failure would turn one blip into TTL seconds of guaranteed
  // failure for every caller — the opposite of what this is for.
  it("does not cache a rejection", async () => {
    const k = clock();
    const co = createCoalescer(5_000, k.now);
    let calls = 0;
    const boom = async () => { calls += 1; throw new Error("429"); };
    await expect(co.run("k", boom)).rejects.toThrow("429");
    await expect(co.run("k", boom)).rejects.toThrow("429");
    expect(calls).toBe(2);
  });
});
