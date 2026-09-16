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
  BOOKING_KINDS,
  DEFAULT_WINDOW_DAYS,
  etDateString,
  indexByEmail,
  looksLikeEmail,
  lookupMany,
  MAX_LOOKUP_EMAILS,
  normalizeEmail,
  pickBooking,
  requireKind,
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

/**
 * ⚠️ **BOTH KINDS SINCE 2026-09-16** — it read `"welcome"` alone, which is what
 * left the Care Coordinator's Patient Intake column deciding Scheduled vs
 * Unscheduled off the monday MIRROR while the strip above it and the Welcome
 * Call column beside it read Calendly. The two halves of one screen then
 * disagreed about who was booked, in both directions (CLAUDE.md §5.30d).
 *
 * The cost is bounded and smaller than it looks: `readDay` caches on
 * `date + kinds`, so asking for `"intake,welcome"` here now shares TODAY's
 * entry with the day strip instead of duplicating it. What it adds is the
 * intake half of the other window days — one `/invitees` call per intake
 * booking, and the board carried three mirrored bookings in its whole history.
 */
async function buildIndex() {
  const from = etDateString();
  const dates = windowDates(from, WINDOW_DAYS);
  const days = await mapWithLimit(dates, CONCURRENCY, (d) => readDay(d, "intake,welcome"));

  // ⚠️ Every day has to have answered. See the header: a hole in the window is
  // silent, and reads as "no appointment".
  const failed = days.find((d) => !d.ok);
  if (failed) return { ok: false, error: failed.error || "calendly read failed" };

  /**
   * ⚠️ Unresolved is tracked PER KIND, not as one flag over the window.
   *
   * A kind whose event type Calendly could not resolve contributes no bookings,
   * so answering for it would be "nobody is booked" on a day that may be full.
   * But failing the WHOLE index for it would take the welcome-call column down
   * because the intake event type broke, and vice versa — one feature's outage
   * becoming two. So each kind carries its own verdict and each route checks
   * only the kind it was asked about.
   */
  const unresolved = new Map();
  for (const u of days.flatMap((d) => d.unresolved ?? [])) {
    const k = String(u?.kind ?? "").trim().toLowerCase();
    if (k && !unresolved.has(k)) unresolved.set(k, u.error || "could not resolve");
  }

  return {
    ok: true,
    entry: {
      at: Date.now(),
      byEmail: indexByEmail(days.flatMap((d) => d.bookings ?? [])),
      unresolved,
      from,
      through: dates[dates.length - 1],
    },
  };
}

/** The "we could not check THIS kind" sentence, or null when it is answerable. */
function unresolvedReason(entry, kind) {
  const why = entry.unresolved?.get(kind);
  return why ? `Calendly could not resolve: ${kind} (${why})` : null;
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
      kinds: BOOKING_KINDS,
      indexed: index ? index.byEmail.size : 0,
      // Which kinds this index can actually answer for — a kind listed here
      // returns 502 rather than an empty answer (see `unresolvedReason`).
      unresolved: index ? Object.fromEntries(index.unresolved ?? []) : {},
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

    // ⚠️ Defaults to `welcome`, which is what this route has always meant (the
    // §5.31e Welcome Call chip is its only caller). The index holds both kinds
    // now, so a kind-blind answer here would put an INTAKE appointment under a
    // "Call scheduled" chip on the Welcome Call page.
    let kind;
    try {
      kind = requireKind(req.query.kind ?? "welcome");
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }

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
      const why = unresolvedReason(entry, kind);
      if (why) return res.status(502).json({ ok: false, error: why });
      const booking = pickBooking(entry.byEmail.get(email) ?? [], kind);
      res.json({
        ok: true,
        kind,
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

  /**
   * Many patients in one request — the Care Coordinator dashboard (§5.30).
   *
   * Same index, same auth, one round trip for a whole column instead of one
   * per card: the index is built once and shared, so answering 40 addresses
   * costs the same as answering one. Body `{ emails: string[] }`; answer
   * `{ ok, bookings: { [email]: booking | null }, from, through }`.
   *
   * ⚠️ A partial window still answers as an ERROR here, exactly as the single
   * lookup does — a column that reads "nobody is booked" because Calendly
   * blipped is the wrong answer a coordinator acts on.
   */
  app.post("/calendly/patients", async (req, res) => {
    const who = await verifyGoogleIdentity(req.headers["x-mm-auth"]);
    if (!who?.email) return res.status(401).json({ ok: false, error: "Sign in required" });

    let kind;
    try {
      kind = requireKind(req.body?.kind ?? "welcome");
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }

    const emails = req.body?.emails;
    if (!Array.isArray(emails)) {
      return res.status(400).json({ ok: false, error: "emails[] is required" });
    }
    if (emails.length > MAX_LOOKUP_EMAILS) {
      return res.status(400).json({ ok: false, error: `at most ${MAX_LOOKUP_EMAILS} emails per request` });
    }

    try {
      const built = await currentIndex();
      if (!built.ok) return res.status(502).json({ ok: false, error: built.error });
      const { entry } = built;
      const why = unresolvedReason(entry, kind);
      if (why) return res.status(502).json({ ok: false, error: why });
      res.json({
        ok: true,
        kind,
        bookings: lookupMany(entry.byEmail, emails, kind),
        from: entry.from,
        through: entry.through,
      });
    } catch (e) {
      res.status(502).json({ ok: false, error: e?.message || String(e) });
    }
  });
}
