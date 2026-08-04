/**
 * assignments.mjs — patient-phone → rep assignment store for the "Assigned
 * Patients" role, plus per-rep read state for its inbox.
 *
 * Lives on its OWN Postgres (ASSIGNMENTS_DATABASE_URL), separate from the audit
 * DB, so the audit instance keeps its "metadata only, no PHI" property.
 *
 * ── Why the numbers are hashed ──────────────────────────────────────────────
 * A phone number tied to a patient IS PHI (one of HIPAA's 18 identifiers). This
 * table stores HMAC-SHA256(pepper, E.164) instead of the number, plus the Monday
 * item id. That makes it a routing table holding nothing patient-identifying:
 * everything human-readable (name, number) is fetched from Monday at render
 * time, which the UI has to do anyway.
 *
 * ⚠️ The pepper is load-bearing, not decoration. A bare SHA-256 of a 10-digit
 * number is brute-forceable in seconds (~10^10 candidates), so this MUST be an
 * HMAC with a server-side secret. If PHONE_HMAC_PEPPER is unset the routes 503
 * rather than silently falling back to an unpeppered digest.
 *
 * Because the pepper never leaves the server, the browser cannot compute a hash
 * — so lookups are "here are the numbers I'm looking at, tell me which are
 * assigned" (POST /assignments/match). The gateway already proxies those very
 * messages, so the client is not handing over anything new.
 *
 * ── Read state ──────────────────────────────────────────────────────────────
 * RingCentral's readStatus is ACCOUNT-wide: if one rep reads a thread it is read
 * for everyone. Per-rep unread therefore lives here, as a last-read timestamp
 * per (rep, thread). A thread is unread when its newest inbound message is newer
 * than that stamp — the same "newer than the stamp reopens it" shape as
 * lib/patientQuestions/handled.ts, so a new patient message reopens the thread
 * with no extra bookkeeping.
 *
 * Required env:  ASSIGNMENTS_DATABASE_URL, PHONE_HMAC_PEPPER
 */
import pkg from "pg";
const { Pool } = pkg;

import { verifyGoogleIdentity, authEnforced } from "./auth.mjs";
import { rcApiFetch, SIP_PROVISION_PATH } from "./ringcentral.mjs";
import { toE164, phoneHmac, hashingConfigured } from "./phoneHash.mjs";

export { toE164, phoneHmac };

const { ASSIGNMENTS_DATABASE_URL } = process.env;

/**
 * Who may assign patients and see everyone's assignments.
 *
 * The SPA's source of truth for this is access.json, but the gateway can't read
 * it: it has no GitHub token (the SPA reaches access.json through the worker's
 * /gh-state), and this one gateway serves BOTH the test and prod SPAs, which
 * have separate data repos. So the manager list is mirrored here as an env var.
 *
 * ⚠️ That mirror can drift. It fails SAFE — a manager added in /access but not
 * here gets a clear 403 on assign rather than silent access — but if assigning
 * suddenly 403s for someone, this list is the first place to look.
 *
 * Unset → NOBODY is a manager (fails closed), which is logged loudly at boot.
 * Set it.
 */
