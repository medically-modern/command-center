/**
 * inboundCalls.mjs — inbound calls on the shared line, live in the Command
 * Center, claimable by whoever is free.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * The browser softphone (useWebPhone.ts) is OUTBOUND ONLY, and deliberately so:
 * every rep registers as the same RingCentral extension, and a SIP server caps
 * an extension at 5 registrations while a shared instanceId knocks older tabs
 * off inbound entirely. So the browser can never be the thing that learns about
 * an incoming call.
 *
 * It doesn't have to be. The two halves of "a call arrives" are separable:
 *
 *   SIGNAL  who is calling, right now  → ONE server-side webhook subscription,
 *           fanned out over SSE. No SIP, no registration, no cap: ten browsers
 *           cost exactly what one does.
 *   AUDIO   actually talking          → stays on RingCentral, on the claimer's
 *           OWN phone, reached by forwarding the still-ringing call to them.
 *
 * Nobody's browser ever receives the inbound SIP leg, so the registration cap
 * this feature would otherwise die on simply never applies.
 *
 * ── The model (Josh, 2026-08-05) ────────────────────────────────────────────
 * The Command Center is ONE instance. All calls route through the shared line
 * and IT DOES NOT MATTER WHO PICKS UP. There is no routing and no ownership
 * here — each employee only chooses which calls reach THEIR screen (all / a
 * list of their own / off). Narrowing your list quiets your screen; it can
 * never make a call unanswerable by someone else.
 *
 * ── Why claiming beats notifying ────────────────────────────────────────────
 * RingCentral's Forward API works on a party in Setup/Proceeding — i.e. while
 * the phone is still ringing. So "Take it" doesn't ask someone to go find the
 * RingCentral app and race the shared line: it forwards the live call to that
 * person's own number, and their phone rings. The claim is the routing.
 *
 * ⚠️ Needs the `CallControl` permission on the RingCentral app (added
 * 2026-08-05). Without it the subscription cannot be created and /calls/claim
 * 502s — /calls/health reports which half is missing.
 *
 * Required env:  RC_* (see ringcentral.mjs), ASSIGNMENTS_DATABASE_URL,
 *                PHONE_HMAC_PEPPER
 * Optional env:  CALLS_WEBHOOK_URL   (default https://$RAILWAY_PUBLIC_DOMAIN)
 *                CALLS_WEBHOOK_TOKEN (default derived from the pepper)
 */
import crypto from "node:crypto";
import pkg from "pg";
const { Pool } = pkg;

import { verifyGoogleIdentity } from "./auth.mjs";
import { rcApiFetch } from "./ringcentral.mjs";
import { toE164, phoneHmac, hashingConfigured } from "./phoneHash.mjs";
import {
  isRinging,
  last4,
  normalizePrefs,
  pickInboundParty,
  sessionOutcome,
  shouldNotify,
  unwrapEvent,
} from "./callRules.mjs";

const { ASSIGNMENTS_DATABASE_URL } = process.env;

const EVENT_FILTER = "/restapi/v1.0/account/~/telephony/sessions";
/** RingCentral's maximum is 7 days; we renew well before that (see below). */
const SUBSCRIPTION_TTL_S = 604800;
const RENEW_WHEN_LEFT_MS = 2 * 24 * 60 * 60_000;
const RECONCILE_EVERY_MS = 60 * 60_000;
/** How long a finished call stays in memory, so a card can resolve to
 *  "missed"/"answered" instead of vanishing mid-glance. */
const KEEP_ENDED_MS = 60_000;
/** Backstop against an event storm holding memory forever. */
const MAX_TRACKED_CALLS = 200;
const SSE_HEARTBEAT_MS = 25_000;

function sslFor(url) {
  return /sslmode=disable/.test(url || "") ? false : { rejectUnauthorized: false };
}

const pool = ASSIGNMENTS_DATABASE_URL
  ? new Pool({ connectionString: ASSIGNMENTS_DATABASE_URL, max: 5, ssl: sslFor(ASSIGNMENTS_DATABASE_URL) })
  : null;

