/**
 * The address a BENEFITS CHECK hands back, turned into the shape we actually
 * ship to — and, where it can't be, the reason why (Brandon, 2026-08-19).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The intake form never asks for an address (CLAUDE.md §5.10), so for a DTC /
 * CareCentrix patient the benefits check is usually the FIRST place one appears:
 * `UnverifiedReferralsPage` pours Stedi's `stediAddress` into the empty Address
 * field. That address is the payer's mailing line, not a picked-from-suggestions
 * one, and it arrives in two shapes the app had nothing to say about:
 *
 *   1. the apt/suite as its OWN comma segment —
 *      `9 BRENTWOOD RD, APT 6 A, BAY SHORE, NY 11706` — which is NOT the preset
 *      reps are taught (§5.17: "Street + Apt/Suite on ONE line, City, ST ZIP");
 *   2. a genuinely odd middle segment — `20 Thornton Ave, C/O Julie Vanfleet,
 *      Auburn, NY 13021` — a PO box, a clinic name with no house number, …
 *
 * Neither tripped a single check. `addressWarning` accepts three-or-more comma
 * segments, and `checkCardinalAddress` accepts a unit on address line 2. So the
 * page filled in an address, said nothing, and the rep had no signal that this
 * one had never been confirmed with anybody.
 *
 * Measured over the 22 Stedi addresses on the live Profile Send Off board
 * (2026-08-19): 7 carried an extra middle segment, and **not one** of the 22
 * raised a warning of any kind.
 *
 * ── What this module does ────────────────────────────────────────────────────
 * Brandon asked for either — "have it match the format, or prompt the user to
 * click the suggested address". It does both, in that order, because they solve
 * different halves:
 *
 *   `foldUnitOntoStreet`  FIXES case 1 with no judgement call. The segment is a
 *                         recognisable unit, so where it belongs is not a guess;
 *                         it moves onto the street line and the address is in
 *                         the preset. Deterministic, and it never reorders,
 *                         abbreviates or invents anything — the same discipline
 *                         `cardinalAddress` holds itself to.
 *   `addressFormatIssue`  FLAGS everything left, including case 2, in the words
 *                         of the app's own formatting guidelines, and tells the
 *                         rep to re-pick from the address suggestions.
 *
 * ⚠️ **This is a WARNING layer, not a gate.** The intake stage's exits stay open
 * by design (§5.10 — a blocking address row would stop literally every patient,
 * and reps would learn to ignore the checklist). It is also intake-only: it
 * deliberately does NOT change `addressWarning`, which Profile Send Off uses as
 * a readiness BLOCKER, so nothing here can strand a patient on another page.
 */
import { addressWarning } from "./workflow";
import {
  CARDINAL_FORMAT_HINT,
  cardinalAddressHardReason,
  cardinalAddressWarnings,
  checkCardinalAddress,
  isUnitSegment,
} from "@/lib/shared/cardinalAddress";

/** Places appends this when it falls back to `formatted_address`. */
const COUNTRY_TAIL = /^(?:USA|U\.S\.A\.|US|United States)\.?$/i;

/** `NY 11706` — the state+zip segment that ends a canonical address. */
const STATE_ZIP = /^[A-Za-z]{2}\s+\d{5}(?:-\d{4})?$/;

function splitSegments(address: string): string[] {
  return address.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Move an apt/suite that arrived as its own comma segment onto the street line.
 *
 *   `9 Brentwood Rd, Apt 6 A, Bay Shore, NY 11706`
 *       → `9 Brentwood Rd Apt 6 A, Bay Shore, NY 11706`
 *
 * Returns the input UNCHANGED whenever the address isn't one we fully
 * understand — no state+zip tail, fewer than four segments, or a middle segment
 * that isn't a recognisable unit (`C/O Julie Vanfleet` is somebody's name, and
 * guessing where a name belongs is exactly the class of repair the Cardinal
 * parser refuses to make). Those cases are the flag's job, not this one's.
 */
export function foldUnitOntoStreet(address: string): string {
  const raw = (address ?? "").trim();
  if (!raw) return address ?? "";

  const segments = splitSegments(raw);
  // A trailing country rides along untouched — it isn't part of the shape.
  const country = segments.length && COUNTRY_TAIL.test(segments[segments.length - 1])
    ? segments.pop()
    : undefined;

  // street, [middles…], city, ST ZIP — anything shorter has no middle to fold.
  if (segments.length < 4) return raw;
  if (!STATE_ZIP.test(segments[segments.length - 1])) return raw;

  const middles = segments.slice(1, segments.length - 2);
  if (!middles.every(isUnitSegment)) return raw;

  const folded = [
    [segments[0], ...middles].join(" "),
    segments[segments.length - 2],
    segments[segments.length - 1],
    ...(country ? [country] : []),
  ];
  return folded.join(", ");
}

/**
 * The rep-facing reason this address isn't in the format we ship to, or
 * `undefined` when it's fine. Blank is fine here — "there is no address" is a
 * different message, and the page says it separately.
 *
 * Layered most-specific-first, and every layer is an EXISTING rule rather than a
 * new opinion:
 *   1. `addressWarning` — zip shape, `Street, City, ST 12345`, ALL-CAPS. The
 *      rule Profile Send Off already applies, word for word.
 *   2. Cardinal HARD — the order-blocking cases (§5.17): no house number, no
 *      city, a unit glued to the city. Carries the required format with it,
 *      because a complaint without the shape is half a message.
 *   3. Cardinal SOFT — ships, but says so: an unrecognised middle segment
 *      (usually a `C/O`), a PO box no parcel carrier can deliver to.
 */
export function addressFormatIssue(address: string): string | undefined {
  const a = (address ?? "").trim();
  if (!a) return undefined;

  const warning = addressWarning(a);
  if (warning) return warning;

  const result = checkCardinalAddress(a);
  if (result.hard) return `${cardinalAddressHardReason(result)} ${CARDINAL_FORMAT_HINT}`;

  const soft = cardinalAddressWarnings(result);
  if (soft.length) return `${soft[0]} ${CARDINAL_FORMAT_HINT}`;

  return undefined;
}

/** Case, spacing and punctuation removed, so two renderings of the same line
 *  compare equal. Only ever used to answer "is this still the value the
 *  benefits check put here", never to decide what gets written. */
function comparable(address: string): string {
  return (address ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/**
 * Is the address in the box still the one the benefits check supplied?
 *
 * Compared after the same normalisation the page applies on fill, so the answer
 * doesn't flip just because the value was title-cased or the unit was folded.
 * The page ANDs this with "no map pin", which is what a Places pick always sets
 * and the benefits-check fill deliberately never does — so re-picking the
 * address from the suggestions is what clears the prompt.
 */
export function isBenefitsCheckAddress(
  patientAddress: string | null | undefined,
  stediAddress: string | null | undefined,
  normalize: (s: string) => string = (s) => s,
): boolean {
  const on = comparable(patientAddress ?? "");
  const from = comparable(normalize((stediAddress ?? "").trim()));
  return !!on && !!from && on === from;
}
