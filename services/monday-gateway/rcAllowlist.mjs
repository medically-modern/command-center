/**
 * rcAllowlist.mjs — the /rc proxy's security boundary, as pure functions.
 *
 * Split out of ringcentral.mjs for the same reason callRules.mjs is split out
 * of inboundCalls.mjs: that module imports express + google-auth-library, so
 * anything living in it can't be unit-tested without the gateway's own
 * node_modules. These two predicates decide what a browser may reach with the
 * gateway's account-wide RingCentral token, which is exactly the code that
 * should be covered by tests.
 */

// Only the RingCentral paths the SPA actually uses. Keeps the proxy from
// becoming an open door to the rest of the account's RingCentral API.
//   message-store — fax + SMS reads, mark-read, and the Assigned Patients inbox
//   sms           — send
//   ring-out      — outbound click-to-call (two-legged; no WebRTC, no Digital
//                   Line). NOTE: cancelling a RingOut is DELETE, which the
//                   gateway's method allowlist and CORS layer both exclude — so
//                   there is deliberately no cancel. Starting a call and letting
//                   it ring is the whole feature.
//   call-log      — a patient's call history (duration + missed) on the profile
//                   headers. Read-only; the route's GET/POST/PUT method
//                   allowlist already blocks the DELETE that would purge
//                   records. Needs ReadCallLog on the RingCentral app record.
//
// message-sync (incremental SMS sync with a sync token) is the eventual upgrade
// for the inbox poll, but it is deliberately NOT allowlisted yet: nothing calls
// it, and this proxy should only ever expose paths in use.
export const ALLOWED_PATH =
  /^\/restapi\/v1\.0\/account\/[^/]+\/extension\/[^/]+\/(message-store|sms|ring-out|call-log)(\/|\?|$)/;

/** Is this RingCentral REST path one the SPA is allowed to reach? */
export function pathAllowed(rcPath) {
  return ALLOWED_PATH.test(String(rcPath || "").split("?")[0]);
}

/**
 * May the proxy fetch this absolute URL on the caller's behalf?
 *
 * This is the SSRF boundary for /rc/fetch: the caller supplies the URL, so it
 * is pinned to https, to a ringcentral.com host, and to the two content paths
 * that actually carry media. Anything else — another RC endpoint, another host
 * — is refused rather than handed the bearer token.
 *
 * ⚠️ The two media shapes differ in their TAIL: a fax attachment ends
 * /content/{attachmentId} while a recording ends at /content. Reusing the fax
 * pattern (which requires the trailing segment) silently 403s every recording.
 */
export function fetchUrlAllowed(raw) {
  let u;
  try {
    u = raw instanceof URL ? raw : new URL(String(raw || ""));
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (!/(^|\.)ringcentral\.com$/.test(u.hostname)) return false;
  return (
    /\/message-store\/\d+\/content\//.test(u.pathname) ||
    /\/recording\/\d+\/content\/?$/.test(u.pathname)
  );
}
