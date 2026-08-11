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

export interface UploadLink {
  url: string;
  /** ISO 8601. Links last 24h — the server owns that, not this. */
  expiresAt: string;
}

/**
 * Mint a link for one patient.
 *
 * Throws `UploadLinkError` with a message meant for a toast — every failure
 * here is something the rep can act on (wrong stage, service down, not
 * configured), so a generic "request failed" would waste the call.
 */
export async function generateUploadLink(itemId: string): Promise<UploadLink> {
  if (!API_BASE) {
    throw new UploadLinkError(
      "Upload links aren't configured — VITE_DTC_FORM_API_URL is overridden to an empty value.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/intake/upload-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
  } catch {
    // A network-level failure here is usually the service being asleep or a
    // CORS origin that was never added, and both look identical to the rep.
    throw new UploadLinkError("Couldn't reach the intake service to generate a link.");
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
