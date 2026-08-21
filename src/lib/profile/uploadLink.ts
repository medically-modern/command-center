/**
 * "Generate CGM data link" — the rep-side half of HANDOFF §8.3.
 *
 * The rep is on the call and needs the patient's CGM data. This mints a one-off
 * link scoped to that patient's Monday item; the rep then TEXTS it from the
 * ordinary composer and the patient uploads from their phone.
 *
 * ⚠️ The link is not sent for them. Minting and sending are deliberately two
 * steps: the composer is where the opt-out guard lives, where the rep can see
 * the thread they are adding to, and where they can reword the message. A
 * button that silently fired a text would route around all three.
 *
 * The endpoint lives on the dtc-mm-form service (Josh, 2026-08-11), not the
 * gateway — that service already owns the patient-facing surface, already holds
 * the Monday write token, and already serves public unauthenticated routes,
 * which the patient's upload page has to be.
 */

import { splitName } from "./nameParts";

/**
 * "2026-08-14 15:30:00" (naive Eastern, as Monday stores it) → "Thu Aug 14, 3:30 PM".
 *
 * ⚠️ Formatted by STRING SURGERY, never `new Date(...)`. The column is
 * timezone-naive Eastern wall-clock; parsing it into a Date reinterprets it in
 * the viewer's zone, which is the exact bug that had the old form booking
 * people three hours out (CLAUDE.md §9). The weekday is the one part that needs
 * a real date, so it is built at UTC noon where no offset can shift the day.
 */
export function formatBookedCall(raw: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec((raw ?? "").trim());
  if (!m) return "";
  const [, y, mo, d, hh, mm] = m;
  // Weekday and date are formatted SEPARATELY so the punctuation is ours:
  // asking for all three at once yields "Fri, Aug 14", which then reads
  // "Fri, Aug 14, 3:30 PM" once the time is appended.
  const at = new Date(Date.UTC(+y, +mo - 1, +d, 12));
  const wd = at.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const md = at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const weekday = `${wd} ${md}`;
  if (hh === undefined) return weekday;
  const h = +hh;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${weekday}, ${h12}:${mm} ${suffix}`;
}

/**
 * dtc-mm-form-api origin. No trailing slash.
 *
 * ⚠️ HARDCODED ON PURPOSE — do NOT turn this into a required build secret.
 *
 * This is a public hostname, not a credential: the patient's own upload link
 * points at it, and the intake form (a public GitHub Pages page) has the same
 * string in its source at `index.html`'s `API_BASE`. Nothing here authenticates
 * anything, so there is nothing to leak.
 *
 * Making it a `VITE_*` secret would cost real things and buy none: every
 * `VITE_*` has to be re-added to the PROD repo's Actions secrets by hand
 * (CLAUDE.md §8 — the one that bites), it can only change by rebuilding, and it
 * pushes the Command Center back toward the bundled-config model the Railway
 * gateway exists to get away from. The Railway services are ONE instance
 * serving both test and prod, so there is no per-environment value to inject —
 * same reason board IDs are constants in this codebase.
 *
 * The env var stays as an OPTIONAL override for pointing a local dev build at a
 * different instance. Unset, which is the normal case, the constant wins.
 */
const DEFAULT_API_BASE = "https://dtc-mm-form-api-production.up.railway.app";

const API_BASE = (((import.meta.env.VITE_DTC_FORM_API_URL as string | undefined) ?? "").trim()
  || DEFAULT_API_BASE
).replace(/\/$/, "");

/** Always true in a normal build — the origin is a constant. Kept as a function
 *  so an override set to empty still degrades to "hide the button" rather than
 *  posting to a relative URL on the Pages host. */
export function uploadLinksConfigured(): boolean {
  return API_BASE !== "";
}

export class UploadLinkError extends Error {}

/** Long enough for a Railway cold start, short enough that the rep finds out
 *  the service is down while the patient is still on the phone. */
const MINT_TIMEOUT_MS = 20_000;

export interface UploadLink {
  url: string;
  /** ISO 8601. The server owns the lifetime, not this — and it differs per
   *  kind: a CGM link lasts 24h, an insurance-card link 90 days. */
  expiresAt: string;
}

/**
 * Which file column the patient's upload lands in.
 *
 * The kind travels to the service and is signed INTO the token there, so it
 * decides the destination column server-side. Nothing here names a column —
 * that is the point: a link cannot be re-aimed by anyone who has it.
 *
 * `insurance-card` is the same link the intake form texts a patient who
 * answered "I don't have it on me" (§5.19). A rep sending it from Start
 * Insurance Follow-Up is sending that patient the identical thing, which is
 * why the two must not become two mechanisms.
 */
export type UploadLinkKind = "cgm" | "insurance-card";

/**
 * Mint a link for one patient.
 *
 * Throws `UploadLinkError` with a message meant for a toast — every failure
 * here is something the rep can act on (wrong stage, service down, not
 * configured), so a generic "request failed" would waste the call.
 */
export async function generateUploadLink(
  itemId: string,
  kind: UploadLinkKind = "cgm",
): Promise<UploadLink> {
  if (!API_BASE) {
    throw new UploadLinkError(
      "Upload links aren't configured — VITE_DTC_FORM_API_URL is overridden to an empty value.",
    );
  }

  // Without this the button spins forever against a stalled or cold-starting
  // service, and the rep is left on the phone with no error and no way out.
  // Generous enough to cover a Railway cold start, short enough that a dead
  // service is obvious while the patient is still on the line.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), MINT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/intake/upload-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, kind }),
      signal: ctl.signal,
    });
  } catch (e) {
    // Distinguish the two, because they lead the rep somewhere different: a
    // timeout means try once more, a hard failure means the service or its CORS
    // origin is wrong and retrying will not help.
    throw new UploadLinkError(
      (e as Error)?.name === "AbortError"
        ? "The intake service didn't respond in time — try once more."
        : "Couldn't reach the intake service to generate a link.",
    );
  } finally {
    clearTimeout(timer);
  }

  let body: { ok?: boolean; url?: string; expiresAt?: string; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* fall through to the status-based message below */
  }

  if (!res.ok || !body.ok || !body.url) {
    throw new UploadLinkError(
      body.error
        || (res.status === 404
          ? "That patient isn't in the intake stage, so a link can't be generated."
          : `Couldn't generate a link (${res.status}).`),
    );
  }

  return { url: body.url, expiresAt: body.expiresAt ?? "" };
}

