/**
 * The Communications inbox module's guarantees — the ones that cannot be seen
 * on screen when they break.
 *
 * Two kinds of test, the convention every archive beside this one uses:
 *  · BEHAVIOUR, against a fake express app and a fake pool: what the routes do
 *    with the module switched off, and that every route but two refuses an
 *    anonymous caller before touching the database;
 *  · SOURCE SCANS, for properties that are structural rather than behavioural —
 *    which pool it lands on, that no list/count/resolve path can reach
 *    RingCentral, that no table can hold a phone number, that the archives keep
 *    one writer each.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { HOWS, RESOLVING_HOWS } from "./commsInboxRules.mjs";

// The two archives that reach the S3 client cannot resolve under the root test
// run (the gateway's deps are installed in services/monday-gateway only — see
// vitest.config.ts). The inbox only ever calls their record upserts, so those
// are all that is stood in for; nothing here tests the archives themselves.
vi.mock("./callArchive.mjs", () => ({ archiveCallRecords: vi.fn(async () => ({ written: 0, rows: [] })) }));
vi.mock("./voicemailArchive.mjs", () => ({ archiveVoicemailRecords: vi.fn(async () => ({ written: 0, rows: [] })) }));

const DIR = resolve(process.cwd(), "services/monday-gateway");
const read = (f) => readFileSync(resolve(DIR, f), "utf8");
const SRC = read("commsInbox.mjs");

/** Strip // and block comments, so a scan reads code and not the prose that
 *  explains why the code must not do the thing being scanned for. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/**
 * A function's source, by name — from its declaration to the closing brace at
 * the SAME indent. The file is prettier-formatted, so indentation is a reliable
 * end marker where brace counting is not (regex literals and SQL carry braces).
 */
function fnBody(name) {
  const m = new RegExp(`\\n( *)(?:export )?(?:async )?function ${name}\\(`).exec(SRC);
  if (!m) throw new Error(`no function ${name}`);
  const indent = m[1];
  const end = SRC.indexOf(`\n${indent}}\n`, m.index + 1);
  if (end < 0) throw new Error(`no end for ${name}`);
  return code(SRC.slice(m.index, end + indent.length + 2));
}

/** One route handler's source: \`  app.get("/x", async (req, res) => {\` … \`  });\`. */
function routeBody(method, path) {
  const marker = `\n  app.${method}("${path}",`;
  // Past the kill-switch block, which registers every path once as a 503.
  const from = SRC.indexOf("/* ── the list and the badge");
  const start = SRC.indexOf(marker, from);
  if (start < 0) throw new Error(`no route ${method} ${path}`);
  const end = SRC.indexOf("\n  });", start + 1);
  return code(SRC.slice(start, end + 6));
}

/* ── a fake express app and pool ─────────────────────────────────────────── */

function fakeApp() {
  const routes = new Map();
  const add = (method) => (path, handler) => routes.set(`${method} ${path}`, handler);
  return { routes, get: add("GET"), post: add("POST"), all: add("ALL") };
}
function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}
async function call(app, method, path, req = {}) {
  const h = app.routes.get(`${method} ${path}`) ?? app.routes.get(`ALL ${path}`);
  if (!h) throw new Error(`not registered: ${method} ${path}`);
  const res = fakeRes();
  await h({ headers: {}, query: {}, body: {}, ...req }, res);
  return res;
}

const PROTECTED = [
  ["GET", "/comms/inbox"],
  ["GET", "/comms/inbox/count"],
  ["GET", "/comms/item"],
  ["POST", "/comms/state"],
  ["POST", "/comms/resolve"],
  ["POST", "/comms/undo"],
  ["POST", "/comms/note"],
  ["GET", "/comms/outbox"],
  ["POST", "/comms/mirror"],
  ["POST", "/comms/link"],
  ["POST", "/comms/dialed"],
  ["GET", "/comms/sla"],
  ["GET", "/comms/shadow-report"],
  ["POST", "/comms/tick"],
];

/* ── switched off ────────────────────────────────────────────────────────── */

