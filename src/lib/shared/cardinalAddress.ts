/**
 * lib/shared/cardinalAddress.ts — is an address in the format Cardinal Health
 * orders accept?
 *
 * ⚠️ THIS IS A MIRROR, NOT A NEW RULE. It is a faithful port of the Cardinal
 * ordering service's own parser — `Cardinal-api/src/address.js`
 * `normalizeAddress()` — so the Command Center can tell a rep at Final Profile
 * Confirmation exactly what the order pipeline will say hours later, while the
 * address is still editable and (for the patient address) somebody is on the
 * phone. **Change one, change the other**, same drill as the §5.9/§5.10
 * keep-in-agreement lists: the whole point is that the two answers agree, and a
 * silent divergence here is worse than no check at all (the rep gets a green
 * page and the order still stops).
 *
 * What Cardinal does with a bad address (Cardinal-api docs/ADDRESS_VALIDATION.md):
 *  - `hard` on the PATIENT or DOCTOR address ⇒ GATE 1 stops the order. It is
 *    never sent; the row is marked "Needs Review" on the orders board.
 *  - soft issues ship, but are surfaced on the board for a human to read.
 * The parse is deliberately faithful — it never abbreviates, reorders, guesses
 * a city, or repairs punctuation. Anything that does not fit the preset is
 * flagged for a person to reformat.
 *
 * The preset:   STREET , [UNIT ,] CITY , ST ZIP [, COUNTRY]
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

/** What to show a rep who has to fix one. Keep in step with the parser above. */
export const CARDINAL_ADDRESS_FORMAT = "Street, [Apt/Unit,] City, ST ZIP";
export const CARDINAL_ADDRESS_EXAMPLE = "123 Main St, Apt 4B, Brooklyn, NY 11201";

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
