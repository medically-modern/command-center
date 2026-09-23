/**
 * commsInbox.mjs — the Communications inbox, "the Unresolved queue"
 * (COMMS_INBOX_PLAN.md; Brandon + Katie's v2, 2026-09-22; Josh's answers,
 * 2026-09-23).
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * A patient texts, a rep calls them back, and nothing anywhere can tell
 * "handled" from "missed". Unread was the only signal, and it is RingCentral's
 * per-message read flag — shared with the RingCentral desktop app, cleared by
 * anybody who opens the thread, and blind to a callback. This module is the
 * shared, durable state that replaces it: every inbound text, missed call and
 * voicemail opens an item for that patient, and a person closes it with one
 * click that says HOW — Called (with a note), Texted, No action needed.
 *
 * ── What it owns, and what it deliberately doesn't ──────────────────────────
 * It keeps NO copy of the events. Texts, calls, voicemails and photos are
 * already archived on this pool (§5.27, §5.47, §5.47b, §5.47c); what they
 * lacked was freshness, so this adds a 60-second CAPTURE TICK that reads
 * RingCentral's last two hours and hands every record to its OWNING archive's
 * own upsert (`archiveTextRecords`, `archiveCallRecords`,
 * `archiveVoicemailRecords`). Each table keeps exactly one writer, and each
 * archive's invariants — a scan may only move `none` → `pending`, a delivery
 * verdict is DO UPDATE — hold whoever is scanning.
 *
 * Its own tables are only what is new: the resolutions and their inline notes,
 * "this number is that patient" links, who pressed Call, a cache of live
 * Monday lookups, and a run ledger.
 *
 * ── ⚠️ PHI, and where it lives ──────────────────────────────────────────────
 * One new category lands on this pool: the rep's NOTE — the same kind of thing
 * as `sms_archive.body` and `voicemail_archive.transcript`, both accepted
 * explicitly. Two bounds apply and are not optional, exactly as for every table
 * beside these:
 *   · the MESSAGING pool (ASSIGNMENTS_DATABASE_URL), never the audit pool —
 *     which is why this is registered from messaging.mjs; do not move it;
 *   · HMAC + last4, NEVER a phone number in the clear. A number is only ever
 *     held in memory (to show an unmatched caller's full number once opened).
 *
 * ── ⚠️ No RingCentral on the list, the count or a resolve ───────────────────
 * The badge is on every page for every rep. A count that polled RingCentral's
 * three lists from each browser is INCIDENT_2026-08-20's shape; here every
 * list, count and resolve route is Postgres only, and the tick is the one
 * RingCentral reader — about two requests a minute on the background tier,
 * shed first and never retried hot. `commsInbox.test.mjs` scans for it.
 *
 * ── Switched off by default ─────────────────────────────────────────────────
 * `COMMS_INBOX_ENABLED=1` starts the tick and the routes (phase 1, "shadow
 * mode"); `COMMS_INBOX_UI=1` tells the SPA to show the Inbox (phase 2). With
 * either unset the Command Center behaves exactly as before. The health route
 * answers even when the module is off, so switching it off during an incident
 * reads as "off, on purpose" rather than a fresh alert.
 */
import crypto from "node:crypto";
import { verifyGoogleIdentity } from "./auth.mjs";
import { rcApiFetch, rcConfigured } from "./ringcentral.mjs";
import { hashingConfigured, phoneHmac, toE164 } from "./phoneHash.mjs";
import { archiveTextRecords, ourNumbers } from "./smsArchive.mjs";
import { archiveCallRecords } from "./callArchive.mjs";
import { archiveVoicemailRecords } from "./voicemailArchive.mjs";
import { lookupNumbersLive } from "./patientDirectory.mjs";
import { counterparty as textCounterparty } from "./smsArchiveRules.mjs";
import { counterpartyNumber as callCounterparty } from "./callArchiveRules.mjs";
import { counterpartyNumber as vmCounterparty } from "./voicemailArchiveRules.mjs";
import { senderFor, senderIndex } from "./sentAttribution.mjs";
import {
  AUTOMATION_REPLY_WINDOW_MS,
  CONNECTED_RESULT_LABELS,
  DISPLAY_WINDOW_MS,
  HOW_LABEL,
  MAX_MIRROR_ATTEMPTS,
  STALE_CLAIM_MS,
  badgeCounts,
  buildInbox,
  buildTimeline,
  callEvent,
  canAddNote,
  canUndo,
  dedupeRecords,
  dialerFor,
  filterInbox,
  groupKeyFor,
  inboxHealth,
  itemState,
  mirrorPending,
  normalizeNote,
  noteTargetFor,
  opensItem,
  parseKey,
  planResolve,
  resolutionFromRow,
  resolveTarget,
  shadowReport,
  slaReport,
  stagePill,
  textEvent,
  toMs,
  voicemailEvent,
} from "./commsInboxRules.mjs";

/* ────────────────────────────────────────────────────────────────────────────
 * Configuration
 * ──────────────────────────────────────────────────────────────────────────── */

const ENABLED = process.env.COMMS_INBOX_ENABLED === "1";
const UI = process.env.COMMS_INBOX_UI === "1";
/** How often the capture tick runs. A minute is what "the list is live" means. */
const TICK_MS = Math.max(Number(process.env.COMMS_INBOX_TICK_SECONDS) || 60, 15) * 1000;
/** How far back each tick reads. Reconcile, never increment: two hours of
 *  overlap means any successful tick repairs every missed tick before it, and
 *  the archives' own hourly and daily passes repair anything older. */
const TICK_WINDOW_MS = Math.max(Number(process.env.COMMS_INBOX_TICK_WINDOW_MINUTES) || 120, 10) * 60_000;
const TICK_PAGE_SIZE = 250;
/** Two hours is a page or two on the busiest afternoon; hitting this means
 *  something is wrong, and the run says so (`truncated`). */
const TICK_MAX_PAGES = 6;
/** The list and the badge share one computed snapshot, at most this stale —
 *  and every write invalidates it, so a resolve shows at once. */
const SNAPSHOT_TTL_MS = 10_000;
/** A number Monday knew nothing about is asked again after this, so a patient
 *  added this afternoon stops being "Unknown caller" without waiting a day. */
const LOOKUP_RECHECK_MS = 6 * 3600_000;
/**
 * A number Monday DID know is asked again after this — but only when it texts
 * or calls again, which is the only time the answer matters.
 *
 * ⚠️⚠️ A CACHED HIT MUST EXPIRE, or it outlives the patient's number. The
 * directory prunes a number once its patient has moved off it (§5.29), because
 * a stale row is a HIT and a hit is never re-asked; this cache holds the same
 * kind of answer for numbers the directory has not seen yet, and without an
 * age it kept mapping a reassigned number to its old patient for ever — a
 * stranger's texts filed under them, and a Called note copied to their Monday
 * record (2026-09-23 review). The directory's reconcile is daily, so a patient
 * a live lookup found has reached it by the time this runs out.
 */
const FOUND_RECHECK_MS = 24 * 3600_000;
const LOOKUP_BATCH = 25;
/** A forced tick is refused inside this gap: `running` coalesces only ticks
 *  that overlap, so a client posting again each time one finishes would get a
 *  full RingCentral read every time (§5.27's reason for flooring these). */
const TICK_FORCE_MIN_GAP_MS = 30_000;
/** How long the answer to "which archive tables exist?" is trusted. */
const PRESENCE_TTL_MS = 60_000;
const RUNS_KEEP_DAYS = 14;
const NUMBER_MEMORY_MAX = 5000;

