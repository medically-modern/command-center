/**
 * messaging.mjs — patient texting + calling for the Command Center, with
 * per-message sender attribution.
 *
 * Replaces the old assignment model (Aug 2026). Nobody "owns" a patient any
 * more: ANY employee can look up ANY patient and text them. What the company
 * needs instead is a record of **who sent what, to whom, and when**, which is
 * what the `sent_messages` table below is for and what the manager view reads.
 *
 * ── Why sends go through here ───────────────────────────────────────────────
 * The browser could send straight to RingCentral through the /rc proxy, but
 * then the sender would be self-reported and trivially spoofable. Sends go
 * through POST /messaging/send instead so the sender is taken from the VERIFIED
 * Google token, server-side, and written next to RingCentral's own message id —
 * which is what lets the conversation view say who sent each line.
 *
 * ── Why the numbers are hashed ──────────────────────────────────────────────
 * A phone number tied to a patient IS PHI (one of HIPAA's 18 identifiers), so
 * the log stores HMAC-SHA256(pepper, E.164) rather than the number. It is an
 * attribution index, not a patient record: everything human-readable comes from
 * RingCentral and Monday at render time.
 *
 * ⚠️ The pepper is load-bearing. A bare SHA-256 of a 10-digit number is
 * brute-forceable in seconds, so this MUST be an HMAC with a server-side
 * secret; the routes 503 rather than fall back to an unpeppered digest.
 *
 * Required env:  ASSIGNMENTS_DATABASE_URL, PHONE_HMAC_PEPPER
 * (env names kept as-is so the deployed Railway config keeps working)
 */
import pkg from "pg";
const { Pool } = pkg;

import { verifyGoogleIdentity, authEnforced } from "./auth.mjs";
import { rcApiFetch, SIP_PROVISION_PATH } from "./ringcentral.mjs";
import { toE164, phoneHmac, hashingConfigured } from "./phoneHash.mjs";

export { toE164, phoneHmac };

const { ASSIGNMENTS_DATABASE_URL } = process.env;

function sslFor(url) {
  // Railway's INTERNAL connection string needs no SSL; external ones do.
  return /sslmode=disable/.test(url || "") ? false : { rejectUnauthorized: false };
}

const pool = ASSIGNMENTS_DATABASE_URL
  ? new Pool({ connectionString: ASSIGNMENTS_DATABASE_URL, max: 5, ssl: sslFor(ASSIGNMENTS_DATABASE_URL) })
  : null;

const configured = () => !!(pool && hashingConfigured());