const configured = () => !!(pool && hashingConfigured());

const SCHEMA = `
-- Per-employee notification preferences. NOT routing: see the header note.
CREATE TABLE IF NOT EXISTS call_ring_prefs (
  email          TEXT PRIMARY KEY,
  mode           TEXT NOT NULL DEFAULT 'all',   -- all | list | off
  forward_number TEXT,                          -- where "Take it" rings them
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One employee's explicit allow list. EXPLICIT is the whole point: nothing a
-- rep does in the course of their work — texting, calling, opening a thread —
-- adds a number here. Only putting it here does.
-- ⚠️ Stores the HMAC, never the number. A phone number tied to a patient is
-- PHI (messaging.mjs makes the same call for the same reason); last4 is a
-- display hint so a rep can recognise their own entry, and is useless as an
-- identifier on its own.
CREATE TABLE IF NOT EXISTS call_ring_allow (
  email      TEXT NOT NULL,
  phone_hmac TEXT NOT NULL,
  last4      TEXT,
  label      TEXT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, phone_hmac)
);
CREATE INDEX IF NOT EXISTS call_ring_allow_phone_idx ON call_ring_allow (phone_hmac);

-- Who took which call. The forward hands a patient call to a personal number,
-- so it gets the same audit treatment as a send.
CREATE TABLE IF NOT EXISTS call_claims (
  id            BIGSERIAL PRIMARY KEY,
  phone_hmac    TEXT NOT NULL,
  claimed_by    TEXT NOT NULL,
  session_id    TEXT,
  ok            BOOLEAN NOT NULL,
  detail        TEXT,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function ensureSchema() {
  if (!pool) return;
  try {
    await pool.query(SCHEMA);
    console.log("Inbound-call schema ready");
  } catch (e) {
    console.error("Inbound-call schema failed:", e.message);
  }
}

/* ── webhook identity ─────────────────────────────────────────────────────── */

const webhookUrl = () => {
  const explicit = process.env.CALLS_WEBHOOK_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = process.env.RAILWAY_PUBLIC_DOMAIN;
  return host ? `https://${host}/calls/webhook` : "";
};

/**
 * Shared secret RingCentral echoes on every delivery. Derived from the pepper
 * when unset so this needs no new Railway variable, but never guessable.
 *
 * ⚠️ TRUNCATED TO 32 CHARS ON PURPOSE. The full SHA-256 hex digest is 64, and
 * RingCentral rejected it with `Parameter [deliveryMode.verificationToken]
 * value is invalid` — an undocumented length limit: their OpenAPI spec declares
 * the field as a bare `string` with no maxLength or pattern, and the webhook
 * endpoint provably answers the Validation-Token handshake, which is the other
 * thing that error is known to mean. 128 bits is ample for a value that is only
 * ever compared for equality, so there is nothing to win by sending all 64.
 */
const WEBHOOK_TOKEN_CHARS = 32;
const webhookToken = () =>
  process.env.CALLS_WEBHOOK_TOKEN ||
  (hashingConfigured()
    ? crypto
        .createHmac("sha256", process.env.PHONE_HMAC_PEPPER)
        .update("rc-calls-webhook")
        .digest("hex")
        .slice(0, WEBHOOK_TOKEN_CHARS)
    : "");

/* ── live call registry ───────────────────────────────────────────────────── */

/**
 * telephonySessionId → call. In-memory on purpose: a ringing call is worth
 * ~25 seconds, and the gateway runs a single replica (checked 2026-08-05).
 *
 * ⚠️ If this service is ever scaled past one replica, a webhook landing on
 * replica A will not reach a browser connected to replica B. The fix is
 * Postgres LISTEN/NOTIFY — `pg` is already here — not a bigger map.
 */
const calls = new Map();

/** email → { res, prefs } for every open SSE connection. */
const subscribers = new Map();
let subscriberSeq = 0;

