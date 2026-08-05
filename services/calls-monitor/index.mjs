/**
 * calls-monitor — Railway cron service
 *
 * Every 10 minutes, asks the gateway whether the Command Center can still
 * receive inbound calls, and pushes to ntfy when it can't.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Inbound calling fails QUIETLY. Every failure mode in it — a blacklisted
 * subscription, a revoked RingCentral permission, a gateway that won't boot,
 * every browser dropping its stream — presents identically to a quiet
 * afternoon: no cards appear, and nothing anywhere says why. The feature was
 * live for hours in exactly that state (33 events delivered, 33 discarded)
 * before anyone could tell. This is the thing that notices.
 *
 * ── What it can and cannot prove ────────────────────────────────────────────
 * It CANNOT prove delivery. Only a real inbound call does that, and we don't
 * place synthetic ones into a production line. What it proves is the chain
 * up to delivery: the gateway is up, RingCentral still calls the subscription
 * Active *right now* (not "we created one once"), the webhook URL still answers
 * RingCentral's handshake, and somebody's browser is actually attached.
 *
 * Required env:  CALLS_HEALTH_URL, NTFY_URL, NTFY_TOPIC
 * Optional env:  CALLS_WEBHOOK_URL   probe the handshake too (recommended)
 *                BUSINESS_HOURS      "9-18" ET, default; "" disables that check
 *                DRY_RUN=1           print, don't notify
 */

const {
  CALLS_HEALTH_URL,
  CALLS_WEBHOOK_URL,
  NTFY_URL,
  NTFY_TOPIC,
  BUSINESS_HOURS = "9-18",
  DRY_RUN,
} = process.env;

const FETCH_TIMEOUT_MS = 15_000;

function required(name, value) {
  if (!value) {
    console.error(`FATAL: ${name} is not set`);
    process.exit(1);
  }
  return value;
}

async function get(url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Is it a weekday working hour in EASTERN time?
 *
 * ⚠️ ET, not the container's clock. Railway runs UTC, so a naive `getHours()`
 * would put the "is anyone working?" window in the middle of the night and the
 * zero-subscribers alarm would fire every evening until someone muted it — at
 * which point it stops being a monitor.
 */
function inBusinessHours(now = new Date()) {
  if (!BUSINESS_HOURS) return false;
  const [from, to] = BUSINESS_HOURS.split("-").map((n) => parseInt(n, 10));
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const h = et.getHours();
  return h >= from && h < to;
}

/** Does the webhook URL still answer RingCentral's validation handshake?
 *  This is what RC itself requires, so a silent failure here eventually gets
 *  the subscription blacklisted. Checking it is cheap and side-effect free. */
async function handshakeOk(url) {
  if (!url) return null;
  try {
    const token = `monitor-${Date.now()}`;
    const res = await get(url, { method: "POST", headers: { "Validation-Token": token } });
    return res.ok && res.headers.get("validation-token") === token;
  } catch {
    return false;
  }
}

async function notify(title, message, priority = "high") {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] ${title}: ${message}`);
    return;
  }
  try {
    const res = await get(`${NTFY_URL.replace(/\/+$/, "")}/${NTFY_TOPIC}`, {
      method: "POST",
      headers: { Title: title, Priority: priority, Tags: "telephone_receiver,warning" },
      body: message,
    });
    if (!res.ok) console.error(`ntfy failed (${res.status})`);
  } catch (e) {
    console.error("ntfy failed:", e.message);
  }
}

/** Everything wrong right now, as human sentences. Empty means healthy. */
export function faults(health, { handshake, businessHours }) {
  const out = [];
  if (!health) return ["The gateway did not respond — inbound calls are down."];

  if (!health.configured) out.push("The gateway reports inbound calls are not configured.");
  if (health.error) out.push(`Gateway error: ${health.error}`);

  // The load-bearing check. `subscriptionId` only says we created one once;
  // RingCentral blacklists a webhook after repeated failures and the id stays
  // exactly the same, so the STATUS is the thing that matters.
  if (!health.subscriptionId) out.push("No RingCentral subscription exists — no calls will arrive.");
  else if (health.subscriptionStatus && health.subscriptionStatus !== "Active") {
    out.push(`RingCentral subscription is ${health.subscriptionStatus}, not Active — no calls will arrive.`);
  }

  if (handshake === false) {
    out.push("The webhook URL is not answering RingCentral's validation handshake.");
  }

  // Events arriving but never becoming rings is the envelope-bug signature:
  // deliveries land, get acked, and are thrown away.
  const ev = health.events || {};
  if (ev.seen > 0 && ev.unparsed === ev.seen) {
    out.push(`All ${ev.seen} RingCentral events were unparseable — the payload shape has changed.`);
  }

  // Nobody attached means nobody can see a call, however healthy the rest is.
  if (businessHours && !health.subscribers) {
    out.push("No Command Center browser is connected — nobody would see an incoming call.");
  }
  return out;
}

async function main() {
  required("CALLS_HEALTH_URL", CALLS_HEALTH_URL);
  if (!DRY_RUN) {
    required("NTFY_URL", NTFY_URL);
    required("NTFY_TOPIC", NTFY_TOPIC);
  }

  let health = null;
  try {
    const res = await get(CALLS_HEALTH_URL);
    if (res.ok) health = await res.json();
    else console.error(`health returned ${res.status}`);
  } catch (e) {
    console.error("health unreachable:", e.message);
  }

  const handshake = await handshakeOk(CALLS_WEBHOOK_URL);
  const businessHours = inBusinessHours();
  const problems = faults(health, { handshake, businessHours });

  if (!problems.length) {
    console.log(
      `OK — subscription ${health.subscriptionStatus}, ${health.subscribers} browser(s), ` +
        `${health.events?.seen ?? 0} events seen, ${health.events?.rings ?? 0} rings`,
    );
    return;
  }

  console.error("PROBLEMS:\n" + problems.map((p) => ` - ${p}`).join("\n"));
  await notify(
    "Command Center: inbound calls",
    problems.join("\n") + "\n\nCheck: " + CALLS_HEALTH_URL,
  );
}

// Importable for tests without firing a real check.
if (!process.env.CALLS_MONITOR_TEST) {
  main().catch((e) => {
    console.error("monitor crashed:", e);
    process.exit(1);
  });
}