if (!pool) console.warn("WARN: ASSIGNMENTS_DATABASE_URL not set — patient texting is DISABLED");
else if (!hashingConfigured()) console.warn("WARN: PHONE_HMAC_PEPPER not set — patient texting is DISABLED");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sent_messages (
  id             BIGSERIAL PRIMARY KEY,
  phone_hmac     TEXT NOT NULL,        -- recipient, hashed (never the number)
  sender_email   TEXT NOT NULL,        -- verified Google identity of the sender
  rc_message_id  TEXT,                 -- RingCentral's id, to line up with the thread
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  monday_item_id TEXT                  -- when the recipient matched a patient
);
CREATE INDEX IF NOT EXISTS sent_messages_phone_idx  ON sent_messages (phone_hmac);
CREATE INDEX IF NOT EXISTS sent_messages_rcid_idx   ON sent_messages (rc_message_id);
CREATE INDEX IF NOT EXISTS sent_messages_sender_idx ON sent_messages (sender_email, sent_at DESC);
`;

async function ensureSchema() {
  if (!pool) return;
  try {
    await pool.query(SCHEMA);
    console.log("Messaging schema ready");
  } catch (e) {
    console.error("Messaging schema failed:", e.message);
  }
}
void ensureSchema();

const RC_SMS_FROM = process.env.RC_SMS_FROM || "+13475037148";
const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

export function registerMessaging({ app }) {
  async function actor(req) {
    const u = await verifyGoogleIdentity(req.headers["x-mm-auth"]);
    return u ? (u.email || "").toLowerCase() : null;
  }

  /** Verified caller, or null after responding 401. Uses verifyGoogleIdentity
   *  (signature + domain, `exp` ignored) because sign-in here is a durable gate
   *  and the SPA never refreshes its Google token. */
  async function requireCaller(req, res) {
    const who = await actor(req);
    if (authEnforced() && !who) {
      res.status(401).json({ error: "Sign in required" });
      return null;
    }
    return who;
  }

  function guard(res) {
    if (configured()) return false;
    res.status(503).json({
      error: "Patient texting is not configured on the gateway (needs ASSIGNMENTS_DATABASE_URL and PHONE_HMAC_PEPPER).",
    });
    return true;
  }

  /**
   * Send a text to a patient and record who sent it.
   *
   * ⚠️ The sender is the VERIFIED token, never anything the body claims — the
   * whole point of routing sends through here rather than the /rc proxy.
   *
   * The attribution row is written even when RingCentral returns no id (see the
   * 5xx quirk below): a message we can't line up beats losing the record that it
   * was sent at all.
   */
  app.post("/messaging/send", async (req, res) => {
    if (guard(res)) return;
    const who = await requireCaller(req, res);
    if (who === null && authEnforced()) return;
    const to = toE164(req.body?.to);
    const text = String(req.body?.text || "").trim();
    const mondayItemId = req.body?.mondayItemId ? String(req.body.mondayItemId) : null;
    if (!to) return res.status(400).json({ error: "A valid recipient number is required" });
    if (!text) return res.status(400).json({ error: "Message is empty" });

    let rcId = null;
    let ok = false;
    try {
      const up = await rcApiFetch(`/restapi/v1.0/account/~/extension/~/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: { phoneNumber: RC_SMS_FROM }, to: [{ phoneNumber: to }], text }),
      });
      const body = await up.text();
      if (up.ok) {
        ok = true;
        try {
          rcId = String(JSON.parse(body).id ?? "") || null;
        } catch {
          /* id is a nicety, not a requirement */
        }
      } else if (up.status >= 500) {
        // ⚠️ This account's POST /sms returns a bare 500 while still ACCEPTING
        // the message (CLAUDE.md §5.5). Confirm against the message store
        // before reporting failure, or reps re-send and double-text patients.
        ok = await confirmSent(to, text);
      }
      if (!ok) {
        let msg = `RingCentral SMS failed (${up.status})`;
        try {
          const e = JSON.parse(body);
          msg = e.errors?.[0]?.message || e.message || msg;
        } catch {
          /* keep default */
        }
        return res.status(502).json({ error: msg });
      }
    } catch (e) {
      return res.status(502).json({ error: String((e && e.message) || e) });
    }

    try {
      await pool.query(
        `INSERT INTO sent_messages (phone_hmac, sender_email, rc_message_id, monday_item_id)
         VALUES ($1,$2,$3,$4)`,
        [phoneHmac(to), who || "unknown", rcId, mondayItemId],
      );
    } catch (e) {
      // The text HAS gone out. Losing the attribution row must not report a
      // failure that makes a rep send it twice.
      console.error("sent_messages insert failed:", e.message);
    }
    res.json({ ok: true, id: rcId });
  });

  /** Did a just-sent message actually land, despite a 5xx? */
  async function confirmSent(to, text) {
    const dateFrom = new Date(Date.now() - 60_000).toISOString();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
      try {
        const up = await rcApiFetch(
          `/restapi/v1.0/account/~/extension/~/message-store` +
            `?messageType=SMS&direction=Outbound&phoneNumber=${encodeURIComponent(to)}` +
            `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=20`,
        );
        if (!up.ok) continue;
        const j = await up.json();
        const hit = (j.records ?? []).some(
          (r) => (r.subject ?? "") === text && (r.to ?? []).some((t) => last10(t.phoneNumber) === last10(to)),
        );
        if (hit) return true;
      } catch {
        /* transient — retry, then give up */
      }
    }
    return false;
  }

  /**
   * A patient's full conversation, with **who sent** each outbound message.
   *
   * Pages to the end of the history and reports whether it got there: the
   * client's opt-out guard treats an incomplete history as consent UNKNOWN
   * rather than consent given, so it must not be told "complete" on a guess.
   */
  app.post("/messaging/conversation", async (req, res) => {
    if (guard(res)) return;
    const who = await requireCaller(req, res);
    if (who === null && authEnforced()) return;
    const phone = toE164(req.body?.phone);
    if (!phone) return res.status(400).json({ error: "A valid phone number is required" });

    const PAGE_SIZE = 250;
    const MAX_PAGES = 10;
    // ⚠️ Ten years, not one. An opt-out never expires, so a bounded window would
    // hide a still-effective STOP while pagination reported "complete".
    const dateFrom = new Date(Date.now() - 3650 * 24 * 60 * 60_000).toISOString();
    const want = last10(phone);
    const messages = [];
    let complete = false;
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const up = await rcApiFetch(
          `/restapi/v1.0/account/~/extension/~/message-store` +
            `?messageType=SMS&phoneNumber=${encodeURIComponent(phone)}` +
            `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=${PAGE_SIZE}&page=${page}`,
        );
        if (!up.ok) throw new Error(`RingCentral SMS history failed (${up.status})`);
        const j = await up.json();
        const records = j.records ?? [];
        for (const r of records) {
          const mine =
            last10(r.from?.phoneNumber) === want || (r.to ?? []).some((t) => last10(t.phoneNumber) === want);
          if (!mine) continue;
          messages.push({
            id: r.id,
            direction: r.direction === "Outbound" ? "Outbound" : "Inbound",
            text: r.subject ?? r.text ?? "",
            time: r.creationTime ?? "",
          });
        }
        if (records.length < PAGE_SIZE) {
          complete = true;
          break;
        }
      }

      // Attribution. Matched on RingCentral's message id where we have it;
      // otherwise the nearest send to the same number within two minutes, so
      // rows logged before ids were captured (or when RC 5xx'd) still resolve.
      const rows = await pool.query(
        `SELECT rc_message_id, sender_email, sent_at FROM sent_messages
          WHERE phone_hmac = $1 ORDER BY sent_at`,
        [phoneHmac(phone)],
      );
      const byId = new Map();
      const loose = [];
      for (const r of rows.rows) {
        if (r.rc_message_id) byId.set(String(r.rc_message_id), r.sender_email);
        else loose.push(r);
      }
      for (const m of messages) {
        if (m.direction !== "Outbound") continue;
        const exact = byId.get(String(m.id));
        if (exact) {
          m.sentBy = exact;
          continue;
        }
        const t = new Date(m.time).getTime();
        const near = loose.find((r) => Math.abs(new Date(r.sent_at).getTime() - t) < 120_000);
        if (near) m.sentBy = near.sender_email;
      }

      messages.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      res.json({ messages, complete });
    } catch (e) {
      res.status(502).json({ error: String((e && e.message) || e) });
    }
  });

  /** SIP credentials for the in-browser softphone. See useWebPhone.ts. */
  app.get("/messaging/sip-provision", async (req, res) => {
    const who = await requireCaller(req, res);
    if (who === null && authEnforced()) return;
    try {
      const up = await rcApiFetch(SIP_PROVISION_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sipInfo: [{ transport: "WSS" }] }),
      });
      const body = await up.text();
      res.status(up.ok ? 200 : up.status).type("application/json").send(body);
    } catch (e) {
      res.status(502).json({ error: String((e && e.message) || e) });
    }
  });

  /** Is in-browser calling usable? Attempts a real provision and reports the
   *  outcome WITHOUT returning credentials, so the scopes and Digital Line can
   *  be verified from outside the browser. */
  app.get("/messaging/call-health", async (_req, res) => {
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

  app.get("/messaging/health", async (_req, res) => {
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
