/**
 * lib/shared/cardinalAddress.ts — is an address in the format Cardinal Health
 * orders accept?
 *
 * ⚠️ THIS IS A MIRROR of the Cardinal ordering service's own parser —
 * `Cardinal-api/src/address.js` `normalizeAddress()` — so the Command Center
 * can tell a rep at Welcome Call / Final Profile Confirmation what the order
 * pipeline will say hours later, while the address is still editable and
 * somebody is on the phone. **Change one, change the other**, same drill as the
 * §5.9/§5.10 keep-in-agreement lists: a silent divergence is worse than no
 * check at all, because the rep gets a green page and the order still stops.
 *
 * ⚠️ **With ONE deliberate exception, and the direction of it matters.** This
 * copy is STRICTER by one rule — the city slot has to look like a city
 * (`isUnitOnlySegment` / `gluedUnitInCity` below). Upstream has no such check,
 * so it reads `665 Saratoga Rd, Ste 400 Gansevoort, NY 12831` as city
 * **"STE 400 GANSEVOORT"** and ships the parcel to a city that doesn't exist —
 * silently, no hard flag, no soft flag, nothing on the board (reported by Josh,
 * 2026-08-18; verified against the live parser).
 *
 * Diverging in THIS direction is safe: we flag something the service would
 * accept, so a rep fixes an address that would otherwise go out wrong. The
 * dangerous direction is the opposite — us passing what Cardinal refuses — and
 * that is what the keep-in-agreement rule protects. So: keep porting changes
 * from upstream, and do NOT delete this rule to make the two files match.
 * Upstream still has the bug; fixing it there would make this redundant, not
 * wrong.
 *
 * What Cardinal does with a bad address (Cardinal-api docs/ADDRESS_VALIDATION.md):
 *  - `hard` on the PATIENT or DOCTOR address ⇒ GATE 1 stops the order. It is
 *    never sent; the row is marked "Needs Review" on the orders board.
 *  - soft issues ship, but are surfaced on the board for a human to read.
 * The parse is deliberately faithful — it never abbreviates, reorders, guesses
 * a city, or repairs punctuation. Anything that does not fit the preset is
 * flagged for a person to reformat.
 *
 * The preset:   STREET [UNIT] , CITY , ST ZIP [, COUNTRY]
 * A unit in its OWN comma segment still parses (it becomes address line 2), but
 * reps are taught the one-line form — see CARDINAL_ADDRESS_FORMAT.
 *
 * Why the SPA needs its own copy rather than calling the service: the ordering
 * service reads the *orders* board (18405457690), which the patient only
 * reaches after Welcome Call → Subscription. There is nothing to call at Final
 * Confirm — the item does not exist downstream yet.
 *
 * Live audit that motivated this (2026-08-18, over the real boards):
 *   Welcome Call "Completed"      248 rows — patient 15 hard · clinic 27 hard, 23 blank
 *   Cardinal orders board        1151 rows — patient  6 hard · doctor 46 hard, 15 blank
 * i.e. the CLINIC address is the dominant failure and was checked nowhere.
 */

export type CardinalIssueCode =
  | "EMPTY"
  | "MISSING_ZIP"
  | "MISSING_STATE"
  | "NOT_PRESET"
  | "MISSING_STREET"
  | "MISSING_CITY"
  | "UNIT_IN_CITY"
  | "EXTRA_SEGMENT"
  | "PO_BOX";

export interface CardinalAddressIssue {
  code: CardinalIssueCode;
  /** true = Cardinal blocks the order on this; false = it ships with a flag. */
  hard: boolean;
  /** Rep-facing sentence, no field-name prefix — callers add their own. */
  message: string;
}

export interface CardinalAddressResult {
  ok: boolean;
  hard: boolean;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  zip4: string;
  issues: CardinalAddressIssue[];
  raw: string;
}

/**
 * What to show a rep who has to fix one. Keep in step with the parser above.
 *
 * ⚠️ **Apt/Suite goes on the STREET line, not on its own** (Josh, 2026-08-18).
 * The parser accepts a unit as its own comma segment too (it rides on address
 * line 2), but telling reps that invites the exact typo this format exists to
 * stop: a comma after the street and none after the unit, which glues the
 * suite onto the CITY. One line for everything before the city is the shape
 * with no ambiguous middle at all.
 */
