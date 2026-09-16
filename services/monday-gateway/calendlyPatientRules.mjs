/**
 * The pure half of the per-patient Calendly lookup — the window, the join key,
 * and which booking to show.
 *
 * Split out for the same reason `calendlyDayRules.mjs` sits beside
 * `calendlyDay.mjs`, and `callRules.mjs` beside `inboundCalls.mjs`: every
 * decision worth pinning here is decidable without express, a network, or a
 * Calendly credential — and a test that needs all three does not get written.
 *
 * ── WHY THIS IS BUILT OUT OF DAY READS ──
 * Calendly is reachable only through `dtc-mm-form-api`, which owns the
 * credential (CLAUDE.md §5.30b — a second copy on this gateway would be the
 * hand-synced-config hazard in its worst form). The one route that service
 * exposes is `GET /api/calendly/day?date=`, and it is strictly ONE Eastern day
 * (`etDayBoundsUtc`). There is no "find this invitee's booking" endpoint on our
 * side of the wall.
 *
 * So a per-patient answer is assembled here: read a short forward WINDOW of
 * days once, index the bookings by invitee email, and answer every patient from
 * that index. The alternative — a lookup per patient — would be one Calendly
 * round trip per header render on a page a rep works all day, which is the
 * shape of INCIDENT_2026-08-20.
 */

/**
 * How far ahead to look, in days, counting today.
 *
 * ⚠️ This is the feature's whole cost: ONE index build is this many upstream
 * day reads. It is bounded rather than open-ended because a welcome call is
 * booked days out, not months — but a window that is too SHORT fails silently
 * (a booking past the edge reads exactly like no booking at all), so widen it
 * rather than narrow it if the two are ever in doubt.
 */
export const DEFAULT_WINDOW_DAYS = 21;

/**
 * Today, in Eastern, as `YYYY-MM-DD`.
 *
 * ⚠️ The container runs in UTC and monday/Calendly days here are Eastern wall
 * clock (§5.15). Deriving the window from a UTC date puts the whole window a
 * day out for the last five hours of every Eastern day — and the failure is
 * silent, because a window that is off by one still returns bookings.
 */
export function etDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * `days` consecutive `YYYY-MM-DD` strings starting at `from`.
 *
 * Calendar arithmetic done in UTC ON PURPOSE: these are date LABELS, not
 * instants, so stepping them through `Date.UTC` can never be shifted by a
 * timezone or a DST boundary. The Eastern-ness of the window is decided once,
 * by `etDateString`, and never re-derived here.
 */
export function windowDates(from, days = DEFAULT_WINDOW_DAYS) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(from || "").trim());
  const n = Math.max(1, Math.floor(Number(days) || 0));
  if (!m) return [];
  const [, y, mo, d] = m;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const at = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + i));
    out.push(at.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The join key.
 *
 * ⚠️ **EMAIL, AND ONLY EMAIL.** Calendly hands us an invitee's name and email
 * and nothing else that identifies anybody (the day route drops everything
 * else, and that service is not ours to widen). A NAME IS NOT AN IDENTITY —
 * two patients called Maria Garcia is ordinary at this size, and the codebase
 * already has this rule written down, in `commsHub/dossier.nameMatchAccepted`,
 * where a name match must carry a second signal (phone, or blank-phone + DOB)
 * before it is accepted. Calendly gives us neither, so there is no safe name
 * match to make here and none is attempted. A patient with no email on the
 * board is UNANSWERABLE, not unbooked — the caller has to say so.
 *
 * Measured 2026-09-10 over every Profile Send Off row that has ever touched the
 * booking flow: 6 of 6 carried an email on the board, the one real booking
 * included. That is not a coincidence — the flow is only reachable through an
 * address we already hold.
 */
export function normalizeEmail(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

/** A usable address, loosely — enough to reject a blank or a stray word. */
export function looksLikeEmail(raw) {
  const s = normalizeEmail(raw);
  return s.length > 2 && s.includes("@") && !/\s/.test(s);
}

/**
 * `email -> bookings[]`, each list sorted earliest first.
 *
 * A booking with no invitee email is DROPPED rather than bucketed under `""` —
 * it can never be matched to a patient, and an empty-string bucket is one
 * mis-keyed lookup away from handing every emailless patient the same booking.
 */
export function indexByEmail(bookings) {
  const out = new Map();
  for (const b of bookings ?? []) {
    const key = normalizeEmail(b?.email);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(b);
  }
  for (const list of out.values()) {
    list.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  }
  return out;
}

/**
 * The kinds this index holds, and the one every lookup must name.
 *
 * ⚠️ **THE INDEX HOLDS BOTH KINDS SINCE 2026-09-16, SO NO LOOKUP MAY BE
 * KIND-BLIND.** It was welcome-only, and a caller that simply picked "the
 * patient's next booking" was therefore correct by accident. Now that intake
 * bookings sit in the same map, a kind-blind pick would show a Welcome Call
 * chip an INTAKE appointment — a different call, at a different stage, with a
 * different person on the phone — and nothing would error. Hence: `kind` is
 * required, and an absent or unknown one THROWS rather than defaulting. A
 * throw is a 502 with a sentence in it; a default is a wrong appointment on
 * somebody's screen.
 */
export const BOOKING_KINDS = Object.freeze(["intake", "welcome"]);

export function requireKind(kind) {
  const k = String(kind ?? "").trim().toLowerCase();
  if (!BOOKING_KINDS.includes(k)) {
    throw new Error(`kind must be one of ${BOOKING_KINDS.join(", ")} (got ${JSON.stringify(kind)})`);
  }
  return k;
}

/** Just this kind's bookings, in the order they were indexed. */
export function ofKind(bookings, kind) {
  const k = requireKind(kind);
  return (bookings ?? []).filter((b) => String(b?.kind ?? "").trim().toLowerCase() === k);
}

/**
 * Which of a patient's bookings OF THAT KIND the caller should show.
 *
 * The soonest one that has not finished yet — including one in progress, since
 * a rep looking at this screen mid-call wants the time confirmed rather than
 * hidden. Failing that, the most recent one that has already ended, which the
 * window's own start bounds to today: "their call was at 9 this morning" is
 * information; a booking from last month is not, and cannot be in here anyway.
 */
export function pickBooking(bookings, kind, nowIso = new Date().toISOString()) {
  const list = ofKind(bookings, kind).sort((a, b) =>
    String(a.startTime).localeCompare(String(b.startTime)));
  if (!list.length) return null;
  const now = String(nowIso);
  const live = list.find((b) => String(b.endTime || b.startTime) >= now);
  return live ?? list[list.length - 1];
}

/**
 * Many patients at once — the Care Coordinator dashboard's read (§5.30).
 *
 * One answer per DISTINCT normalised address, `null` for an address with
 * nothing booked in the window. Addresses that do not look like one are
 * skipped rather than answered: "we have no address" and "nothing booked" are
 * different facts and the caller only ever passes real ones. Capped so a
 * caller cannot turn one request into an unbounded map — the dashboard's
 * biggest list is a few hundred rows.
 */
export const MAX_LOOKUP_EMAILS = 500;

export function lookupMany(byEmail, emails, kind, nowIso = new Date().toISOString(), cap = MAX_LOOKUP_EMAILS) {
  const k = requireKind(kind);
  const out = {};
  let n = 0;
  for (const raw of Array.isArray(emails) ? emails : []) {
    const key = normalizeEmail(raw);
    if (!looksLikeEmail(key) || key in out) continue;
    if (n >= cap) break;
    out[key] = pickBooking(byEmail.get(key) ?? [], k, nowIso);
    n += 1;
  }
  return out;
}
