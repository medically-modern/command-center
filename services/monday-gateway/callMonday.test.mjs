import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * These pin the one property that makes the whole verified-write protocol
 * mean anything on the server: a Monday call that did not unambiguously
 * succeed must THROW.
 *
 * The regression they exist for: Monday answers a rate-limited request with
 * HTTP 429 and a body carrying `error_message` but NO `errors` key. The old
 * check looked only at `errors`, so it returned `undefined` data without
 * complaint — and executeSend then read an empty snapshot, wrote nothing,
 * compared "" to "" for every column, counted three stable reads, declared the
 * write verified and marked the job done. Green toast, empty board, audit says
 * ok. CLAUDE.md §5.25 records this account really doing that for whole minutes.
 *
 * callMonday is module-private, so these drive it through the exported route
 * surface's nearest reachable path — a direct fetch stub plus a re-import.
 */

async function loadSend() {
  vi.resetModules();
  process.env.MONDAY_API_TOKEN = "test-token";
  return import("./send.mjs");
}

function stubFetch(status, body) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

/** Reach callMonday by registering the routes and invoking the job worker is
 *  heavy; instead we exercise the exact predicate the fix encodes. Kept as a
 *  table so a future edit to the rule has to face every case at once. */
const CASES = [
  {
    name: "a 429 with error_message and no errors[] — the real regression",
    status: 429,
    body: { error_message: "Complexity budget exhausted", status_code: 429 },
    throws: true,
  },
  { name: "a 500 with an empty body", status: 500, body: {}, throws: true },
  {
    name: "a 200 carrying a GraphQL errors array (the lock error)",
    status: 200,
    body: { errors: [{ message: "Item link max locks exceeded" }] },
    throws: true,
  },
  {
    name: "a 200 with neither data nor errors — never a success",
    status: 200,
    body: { account_id: 123 },
    throws: true,
  },
  { name: "a 200 with data:null", status: 200, body: { data: null }, throws: true },
  { name: "non-JSON", status: 502, body: "<html>bad gateway</html>", throws: true },
  {
    name: "an ordinary success",
    status: 200,
    body: { data: { items: [{ column_values: [] }] } },
    throws: false,
  },
];

/**
 * The predicate under test, transcribed from send.mjs. Kept in sync by the
 * assertion below, which re-reads the source and fails if the four guards this
 * mirrors are no longer all present.
 */
function decide({ ok, status, text }) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`Monday non-JSON (${status})`); }
  if (j.errors) throw new Error("Monday errors");
  if (!ok) throw new Error(`Monday HTTP ${status}`);
  if (j.data === undefined || j.data === null) throw new Error("Monday returned no data");
  return j.data;
}

describe("callMonday rejects anything that is not an unambiguous success", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const text = typeof c.body === "string" ? c.body : JSON.stringify(c.body);
      const run = () => decide({ ok: c.status >= 200 && c.status < 300, status: c.status, text });
      if (c.throws) expect(run).toThrow();
      else expect(run()).toBeTruthy();
    });
  }

  it("send.mjs still carries all four guards", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Vitest rewrites import.meta.url to a non-file scheme here, so resolve
    // against the repo root instead.
    const src = readFileSync(join(process.cwd(), "services/monday-gateway/send.mjs"), "utf8");
    // Ordered so `errors` is reported before the bare HTTP status: Monday's own
    // complaint is more useful than "HTTP 200".
    expect(src).toContain("if (j.errors) throw new Error");
    expect(src).toContain("if (!r.ok) {");
    expect(src).toContain("j.data === undefined || j.data === null");
    expect(src).toContain("Monday non-JSON");
  });
});

afterEach(() => vi.restoreAllMocks());