function pruneCalls() {
  const now = Date.now();
  for (const [id, c] of calls) {
    if (c.endedAt && now - c.endedAt > KEEP_ENDED_MS) calls.delete(id);
  }
  while (calls.size > MAX_TRACKED_CALLS) {
    const oldest = calls.keys().next().value;
    calls.delete(oldest);
  }
}

function sendTo(entry, event, data) {
  try {
    entry.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* the connection is going away; the close handler cleans up */
  }
}

/** Public shape of a call. The caller's number IS included — it goes only to
 *  employees whose own rules matched, over TLS, and the browser needs it to
 *  resolve the patient and show the conversation. */
function publicCall(c) {
  return {
    id: c.id,
    from: c.from,
    to: c.to,
    callerName: c.callerName,
    startedAt: c.startedAt,
    state: c.state,
    claimedBy: c.claimedBy || null,
  };
}

/* ── notification fan-out ─────────────────────────────────────────────────── */

/**
 * Which of the currently-connected employees want this call.
 *
 * Matching is SERVER-side and per-connection. Broadcasting every caller's
 * number to every open tab and filtering in the browser would hand each rep
 * the numbers of patients their own rules excluded — the filter is a privacy
 * boundary, not just a UI convenience.
 */
async function audienceFor(hmac) {
  const pinnedBy = new Set();
  if (pool && hmac) {
    try {
      // ⚠️ ONLY the explicit allow list. sent_messages is deliberately NOT
      // consulted: texting a patient must never enrol them in anyone's ring
      // list (Josh, 2026-08-05 — see shouldNotify in callRules.mjs).
      const pins = await pool.query(`SELECT email FROM call_ring_allow WHERE phone_hmac = $1`, [hmac]);
      for (const r of pins.rows) pinnedBy.add(String(r.email || "").toLowerCase());
    } catch (e) {
      // Going blind here would silence the whole office. Fall through with an
      // empty set: `all` subscribers still get the call, `list` ones miss it.
      console.error("call audience lookup failed:", e.message);
    }
  }
  const out = [];
  for (const entry of subscribers.values()) {
    if (shouldNotify(entry.prefs, { pinned: pinnedBy.has(entry.email) })) out.push(entry);
  }
  return out;
}

/** Tell everyone already watching this call that it changed. */
function broadcastUpdate(call) {
  for (const email of call.audience) {
    for (const entry of subscribers.values()) {
      if (entry.email === email) sendTo(entry, "call-update", publicCall(call));
    }
  }
}

/**
 * Counters for /calls/health. Shape and counts only — never a number, never a
 * name. Their whole reason for existing is that the envelope bug below was
 * INVISIBLE: RingCentral delivered 33 events, every one was acked 200, every
 * one was dropped, and "parsed nothing" looked exactly like "was never sent".
 */
const eventStats = { seen: 0, rings: 0, unparsed: 0, lastAt: 0 };

async function handleEvent(payload) {
  eventStats.seen++;
  eventStats.lastAt = Date.now();

  // ⚠️ RingCentral wraps deliveries in an envelope; the payload is under
  // `body`. Reading the top level finds no telephonySessionId and silently
  // drops the event — see unwrapEvent in callRules.mjs.
  const body = unwrapEvent(payload);
  const sessionId = String(body?.telephonySessionId || "");
  if (!sessionId) {
    eventStats.unparsed++;
    // Keys only: the payload carries patient phone numbers (PHI), so the SHAPE
    // is logged and the content never is. Enough to spot a schema change.
    console.warn(
      `call event: no telephonySessionId (outer keys: ${Object.keys(payload || {}).join(",") || "none"})`,
    );
    return;
  }

  const existing = calls.get(sessionId);
  const outcome = sessionOutcome(body);

  if (existing) {
    // A call we are already showing. The interesting transition is the one away
    // from ringing — a card left up after the caller hung up is worse than none.
    if (outcome && existing.state === "ringing") {
      // ⚠️ A CLAIMED call reports terminal on this session no matter how it
      // went: forwarding tears down the inbound leg and rings the claimer on a
      // new one. Reading that literally would flash "Missed" at the very person
      // who just took the call, one second after they took it.
      existing.state = outcome === "answered" || existing.claimedBy ? "answered" : "missed";
      existing.endedAt = Date.now();
      broadcastUpdate(existing);
    }
    pruneCalls();
    return;
  }

  if (outcome) return; // finished before we ever saw it ring
  const party = pickInboundParty(body);
  if (!party) return;

  const from = toE164(party.from) || party.from;
  const call = {
    id: sessionId,
    partyId: party.partyId,
    from,
    to: party.to,
    callerName: party.callerName,
    hmac: phoneHmac(from),
    startedAt: Date.now(),
    endedAt: 0,
    state: "ringing",
    claimedBy: null,
    claiming: false,
    audience: [],
  };
  calls.set(sessionId, call);
  pruneCalls();

  eventStats.rings++;
  const audience = await audienceFor(call.hmac);
  call.audience = audience.map((a) => a.email);
  for (const entry of audience) sendTo(entry, "call-ring", publicCall(call));
}

