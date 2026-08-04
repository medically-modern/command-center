/**
 * Phone normalization + keyed hashing for the assignment store.
 *
 * Kept separate from assignments.mjs (which pulls in `pg`) so these pure
 * functions can be unit-tested without a database driver — same split as
 * columns.mjs.
 *
 * ── Why hashed ──────────────────────────────────────────────────────────────
 * A phone number tied to a patient IS PHI (one of HIPAA's 18 identifiers). The
 * assignments table stores HMAC-SHA256(pepper, E.164) instead of the number, so
 * it holds nothing patient-identifying: everything human-readable is resolved
 * from Monday at render time.
 *
 * ⚠️ The pepper is load-bearing, not decoration. A bare SHA-256 of a 10-digit
 * number is brute-forceable in seconds (~10^10 candidates), so this MUST be an
 * HMAC with a server-side secret. Callers check `hashingConfigured()` and 503
 * rather than falling back to an unpeppered digest.
 */
import crypto from "node:crypto";

export function hashingConfigured() {
  return !!process.env.PHONE_HMAC_PEPPER;
}

/**
 * Digits → E.164.
 *
 * ⚠️ Must run BEFORE hashing. If the same patient normalizes differently
 * depending on how their number was typed — "(347) 503-7148" vs "3475037148" —
 * they hash differently, their assignment silently stops matching, and their
 * conversation vanishes from the rep's inbox with no error anywhere.
 */
export function toE164(raw) {
  const t = String(raw ?? "").trim();
  const d = t.replace(/[^0-9]/g, "");
  // US/NANP, the only shape we can infer a country code for.
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  // Already-international input is trusted only if it is a plausible E.164
  // length (ITU caps country+national digits at 15).
  if (t.startsWith("+") && d.length >= 11 && d.length <= 15) return "+" + d;
  // WARN: anything else is UNUSABLE - return empty rather than guessing.
  // This used to fall through to "+" + digits, fabricating a valid-LOOKING
  // number from partial data: a short Monday value became "+310213829", which
  // RingCentral parsed as a Netherlands number and rejected on send, and which
  // matched no conversation on read, so the thread looked empty. A number we
  // cannot normalise must be reported as MISSING, not invented.
  return "";
}

/** Keyed hash of a phone number, or "" when the number is unusable. */
export function phoneHmac(raw) {
  const e164 = toE164(raw);
  if (!e164) return "";
  return crypto.createHmac("sha256", process.env.PHONE_HMAC_PEPPER).update(e164).digest("hex");
}
