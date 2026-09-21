import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_ATTEMPTS,
  RECORDING_GAP_MS,
  URL_TTL_SECONDS,
  archiveHealth,
  counterpartyNumber,
  extensionFor,
  fallbackFilename,
  last4,
  nextAudioState,
  objectKey,
  recordingOf,
  shouldDeepScan,
  toCallRow,
  windowStart,
} from "./callArchiveRules.mjs";

/** Same shape as smsArchiveRules.test.mjs: resolve from the repo root, since
 *  import.meta.url is not a file: URL under the jsdom environment. */
const gatewaySrc = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");

const call = (over = {}) => ({
  id: "c1",
  startTime: "2026-09-21T16:30:00.000Z",
  direction: "Inbound",
  duration: 393,
  result: "Accepted",
  from: { phoneNumber: "+15555550101" },
  to: { phoneNumber: "+13475037148" },
  ...over,
});

describe("finding the recording", () => {
  it("takes one hanging off the parent", () => {
    expect(recordingOf(call({ recording: { id: "9", contentUri: "https://media/x/content" } }))?.id).toBe("9");
  });

  // ⚠️ The everyday case for a claimed inbound call: forwarding tears down the
  // parent leg, so the audio hangs off the LEG. A parent-only read archives
  // nothing for exactly the calls a rep took by pressing "Take it".
  it("falls through to the LEG that actually carried the audio", () => {
    const c = call({
      legs: [{ result: "Missed" }, { result: "Accepted", recording: { id: "7", contentUri: "https://media/y/content" } }],
    });
    expect(recordingOf(c)?.id).toBe("7");
  });

  it("is null when nothing carries one", () => {
    expect(recordingOf(call({ legs: [{ result: "Missed" }] }))).toBeNull();
  });

  it("ignores a recording object with no contentUri — there is nothing to fetch", () => {
    expect(recordingOf(call({ recording: { id: "9" } }))).toBeNull();
  });
});

describe("the counterparty", () => {
  // ⚠️ Reading one field for both directions collapses every call onto our own
  // main line, which is §5.13's trap on the live-call cards.
  it("is `from` on an inbound call and `to` on an outbound one", () => {
    expect(counterpartyNumber(call({ direction: "Inbound" }))).toBe("+15555550101");
    expect(counterpartyNumber(call({ direction: "Outbound" }))).toBe("+13475037148");
  });

  it("is blank rather than throwing when a side carries no number", () => {
    expect(counterpartyNumber(call({ direction: "Inbound", from: {} }))).toBe("");
    expect(counterpartyNumber(call({ direction: "Inbound", from: undefined }))).toBe("");
  });
});

describe("toCallRow", () => {
  it("marks a recorded call pending and carries both surviving ids", () => {
    const r = toCallRow(
      call({
        telephonySessionId: "sess-1",
        recording: { id: "99", contentUri: "https://media.ringcentral.com/x/content" },
      }),
    );
    expect(r).toMatchObject({
      rcCallId: "c1",
      rcSessionId: "sess-1",
      rcRecordingId: "99",
      audioState: "pending",
      direction: "Inbound",
      durationSec: 393,
      last4: "0101",
    });
  });

  // ⚠️ Every call is kept, recorded or not: RingCentral's call LOG ages out
  // too, and other services read this for "who called and when".
  it("keeps a call that was never recorded, as `none`", () => {
    const r = toCallRow(call());
    expect(r.audioState).toBe("none");
    expect(r.rcRecordingId).toBeNull();
    expect(r.contentUri).toBeNull();
  });

  it("falls back to sessionId when there is no telephonySessionId", () => {
    expect(toCallRow(call({ sessionId: "s2" })).rcSessionId).toBe("s2");
  });

  it("refuses a record with no id or no usable start time", () => {
    expect(toCallRow(call({ id: "" }))).toBeNull();
    expect(toCallRow(call({ startTime: "" }))).toBeNull();
    expect(toCallRow(call({ startTime: "not a date" }))).toBeNull();
    expect(toCallRow(null)).toBeNull();
  });

  // The verdict rule lives in lib/callHistory/callHistory.ts; a second copy
  // here in another language is the hand-synced-mirror hazard. The raw legs are
  // carried instead so a consumer can apply it without a second RC call.
  it("carries the raw leg results rather than a computed verdict", () => {
    const r = toCallRow(call({ legs: [{ result: "Missed" }, { result: "Accepted" }] }));
    expect(r.legResults).toEqual(["Missed", "Accepted"]);
    expect(r).not.toHaveProperty("connected");
  });

  it("never carries a hash — hashing is the caller's job, with the shared pepper", () => {
    expect(toCallRow(call())).not.toHaveProperty("phoneHmac");
  });
});

