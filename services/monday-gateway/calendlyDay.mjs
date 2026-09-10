/**
 * One Eastern day's Calendly bookings, for the Care Coordinator's schedule grid.
 *
 * WHY THIS PROXY EXISTS, rather than the browser calling Calendly or the form
 * service directly:
 *
 *  · The welcome call has NO monday mirror. Intake bookings are mirrored onto
 *    Profile Send Off by the dtc-mm-form service, so the app reads them with an
 *    ordinary board query. The Welcome Call board has no booking column at all
 *    (checked against the live board, 2026-09-10: 156 columns, none of them a
 *    booking), and nothing copies the intake mirror across the board hop. So
 *    for welcome calls, Calendly is not just the system of record — it is the
 *    ONLY record.
 *  · The Calendly token lives on ONE service. `dtc-mm-form-api` owns the
 *    Calendly integration (booking, availability, the webhook, the mirror).
 *    Giving this gateway its own copy of the credential would be the
 *    hand-synced-config hazard the SPA already carries in two places
 *    (CLAUDE.md §5.7, §5.29) — in credential form, which is worse.
 *  · The response is PHI (patient names and emails), so it needs a real caller
 *    identity. That is this gateway's job and nothing else in the stack does
 *    it: the form service has no notion of a signed-in employee.
 *
 * So: the browser authenticates to us as an employee, and we authenticate to
 * the form service as a service. The bearer token never reaches a browser —
 * bundling it would put a live credential in a public JS file (§10).
 */
import { verifyGoogleIdentity } from "./auth.mjs";
import { KNOWN_KINDS, cacheKey, makeCache, normalizeKinds, validDate } from "./calendlyDayRules.mjs";

const UPSTREAM = (process.env.DTC_FORM_API_URL || "https://dtc-mm-form-api-production.up.railway.app")
  .replace(/\/+$/, "");
const TOKEN = process.env.CALENDLY_DAY_TOKEN || "";

/**
 * ⚠️ A read is SLOW and shared. Behind it sits one `/scheduled_events` call
 * plus one `/scheduled_events/{id}/invitees` call PER booking, and Calendly is
 * rate-limited per account — the same account the patient intake form books
 * against. A room of open dashboards asking for the same day is exactly the
 * shape of INCIDENT_2026-08-20, so the answer is cached briefly and every
 * concurrent asker for a given day shares ONE upstream request.
 *
 * 60s: a booking made now shows up within a minute, which is far inside the
 * ten-minute reminder lead this feeds.
 */
const TTL_MS = 60_000;
/** Cheap bound: this is keyed by day, and nobody pages through a year. */
const MAX_CACHE_ENTRIES = 64;

const cache = makeCache({ ttlMs: TTL_MS, max: MAX_CACHE_ENTRIES });
const inflight = new Map(); // key -> Promise

async function fetchDay(key, date, kinds) {
  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    const url = `${UPSTREAM}/api/calendly/day?date=${encodeURIComponent(date)}`
      + `&kinds=${encodeURIComponent(kinds)}`;
    const ctrl = new AbortController();
    // Comfortably longer than the upstream's own Calendly timeouts, so a slow
    // day reports the upstream's reason rather than our abort.
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => null);
      // ⚠️ Only a good answer is cached. Caching a failure would pin the grid
      // empty for a minute after a blip, and an empty day is the one answer a
      // coordinator acts on by not calling anybody.
      if (res.ok && body?.ok) cache.set(key, body);
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

export function registerCalendlyDay({ app }) {
  /** Is the upstream credential configured at all? Reported to the browser so
   *  the grid can say "not configured in this build" instead of "no bookings". */
  app.get("/calendly/day/health", (_req, res) => {
    res.json({ ok: true, configured: Boolean(TOKEN), upstream: UPSTREAM });
  });

  app.get("/calendly/day", async (req, res) => {
    // Blocking identity, exactly as /calls/* does: this hands back patient
    // names and email addresses, so an anonymous caller has no business here.
    // verifyGoogleIdentity (not verifyGoogleToken) because the ID token is
    // never refreshed — sign-in is the durable gate and a stale token must not
    // lock a coordinator out mid-shift (§5.4).
    const who = await verifyGoogleIdentity(req.headers["x-mm-auth"]);
    if (!who?.email) return res.status(401).json({ ok: false, error: "Sign in required" });

    if (!TOKEN) {
      return res.status(503).json({ ok: false, error: "CALENDLY_DAY_TOKEN not set on the gateway" });
    }

    const date = String(req.query.date || "").trim();
    if (!validDate(date)) {
      return res.status(400).json({ ok: false, error: "date must be YYYY-MM-DD" });
    }
    // Normalised so "welcome,intake" and "intake,welcome" share one cache slot.
    const kinds = normalizeKinds(req.query.kinds ?? "welcome");
    if (!kinds) {
      return res.status(400).json({ ok: false, error: `kinds must be one or more of ${KNOWN_KINDS.join(", ")}` });
    }

    const key = cacheKey(date, kinds);
    const hit = cache.get(key);
    if (hit) return res.json({ ...hit, cached: true });

    try {
      const { status, body } = await fetchDay(key, date, kinds);
      res.status(status).json(body ?? { ok: false, error: `upstream ${status}` });
    } catch (e) {
      const msg = e?.name === "AbortError" ? "calendly day read timed out" : e.message;
      res.status(502).json({ ok: false, error: msg });
    }
  });
}