const MANAGER_EMAILS = new Set(
  (process.env.MANAGER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

function sslFor(url) {
  // Railway's INTERNAL connection string needs no SSL; external ones do.
  return /sslmode=disable/.test(url || "") ? false : { rejectUnauthorized: false };
}

const pool = ASSIGNMENTS_DATABASE_URL
  ? new Pool({ connectionString: ASSIGNMENTS_DATABASE_URL, max: 5, ssl: sslFor(ASSIGNMENTS_DATABASE_URL) })
  : null;

const configured = () => !!(pool && hashingConfigured());

if (!pool) console.warn("WARN: ASSIGNMENTS_DATABASE_URL not set — Assigned Patients is DISABLED");
else if (!hashingConfigured()) console.warn("WARN: PHONE_HMAC_PEPPER not set — Assigned Patients is DISABLED");
if (!MANAGER_EMAILS.size) {
  console.warn(
    "WARN: MANAGER_EMAILS not set — NOBODY can assign patients or see the manager views (fails closed). Set it to the access.json manager list.",
  );
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS phone_assignments (
  phone_hmac      TEXT PRIMARY KEY,
  rep_email       TEXT NOT NULL,
  monday_item_id  TEXT NOT NULL,
  monday_board_id TEXT,
  assigned_by     TEXT,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_assignments_rep_idx ON phone_assignments (rep_email);

CREATE TABLE IF NOT EXISTS thread_reads (
  rep_email    TEXT NOT NULL,
  phone_hmac   TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rep_email, phone_hmac)
);
`;

async function ensureSchema() {
  if (!pool) return;
  try {
    await pool.query(SCHEMA);
    console.log("Assignments schema ready");
  } catch (e) {
    console.error("Assignments schema failed:", e.message);
  }
}
void ensureSchema();

const norm = (e) => String(e || "").trim().toLowerCase();

export function registerAssignments({ app }) {
  /** Verified caller's email, or null.
   *
   *  Uses verifyGoogleIdentity (signature + domain, `exp` ignored) rather than
   *  verifyGoogleToken, because these routes BLOCK on identity and the SPA
   *  never refreshes its Google token — sign-in is the durable gate here, so an
   *  expiry check would 401 every rep about an hour after they signed in. */
  async function actor(req) {
    const u = await verifyGoogleIdentity(req.headers["x-mm-auth"]);
    return u ? (u.email || "").toLowerCase() : null;
  }

  /** ⚠️ Fails CLOSED. An unset MANAGER_EMAILS means nobody is a manager, not
   *  everybody — an empty allowlist must never read as "allow all". The boot
   *  warning says so, and the symptom is a clear 403 on assigning rather than
   *  silent write access for every signed-in employee. */
  function isManager(email) {
    return !!email && MANAGER_EMAILS.has(email);
  }

  /**
   * Resolve the caller and the rep whose data they're asking about.
   *
   * Every route below routes through this so identity can't be spoofed from the
   * body: a non-manager is always pinned to their OWN email regardless of what
   * they sent. Returns null after responding when the caller isn't allowed.
   */
  async function resolveCaller(req, res, { requireManager = false } = {}) {
    const who = await actor(req);
    if (authEnforced() && !who) {
      res.status(401).json({ error: "Sign in required" });
      return null;
    }
    const manager = isManager(who);
    if (requireManager && !manager) {
      res.status(403).json({ error: "Only a manager can change assignments" });
      return null;
    }
    return { who, manager };
  }

  /** The rep a request may act on: managers may name anyone, everyone else is
   *  pinned to themselves whatever the body says. */
  function scopedRep(caller, requested) {
    return caller.manager ? norm(requested || caller.who || "") : norm(caller.who || "");
  }

  function guard(res) {
    if (configured()) return false;
    res.status(503).json({
      error:
        "Assigned Patients is not configured on the gateway (needs ASSIGNMENTS_DATABASE_URL and PHONE_HMAC_PEPPER).",
    });
    return true;
  }

  /** Which of these numbers are assigned, and when did this rep last read them?
   *  Keyed by the caller's OWN input strings so the browser can match without
   *  ever seeing a hash. */
  app.post("/assignments/match", async (req, res) => {
    if (guard(res)) return;
    const caller = await resolveCaller(req, res);
    if (!caller) return;
    const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];
    const rep = scopedRep(caller, req.body?.rep);
    if (!phones.length) return res.json({});
    // Map hash → every raw input that produced it (callers may send the same
    // number in several formats across conversations).
    const byHash = new Map();
    for (const p of phones) {
      const h = phoneHmac(p);
      if (!h) continue;
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(p);
    }
    const hashes = [...byHash.keys()];
    if (!hashes.length) return res.json({});
    try {
      // A non-manager only ever learns about their OWN assignments. Without
      // this they could submit numbers they can see in the shared inbox and
      // read back who handles each one.
      const rows = await pool.query(
        `SELECT a.phone_hmac, a.rep_email, a.monday_item_id, a.monday_board_id, r.last_read_at
           FROM phone_assignments a
           LEFT JOIN thread_reads r
             ON r.phone_hmac = a.phone_hmac AND r.rep_email = $2
          WHERE a.phone_hmac = ANY($1::text[])
            AND ($3::boolean OR a.rep_email = $2)`,
        [hashes, rep, caller.manager],
      );
      const out = {};
      for (const row of rows.rows) {
        for (const raw of byHash.get(row.phone_hmac) || []) {
          out[raw] = {
            repEmail: row.rep_email,
            mondayItemId: row.monday_item_id,
            mondayBoardId: row.monday_board_id,
            lastReadAt: row.last_read_at ? new Date(row.last_read_at).toISOString() : null,
          };
        }
      }
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /** A rep's assignments. No raw numbers here by design — the caller resolves
   *  monday_item_id against Monday for the name and number. */
  app.get("/assignments", async (req, res) => {
    if (guard(res)) return;
    const caller = await resolveCaller(req, res);
    if (!caller) return;
    // ⚠️ A non-manager with no verified identity would otherwise resolve to an
    // EMPTY rep, and an empty rep falls through to the enumerate-everything
    // branch below — i.e. the exact hole the scoping is here to close, reachable
    // whenever auth enforcement is off or the token is missing. Refuse instead:
    // "I don't know who you are" must never widen access.
    if (!caller.manager && !caller.who) {
      return res.status(403).json({ error: "Sign in to see your assignments" });
    }
    // Only a manager may omit `rep` and enumerate everything; anyone else is
    // pinned to their own rows even if they ask for someone else's.
    const rep = caller.manager ? norm(req.query?.rep || "") : norm(caller.who);
    try {
      const rows = rep
        ? await pool.query(
            `SELECT phone_hmac, rep_email, monday_item_id, monday_board_id, assigned_by, assigned_at
               FROM phone_assignments WHERE rep_email = $1 ORDER BY assigned_at DESC`,
            [rep],
          )
        : await pool.query(
            `SELECT phone_hmac, rep_email, monday_item_id, monday_board_id, assigned_by, assigned_at
               FROM phone_assignments ORDER BY assigned_at DESC`,
          );
      res.json(
        rows.rows.map((r) => ({
          phoneHmac: r.phone_hmac,
          repEmail: r.rep_email,
          mondayItemId: r.monday_item_id,
          mondayBoardId: r.monday_board_id,
          assignedBy: r.assigned_by,
          assignedAt: r.assigned_at ? new Date(r.assigned_at).toISOString() : null,
        })),
      );
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /** Assign a patient to a rep. Re-assigning an already-assigned number moves
   *  it (PRIMARY KEY upsert) — one number is owned by exactly one rep. */
  app.post("/assignments", async (req, res) => {
    if (guard(res)) return;
    const caller = await resolveCaller(req, res, { requireManager: true });
    if (!caller) return;
    const who = caller.who;
    const { phone, repEmail, mondayItemId, mondayBoardId } = req.body || {};
    const hash = phoneHmac(phone);
    const rep = norm(repEmail);
    if (!hash) return res.status(400).json({ error: "A valid phone number is required" });
    if (!rep) return res.status(400).json({ error: "repEmail is required" });
    if (!mondayItemId) return res.status(400).json({ error: "mondayItemId is required" });
    try {
      await pool.query(
        `INSERT INTO phone_assignments (phone_hmac, rep_email, monday_item_id, monday_board_id, assigned_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (phone_hmac) DO UPDATE
           SET rep_email = EXCLUDED.rep_email,
               monday_item_id = EXCLUDED.monday_item_id,
               monday_board_id = EXCLUDED.monday_board_id,
               assigned_by = EXCLUDED.assigned_by,
               assigned_at = now()`,
        [hash, rep, String(mondayItemId), mondayBoardId ? String(mondayBoardId) : null, who],
      );
      res.json({ ok: true, phoneHmac: hash });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /** Unassign. POST rather than DELETE: the gateway's CORS layer advertises
   *  GET/POST/PUT only, and widening it for one route isn't worth it. */
  app.post("/assignments/remove", async (req, res) => {
    if (guard(res)) return;
    const caller = await resolveCaller(req, res, { requireManager: true });
    if (!caller) return;
    const hash = req.body?.phoneHmac || phoneHmac(req.body?.phone);
    if (!hash) return res.status(400).json({ error: "phone or phoneHmac is required" });
    try {
      await pool.query(`DELETE FROM phone_assignments WHERE phone_hmac = $1`, [hash]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /** Mark a thread read for the calling rep, as of now.
   *
   *  The rep comes from the VERIFIED TOKEN, never the body — otherwise anyone
   *  could clear a colleague's unread dot and quietly drop a patient out of
   *  their unread view until the next inbound message. */
  app.post("/assignments/read", async (req, res) => {
    if (guard(res)) return;
    const caller = await resolveCaller(req, res);
    if (!caller) return;
    const rep = norm(caller.who || "");
    const hash = phoneHmac(req.body?.phone);
    if (!rep) return res.status(400).json({ error: "rep is required" });
    if (!hash) return res.status(400).json({ error: "A valid phone number is required" });
    try {
      await pool.query(
        `INSERT INTO thread_reads (rep_email, phone_hmac, last_read_at)
         VALUES ($1,$2,now())
         ON CONFLICT (rep_email, phone_hmac) DO UPDATE SET last_read_at = now()`,
        [rep, hash],
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /* ── The inbox itself ──────────────────────────────────────────────────────
   *
   * These two routes exist so that a rep's browser never receives the shared
   * account's messages in the first place. The MM number is ONE RingCentral
   * inbox holding every patient conversation; the per-rep view is created by
   * assignment. Fetching it in the browser and filtering there would leave every
   * patient's number and last message in each rep's network response and memory
   * — client-side filtering is a UI convention, not a boundary. So the gateway
   * fetches from RingCentral, joins against the assignments table, and returns
   * only what the caller is entitled to.
   */

  const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

  /**
   * Group the shared account's SMS into per-counterparty threads.
   *
   * ⚠️ This PAGES. A single 250-message page is roughly a couple of days on the
   * shared number, and an unpaged scan doesn't just undercount the inbox — an
   * assigned patient whose last text falls outside that page drops out of their
   * rep's queue entirely, with no error. The whole window has to be read.
   *
   * ⚠️ And it CACHES, because the scan is account-wide and identical for every
   * caller: without this, N reps polling every 20s means N full scans of the
   * message store every 20s. One in-flight scan is shared by all callers.
   */
  const THREADS_TTL_MS = 45_000;
  const THREADS_PAGE_SIZE = 250;
  const THREADS_MAX_PAGES = 40; // 10k messages across the window
  let _threads = { at: 0, value: null };
  let _threadsInFlight = null;

  async function scanThreads(sinceDays) {
    const dateFrom = new Date(Date.now() - sinceDays * 24 * 60 * 60_000).toISOString();
    const threads = new Map();
    for (let page = 1; page <= THREADS_MAX_PAGES; page++) {
      const res = await rcApiFetch(
        `/restapi/v1.0/account/~/extension/~/message-store` +
          `?messageType=SMS&dateFrom=${encodeURIComponent(dateFrom)}` +
          `&perPage=${THREADS_PAGE_SIZE}&page=${page}`,
      );
      if (!res.ok) throw new Error(`RingCentral SMS threads failed (${res.status})`);
      const json = await res.json();
      const records = json.records ?? [];
      for (const r of records) {
        const outbound = r.direction === "Outbound";
        // The conversation key is always the OUTSIDE party.
        const other = toE164(outbound ? (r.to ?? [])[0]?.phoneNumber || "" : r.from?.phoneNumber || "");
        if (!other) continue;
        const time = r.creationTime ?? "";
        const text = r.subject ?? r.text ?? "";
        const inboundTime = outbound ? "" : time;
        const cur = threads.get(other);
        if (!cur) {
          threads.set(other, {
            phone: other,
            lastText: text,
            lastTime: time,
            lastDirection: outbound ? "Outbound" : "Inbound",
            lastInboundTime: inboundTime,
            messageCount: 1,
          });
          continue;
        }
        cur.messageCount += 1;
        if (inboundTime && (!cur.lastInboundTime || inboundTime > cur.lastInboundTime)) {
          cur.lastInboundTime = inboundTime;
        }
        if (time && time > cur.lastTime) {
          cur.lastText = text;
          cur.lastTime = time;
          cur.lastDirection = outbound ? "Outbound" : "Inbound";
        }
      }
      if (records.length < THREADS_PAGE_SIZE) break; // short page = last page
    }
    return [...threads.values()].sort((a, b) => String(b.lastTime).localeCompare(String(a.lastTime)));
  }

  async function loadThreads({ sinceDays = 180 }) {
    if (_threads.value && Date.now() - _threads.at < THREADS_TTL_MS) return _threads.value;
    if (_threadsInFlight) return _threadsInFlight;
    _threadsInFlight = (async () => {
      const value = await scanThreads(sinceDays);
      _threads = { at: Date.now(), value };
      return value;
    })();
    try {
      return await _threadsInFlight;
    } finally {
      _threadsInFlight = null;
    }
  }

  /** The caller's inbox: ONLY conversations assigned to them.
   *
   *  There is deliberately no "unassigned" list (Josh, 2026-08-04). The shared
   *  number carries every patient conversation in the company, so surfacing the
   *  unassigned remainder just reproduced the RingCentral inbox this page exists
   *  to replace. Assignment happens through the Assign dialog's patient search,
   *  which starts from the patient rather than from a stray number. */
  app.get("/assignments/inbox", async (req, res) => {
    if (guard(res)) return;
    const caller = await resolveCaller(req, res);
    if (!caller) return;
    if (!caller.manager && !caller.who) {
      return res.status(403).json({ error: "Sign in to see your inbox" });
    }
    const rep = scopedRep(caller, req.query?.rep);
    try {
      const threads = await loadThreads({});
      const rows = await pool.query(
        `SELECT a.phone_hmac, a.rep_email, a.monday_item_id, a.monday_board_id, r.last_read_at
           FROM phone_assignments a
           LEFT JOIN thread_reads r
             ON r.phone_hmac = a.phone_hmac AND r.rep_email = $1`,
        [rep],
      );
      const byHash = new Map(rows.rows.map((r) => [r.phone_hmac, r]));

      const mine = [];
      const matched = new Set();
      for (const t of threads) {
        const hash = phoneHmac(t.phone);
        const row = byHash.get(hash);
        if (!row || row.rep_email !== rep) continue;
        matched.add(hash);
        mine.push({
          ...t,
          assignment: {
            repEmail: row.rep_email,
            mondayItemId: row.monday_item_id,
            mondayBoardId: row.monday_board_id,
            lastReadAt: row.last_read_at ? new Date(row.last_read_at).toISOString() : null,
          },
        });
      }

      // Assigned patients who have never exchanged a text have no RingCentral
      // thread, so the loop above cannot find them — they'd be assigned and yet
      // completely invisible, with no way to open them and no way to call. Send
      // them through as `pending`: no phone number (we only hold a hash), just
      // the Monday item id, which is what the client resolves names and numbers
      // from anyway. It renders them as empty conversations.
      const pending = rows.rows
        .filter((r) => r.rep_email === rep && !matched.has(r.phone_hmac))
        .map((r) => ({
          mondayItemId: r.monday_item_id,
          mondayBoardId: r.monday_board_id,
          lastReadAt: r.last_read_at ? new Date(r.last_read_at).toISOString() : null,
        }));

      res.json({ threads: mine, pending });
    } catch (e) {
      res.status(502).json({ error: String((e && e.message) || e) });
    }
  });

  /** One conversation's full message history, oldest → newest.
   *
   *  Authorized per number: knowing a phone number must not be enough to read
   *  the thread. A rep gets their own assigned conversations; a manager gets
   *  any. Pages to the end of the history and reports whether it got there,
   *  because the client's opt-out guard treats a partial history as consent
   *  UNKNOWN rather than consent given. */
  app.post("/assignments/conversation", async (req, res) => {
    if (guard(res)) return;
    const caller = await resolveCaller(req, res);
    if (!caller) return;
    const phone = toE164(req.body?.phone);
    const hash = phoneHmac(phone);
    if (!hash) return res.status(400).json({ error: "A valid phone number is required" });
    const rep = scopedRep(caller, req.body?.rep);
    try {
      if (!caller.manager) {
        const owns = await pool.query(
          `SELECT 1 FROM phone_assignments WHERE phone_hmac = $1 AND rep_email = $2`,
          [hash, rep],
        );
        if (!owns.rowCount) {
          return res.status(403).json({ error: "That conversation isn't assigned to you" });
        }
      }

      const PAGE_SIZE = 250;
      const MAX_PAGES = 10; // 2,500 messages with one patient — far beyond real use.
      const want = last10(phone);
      // ⚠️ Ten years, not one. An opt-out never expires, so a bounded window
      // silently hides a still-effective STOP older than the bound while
      // pagination happily reports "complete" — the guard would then enable the
      // composer for someone who asked us to stop years ago. This exceeds
      // RingCentral's own message retention, so it is effectively unbounded.
      // (`dateFrom` can't simply be omitted: the message store defaults it to
      // roughly the last 24 hours.)
      const dateFrom = new Date(Date.now() - 3650 * 24 * 60 * 60_000).toISOString();
      const messages = [];
      let complete = false;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const up = await rcApiFetch(
          `/restapi/v1.0/account/~/extension/~/message-store` +
            `?messageType=SMS&phoneNumber=${encodeURIComponent(phone)}` +
            `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=${PAGE_SIZE}&page=${page}`,
        );
        if (!up.ok) throw new Error(`RingCentral SMS history failed (${up.status})`);
        const json = await up.json();
        const records = json.records ?? [];
        for (const r of records) {
          const matches =
            last10(r.from?.phoneNumber || "") === want ||
            (r.to ?? []).some((t) => last10(t.phoneNumber || "") === want);
          if (!matches) continue;
          messages.push({
            id: r.id,
            direction: r.direction === "Outbound" ? "Outbound" : "Inbound",
            text: r.subject ?? r.text ?? "",
            time: r.creationTime ?? "",
            from: r.from?.phoneNumber ?? "",
            to: (r.to ?? [])[0]?.phoneNumber ?? "",
          });
        }
        if (records.length < PAGE_SIZE) {
          complete = true;
          break;
        }
      }
      messages.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      res.json({ messages, complete });
    } catch (e) {
      res.status(502).json({ error: String((e && e.message) || e) });
    }
  });

  /** How many of this rep's conversations have a patient message they haven't
   *  read — the number the Assigned Patients role bar shows.
   *
   *  Same per-rep unread rule as the inbox: the patient has written since the
   *  rep last opened the thread. An outbound reply never counts, or a rep would
   *  re-flag their own message. Rides the cached thread scan, so this is cheap
   *  after the first caller. */
  app.get("/assignments/unread-count", async (req, res) => {
    if (guard(res)) return;
    const caller = await resolveCaller(req, res);
    if (!caller) return;
    if (!caller.manager && !caller.who) return res.json({ unread: 0 });
    const rep = scopedRep(caller, req.query?.rep);
    try {
      const [threads, rows] = await Promise.all([
        loadThreads({}),
        pool.query(
          `SELECT a.phone_hmac, r.last_read_at
             FROM phone_assignments a
             LEFT JOIN thread_reads r
               ON r.phone_hmac = a.phone_hmac AND r.rep_email = $1
            WHERE a.rep_email = $1`,
          [rep],
        ),
      ]);
      const byHash = new Map(rows.rows.map((r) => [r.phone_hmac, r.last_read_at]));
      let unread = 0;
      for (const t of threads) {
        const hash = phoneHmac(t.phone);
        if (!byHash.has(hash)) continue;
        if (!t.lastInboundTime) continue;
        const lastRead = byHash.get(hash);
        if (!lastRead || new Date(t.lastInboundTime) > new Date(lastRead)) unread += 1;
      }
      res.json({ unread });
    } catch (e) {
      res.status(502).json({ error: String((e && e.message) || e) });
    }
  });

  /**
   * SIP credentials for the in-browser softphone.
   *
   * The browser has no RingCentral token — the JWT lives here — so it can't call
   * client-info/sip-provision itself. The gateway does it and hands back the
   * `sipInfo` block that ringcentral-web-phone registers with. That is what
   * makes a call happen IN THE PAGE (dial, talk, hang up) instead of
   * RingCentral ringing the rep's own phone first, which is what RingOut does
   * and what everyone found baffling.
   *
   * ⚠️ Requires the `VoipCalling` scope on the RingCentral app AND a Digital
   * Line on the extension this JWT authenticates as. Without either, RingCentral
   * refuses to provision and the SPA falls back to showing why.
   *
   * ⚠️ Every rep registers as the SAME extension, which is fine because this is
   * OUTBOUND ONLY: the documented consequence of sharing an instanceId is that
   * older instances stop receiving INBOUND calls, and we don't take inbound
   * here. Callers therefore pass no instanceId, deliberately — distinct ones
   * would each claim a slot against the SIP server's 5-per-extension cap.
   */
  app.get("/assignments/sip-provision", async (req, res) => {
    const caller = await resolveCaller(req, res);
    if (!caller) return;
    if (!caller.who && authEnforced()) return res.status(401).json({ error: "Sign in required" });
    try {
      const up = await rcApiFetch(SIP_PROVISION_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sipInfo: [{ transport: "WSS" }] }),
      });
      const body = await up.text();
      if (!up.ok) {
        // Surface RingCentral's own reason — "feature not available" here almost
        // always means the missing scope or Digital Line above.
        return res.status(up.status).type("application/json").send(body);
      }
      res.type("application/json").send(body);
    } catch (e) {
      res.status(502).json({ error: String((e && e.message) || e) });
    }
  });

  /** Is in-browser calling actually usable? Attempts a real provision and
   *  reports the outcome WITHOUT returning any credentials — so "the scopes are
   *  on" can be verified without signing in or reading SIP secrets. */
  app.get("/assignments/call-health", async (_req, res) => {
    try {
      const up = await rcApiFetch(SIP_PROVISION_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sipInfo: [{ transport: "WSS" }] }),
      });
      const text = await up.text();
      if (!up.ok) {
        let reason = text.slice(0, 300);
        try {
          const j = JSON.parse(text);
          reason = j.message || j.error_description || j.errors?.[0]?.message || reason;
        } catch {
          /* keep the raw snippet */
        }
        return res.json({ ok: false, status: up.status, reason });
      }
      let hasSip = false;
      try {
        const j = JSON.parse(text);
        const info = Array.isArray(j.sipInfo) ? j.sipInfo[0] : j.sipInfo;
        hasSip = !!(info && info.username && info.domain);
      } catch {
        /* hasSip stays false */
      }
      res.json({ ok: hasSip, status: up.status, sipInfo: hasSip ? "present" : "missing" });
    } catch (e) {
      res.json({ ok: false, reason: String((e && e.message) || e) });
    }
  });

  app.get("/assignments/health", async (_req, res) => {
    if (!configured()) {
      return res.json({ ok: false, db: pool ? "configured" : "disabled", pepper: hashingConfigured() });
    }
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, db: "ok", pepper: true });
    } catch {
      res.json({ ok: false, db: "error", pepper: true });
    }
  });
}
