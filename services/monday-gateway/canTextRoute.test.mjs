/**
 * The Can Text lookup's ROUTE — the half `canTextRules.test.mjs` cannot reach.
 *
 * The rules there prove the verdict; this proves the wiring around it: that a
 * number is hashed on the way in and mapped back to the caller's own spelling
 * on the way out, that a batch is bounded, and — the one that matters — that a
 * dead database is a 502 and never a 200 with no evidence. §5.27 records what
 * "200 OK, empty list" costs when it is indistinguishable from the truth.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

// ⚠️ Set BEFORE smsArchive.mjs is imported: `phoneHmac` reads the pepper at
// call time, but without one it returns "" and every assertion below would
// pass vacuously against a lookup that had silently stopped hashing.
process.env.PHONE_HMAC_PEPPER = process.env.PHONE_HMAC_PEPPER || "test-pepper";

const { registerSmsArchive } = await import("./smsArchive.mjs");
const { phoneHmac } = await import("./phoneHash.mjs");

describe("POST /messaging/can-text", () => {
  function harness({ rows = [], throws = false } = {}) {
    const routes = new Map();
    const app = { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) };
    const pool = {
      query: vi.fn(async (sql) => {
        if (/CREATE TABLE/.test(sql)) return { rows: [] };
        if (throws) throw new Error("db down");
        return { rows };
      }),
    };
    registerSmsArchive({ app, pool, requireCaller: async () => "katie@medicallymodern.com" });
    return { routes, pool };
  }
  const run = async (routes, body) => {
    const h = routes.get("POST /messaging/can-text");
    let status = 200, payload = null;
    const res = { status(c) { status = c; return this; }, json(j) { payload = j; return this; } };
    await h({ body, headers: {} }, res);
    return { status, payload };
  };

  it("maps evidence back to the caller's OWN spelling of the number", async () => {
    /* The browser holds "(555) 555-0100" in a phone slot; the archive holds its
       HMAC. Keying the response by what the caller sent is what stops the SPA
       having to re-implement toE164 and disagree with this one. */
    const { routes } = harness({
      rows: [{ phone_hmac: phoneHmac("+15555550100"), direction: "Inbound", message_status: "Received" }],
    });
    const out = await run(routes, { numbers: ["(555) 555-0100"] });
    expect(out.status).toBe(200);
    expect(out.payload.results).toEqual({ "(555) 555-0100": "yes" });
  });

  it("OMITS a number with no evidence — never a falsy verdict", async () => {
    const { routes } = harness({ rows: [] });
    const out = await run(routes, { numbers: ["(555) 555-0100"] });
    expect(out.payload.results).toEqual({});
    // Nothing in the payload may be read as "this number cannot receive texts".
    expect(Object.values(out.payload.results)).not.toContain("");
    expect(Object.values(out.payload.results)).not.toContain("no");
  });

  it("does not let a Sent-only history fill the answer in", async () => {
    // §5.5: accepted is not delivered, so this is exactly the landline case.
    const { routes } = harness({
      rows: [{ phone_hmac: phoneHmac("+15555550100"), direction: "Outbound", message_status: "Sent" }],
    });
    const out = await run(routes, { numbers: ["5555550100"] });
    expect(out.payload.results).toEqual({});
  });

  it("refuses an oversized batch", async () => {
    const { routes } = harness();
    const out = await run(routes, { numbers: Array(40).fill("5555550100") });
    expect(out.status).toBe(400);
  });

  it("answers {} without querying when nothing is readable", async () => {
    const { routes, pool } = harness();
    pool.query.mockClear();
    const out = await run(routes, { numbers: ["", "abc"] });
    expect(out.payload).toEqual({ ok: true, results: {} });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("502s on a database failure rather than reporting no evidence", async () => {
    const { routes } = harness({ throws: true });
    const out = await run(routes, { numbers: ["5555550100"] });
    expect(out.status).toBe(502);
    expect(out.payload.ok).toBe(false);
  });
});