describe("objectKey", () => {
  it("partitions by UTC date and names both ids", () => {
    expect(objectKey({ startedAt: "2026-09-21T16:30:00.000Z", rcCallId: "c1", rcRecordingId: "99", ext: "mp3" }))
      .toBe("recordings/2026/09/21/c1_99.mp3");
  });

  // ⚠️ UTC, not Eastern. A RingCentral startTime is a real instant, and UTC has
  // no DST gap or overlap, so partition boundaries stay derivable by anyone.
  it("uses the UTC day even when Eastern would disagree", () => {
    // 00:30Z on the 22nd is 20:30 ET on the 21st.
    expect(objectKey({ startedAt: "2026-09-22T00:30:00.000Z", rcCallId: "c1", rcRecordingId: "9" }))
      .toContain("2026/09/22/");
  });

  it("cannot smuggle a path separator out of an id", () => {
    const k = objectKey({ startedAt: "2026-09-21T16:30:00.000Z", rcCallId: "../../etc/passwd", rcRecordingId: "a/b" });
    expect(k).toBe("recordings/2026/09/21/etcpasswd_ab.mp3");
  });

  it("is null without the ingredients to be unique", () => {
    expect(objectKey({ startedAt: "2026-09-21T16:30:00.000Z", rcCallId: "" })).toBeNull();
    expect(objectKey({ startedAt: "nope", rcCallId: "c1" })).toBeNull();
  });

  it("is stable, so a retried upload overwrites rather than duplicating", () => {
    const a = objectKey({ startedAt: "2026-09-21T16:30:00.000Z", rcCallId: "c1", rcRecordingId: "99" });
    const b = objectKey({ startedAt: "2026-09-21T16:30:00.000Z", rcCallId: "c1", rcRecordingId: "99" });
    expect(a).toBe(b);
  });
});

describe("extensionFor", () => {
  // ⚠️ Per-ACCOUNT, not per-call: a hardcoded .mp3 produces a file that will
  // not open on exactly the accounts where it is wrong.
  it("reads what RingCentral sent and never assumes", () => {
    expect(extensionFor("audio/wav")).toBe("wav");
    expect(extensionFor("audio/x-wav")).toBe("wav");
    expect(extensionFor("audio/mpeg")).toBe("mp3");
    expect(extensionFor("audio/mpeg; charset=binary")).toBe("mp3");
    expect(extensionFor(undefined)).toBe("mp3");
  });

  it("agrees with the SPA's copy, which names the download", () => {
    const spa = readFileSync(resolve(process.cwd(), "src/lib/callHistory/recordingDownload.ts"), "utf8");
    for (const t of ["audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/mp4", "audio/x-m4a"]) {
      expect(spa).toContain(t);
    }
  });
});

describe("nextAudioState", () => {
  // ⚠️ `gone` is terminal and nothing ever retries it, so it is only ever
  // reached on POSITIVE evidence from RingCentral.
  it("is `gone` only on a 404/410", () => {
    expect(nextAudioState({ status: 404, attempts: 1 })).toBe("gone");
    expect(nextAudioState({ status: 410, attempts: 1 })).toBe("gone");
  });

  // A 403 is the ReadCallRecording permission — a fault to fix, not a purge.
  // Marking it `gone` would abandon every recording on the account.
  it("is NOT gone on a 403, a 429 or a 500", () => {
    for (const status of [403, 429, 500, 502]) {
      expect(nextAudioState({ status, attempts: 1 })).toBe("pending");
    }
  });

  it("parks as `failed` only once the attempts are spent", () => {
    expect(nextAudioState({ status: 500, attempts: MAX_ATTEMPTS - 1 })).toBe("pending");
    expect(nextAudioState({ status: 500, attempts: MAX_ATTEMPTS })).toBe("failed");
  });

  it("prefers gone over failed — a purge is an answer, not a giving-up", () => {
    expect(nextAudioState({ status: 404, attempts: MAX_ATTEMPTS + 5 })).toBe("gone");
  });
});

