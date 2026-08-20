import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The 2026-08-20 incident, replayed against the REAL rcApiFetch.
 *
 * rcLimiter.test.mjs proves the rules in isolation. This proves they are
 * actually wired in — which is the half that was missing on the day: the
 * gateway had no shortage of good intentions, it just forwarded everything.
 */
let rcApiFetch;
let upstream;

beforeAll(async () => {
  process.env.RC_CLIENT_ID = "test-id";
  process.env.RC_CLIENT_SECRET = "test-secret";
  process.env.RC_JWT = "test-jwt";
  ({ rcApiFetch } = await import("./ringcentral.mjs"));
});

beforeEach(() => {
  upstream = { token: 0, api: 0, paths: [] };
  vi.stubGlobal("fetch", async (url, init) => {
    const u = String(url);
    if (u.includes("/oauth/token")) {
      upstream.token += 1;
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    upstream.api += 1;
    upstream.paths.push(u);
    void init;
    return new Response(JSON.stringify({ records: [] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  });
});

describe("rcApiFetch under the failure that happened", () => {
  /**
   * The measured attack: ~1,166 identical requests/sec from one looping
   * component. Every one used to become a RingCentral call.
   */
  it("collapses a 500-request burst into ONE RingCentral call", async () => {
    const path = "/restapi/v1.0/account/~/extension/~/message-store?phoneNumber=%2B15551234567";
    const responses = await Promise.all(
      Array.from({ length: 500 }, () => rcApiFetch(path, {}, { tier: "interactive", caller: "loop" })),
    );
    expect(upstream.api).toBe(1);
    // ⚠️ Every caller must still get a USABLE, independently-readable response.
    // A shared Response body would be consumed by the first reader and throw
    // for the other 499 — trading a flood for a different outage.
    expect(responses).toHaveLength(500);
    const bodies = await Promise.all(responses.slice(0, 25).map((r) => r.json()));
    expect(bodies.every((b) => Array.isArray(b.records))).toBe(true);
    expect(responses.every((r) => r.status === 200)).toBe(true);
  });

  it("refuses rather than forwards once a caller is over budget", async () => {
    const statuses = [];
    for (let i = 0; i < 80; i++) {
      // Distinct paths so coalescing cannot mask the budget.
      const r = await rcApiFetch(`/restapi/v1.0/thing/${i}`, {}, { tier: "interactive", caller: "hog" });
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
    expect(upstream.api).toBeLessThan(80);
    const refused = statuses.filter((s) => s === 429).length;
    expect(refused).toBeGreaterThan(0);
  });

  // Writes must never dedupe: two identical texts a second apart are two texts
  // a rep meant to send.
  it("never coalesces a POST", async () => {
    const body = { method: "POST", body: JSON.stringify({ text: "hi" }) };
    await Promise.all([
      rcApiFetch("/restapi/v1.0/account/~/extension/~/sms", body, { tier: "critical", caller: "rep" }),
      rcApiFetch("/restapi/v1.0/account/~/extension/~/sms", body, { tier: "critical", caller: "rep" }),
    ]);
    expect(upstream.api).toBe(2);
  });

  it("a refusal is shaped like a response, so existing !res.ok paths work", async () => {
    for (let i = 0; i < 200; i++) {
      await rcApiFetch(`/restapi/v1.0/x/${i}`, {}, { tier: "interactive", caller: "hog2" });
    }
    const r = await rcApiFetch("/restapi/v1.0/x/final", {}, { tier: "interactive", caller: "hog2" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    await expect(r.json()).resolves.toHaveProperty("error");
  });
});