describe("with COMMS_INBOX_ENABLED unset — the default", () => {
  let app;
  beforeAll(async () => {
    vi.resetModules();
    delete process.env.COMMS_INBOX_ENABLED;
    const mod = await import("./commsInbox.mjs");
    app = fakeApp();
    mod.registerCommsInbox({ app, pool: { query: async () => ({ rows: [] }) } });
  });

  it("tells the SPA there is no Inbox to show", async () => {
    expect((await call(app, "GET", "/comms/config")).body).toEqual({ enabled: false, ui: false });
  });

  it("⚠️⚠️ the health route SURVIVES the kill switch and reads 'off, on purpose'", async () => {
    const res = await call(app, "GET", "/comms/inbox-health");
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, enabled: false });
    expect(res.body.reason).toMatch(/switched off/);
  });

  it("every other route answers 503, never a 404 that reads as a broken deploy", async () => {
    for (const [method, path] of PROTECTED) {
      const res = await call(app, method, path);
      expect(res.statusCode, `${method} ${path}`).toBe(503);
      expect(res.body.enabled).toBe(false);
    }
  });
});

describe("with COMMS_INBOX_ENABLED=1 but no pepper — asked for, and unable to run", () => {
  let app;
  const saved = { ...process.env };
  beforeAll(async () => {
    vi.resetModules();
    process.env.COMMS_INBOX_ENABLED = "1";
    delete process.env.PHONE_HMAC_PEPPER;
    const mod = await import("./commsInbox.mjs");
    app = fakeApp();
    mod.registerCommsInbox({ app, pool: { query: async () => ({ rows: [] }) } });
  });
  afterAll(() => {
    for (const k of ["COMMS_INBOX_ENABLED", "PHONE_HMAC_PEPPER"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // ⚠️ Off on purpose is quiet; ON and not running is a fault the monitor must
  // page on — it used to read ok:true, enabled:false and say nothing at all.
  it("⚠️ the health route is NOT ok, and says why", async () => {
    const res = await call(app, "GET", "/comms/inbox-health");
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: false, enabled: false });
    expect(res.body.reason).toMatch(/not configured/);
  });
});

/* ── switched on ─────────────────────────────────────────────────────────── */

describe("with COMMS_INBOX_ENABLED=1", () => {
  let app;
  let queries = 0;
  const saved = { ...process.env };
  const pool = {
    query: async () => {
      queries += 1;
      return { rows: [] };
    },
    connect: async () => {
      throw new Error("no transactions in this test");
    },
  };

  beforeAll(async () => {
    vi.resetModules();
    process.env.COMMS_INBOX_ENABLED = "1";
    process.env.PHONE_HMAC_PEPPER = "test-pepper";
    const mod = await import("./commsInbox.mjs");
    app = fakeApp();
    mod.registerCommsInbox({ app, pool });
    // Let the boot's schema + epoch queries settle before counting.
    await new Promise((r) => setTimeout(r, 30));
  });
  afterAll(() => {
    for (const k of ["COMMS_INBOX_ENABLED", "PHONE_HMAC_PEPPER"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("registers every route", () => {
    for (const [method, path] of PROTECTED) expect(app.routes.has(`${method} ${path}`), `${method} ${path}`).toBe(true);
    expect(app.routes.has("GET /comms/inbox-health")).toBe(true);
    expect(app.routes.has("GET /comms/config")).toBe(true);
  });

  it("⚠️ refuses an anonymous caller on EVERY route but config and health — before any database read", async () => {
    for (const [method, path] of PROTECTED) {
      const before = queries;
      const res = await call(app, method, path, { body: { key: "n:" + "a".repeat(64), how: "texted" } });
      expect(res.statusCode, `${method} ${path}`).toBe(401);
      expect(queries, `${method} ${path} read the database before checking who is asking`).toBe(before);
    }
  });

  it("the health route is NOT ok on an empty run ledger — a tick that never ran must not read healthy", async () => {
    const res = await call(app, "GET", "/comms/inbox-health");
    expect(res.body).toMatchObject({ ok: false, enabled: true, reason: "no complete capture tick recorded yet" });
  });
});

/* ── which pool ──────────────────────────────────────────────────────────── */

describe("⚠️ PHI: the inbox lives on the MESSAGING pool", () => {
  it("is registered from messaging.mjs", () => {
    expect(code(read("messaging.mjs"))).toMatch(/registerCommsInbox\(\{ app, pool \}\)/);
  });
  it("and never from index.mjs, whose pool is the no-PHI audit database", () => {
    expect(read("index.mjs")).not.toMatch(/commsInbox/);
  });
});

/* ── no phone number in the clear ────────────────────────────────────────── */

describe("⚠️ PHI: no table here can hold a phone number", () => {
  const schema = SRC.slice(SRC.indexOf("export const SCHEMA = `"), SRC.indexOf("`;", SRC.indexOf("export const SCHEMA = `")));
  const columns = [...schema.matchAll(/^\s{2}([a-z_0-9]+)\s+[A-Z]/gm)].map((m) => m[1]);

  it("reads the schema's columns", () => {
    expect(columns).toContain("phone_hmac");
    expect(columns).toContain("covers_through");
  });
  it("every number column is an HMAC or a last-four hint", () => {
    const suspicious = columns.filter((c) => /phone|e164|number|digits/.test(c) && !/_hmac$/.test(c));
    expect(suspicious).toEqual([]);
  });
  it("a number from the browser is hashed before anything else touches it", () => {
    const c = code(SRC);
    expect(c).toMatch(/phoneHmac\(req\.body\?\.number\)/);
    expect(c).toMatch(/phoneHmac\(req\.body\.anchorNumber\)/);
    expect(c).toMatch(/raw\.map\(\(n\) => phoneHmac\(n\)\)/);
    // With the hashed uses and the one truthiness test removed, nothing else
    // may read a number out of a request body.
    const rest = c
      .replace(/phoneHmac\(req\.body\?\.number\)/g, "")
      .replace(/phoneHmac\(req\.body\.anchorNumber\)/g, "")
      .replace(/req\.body\?\.anchorNumber \?/g, "");
    expect(rest).not.toMatch(/req\.body\??\.(number|anchorNumber|phone)\b/);
  });
  it("the live lookup's cache stores the last four, never the number it asked about", () => {
    const body = fnBody("upsertNumberCache");
    expect(body).toMatch(/e164\.slice\(-4\)/);
    expect(body).not.toMatch(/\[\s*h,\s*e164,/);
    // …and it is the ONE writer: the unknown-number lookup and the inactive
    // re-resolution both go through it rather than a second INSERT.
    expect(fnBody("lookupUnknown")).toMatch(/upsertNumberCache\(/);
    expect(fnBody("reResolveInactive")).toMatch(/upsertNumberCache\(/);
    expect(code(SRC).match(/INSERT INTO comms_number_cache/g) ?? []).toHaveLength(1);
  });
});

/* ── no RingCentral on the hot paths ─────────────────────────────────────── */

describe("⚠️ no RingCentral read on the list, the badge or a resolve (INCIDENT_2026-08-20)", () => {
  const RC = /rcApiFetch|rcMediaFetch|resolveNumbers|captureTick/;

  it("none of the read helpers the list and the count are built from", () => {
    for (const f of ["computeSnapshot", "snapshot", "loadInboundForList", "loadOutbound", "attributed", "loadTargets", "numbersForKey", "loadOpening", "loadGroupAll"]) {
      expect(fnBody(f), f).not.toMatch(RC);
    }
  });

  it("none of the routes but the two that exist to", () => {
    for (const [method, path] of PROTECTED) {
      if (path === "/comms/item" || path === "/comms/tick") continue;
      expect(routeBody(method.toLowerCase(), path), `${method} ${path}`).not.toMatch(RC);
    }
  });

  it("the list route hands the stage filter to filterInbox, beside the type", () => {
    const body = routeBody("get", "/comms/inbox");
    expect(body).toMatch(/type: String\(req\.query\.type \|\| ""\)/);
    expect(body).toMatch(/stage: String\(req\.query\.stage \|\| ""\)/);
  });

  it("opening ONE item may resolve its numbers — an interactive read, on open, never on render", () => {
    expect(fnBody("resolveNumbers")).toMatch(/tier: "interactive"/);
    expect(routeBody("get", "/comms/item")).toMatch(/itemPayload/);
  });

  it("the tick reads on the BACKGROUND tier and never retries a refusal hot", () => {
    const body = fnBody("readWindow");
    expect(body).toMatch(/tier: "background"/);
    expect(body).toMatch(/status === 429\)\s*\{\s*stats\.shed = true;\s*return dedupeRecords\(records\);/);
  });

  it("⚠️ the tick asks for the call log's LEGS — the missed-call verdict reads them", () => {
    expect(code(SRC)).toMatch(/call-log\?view=Detailed&dateFrom=/);
  });

  it("⚠️ and the message store with NO messageType — the multi-value filter 400s on this account", () => {
    expect(code(SRC)).toMatch(/message-store\?dateFrom=\$\{since\}/);
    expect(code(SRC)).not.toMatch(/messageType=/);
  });
});

/* ── one writer per archive ──────────────────────────────────────────────── */

describe("⚠️ each archive keeps exactly one writer", () => {
  const c = code(SRC);
  it("nothing here writes an archive's table directly", () => {
    expect(c).not.toMatch(/INSERT INTO (sms_archive|call_archive|voicemail_archive|mms_archive|patient_directory|sent_messages)\b/i);
    expect(c).not.toMatch(/UPDATE (sms_archive|call_archive|voicemail_archive|mms_archive|patient_directory|sent_messages)\b/i);
    expect(c).not.toMatch(/DELETE FROM (sms_archive|call_archive|voicemail_archive|mms_archive|patient_directory|sent_messages)\b/i);
  });
  it("records reach them through the archives' own upserts", () => {
    const tick = fnBody("captureTick");
    expect(tick).toMatch(/archiveTextRecords\(/);
    expect(tick).toMatch(/archiveCallRecords\(/);
    expect(tick).toMatch(/archiveVoicemailRecords\(/);
  });
  it("and the tick honours each archive's kill switch", async () => {
    const { feedsOff } = await import("./commsInbox.mjs");
    expect(feedsOff({})).toEqual([]);
    expect(feedsOff({ SMS_ARCHIVE_ENABLED: "0", VOICEMAIL_ARCHIVE_ENABLED: "0" })).toEqual(["texts", "voicemails"]);
    expect(feedsOff({ CALL_ARCHIVE_ENABLED: "0" })).toEqual(["calls"]);
    expect(feedsOff({ SMS_ARCHIVE_ENABLED: "1" })).toEqual([]);
    const tick = fnBody("captureTick");
    expect(tick).toMatch(/feedsOff\(\)/);
    expect(tick).toMatch(/off\.has\("calls"\)/);
  });
});

/* ── the SQL mirrors of JS rules ─────────────────────────────────────────── */

describe("⚠️ the list query's two pre-filters can never drop what the JS rules would open", () => {
  it("the answered-call filter reads the rules' OWN label list — never a second copy", () => {
    const body = fnBody("loadInboundForList");
    expect(body).toMatch(/CONNECTED_RESULT_LABELS/);
    expect(body).not.toMatch(/'accepted'|'answered'|'connected'/i);
  });
  it("the cover CTE counts exactly the resolving ways — left_vm is an attempt, undone is nothing", () => {
    expect(HOWS.filter((h) => h !== "left_vm")).toEqual(RESOLVING_HOWS);
    const cte = SRC.slice(SRC.indexOf("const COVER_CTE"), SRC.indexOf("`;", SRC.indexOf("const COVER_CTE")));
    expect(cte).toMatch(/undone_at IS NULL/);
    expect(cte).toMatch(/how <> 'left_vm'/);
    expect(cte).toMatch(/max\(covers_through\)/);
  });
});

/* ── the inverted missed call reaches all THREE loaders (2026-09-25) ─────── */

describe("⚠️ markInvertedInbound runs wherever events are read — list, timeline and resolve in lockstep", () => {
  // Brandon's 8:26 AM Fidelis call: rung in the browser, unanswered, voicemail
  // took it — and RingCentral logged ONE Outbound record toward the caller.
  // The repair is only safe if every loader applies it: an inversion the list
  // shows and the resolve's own loader cannot see is a resolve that validates
  // against different events than the rep was shown.

  it("loadGroupAll (the timeline): reads BOTH end states and partitions them between the two rules", () => {
    const body = fnBody("loadGroupAll");
    expect(body).toMatch(/state IN \('answered','missed'\)/);
    // Inversion takes the missed ends, pickups the answered — never both to either.
    expect(body).toMatch(
      /markBrowserPickups\(\s*markInvertedInbound\(\s*dropOwn\(attributed\([\s\S]*?state === "missed"\)[\s\S]*?state !== "missed"\)/,
    );
    // optionalTable: a build without inboundCalls has no call_events, and
    // losing the relabel must never lose the timeline.
    const ce = body.indexOf("FROM call_events");
    expect(body.lastIndexOf("optionalTable(", ce)).toBeGreaterThan(-1);
  });

  it("loadInboundForList: the candidate arm is Outbound, non-fax, cover-claused, and label-pre-filtered by the rules' own list", () => {
    const body = fnBody("loadInboundForList");
    const cand = body.slice(body.indexOf("a.direction = 'Outbound'"));
    expect(cand).toContain("a.call_type IS DISTINCT FROM 'Fax'");
    expect(cand).toContain("COALESCE(cov.covered"); // same cover clause as the inbound arms
    // The connected-labels pre-filter appears on the inbound call arm AND the
    // candidate arm — a connected outbound call can never invert.
    expect(body.match(/= ANY\(\$3\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("⚠️ loadInboundForList's guard query is deliberately UN-covered — a resolved missed call's evidence must still be consumed", () => {
    const body = fnBody("loadInboundForList");
    const guard = body.slice(body.indexOf("kind = 'end' AND state = 'missed'"), body.indexOf("comms_dials"));
    expect(guard).toContain("direction = 'Inbound'");
    expect(guard).not.toContain("cov."); // no COVER_CTE join — covered calls ARE the point
    // …and candidates carry who dialed, so a pressed call never inverts.
    expect(body).toContain("e.dialedBy = dialerFor(e, dialList);");
    // Only a candidate that really inverted joins the list.
    expect(body).toMatch(/inverted\.filter\(\(e\) => !\(e\.kind === "call" && e\.dir === "out"\)\)/);
  });

  it("loadOpening (what a resolve validates against): same candidates, same evidence, the epoch-bound inbound arm as the guard", () => {
    const body = fnBody("loadOpening");
    expect(body).toContain("direction = 'Outbound'");
    expect(body).toMatch(/kind = 'end' AND state = 'missed'/);
    expect(body).toContain("e.dialedBy = dialerFor(e, dialList);");
    // Two args: events already hold every inbound call since the epoch,
    // un-covered, so the default guard IS the guard.
    expect(body).toMatch(/markInvertedInbound\(\[\.\.\.events, \.\.\.candidates\], evid\.rows\)/);
    expect(body).toMatch(/inverted\.filter\(\(e\) => !\(e\.kind === "call" && e\.dir === "out"\)\)/);
  });

  it("⚠️ computeSnapshot never carries one rc_call_id twice — the inverted copy wins over loadOutbound's raw one", () => {
    const body = fnBody("computeSnapshot");
    expect(body).toMatch(/const seenCalls = new Set\(inbound\.filter\(\(e\) => e\.kind === "call"\)/);
    expect(body).toMatch(/loadOutbound\(pool, openHmacs, since\)\)\.filter\(\s*\(e\) => !\(e\.kind === "call" && seenCalls\.has\(String\(e\.id\)\)\)/);
  });

  it("the evidence index is guarded on to_regclass and OUTSIDE SCHEMA — call_events belongs to inboundCalls and may not exist", () => {
    const schema = SRC.slice(SRC.indexOf("export const SCHEMA"), SRC.indexOf("`;", SRC.indexOf("export const SCHEMA")));
    expect(schema).not.toContain("call_events");
    const c = code(SRC);
    const gate = c.indexOf("to_regclass('call_events')");
    const idx = c.indexOf("CREATE INDEX IF NOT EXISTS call_events_end_state_at_idx");
    expect(gate).toBeGreaterThan(0);
    expect(idx).toBeGreaterThan(gate);
    expect(c.slice(idx, idx + 200)).toContain("WHERE kind = 'end'");
  });
});

/* ── the resolve ─────────────────────────────────────────────────────────── */

describe("⚠️ a resolve is a compare-and-set under a lock", () => {
  const body = routeBody("post", "/comms/resolve");
  it("locks every number of the item, in a fixed order, inside one transaction", () => {
    expect(body).toMatch(/\.sort\(\)/);
    expect(body).toMatch(/BEGIN/);
    expect(body).toMatch(/pg_advisory_xact_lock/);
  });
  it("re-reads the item UNDER the lock and asks planResolve before writing", () => {
    const lock = body.indexOf("pg_advisory_xact_lock");
    const read = body.indexOf("loadOpening(client");
    const plan = body.indexOf("planResolve(");
    const insert = body.indexOf("INSERT INTO comms_resolutions");
    expect(lock).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(lock);
    expect(plan).toBeGreaterThan(read);
    expect(insert).toBeGreaterThan(plan);
  });
  it("writes one row per number with ONE resolution id", () => {
    // One id per click, minted BEFORE the per-number loop.
    expect(body.match(/crypto\.randomUUID\(\)/g)?.length).toBe(1);
    expect(body).toMatch(/const rid = crypto\.randomUUID\(\);[\s\S]{0,600}?for \(const n of numbers\)/);
  });
  it("attributes the row to the VERIFIED caller, never to anything the body claims", () => {
    expect(body).toMatch(/who,\s*\n?\s*noteAt \? noteAt\.boardId/);
    expect(body).not.toMatch(/req\.body\??\.(by|resolvedBy|email)/);
  });
  it("⚠️ the note's record goes through noteTargetFor — never straight from the body", () => {
    expect(body).toContain("const noteAt = noteTargetFor(target, req.body?.noteTarget);");
    expect(body).not.toMatch(/req\.body\??\.noteTarget\??\.(boardId|itemId)/);
  });
});

/* ── the 2026-09-23 review ───────────────────────────────────────────────── */

describe("⚠️ the 2026-09-23 review's gateway findings stay fixed", () => {
  const c = code(SRC);

  it("the tick's pages are deduped before any archive's multi-row upsert sees them", () => {
    const body = fnBody("readWindow");
    // Every exit returns the deduped list — one repeat used to fail the tick.
    expect(body.match(/return dedupeRecords\(records\)/g)?.length).toBe(3);
    expect(body).not.toMatch(/return records;/);
  });

  it("⚠️ every call_archive read leaves the FAXES out — the call log carries them", () => {
    const reads = [...c.matchAll(/FROM call_archive[\s\S]{0,1500}?`/g)].map((m) => m[0]);
    // resolveNumbers' UNION is the one read that is not a list of calls: it
    // only fetches the newest record id to recover a number in the clear, and
    // a fax's record carries the number as well as a call's does.
    const lists = reads.filter((r) => !/^FROM call_archive WHERE phone_hmac = \$1`$/.test(r));
    expect(lists.length).toBeGreaterThanOrEqual(5);
    for (const r of lists) expect(r, r.slice(0, 80)).toMatch(/call_type IS DISTINCT FROM 'Fax'/);
  });

  it("⚠️ our own lines are dropped before the rules are asked — the rules never see a number", () => {
    for (const f of ["loadInboundForList", "loadOpening", "loadGroupAll"]) expect(fnBody(f), f).toMatch(/dropOwn\(/);
    expect(routeBody("get", "/comms/shadow-report")).toMatch(/dropOwn\(/);
    expect(c).toMatch(/ourNumbers\(\)/);
  });

  it("⚠️ a cached Monday HIT expires — it must not outlive the patient's number", () => {
    const body = fnBody("lookupUnknown");
    expect(body).toMatch(/CASE WHEN found THEN \$3 ELSE \$2 END/);
    expect(body).toMatch(/FOUND_RECHECK_MS/);
    expect(body).not.toMatch(/\(found OR checked_at/);
  });

  it("⚠️ the columns it reads on tables it does not own are ensured, IF the table exists", () => {
    const schema = SRC.slice(SRC.indexOf("export const SCHEMA = `"), SRC.indexOf("`;", SRC.indexOf("export const SCHEMA = `")));
    expect(schema).toMatch(/ALTER TABLE IF EXISTS patient_directory ADD COLUMN IF NOT EXISTS group_id TEXT;/);
    expect(schema).toMatch(/ALTER TABLE IF EXISTS call_archive ADD COLUMN IF NOT EXISTS call_type TEXT;/);
  });

  it("⚠️ an archive table that was never created reads as empty — never a 500, never an aborted resolve", () => {
    for (const f of ["loadInboundForList", "loadOutbound", "loadGroupAll"]) expect(fnBody(f), f).toMatch(/archivesPresent\(pool\)/);
    // The resolve asks BEFORE its transaction, so a missing table is skipped
    // rather than aborting everything after it.
    const resolve = routeBody("post", "/comms/resolve");
    expect(resolve.indexOf("archivesPresent(pool)")).toBeGreaterThan(0);
    expect(resolve.indexOf("archivesPresent(pool)")).toBeLessThan(resolve.indexOf("pool.connect()"));
    expect(fnBody("loadOpening")).toMatch(/!has\.calls/);
  });

  it("⚠️ loadOpening runs ONE query at a time — it is given the resolve's transaction client", () => {
    expect(fnBody("loadOpening")).not.toMatch(/Promise\.all/);
  });

  it("⚠️ a snapshot computed before a write can never be stored after it", () => {
    const inv = fnBody("invalidate");
    expect(inv).toMatch(/snapGen \+= 1/);
    const snap = fnBody("snapshot");
    expect(snap).toMatch(/if \(gen === snapGen\) snap = s;/);
    expect(snap).toMatch(/snapInflight\.gen !== snapGen/);
  });

  it("⚠️ /comms/mirror validates the id itself, and 'done' needs a live claim on a standing resolution", () => {
    const body = routeBody("post", "/comms/mirror");
    const check = body.indexOf("UUID.test(rid)");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(body.indexOf('action === "claim"'));
    const done = body.slice(body.indexOf('action === "done"'), body.indexOf('action === "error"'));
    expect(done).toMatch(/undone_at IS NULL/);
    expect(done).toMatch(/mirror_claimed_at IS NOT NULL/);
  });

  it("⚠️ the unauthenticated health route never sends the database's own words (Greptile, PR #58)", () => {
    const body = routeBody("get", "/comms/inbox-health");
    const catchPart = body.slice(body.lastIndexOf("catch (e)"));
    expect(catchPart).not.toMatch(/e\.message\) \|\| e\) \}\)/);
    expect(catchPart).toMatch(/"Health check failed"/);
    // …and the tick stores only a database error's SQLSTATE, since health
    // reads that row back.
    expect(fnBody("captureTick")).toMatch(/database error \$\{e\.code\}/);
  });

  it("⚠️ a forced tick is AUTHENTICATED and RATE-FLOORED — both (§5.27)", () => {
    const body = routeBody("post", "/comms/tick");
    expect(body.indexOf("caller(req, res)")).toBeGreaterThan(0);
    expect(body).toMatch(/TICK_FORCE_MIN_GAP_MS/);
    expect(body).toMatch(/status\(429\)/);
    expect(body.indexOf("status(429)")).toBeLessThan(body.indexOf("captureTick("));
  });
});

/* ── template-literal SQL ────────────────────────────────────────────────── */

describe("the numbers a page already holds", () => {
  it("/comms/state keeps them in MEMORY only, so the item it names can show its full number", () => {
    const body = routeBody("post", "/comms/state");
    expect(body).toContain("for (const n of raw) remember(n, phoneHmac(n));");
    // …and never writes them anywhere.
    expect(body).not.toMatch(/INSERT|UPDATE/);
  });
});

describe("⚠️ SQL in template literals", () => {
  it("both files parse — a stray backtick inside SQL ends the literal early", () => {
    for (const f of ["commsInbox.mjs", "commsInboxRules.mjs", "messaging.mjs"]) {
      expect(() => execFileSync(process.execPath, ["--check", resolve(DIR, f)], { stdio: "pipe" }), f).not.toThrow();
    }
  });
});