describe("pacing", () => {
  // ⚠️⚠️ RingCentral puts recording content in the HEAVY group — 10 req/60s —
  // four times tighter than the gateway's own 40/min per-caller budget, which
  // rcLimiter alone would happily allow.
  it("stays under 10 requests a minute", () => {
    expect(RECORDING_GAP_MS).toBeGreaterThanOrEqual(6_000);
    expect(60_000 / RECORDING_GAP_MS).toBeLessThanOrEqual(10);
  });

  it("caps a presigned URL's life at an hour however the env is set", () => {
    expect(URL_TTL_SECONDS).toBeLessThanOrEqual(3600);
    expect(URL_TTL_SECONDS).toBeGreaterThanOrEqual(30);
  });
});

describe("windowStart / shouldDeepScan", () => {
  it("counts back whole days from now", () => {
    const now = Date.parse("2026-09-21T12:00:00.000Z");
    expect(windowStart(now, 2)).toBe("2026-09-19T12:00:00.000Z");
  });

  it("deep-scans when none has ever run", () => {
    expect(shouldDeepScan({ lastDeepAt: null })).toBe(true);
    expect(shouldDeepScan({ lastDeepAt: "not a date" })).toBe(true);
  });

  it("deep-scans once the last one is older than the interval", () => {
    const now = Date.parse("2026-09-21T12:00:00.000Z");
    expect(shouldDeepScan({ lastDeepAt: "2026-09-21T11:00:00.000Z", now, everyMs: 20 * 3600_000 })).toBe(false);
    expect(shouldDeepScan({ lastDeepAt: "2026-09-20T00:00:00.000Z", now, everyMs: 20 * 3600_000 })).toBe(true);
  });
});

describe("archiveHealth", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const healthy = {
    lastOkAt: "2026-09-21T11:30:00.000Z",
    lastDeepOkAt: "2026-09-21T02:00:00.000Z",
    rows: 1000,
    stored: 900,
    pending: 0,
    failed: 0,
    gone: 100,
    now,
  };

  it("is ok when runs are landing and nothing is stuck", () => {
    expect(archiveHealth(healthy).ok).toBe(true);
  });

  // ⚠️ A job deployed but never actually running must not read healthy on an
  // empty table — that is the failure this whole check exists for.
  it("is NOT ok when no run has ever succeeded, however many rows exist", () => {
    const h = archiveHealth({ ...healthy, lastOkAt: null, rows: 50_000 });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/no successful run/i);
  });

  it("is NOT ok when the last success is stale", () => {
    const h = archiveHealth({ ...healthy, lastOkAt: "2026-09-19T12:00:00.000Z" });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/last successful run was \d+h ago/);
  });

  // ⚠️ A truncated pass COMPLETED — it just did not read the whole repair
  // window. The run is still recorded ok, so the verdict has to be made here or
  // a clipped archive reports healthy while what it never reached ages out.
  it("is NOT ok when the last deep pass hit the page ceiling", () => {
    const h = archiveHealth({ ...healthy, lastDeepTruncated: true });
    expect(h.ok).toBe(false);
    expect(h.truncated).toBe(true);
    expect(h.reason).toMatch(/ceiling/);
  });

  it("is NOT ok while anything is parked as failed", () => {
    const h = archiveHealth({ ...healthy, failed: 3 });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/3 recording\(s\)/);
  });

  // ⚠️ A backlog is what a backfill LOOKS like. Alerting on it would page for a
  // working system; what matters is whether it is moving, which
  // oldestPendingHours exposes for a monitor to threshold on.
  it("is still ok with a pending backlog, and says how old the oldest is", () => {
    const h = archiveHealth({ ...healthy, pending: 4000, oldestPendingAt: "2026-09-20T12:00:00.000Z" });
    expect(h.ok).toBe(true);
    expect(h.pending).toBe(4000);
    expect(h.oldestPendingHours).toBe(24);
  });

  it("reports counts and never anything identifying", () => {
    const h = archiveHealth(healthy);
    const json = JSON.stringify(h);
    expect(json).not.toMatch(/@/);
    expect(Object.keys(h)).not.toContain("phone");
    expect(Object.keys(h)).not.toContain("callId");
  });
});

