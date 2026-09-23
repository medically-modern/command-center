/**
 * mmsArchive.mjs — a durable copy of the PHOTOS patients text us.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * §5.27 built sms_archive because RingCentral's message store is a rolling
 * ~30-day window on this account, and named the piece it did not cover:
 *
 *   "Not covered: MMS media. Attachment bytes live on RingCentral and purge
 *    with the message, so the archive stores the attachment metadata and uris
 *    only — a patient's insurance-card photo is recorded as having existed,
 *    not saved. Fetching the bytes through /rc/fetch into object storage is a
 *    separate job."
 *
 * This is that job. It matters more than "some texts have pictures" suggests:
 * the intake form's whole insurance step is built around a patient answering
 * with a photo of their card (§5.23), the Care Coordinator page renders that
 * photo as the insurance answer for patients whose carrier is on the card and
 * nowhere else (§5.30f — 18 of 20 such rows have a BLANK General Insurance),
 * and a rep asking a patient for their card by text gets it back as an MMS.
 *
 * ── ⚠️ The quietest failure of the three archives ───────────────────────────
 * A purged call recording leaves its call-log row behind, so the call is still
 * visible with no audio. A purged voicemail leaves nothing at all. This one is
 * worse than either: the TEXT survives in sms_archive for ever, so the thread
 * goes on saying a photo was attached, carrying a uri that 404s — a record
 * that looks complete and is not. Nothing anywhere says the image is gone.
 *
 * ── ⚠️⚠️ PHI, ON THE SAME TERMS AS THE TWO ARCHIVES BESIDE IT ───────────────
 * This stores photographs a patient took of their insurance card — a document
 * carrying their name, their member id and their payer. Same category as a
 * recorded voice and a message body, same two bounds, neither optional:
 *   · It lives on the MESSAGING pool (ASSIGNMENTS_DATABASE_URL), never the
 *     audit pool, so the audit database keeps its no-PHI property.
 *     DO NOT MOVE THIS TABLE. `registerMmsArchive` is called from messaging.mjs
 *     for exactly that reason, and a test pins it.
 *   · The counterparty is stored as HMAC + last4, never in the clear — copied
 *     from sms_archive, which already made that call. The object key carries
 *     message and attachment ids, never a number and never a name.
 *
 * ⚠️ Retention is KEEP-FOREVER, matching the archives beside it (Josh,
 * 2026-09-22: "keep it forever, no retention policy"). There is deliberately no
 * prune job and no retention variable — that is the decision, not an oversight.
 *
 * ── ⚠️⚠️ NO RINGCENTRAL SCAN — THE QUEUE IS POSTGRES ────────────────────────
 * callArchive and voicemailArchive each open with a metadata pass over
 * RingCentral because they are the only thing that knows their records exist.
 * This one is not: sms_archive already reconciles the whole 35-day window daily
 * and already records every media part as {id, contentType, uri}. So the
 * enqueue here is ONE SQL STATEMENT against a table we own, and the module is
 * drain-only.
 *
 * That is worth more than the requests it saves. An enqueue that cannot be
 * shed, throttled or truncated removes three of the four failure modes the
 * archives beside it spend real machinery on — there is no page ceiling here,
 * so no `truncated` verdict, and no shed-scan-versus-shed-drain distinction.
 * The coupling it buys instead is named and tested:
 * `smsArchiveRules.mediaAttachments` is the keep-in-agreement partner, and if
 * it ever stops recording attachments this archive goes silently empty.
 *
 * ── ⚠️⚠️ AND WHY THE STATE IS NOT WRITTEN BACK INTO sms_archive ─────────────
 * The obviously cheaper design is a flag inside that JSONB column. It would be
 * destroyed within a day: smsArchive's upsert ends
 * `attachments = EXCLUDED.attachments`, replacing the column wholesale on every
 * reconcile — deliberately, so a message's late delivery verdict can be
 * corrected. Archive state written there is silently overwritten and every
 * photo is re-downloaded for ever. Hence a table of our own.
 *
 * ── Why it reuses the call archive's bucket ─────────────────────────────────
 * `callArchiveStore.mjs` is a generic S3 wrapper that happens to be named for
 * its first caller, and its credentials are already set on the gateway. A third
 * store module would mean five more Railway variables that must be set before
 * this feature does anything at all — and a half-configured store is a new
 * silent failure mode for no benefit. The three archives are kept apart by the
 * object-key PREFIX (`mms/` vs `voicemails/` vs `recordings/`), which is what
 * makes a listing of one not a listing of another.
 */
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { rcConfigured, rcMediaFetch } from "./ringcentral.mjs";
import { authEnforced } from "./auth.mjs";
import { phoneHmac } from "./phoneHash.mjs";
import {
  getObjectStream,
  presignGet,
  putObject,
  storeConfigured,
  storeName,
} from "./callArchiveStore.mjs";
import {
  ENQUEUE_DAYS,
  EVERY_MS,
  MAX_ATTEMPTS,
  MAX_BYTES,
  MEDIA_GAP_MS,
  MIN_GAP_MS,
  URL_TTL_SECONDS,
  archiveHealth,
  drainBudget,
  extensionForMedia,
  fallbackFilename,
  isOfficeHours,
  looksLikeMedia,
  nextAudioState,
  objectKey,
} from "./mmsArchiveRules.mjs";

