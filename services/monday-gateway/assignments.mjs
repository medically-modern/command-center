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

import { verifyGoogleToken, authEnforced } from "./auth.mjs";
import { rcApiFetch } from "./ringcentral.mjs";
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
  /** Verified caller's email, or null. */
  async function actor(req) {
    const u = await verifyGoogleToken(req.headers["x-mm-auth"]);
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

  /** Group the shared account's SMS into per-counterparty threads. */
  async function loadThreads({ sinceDays = 90, perPage = 250 }) {
    const dateFrom = new Date(Date.now() - sinceDays * 24 * 60 * 60_000).toISOString();
    const res = await rcApiFetch(
      `/restapi/v1.0/account/~/extension/~/message-store` +
        `?messageType=SMS&dateFrom=${encodeURIComponent(dateFrom)}&perPage=${perPage}`,
    );
    if (!res.ok) throw new Error(`RingCentral SMS threads failed (${res.status})`);
    const json = await res.json();
    const threads = new Map();
    for (const r of json.records ?? []) {
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
    return [...threads.values()].sort((a, b) => String(b.lastTime).localeCompare(String(a.lastTime)));
  }

  /** The caller's inbox: their assigned conversations, plus — for a manager —
   *  the unassigned ones that still need routing to somebody. */
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
      const unassigned = [];
      for (const t of threads) {
        const row = byHash.get(phoneHmac(t.phone));
        if (row && row.rep_email === rep) {
          mine.push({
            ...t,
            assignment: {
              repEmail: row.rep_email,
              mondayItemId: row.monday_item_id,
              mondayBoardId: row.monday_board_id,
              lastReadAt: row.last_read_at ? new Date(row.last_read_at).toISOString() : null,
            },
          });
        } else if (!row && caller.manager) {
          // Only a manager is shown conversations that belong to nobody — for
          // anyone else these are just other people's patients.
          unassigned.push(t);
        }
      }
      res.json({ threads: mine, unassigned });
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
