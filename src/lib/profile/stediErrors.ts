/**
 * stediErrors.ts — interpret the "Stedi Eligibility Error Description" column.
 *
 * The Stedi service writes plain-English X12 AAA reject descriptions (e.g.
 * "Unable to Respond at Current Time", "Invalid/Missing Subscriber/Insured ID")
 * plus its own pre-flight errors ("Missing required field: …"). Newer service
 * builds may prepend a canned recommendation, pipe-separated:
 *   "Incorrect information — verify … Stedi portal. | Missing required field: Member ID"
 * This module normalizes all of that into { code, description, solution }.
 *
 * Recommended solution is one of exactly two (per ops):
 *   • AAA 42 (payer connection error)  → try running the check again
 *   • everything else                  → incorrect information — check it, or
 *     run Insurance Discovery / the Eligibility Agent in the Stedi portal
 */

export interface StediErrorInfo {
  /** X12 AAA reject reason code when recognized (e.g. "42", "72"); null otherwise. */
  code: string | null;
  /** Cleaned error description (any canned solution prefix stripped). */
  description: string;
  /** Recommended next step for the rep. */
  solution: string;
  /** True only for AAA 42 — the payer connection failed; a retry may succeed. */
  isConnectionError: boolean;
}

export const SOLUTION_CONNECTION =
  "Connection error — try running the check again.";
export const SOLUTION_INCORRECT_INFO =
  "Incorrect information — check the patient's information, or try running Insurance Discovery / the Eligibility Agent in the Stedi portal.";

/** Known AAA reject descriptions → codes. Matched case-insensitively, most
 *  specific first (e.g. "Subscriber Found, Patient Not Found" before
 *  "Patient Not Found"). Source: X12 271 AAA request-validation codes. */
const AAA_BY_DESCRIPTION: [pattern: RegExp, code: string][] = [
  [/unable to respond at current time/i, "42"],
  [/no response received/i, "80"],
  [/authorization\/access restrictions/i, "41"],
  [/provider ineligible for inquiries/i, "50"],
  [/provider not on file/i, "51"],
  [/invalid\/missing provider id/i, "43"],
  [/invalid\/missing provider name/i, "44"],
  [/required application data missing/i, "15"],
  [/input errors/i, "33"],
  [/out of network/i, "35"],
  [/invalid\/missing date\(s\) of service/i, "57"],
  [/invalid\/missing date[- ]of[- ]birth/i, "58"],
  [/invalid\/missing patient id/i, "64"],
  [/invalid\/missing patient name/i, "65"],
  [/subscriber found, patient not found/i, "77"],
  [/patient not found/i, "67"],
  [/patient birth date does not match/i, "71"],
  [/invalid\/missing subscriber\/insured id/i, "72"],
  [/invalid\/missing subscriber\/insured name/i, "73"],
  [/invalid\/missing subscriber\/insured gender/i, "74"],
  [/subscriber\/insured not found/i, "75"],
  [/duplicate subscriber\/insured id/i, "76"],
  [/subscriber\/insured not in group\/plan/i, "78"],
  [/invalid participant identification/i, "79"],
];

/** True when a pipe-separated segment is a canned recommendation (the newer
 *  Stedi service prepends one) rather than the underlying error itself. */
function isSolutionSegment(seg: string): boolean {
  return /^(incorrect information|connection error)\b/i.test(seg.trim());
}

/** Interpret a raw error-description column value. Returns null for blank. */
export function interpretStediError(raw: string): StediErrorInfo | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;

  // Strip any canned solution segment(s) the service prepended.
  const segments = trimmed.split("|").map((s) => s.trim()).filter(Boolean);
  const errorSegments = segments.filter((s) => !isSolutionSegment(s));
  const description = (errorSegments.length ? errorSegments : segments).join(" | ");

  // Explicit code in the text ("AAA 42", "error 42", "(42)") wins…
  let code: string | null = null;
  const explicit = description.match(/\b(?:AAA|error(?: code)?|code)\s*[:#]?\s*(\d{2})\b/i);
  if (explicit) {
    code = explicit[1];
  } else {
    // …otherwise map the known description text to its AAA code.
    for (const [pattern, aaa] of AAA_BY_DESCRIPTION) {
      if (pattern.test(description)) { code = aaa; break; }
    }
  }

  const isConnectionError = code === "42";
  return {
    code,
    description,
    solution: isConnectionError ? SOLUTION_CONNECTION : SOLUTION_INCORRECT_INFO,
    isConnectionError,
  };
}
