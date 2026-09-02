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

import { verifyGoogleIdentity, authEnforced, setKeyStore } from "./auth.mjs";
import { rcApiFetch, SIP_PROVISION_PATH } from "./ringcentral.mjs";
import { toE164, phoneHmac, hashingConfigured } from "./phoneHash.mjs";
import { confirmSmsAccepted } from "./smsSend.mjs";
import { registerSmsArchive, readArchivedConversation } from "./smsArchive.mjs";
import { registerPatientDirectory } from "./patientDirectory.mjs";
import { mergeConversation } from "./smsArchiveRules.mjs";

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

-- Google signing keys we have seen. Google rotates every day or two and drops
-- retired keys from its published JWKS, so a token signed by an aged-out key
-- becomes unverifiable — and this gateway redeploys on every push to main, so
-- an in-memory-only cache would log everyone out for unrelated reasons.
CREATE TABLE IF NOT EXISTS google_signing_keys (
  kid        TEXT PRIMARY KEY,
  jwk        JSONB NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
void ensureSchema().then(() => {
  // Durable key retention, so a redeploy doesn't invalidate everyone's sign-in.
  if (!pool) return;
  setKeyStore({
    load: async () => (await pool.query(`SELECT kid, jwk FROM google_signing_keys`)).rows,
    save: async (kid, jwk) =>
      pool.query(
        `INSERT INTO google_signing_keys (kid, jwk) VALUES ($1,$2) ON CONFLICT (kid) DO NOTHING`,
        [kid, jwk],
      ),
  });
});

const RC_SMS_FROM = process.env.RC_SMS_FROM || "+13475037148";
/** Serve saved history alongside what RingCentral still holds. OFF unless
 *  explicitly enabled — see the note in POST /messaging/conversation. */
const SERVE_ARCHIVE = process.env.SMS_ARCHIVE_SERVE === "1";
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

  // The durable copy of every patient text, plus GET /messaging/archive-health.
  // Registered here rather than in index.mjs so it lands on THIS pool: the audit
  // Postgres keeps its "metadata only, no PHI" property, while the archive (which
  // holds message bodies) sits beside sent_messages, where PHI already lives.
  // Purely additive — its own tables, its own routes, and it reads RingCentral on
  // the `background` tier, which is shed before anything a rep is waiting on.
  registerSmsArchive({ app, pool, requireCaller });

  // "Whose number is this?", answered from Postgres instead of seven Monday
  // boards. Registered HERE for the same reason as the archive: it holds
  // patient names, so it must land on THIS pool and leave the audit Postgres
  // its "metadata only, no PHI" property. Additive — its own tables, its own
  // routes, and every caller falls back to the live Monday lookup on a miss.
  registerPatientDirectory({ app, pool, requireCaller });

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
    // Set when RingCentral has already given up on the message: the send is a
    // failure the rep must be told about, but it DID reach RingCentral, so the
    // attribution row below is still written before we report it.
    let deliveryFailure = null;
    try {
      // CRITICAL: a rep typed this and pressed Send. Shedding it loses a
      // message a human is waiting on; it can't be a flood source.
      const up = await rcApiFetch(`/restapi/v1.0/account/~/extension/~/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: { phoneNumber: RC_SMS_FROM }, to: [{ phoneNumber: to }], text }),
      }, { tier: "critical", caller: who || "anon" });
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
        // Critical too: this is the read that decides whether a 5xx really
        // failed. Shedding it reports a DELIVERED text as failed, and the rep
        // sends it twice.
        const found = await confirmSmsAccepted({
          rcFetch: (path) => rcApiFetch(path, {}, { tier: "critical", caller: who || "anon" }),
          to, text,
        });
        ok = found.accepted;
        // Found it, but RingCentral had ALREADY given up on it — the number is
        // undeliverable. Report that instead of the bare 500, which reads as a
        // transient glitch and invites exactly the re-send that can't work.
        // ⚠️ Fall THROUGH rather than returning here: the message exists in
        // RingCentral, so it will render in the thread, and skipping the insert
        // below would leave that bubble reading "sent outside Command Center".
        if (found.failed) deliveryFailure = found.deliveryError || "";
      }
      if (deliveryFailure === null && !ok) {
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
    if (deliveryFailure !== null) {
      return res.status(502).json({ error: "Not delivered", deliveryError: deliveryFailure });
    }
    res.json({ ok: true, id: rcId });
  });

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
        // SMS AND MMS: a patient who answers with a photo sends an MMS, and an
        // SMS-only filter dropped that message entirely — no bubble, no photo,
        // nothing (Josh, 2026-08-18).
        //
        // ⚠️ NO messageType param at all. The documented multi-value syntax
        // (`messageType=SMS&messageType=MMS`) comes back 400 on this account —
        // which didn't just hide MMS, it broke the WHOLE thread load, and with
        // it texting (an unreadable history reads as unknown consent, which
        // blocks the composer). Same account-quirk genre as the SMS-500 and
        // the call-log's digits-only filter. So the query filters by phone
        // number only and the type check lives below, where it can't 400.
        const up = await rcApiFetch(
          `/restapi/v1.0/account/~/extension/~/message-store` +
            `?phoneNumber=${encodeURIComponent(phone)}` +
            `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=${PAGE_SIZE}&page=${page}`,
          {},
          // A human opened a thread, so it outranks polling — but it is still
          // budgeted, and this is the exact route that caused the 2026-08-20
          // incident: it pages up to MAX_PAGES deep, so one request here is up
          // to ten RingCentral calls.
          { tier: "interactive", caller: who || "anon" },
        );
        if (!up.ok) throw new Error(`RingCentral SMS history failed (${up.status})`);
        const j = await up.json();
        const records = j.records ?? [];
        for (const r of records) {
          // The store also holds Fax / VoiceMail rows for this number — a fax
          // rendered as a text bubble would be worse than the old gap.
          if (r.type !== "SMS" && r.type !== "MMS") continue;
          const mine =
            last10(r.from?.phoneNumber) === want || (r.to ?? []).some((t) => last10(t.phoneNumber) === want);
          if (!mine) continue;
          // The media parts of an MMS. Text parts are skipped — the body
          // already rides in `subject` — and the uri is the allowlisted
          // /message-store/{id}/content/{attachmentId} shape, which the
          // browser fetches through /rc/fetch like a fax page.
          const attachments = (r.attachments ?? [])
            .filter((a) => a && a.uri && a.type !== "Text" && !/^text\//i.test(a.contentType || ""))
            .map((a) => ({ id: a.id, contentType: a.contentType || "", uri: a.uri }));
          messages.push({
            id: r.id,
            direction: r.direction === "Outbound" ? "Outbound" : "Inbound",
            text: r.subject ?? r.text ?? "",
            time: r.creationTime ?? "",
            // ⚠️ Delivery outcome. A successful POST /sms only means ACCEPTED —
            // an undeliverable number flips to `SendingFailed` in the store a
            // few seconds later, which is why RingCentral's own app showed a
            // failure and the Command Center showed an ordinary sent bubble
            // (Brandon, 2026-08-20). The thread is the ONLY place that late
            // verdict ever surfaces, so it has to ride along with the message.
            // Passed through verbatim: every reading of these lives in
            // src/lib/shared/smsDelivery.ts, so there is no mirrored table of
            // carrier codes here to drift out of step with it.
            messageStatus: r.messageStatus ?? "",
            ...(r.deliveryErrorCode ? { deliveryError: String(r.deliveryErrorCode) } : {}),
            ...(attachments.length ? { attachments } : {}),
          });
        }
        if (records.length < PAGE_SIZE) {
          complete = true;
          break;
        }
      }

      // ── Saved history (smsArchive.mjs) ───────────────────────────────────
      // ⚠️ OFF BY DEFAULT, deliberately. The archive earns its keep on the
      // WRITE side — copying texts out before RingCentral's ~30-day window
      // purges them — and that needs nothing from this route. Serving the union
      // changes what a rep sees in a live thread, so it is opt-in via
      // SMS_ARCHIVE_SERVE=1 and can be switched back off without a deploy. With
      // the flag unset, everything below runs exactly as it did before the
      // archive existed.
      //
      // Even when on it can only ever ADD: the read is wrapped so a failing
      // archive is logged and skipped rather than surfaced, and the merge
      // prefers the LIVE copy of anything present on both sides — a stale
      // archived `Queued` must never mask a live `SendingFailed`.
      if (SERVE_ARCHIVE) {
        try {
          const archived = await readArchivedConversation({ pool, phone });
          if (archived.length) {
            // splice, not reassign: `messages` is const, and everything below
            // (attribution, the sort, the response) already reads it.
            messages.splice(0, messages.length, ...mergeConversation(messages, archived));
          }
        } catch (e) {
          console.error("sms_archive read skipped:", (e && e.message) || e);
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