describe("fallbackFilename", () => {
  it("carries no more than four digits of a number", () => {
    const n = fallbackFilename({ startedAt: "2026-09-21T16:30:00.000Z", direction: "Inbound", last4: "0101", ext: "mp3" });
    expect(n).toBe("call_2026-09-21-16-30Z_inbound_x0101.mp3");
    expect(n).not.toContain("5555550101");
  });

  it("survives an unusable timestamp", () => {
    expect(fallbackFilename({ startedAt: "nope", direction: "Outbound", ext: "wav" })).toContain("undated");
  });
});

describe("last4", () => {
  it("is a display hint taken from the last ten digits, whatever the shape", () => {
    expect(last4("+1 (555) 555-0101")).toBe("0101");
    expect(last4("5555550101")).toBe("0101");
    expect(last4("")).toBe("");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Source scans — the invariants that live in SQL and ordering rather than in a
 * pure function, and whose breakage is silent in production. Same convention as
 * listColumns.test.ts and smsArchiveRules.test.mjs.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("callArchive.mjs invariants", () => {
  const src = gatewaySrc("callArchive.mjs");

  // ⚠️⚠️ The single fatal schema decision: after the purge the call-log row
  // survives and the recording object does not, so a recording-keyed archive is
  // unjoinable exactly when it becomes useful.
  it("keys the table on the CALL id, not the recording id", () => {
    expect(src).toMatch(/rc_call_id\s+TEXT PRIMARY KEY/);
    expect(src).not.toMatch(/rc_recording_id\s+TEXT PRIMARY KEY/);
  });

  // ⚠️ A scan re-reading a stored call must not reset it to pending (infinite
  // re-download), and a PURGED recording comes back from the log as `none`,
  // which must not erase the fact that a recording existed.
  it("lets the scan move only `none` → `pending`, never anything else", () => {
    const sql = src.slice(src.indexOf("function upsertSql"), src.indexOf("async function upsertRows"));
    expect(sql).toMatch(/audio_state\s*=\s*CASE/);
    expect(sql).toMatch(/call_archive\.audio_state\s*=\s*'none'\s*AND\s*EXCLUDED\.audio_state\s*=\s*'pending'/);
    expect(sql).toMatch(/ELSE call_archive\.audio_state/);
  });

  // ⚠️ Oldest is closest to deletion. Newest-first archives what has ninety
  // days left and loses what had one.
  it("drains the queue oldest-first", () => {
    expect(src).toMatch(/audio_state = 'pending'[\s\S]{0,200}ORDER BY started_at ASC/);
  });

  // ⚠️ The other order marks a recording safe that is not in the bucket.
  it("writes the object BEFORE marking the row stored", () => {
    const put = src.indexOf("await putObject(");
    const mark = src.indexOf("audio_state = 'stored'");
    expect(put).toBeGreaterThan(0);
    expect(mark).toBeGreaterThan(put);
  });

  // ⚠️ A 200 is not audio: an XML/HTML error body served with a 200 is the trap
  // fetchAssetBytes documents, and storing one loses the recording while
  // reporting success.
  it("refuses a 200 that is not audio, and a zero-byte body", () => {
    expect(src).toMatch(/\^audio\\\//);
    expect(src).toMatch(/body\.length === 0/);
  });

  // ⚠️ Bulk work with nobody waiting must be shed before a rep's interactive
  // call — INCIDENT_2026-08-20's lesson.
  it("reads RingCentral on the background tier, both the log and the audio", () => {
    const tiers = src.match(/tier: "background"/g) || [];
    expect(tiers.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/tier: "critical"/);
  });

  // ⚠️ A presigned URL is a bearer credential for PHI; an untracked one is
  // indistinguishable from a leak.
  it("writes an access row for every recording served", () => {
    expect(src).toMatch(/INSERT INTO call_archive_access/);
    const serve = src.slice(src.indexOf('app.get("/calls/recording"'));
    const audit = serve.indexOf("call_archive_access");
    const presign = serve.indexOf("await presignGet(");
    const proxy = serve.indexOf("getObjectStream(");
    expect(audit).toBeGreaterThan(0);
    expect(audit).toBeLessThan(presign);
    expect(audit).toBeLessThan(proxy);
  });

  it("does not cache a redirect that carries a credential", () => {
    expect(src).toMatch(/Cache-Control", "no-store/);
  });

  // ⚠️ Auth alone would not have stopped 2026-08-20 — that client was
  // authenticated. The floor is the other half.
  it("gates the forced run on BOTH a caller and a rate floor", () => {
    const route = src.slice(src.indexOf('app.post("/calls/archive-run"'), src.indexOf('app.get("/calls/recording"'));
    expect(route).toMatch(/await caller\(req, res\)/);
    expect(route).toMatch(/FORCE_MIN_GAP_MS/);
    expect(route).toMatch(/lastForcedAt = Date\.now\(\)/);
  });

  // ⚠️ The same PHI bound every other table on this pool keeps.
  it("stores the counterparty hashed, never in the clear", () => {
    const schema = src.slice(src.indexOf("CREATE TABLE IF NOT EXISTS call_archive ("), src.indexOf("CREATE INDEX"));
    expect(schema).toMatch(/phone_hmac\s+TEXT/);
    expect(schema).not.toMatch(/\bphone\s+TEXT/);
    expect(schema).not.toMatch(/phone_number/);
    expect(src).toMatch(/import \{ phoneHmac \} from "\.\/phoneHash\.mjs"/);
  });

  // ⚠️ It must land beside sent_messages, not on the audit Postgres, which
  // keeps its "metadata only, no PHI" property.
  it("is registered from messaging.mjs so it lands on the messaging pool", () => {
    const messaging = gatewaySrc("messaging.mjs");
    expect(messaging).toMatch(/registerCallArchive\(\{ app, pool, requireCaller \}\)/);
    const index = gatewaySrc("index.mjs");
    expect(index).not.toMatch(/registerCallArchive/);
  });

  it("can be killed from Railway without a revert", () => {
    expect(src).toMatch(/CALL_ARCHIVE_ENABLED === "0"/);
  });

  // ⚠️ A gateway with no bucket must still boot and carry patient texting.
  it("degrades to a warning rather than throwing when no bucket is configured", () => {
    const reg = src.slice(src.indexOf("export function registerCallArchive"));
    expect(reg).toMatch(/if \(!storeConfigured\(\)\) \{\s*\n\s*\/\/[\s\S]{0,400}console\.warn/);
  });

  it("reports the audio state rather than flattening every miss to a 404", () => {
    expect(src).toMatch(/audioState: row\.audio_state/);
  });
});

describe("rcMediaFetch is the one door to RingCentral media", () => {
  const src = gatewaySrc("ringcentral.mjs");

  it("is exported, allowlist-checked and budgeted", () => {
    expect(src).toMatch(/export async function rcMediaFetch/);
    const fn = src.slice(src.indexOf("export async function rcMediaFetch"), src.indexOf("const _seenGroups"));
    expect(fn).toMatch(/fetchUrlAllowed\(u\)/);
    expect(fn).toMatch(/rcGuard\.check\(/);
    expect(fn).toMatch(/rcGuard\.note\(/);
    expect(fn).toMatch(/status === 401/);
  });

  // ⚠️ "Duplicating the token handling here is what let it be an unguarded
  // second door" — this file's own words. The proxy route and the archive job
  // must not each have their own.
  it("is what the /rc/fetch proxy uses, so there is no second door", () => {
    const route = src.slice(src.indexOf('if (req.path === "/rc/fetch")'));
    expect(route).toMatch(/await rcMediaFetch\(/);
    expect(route).not.toMatch(/await rcAccessToken\(\)/);
  });

  it("logs the rate-limit group RingCentral reports, so the gap can be settled by measurement", () => {
    expect(src).toMatch(/x-rate-limit-group/);
  });
});
