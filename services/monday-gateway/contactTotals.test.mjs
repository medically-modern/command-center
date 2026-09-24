/**
 * POST /messaging/contact-totals — the Care Coordinator cards' call and text
 * counts, all-time, out of Postgres (Brandon, 2026-09-24: "can we connect this
 * to how many outbound calls in total have ever gone to the patient? and is
 * that a huge call that will get us blocked from rc on every page load?").
 *
 * The first half proves the fold; the second the wiring around it — hashing on
 * the way in, the caller's own spelling on the way out, a bounded batch, a
 * missing archive reading as "cannot say" rather than zero, and a dead
 * database as a 502. And the one that answers his second question: nothing
 * here may import the RingCentral client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const gatewaySrc = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");

// ⚠️ Set BEFORE the route is imported — without a pepper `phoneHmac` returns ""
// and every assertion below would pass against a lookup that hashed nothing.
process.env.PHONE_HMAC_PEPPER = process.env.PHONE_HMAC_PEPPER || "test-pepper";

const { foldTotals, callTotalsSql, textTotalsSql, coverageSql, MAX_TOTALS_NUMBERS } =
  await import("./contactTotalsRules.mjs");
const { registerContactTotals, __resetContactTotalsForTest } = await import("./contactTotals.mjs");
const { phoneHmac } = await import("./phoneHash.mjs");

const H = phoneHmac("+15555550100");
const H2 = phoneHmac("+15555550199");

describe("foldTotals", () => {
  const both = { calls: true, texts: true };

  it("adds every call and text to its direction", () => {
    const out = foldTotals(
      [H],
      [
        { phone_hmac: H, direction: "Outbound", result: "No Answer", leg_results: [], has_duration: false, n: 4 },
        { phone_hmac: H, direction: "Outbound", result: "Call connected", leg_results: [], has_duration: true, n: 2 },
        { phone_hmac: H, direction: "Inbound", result: "Missed", leg_results: [], has_duration: false, n: 1 },
      ],
      [
        { phone_hmac: H, direction: "Outbound", n: 7 },
        { phone_hmac: H, direction: "Inbound", n: 3 },
      ],
      both,
    );
    expect(out.get(H)).toEqual({ callsOut: 6, callsIn: 1, textsOut: 7, textsIn: 3, reachedByCall: true });
  });

  it("ZERO is an answer — every number asked about gets an entry", () => {
    const out = foldTotals([H, H2], [], [], both);
    expect(out.get(H2)).toEqual({ callsOut: 0, callsIn: 0, textsOut: 0, textsIn: 0, reachedByCall: false });
  });

  it("an archive that is not running is null — 'cannot say', never zero", () => {
    const out = foldTotals([H], [], [{ phone_hmac: H, direction: "Inbound", n: 2 }], { calls: false, texts: true });
    expect(out.get(H)).toEqual({ callsOut: null, callsIn: null, textsOut: 0, textsIn: 2, reachedByCall: false });
  });

  it("reachedByCall is OUTBOUND-only", () => {
    // They rang us and somebody picked up: that says they can reach us, which
    // the inbound count already says. The green phone asks whether ringing
    // THEM works.
    const out = foldTotals(
      [H],
      [{ phone_hmac: H, direction: "Inbound", result: "Accepted", leg_results: [], has_duration: true, n: 3 }],
      [],
      both,
    );
    expect(out.get(H).reachedByCall).toBe(false);
    expect(out.get(H).callsIn).toBe(3);
  });

  it("reads the LEGS — a forwarded call a rep took is a connected call", () => {
    const out = foldTotals(
      [H],
      [{ phone_hmac: H, direction: "Outbound", result: "Stopped", leg_results: ["Accepted"], has_duration: false, n: 1 }],
      [],
      both,
    );
    expect(out.get(H).reachedByCall).toBe(true);
  });

  it("a voicemail we left is not somebody picking up", () => {
    const out = foldTotals(
      [H],
      [{ phone_hmac: H, direction: "Outbound", result: "Voicemail", leg_results: [], has_duration: true, n: 1 }],
      [],
      both,
    );
    expect(out.get(H).reachedByCall).toBe(false);
    expect(out.get(H).callsOut).toBe(1);
  });

  it("ignores rows for numbers nobody asked about", () => {
    const out = foldTotals([H], [], [{ phone_hmac: H2, direction: "Inbound", n: 9 }], both);
    expect(out.has(H2)).toBe(false);
    expect(out.get(H).textsIn).toBe(0);
  });
});

describe("the SQL", () => {
  it("never counts a fax as a call", () => {
    expect(callTotalsSql()).toContain("call_type IS DISTINCT FROM 'Fax'");
  });

  it("GROUPS rather than deciding — the connected rule stays in JavaScript", () => {
    // The can-text lesson: a `bool_or(...)` restating callConnected in SQL is
    // a second copy of a parity-tested rule that nothing tests.
    const sql = callTotalsSql();
    expect(sql).toMatch(/GROUP BY/);
    expect(sql).not.toMatch(/bool_or|CASE WHEN/i);
    expect(textTotalsSql()).toMatch(/GROUP BY phone_hmac, direction/);
  });

  it("asks a missing archive nothing", () => {
    expect(coverageSql({ calls: false, texts: true })).not.toContain("call_archive");
    expect(coverageSql({ calls: true, texts: false })).not.toContain("sms_archive");
  });
});

describe("POST /messaging/contact-totals", () => {
  beforeEach(() => __resetContactTotalsForTest());

  function harness({ calls = [], texts = [], present = { calls: true, texts: true }, throws = false } = {}) {
    const routes = new Map();
    const app = { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) };
    const pool = {
      query: vi.fn(async (sql) => {
        if (throws) throw new Error("db down");
        if (/to_regclass/.test(sql)) return { rows: [present] };
        if (/FROM call_archive\s+WHERE/.test(sql)) return { rows: calls };
        if (/FROM sms_archive\s+WHERE/.test(sql)) return { rows: texts };
        if (/calls_since/.test(sql)) {
          return { rows: [{ calls_since: present.calls ? new Date("2026-06-18T12:00:00Z") : null, texts_since: new Date("2026-08-01T04:00:00Z") }] };
        }
        return { rows: [] };
      }),
    };
    registerContactTotals({ app, pool, requireCaller: async () => "masani@medicallymodern.com" });
    return { routes, pool };
  }
  const run = async (routes, body) => {
    const h = routes.get("POST /messaging/contact-totals");
    let status = 200, payload = null;
    const res = { status(c) { status = c; return this; }, json(j) { payload = j; return this; } };
    await h({ body, headers: {} }, res);
    return { status, payload };
  };

  it("answers in the caller's OWN spelling of the number, with the coverage dates", async () => {
    const { routes } = harness({
      calls: [{ phone_hmac: H, direction: "Outbound", result: "No Answer", leg_results: [], has_duration: false, n: 3 }],
      texts: [{ phone_hmac: H, direction: "Inbound", n: 1 }],
    });
    const out = await run(routes, { numbers: ["(555) 555-0100"] });
    expect(out.status).toBe(200);
    expect(out.payload.results).toEqual({
      "(555) 555-0100": { callsOut: 3, callsIn: 0, textsOut: 0, textsIn: 1, reachedByCall: false },
    });
    expect(out.payload.coverage).toEqual({ callsSince: "2026-06-18T12:00:00.000Z", textsSince: "2026-08-01T04:00:00.000Z" });
  });

  it("two spellings of one number both get the answer", async () => {
    const { routes } = harness({ texts: [{ phone_hmac: H, direction: "Outbound", n: 2 }] });
    const out = await run(routes, { numbers: ["5555550100", "+1 (555) 555-0100"] });
    expect(out.payload.results["5555550100"].textsOut).toBe(2);
    expect(out.payload.results["+1 (555) 555-0100"].textsOut).toBe(2);
  });

  it("does not query a table that does not exist, and says so with nulls", async () => {
    const { routes, pool } = harness({ present: { calls: false, texts: true } });
    const out = await run(routes, { numbers: ["5555550100"] });
    expect(out.payload.results["5555550100"].callsOut).toBeNull();
    expect(out.payload.coverage.callsSince).toBeNull();
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /FROM call_archive\s+WHERE/.test(s))).toBe(false);
  });

  it("refuses an oversized batch", async () => {
    const { routes } = harness();
    const out = await run(routes, { numbers: Array(MAX_TOTALS_NUMBERS + 1).fill("5555550100") });
    expect(out.status).toBe(400);
  });

  it("answers without touching the database when nothing is readable", async () => {
    const { routes, pool } = harness();
    const out = await run(routes, { numbers: ["", "abc"] });
    expect(out.payload).toEqual({ ok: true, results: {}, coverage: null });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("502s on a database failure — a dead database must never read as zero calls", async () => {
    const { routes } = harness({ throws: true });
    const out = await run(routes, { numbers: ["5555550100"] });
    expect(out.status).toBe(502);
    expect(out.payload.ok).toBe(false);
  });
});

describe("it cannot spend the RingCentral account", () => {
  // Brandon's second question, as a test: the card counts used to be a
  // RingCentral read, and a per-page read of the call log is how the phone
  // system went down on 2026-08-20.
  it.each(["contactTotals.mjs", "contactTotalsRules.mjs"])("%s imports no RingCentral client", (f) => {
    const src = gatewaySrc(f);
    expect(src).not.toMatch(/from\s+["']\.\/ringcentral\.mjs["']/);
    expect(src).not.toMatch(/rcApiFetch|rcMediaFetch|rcLimiter/);
  });

  it("is registered on the messaging pool, beside the archives it reads", () => {
    const src = gatewaySrc("messaging.mjs");
    expect(src).toContain("registerContactTotals({ app, pool, requireCaller })");
  });
});