/**
 * ⚠️ Its OWN statement, deliberately not appended to another module's SCHEMA
 * template — index.mjs records why: that block ends in a DROP+CREATE VIEW which
 * takes every CREATE TABLE with it when it fails.
 *
 * NOTE: this whole SCHEMA, and every SQL string in this file, is a JS template
 * literal — so no backticks anywhere inside one, comments included.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS mms_archive (
  -- ⚠️ The key is the PAIR. One MMS can carry several parts, so a table keyed
  -- on the message alone would hold one of them and lose the rest — and the
  -- upload is idempotent by key precisely so a retry overwrites rather than
  -- duplicating, which would make that loss silent.
  rc_message_id    TEXT NOT NULL,
  rc_attachment_id TEXT NOT NULL,

  -- Copied from sms_archive, which already hashed it. Never the number.
  phone_hmac       TEXT,
  last4            TEXT,
  direction        TEXT,
  created_at       TIMESTAMPTZ NOT NULL,

  -- pending | stored | gone | failed.
  -- ⚠️ There is deliberately no 'none' state, unlike voicemail_archive. A
  -- voicemail row is kept even when its audio part is missing, because the
  -- METADATA ages out with the message and the row is the surviving record.
  -- Here sms_archive IS that surviving record, and a media part with no uri
  -- never reaches this table at all (mediaAttachments filters on it), so a row
  -- existing means there was something to fetch.
  media_state      TEXT NOT NULL DEFAULT 'pending',
  -- What sms_archive recorded the part as. This is what makes the "a 200 is not
  -- media" check precise rather than a guess — see looksLikeMedia.
  expected_type    TEXT,
  -- RingCentral's media URL. Refreshed by every enqueue because it is the input
  -- to the download, and it dies with the message.
  content_uri      TEXT NOT NULL,

  object_key       TEXT,
  content_type     TEXT,
  bytes            BIGINT,

  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  last_attempt_at  TIMESTAMPTZ,
  stored_at        TIMESTAMPTZ,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rc_message_id, rc_attachment_id)
);
-- The queue: pending work, oldest first. Oldest is closest to deletion.
CREATE INDEX IF NOT EXISTS mms_archive_queue_idx   ON mms_archive (media_state, created_at);
CREATE INDEX IF NOT EXISTS mms_archive_phone_idx   ON mms_archive (phone_hmac, created_at DESC);
CREATE INDEX IF NOT EXISTS mms_archive_created_idx ON mms_archive (created_at DESC);

-- One row per run. A job that silently stopped running is the failure this
-- whole module exists to prevent, and an empty archive with no run history
-- looks exactly like an empty archive that is working fine.
CREATE TABLE IF NOT EXISTS mms_archive_runs (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  ok           BOOLEAN,
  enqueued     INT,
  media_tried  INT,
  media_stored INT,
  media_failed INT,
  media_gone   INT,
  bytes        BIGINT,
  -- Cut short by the RingCentral budget rather than finished. archiveHealth
  -- measures staleness on runs that are NOT shed, so an archive that sheds
  -- every single pass cannot report healthy while the window closes on it.
  shed         BOOLEAN DEFAULT false,
  enqueue_days INT,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS mms_archive_runs_ok_idx ON mms_archive_runs (ok, finished_at DESC);

-- ⚠️ Who fetched which photo, and how. A presigned URL is a bearer credential
-- for PHI; an untracked one is indistinguishable from a leak. This is the
-- mitigation that makes handing them out acceptable at all.
CREATE TABLE IF NOT EXISTS mms_archive_access (
  id               BIGSERIAL PRIMARY KEY,
  rc_message_id    TEXT NOT NULL,
  rc_attachment_id TEXT,
  actor            TEXT,
  mode             TEXT NOT NULL,
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mms_archive_access_at_idx  ON mms_archive_access (at DESC);
CREATE INDEX IF NOT EXISTS mms_archive_access_msg_idx ON mms_archive_access (rc_message_id, at DESC);
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Copy every media part sms_archive knows about into the queue.
 *
 * ⚠️⚠️ THE ENQUEUE MAY NEVER TOUCH `media_state`. It has no information about
 * whether we hold the bytes — it is reading a column that says a photo was
 * attached, not a column that says we saved it — so any write there would reset
 * a stored row to pending and re-download it for ever. The two archives beside
 * it need a narrow `none` -> `pending` transition because their metadata pass
 * can see an attachment appear late; here a part with no uri never enters the
 * table at all, so there is no such case and the safest rule is the simplest
 * one: on conflict, refresh the inputs and leave the state alone.
 *
 * ⚠️ The attachment id falls back to the last path segment of the uri, which
 * for the documented shape (/message-store/{id}/content/{attachmentId}) IS the
 * attachment id. Without it a part whose `id` did not survive into the JSONB
 * would be unkeyable and therefore silently unarchivable — and the key is what
 * stops two parts of one message overwriting each other.
 *
 * ⚠️ `jsonb_typeof = 'array'` guards a malformed row from failing the whole
 * statement. One bad row must not stop every photo that day being archived.
 */