export const CARDINAL_ADDRESS_FORMAT = "Street + Apt/Suite on ONE line, City, ST ZIP";
export const CARDINAL_ADDRESS_EXAMPLE = "123 Main St Ste 400, Brooklyn, NY 11201";
/**
 * The one wording of the required format, so every place that shows it says the
 * same thing: the Final Confirm check pack (C25/C26 `formatHint`, which the
 * findings panel and the send dialog render), and `CardinalAddressNote`, the
 * inline note under the address inputs on Final Confirm AND Welcome Call.
 */
export const CARDINAL_FORMAT_HINT = `Cardinal format: ${CARDINAL_ADDRESS_FORMAT} — e.g. ${CARDINAL_ADDRESS_EXAMPLE}`;

/* ── Ported verbatim from Cardinal-api/src/address.js ── */

const STATE_NAMES: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",
  HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA",
  KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS",
  MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI",
  WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC", "PUERTO RICO": "PR",
};
const STATE_ABBRS = new Set(Object.values(STATE_NAMES));

/**
 * A PO Box / private mailbox / rural-route box as its OWN comma segment. Kept
 * separate from a unit: a PO Box is not a unit within a building, and parcel
 * carriers (how Cardinal ships) cannot deliver to one. The box NUMBER is
 * required — a bare "PO Box" is incomplete and still gets flagged.
 */
function isPoBoxSegment(seg: string): boolean {
  const s = String(seg || "").trim().toUpperCase();
  return (
    /^(P\.?\s*O\.?\s*BOX|POB|BOX|PMB)\s*#?\s*\d+[A-Z]?$/.test(s) ||
    /^(RR|HC|RFD)\s*#?\s*\d+(\s*,?\s*BOX\s*#?\s*\d+[A-Z]?)?$/.test(s)
  );
}

/** Is a comma segment a recognizable apartment/unit (vs a place-name we must not guess about)? */
function isUnitSegment(seg: string): boolean {
  const s = String(seg || "").trim().toUpperCase();
  if (!s) return false;
  if (s.startsWith("#")) return true;
  if (/\b(APT|APARTMENT|UNIT|STE|SUITE|FL|FLR|FLOOR|RM|ROOM|BLDG|BSMT|BASEMENT|PH|PENTHOUSE|LOT|SPC|SPACE|TRLR|DEPT|HANGAR|SLIP|PIER)\b/.test(s)) return true;
  if (/^[A-Z]?\d+[A-Z]?$/.test(s)) return true; // 12, 2A, 12B, B2
  if (/^[A-Z]$/.test(s)) return true; // A
  if (/^\d+[A-Z]{1,3}$/.test(s)) return true; // 1FL, 2D, 3RD
  if (/^(FRONT|REAR|UPPER|LOWER)$/.test(s)) return true;
  return false;
}

/**
 * Unit designators, longest-first so the alternation can't match a prefix of a
 * longer word ("FL" inside "FLOOR"). Same vocabulary as `isUnitSegment`.
 */
const UNIT_WORDS = "APARTMENT|BASEMENT|PENTHOUSE|APT|UNIT|SUITE|STE|FLOOR|FLR|FL|ROOM|RM|BLDG|BSMT|PH|LOT|SPACE|SPC|TRLR|DEPT|HANGAR|SLIP|PIER";
/** A unit identifier: contains a digit ("400", "4B", "12-A") or is a lone letter ("B"). */
const UNIT_ID = "(?:[A-Z0-9-]*[0-9][A-Z0-9-]*|[A-Z])";

/**
 * Is this segment a unit and NOTHING else — `Ste 400`, `#5`, `2A`?
 *
 * Anchored on purpose. `isUnitSegment` is a loose `\b` word match, which is
 * right where it is used (a MIDDLE segment: "does this look like a unit, or an
 * extra place-name we must not guess about") and wrong for the city slot, where
 * it reads the real city "Space Coast" as a unit because SPACE is in the
 * vocabulary. The identifier rule does the rest of the work: a unit carries a
 * digit or is a lone letter, so `Space Coast` has nothing to match.
 */
function isUnitOnlySegment(seg: string): boolean {
  const t = String(seg || "").trim().toUpperCase();
  if (!t) return false;
  if (new RegExp(`^(?:${UNIT_WORDS})\\.?\\s*#?\\s*${UNIT_ID}$`).test(t)) return true;
  if (new RegExp(`^#\\s*${UNIT_ID}$`).test(t)) return true;
  if (/^[A-Z]?\d+[A-Z]?$/.test(t)) return true; // 12, 2A, 12B, B2
  if (/^[A-Z]$/.test(t)) return true;            // A
  return false;
}

