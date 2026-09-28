/**
 * phonePresenceRules.mjs — is each assigned answerer's BROWSER actually
 * registered on the shared RingCentral extension? (§5.13b)
 *
 * ⚠️⚠️ **WHY THIS HAS TO BE REPORTED BY THE BROWSER, AND CANNOT BE MEASURED
 * HERE.** The SIP socket goes browser → RingCentral **directly**; the gateway
 * is not on that path. `/messaging/sip-provision` succeeding proves only that
 * we handed out credentials, and the sipInfo cache means a healthy browser
 * asks for them roughly once a week — so the gateway's own logs cannot
 * distinguish "five browsers registered and ringing" from "nobody has been
 * able to register since Tuesday". On 2026-09-28 Katie's browser sat on
 * "Can't reach RingCentral's phone server. Retrying…" on prod and the gateway
 * had no record of it at all: the whole incident was invisible server-side.
 *
 * So each browser POSTs its own registration state, and this file is the pure
 * half that decides what those rows MEAN. Kept beside `callRules` /
 * `callHistoryQuery` for the same reason they are: the route, the readout on
 * /access and the monitor must all reach the same verdict from the same row,
 * and a second copy of "is this one healthy" is how a dashboard ends up
 * disagreeing with the alert.
 *
 * ⚠️ No PHI here. Rows are employee emails and a registration status —
 * the same class of data `call_claims` already holds, and nothing about a
 * patient ever reaches this table.
 */

/** How often a leader tab reports in. One request per BROWSER per minute:
 *  at most five answerers, so single figures a minute at the gateway, and
 *  nothing at RingCentral. ⚠️ Keep in agreement with the client's own
 *  `PHONE_REPORT_EVERY_MS` (src/lib/inboundCalls/phoneReport.ts). */
export const PRESENCE_HEARTBEAT_MS = 60_000;

/**
 * After this long with no heartbeat the browser is treated as GONE, not as
 * broken. Three beats: one missed beat is a slow request or a tab mid-reload,
 * and calling that an outage is how a monitor teaches people to ignore it.
 */
export const PRESENCE_STALE_MS = 3 * PRESENCE_HEARTBEAT_MS;

/**
 * How long a browser may be open and NOT registered before it is a fault.
 *
 * ⚠️ Generous on purpose. A page load registers in a second or two, a network
 * blip recovers on the 2s→60s ladder, and `full` clears itself when somebody
 * closes a browser (~2 min). Five minutes is past all of those, so what is
 * left is a browser that genuinely cannot get on the line.
 */
export const PRESENCE_TROUBLE_MS = 5 * 60_000;

/** The registration values a browser may report — softphone's RegistrationStatus. */
const STATES = new Set(["off", "registering", "registered", "full", "error"]);

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Clamp what a browser posted into a row we are willing to store.
 *
 * ⚠️ The email is NEVER taken from the body — it is the verified Google
 * identity the route resolved. A browser that could name itself could report
 * somebody else as healthy, which is exactly the fault this table exists to
 * catch.
 */
export function normalizeReport(email, body) {
  const b = body && typeof body === "object" ? body : {};
  const registration = STATES.has(b.registration) ? b.registration : "off";
  return {
    email: String(email || "").toLowerCase(),
    // A browser with no instance id is one whose localStorage is unavailable;
    // it still deserves a row, under a name that cannot collide with a real one.
    instanceId: str(b.instanceId, 64) || "no-instance",
    registration,
    detail: str(b.detail, 300) || null,
    leader: b.leader === true,
    userAgent: str(b.userAgent, 300) || null,
  };
}

/**
 * What one stored row means right now.
 *
 * `gone` is the quiet one and it is load-bearing: a browser that is simply
 * closed is NORMAL — people go home — and §5.13's monitor note records what
 * happened the last time "nobody has a tab open" was treated as an outage
 * (it paged every evening until the check was removed). Only a browser that
 * is still reporting in can be in trouble.
 */