export async function enqueueFromSmsArchive({ pool, stats }) {
  const res = await pool.query(
    `INSERT INTO mms_archive
       (rc_message_id, rc_attachment_id, phone_hmac, last4, direction, created_at,
        expected_type, content_uri)
     SELECT s.rc_message_id,
            COALESCE(NULLIF(a->>'id',''), regexp_replace(split_part(a->>'uri','?',1), '^.*/', '')),
            s.phone_hmac,
            s.last4,
            s.direction,
            s.created_at,
            NULLIF(a->>'contentType',''),
            a->>'uri'
       FROM sms_archive s
       CROSS JOIN LATERAL jsonb_array_elements(s.attachments) a
      WHERE s.attachments IS NOT NULL
        AND jsonb_typeof(s.attachments) = 'array'
        AND s.created_at >= now() - ($1 || ' days')::interval
        AND COALESCE(a->>'uri','') <> ''
        AND COALESCE(NULLIF(a->>'id',''), regexp_replace(split_part(a->>'uri','?',1), '^.*/', '')) <> ''
     ON CONFLICT (rc_message_id, rc_attachment_id) DO UPDATE SET
       content_uri   = EXCLUDED.content_uri,
       expected_type = COALESCE(EXCLUDED.expected_type, mms_archive.expected_type),
       phone_hmac    = COALESCE(EXCLUDED.phone_hmac,       mms_archive.phone_hmac),
       last4         = COALESCE(NULLIF(EXCLUDED.last4,''), mms_archive.last4)`,
    [String(ENQUEUE_DAYS)],
  );
  stats.enqueued = res.rowCount || 0;
}

/**
 * Download and store a bounded slice of the pending queue.
 *
 * ⚠️ OLDEST FIRST. The oldest unarchived photo is the one closest to being
 * deleted, so this ordering makes the job race the ~30-day window rather than
 * the clock. Newest-first would archive what has a month left and lose what had
 * a day. It is also why there is no backfill script: ordinary hourly runs drain
 * whatever is queued, and a redeploy costs at most one run's progress.
 */