/**
 * Is the CITY segment actually "<unit> <city>" — e.g. `Ste 400 Gansevoort`?
 * Returns the unit part, or "".
 *
 * ⚠️ **STRICTER THAN THE MIRROR — deliberate, do not "resync" it away.**
 * `Cardinal-api/src/address.js` has no equivalent check, so it parses
 * `665 Saratoga Rd, Ste 400 Gansevoort, NY 12831` as **city
 * "STE 400 GANSEVOORT"**, ships it, and the parcel goes out addressed to a city
 * that does not exist — no hard flag, no soft flag, nothing on the board. It is
 * the same silent-wrong-city class as the county-as-city bug that repo's
 * `docs/ADDRESS_VALIDATION.md` records fixing (26 of 101 records).
 *
 * Divergence in THIS direction is the safe one: we flag something the service
 * would accept, so a rep fixes an address that would otherwise ship wrong. The
 * dangerous direction — us passing something Cardinal refuses — is what §5.17's
 * keep-in-agreement rule is about, and this doesn't do that. If the upstream
 * parser ever grows the same rule, delete nothing; just re-check the wording.
 *
 * The identifier has to carry a digit or be a lone letter, which is what keeps
 * real two-word cities out of it: `Upper Montclair` and `Space Coast` have no
 * unit id to match, and the designator must be a whole token, so `Floral Park`
 * is not read as `FL oral Park`.
 */
function gluedUnitInCity(seg: string): string {
  const s = String(seg || "").trim().toUpperCase();
  const keyword = s.match(new RegExp(`^(?:${UNIT_WORDS})\\.?\\s+#?\\s*${UNIT_ID}(?=\\s+\\S)`));
  if (keyword) return keyword[0].trim();
  const hash = s.match(new RegExp(`^#\\s*${UNIT_ID}(?=\\s+\\S)`));
  if (hash) return hash[0].trim();
  return "";
}

/**
 * Parse an address exactly the way the Cardinal order pipeline will.
 * Never throws. A `hard` result is an order-blocking format problem.
 */