export function verdictFor(row, now) {
  const at = Number(row?.at || 0);
  const since = Number(row?.since || at);
  const heldFor = Math.max(0, now - since);
  if (!at || now - at > PRESENCE_STALE_MS) {
    return { state: "gone", heldFor, label: "No Command Center browser open" };
  }
  switch (row.registration) {
    case "registered":
      return { state: "connected", heldFor, label: "Connected — calls ring in this browser" };
    case "registering":
      return heldFor > PRESENCE_TROUBLE_MS
        ? { state: "trouble", heldFor, label: "Stuck connecting to RingCentral" }
        : { state: "waiting", heldFor, label: "Connecting…" };
    case "full":
      return heldFor > PRESENCE_TROUBLE_MS
        ? { state: "trouble", heldFor, label: "The line is full — this browser can't ring" }
        : { state: "waiting", heldFor, label: "Waiting for a free slot on the line" };
    case "error":
      return heldFor > PRESENCE_TROUBLE_MS
        ? { state: "trouble", heldFor, label: row.detail || "Can't register with RingCentral" }
        : { state: "waiting", heldFor, label: row.detail || "Retrying…" };
    default:
      // "off": the browser is open but nothing wants the registration — they
      // are not an assigned answerer, or they just were un-assigned.
      return { state: "gone", heldFor, label: "Browser answering is off for this person" };
  }
}

/** Worst first, so a person with one good browser and one broken one reads as
 *  covered — which they are: any registered browser rings. */
const RANK = { connected: 0, waiting: 1, trouble: 2, gone: 3 };

/**
 * One line per assigned answerer, whatever browsers they have reported.
 *
 * ⚠️ Driven by the ASSIGNMENT list, not by the rows: somebody a manager has
 * assigned who has never reported at all is the most important line on the
 * page, and a rows-only view would simply omit them.
 */
export function summarize(answerers, rows, now) {
  const byEmail = new Map();
  for (const r of rows || []) {
    const email = String(r.email || "").toLowerCase();
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push({ ...r, verdict: verdictFor(r, now) });
  }
  const assigned = (answerers || []).map((e) => String(e || "").toLowerCase()).filter(Boolean);
  const out = assigned.map((email) => {
    const browsers = (byEmail.get(email) || []).sort(
      (a, b) => RANK[a.verdict.state] - RANK[b.verdict.state] || b.at - a.at,
    );
    const best = browsers[0]?.verdict;
    return {
      email,
      // Covered = at least one browser of theirs is registered. That is the
      // only question that decides whether a call reaches this person.
      connected: browsers.some((b) => b.verdict.state === "connected"),
      state: best?.state || "gone",
      label: best?.label || "No Command Center browser open",
      heldFor: best?.heldFor ?? 0,
      browsers: browsers.map((b) => ({
        instanceId: b.instanceId,
        registration: b.registration,
        detail: b.detail,
        leader: b.leader,
        userAgent: b.userAgent,
        at: b.at,
        since: b.since,
        ...b.verdict,
      })),
    };
  });
  return {
    assigned: assigned.length,
    connected: out.filter((p) => p.connected).length,
    people: out,
    // Browsers reporting from somebody who is NOT assigned: usually a tab left
    // open after a re-assignment. Worth counting because each one that is
    // still registered is holding one of RingCentral's five slots.
    unassigned: [...byEmail.keys()].filter((e) => !assigned.includes(e)).length,
  };
}

/**
 * What the monitor should say, if anything.
 *
 * ⚠️ **One way only.** A quiet team with no browsers open is NORMAL and must
 * never page — that check existed once and was removed on 2026-08-17 for
 * paging every evening (§5.13). What is reported here is strictly: a browser
 * that is OPEN, reporting in, and has been unable to ring for longer than
 * anyone would call a blip. Nobody home is not an outage.
 */
export function presenceFaults(rows, now) {
  const byEmail = new Map();
  for (const r of rows || []) {
    const email = String(r.email || "").toLowerCase();
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(verdictFor(r, now));
  }
  const out = [];
  for (const [email, verdicts] of byEmail) {
    // ⚠️ Per PERSON, not per browser. Someone whose main browser is registered
    // while a forgotten second tab sits on "full" is being rung perfectly
    // well; paging about that trains people to swipe these away. (The
    // forgotten one is still worth SEEING — it holds one of the five — which
    // is what `summarize` shows on the page.)
    if (verdicts.some((v) => v.state === "connected")) continue;
    const worst = verdicts.filter((v) => v.state === "trouble").sort((a, b) => b.heldFor - a.heldFor)[0];
    if (!worst) continue;
    const minutes = Math.round(worst.heldFor / 60_000);
    out.push({
      email,
      heldFor: worst.heldFor,
      minutes,
      label: worst.label,
      // ⚠️ Objects, not bare sentences: the monitor decides WHEN to wake
      // somebody from `heldFor` (calls-monitor's `pagesAt`), and a string it
      // had to parse a number back out of would be one regex away from
      // paging every ten minutes all day.
      text: `${email} has a Command Center browser open but has not been able to ring for ${minutes} min — ${worst.label}`,
    });
  }
  return out.sort((a, b) => a.email.localeCompare(b.email));
}