/**
 * Calendly's reschedule page for this patient's booking.
 *
 * The rep opens it WITH the patient on the phone and moves the time there.
 * Calendly swaps the booking and fires the webhook that updates the Monday
 * mirror, so the intake page and the Scheduled Calls grid stay in agreement.
 *
 * ⚠️ There is deliberately no "type a new time" path. The Scheduling API is
 * off on this account, so a locally-entered time could never become a real
 * booking — it would only mark the patient Scheduled while no call existed.
 *
 * `noBooking` is not a failure: most intake patients have never booked.
 */
export async function getRescheduleLink(
  itemId: string,
): Promise<{ url: string } | { noBooking: true }> {
  if (!API_BASE) throw new UploadLinkError("The intake service isn't configured in this build.");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), MINT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/api/intake/reschedule-link?itemId=${encodeURIComponent(itemId)}`,
      { signal: ctl.signal },
    );
  } catch (e) {
    throw new UploadLinkError(
      (e as Error)?.name === "AbortError"
        ? "The intake service didn't respond in time — try once more."
        : "Couldn't reach the intake service.",
    );
  } finally {
    clearTimeout(timer);
  }

  let body: { ok?: boolean; url?: string; error?: string; noBooking?: boolean } = {};
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (body.noBooking) return { noBooking: true };
  if (!res.ok || !body.ok || !body.url) {
    throw new UploadLinkError(body.error || `Couldn't get a reschedule link (${res.status}).`);
  }
  return { url: body.url };
}

/**
 * The text the composer opens with.
 *
 * The link goes LAST on purpose (Josh, 2026-08-11): SMS clients truncate long
 * messages behind a "more" tap, and a link buried mid-paragraph is the one
 * thing the patient must not have to hunt for. Kept short for the same reason —
 * this is read on a phone, out loud, while the rep waits on the line.
 */
export function uploadLinkMessage(patientName: string | undefined, url: string): string {
  const first = splitName(patientName).first || "there";
  return (
    `Hi ${first}, it's the team at Medically Modern. `
    + `Please use the link below to send us a photo or export of your CGM data — `
    + `it opens right on your phone, no login needed. Thank you!\n\n`
    + url
  );
}