/* ── subscription lifecycle ───────────────────────────────────────────────── */

let subscriptionState = { id: null, expiresAt: 0, error: null };

/**
 * Make sure exactly one live subscription points at this gateway.
 *
 * ⚠️ Reconcile, never blindly create. This service redeploys on every push to
 * main; a create-on-boot would leave a trail of subscriptions all pointing at
 * the same URL, and every inbound call would fan out two, three, five times.
 */
async function reconcileSubscription() {
  const url = webhookUrl();
  if (!url) {
    subscriptionState.error = "No webhook URL (set CALLS_WEBHOOK_URL or RAILWAY_PUBLIC_DOMAIN).";
    return;
  }
  const token = webhookToken();
  if (!token) {
    subscriptionState.error = "No webhook token (PHONE_HMAC_PEPPER unset).";
    return;
  }

  const payload = {
    eventFilters: [EVENT_FILTER],
    deliveryMode: { transportType: "WebHook", address: url, verificationToken: token },
    expiresIn: SUBSCRIPTION_TTL_S,
  };

  try {
    const listRes = await rcApiFetch("/restapi/v1.0/subscription");
    if (!listRes.ok) throw new Error(`list subscriptions failed (${listRes.status})`);
    const list = await listRes.json();
    const mine = (list.records || []).filter(
      (r) => r?.deliveryMode?.address === url && (r.eventFilters || []).some((f) => f.includes("/telephony/sessions")),
    );

    // ⚠️ ACTIVE ONES FIRST, then collapse the rest. RingCentral marks a
    // subscription `Blacklisted` after repeated webhook failures, and the list
    // comes back in no particular order — so keeping records[0] could delete
    // the healthy subscription and keep the dead one, then create another, and
    // oscillate there forever while /calls/health reported success.
    mine.sort((a, b) => (String(b.status) === "Active") - (String(a.status) === "Active"));

    for (const extra of mine.slice(1)) {
      await rcApiFetch(`/restapi/v1.0/subscription/${extra.id}`, { method: "DELETE" }).catch(() => {});
    }

    const current = mine[0];
    if (current && String(current.status) === "Active") {
      const left = new Date(current.expirationTime || 0).getTime() - Date.now();
      if (left > RENEW_WHEN_LEFT_MS) {
        subscriptionState = { id: current.id, expiresAt: Date.now() + left, error: null };
        return;
      }
      const put = await rcApiFetch(`/restapi/v1.0/subscription/${current.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (put.ok) {
        const j = await put.json();
        subscriptionState = {
          id: j.id,
          expiresAt: new Date(j.expirationTime || 0).getTime(),
          error: null,
        };
        console.log(`Inbound calls: subscription renewed (${j.id})`);
        return;
      }
      // A renew can fail on a subscription RingCentral has already reaped —
      // fall through and create a fresh one rather than going deaf.
    }

    const post = await rcApiFetch("/restapi/v1.0/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await post.text();
    if (!post.ok) {
      let reason = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        reason = j.message || j.errors?.[0]?.message || reason;
      } catch {
        /* keep the snippet */
      }
      throw new Error(reason);
    }
    const j = JSON.parse(text);
    subscriptionState = { id: j.id, expiresAt: new Date(j.expirationTime || 0).getTime(), error: null };
    console.log(`Inbound calls: subscribed (${j.id}) → ${url}`);
  } catch (e) {
    subscriptionState.error = String((e && e.message) || e);
    console.error("Inbound calls: subscription failed:", subscriptionState.error);
  }
}

/**
 * RingCentral's CURRENT opinion of our subscription, not our memory of creating
 * it.
 *
 * ⚠️ This is the difference between a health check and a comforting lie. The
 * cached `subscriptionState` only records that a create/renew once succeeded —
 * so when RingCentral **blacklists** the webhook (which is what it does after
 * repeated delivery failures) the gateway keeps reporting `ok: true` and calls
 * silently stop arriving. Only asking RC can tell you that.
 *
 * Cached for a minute because /calls/health takes no auth: without it, anyone
 * who found the URL could drive an unbounded number of RingCentral API calls.
 */
let _liveStatus = { at: 0, status: null, error: null };
async function liveSubscriptionStatus() {
  if (!subscriptionState.id) return { status: null, error: subscriptionState.error };
  if (Date.now() - _liveStatus.at < 60_000) return _liveStatus;
  try {
    const up = await rcApiFetch(`/restapi/v1.0/subscription/${subscriptionState.id}`);
    if (!up.ok) {
      _liveStatus = { at: Date.now(), status: null, error: `RingCentral says ${up.status}` };
      return _liveStatus;
    }
    const j = await up.json();
    _liveStatus = { at: Date.now(), status: String(j.status || ""), error: null };
  } catch (e) {
    _liveStatus = { at: Date.now(), status: null, error: String((e && e.message) || e) };
  }
  return _liveStatus;
}

/* ── prefs ────────────────────────────────────────────────────────────────── */

async function loadPrefs(email) {
  if (!pool) return normalizePrefs(null);
  try {
    const r = await pool.query(
      `SELECT mode, forward_number FROM call_ring_prefs WHERE email = $1`,
      [email],
    );
    if (!r.rows.length) return normalizePrefs(null);
    const row = r.rows[0];
    return normalizePrefs({ mode: row.mode, forwardNumber: row.forward_number || "" });
  } catch {
    return normalizePrefs(null);
  }
}

/* ── routes ───────────────────────────────────────────────────────────────── */

export function registerInboundCalls({ app }) {
  void ensureSchema().then(() => {
    if (!configured()) {
      console.warn("WARN: inbound calls disabled (needs ASSIGNMENTS_DATABASE_URL + PHONE_HMAC_PEPPER)");
      return;
    }
    void reconcileSubscription();
    setInterval(() => void reconcileSubscription(), RECONCILE_EVERY_MS).unref?.();
  });

  /**
   * A verified @medicallymodern.com identity, or null after responding 401.
   *
   * ⚠️ UNCONDITIONAL — deliberately unlike /gql and messaging.mjs, which fall
   * back to an "unknown" actor when GOOGLE_CLIENT_ID is unset. Those routes can
   * afford it; these cannot. Without a real identity an anonymous client gets
   * the default `all` preference, which means the live number of every patient
   * who calls, and it shares one "unknown" row with everyone else — so it could
   * save its OWN forwarding number and then claim a ringing patient call
   * straight to it. There is no legitimate anonymous user here: an anonymous
   * user has no phone to forward to. Enforcement being off is a deployment
   * state, not a licence to route a patient's call to a stranger.
   */
  async function requireCaller(req, res) {
    const u = await verifyGoogleIdentity(req.headers["x-mm-auth"]);
    const who = u ? (u.email || "").toLowerCase() : "";
    if (!who) {
      res.status(401).json({ error: "Sign in required" });
      return null;
    }
    return who;
  }

  /**
   * RingCentral's delivery endpoint.
   *
   * Two things happen here that are NOT ordinary API traffic:
   *  · On subscribe, RingCentral POSTs with a `Validation-Token` header that we
   *    must echo back, or the subscription is never created.
   *  · Every later delivery carries the `Verification-Token` we registered.
   *    Anything else is someone else POSTing at a public URL.
   */
  app.post("/calls/webhook", async (req, res) => {
    const validation = req.headers["validation-token"];
    if (validation) return res.set("Validation-Token", String(validation)).status(200).end();

    const expected = webhookToken();
    if (expected && String(req.headers["verification-token"] || "") !== expected) {
      return res.status(401).end();
    }
    // Acknowledge FIRST. RingCentral retries and eventually blacklists an
    // endpoint that is slow to 200, and none of the work below is worth a
    // redelivery.
    res.status(200).end();
    try {
      await handleEvent(req.body);
    } catch (e) {
      console.error("call event failed:", e.message);
    }
  });

  /** Live inbound calls for the signed-in employee, filtered by their rules. */
  app.get("/calls/stream", async (req, res) => {
    // EventSource cannot set headers, so the token rides in the query string.
    // Same verification, different transport.
    const raw = req.query?.token ? String(req.query.token) : req.headers["x-mm-auth"];
    const u = await verifyGoogleIdentity(raw);
    const email = u ? (u.email || "").toLowerCase() : "";
    // Unconditional, for the reason spelled out on requireCaller: this stream
    // carries the number of every patient who calls.
    if (!email) return res.status(401).json({ error: "Sign in required" });

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Railway's edge buffers proxied responses by default, which holds every
      // event until the stream closes — i.e. forever.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const who = email;
    const entry = { id: ++subscriberSeq, email: who, res, connectedAt: Date.now(), prefs: await loadPrefs(who) };
    subscribers.set(entry.id, entry);
    sendTo(entry, "ready", { prefs: entry.prefs });

    // Anything already ringing, so a page opened mid-call isn't blind to it.
    for (const c of calls.values()) {
      if (c.state === "ringing" && c.audience.includes(who)) sendTo(entry, "call-ring", publicCall(c));
    }

    const beat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* cleaned up on close */
      }
    }, SSE_HEARTBEAT_MS);

    req.on("close", () => {
      clearInterval(beat);
      subscribers.delete(entry.id);
    });
  });

  /**
   * Take a ringing call: forward it to the claimer's own number so their phone
   * rings. Works only while the party is in Setup/Proceeding, which is exactly
   * the window the card is on screen.
   */
  app.post("/calls/claim", async (req, res) => {
    const who = await requireCaller(req, res);
    if (who === null) return;
    const call = calls.get(String(req.body?.callId || ""));
    if (!call) return res.status(404).json({ error: "That call is no longer ringing." });
    if (call.state !== "ringing") return res.status(409).json({ error: "That call has already ended." });
    // Claimed synchronously, before any await: two reps clicking at the same
    // moment must not both fire a forward.
    if (call.claiming || call.claimedBy) {
      return res.status(409).json({ error: `${call.claimedBy || "Someone else"} is taking that call.` });
    }
    call.claiming = true;

    const prefs = await loadPrefs(who);
    const target = toE164(prefs.forwardNumber);
    if (!target) {
      call.claiming = false;
      return res.status(400).json({
        error: "Add the number RingCentral should ring you on before taking calls.",
        needsForwardNumber: true,
      });
    }

    try {
      const up = await rcApiFetch(
        `/restapi/v1.0/account/~/telephony/sessions/${encodeURIComponent(call.id)}` +
          `/parties/${encodeURIComponent(call.partyId)}/forward`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phoneNumber: target }),
        },
      );
      const text = await up.text();
      if (!up.ok) {
        call.claiming = false;
        let reason = `RingCentral refused the transfer (${up.status})`;
        try {
          const j = JSON.parse(text);
          reason = j.message || j.errors?.[0]?.message || reason;
        } catch {
          /* keep default */
        }
        void logClaim(call, who, false, reason);
        // 410 reads as "gone" to the UI: almost always the caller hung up or
        // somebody else got there first.
        return res.status(up.status === 404 || up.status === 409 ? 410 : 502).json({ error: reason });
      }
      call.claimedBy = who;
      call.claiming = false;
      broadcastUpdate(call);
      void logClaim(call, who, true, null);
      res.json({ ok: true, ringingAt: target });
    } catch (e) {
      call.claiming = false;
      const reason = String((e && e.message) || e);
      void logClaim(call, who, false, reason);
      res.status(502).json({ error: reason });
    }
  });

  async function logClaim(call, who, ok, detail) {
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO call_claims (phone_hmac, claimed_by, session_id, ok, detail) VALUES ($1,$2,$3,$4,$5)`,
        [call.hmac, who, call.id, ok, detail],
      );
    } catch (e) {
      console.error("call_claims insert failed:", e.message);
    }
  }

  /** This employee's own notification rules + allow list. */
  app.get("/calls/prefs", async (req, res) => {
    if (!configured()) return res.status(503).json({ error: "Inbound calls are not configured." });
    const who = await requireCaller(req, res);
    if (who === null) return;
    try {
      const [prefs, allow] = await Promise.all([
        loadPrefs(who),
        pool.query(
          `SELECT phone_hmac, last4, label FROM call_ring_allow WHERE email = $1 ORDER BY added_at DESC`,
          [who],
        ),
      ]);
      res.json({
        ...prefs,
        allow: allow.rows.map((r) => ({ id: r.phone_hmac, last4: r.last4 || "", label: r.label || "" })),
      });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  app.put("/calls/prefs", async (req, res) => {
    if (!configured()) return res.status(503).json({ error: "Inbound calls are not configured." });
    const who = await requireCaller(req, res);
    if (who === null) return;
    const next = normalizePrefs(req.body);
    // An unusable forward number must not be stored: it would fail at the worst
    // possible moment, with a patient on the line.
    const forward = next.forwardNumber ? toE164(next.forwardNumber) : "";
    if (next.forwardNumber && !forward) {
      return res.status(400).json({ error: "That doesn't look like a phone number we can ring." });
    }
    try {
      await pool.query(
        `INSERT INTO call_ring_prefs (email, mode, forward_number, updated_at)
         VALUES ($1,$2,$3, now())
         ON CONFLICT (email) DO UPDATE
           SET mode = $2, forward_number = $3, updated_at = now()`,
        [who, next.mode, forward || null],
      );
      const stored = { ...next, forwardNumber: forward };
      // Push the change to this person's open tabs, so a rule edit takes effect
      // on the next call rather than the next reload.
      for (const entry of subscribers.values()) {
        if (entry.email === who) {
          entry.prefs = stored;
          sendTo(entry, "prefs", stored);
        }
      }
      res.json(stored);
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /** Add a number to this employee's allow list. Stores the HMAC + last4. */
  app.post("/calls/allow", async (req, res) => {
    if (!configured()) return res.status(503).json({ error: "Inbound calls are not configured." });
    const who = await requireCaller(req, res);
    if (who === null) return;
    const e164 = toE164(req.body?.phone);
    if (!e164) return res.status(400).json({ error: "A valid phone number is required" });
    const label = String(req.body?.label || "").slice(0, 120) || null;
    try {
      await pool.query(
        `INSERT INTO call_ring_allow (email, phone_hmac, last4, label) VALUES ($1,$2,$3,$4)
         ON CONFLICT (email, phone_hmac) DO UPDATE SET label = COALESCE($4, call_ring_allow.label)`,
        [who, phoneHmac(e164), last4(e164), label],
      );
      res.json({ ok: true, id: phoneHmac(e164), last4: last4(e164), label: label || "" });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /**
   * Is this number on the caller's own allow list?
   *
   * Needed because the browser cannot compute the HMAC — the pepper is
   * server-side — so it has no way to match a number it is displaying against
   * the hashed list it was given. Powers the per-conversation bell toggle.
   */
  app.post("/calls/allow/status", async (req, res) => {
    if (!configured()) return res.status(503).json({ error: "Inbound calls are not configured." });
    const who = await requireCaller(req, res);
    if (who === null) return;
    const e164 = toE164(req.body?.phone);
    if (!e164) return res.json({ pinned: false, id: "" });
    const id = phoneHmac(e164);
    try {
      const [r, prefs] = await Promise.all([
        pool.query(`SELECT 1 FROM call_ring_allow WHERE email = $1 AND phone_hmac = $2`, [who, id]),
        loadPrefs(who),
      ]);
      // `mode` rides along so the bell can warn that pinning is a no-op: a rep
      // on `off` can happily watch a patient and never be rung, which looks
      // exactly like the feature being broken.
      res.json({ pinned: r.rowCount > 0, id, mode: prefs.mode });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  app.post("/calls/allow/remove", async (req, res) => {
    if (!configured()) return res.status(503).json({ error: "Inbound calls are not configured." });
    const who = await requireCaller(req, res);
    if (who === null) return;
    // Removal is by HMAC — the id the list was rendered with. The browser never
    // has to send the number back to delete it.
    const id = String(req.body?.id || "");
    if (!id) return res.status(400).json({ error: "id is required" });
    try {
      await pool.query(`DELETE FROM call_ring_allow WHERE email = $1 AND phone_hmac = $2`, [who, id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /**
   * Force a subscription reconcile now.
   *
   * The automatic pass runs on boot and hourly, which is right for steady state
   * and painful while someone is changing RingCentral app permissions: every
   * attempt otherwise costs a redeploy of the gateway (which also serves the
   * SPA's Monday traffic) or an hour's wait, and /calls/health is deliberately
   * side-effect free so it replays the last result rather than retrying.
   */
  app.post("/calls/resubscribe", async (req, res) => {
    const who = await requireCaller(req, res);
    if (who === null) return;
    if (!configured()) return res.status(503).json({ error: "Inbound calls are not configured." });
    await reconcileSubscription();
    console.log(`Inbound calls: manual reconcile by ${who}`);
    res.json({
      ok: !!subscriptionState.id && !subscriptionState.error,
      subscriptionId: subscriptionState.id,
      expiresAt: subscriptionState.expiresAt ? new Date(subscriptionState.expiresAt).toISOString() : null,
      error: subscriptionState.error,
    });
  });

  /**
   * Can we still receive calls, and is anyone listening?
   *
   * `ok` requires RingCentral to say the subscription is **Active right now** —
   * not merely that we once created one. See liveSubscriptionStatus.
   *
   * ⚠️ Deliberately reports no employee emails. This route takes no auth (the
   * monitor has no identity to present), so it stays counts-only; who is
   * connected is nobody's business at a public URL.
   */
  app.get("/calls/health", async (_req, res) => {
    const live = await liveSubscriptionStatus();
    const now = Date.now();
    res.json({
      ok: !!subscriptionState.id && !subscriptionState.error && live.status === "Active",
      configured: configured(),
      webhookUrl: webhookUrl(),
      subscriptionId: subscriptionState.id,
      subscriptionStatus: live.status,
      expiresAt: subscriptionState.expiresAt ? new Date(subscriptionState.expiresAt).toISOString() : null,
      error: subscriptionState.error || live.error,
      subscribers: subscribers.size,
      // How long each open browser has been attached. Ages, never identities:
      // a stack of zero-second entries is a browser reconnect-looping, which
      // reads as "connected" if you only count them.
      subscriberAges: [...subscribers.values()].map((s) => Math.round((now - s.connectedAt) / 1000)),
      ringing: [...calls.values()].filter((c) => c.state === "ringing").length,
      // `seen` climbing while `rings` stays 0 means deliveries are arriving and
      // being discarded — the failure that is otherwise indistinguishable from
      // RingCentral never sending anything.
      events: {
        seen: eventStats.seen,
        rings: eventStats.rings,
        unparsed: eventStats.unparsed,
        lastAt: eventStats.lastAt ? new Date(eventStats.lastAt).toISOString() : null,
      },
    });
  });
}

export { isRinging };
