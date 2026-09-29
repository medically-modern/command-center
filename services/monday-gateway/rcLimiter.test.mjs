import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  cooldownFor,
  createCoalescer,
  createRcGuard,
  rcShape,
  retryAfterMs,
  shedWaitMs,
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

/**
 * 2026-09-28, 19:30–23:00 ET: a 15-minute job elsewhere burst ~20 call-log
 * reads through the /rc proxy and took a HEAVY-group 429 every run. The
 * breaker was one switch, so each 429 also refused reps' LIGHT message-store
 * reads for the next minute. These pin the per-group breaker that replaced it.
 */
describe("the breaker is per RingCentral group", () => {
  const CALL_LOG = rcShape("GET", "/restapi/v1.0/account/~/extension/~/call-log?view=Detailed");
  const RECORDING = rcShape("GET", "https://media.ringcentral.com/restapi/v1.0/account/1/recording/2/content");
  const THREAD = rcShape("GET", "/restapi/v1.0/account/~/extension/~/message-store?messageType=SMS");

  it("a heavy-group throttle leaves light reads alone", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 200, shape: THREAD, group: "light" });
    g.note({ status: 429, shape: CALL_LOG, group: "heavy", retryAfter: 20 * 60_000 });
    const held = g.check({ tier: "background", caller: "comms-inbox", shape: CALL_LOG });
    expect(held.ok).toBe(false);
    expect(held.reason).toBe("breaker");
    expect(held.breaker).toBe("group:heavy");
    expect(g.check({ tier: "interactive", caller: "rep", shape: THREAD }).ok).toBe(true);
  });

  it("holds every shape RingCentral puts in the throttled group", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 200, shape: RECORDING, group: "heavy" });
    g.note({ status: 429, shape: CALL_LOG, group: "heavy" });
    expect(g.check({ tier: "background", caller: "call-archive", shape: RECORDING }).ok).toBe(false);
  });

  // The old breaker closed on ANY success, so a light read getting through
  // re-opened the door on a group RingCentral was still refusing.
  it("is not closed by a success in another group", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 429, shape: CALL_LOG, group: "heavy", retryAfter: 20 * 60_000 });
    g.note({ status: 200, shape: THREAD, group: "light" });
    expect(g.check({ tier: "background", caller: "p", shape: CALL_LOG }).ok).toBe(false);
    expect(Object.keys(g.snapshot().breakers)).toEqual(["group:heavy"]);
  });

  it("is closed by a success in its own group", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 429, shape: CALL_LOG, group: "heavy" });
    g.note({ status: 200, shape: RECORDING, group: "heavy" });     // e.g. a critical call got through
    expect(g.check({ tier: "background", caller: "p", shape: CALL_LOG }).ok).toBe(true);
    expect(g.snapshot().breakerOpen).toBe(false);
  });

  // No X-Rate-Limit-Group on the 429 (or the first call after a boot): the
  // shape holds itself, so it knocks once, and nothing else is shed with it.
  it("holds an unknown-group shape by itself", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 429, shape: CALL_LOG });
    const held = g.check({ tier: "background", caller: "p", shape: CALL_LOG });
    expect(held.ok).toBe(false);
    expect(held.breaker).toBe(`shape:${CALL_LOG}`);
    expect(g.check({ tier: "background", caller: "p", shape: THREAD }).ok).toBe(true);
  });

  it("still lets a ringing call through a throttled group", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 429, shape: CALL_LOG, group: "heavy" });
    expect(g.check({ tier: "critical", caller: "rep", shape: CALL_LOG }).ok).toBe(true);
  });

  it("reports which group is open, keeping the old any-group fields", () => {
    const k = clock();
    const g = createRcGuard(cfg, k.now);
    g.note({ status: 429, shape: CALL_LOG, group: "heavy", retryAfter: 90_000 });
    const snap = g.snapshot();
    expect(snap.breakerOpen).toBe(true);
    expect(snap.breakerOpenForMs).toBe(90_000);
    expect(snap.consecutive429s).toBe(1);
    expect(snap.breakers["group:heavy"]).toEqual({ openForMs: 90_000, consecutive429s: 1 });
  });
});

describe("honouring RingCentral's Retry-After", () => {
  // The old 15-minute cap cut short any longer Retry-After.
  it("waits the whole time RingCentral asks for, past the old 15-minute cap", () => {
    const k = clock();
    const g = createRcGuard(DEFAULTS, k.now);
    const shape = rcShape("GET", "/restapi/v1.0/account/~/extension/~/call-log");
    expect(g.note({ status: 429, shape, group: "heavy", retryAfter: 40 * 60_000 }).waitMs).toBe(40 * 60_000);
    k.advance(39 * 60_000);
    expect(g.check({ tier: "background", caller: "p", shape }).ok).toBe(false);
    k.advance(60_000 + 1);
    expect(g.check({ tier: "background", caller: "p", shape }).ok).toBe(true);
  });

  it("keeps a ceiling, for a malformed header", () => {
    expect(DEFAULTS.maxCooldownMs).toBe(60 * 60_000);
    expect(cooldownFor(1, 6 * 60 * 60_000)).toBe(60 * 60_000);
  });
});

describe("rcShape", () => {
  it("drops the query and every id, keeps the words", () => {
    expect(rcShape("get", "/restapi/v1.0/account/~/extension/~/call-log/Z8IwUePkQ0TAkA?view=Detailed"))
      .toBe("GET /restapi/v1.0/account/~/extension/~/call-log/:id");
    expect(rcShape("GET", "/restapi/v1.0/account/~/extension/~/message-store/12345/content/67890"))
      .toBe("GET /restapi/v1.0/account/~/extension/~/message-store/:id/content/:id");
    expect(rcShape("DELETE", "/restapi/v1.0/subscription/5a2c5bec-d207-402d-aaac-cb278d67bc61"))
      .toBe("DELETE /restapi/v1.0/subscription/:id");
    expect(rcShape("GET", "/restapi/v1.0/client-info/sip-provision"))
      .toBe("GET /restapi/v1.0/client-info/sip-provision");
  });

  it("keys an absolute media URL on its path, and keeps methods apart", () => {
    expect(rcShape("GET", "https://media.ringcentral.com/restapi/v1.0/account/2160844013/recording/98765/content"))
      .toBe("GET /restapi/v1.0/account/:id/recording/:id/content");
    expect(rcShape("POST", "/restapi/v1.0/account/~/extension/~/sms"))
      .not.toBe(rcShape("GET", "/restapi/v1.0/account/~/extension/~/sms"));
  });
});

describe("shedWaitMs", () => {
  it("rides out a budget shed", () => {
    expect(shedWaitMs("45", 30_000)).toBe(45_000);
    expect(shedWaitMs(null, 30_000)).toBe(30_000);
  });

  // A breaker refusal can now last an hour. The archive scans used to sleep
  // through whatever they were told, five times a page, holding their lock.
  it("gives up on a long breaker instead of sleeping through it", () => {
    expect(shedWaitMs("1800", 30_000)).toBeNull();
    expect(shedWaitMs(String(DEFAULTS.maxShedWaitMs / 1000), 30_000)).toBe(DEFAULTS.maxShedWaitMs);
    expect(shedWaitMs("600", 30_000, 15 * 60_000)).toBe(600_000);
  });
});