/* ────────────────────────────────────────────────────────────────────────────
 * Schema
 *
 * ⚠️ Its OWN statement, deliberately not appended to another module's SCHEMA
 * template — index.mjs records why: that block ends in a DROP+CREATE VIEW which
 * takes every CREATE TABLE with it when it fails. And every SQL string in this
 * file is a JS template literal, so no backticks may appear inside one —
 * comments included (§5.47b records that one earning it the hard way).
 * ──────────────────────────────────────────────────────────────────────────── */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS comms_resolutions (
  id                BIGSERIAL PRIMARY KEY,
  -- One click = one id, with ONE ROW PER NUMBER in the patient's group. A
  -- patient is a new Monday item on every board, but a phone number survives
  -- the hop, so the number is the durable key and the group is worked out when
  -- the list is read.
  resolution_id     UUID NOT NULL,
  phone_hmac        TEXT NOT NULL,
  last4             TEXT,
  -- called | texted | no_action | left_vm (an attempt: it never closes).
  how               TEXT NOT NULL,
  -- The inline note. PHI, like sms_archive.body. Null for left_vm.
  note              TEXT,
  -- The newest inbound message the rep SAW. Anything newer reopens the item,
  -- which is what stops a text that lands while the rep types being swallowed.
  covers_through    TIMESTAMPTZ NOT NULL,
  resolved_by       TEXT NOT NULL,
  resolved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The patient record at the time, when matched: where the note is copied.
  item_board        BIGINT,
  item_id           TEXT,
  -- The copy to Monday is CLAIMED before it is written, so two open tabs can
  -- never write it twice; a claim that never reports back is released.
  mirror_claimed_at TIMESTAMPTZ,
  mirror_attempts   INT NOT NULL DEFAULT 0,
  mirrored_to       TEXT,
  mirror_error      TEXT,
  undone_by         TEXT,
  undone_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comms_resolutions_phone_idx ON comms_resolutions (phone_hmac, resolved_at DESC);
CREATE INDEX IF NOT EXISTS comms_resolutions_rid_idx   ON comms_resolutions (resolution_id);
CREATE INDEX IF NOT EXISTS comms_resolutions_at_idx    ON comms_resolutions (resolved_at DESC);

-- "This number is that patient", said by a rep. It also stores the patient's
-- own primary number (anchor_hmac), so the link follows them from board to
-- board instead of pinning them to the item it was made against.
CREATE TABLE IF NOT EXISTS comms_links (
  phone_hmac  TEXT PRIMARY KEY,
  last4       TEXT,
  anchor_hmac TEXT,
  board_id    BIGINT,
  item_id     TEXT,
  name        TEXT,
  linked_by   TEXT NOT NULL,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Monday's answer for a number the directory had not seen yet (a patient added
-- today). A miss is cached too, and asked again after a few hours.
CREATE TABLE IF NOT EXISTS comms_number_cache (
  phone_hmac TEXT PRIMARY KEY,
  last4      TEXT,
  found      BOOLEAN NOT NULL,
  name       TEXT,
  board_id   BIGINT,
  item_id    TEXT,
  board_name TEXT,
  group_id   TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who pressed Call. The line is one shared RingCentral extension, so the call
-- log cannot say who dialed; this is what makes "We called · Katie" possible.
CREATE TABLE IF NOT EXISTS comms_dials (
  id         BIGSERIAL PRIMARY KEY,
  phone_hmac TEXT NOT NULL,
  dialed_by  TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comms_dials_phone_idx ON comms_dials (phone_hmac, at DESC);

-- One row per capture tick. Pruned after a fortnight: it is operational
-- metadata, unlike the resolutions, which are kept for ever.
CREATE TABLE IF NOT EXISTS comms_inbox_runs (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok          BOOLEAN,
  texts       INT,
  calls       INT,
  voicemails  INT,
  looked_up   INT,
  truncated   BOOLEAN DEFAULT false,
  shed        BOOLEAN DEFAULT false,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS comms_inbox_runs_ok_idx ON comms_inbox_runs (ok, finished_at DESC);

-- Small settings that must survive a redeploy: the epoch, above all.
CREATE TABLE IF NOT EXISTS comms_inbox_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two columns this module READS on tables it does not own. Each owner adds its
-- own with the same idempotent statement; they are repeated here because an
-- owner switched off by its kill switch returns BEFORE its schema runs, and a
-- column this reads that is not there fails every list, count and resolve with
-- an undefined-column error, not an empty answer (2026-09-23 review). Adding a
-- nullable column is metadata-only, and IF EXISTS keeps both a no-op on a
-- database where the owner never ran at all.
ALTER TABLE IF EXISTS patient_directory ADD COLUMN IF NOT EXISTS group_id TEXT;
ALTER TABLE IF EXISTS call_archive ADD COLUMN IF NOT EXISTS call_type TEXT;
`;

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A read of a table ANOTHER module owns and may never have created.
 *
 * The patient directory and the photo archive each have a kill switch that
 * returns before their schema runs, so on a database where one was switched
 * off from the start the table does not exist. That costs the inbox names, or
 * the archive-first flag on photos — never the inbox itself — so a missing
 * table (Postgres 42P01) reads as empty. Every other error still throws.
 */
async function optionalTable(promise) {
  try {
    return await promise;
  } catch (e) {
    if (e && e.code === "42P01") return { rows: [] };
    throw e;
  }
}

/**
 * Which of the three archives this reads exist on this database.
 *
 * ⚠️ An archive whose kill switch was set from the START never runs its schema,
 * so its table is simply not there — and `optionalTable` cannot help inside the
 * resolve's transaction, where the first failed statement aborts everything
 * after it. So the tables are asked about UP FRONT, and a missing one reads as
 * no events of that kind: the inbox is blind to it, as `feedsOff` says, never
 * broken by it (2026-09-23 review). Cached a minute, because an archive
 * switched on later creates its table on its own boot.
 */
let presence = { at: 0, texts: true, calls: true, voicemails: true };
async function archivesPresent(pool) {
  if (Date.now() - presence.at < PRESENCE_TTL_MS) return presence;
  const q = await pool.query(
    `SELECT to_regclass('sms_archive') IS NOT NULL AS texts,
            to_regclass('call_archive') IS NOT NULL AS calls,
            to_regclass('voicemail_archive') IS NOT NULL AS voicemails`,
  );
  const r = q.rows[0] || {};
  presence = { at: Date.now(), texts: r.texts !== false, calls: r.calls !== false, voicemails: r.voicemails !== false };
  return presence;
}
const NONE = Promise.resolve({ rows: [] });

/**
 * Our own lines, hashed — they never open an item and are never a patient.
 *
 * ⚠️ `sms_archive` already refuses our own line as a text's counterparty, but
 * the call log and the voicemail box do not: a call from the main line to
 * itself (a test, a transfer) opened an "Unmatched" item. The rules never see a
 * number in the clear, so they cannot tell; this drops them before the rules
 * are asked (2026-09-23 review).
 */
let ownMemo = { key: "", set: new Set() };
function ownHmacs() {
  const nums = ourNumbers();
  const key = nums.join(",");
  if (ownMemo.key !== key) ownMemo = { key, set: new Set(nums.map((n) => phoneHmac(n)).filter(Boolean)) };
  return ownMemo.set;
}
const dropOwn = (events) => {
  const own = ownHmacs();
  return own.size ? events.filter((e) => !own.has(e.hmac)) : events;
};

/**
 * Which archives the tick may feed.
 *
 * ⚠️⚠️ EACH ARCHIVE'S KILL SWITCH IS HONOURED HERE TOO. The tick writes through
 * the archives' own upserts, so an archive switched off because its upsert
 * misbehaves would otherwise keep being written by this module every minute —
 * the switch would stop only half the writers. A feed that is off leaves the
 * inbox blind to that kind of event, and the health route says so, because a
 * list that quietly stops showing new texts looks exactly like a quiet day.
 */
export function feedsOff(env = process.env) {
  const off = [];
  if (env.SMS_ARCHIVE_ENABLED === "0") off.push("texts");
  if (env.CALL_ARCHIVE_ENABLED === "0") off.push("calls");
  if (env.VOICEMAIL_ARCHIVE_ENABLED === "0") off.push("voicemails");
  return off;
}

/**
 * A verified employee, or null after answering 401.
 *
 * ⚠️ HARD, unlike messaging.mjs' requireCaller, which lets a build with no
 * Google client id through as "unknown". Every write here is attributed —
 * resolutions are the SLA's record of WHO — and Undo is author-only, so an
 * anonymous caller is never acceptable. Same shape as inboundCalls.mjs.
 */
async function caller(req, res) {
  const u = await verifyGoogleIdentity(req.headers["x-mm-auth"]);
  const who = u ? String(u.email || "").toLowerCase() : "";
  if (!who) {
    res.status(401).json({ error: "Sign in required" });
    return null;
  }
  return who;
}

/** Numbers seen in the clear by the tick, held in MEMORY only — never stored.
 *  It is what shows an unmatched caller's full number once their item is
 *  opened, without a RingCentral read. */
const numberMemory = new Map();
function remember(phone, hmac) {
  const e164 = toE164(phone);
  if (!e164 || !hmac) return;
  if (numberMemory.has(hmac)) numberMemory.delete(hmac);
  numberMemory.set(hmac, e164);
  while (numberMemory.size > NUMBER_MEMORY_MAX) numberMemory.delete(numberMemory.keys().next().value);
}

let epochMs = null;
async function loadEpoch(pool) {
  const env = toMs(process.env.COMMS_INBOX_EPOCH);
  if (Number.isFinite(env)) return (epochMs = env);
  if (epochMs !== null) return epochMs;
  // ⚠️ First boot stamps NOW. Everything the archives already held would
  // otherwise be "unresolved" on day one — every patient who ever texted us.
  // Set COMMS_INBOX_EPOCH to re-baseline (e.g. the morning the team starts).
  await pool.query(
    `INSERT INTO comms_inbox_meta (key, value) VALUES ('epoch', $1) ON CONFLICT (key) DO NOTHING`,
    [new Date().toISOString()],
  );
  const q = await pool.query(`SELECT value FROM comms_inbox_meta WHERE key = 'epoch'`);
  epochMs = toMs(q.rows[0]?.value);
  if (!Number.isFinite(epochMs)) epochMs = Date.now();
  return epochMs;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The capture tick
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Read one RingCentral list over the tick's window.
 *
 * ⚠️ A refusal (429 — the budget shed the background tier, or RingCentral
 * throttled) is NOT an error and is NOT retried: this runs every minute, so
 * the next tick re-reads the same window. Retrying hot against a throttled
 * account is how a throttle stays alive. Anything else non-ok throws: a 403 is
 * a missing permission and a 5xx is RingCentral down — faults worth surfacing.
 */
async function readWindow(path, stats) {
  const records = [];
  for (let page = 1; page <= TICK_MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await rcApiFetch(`${path}${sep}perPage=${TICK_PAGE_SIZE}&page=${page}`, {}, {
      tier: "background",
      caller: "comms-inbox",
      ttlMs: 0,
    });
    if (res.status === 429) {
      stats.shed = true;
      return dedupeRecords(records);
    }
    if (!res.ok) throw new Error(`RingCentral read failed (${res.status}) on ${path.split("?")[0]}`);
    const j = await res.json();
    const batch = j.records ?? [];
    records.push(...batch);
    if (batch.length < TICK_PAGE_SIZE) return dedupeRecords(records);
    if (page === TICK_MAX_PAGES) stats.truncated = true;
    await sleep(1500); // paced, like every archive scan: a burst is what a limiter notices
  }
  // ⚠️ Deduped: offset paging repeats a record when one arrives between pages,
  // and one repeat fails the archives' multi-row upsert outright.
  return dedupeRecords(records);
}

/** Ask Monday about inbound numbers nothing here recognises yet. */
async function lookupUnknown(pool, e164s, stats) {
  const byHmac = new Map();
  for (const e of e164s) {
    const h = phoneHmac(e);
    if (h) byHmac.set(h, e);
  }
  if (!byHmac.size) return;
  const hmacs = [...byHmac.keys()];
  const known = new Set();
  const q = await pool.query(
    `SELECT phone_hmac FROM comms_links WHERE phone_hmac = ANY($1)
      UNION SELECT phone_hmac FROM comms_number_cache
             WHERE phone_hmac = ANY($1)
               AND checked_at > now() - (CASE WHEN found THEN $3 ELSE $2 END)::interval`,
    [hmacs, `${Math.round(LOOKUP_RECHECK_MS / 1000)} seconds`, `${Math.round(FOUND_RECHECK_MS / 1000)} seconds`],
  );
  const d = await optionalTable(pool.query(`SELECT phone_hmac FROM patient_directory WHERE phone_hmac = ANY($1)`, [hmacs]));
  for (const r of [...q.rows, ...d.rows]) known.add(r.phone_hmac);
  const unknown = hmacs.filter((h) => !known.has(h)).slice(0, LOOKUP_BATCH);
  if (!unknown.length) return;
  const answer = await lookupNumbersLive(unknown.map((h) => byHmac.get(h)));
  // ⚠️ A failed read is not a set of misses — caching "nobody" on a Monday
  // blip would pin those callers as Unknown for hours.
  if (!answer.ok) return;
  for (const h of unknown) {
    const row = answer.rows.get(h);
    const e164 = byHmac.get(h);
    await pool.query(
      `INSERT INTO comms_number_cache (phone_hmac, last4, found, name, board_id, item_id, board_name, group_id, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (phone_hmac) DO UPDATE SET
         last4 = EXCLUDED.last4, found = EXCLUDED.found, name = EXCLUDED.name, board_id = EXCLUDED.board_id,
         item_id = EXCLUDED.item_id, board_name = EXCLUDED.board_name, group_id = EXCLUDED.group_id,
         checked_at = now()`,
      [
        h,
        e164.slice(-4),
        !!row,
        row?.name ?? null,
        row?.boardId ?? null,
        row?.mondayItemId ?? null,
        row?.boardName ?? null,
        row?.groupId ?? null,
      ],
    );
    stats.lookedUp += 1;
  }
}

let tickRunning = false;
let lastTickStartedAt = 0;

export async function captureTick({ pool } = {}) {
  if (!pool || !rcConfigured()) return { ok: false, error: "not configured" };
  if (tickRunning) return { ok: false, skipped: true };
  tickRunning = true;
  lastTickStartedAt = Date.now();
  const stats = { texts: 0, calls: 0, voicemails: 0, lookedUp: 0, truncated: false, shed: false };
  let runId = null;
  try {
    runId = (await pool.query(`INSERT INTO comms_inbox_runs DEFAULT VALUES RETURNING id`)).rows[0]?.id;
    const since = encodeURIComponent(new Date(Date.now() - TICK_WINDOW_MS).toISOString());
    const inbound = new Set();
    const off = new Set(feedsOff());

    // ⚠️ NO messageType param: the multi-value filter 400s on this account
    // (CLAUDE.md §5.5). One read of every type; each archive's own filter
    // takes what is its (texts vs voicemails), and faxes are nobody's here.
    if (!off.has("texts") || !off.has("voicemails")) {
      const store = await readWindow(`/restapi/v1.0/account/~/extension/~/message-store?dateFrom=${since}`, stats);
      if (store.length) {
        const t = off.has("texts") ? { written: 0, rows: [] } : await archiveTextRecords({ pool, records: store, ours: ourNumbers() });
        const v = off.has("voicemails") ? { written: 0, rows: [] } : await archiveVoicemailRecords({ pool, records: store });
        stats.texts = t.written;
        stats.voicemails = v.written;
        for (const r of [...t.rows, ...v.rows]) {
          if (!r.phoneHmac) continue;
          remember(r.phone, r.phoneHmac);
          if (r.direction === "Inbound") inbound.add(toE164(r.phone));
        }
      }
    }

    // ⚠️ view=Detailed carries the LEGS, which is what the missed-call verdict
    // reads — the default view would report a call a rep took as missed.
    if (!stats.shed && !off.has("calls")) {
      const calls = await readWindow(`/restapi/v1.0/account/~/extension/~/call-log?view=Detailed&dateFrom=${since}`, stats);
      if (calls.length) {
        const c = await archiveCallRecords({ pool, records: calls });
        stats.calls = c.written;
        for (const r of c.rows) {
          if (!r.phoneHmac) continue;
          remember(r.phone, r.phoneHmac);
          if (r.direction === "Inbound") inbound.add(toE164(r.phone));
        }
      }
    }

    // Our own lines never open anything and are never "a patient".
    const ours = new Set(ourNumbers().map((n) => toE164(n)).filter(Boolean));
    await lookupUnknown(pool, [...inbound].filter((e) => e && !ours.has(e)), stats);

    await pool.query(
      `UPDATE comms_inbox_runs
          SET finished_at = now(), ok = true, texts = $2, calls = $3, voicemails = $4, looked_up = $5,
              truncated = $6, shed = $7
        WHERE id = $1`,
      [runId, stats.texts, stats.calls, stats.voicemails, stats.lookedUp, stats.truncated, stats.shed],
    );
    invalidate();
    return { ok: true, ...stats };
  } catch (e) {
    console.error("comms_inbox tick failed:", String((e && e.message) || e));
    // ⚠️ What is STORED is read back by the unauthenticated health route, so a
    // database error keeps only its SQLSTATE there — its text names tables and
    // columns. The whole message is in the log line above.
    const msg = e && typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? `database error ${e.code}` : String((e && e.message) || e);
    if (runId) {
      await pool
        .query(`UPDATE comms_inbox_runs SET finished_at = now(), ok = false, error = $2, shed = $3 WHERE id = $1`, [
          runId,
          msg.slice(0, 500),
          stats.shed,
        ])
        .catch(() => {});
    }
    return { ok: false, error: msg, ...stats };
  } finally {
    tickRunning = false;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reading the archives
 * ──────────────────────────────────────────────────────────────────────────── */

/** Which patient each number belongs to: links, the directory, the cache. */
async function loadTargets(pool, hmacs) {
  const links = new Map();
  const directory = new Map();
  const cache = new Map();
  if (!hmacs.length) return { links, directory, cache, targets: new Map() };
  const l = await pool.query(
    `SELECT phone_hmac, last4, anchor_hmac, board_id, item_id, name FROM comms_links WHERE phone_hmac = ANY($1)`,
    [hmacs],
  );
  for (const r of l.rows) {
    links.set(r.phone_hmac, {
      anchorHmac: r.anchor_hmac || "",
      boardId: r.board_id === null ? null : Number(r.board_id),
      itemId: r.item_id || "",
      name: r.name || "",
      last4: r.last4 || "",
    });
  }
  const anchors = [...links.values()].map((x) => x.anchorHmac).filter(Boolean);
  const all = [...new Set([...hmacs, ...anchors])];
  const d = await optionalTable(
    pool.query(
      `SELECT phone_hmac, last4, name, monday_item_id, board_id, board_name, group_id
         FROM patient_directory WHERE phone_hmac = ANY($1)`,
      [all],
    ),
  );
  for (const r of d.rows) {
    directory.set(r.phone_hmac, {
      boardId: Number(r.board_id),
      itemId: String(r.monday_item_id ?? ""),
      name: r.name || "",
      boardName: r.board_name || "",
      groupId: r.group_id || null,
      last4: r.last4 || "",
    });
  }
  const c = await pool.query(
    `SELECT phone_hmac, last4, found, name, board_id, item_id, board_name, group_id
       FROM comms_number_cache WHERE phone_hmac = ANY($1) AND found`,
    [all],
  );
  for (const r of c.rows) {
    cache.set(r.phone_hmac, {
      boardId: Number(r.board_id),
      itemId: String(r.item_id ?? ""),
      name: r.name || "",
      boardName: r.board_name || "",
      groupId: r.group_id || null,
      last4: r.last4 || "",
    });
  }
  const ctx = { links, directory, cache };
  const targets = new Map(hmacs.map((h) => [h, resolveTarget(h, ctx)]));
  return { ...ctx, targets };
}

const COVER_CTE = `
  cov AS (
    SELECT phone_hmac, max(covers_through) AS covered FROM comms_resolutions
     WHERE undone_at IS NULL AND how <> 'left_vm'
     GROUP BY phone_hmac
  )`;

/**
 * Inbound candidates for the list: everything in the display window, plus
 * anything since the epoch that no resolution covers yet (an open item is
 * listed however old). Answered calls are dropped in SQL by label — a
 * PRE-filter only, fed from the rules' own list, so it can never drop a call
 * the JS verdict would open.
 */
async function loadInboundForList(pool, { epoch, now }) {
  const windowStart = new Date(now - DISPLAY_WINDOW_MS);
  const epochAt = new Date(epoch);
  const labels = CONNECTED_RESULT_LABELS;
  const has = await archivesPresent(pool);
  const [t, c, v] = await Promise.all([
    !has.texts ? NONE : pool.query(
      `WITH ${COVER_CTE}
       SELECT s.rc_message_id, s.phone_hmac, s.last4, s.direction, s.body, s.message_status, s.delivery_error,
              s.attachments, s.created_at
         FROM sms_archive s LEFT JOIN cov ON cov.phone_hmac = s.phone_hmac
        WHERE s.direction = 'Inbound'
          AND (s.created_at >= $1 OR (s.created_at >= $2 AND s.created_at > COALESCE(cov.covered, '-infinity'::timestamptz)))`,
      [windowStart, epochAt],
    ),
    !has.calls ? NONE : pool.query(
      `WITH ${COVER_CTE}
       SELECT a.rc_call_id, a.rc_session_id, a.phone_hmac, a.last4, a.direction, a.result, a.leg_results,
              a.duration_sec, a.started_at, a.audio_state, a.call_type
         FROM call_archive a LEFT JOIN cov ON cov.phone_hmac = a.phone_hmac
        WHERE a.direction = 'Inbound' AND a.phone_hmac IS NOT NULL
          AND a.call_type IS DISTINCT FROM 'Fax'
          AND NOT (lower(btrim(COALESCE(a.result, ''))) = ANY($3))
          AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(COALESCE(a.leg_results, '[]'::jsonb)) AS x(v)
                 WHERE lower(btrim(x.v)) = ANY($3))
          AND (a.started_at >= $1 OR (a.started_at >= $2 AND a.started_at > COALESCE(cov.covered, '-infinity'::timestamptz)))`,
      [windowStart, epochAt, labels],
    ),
    !has.voicemails ? NONE : pool.query(
      `WITH ${COVER_CTE}
       SELECT v.rc_message_id, v.phone_hmac, v.last4, v.direction, v.duration_sec, v.created_at, v.audio_state,
              v.transcript
         FROM voicemail_archive v LEFT JOIN cov ON cov.phone_hmac = v.phone_hmac
        WHERE v.direction = 'Inbound' AND v.phone_hmac IS NOT NULL
          AND (v.created_at >= $1 OR (v.created_at >= $2 AND v.created_at > COALESCE(cov.covered, '-infinity'::timestamptz)))`,
      [windowStart, epochAt],
    ),
  ]);
  return dropOwn([
    ...t.rows.map((r) => textEvent(r)),
    ...c.rows.map((r) => callEvent(r)),
    ...v.rows.map((r) => voicemailEvent(r)),
  ]);
}

/** Outbound texts (with who sent them) and calls (with who dialed) for these
 *  numbers since `since` — the suggestion's inputs. */
async function loadOutbound(pool, hmacs, since) {
  if (!hmacs.length) return [];
  const from = new Date(since);
  const has = await archivesPresent(pool);
  const [t, c, sent, dials] = await Promise.all([
    !has.texts ? NONE : pool.query(
      `SELECT rc_message_id, phone_hmac, last4, direction, body, message_status, delivery_error, attachments, created_at
         FROM sms_archive WHERE phone_hmac = ANY($1) AND direction = 'Outbound' AND created_at > $2`,
      [hmacs, from],
    ),
    !has.calls ? NONE : pool.query(
      `SELECT rc_call_id, rc_session_id, phone_hmac, last4, direction, result, leg_results, duration_sec, started_at,
              audio_state, call_type
         FROM call_archive WHERE phone_hmac = ANY($1) AND direction = 'Outbound' AND started_at > $2
          AND call_type IS DISTINCT FROM 'Fax'`,
      [hmacs, from],
    ),
    pool.query(
      `SELECT phone_hmac, rc_message_id, sender_email, sent_at FROM sent_messages
        WHERE phone_hmac = ANY($1) AND sent_at > $2::timestamptz - interval '5 minutes' ORDER BY sent_at`,
      [hmacs, from],
    ),
    pool.query(
      `SELECT phone_hmac, dialed_by, at FROM comms_dials WHERE phone_hmac = ANY($1) AND at > $2::timestamptz - interval '5 minutes'`,
      [hmacs, from],
    ),
  ]);
  return attributed({ texts: t.rows, calls: c.rows, sent: sent.rows, dials: dials.rows });
}

/** Events with `sentBy` / `dialedBy` filled in. */
function attributed({ texts = [], calls = [], voicemails = [], sent = [], dials = [] }) {
  const sentBy = new Map();
  for (const r of sent) {
    if (!sentBy.has(r.phone_hmac)) sentBy.set(r.phone_hmac, []);
    sentBy.get(r.phone_hmac).push(r);
  }
  const indexes = new Map([...sentBy].map(([h, rows]) => [h, senderIndex(rows)]));
  const dialList = dials.map((d) => ({ hmac: d.phone_hmac, by: d.dialed_by, at: toMs(d.at) }));
  const out = [];
  for (const r of texts) {
    const who =
      r.direction === "Outbound"
        ? senderFor({ id: r.rc_message_id, at: r.created_at }, indexes.get(r.phone_hmac) ?? senderIndex([]))
        : "";
    out.push(textEvent(r, who));
  }
  for (const r of calls) {
    const e = callEvent(r);
    if (e.dir === "out") e.dialedBy = dialerFor(e, dialList);
    out.push(e);
  }
  for (const r of voicemails) out.push(voicemailEvent(r));
  return out;
}

/** Everything for one item's numbers, for its timeline. */
async function loadGroupAll(pool, hmacs) {
  const has = await archivesPresent(pool);
  const [t, c, v, res, sent, dials, media] = await Promise.all([
    !has.texts ? NONE : pool.query(
      `SELECT rc_message_id, phone_hmac, last4, direction, body, message_status, delivery_error, attachments, created_at
         FROM sms_archive WHERE phone_hmac = ANY($1) ORDER BY created_at DESC LIMIT 3000`,
      [hmacs],
    ),
    !has.calls ? NONE : pool.query(
      `SELECT rc_call_id, rc_session_id, phone_hmac, last4, direction, result, leg_results, duration_sec, started_at,
              audio_state, content_uri, call_type
         FROM call_archive WHERE phone_hmac = ANY($1) AND call_type IS DISTINCT FROM 'Fax'
        ORDER BY started_at DESC LIMIT 3000`,
      [hmacs],
    ),
    !has.voicemails ? NONE : pool.query(
      `SELECT rc_message_id, phone_hmac, last4, direction, duration_sec, created_at, audio_state, transcript, content_uri
         FROM voicemail_archive WHERE phone_hmac = ANY($1) ORDER BY created_at DESC LIMIT 1000`,
      [hmacs],
    ),
    pool.query(`SELECT * FROM comms_resolutions WHERE phone_hmac = ANY($1)`, [hmacs]),
    pool.query(
      `SELECT phone_hmac, rc_message_id, sender_email, sent_at FROM sent_messages WHERE phone_hmac = ANY($1) ORDER BY sent_at`,
      [hmacs],
    ),
    pool.query(`SELECT phone_hmac, dialed_by, at FROM comms_dials WHERE phone_hmac = ANY($1)`, [hmacs]),
    // The photo archive may never have been switched on; its absence costs
    // only the archive-first flag on a photo, never the timeline.
    optionalTable(
      pool.query(`SELECT rc_message_id, rc_attachment_id, media_state FROM mms_archive WHERE phone_hmac = ANY($1)`, [hmacs]),
    ),
  ]);
  const events = dropOwn(attributed({ texts: t.rows, calls: c.rows, voicemails: v.rows, sent: sent.rows, dials: dials.rows }));
  // RingCentral's media URLs, for playback of anything the archive has not got
  // yet — Play falls back to RingCentral, on the press, never on open.
  const callUri = new Map(c.rows.map((r) => [String(r.rc_call_id), r.content_uri || ""]));
  const vmUri = new Map(v.rows.map((r) => [String(r.rc_message_id), r.content_uri || ""]));
  const stored = new Set(media.rows.filter((r) => r.media_state === "stored").map((r) => `${r.rc_message_id}:${r.rc_attachment_id}`));
  return { events, resolutions: res.rows.map(resolutionFromRow), callUri, vmUri, storedMedia: stored };
}

/**
 * Opening candidates since the epoch — all a resolve needs.
 *
 * ⚠️ ONE QUERY AT A TIME. The resolve runs this on its transaction's client,
 * and a pg client given a second query while one is in flight queues it with a
 * deprecation warning today and an error in pg@9 (2026-09-23 review). The
 * table check is asked of the POOL, before any of it, so a missing archive is
 * skipped rather than aborting the transaction.
 */
async function loadOpening(client, hmacs, epoch, has) {
  const at = new Date(epoch);
  const t = !has.texts
    ? { rows: [] }
    : await client.query(
        `SELECT rc_message_id, phone_hmac, last4, direction, created_at FROM sms_archive
          WHERE phone_hmac = ANY($1) AND direction = 'Inbound' AND created_at >= $2`,
        [hmacs, at],
      );
  const c = !has.calls
    ? { rows: [] }
    : await client.query(
        `SELECT rc_call_id, phone_hmac, last4, direction, result, leg_results, duration_sec, started_at, call_type
           FROM call_archive
          WHERE phone_hmac = ANY($1) AND direction = 'Inbound' AND started_at >= $2 AND call_type IS DISTINCT FROM 'Fax'`,
        [hmacs, at],
      );
  const v = !has.voicemails
    ? { rows: [] }
    : await client.query(
        `SELECT rc_message_id, phone_hmac, last4, direction, created_at FROM voicemail_archive
          WHERE phone_hmac = ANY($1) AND direction = 'Inbound' AND created_at >= $2`,
        [hmacs, at],
      );
  const res = await client.query(`SELECT * FROM comms_resolutions WHERE phone_hmac = ANY($1)`, [hmacs]);
  const events = dropOwn([
    ...t.rows.map((r) => textEvent(r)),
    ...c.rows.map((r) => callEvent(r)),
    ...v.rows.map((r) => voicemailEvent(r)),
  ]);
  return { events, resolutions: res.rows.map(resolutionFromRow) };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The snapshot — one computation behind the list AND the badge
 * ──────────────────────────────────────────────────────────────────────────── */

let snap = null; // { at, items, epoch }
let snapInflight = null; // { gen, promise }
/**
 * ⚠️ A GENERATION, so a computation that STARTED before a write cannot store
 * its now-stale answer after it (2026-09-23 review): without it a resolve that
 * landed while the list was being computed was undone on screen for up to ten
 * seconds — the row it closed came back open.
 */
let snapGen = 0;
function invalidate() {
  snap = null;
  snapGen += 1;
}

async function computeSnapshot(pool) {
  const now = Date.now();
  const epoch = await loadEpoch(pool);
  const inbound = await loadInboundForList(pool, { epoch, now });
  const hmacs = [...new Set(inbound.map((e) => e.hmac).filter(Boolean))];
  const resolutions = hmacs.length
    ? (await pool.query(`SELECT * FROM comms_resolutions WHERE phone_hmac = ANY($1)`, [hmacs])).rows.map(resolutionFromRow)
    : [];
  const { targets } = await loadTargets(pool, hmacs);

  // Pass one finds the open items; pass two adds what we sent them since, for
  // the suggestion. Outbound traffic for closed items is never read.
  let items = buildInbox({ events: inbound, resolutions, targets, now, epoch });
  const open = items.filter((i) => i.open && i.openedBy);
  if (open.length) {
    const openHmacs = [...new Set(open.flatMap((i) => i.numbers.map((n) => n.hmac)))];
    const since = Math.min(...open.map((i) => i.openedBy.at));
    const outbound = await loadOutbound(pool, openHmacs, since);
    items = buildInbox({ events: [...inbound, ...outbound], resolutions, targets, now, epoch });
  }
  return { at: now, items, epoch };
}

async function snapshot(pool) {
  if (snap && Date.now() - snap.at < SNAPSHOT_TTL_MS) return snap;
  // A computation begun before the last write is not joined: its answer
  // predates the write. A fresh one starts instead.
  if (!snapInflight || snapInflight.gen !== snapGen) {
    const gen = snapGen;
    const promise = computeSnapshot(pool)
      .then((s) => {
        if (gen === snapGen) snap = s;
        return s;
      })
      .finally(() => {
        if (snapInflight?.promise === promise) snapInflight = null;
      });
    snapInflight = { gen, promise };
  }
  return snapInflight.promise;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Which numbers make up an item
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every number whose patient is this key — worked out from the same rules the
 * list uses, so an item opened from the list and the item the list drew are
 * the same set of numbers.
 *
 * @returns {Promise<{numbers: {hmac: string, last4: string}[], target: object|null, moved?: string}>}
 */
async function numbersForKey(pool, key) {
  const parsed = parseKey(key);
  if (!parsed) return { numbers: [], target: null };
  let candidates = [];
  if (parsed.type === "n") {
    candidates = [parsed.hmac];
  } else {
    const q = await pool.query(
      `SELECT phone_hmac FROM comms_number_cache WHERE found AND board_id = $1 AND item_id = $2
        UNION SELECT phone_hmac FROM comms_links WHERE board_id = $1 AND item_id = $2`,
      [parsed.boardId, parsed.itemId],
    );
    const d = await optionalTable(
      pool.query(`SELECT phone_hmac FROM patient_directory WHERE board_id = $1 AND monday_item_id = $2`, [
        parsed.boardId,
        parsed.itemId,
      ]),
    );
    candidates = [...q.rows, ...d.rows].map((r) => r.phone_hmac);
    // A link follows its patient through their anchor number, so a number
    // linked against an OLDER item still belongs to this one.
    if (candidates.length) {
      const l = await pool.query(`SELECT phone_hmac FROM comms_links WHERE anchor_hmac = ANY($1)`, [candidates]);
      candidates.push(...l.rows.map((r) => r.phone_hmac));
    }
    const s = snap?.items.find((i) => i.key === key);
    if (s) candidates.push(...s.numbers.map((n) => n.hmac));
  }
  candidates = [...new Set(candidates.filter(Boolean))];
  const ctx = await loadTargets(pool, candidates);
  const numbers = [];
  let target = null;
  for (const h of candidates) {
    const t = ctx.targets.get(h) ?? null;
    const k = groupKeyFor(h, t);
    if (k !== key) {
      if (parsed.type === "n") return { numbers: [], target: null, moved: k };
      continue;
    }
    if (!target && t) target = t;
    const last4 =
      ctx.links.get(h)?.last4 || ctx.directory.get(h)?.last4 || ctx.cache.get(h)?.last4 || (numberMemory.get(h) || "").slice(-4) || "";
    numbers.push({ hmac: h, last4 });
  }
  return { numbers, target };
}

/**
 * Full numbers for an OPENED item — never stored, never listed.
 *
 * Memory first (the tick saw it in the clear); otherwise one RingCentral read of
 * the newest record on that number, tried newest first across the three lists
 * (the call log survives 90 days, the message store 30). The answer is checked
 * against the HMAC before it is trusted, so a stray record can never hand one
 * patient's item another person's number.
 */
async function resolveNumbers(pool, numbers) {
  let reads = 0;
  const out = [];
  for (const n of numbers) {
    let e164 = numberMemory.get(n.hmac) || "";
    if (!e164 && reads < 3 && rcConfigured()) {
      const has = await archivesPresent(pool);
      const parts = [
        has.calls && `SELECT 'call' AS k, rc_call_id AS id, started_at AS t FROM call_archive WHERE phone_hmac = $1`,
        has.texts && `SELECT 'text' AS k, rc_message_id AS id, created_at AS t FROM sms_archive WHERE phone_hmac = $1`,
        has.voicemails && `SELECT 'vm' AS k, rc_message_id AS id, created_at AS t FROM voicemail_archive WHERE phone_hmac = $1`,
      ].filter(Boolean);
      const q = parts.length
        ? await pool.query(`SELECT k, id FROM (${parts.join(" UNION ALL ")}) x ORDER BY t DESC LIMIT 3`, [n.hmac])
        : { rows: [] };
      for (const r of q.rows) {
        if (e164 || reads >= 3) break;
        reads += 1;
        try {
          const path =
            r.k === "call"
              ? `/restapi/v1.0/account/~/extension/~/call-log/${encodeURIComponent(r.id)}?view=Detailed`
              : `/restapi/v1.0/account/~/extension/~/message-store/${encodeURIComponent(r.id)}`;
          const up = await rcApiFetch(path, {}, { tier: "interactive", caller: "comms-inbox-open" });
          if (!up.ok) continue;
          const rec = await up.json();
          const phone =
            r.k === "call" ? callCounterparty(rec) : r.k === "vm" ? vmCounterparty(rec) : textCounterparty(rec, ourNumbers());
          const candidate = toE164(phone);
          if (candidate && phoneHmac(candidate) === n.hmac) {
            e164 = candidate;
            remember(candidate, n.hmac);
          }
        } catch {
          /* an unreadable record just leaves ···1234 on screen */
        }
      }
    }
    out.push({ ...n, e164: e164 || null });
  }
  return out;
}

/** The state the browser gets: the rules' state with internals stripped. */
function publicState(st) {
  const { _openEvents, _cover, ...rest } = st;
  return { ...rest, newestOpenAt: _openEvents.length ? _openEvents[_openEvents.length - 1].at : null };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Routes
 * ──────────────────────────────────────────────────────────────────────────── */

const ROUTES = [
  "/comms/inbox",
  "/comms/inbox/count",
  "/comms/item",
  "/comms/resolve",
  "/comms/undo",
  "/comms/note",
  "/comms/mirror",
  "/comms/outbox",
  "/comms/link",
  "/comms/dialed",
  "/comms/state",
  "/comms/sla",
  "/comms/shadow-report",
  "/comms/tick",
];

export function registerCommsInbox({ app, pool }) {
  const configured = !!pool && hashingConfigured();
  const on = ENABLED && configured;

  /** What the SPA reads to decide whether to show the Inbox at all. Cheap and
   *  unauthenticated: two booleans, nothing about anybody. */
  app.get("/comms/config", (_req, res) => {
    res.json({ enabled: on, ui: on && UI });
  });

  if (!on) {
    const why = !ENABLED
      ? "the Communications inbox is switched off (COMMS_INBOX_ENABLED is not 1)"
      : "the Communications inbox is not configured (messaging Postgres or PHONE_HMAC_PEPPER missing)";
    if (ENABLED) console.warn(`WARN: ${why}`);
    // ⚠️⚠️ THE HEALTH ROUTE SURVIVES THE KILL SWITCH, as every archive's does:
    // switching the inbox off during an incident must read as "off, on
    // purpose", not as a fresh "could not reach the health check" alert.
    // ⚠️ But switched ON and unable to run (no messaging pool, no pepper) is
    // NOT "off on purpose" — somebody asked for the inbox and is not getting
    // it — so that one is NOT ok, and the monitor says so (2026-09-23 review).
    app.get("/comms/inbox-health", (_req, res) => res.json({ ok: !ENABLED, enabled: false, reason: why }));
    for (const r of ROUTES) app.all(r, (_req, res) => res.status(503).json({ enabled: false, error: why }));
    return;
  }

  /* ── the list and the badge ─────────────────────────────────────────── */

  app.get("/comms/inbox", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const s = await snapshot(pool);
      const q = String(req.query.q || "").slice(0, 100);
      const digits = q.replace(/\D/g, "");
      // A whole number is hashed so it can be matched without ever being stored.
      const qHmac = digits.length >= 10 ? phoneHmac(digits.slice(-10)) : "";
      const out = filterInbox(s.items, {
        view: String(req.query.view || "open"),
        type: String(req.query.type || ""),
        q,
        qHmac,
        sort: String(req.query.sort || "wait"),
        sticky: String(req.query.sticky || ""),
      });
      res.json({ ...out, badge: badgeCounts(s.items), computedAt: s.at, epoch: s.epoch });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  app.get("/comms/inbox/count", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const s = await snapshot(pool);
      res.json({ ...badgeCounts(s.items), computedAt: s.at });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /* ── one item ───────────────────────────────────────────────────────── */

  async function itemPayload(key) {
    const { numbers, target, moved } = await numbersForKey(pool, key);
    if (moved) return { status: 409, body: { error: "This number now belongs to a patient", moved } };
    if (!numbers.length) return { status: 404, body: { error: "This item has moved — open it again from the list" } };
    const hmacs = numbers.map((n) => n.hmac);
    const now = Date.now();
    const epoch = await loadEpoch(pool);
    const g = await loadGroupAll(pool, hmacs);
    const st = itemState({ events: g.events, resolutions: g.resolutions, now, epoch });
    const timeline = buildTimeline({ events: g.events, resolutions: g.resolutions }).map((e) => {
      if (e.type === "call") {
        return {
          ...e,
          recordingUri: e.audioState === "stored" ? "" : g.callUri.get(String(e.id)) || "",
          voicemail: e.voicemail ? { ...e.voicemail, audioUri: e.voicemail.audioState === "stored" ? "" : g.vmUri.get(String(e.voicemail.id)) || "" } : null,
        };
      }
      if (e.type === "voicemail") return { ...e, audioUri: e.audioState === "stored" ? "" : g.vmUri.get(String(e.id)) || "" };
      if (e.type === "text" && e.attachments?.length) {
        return { ...e, attachments: e.attachments.map((a) => ({ ...a, archived: g.storedMedia.has(`${e.id}:${a.id}`) })) };
      }
      return e;
    });
    return {
      status: 200,
      body: {
        key,
        name: target?.name || "",
        stage: stagePill(target),
        boardId: target?.itemId ? Number(target.boardId) : null,
        itemId: target?.itemId ? String(target.itemId) : null,
        numbers: await resolveNumbers(pool, numbers),
        state: publicState(st),
        timeline,
        epoch,
        now,
      },
    };
  }

  app.get("/comms/item", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const out = await itemPayload(String(req.query.key || ""));
      res.status(out.status).json(out.body);
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /** The patient screen's compact bar, and a log row opening its item: state
   *  for numbers the page already holds. The `/directory/lookup` posture —
   *  nothing is disclosed the caller didn't bring. */
  app.post("/comms/state", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const raw = Array.isArray(req.body?.numbers) ? req.body.numbers.slice(0, 5) : [];
      const hmacs = [...new Set(raw.map((n) => phoneHmac(n)).filter(Boolean))];
      // The caller BROUGHT these numbers, so holding them in memory discloses
      // nothing — and it is what lets the item this key opens show its full
      // number (and a last four) even when the number has never been captured:
      // a New text to somebody who has never texted us, say. Memory only,
      // bounded, never stored — the tick's own rule.
      for (const n of raw) remember(n, phoneHmac(n));
      if (!hmacs.length) return res.json({ key: null, state: null });
      const { targets } = await loadTargets(pool, hmacs);
      const lead = hmacs.find((h) => targets.get(h)) ?? hmacs[0];
      const key = groupKeyFor(lead, targets.get(lead) ?? null);
      const { numbers } = await numbersForKey(pool, key);
      const set = numbers.length ? numbers.map((n) => n.hmac) : [lead];
      const g = await loadGroupAll(pool, set);
      const st = itemState({ events: g.events, resolutions: g.resolutions, now: Date.now(), epoch: await loadEpoch(pool) });
      res.json({ key, state: publicState(st) });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /* ── resolving ──────────────────────────────────────────────────────── */

  app.post("/comms/resolve", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    const key = String(req.body?.key || "");
    const how = String(req.body?.how || "");
    let client = null;
    try {
      const { numbers, target, moved } = await numbersForKey(pool, key);
      if (moved) return res.status(409).json({ error: "This number now belongs to a patient", moved });
      if (!numbers.length) return res.status(404).json({ error: "This item has moved — open it again from the list" });
      const hmacs = numbers.map((n) => n.hmac).sort();
      const now = Date.now();
      const epoch = await loadEpoch(pool);
      const has = await archivesPresent(pool);
      client = await pool.connect();
      await client.query("BEGIN");
      // ⚠️ The check and the write happen under a lock per NUMBER, taken in a
      // fixed order: two reps on one item is an ordinary afternoon, and without
      // this both could pass the check and both write.
      for (const h of hmacs) await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`comms:${h}`]);
      const g = await loadOpening(client, hmacs, epoch, has);
      const st = itemState({ events: g.events, resolutions: g.resolutions, now, epoch });
      const plan = planResolve({ how, note: req.body?.note, seenThrough: req.body?.seenThrough, now, state: st });
      if (!plan.ok) {
        await client.query("ROLLBACK");
        return res.status(plan.status).json({
          error: plan.error,
          conflict: plan.conflict ? { ...plan.conflict, at: iso(plan.conflict.at) } : null,
        });
      }
      const rid = crypto.randomUUID();
      // Where the note is copied — the item's own patient, or the one the rep
      // was looking at on a shared line (`noteTargetFor`).
      const noteAt = noteTargetFor(target, req.body?.noteTarget);
      for (const n of numbers) {
        await client.query(
          `INSERT INTO comms_resolutions
             (resolution_id, phone_hmac, last4, how, note, covers_through, resolved_by, item_board, item_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            rid,
            n.hmac,
            n.last4 || null,
            how,
            plan.note,
            new Date(plan.coversThrough),
            who,
            noteAt ? noteAt.boardId : null,
            noteAt ? noteAt.itemId : null,
          ],
        );
      }
      await client.query("COMMIT");
      invalidate();
      res.json({ ok: true, resolutionId: rid, how, label: HOW_LABEL[how], coversThrough: plan.coversThrough, resolvedAt: now, by: who });
    } catch (e) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      res.status(500).json({ error: String((e && e.message) || e) });
    } finally {
      client?.release();
    }
  });

  /** Lock and read every row of one resolution — the unit Undo, the note and
   *  the Monday copy act on. */
  async function withResolution(rid, fn) {
    if (!UUID.test(rid)) return { status: 400, body: { error: "resolutionId is required" } };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const q = await client.query(`SELECT * FROM comms_resolutions WHERE resolution_id = $1 FOR UPDATE`, [rid]);
      const out = await fn(client, q.rows.map(resolutionFromRow));
      await client.query(out.status === 200 ? "COMMIT" : "ROLLBACK");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  app.post("/comms/undo", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const out = await withResolution(String(req.body?.resolutionId || ""), async (client, rows) => {
        const ok = canUndo({ rows, actor: who, now: Date.now() });
        if (!ok.ok) return { status: ok.status, body: { error: ok.error } };
        await client.query(
          `UPDATE comms_resolutions SET undone_by = $2, undone_at = now() WHERE resolution_id = $1`,
          [rows[0].resolutionId, who],
        );
        return { status: 200, body: { ok: true } };
      });
      if (out.status === 200) invalidate();
      res.status(out.status).json(out.body);
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  app.post("/comms/note", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const note = normalizeNote(req.body?.note);
      const out = await withResolution(String(req.body?.resolutionId || ""), async (client, rows) => {
        const ok = canAddNote({ rows, actor: who, now: Date.now(), note });
        if (!ok.ok) return { status: ok.status, body: { error: ok.error } };
        await client.query(`UPDATE comms_resolutions SET note = $2 WHERE resolution_id = $1`, [rows[0].resolutionId, note]);
        return { status: 200, body: { ok: true, note } };
      });
      if (out.status === 200) invalidate();
      res.status(out.status).json(out.body);
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /* ── the Monday copy outbox ─────────────────────────────────────────── */

  /** This rep's notes still waiting to be copied to Monday. */
  app.get("/comms/outbox", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const q = await pool.query(
        `SELECT * FROM comms_resolutions
          WHERE lower(resolved_by) = $1 AND undone_at IS NULL AND how <> 'left_vm'
            AND note IS NOT NULL AND note <> '' AND item_id IS NOT NULL AND mirrored_to IS NULL
            AND mirror_attempts < $2
            AND (mirror_claimed_at IS NULL OR mirror_claimed_at < now() - $3::interval)
          ORDER BY resolved_at LIMIT 200`,
        [who, MAX_MIRROR_ATTEMPTS, `${Math.round(STALE_CLAIM_MS / 1000)} seconds`],
      );
      const now = Date.now();
      const seen = new Set();
      const pending = [];
      for (const r of q.rows.map(resolutionFromRow)) {
        if (seen.has(r.resolutionId) || !mirrorPending(r, who, now)) continue;
        seen.add(r.resolutionId);
        pending.push({
          resolutionId: r.resolutionId,
          how: r.how,
          label: HOW_LABEL[r.how],
          note: r.note,
          resolvedAt: r.resolvedAt,
          itemBoard: r.itemBoard,
          itemId: r.itemId,
        });
      }
      res.json({ pending: pending.slice(0, 50) });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /**
   * Claim a note before writing it to Monday; report where it landed, or why
   * it could not.
   *
   * ⚠️ Only the RESOLVER's browser copies — the Monday writer stamps the
   * signed-in person's initials, so a copy from somebody else's browser would
   * sign the note with the wrong name. And the claim is a compare-and-set, so
   * two open tabs cannot both write it.
   */
  app.post("/comms/mirror", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    const action = String(req.body?.action || "");
    const rid = String(req.body?.resolutionId || "");
    // ⚠️ Checked here, not left to Postgres: a malformed id is the CALLER's
    // mistake, and the uuid cast's error would come back as a 500 carrying the
    // database's own words (2026-09-23 review).
    if (!UUID.test(rid)) return res.status(400).json({ error: "resolutionId is required" });
    try {
      if (action === "claim") {
        const out = await withResolution(rid, async (client, rows) => {
          const now = Date.now();
          if (!rows.length || !rows.every((r) => mirrorPending(r, who, now))) {
            return { status: 200, body: { claimed: false } };
          }
          await client.query(
            `UPDATE comms_resolutions SET mirror_claimed_at = now(), mirror_attempts = mirror_attempts + 1
              WHERE resolution_id = $1`,
            [rid],
          );
          const r = rows[0];
          return {
            status: 200,
            body: { claimed: true, resolutionId: rid, how: r.how, label: HOW_LABEL[r.how], note: r.note, resolvedAt: r.resolvedAt, itemBoard: r.itemBoard, itemId: r.itemId },
          };
        });
        return res.status(out.status).json(out.body);
      }
      if (action === "done") {
        const to = String(req.body?.mirroredTo || "").slice(0, 100);
        if (!to) return res.status(400).json({ error: "mirroredTo is required" });
        // ⚠️ Only a copy that was CLAIMED, of a resolution that STANDS. Undo is
        // refused once a claim exists, so an unclaimed "done" can only be a
        // confused client — and marking an undone resolution copied would put
        // a Communications line on Monday for a resolution that does not
        // stand, which is the one thing Undo exists to prevent. Idempotent: a
        // retried "done" for a copy already recorded is accepted again.
        const q = await pool.query(
          `UPDATE comms_resolutions SET mirrored_to = $2, mirror_error = NULL
            WHERE resolution_id = $1 AND lower(resolved_by) = $3
              AND undone_at IS NULL AND mirror_claimed_at IS NOT NULL`,
          [rid, to, who],
        );
        return res.json({ ok: q.rowCount > 0 });
      }
      if (action === "error") {
        const err = String(req.body?.error || "unknown error").slice(0, 300);
        // Released, so it is retried until it runs out of attempts — one
        // Monday blip must not cost the copy for good.
        const q = await pool.query(
          `UPDATE comms_resolutions SET mirror_error = $2, mirror_claimed_at = NULL
            WHERE resolution_id = $1 AND lower(resolved_by) = $3 AND mirrored_to IS NULL`,
          [rid, err, who],
        );
        return res.json({ ok: q.rowCount > 0 });
      }
      res.status(400).json({ error: "action must be claim, done or error" });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /* ── linking a number to a patient ──────────────────────────────────── */

  app.post("/comms/link", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const parsed = parseKey(req.body?.key);
      if (!parsed || parsed.type !== "n") return res.status(400).json({ error: "Only an unmatched number can be linked" });
      const boardId = Number(req.body?.boardId);
      const itemId = String(req.body?.itemId || "");
      if (!Number.isFinite(boardId) || !/^\d+$/.test(itemId)) return res.status(400).json({ error: "boardId and itemId are required" });
      const name = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 200);
      const anchor = req.body?.anchorNumber ? phoneHmac(req.body.anchorNumber) || null : null;
      const last4 = /^\d{4}$/.test(String(req.body?.last4 || "")) ? String(req.body.last4) : null;
      await pool.query(
        `INSERT INTO comms_links (phone_hmac, last4, anchor_hmac, board_id, item_id, name, linked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (phone_hmac) DO UPDATE SET
           last4 = COALESCE(EXCLUDED.last4, comms_links.last4), anchor_hmac = EXCLUDED.anchor_hmac,
           board_id = EXCLUDED.board_id, item_id = EXCLUDED.item_id, name = EXCLUDED.name,
           linked_by = EXCLUDED.linked_by, linked_at = now()`,
        [parsed.hmac, last4, anchor, boardId, itemId, name, who],
      );
      invalidate();
      const { targets } = await loadTargets(pool, [parsed.hmac]);
      res.json({ ok: true, key: groupKeyFor(parsed.hmac, targets.get(parsed.hmac) ?? null) });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /** The Call button reports who dialed — the call log cannot say. */
  app.post("/comms/dialed", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const h = phoneHmac(req.body?.number);
      if (!h) return res.status(400).json({ error: "A valid number is required" });
      await pool.query(`INSERT INTO comms_dials (phone_hmac, dialed_by) VALUES ($1,$2)`, [h, who]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /* ── reports ────────────────────────────────────────────────────────── */

  app.get("/comms/sla", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      const now = Date.now();
      const since = now - days * 24 * 3600_000;
      const epoch = await loadEpoch(pool);
      const rq = await pool.query(
        `SELECT * FROM comms_resolutions WHERE phone_hmac IN (
           SELECT DISTINCT phone_hmac FROM comms_resolutions WHERE resolved_at >= $1)`,
        [new Date(since)],
      );
      const resolutions = rq.rows.map(resolutionFromRow);
      const hmacs = [...new Set(resolutions.map((r) => r.hmac))];
      // Periods can begin before the window does; reach back well past it.
      const from = new Date(Math.max(epoch, since - 90 * 24 * 3600_000));
      const events = hmacs.length ? (await loadOpening(pool, hmacs, from.getTime(), await archivesPresent(pool))).events : [];
      const s = await snapshot(pool);
      const counts = badgeCounts(s.items);
      res.json(slaReport({ resolutions, events, since, now, epoch, open: counts.open, over: counts.over }));
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /** Phase 1's measurement: what the inbox WOULD have opened. Counts only. */
  app.get("/comms/shadow-report", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 60);
      const since = Date.now() - days * 24 * 3600_000;
      const at = new Date(since);
      const has = await archivesPresent(pool);
      const [t, c, v] = await Promise.all([
        // Texts reach a week further back than the window: "is this a reply to
        // one of our automated texts?" looks at the text BEFORE it, and on the
        // window's first day that text is older than the window.
        !has.texts ? NONE : pool.query(
          `SELECT rc_message_id, phone_hmac, last4, direction, body, created_at FROM sms_archive
            WHERE created_at >= $1::timestamptz - $2::interval`,
          [at, `${Math.round(AUTOMATION_REPLY_WINDOW_MS / 1000)} seconds`],
        ),
        !has.calls ? NONE : pool.query(
          `SELECT rc_call_id, phone_hmac, last4, direction, result, leg_results, duration_sec, started_at, call_type
             FROM call_archive
            WHERE started_at >= $1 AND direction = 'Inbound' AND call_type IS DISTINCT FROM 'Fax'`,
          [at],
        ),
        !has.voicemails ? NONE : pool.query(
          `SELECT rc_message_id, phone_hmac, last4, direction, created_at FROM voicemail_archive WHERE created_at >= $1`,
          [at],
        ),
      ]);
      const hmacs = [...new Set([...t.rows, ...c.rows, ...v.rows].map((r) => r.phone_hmac).filter(Boolean))];
      const sent = hmacs.length
        ? (
            await pool.query(
              `SELECT phone_hmac, rc_message_id, sender_email, sent_at FROM sent_messages
                WHERE phone_hmac = ANY($1) AND sent_at >= $2::timestamptz - interval '8 days' ORDER BY sent_at`,
              [hmacs, at],
            )
          ).rows
        : [];
      const events = dropOwn(attributed({ texts: t.rows, calls: c.rows, voicemails: v.rows, sent }));
      const { targets } = await loadTargets(pool, hmacs);
      res.json({ days, ...shadowReport({ events, targets, since }) });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /* ── health, and a manual tick ──────────────────────────────────────── */

  /**
   * ⚠️ UNAUTHENTICATED, matching every archive's health route: counts and
   * timestamps only, never a number, a name, a note or an email — the check has
   * to be reachable by the calls-monitor cron, which carries no token.
   */
  app.get("/comms/inbox-health", async (_req, res) => {
    try {
      const pendingWhere = `undone_at IS NULL AND how <> 'left_vm' AND note IS NOT NULL AND note <> ''
                            AND item_id IS NOT NULL AND mirrored_to IS NULL`;
      const q = await pool.query(
        `SELECT
           (SELECT max(finished_at) FROM comms_inbox_runs WHERE ok AND NOT truncated AND NOT shed)          AS last_complete,
           (SELECT max(started_at)  FROM comms_inbox_runs)                                                   AS last_run,
           (SELECT error FROM comms_inbox_runs WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1)             AS last_error,
           (SELECT truncated FROM comms_inbox_runs WHERE ok ORDER BY finished_at DESC LIMIT 1)              AS last_truncated,
           (SELECT count(DISTINCT resolution_id) FROM comms_resolutions WHERE ${pendingWhere} AND mirror_attempts < $1) AS pending,
           (SELECT min(resolved_at) FROM comms_resolutions WHERE ${pendingWhere} AND mirror_attempts < $1)   AS oldest_pending,
           (SELECT count(DISTINCT resolution_id) FROM comms_resolutions WHERE ${pendingWhere} AND mirror_attempts >= $1) AS failed`,
        [MAX_MIRROR_ATTEMPTS],
      );
      const r = q.rows[0] || {};
      res.json({
        ...inboxHealth({
          lastCompleteAt: r.last_complete,
          lastRunAt: r.last_run,
          lastError: r.last_error,
          lastTruncated: r.last_truncated,
          pendingMirrors: Number(r.pending || 0),
          oldestPendingMirrorAt: r.oldest_pending,
          failedMirrors: Number(r.failed || 0),
          feedsOff: feedsOff(),
          epoch: epochMs,
        }),
        ui: UI,
      });
    } catch (e) {
      // ⚠️ UNAUTHENTICATED, so the database's own words stay in the log: they
      // name tables and columns (Greptile, PR #58).
      console.error("Comms inbox health check failed:", (e && e.message) || e);
      res.status(500).json({ ok: false, enabled: true, error: "Health check failed" });
    }
  });

  /**
   * Force a tick without waiting a minute.
   *
   * ⚠️ AUTHENTICATED **AND** RATE-FLOORED, both — §5.27's rule for every forced
   * run. `tickRunning` coalesces only ticks that OVERLAP, so a client posting
   * again each time one finishes would get a full RingCentral read every time
   * (2026-09-23 review); the minute timer is the inbox's freshness, and this
   * is for somebody watching a deploy, not a loop.
   */
  app.post("/comms/tick", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    const since = Date.now() - lastTickStartedAt;
    if (since < TICK_FORCE_MIN_GAP_MS) {
      const wait = Math.ceil((TICK_FORCE_MIN_GAP_MS - since) / 1000);
      res.set?.("Retry-After", String(wait));
      return res.status(429).json({ ok: false, error: `A capture tick ran moments ago — try again in ${wait}s` });
    }
    const out = await captureTick({ pool });
    res.status(out.ok || out.skipped ? 200 : 502).json(out);
  });

  /* ── boot ───────────────────────────────────────────────────────────── */

  void (async () => {
    try {
      await pool.query(SCHEMA);
      await loadEpoch(pool);
      console.log(`Comms inbox schema ready (epoch ${new Date(epochMs).toISOString()}, ui ${UI ? "on" : "off"})`);
    } catch (e) {
      console.error("Comms inbox schema failed:", e.message);
      return;
    }
    // Offset from the archives' own boot runs (90s · 150s · 210s) so a redeploy
    // does not fire them all at the same RingCentral account at once.
    setTimeout(() => {
      void captureTick({ pool });
      setInterval(() => void captureTick({ pool }), TICK_MS).unref?.();
    }, 45_000).unref?.();
    setInterval(() => {
      void pool
        .query(`DELETE FROM comms_inbox_runs WHERE started_at < now() - $1::interval`, [`${RUNS_KEEP_DAYS} days`])
        .catch(() => {});
    }, 3600_000).unref?.();
  })();
}

/** Exported for the tests, which read the module's guarantees from source. */
export { numbersForKey, computeSnapshot, opensItem };