export async function drainMediaQueue({ pool, stats, budget = drainBudget(), gapMs = MEDIA_GAP_MS }) {
  if (budget <= 0) return;
  stats.busy = isOfficeHours();
  stats.budget = budget;
  const q = await pool.query(
    `SELECT rc_message_id, rc_attachment_id, content_uri, expected_type, created_at, last4, attempts
       FROM mms_archive
      WHERE media_state = 'pending' AND attempts < $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [MAX_ATTEMPTS, budget],
  );

  for (let i = 0; i < q.rows.length; i++) {
    const row = q.rows[i];
    stats.mediaTried++;
    const attempts = Number(row.attempts) + 1;
    const fail = (state, err) =>
      pool.query(
        `UPDATE mms_archive
            SET media_state = $3, attempts = $4, last_error = $5, last_attempt_at = now()
          WHERE rc_message_id = $1 AND rc_attachment_id = $2`,
        [row.rc_message_id, row.rc_attachment_id, state, attempts, String(err).slice(0, 500)],
      );
    try {
      const up = await rcMediaFetch(row.content_uri, { tier: "background", caller: "mms-archive" });
      // ⚠️⚠️ A 429 MUST NOT BURN AN ATTEMPT. Attempts exist to retire a part
      // that is genuinely unfetchable; a throttle says nothing about this part
      // at all. Counting it would let one busy afternoon park MAX_ATTEMPTS
      // -worth of perfectly good photos as `failed`, which is terminal for the
      // automatic retry — losing a patient's insurance card to our own rate
      // limit. The row is left exactly as it was, and the drain stops: there is
      // no point walking the rest of the queue into the same wall.
      if (up.status === 429) {
        stats.shed = true;
        stats.shedHits++;
        stats.mediaTried--;
        return;
      }
      if (!up.ok) {
        const state = nextAudioState({ status: up.status, attempts, maxAttempts: MAX_ATTEMPTS });
        if (state === "gone") stats.mediaGone++;
        else if (state === "failed") stats.mediaFailed++;
        await fail(state, `HTTP ${up.status}`);
        continue;
      }

      const contentType = up.headers.get("content-type") || "";
      const body = Buffer.from(await up.arrayBuffer());

      // ⚠️ Not a photo. See looksLikeMedia: a 200 can carry an XML or HTML
      // error body, and an archive that stores those has lost the image AND
      // reported success. The size ceiling rides here too — half a JPEG is a
      // file that opens to grey, which is worse than an honest gap.
      if (body.length > MAX_BYTES) {
        const state = nextAudioState({ status: 0, attempts, maxAttempts: MAX_ATTEMPTS });
        if (state === "failed") stats.mediaFailed++;
        await fail(state, `too large (${body.length}B > ${MAX_BYTES}B)`);
        continue;
      }
      if (!looksLikeMedia({ contentType, expectedContentType: row.expected_type, bytes: body.length })) {
        const state = nextAudioState({ status: 0, attempts, maxAttempts: MAX_ATTEMPTS });
        if (state === "failed") stats.mediaFailed++;
        await fail(state, `not media (${contentType || "no type"}, ${body.length}B)`);
        continue;
      }

      // ⚠️ The RESPONSE type names the file, falling back to what sms_archive
      // recorded. The response is the more current answer; the recorded one is
      // the only answer when a proxy strips the header, and between them a
      // patient's photo keeps an extension that tells the truth.
      const ext = extensionForMedia(contentType || row.expected_type);
      const key = objectKey({
        createdAt: row.created_at,
        rcMessageId: row.rc_message_id,
        rcAttachmentId: row.rc_attachment_id,
        ext,
      });
      await putObject({ key, body, contentType: contentType || row.expected_type || undefined });

      // ⚠️ Marked `stored` only AFTER the object is written. If the process dies
      // between the PUT and this UPDATE the row stays `pending` and the next run
      // re-uploads to the SAME key (it is derived from the ids), which overwrites
      // rather than duplicating. The other order would mark a photo safe that is
      // not in the bucket.
      await pool.query(
        `UPDATE mms_archive
            SET media_state = 'stored', object_key = $3, content_type = $4, bytes = $5,
                attempts = $6, last_error = NULL, last_attempt_at = now(), stored_at = now()
          WHERE rc_message_id = $1 AND rc_attachment_id = $2`,
        [row.rc_message_id, row.rc_attachment_id, key, contentType || row.expected_type || null, body.length, attempts],
      );
      stats.mediaStored++;
      stats.bytes += body.length;
    } catch (e) {
      const state = nextAudioState({ status: 0, attempts, maxAttempts: MAX_ATTEMPTS });
      if (state === "failed") stats.mediaFailed++;
      await fail(state, String((e && e.message) || e)).catch(() => {});
    }
    if (i < q.rows.length - 1) await sleep(gapMs);
  }
}

/** One reconcile at a time. A boot run and a timer tick can land together, and
 *  two drains at once would race each other for the same queue slice. */
let running = false;

/** ⚠️ No `now` parameter, unlike the two archives beside it, because there is
 *  nothing here for one to reach: the enqueue window is a SQL interval
 *  against `now()`, evaluated by Postgres. An accepted-and-ignored argument
 *  is worse than an absent one — it reads as a seam that can be tested. */
export async function reconcileMmsArchive({ pool } = {}) {
  if (!pool) return { ok: false, error: "archive pool not configured" };
  if (!rcConfigured()) return { ok: false, error: "RingCentral not configured" };
  if (!storeConfigured()) return { ok: false, error: "object store not configured (CALL_ARCHIVE_* env vars)" };
  if (running) return { ok: false, skipped: true, error: "a reconcile is already running" };
  running = true;

  const stats = {
    enqueued: 0,
    mediaTried: 0,
    mediaStored: 0,
    mediaFailed: 0,
    mediaGone: 0,
    bytes: 0,
    shed: false,
    shedHits: 0,
    busy: false,
    budget: 0,
  };
  let runId = null;
  try {
    runId = (
      await pool.query(`INSERT INTO mms_archive_runs (enqueue_days) VALUES ($1) RETURNING id`, [ENQUEUE_DAYS])
    ).rows[0]?.id;

    await enqueueFromSmsArchive({ pool, stats });
    await drainMediaQueue({ pool, stats });

    await pool.query(
      `UPDATE mms_archive_runs
          SET finished_at = now(), ok = true, enqueued = $2, media_tried = $3, media_stored = $4,
              media_failed = $5, media_gone = $6, bytes = $7, shed = $8
        WHERE id = $1`,
      [runId, stats.enqueued, stats.mediaTried, stats.mediaStored, stats.mediaFailed, stats.mediaGone, stats.bytes, stats.shed],
    );
    console.log(
      `mms_archive: ${stats.enqueued} part(s) enqueued over ${ENQUEUE_DAYS}d; ` +
        `${stats.mediaStored} stored, ${stats.mediaGone} gone, ${stats.mediaFailed} failed ` +
        `(budget ${stats.budget}${stats.busy ? ", office hours" : ""})` +
        `${stats.shed ? ` (SHED after ${stats.shedHits} refusal(s))` : ""}`,
    );
    return { ok: true, ...stats };
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("mms_archive reconcile failed:", msg);
    if (runId) {
      await pool
        .query(
          `UPDATE mms_archive_runs
              SET finished_at = now(), ok = false, enqueued = $2, media_tried = $3, media_stored = $4,
                  media_failed = $5, media_gone = $6, bytes = $7, shed = $8, error = $9
            WHERE id = $1`,
          [runId, stats.enqueued, stats.mediaTried, stats.mediaStored, stats.mediaFailed, stats.mediaGone, stats.bytes, stats.shed, msg.slice(0, 500)],
        )
        .catch(() => {});
    }
    return { ok: false, error: msg, ...stats };
  } finally {
    running = false;
  }
}

/**
 * Can we actually GET a photo back out?
 *
 * ⚠️⚠️ SAVING AND SERVING ARE DIFFERENT SIGNING CHAINS. A successful upload
 * proves the credentials, the endpoint and the HEADER-signed request work. A
 * presigned URL is QUERY-string SigV4 — a different code path — so the archive
 * can be filling perfectly while every attempt to open a photo 403s, and
 * nothing anywhere would say so. callArchive.mjs records shipping exactly that
 * bug and reporting a false alarm on the one signal that exists to be trusted.
 *
 * ⚠️ It must be a ranged **GET**, never a HEAD: SigV4 signs the HTTP METHOD, so
 * a URL signed from a GetObjectCommand is a GET-only URL and a HEAD to it is
 * SignatureDoesNotMatch every single time.
 *
 * ⚠️ Cached and NON-BLOCKING, because /mms/archive-health is unauthenticated
 * and polled by a monitor on a short timeout — a health endpoint that waits on
 * a third-party round trip can TIME OUT, which reads as an outage generated by
 * the monitoring itself.
 */
let _presign = { at: 0, ok: null };
const PRESIGN_CHECK_MS = 5 * 60_000;

function presignSelfCheck(pool) {
  if (!storeConfigured()) return null;
  if (Date.now() - _presign.at >= PRESIGN_CHECK_MS) {
    _presign = { at: Date.now(), ok: _presign.ok };
    void refreshPresignCheck(pool);
  }
  return _presign.ok;
}

async function refreshPresignCheck(pool) {
  try {
    const q = await pool.query(
      `SELECT object_key, content_type FROM mms_archive
        WHERE media_state = 'stored' AND object_key IS NOT NULL
        ORDER BY stored_at DESC LIMIT 1`,
    );
    const row = q.rows[0];
    // Nothing stored yet is not a failure — there is simply nothing to sign.
    if (!row) {
      _presign = { at: Date.now(), ok: null };
      return null;
    }
    const url = await presignGet({ key: row.object_key, expiresIn: 60, contentType: row.content_type });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    try {
      const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: ctl.signal });
      _presign = { at: Date.now(), ok: res.ok };
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
        } catch {
          /* no body */
        }
        console.error(`mms_archive: presigned GET self-check failed (${res.status}) ${detail}`);
      }
      return res.ok;
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    console.error("mms_archive: presigned GET self-check errored:", String((e && e.message) || e));
    _presign = { at: Date.now(), ok: false };
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Routes
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ The SAME service token as the call and voicemail archives, deliberately.
 * All three answer the one question "may this service read archived patient
 * media", so a second token would be a second secret to rotate, a second thing
 * to set on every consumer and a second thing to forget — for no additional
 * boundary.
 */
const SERVICE_TOKEN = process.env.CALL_ARCHIVE_SERVICE_TOKEN || "";
const FORCE_MIN_GAP_MS = Math.max(Number(process.env.MMS_ARCHIVE_FORCE_MIN_GAP_MINUTES) || 5, 0) * 60_000;
let lastForcedAt = 0;

/** The shape a row is handed out in. ⚠️ `last4` and never the number — the
 *  archive holds an HMAC, and a caller who knows the number can find the rows
 *  by sending it (we hash what they bring), which is `/directory/lookup`'s
 *  posture: nothing is disclosed that the caller did not already hold. */
function publicRow(r) {
  return {
    messageId: r.rc_message_id,
    attachmentId: r.rc_attachment_id,
    direction: r.direction,
    last4: r.last4,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    hasMedia: r.media_state === "stored",
    mediaState: r.media_state,
    bytes: r.bytes === null || r.bytes === undefined ? null : Number(r.bytes),
    contentType: r.content_type || r.expected_type || null,
    storedAt: r.stored_at ? new Date(r.stored_at).toISOString() : null,
  };
}

export function registerMmsArchive({ app, pool, requireCaller }) {
  // Master kill switch. The archive is additive and shed-first, but if it ever
  // needs stopping it must be stoppable from Railway in seconds — without a
  // revert and a redeploy of the service that also carries patient texting.
  const killed = process.env.MMS_ARCHIVE_ENABLED === "0";
  const disabled = killed || !pool;
  if (killed) console.warn("WARN: MMS media archive disabled by MMS_ARCHIVE_ENABLED=0");
  else if (!pool) console.warn("WARN: MMS media archive disabled (messaging Postgres not configured)");

  if (disabled) {
    // ⚠️⚠️ THE HEALTH ROUTE SURVIVES THE KILL SWITCH, and that is the point of
    // putting it before the early return. Without it, flipping the switch
    // during an incident makes /mms/archive-health 404 — which a monitor
    // reports as "could not reach the health check", i.e. turning a deliberate
    // shutdown into a fresh alert stream at the exact moment somebody is
    // already dealing with something.
    app.get("/mms/archive-health", (_req, res) => {
      res.json({
        ok: true,
        enabled: false,
        reason: killed
          ? "the MMS media archive is switched off (MMS_ARCHIVE_ENABLED=0)"
          : "the MMS media archive is not configured (messaging Postgres missing)",
      });
    });
    return;
  }
  if (!storeConfigured()) {
    // ⚠️ A warning, not a throw. A gateway with no bucket configured must still
    // boot and carry patient texting; the archive simply does not run, and
    // /mms/archive-health says so rather than the process dying.
    console.warn("WARN: MMS media archive disabled (object store not configured — set CALL_ARCHIVE_* env vars)");
  }

  /**
   * A verified employee, OR a service holding the shared token.
   *
   * ⚠️ Same shape as the two archives beside it, including the `authEnforced()`
   * clause: `requireCaller` answers 401 ITSELF only when auth is enforced, so in
   * a build with no Google client id it returns null having sent nothing — and
   * returning there would hang the request for ever.
   */
  async function caller(req, res) {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (SERVICE_TOKEN && bearer && bearer.length === SERVICE_TOKEN.length) {
      let diff = 0;
      for (let i = 0; i < SERVICE_TOKEN.length; i++) diff |= bearer.charCodeAt(i) ^ SERVICE_TOKEN.charCodeAt(i);
      if (diff === 0) return "service";
    }
    if (!requireCaller) return "anon";
    const who = await requireCaller(req, res);
    if (who === null && authEnforced()) return null;
    return who || "anon";
  }

  /**
   * ⚠️ UNAUTHENTICATED, matching /voicemail/archive-health, /calls/archive-health
   * and /calls/health beside it: counts and timestamps only, never a number, a
   * message id or an employee email. The whole point is that an outage here is
   * silent, so the check has to be reachable by whatever is watching —
   * including the calls-monitor cron, which carries no token.
   */
  app.get("/mms/archive-health", async (_req, res) => {
    try {
      if (!pool) return res.json({ ok: false, reason: "messaging Postgres not configured" });
      const q = await pool.query(
        `SELECT
           (SELECT max(finished_at) FROM mms_archive_runs WHERE ok)                              AS last_ok,
           -- ⚠️ AND NOT shed — a pass cut short by a throttle did not drain, so
           -- treating it as complete would let an archive that sheds every run
           -- report healthy for ever while the 30-day window closes.
           (SELECT max(finished_at) FROM mms_archive_runs WHERE ok AND NOT shed)                 AS last_complete,
           (SELECT max(started_at)  FROM mms_archive_runs)                                        AS last_run,
           (SELECT error FROM mms_archive_runs WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1)  AS last_error,
           (SELECT count(*) FROM mms_archive)                                                     AS rows,
           (SELECT count(*) FROM mms_archive WHERE media_state = 'stored')                        AS stored,
           (SELECT count(*) FROM mms_archive WHERE media_state = 'pending')                       AS pending,
           (SELECT count(*) FROM mms_archive WHERE media_state = 'failed')                        AS failed,
           (SELECT count(*) FROM mms_archive WHERE media_state = 'gone')                          AS gone,
           (SELECT coalesce(sum(bytes),0) FROM mms_archive WHERE media_state = 'stored')          AS bytes,
           (SELECT min(created_at) FROM mms_archive)                                              AS oldest,
           (SELECT max(created_at) FROM mms_archive)                                              AS newest,
           (SELECT min(created_at) FROM mms_archive WHERE media_state = 'pending')                AS oldest_pending`,
      );
      const r = q.rows[0] || {};
      const presignOk = presignSelfCheck(pool);
      res.json({
        ...archiveHealth({
          lastOkAt: r.last_ok,
          lastCompleteAt: r.last_complete,
          lastRunAt: r.last_run,
          lastError: r.last_error,
          rows: r.rows,
          stored: r.stored,
          pending: r.pending,
          failed: r.failed,
          gone: r.gone,
          bytes: r.bytes,
          oldest: r.oldest,
          newest: r.newest,
          oldestPendingAt: r.oldest_pending,
          presignOk,
        }),
        enabled: true,
        storeConfigured: storeConfigured(),
        bucket: storeConfigured() ? storeName() : null,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  });

  /**
   * Force a run, so iterating costs neither a redeploy nor an hour.
   *
   * ⚠️ AUTHENTICATED **AND** RATE-FLOORED, both, unlike the health route beside
   * it. `running` only blocks CONCURRENT runs, so a client that posts again
   * each time the last one finishes gets a fresh full drain every time. That is
   * precisely the shape of the 2026-08-20 incident: one runaway, AUTHENTICATED
   * client draining the shared RingCentral account and taking texting down for
   * the whole company. Auth alone would not have stopped it.
   */
  app.post("/mms/archive-run", async (req, res) => {
    const who = await caller(req, res);
    if (who === null) return;
    const since = Date.now() - lastForcedAt;
    if (since < FORCE_MIN_GAP_MS) {
      return res.status(429).json({
        error: "A forced run happened too recently",
        retryAfterSeconds: Math.ceil((FORCE_MIN_GAP_MS - since) / 1000),
      });
    }
    // Stamped BEFORE the run, so a burst is capped by the floor rather than by
    // how long each pass happens to take.
    lastForcedAt = Date.now();
    const out = await reconcileMmsArchive({ pool });
    res.status(out.ok ? 200 : 502).json(out);
  });

  /**
   * The bytes, for the Command Center and for other services.
   *
   * Default is a **302 to a presigned URL**: the browser (or the service)
   * fetches straight from the bucket, where egress is free and the gateway
   * never touches the bytes.
   *
   * ⚠️⚠️ A PRESIGNED URL IS A BEARER CREDENTIAL FOR PHI — copyable out of a
   * network tab, and it works for anyone holding it until it expires. This one
   * is a photograph of an insurance card. Three things bound that, none
   * optional: it is issued only behind the caller check above; its life is
   * minutes (URL_TTL_SECONDS, capped at an hour in the rules module); and
   * **every issuance is written to mms_archive_access**, because an untracked
   * bearer credential for a patient's document is indistinguishable from a leak.
   *
   * ⚠️ `?mode=proxy` streams the bytes through the gateway instead. It exists
   * because a browser `fetch()` following a cross-origin redirect needs CORS on
   * the bucket, which Railway buckets do not expose a way to configure — so an
   * `<img src>` or an `<a href>` can take the 302 and a `fetch()`-based caller
   * takes the proxy. Both are authenticated; only the cost differs.
   *
   * ⚠️ `attachmentId` is OPTIONAL and that is a real affordance, not laziness:
   * most MMS carry exactly one part, and a caller holding only a message id
   * would otherwise be at a dead end. Several stored parts answers 400 LISTING
   * THEM, so the passing move is on screen rather than left to be guessed.
   */
  app.get("/mms/media", async (req, res) => {
    const who = await caller(req, res);
    if (who === null) return;
    if (!storeConfigured()) return res.status(503).json({ error: "object store not configured" });
    const messageId = String(req.query?.messageId || "").trim();
    const attachmentId = String(req.query?.attachmentId || "").trim();
    if (!messageId) return res.status(400).json({ error: "messageId is required" });

    try {
      const q = await pool.query(
        attachmentId
          ? `SELECT rc_message_id, rc_attachment_id, object_key, content_type, expected_type,
                    media_state, created_at, last4
               FROM mms_archive WHERE rc_message_id = $1 AND rc_attachment_id = $2`
          : `SELECT rc_message_id, rc_attachment_id, object_key, content_type, expected_type,
                    media_state, created_at, last4
               FROM mms_archive WHERE rc_message_id = $1 ORDER BY rc_attachment_id`,
        attachmentId ? [messageId, attachmentId] : [messageId],
      );
      if (!q.rows.length) {
        return res.status(404).json({ error: "no archived media with that id", messageId, attachmentId: attachmentId || null });
      }
      const stored = q.rows.filter((r) => r.media_state === "stored" && r.object_key);
      if (!stored.length) {
        // ⚠️ The state is REPORTED rather than flattened to a 404. "RingCentral
        // never gave us the bytes", "it was purged before we got there" and
        // "it is queued, come back shortly" are three different answers with
        // three different next moves, and a bare 404 makes them one.
        return res.status(404).json({
          error: "no media archived for that message",
          messageId,
          mediaStates: q.rows.map((r) => ({ attachmentId: r.rc_attachment_id, mediaState: r.media_state })),
        });
      }
      if (stored.length > 1) {
        return res.status(400).json({
          error: "that message has several archived parts — pass attachmentId",
          messageId,
          attachmentIds: stored.map((r) => r.rc_attachment_id),
        });
      }
      const row = stored[0];

      const type = row.content_type || row.expected_type || "application/octet-stream";
      const ext = extensionForMedia(type);
      const filename =
        String(req.query?.filename || "").replace(/[^\w.\- ]/g, "").slice(0, 120) ||
        fallbackFilename({ createdAt: row.created_at, last4: row.last4, ext });

      const mode = req.query?.mode === "proxy" ? "proxy" : "presigned";
      // Fire-and-forget: an audit row must never be able to fail the fetch, and
      // it must never be able to make this route slow.
      void pool
        .query(
          `INSERT INTO mms_archive_access (rc_message_id, rc_attachment_id, actor, mode) VALUES ($1,$2,$3,$4)`,
          [messageId, row.rc_attachment_id, who, mode],
        )
        .catch(() => {});

      if (mode === "proxy") {
        const out = await getObjectStream(row.object_key);
        res.status(200).set("Content-Type", type);
        if (out.bytes) res.set("Content-Length", String(out.bytes));
        res.set("Content-Disposition", `inline; filename="${filename}"`);
        // ⚠️ Streamed, not buffered — and both stream shapes are handled: the
        // SDK's `Body` is a Node Readable on this runtime but a WEB
        // ReadableStream under some configurations, and a web stream has no
        // `.pipe`, so assuming one is a TypeError inside a route that has
        // already sent its headers, i.e. a dead connection rather than an error
        // anybody can read.
        if (typeof out.body?.pipe === "function") {
          out.body.pipe(res);
        } else {
          Readable.fromWeb(out.body).pipe(res);
        }
        return;
      }

      const url = await presignGet({
        key: row.object_key,
        expiresIn: URL_TTL_SECONDS,
        filename: req.query?.download === "1" ? filename : undefined,
        contentType: type,
      });
      if (req.query?.json === "1") {
        return res.json({ ok: true, url, expiresInSeconds: URL_TTL_SECONDS, filename });
      }
      // ⚠️ no-store. A 302 to a credential-bearing URL must not sit in a shared
      // cache or a browser's back-forward cache after it has expired.
      res.set("Cache-Control", "no-store");
      return res.redirect(302, url);
    } catch (e) {
      res.status(502).json({ error: String((e && e.message) || e) });
    }
  });

  /**
   * The metadata query — what the Command Center and other services read.
   *
   * ⚠️ This is deliberately ALSO the batched "do we hold media for these"
   * question, rather than a second `/mms/have` route beside it: pass
   * `messageIds` and it answers for exactly those. One route doing both jobs
   * beats shipping an endpoint with no caller, which §5.31b records as the
   * module that "does not fail; it is absent, and its green tests say
   * otherwise".
   *
   * ⚠️ It answers with `last4`, never the number, because the archive stores an
   * HMAC. A caller who KNOWS a number can find its media by sending it — we
   * hash what they bring — which is exactly `/directory/lookup`'s posture.
   */
  app.post("/mms/archive/query", async (req, res) => {
    const who = await caller(req, res);
    if (who === null) return;
    const body = req.body || {};
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 1000);
    const sinceDays = Math.min(Math.max(Number(body.sinceDays) || 30, 1), 3650);
    const messageIds = Array.isArray(body.messageIds) ? body.messageIds.map(String).slice(0, 500) : [];
    const phones = Array.isArray(body.phones) ? body.phones.map(String).slice(0, 100) : [];

    try {
      const where = [];
      const args = [];
      // ⚠️ An explicit id list is NOT date-bounded. A caller asking about
      // specific messages already knows which ones it wants, and silently
      // dropping the ones older than `sinceDays` would answer "we hold no media
      // for that" about a photo sitting in the bucket — the exact wrong answer
      // for the aged-out messages this archive exists for.
      if (messageIds.length) {
        args.push(messageIds);
        where.push(`rc_message_id = ANY($${args.length}::text[])`);
      } else {
        args.push(String(sinceDays));
        where.push(`created_at >= now() - ($${args.length} || ' days')::interval`);
      }
      if (phones.length) {
        // Hashed with the SAME helper that stamped the column on the way in — by
        // way of sms_archive, which is where these hashes come from. A read that
        // normalised differently would match nothing and report an empty
        // history, which is the failure this module exists to prevent.
        const hashes = phones.map((p) => phoneHmac(p)).filter(Boolean);
        if (!hashes.length) return res.json({ ok: true, media: [] });
        args.push(hashes);
        where.push(`phone_hmac = ANY($${args.length}::text[])`);
      }
      args.push(limit);
      const q = await pool.query(
        `SELECT rc_message_id, rc_attachment_id, direction, last4, created_at, media_state,
                bytes, content_type, expected_type, stored_at
           FROM mms_archive
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC, rc_attachment_id
          LIMIT $${args.length}`,
        args,
      );
      // ⚠️ Echo the window actually used. A silently narrowed window reads as
      // "nothing happened" — the same reason /calls/history echoes its bounds.
      res.json({
        ok: true,
        sinceDays: messageIds.length ? null : sinceDays,
        limit,
        media: q.rows.map(publicRow),
      });
    } catch (e) {
      /* ⚠️ A failure is an ERROR, not an empty result. `[]` means "we hold
         nothing", which a caller acts on by drawing no image — so a 200 with
         `[]` on a dead database is indistinguishable from an archive that
         legitimately has nothing, which is §5.27's silence one table over. */
      res.status(502).json({ ok: false, error: String((e && e.message) || e) });
    }
  });

  void (async () => {
    try {
      await pool.query(SCHEMA);
      console.log("MMS media archive schema ready");
    } catch (e) {
      console.error("MMS media archive schema failed:", e.message);
      return;
    }
    if (!storeConfigured()) return;

    // Hourly thereafter. unref() so a pending timer can never hold the process
    // open through a redeploy.
    setInterval(() => void reconcileMmsArchive({ pool }), EVERY_MS).unref?.();

    // Boot run, unless one landed recently. Delayed so a cold start is not
    // competing with the traffic that woke it — and offset from the call
    // archive's boot run (90s) and the voicemail archive's (150s), so a
    // redeploy does not fire three scans at the same RingCentral account in the
    // same second.
    setTimeout(() => {
      void (async () => {
        try {
          const q = await pool.query(`SELECT max(finished_at) AS last_ok FROM mms_archive_runs WHERE ok`);
          const lastOk = q.rows[0]?.last_ok ? new Date(q.rows[0].last_ok).getTime() : 0;
          if (Date.now() - lastOk < MIN_GAP_MS) {
            console.log("mms_archive: boot run skipped, a recent run already succeeded");
            return;
          }
          await reconcileMmsArchive({ pool });
        } catch (e) {
          console.error("mms_archive boot run failed:", e.message);
        }
      })();
    }, 210_000).unref?.();
  })();
}
