/**
 * A US state, as the two-letter postal code a coordinator reads at a glance.
 *
 * Brandon, 2026-09-24 (Masani dashboard notes): *"the row below the name it
 * should say 'State: NY; Doctor: …' — State info comes directly from the form
 * they filled out and if for whatever reason we don't have it, just have it say
 * N/A"*. Josh, same day, for the Welcome Call column (which has no State
 * column at all): read it out of the patient's address.
 *
 * ## Two inputs, two readers, one table
 *
 *  · `stateCode` — the DTC web form's free-text **State** `text_mm5zc4vy`.
 *    Measured on the live board 2026-09-24 over the 106 rows that carry one:
 *    full names ("Florida"), lower-case names ("maryland"), codes ("AZ", "FL",
 *    "WY"), and a handful of things that are neither ("Newyork 10950",
 *    "Ontario"). The form writes the code at item creation and a full name on a
 *    later step (Ann Hawkins: `WA` → `Washington`), so both shapes are the
 *    same patient's answer and must read the same.
 *  · `stateFromAddress` — a monday location column's text. Measured over 300
 *    Welcome Call rows the same day: overwhelmingly Google-formatted
 *    (`…, NY 12345, US` / `USA` / `United States`), with rep-typed variants
 *    (`…, NY, USA`, `…, TX, 77001`, `…, Jamestown New York, 14701`).
 *
 * ⚠️ **An unrecognised value is shown VERBATIM, never guessed at and never
 * dropped** (§5.20's `networkLabel` rule). "Ontario" is what the patient
 * typed; rendering N/A would claim they told us nothing, and rendering a
 * guessed code would claim something they did not say. Only a value that is
 * unambiguously one state — a code, a name, a name with the spaces or a zip
 * code stuck to it — is normalised.
 *
 * ⚠️ **The address reader only matches at the END of a segment.** A street is
 * full of state names ("123 Virginia Ave", "Washington St"), so a name found
 * anywhere would read a Brooklyn patient on Virginia Avenue as `VA`. The state
 * in a US address is the last thing before the zip and the country, and that
 * is the only place this looks.
 */

/** Name → USPS code. The 50 states, DC and Puerto Rico — the places a patient
 *  of ours can live. Military (AA/AE/AP) and the smaller territories are left
 *  out on purpose: a code nobody here ships to is more likely a typo. */
const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC", "washington dc": "DC", "washington d.c.": "DC",
  "puerto rico": "PR",
};

const CODES = new Set(Object.values(STATES));

/** "new york" and "newyork" are one key — the form has produced the second. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

const BY_SQUASHED: Record<string, string> = Object.fromEntries(
  Object.entries(STATES).map(([name, code]) => [squash(name), code]),
);

/** Names longest first, so "west virginia" is tried before "virginia" and
 *  "new mexico" never reads as a stray "mexico". */
const NAMES_LONGEST_FIRST = Object.keys(STATES).sort((a, b) => b.length - a.length);

const ZIP = /\d{5}(?:-\d{4})?/;
const COUNTRY = /^(us|usa|u\.s\.a?\.?|united states(?: of america)?)$/i;
const TRAILING_COUNTRY = /\s+(us|usa|u\.s\.a?\.?|united states(?: of america)?)$/i;

/** A two-letter postal code for a known place, or "". */
function asCode(raw: string): string {
  const c = raw.trim().toUpperCase();
  return c.length === 2 && CODES.has(c) ? c : "";
}

/** A full state name, however it is cased or spaced, or "". */
function asName(raw: string): string {
  return BY_SQUASHED[squash(raw)] ?? "";
}

/**
 * The form's State answer, as a code — or the answer itself when it names no
 * US state we recognise, or "" when there is no answer at all.
 *
 * The caller renders "" as N/A.
 */
export function stateCode(raw: string | null | undefined): string {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  const code = asCode(v) || asName(v);
  if (code) return code;
  // A zip code typed after the state ("Newyork 10950", "NY 10950") is still
  // one state. Anything else stays exactly as the patient wrote it.
  const withoutZip = v.replace(new RegExp(`[\\s,]*${ZIP.source}$`), "").trim();
  if (withoutZip && withoutZip !== v) {
    const c = asCode(withoutZip) || asName(withoutZip);
    if (c) return c;
  }
  return v;
}

/**
 * The state out of a free-form US address, or "" when it cannot be read with
 * certainty.
 *
 * Walks the comma segments from the END, skipping a country and a bare zip,
 * and stops at the first segment that is not one of those: that segment is
 * either the state (or ends with it) or the address carries no state we can
 * read. Never looks further in — see the header on street names.
 */
export function stateFromAddress(raw: string | null | undefined): string {
  const segments = (raw ?? "")
    .split(",")
    // ⚠️ A country typed without a comma before it ("NY 11201 US", "NJ 07030
    // United States") is part of the state's segment, not a segment of its
    // own — four of the seven addresses the first cut could not read.
    .map((s) => s.replace(/\s+/g, " ").trim().replace(TRAILING_COUNTRY, "").trim())
    .filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (COUNTRY.test(seg)) continue;
    if (new RegExp(`^${ZIP.source}$`).test(seg)) continue;

    // "NY 12345" / "ny 12345" / "NY" — and "MO 6410", a zip with a digit
    // missing: a whole segment that is a real code followed by digits is the
    // state whatever the digits are.
    const codeZip = /^([A-Za-z]{2})(?:\s+\d[\d-]*)?$/.exec(seg);
    if (codeZip) return asCode(codeZip[1]);

    // "Olympia WA 98501", "…Bronx Ny 10451" — city and state with no comma
    // between them. ⚠️ Only with a full zip after it: a street line can END in
    // a two-letter token that happens to be a code ("123 Main St NE" is not
    // Nebraska), and the zip is what says this is the city-state-zip line.
    const cityCodeZip = new RegExp(`\\s([A-Za-z]{2})\\s+${ZIP.source}$`).exec(seg);
    if (cityCodeZip && asCode(cityCodeZip[1])) return asCode(cityCodeZip[1]);

    // "…Jamestown New York", "New York 14701", "Washington DC 20001".
    const lower = seg.toLowerCase().replace(new RegExp(`\\s*${ZIP.source}$`), "");
    for (const name of NAMES_LONGEST_FIRST) {
      if (lower === name || lower.endsWith(` ${name}`)) return STATES[name];
    }
    return "";
  }
  return "";
}

/** What the card prints after "State: ". */
export function stateLabel(code: string): string {
  return code.trim() || "N/A";
}
