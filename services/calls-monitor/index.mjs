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
 * Active *right now* (not "we created one once"), and the webhook URL still
 * answers RingCentral's handshake.
 *
 * Required env:  CALLS_HEALTH_URL, NTFY_URL, NTFY_TOPIC
 * Optional env:  CALLS_WEBHOOK_URL   probe the handshake too (recommended)
 *                DRY_RUN=1           print, don't notify
 */

const {
  CALLS_HEALTH_URL,
  CALLS_WEBHOOK_URL,
  NTFY_URL,
  NTFY_TOPIC,
  DRY_RUN,
} = process.env;

const FETCH_TIMEOUT_MS = 15_000;

/**
 * How recent a delivered event has to be to PROVE RingCentral is still sending
 * us calls. The check runs every 10 minutes, so this is one cycle plus slack.
 *
 * The inference only runs one way: a recent event proves the subscription is
 * alive, but no recent events prove nothing at all — that is a quiet afternoon,
 * which is the whole reason this monitor exists.
 */
const DELIVERING_WITHIN_MS = 20 * 60_000;

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

/**
 * What a null `subscriptionId` actually licenses us to say.
 *
 * ⚠️ It is the GATEWAY's memory of a subscription, not RingCentral's record of
 * one, and the two fail apart. That memory is per-process and is filled by a
 * reconcile pass which can fail for reasons that have nothing to do with the
 * subscription — a 429 on the lookup being the one that happens. So a redeploy
 * plus a throttled first pass reads as "no subscription" while RingCentral is
 * still delivering webhooks to that very container.
 *
 * That is not a hypothetical: on 2026-08-20 it paged six times with "no calls
 * will arrive" while three real calls rang through, the last of them one minute
 * before an alert. An alert that declares an outage it has not established is
 * the mirror image of the silence this monitor exists to break — it is worse
 * than useless, because it teaches everyone to swipe these away.
 *
 * So the sentence is chosen by what we can actually support:
 *   · webhooks arriving right now  → the subscription is provably ALIVE; the
 *                                    gateway is out of sync, calls are fine
 *   · the gateway told us why      → we could not CHECK; say so, claim nothing
 *   · no id and no reason given    → the original hard verdict stands
 */
function missingSubscriptionFault(health, now) {
  const lastAt = Date.parse(health.events?.lastAt || "");
  if (Number.isFinite(lastAt) && now - lastAt < DELIVERING_WITHIN_MS) {
    const mins = Math.max(0, Math.round((now - lastAt) / 60_000));
    return (
      "The gateway has lost track of its RingCentral subscription, but webhooks are " +
      `STILL ARRIVING (last one ${mins} min ago) — calls ARE getting through. It should ` +
      "re-sync on its own; if these keep coming, POST /calls/resubscribe."
    );
  }
  if (health.error) {
    return (
      "Could not confirm a RingCentral subscription — the gateway's own lookup failed " +
      "(see the error above), so this is NOT evidence that calls have stopped. Check " +
      "whether any are arriving before treating it as an outage."
    );
  }
  return "No RingCentral subscription exists — no calls will arrive.";
}

/** Everything wrong right now, as human sentences. Empty means healthy. */
export function faults(health, { handshake, now = Date.now() }) {
  const out = [];
  if (!health) return ["The gateway did not respond — inbound calls are down."];

  if (!health.configured) out.push("The gateway reports inbound calls are not configured.");
  if (health.error) out.push(`Gateway error: ${health.error}`);

  // The load-bearing check. `subscriptionId` only says we created one once;
  // RingCentral blacklists a webhook after repeated failures and the id stays
  // exactly the same, so the STATUS is the thing that matters.
  if (!health.subscriptionId) out.push(missingSubscriptionFault(health, now));
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
  const problems = faults(health, { handshake });

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
