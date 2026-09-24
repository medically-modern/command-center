/**
 * contactTotalsRules.mjs — how many calls and texts have EVER passed between us
 * and a number, folded out of the two archives this gateway already keeps.
 *
 * Brandon, 2026-09-24 (Masani dashboard notes): *"I don't think any of the
 * numbers are working for calls/texts counts. They're all 0's — can we connect
 * this to how many outbound calls in total have ever gone to the patient? and
 * is that a huge call that will get us blocked from rc on every page load?"*
 *
 * The Care Coordinator cards counted a SEVEN-DAY window read from RingCentral
 * (`useContactStates`), so every patient nobody had touched this week read 0/0
 * whether we had rung them twenty times or never. The all-time answer is
 * already in Postgres: `call_archive` (§5.47 — the call LOG as well as the
 * recordings, every call since the job's first 95-day backfill) and
 * `sms_archive` (§5.27 — every text since 2026-08-01).
 *
 * ⚠️⚠️ **NO RINGCENTRAL, AND THAT IS THE ANSWER TO HIS SECOND QUESTION.** This
 * reads two tables we own, one indexed lookup each on `phone_hmac`. It spends
 * nothing on the shared phone account — and the card counts it replaces WERE
 * RingCentral reads (up to ~18 a load, the call log in its tightest HEAVY
 * group), so switching to it takes the dashboard's RingCentral traffic to zero.
 * Adding a RingCentral call behind this route would re-create
 * INCIDENT_2026-08-20's shape on the page a coordinator sits on all day.
 *
 * ⚠️ **"Ever" means "since the archive began"**, and the two began on
 * different days. `coverageSql` asks the tables themselves rather than this
 * file hard-coding a date, so the card can say "since Jun 18" truthfully and
 * the day the archives are backfilled further, the words follow the data.
 *
 * ── Why the SQL groups and never decides ──
 * The same rule `canTextEvidenceSql` records: "did anybody pick up?" is
 * `commsInboxRules.callConnected`, which reads the result, the LEGS and the
 * duration and is parity-tested against the SPA's own call-history rule. A
 * `bool_or(...)` restating it in SQL would be a second copy nothing tests — the
 * §5.7/§5.17/§5.29 hand-synced mirror hazard — so the query groups each
 * number's calls into their distinct (direction, result, legs, has-duration)
 * shapes, a handful per number however many calls there were, and the rule
 * reads those.
 */
import { callConnected } from "./commsInboxRules.mjs";

/**
 * How many numbers one request may ask about.
 *
 * The Care Coordinator page asks for the patients its two columns can render —
 * about a hundred on 2026-09-24 (Patient Intake's ~57 plus Welcome Call's ~40),
 * each with at most two numbers. The browser chunks at this size, so a column
 * that grows is more requests, never a refused one; the cap exists so a
 * malformed caller cannot send an unbounded `ANY($1)` list.
 */
export const MAX_TOTALS_NUMBERS = 200;

/** Direction values the archives store, as RingCentral spells them. */
const OUTBOUND = "Outbound";

/**
 * Every call to or from these numbers, grouped into the shapes the connected
 * rule needs.
 *
 * ⚠️ `call_type IS DISTINCT FROM 'Fax'`: the call log carries faxes too, and
 * an inbound fax is exactly an "inbound call that did not connect". A row
 * archived before that column existed is NULL and is a call — the same filter
 * the Communications inbox uses (§5.49).
 *
 * ⚠️ `(duration_sec > 0)`, not the duration: `callConnected` only ever asks
 * whether there WAS a duration, so grouping on the boolean keeps the verdict
 * exact while collapsing thousands of distinct lengths into two groups.
 */
export function callTotalsSql() {
  return `SELECT phone_hmac, direction, result, leg_results,
                 (duration_sec > 0) AS has_duration, count(*)::int AS n
            FROM call_archive
           WHERE phone_hmac = ANY($1)
             AND call_type IS DISTINCT FROM 'Fax'
           GROUP BY phone_hmac, direction, result, leg_results, (duration_sec > 0)`;
}

