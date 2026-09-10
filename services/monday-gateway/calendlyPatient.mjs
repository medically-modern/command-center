/**
 * "Does this patient have a welcome call booked?" — `GET /calendly/patient`.
 *
 * The Welcome Call board carries no booking column and nothing mirrors one onto
 * it (CLAUDE.md §5.26, §5.30b), so Calendly is the only record a welcome call
 * has. The one route our side of the wall exposes is a single Eastern DAY
 * (`calendlyDay.mjs` → dtc-mm-form's `/api/calendly/day`), so this assembles a
 * patient-shaped answer out of day-shaped reads: one short forward window,
 * indexed by invitee email, cached, and shared by every browser and every
 * patient until it goes stale.
 *
 * ⚠️ **THE INDEX IS BUILT ONCE AND SHARED — never once per patient.** A lookup
 * per patient would be a Calendly round trip per header render on a page a rep
 * works all day, against the same rate-limited account the patient intake form
 * books through. That is the shape of INCIDENT_2026-08-20, and the guards here
 * are the same ones `calendlyDay` and the RingCentral hooks carry: a TTL cache,
 * one in-flight build, and no polling anywhere.
 *
 * ⚠️ **A PARTIAL WINDOW MUST NEVER ANSWER "not booked".** If any day in the
 * window fails — or comes back with the welcome event type unresolved — the
 * whole answer is an error. A window missing a day still returns bookings, so
 * the failure is otherwise indistinguishable from a patient who simply has no
 * appointment, and that is the answer a rep acts on by saying "you're not
 * booked in" to somebody who is.
 */
import { verifyGoogleIdentity } from "./auth.mjs";
import { readDay } from "./calendlyDay.mjs";
import {
  DEFAULT_WINDOW_DAYS,
  etDateString,
  indexByEmail,
  looksLikeEmail,
  normalizeEmail,
  pickBooking,
  windowDates,
} from "./calendlyPatientRules.mjs";

/** Days ahead, counting today. One build costs this many upstream day reads. */
const WINDOW_DAYS = Math.max(
  1,
  Number(process.env.CALENDLY_PATIENT_WINDOW_DAYS || DEFAULT_WINDOW_DAYS),
);

/**
 * How long one index stands.
 *
 * Longer than the day route's 60s on purpose: this costs `WINDOW_DAYS` upstream
 * reads rather than one, and welcome-call bookings are rare (a live scan on
 * 2026-09-10 found ONE across three weeks). Ten minutes bounds the cost at
 * roughly `WINDOW_DAYS` reads per ten minutes no matter how many reps are
 * working, while a booking made this morning still reaches the screen long
 * before anybody dials.
 */
const INDEX_TTL_MS = Math.max(
  60_000,
  Number(process.env.CALENDLY_PATIENT_TTL_MS || 600_000),
);

/**
 * How many day reads run at once.
 *
 * Sequential would make a cold build `WINDOW_DAYS` round trips deep — ten-odd
 * seconds before the first chip appears. Unbounded would fan the whole window
 * at a rate-limited account in one breath. Four is a first load in a couple of
 * seconds without ever having more than four requests outstanding.
 */
const CONCURRENCY = 4;

let index = null; // { at, byEmail: Map, from, through }
let building = null; // Promise, so concurrent askers share ONE build

async function mapWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function buildIndex() {
  const from = etDateString();
  const dates = windowDates(from, WINDOW_DAYS);
  const days = await mapWithLimit(dates, CONCURRENCY, (d) => readDay(d, "welcome"));

  // ⚠️ Every day has to have answered. See the header: a hole in the window is
  // silent, and reads as "no appointment".
  const failed = days.find((d) => !d.ok);
  if (failed) return { ok: false, error: failed.error || "calendly read failed" };
  const unresolved = days.flatMap((d) => d.unresolved ?? []);
  if (unresolved.length) {
    const why = unresolved.map((u) => `${u.kind} (${u.error})`).join("; ");
    return { ok: false, error: `Calendly could not resolve: ${why}` };
  }

  return {
    ok: true,
    entry: {
      at: Date.now(),
      byEmail: indexByEmail(days.flatMap((d) => d.bookings ?? [])),
      from,
      through: dates[dates.length - 1],
    },
  };
}

async function currentIndex() {
  if (index && Date.now() - index.at < INDEX_TTL_MS) return { ok: true, entry: index };
  if (building) return building;

  building = (async () => {
    try {
      const res = await buildIndex();
      // ⚠️ Only a COMPLETE build is kept. Caching a failure would pin every
      // patient at "couldn't check" for the whole TTL after one blip.
      if (res.ok) index = res.entry;
      return res;
    } finally {
      building = null;
    }
  })();

  return building;
}

export function registerCalendlyPatient({ app }) {
  /** What the lookup is doing, without naming a patient — same posture as
   *  `/calls/health`: counts and timestamps, never an address. */
  app.get("/calendly/patient/health", (_req, res) => {
    res.json({
      ok: true,
      windowDays: WINDOW_DAYS,
      ttlMs: INDEX_TTL_MS,
      indexed: index ? index.byEmail.size : 0,
      builtAt: index ? new Date(index.at).toISOString() : null,
      through: index?.through ?? null,
    });
  });

  app.get("/calendly/patient", async (req, res) => {
    // Blocking identity, exactly as `/calendly/day` does: the answer carries a
    // patient's appointment and a reschedule link, so an anonymous caller has
    // no business here. verifyGoogleIdentity (not verifyGoogleToken) because
    // the ID token is never refreshed and a stale one must not lock a rep out
    // mid-shift (§5.4).
    const who = await verifyGoogleIdentity(req.headers["x-mm-auth"]);
    if (!who?.email) return res.status(401).json({ ok: false, error: "Sign in required" });

    const email = normalizeEmail(req.query.email);
    if (!looksLikeEmail(email)) {
      // ⚠️ 400, never a cheerful `{booking: null}`. "We have no address for this
      // patient" and "this patient has no appointment" are different answers and
      // the screen says different things about them.
      return res.status(400).json({ ok: false, error: "email is required" });
    }

    try {
      const built = await currentIndex();
      if (!built.ok) return res.status(502).json({ ok: false, error: built.error });

      const { entry } = built;
      const booking = pickBooking(entry.byEmail.get(email) ?? []);
      res.json({
        ok: true,
        booking,
        // So the caller can say what was actually looked at rather than implying
        // "ever" — a booking past this date is outside the window, not absent.
        from: entry.from,
        through: entry.through,
      });
    } catch (e) {
      res.status(502).json({ ok: false, error: e?.message || String(e) });
    }
  });
}