export function checkCardinalAddress(text: string): CardinalAddressResult {
  const issues: CardinalAddressIssue[] = [];
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const flag = (code: CardinalIssueCode, message: string): CardinalAddressResult => {
    issues.push({ code, message, hard: true });
    return { ok: false, hard: true, address1: "", address2: "", city: "", state: "", zip: "", zip4: "", issues, raw };
  };
  if (!raw) return flag("EMPTY", "The address is empty.");

  // Strip a country token at the end OR wedged just before the ZIP ("..., NJ, USA 07950").
  const stripCountryEnd = (x: string) =>
    x.replace(/[,\s]+(USA|US|UNITED STATES(?: OF AMERICA)?|U\.?\s?S\.?\s?A?\.?)\s*$/i, "").trim();
  const t = stripCountryEnd(raw);

  // ZIP at the very end.
  const zm = t.match(/(\d{5})(?:-(\d{4}))?\s*$/);
  if (!zm) return flag("MISSING_ZIP", "No 5-digit ZIP code at the end of the address.");
  const zip = zm[1];
  const zip4 = zm[2] || "";
  let before = stripCountryEnd(t.slice(0, zm.index).replace(/[,\s]+$/, "").trim());

  // STATE immediately before the ZIP: 2-letter abbreviation, else a spelled-out state name.
  let state = "";
  // Standalone 2-letter only — not the tail of a spelled state ("VirginIA", "AlabaMA").
  const m2 = before.match(/(?:^|[\s,])([A-Za-z]{2})\s*$/);
  if (m2 && STATE_ABBRS.has(m2[1].toUpperCase())) {
    state = m2[1].toUpperCase();
    before = before.slice(0, m2.index).replace(/[,\s]+$/, "").trim();
  } else {
    for (const name of Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length)) {
      const re = new RegExp("(?:^|[,\\s])" + name.replace(/ /g, "\\s+") + "$", "i");
      if (re.test(before)) {
        state = STATE_NAMES[name];
        before = before.replace(re, "").replace(/[,\s]+$/, "").trim();
        break;
      }
    }
  }
  if (!state) return flag("MISSING_STATE", "No state between the city and the ZIP code.");

  // FRONT must be comma-delimited: STREET , [UNIT ,] CITY.
  const segs = before.split(",").map((x) => x.trim()).filter(Boolean);
  if (segs.length < 2) {
    return flag(
      "NOT_PRESET",
      `The city is not separated by a comma — it needs to read "Street, City, ${state} ${zip}".`,
    );
  }
  const street = segs[0];
  const cityRaw = segs[segs.length - 1];
  const middles = segs.slice(1, -1);

  // A middle segment that is not a recognizable unit or PO Box — usually a valid
  // second address line ("C/O Natalie Dale", a building name), occasionally a
  // genuinely ambiguous extra place-name. NON-BLOCKING since 2026-07-30 (Josh):
  // flag it, ship it. The parse below is the right one for the common case —
  // the segment rides on address line 2 verbatim and the city is still last.
  const ambiguous = middles.find((m) => !isUnitSegment(m) && !isPoBoxSegment(m));
  if (ambiguous) {
    issues.push({
      code: "EXTRA_SEGMENT",
      hard: false,
      message: `"${ambiguous}" sits between the street and the city and is not a recognizable apt/unit — it will be sent as address line 2. Check the mailing city and unit.`,
    });
  }

  // The street must carry a house number (or be a PO Box / rural route).
  if (!/\d/.test(street) && !/^(P\.?\s?O\.?\s*BOX|BOX|RR|HC|RFD|ROUTE|RT)\b/i.test(street)) {
    return flag("MISSING_STREET", `The first line ("${street}") has no house number — a clinic or building name cannot be the street line.`);
  }

  const address1 = street.toUpperCase();
  const address2 = middles.join(", ").toUpperCase();
  let city = cityRaw.toUpperCase();
  // City rule (Josh 2026-07-07): "The Bronx" — and the observed board typo
  // "The Brox" — becomes the USPS-preferred "BRONX". Whole value only.
  if (/^THE\s+BRON?X$/.test(city)) city = "BRONX";
  if (!city || /^\d+$/.test(city) || /\d{5}/.test(city)) {
    return flag("MISSING_CITY", "The city is missing or unreadable.");
  }
  // Both of these are STRICTER THAN THE MIRROR — see gluedUnitInCity above.
  // The city slot holding a unit and nothing else ("…, Ste 400, NY 12831")
  // means there is no city at all; upstream this parses as city "STE 400".
  if (isUnitOnlySegment(cityRaw)) {
    return flag("MISSING_CITY", `There is no city — "${cityRaw}" is a unit, not a city.`);
  }
  const gluedUnit = gluedUnitInCity(cityRaw);
  if (gluedUnit) {
    return flag(
      "UNIT_IN_CITY",
      `"${gluedUnit}" is stuck to the city, so the city would be sent as "${city}". Move it onto the street line: "${street} ${gluedUnit}, ${cityRaw.slice(gluedUnit.length).trim()}, ${state} ${zip}".`,
    );
  }

  const poBox = [street, ...middles].find(isPoBoxSegment);
  if (poBox) {
    issues.push({
      code: "PO_BOX",
      hard: false,
      message: `Contains a PO Box ("${poBox.toUpperCase()}") — UPS/FedEx cannot deliver to a PO Box. Confirm the street line or ship USPS.`,
    });
  }

  return { ok: true, hard: false, address1, address2, city, state, zip, zip4, issues, raw };
}

/** The one blocking reason, or "" when the address parses. */
export function cardinalAddressHardReason(r: CardinalAddressResult): string {
  const first = r.issues.find((i) => i.hard);
  return first ? first.message : "";
}

/** The non-blocking notes, in parse order. */
export function cardinalAddressWarnings(r: CardinalAddressResult): string[] {
  return r.issues.filter((i) => !i.hard).map((i) => i.message);
}

export interface CardinalAddressNoteData {
  /** red = Cardinal will refuse the order; amber = it ships, but read this. */
  tone: "red" | "amber";
  reason: string;
  /** Only on a red note — the shape it has to be retyped in. */
  hint?: string;
}

/**
 * The one-line verdict for an address input, or null when there is nothing to
 * say (blank, or it parses cleanly).
 *
 * Deliberately SILENT on a blank value: a rep who has not typed an address yet
 * is not making a mistake, and both pages already mark a missing address their
 * own way — Welcome Call prints "No address on file" and blocks the send,
 * Final Confirm rings the field red and raises `C25_ADDRESS_MISSING`.
 */
export function cardinalAddressNote(text: string): CardinalAddressNoteData | null {
  if (!(text || "").trim()) return null;
  const r = checkCardinalAddress(text);
  if (r.hard) return { tone: "red", reason: cardinalAddressHardReason(r), hint: CARDINAL_FORMAT_HINT };
  const warnings = cardinalAddressWarnings(r);
  if (warnings.length) return { tone: "amber", reason: warnings.join(" ") };
  return null;
}