/**
 * Every text to or from these numbers, counted by direction.
 *
 * ⚠️ Every archived text counts, a failed one included — "texts we sent" is
 * the question, and the card it feeds has always counted that way. A text
 * RingCentral gave up on is still one we sent, and the thread (one press away,
 * §5.50) is where its delivery verdict lives.
 */
export function textTotalsSql() {
  return `SELECT phone_hmac, direction, count(*)::int AS n
            FROM sms_archive
           WHERE phone_hmac = ANY($1)
           GROUP BY phone_hmac, direction`;
}

/** Which archives exist on this pool. An archive whose kill switch was on at
 *  first boot never ran its own schema, and a query against a missing table is
 *  an error — which would take the other half down with it. */
export function presenceSql() {
  return `SELECT to_regclass('call_archive') IS NOT NULL AS calls,
                 to_regclass('sms_archive')  IS NOT NULL AS texts`;
}

/** How far back each archive reaches — the "since" on every count. Two index
 *  scans (each table is indexed on its time column), never a table read. */
export function coverageSql({ calls, texts }) {
  const c = calls ? `(SELECT min(started_at) FROM call_archive)` : `NULL::timestamptz`;
  const t = texts ? `(SELECT min(created_at) FROM sms_archive)` : `NULL::timestamptz`;
  return `SELECT ${c} AS calls_since, ${t} AS texts_since`;
}

/**
 * The count for ONE hashed number. `null` for a half whose archive is not
 * running — which is "we cannot say", never zero.
 *
 * @typedef {{ callsOut: number|null, callsIn: number|null,
 *             textsOut: number|null, textsIn: number|null,
 *             reachedByCall: boolean }} ContactTotals
 */

/**
 * Rows → one total per hashed number.
 *
 * ⚠️ **EVERY number asked about gets an entry, zeros included.** Unlike
 * `canTextVerdicts`, where an absent number means "no evidence", a count of
 * zero IS the answer here: the archive holds no call and no text with this
 * number since it began. Omitting it would leave the browser unable to tell
 * "nobody has contacted this patient" from "we did not ask".
 *
 * ⚠️ `reachedByCall` is OUTBOUND-only, the rule the card's green phone has had
 * since 2026-09-17 (§5.30e): the question it answers is whether ringing this
 * number works. An inbound call somebody here picked up says the patient can
 * reach us, which the inbound count already says.
 *
 * @param {string[]} hmacs   every number asked about, hashed
 * @param {Array<object>} callRows  `callTotalsSql` rows, or [] when calls are off
 * @param {Array<object>} textRows  `textTotalsSql` rows, or [] when texts are off
 * @param {{calls: boolean, texts: boolean}} present  which archives answered
 * @returns {Map<string, ContactTotals>}
 */
export function foldTotals(hmacs, callRows, textRows, present) {
  const out = new Map();
  for (const h of hmacs ?? []) {
    if (!h) continue;
    out.set(h, {
      callsOut: present.calls ? 0 : null,
      callsIn: present.calls ? 0 : null,
      textsOut: present.texts ? 0 : null,
      textsIn: present.texts ? 0 : null,
      reachedByCall: false,
    });
  }
  if (present.calls) {
    for (const r of callRows ?? []) {
      const t = out.get(String(r?.phone_hmac ?? ""));
      if (!t) continue;
      const n = Number(r.n) || 0;
      if (n <= 0) continue;
      const outbound = String(r.direction ?? "") === OUTBOUND;
      if (outbound) t.callsOut += n;
      else t.callsIn += n;
      if (
        outbound &&
        callConnected({
          result: r.result,
          legResults: Array.isArray(r.leg_results) ? r.leg_results : [],
          // Only the boolean ever mattered to the rule — see callTotalsSql.
          durationSec: r.has_duration ? 1 : 0,
        })
      ) {
        t.reachedByCall = true;
      }
    }
  }
  if (present.texts) {
    for (const r of textRows ?? []) {
      const t = out.get(String(r?.phone_hmac ?? ""));
      if (!t) continue;
      const n = Number(r.n) || 0;
      if (n <= 0) continue;
      if (String(r.direction ?? "") === OUTBOUND) t.textsOut += n;
      else t.textsIn += n;
    }
  }
  return out;
}

/** A timestamp from Postgres as ISO, or null. */
export function isoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
