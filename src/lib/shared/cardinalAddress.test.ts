/**
 * Parity suite for the Cardinal address format check.
 *
 * ⚠️ These cases are ported case-for-case from the ordering service's own
 * suite — `Cardinal-api/test/transform.test.js` — because this module is a
 * MIRROR of `Cardinal-api/src/address.js`. If a case here is changed without
 * the same change landing there (or vice versa), the Command Center starts
 * telling reps something the order pipeline does not agree with, which is
 * worse than not checking at all. The last block adds the real board shapes
 * found in the 2026-08-18 audit, rewritten as synthetic addresses (no PHI).
 */
import { describe, it, expect } from "vitest";

import {
  checkCardinalAddress,
  cardinalAddressHardReason,
  cardinalAddressNote,
  CARDINAL_FORMAT_HINT,
  type CardinalIssueCode,
} from "./cardinalAddress";

const codes = (addr: string): CardinalIssueCode[] =>
  checkCardinalAddress(addr).issues.map((i) => i.code);

describe("checkCardinalAddress — accepts the preset", () => {
  it("plain street, city, state ZIP", () => {
    const r = checkCardinalAddress("8530 144th Street, Jamaica, NY 11435, USA");
    expect(r.hard).toBe(false);
    expect(r.city).toBe("JAMAICA");
    expect(r.address1).toBe("8530 144TH STREET");
  });

  it("comma before the ZIP still finds the state", () => {
    const r = checkCardinalAddress("1305 York Ave, New York, NY, 10021-5663");
    expect(r.hard).toBe(false);
    expect(r.state).toBe("NY");
    expect(r.zip).toBe("10021");
    expect(r.zip4).toBe("5663");
    expect(r.city).toBe("NEW YORK");
  });

  it("spelled-out state resolves to the 2-letter code", () => {
    expect(checkCardinalAddress("1889 Old York Rd, Chester, South Carolina 29706").state).toBe("SC");
  });

  it("a spelled state ending in another state's abbreviation is not mis-split", () => {
    // VirginIA / AlabaMA / ConnecticUT — the tail is not a standalone abbr.
    expect(checkCardinalAddress("68 Hinton Ct apt 8, Martinsburg, West Virginia 25404, United States").state).toBe("WV");
    expect(checkCardinalAddress("910 Brookhill Dr, Killen, Alabama 35645, United States").city).toBe("KILLEN");
    expect(checkCardinalAddress("41 Beaver St apt 316, New Britain, Connecticut 06051, United States").state).toBe("CT");
  });

  it("apartment in its own segment lands on line 2, verbatim", () => {
    const r = checkCardinalAddress("115 EAST 87TH STREET, APARTMENT 12A, NEW YORK, NY 10128");
    expect(r.address1).toBe("115 EAST 87TH STREET");
    expect(r.address2).toBe("APARTMENT 12A"); // never abbreviated to "APT 12A"
    expect(r.hard).toBe(false);
  });

  it("a unit glued to the street stays on line 1 (faithful, no split)", () => {
    const r = checkCardinalAddress("254 Brick Boulevard suite 8, Brick, NJ 08723, USA");
    expect(r.address1).toBe("254 BRICK BOULEVARD SUITE 8");
    expect(r.address2).toBe("");
    expect(r.hard).toBe(false);
  });

  it('"USA" wedged between the state and the ZIP still parses', () => {
    const r = checkCardinalAddress("900 South Avenue suite 103, Staten Island, NY, USA 10314");
    expect(r.hard).toBe(false);
    expect(r.zip).toBe("10314");
    expect(r.city).toBe("STATEN ISLAND");
  });

  it('"The Bronx" (and the board typo "The Brox") normalize to BRONX', () => {
    expect(checkCardinalAddress("1 Grand Concourse, The Bronx, NY 10451").city).toBe("BRONX");
    expect(checkCardinalAddress("1 Grand Concourse, The Brox, NY 10451").city).toBe("BRONX");
  });
});

describe("checkCardinalAddress — the hard gates (Cardinal will NOT send these)", () => {
  const hard = (addr: string, code: CardinalIssueCode) => {
    const r = checkCardinalAddress(addr);
    expect(r.hard).toBe(true);
    expect(r.issues.some((i) => i.code === code && i.hard)).toBe(true);
    expect(cardinalAddressHardReason(r)).not.toBe("");
  };

  it("empty", () => hard("", "EMPTY"));
  it("no ZIP", () => hard("1251 U.S. 22, Bridgewater, NJ, USA", "MISSING_ZIP"));
  it("no ZIP (short form)", () => hard("49 Hamilton Avenue, Auburn, NY", "MISSING_ZIP"));
  it("no state", () => hard("49 Hamilton Avenue, Auburn, 13021", "MISSING_STATE"));
  it("no commas at all", () => hard("49 Hamilton Avenue Auburn NY 13021", "NOT_PRESET"));
  it("city glued to the street, no comma", () => hard("135 E 31st St New York, NY 10016", "NOT_PRESET"));
  it("street line has no house number", () =>
    hard("Historic District, 4 Tinys Way, Provincetown, MA 02657", "MISSING_STREET"));

  it("a soft issue raised before a hard one is still carried out with it", () => {
    const r = checkCardinalAddress("Historic District, 4 Tinys Way, Provincetown, MA 02657");
    expect(r.issues.some((i) => i.code === "EXTRA_SEGMENT" && !i.hard)).toBe(true);
    expect(r.issues.some((i) => i.code === "MISSING_STREET" && i.hard)).toBe(true);
  });

  it("never guesses a glued city — it asks for a comma", () => {
    const r = checkCardinalAddress("4 Vanderveer Dr Basking Ridge, NJ 07920");
    expect(r.hard).toBe(true);
    expect(r.city).toBe("");
    expect(cardinalAddressHardReason(r)).toContain("comma");
  });
});

describe("checkCardinalAddress — soft issues ship, but say so", () => {
  const soft = (addr: string, code: CardinalIssueCode) => {
    const r = checkCardinalAddress(addr);
    expect(r.hard).toBe(false);
    expect(r.issues.some((i) => i.code === code && !i.hard)).toBe(true);
  };

  it("C/O line rides on address 2 and warns (2026-07-30 downgrade)", () => {
    const r = checkCardinalAddress("49 Hamilton Avenue, C/O Natalie Dale, Auburn, NY 13021, US");
    expect(r.hard).toBe(false);
    expect(r.address2).toBe("C/O NATALIE DALE");
    expect(r.city).toBe("AUBURN"); // still the LAST segment
    expect(codes(r.raw)).toContain("EXTRA_SEGMENT");
  });

  it("an ambiguous extra place-name warns rather than blocking", () =>
    soft("534 Park St, Upper Montclair, Montclair, NJ 07043, USA", "EXTRA_SEGMENT"));

  it("PO Box in its own segment ships with a carrier warning", () => {
    const r = checkCardinalAddress("278 Main Street, PO Box 562, Richmondville, NY 12149, US");
    expect(r.hard).toBe(false);
    expect(r.address1).toBe("278 MAIN STREET"); // what the carrier actually delivers to
    expect(r.address2).toBe("PO BOX 562");
    expect(r.issues.find((i) => i.code === "PO_BOX")?.hard).toBe(false);
  });

  it("every PO Box spelling parses; the box number is required", () => {
    for (const seg of ["PO Box 562", "P.O. Box 562", "P O Box 562", "POB 562", "Box 562", "PMB 562", "PO Box #562", "RR 2 Box 15", "HC 1 Box 20"]) {
      const r = checkCardinalAddress(`278 Main Street, ${seg}, Richmondville, NY 12149`);
      expect(r.hard, `${seg} should parse`).toBe(false);
      expect(r.address2).toBe(seg.toUpperCase());
    }
    for (const seg of ["PO Box", "Route 9", "Upper Montclair"]) {
      const r = checkCardinalAddress(`278 Main Street, ${seg}, Richmondville, NY 12149`);
      expect(r.hard, `${seg} should not block`).toBe(false);
      expect(r.issues.some((i) => i.code === "EXTRA_SEGMENT" && !i.hard), `${seg} should still warn`).toBe(true);
    }
  });
});

describe("the city slot has to be a city — STRICTER THAN THE MIRROR", () => {
  // Reported by Josh 2026-08-18: `665 Saratoga Rd, Ste 400 Gansevoort, NY 12831`
  // was accepted. Upstream (Cardinal-api/src/address.js) parses it as city
  // "STE 400 GANSEVOORT" and ships it — no hard flag, no soft flag. These cases
  // are the ONE place this file deliberately says more than the mirror, so if a
  // future sync deletes the rule, these fail. Synthetic addresses, same shapes.

  it("a suite glued to the city is HARD, and the message shows the fix", () => {
    const r = checkCardinalAddress("800 Riverside Dr, Ste 210 Glenville, NY 12302");
    expect(r.hard).toBe(true);
    expect(codes(r.raw)).toContain("UNIT_IN_CITY");
    const reason = cardinalAddressHardReason(r);
    expect(reason).toContain("STE 210");
    // names what would actually be sent, and spells out the corrected address
    expect(reason).toContain("STE 210 GLENVILLE");
    expect(reason).toContain("800 Riverside Dr STE 210, Glenville, NY 12302");
  });

  it("catches every unit spelling glued to the city", () => {
    for (const seg of ["Apt 4B Brooklyn", "Suite 100 Albany", "Unit B Albany", "#5 Albany", "Fl 3 Albany", "Rm 12 Albany"]) {
      const r = checkCardinalAddress(`12 Main St, ${seg}, NY 12203`);
      expect(r.hard, `${seg} should be flagged`).toBe(true);
      expect(r.issues.some((i) => i.code === "UNIT_IN_CITY")).toBe(true);
    }
  });

  it("a city slot holding ONLY a unit means there is no city at all", () => {
    const r = checkCardinalAddress("800 Riverside Dr, Ste 210, NY 12302");
    expect(r.hard).toBe(true);
    expect(codes(r.raw)).toContain("MISSING_CITY");
    expect(cardinalAddressHardReason(r)).toContain("not a city");
  });

  it("the SAME address with the unit on the street line is clean — that is the fix", () => {
    const r = checkCardinalAddress("800 Riverside Dr Ste 210, Glenville, NY 12302");
    expect(r.hard).toBe(false);
    expect(r.issues).toEqual([]);
    expect(r.address1).toBe("800 RIVERSIDE DR STE 210");
    expect(r.city).toBe("GLENVILLE");
  });

  it("a unit in its OWN segment still parses — the mirror supports address 2", () => {
    const r = checkCardinalAddress("800 Riverside Dr, Ste 210, Glenville, NY 12302");
    expect(r.hard).toBe(false);
    expect(r.address2).toBe("STE 210");
    expect(r.city).toBe("GLENVILLE");
  });

  it("REAL two-word cities are never mistaken for a glued unit", () => {
    // Each of these contains a word from the unit vocabulary, or looks like one.
    for (const city of ["Upper Montclair", "Lower Manhattan", "Space Coast", "Floral Park", "Piermont", "Fort Lee", "Lots Creek", "Union City"]) {
      const r = checkCardinalAddress(`12 Main St, ${city}, NY 12203`);
      expect(r.hard, `${city} is a city, not a unit`).toBe(false);
      expect(r.city).toBe(city.toUpperCase());
    }
  });

  it("the taught format puts the unit on the street line", () => {
    expect(CARDINAL_FORMAT_HINT).toContain("ONE line");
    expect(CARDINAL_FORMAT_HINT).toContain("123 Main St Ste 400, Brooklyn, NY 11201");
    // and the example it teaches must itself pass
    expect(checkCardinalAddress("123 Main St Ste 400, Brooklyn, NY 11201").hard).toBe(false);
  });
});

describe("shapes seen on the live boards (2026-08-18 audit, synthetic rewrites)", () => {
  // Clinic addresses are the dominant failure: 46 hard on the Cardinal orders
  // board vs 6 patient. Every shape below came off a real row.
  it("clinic name in the street slot", () =>
    expect(codes("Presbyterian Physicians Care, 1 Park Rd Suite 200, Parkville, NY 11040")).toContain("MISSING_STREET"));
  it("city glued to the street on a clinic row", () =>
    expect(codes("123 E 34th St New York, NY 10016")).toContain("NOT_PRESET"));
  it("no ZIP on a clinic row", () =>
    expect(codes("500 Beach Ave, Great Neck, NY, US")).toContain("MISSING_ZIP"));
  it("unit glued with no city comma", () =>
    expect(codes("123 Ocean St Unit 4, NY 11235 US")).toContain("NOT_PRESET"));
  it("hyphenated Queens house numbers survive", () => {
    const r = checkCardinalAddress("85-30 144th St, Jamaica, NY 11435");
    expect(r.hard).toBe(false);
    expect(r.address1).toBe("85-30 144TH ST");
  });
});

describe("cardinalAddressNote — the inline note both stages render", () => {
  // Welcome Call and Final Confirm share this via components/shared/
  // CardinalAddressNote, so a rep gets the same words at both stages.

  it("says nothing about a blank address", () => {
    expect(cardinalAddressNote("")).toBeNull();
    expect(cardinalAddressNote("   ")).toBeNull();
  });

  it("says nothing about an address that parses cleanly", () => {
    expect(cardinalAddressNote("12 Cherry Ln, Albany, NY 12203")).toBeNull();
    expect(cardinalAddressNote("115 EAST 87TH STREET, APARTMENT 12A, NEW YORK, NY 10128")).toBeNull();
  });

  it("is RED with the reason and the required format when Cardinal would refuse it", () => {
    const n = cardinalAddressNote("135 E 31st St New York, NY 10016");
    expect(n?.tone).toBe("red");
    expect(n?.reason).toContain("comma");
    expect(n?.hint).toBe(CARDINAL_FORMAT_HINT);
    expect(n?.hint).toContain("ONE line");
  });

  it("covers the zip case the old Welcome Call regex used to own", () => {
    const n = cardinalAddressNote("49 Hamilton Avenue, Auburn, NY");
    expect(n?.tone).toBe("red");
    expect(n?.reason).toContain("ZIP");
  });

  it("is AMBER, with no format hint, for something that still ships", () => {
    const n = cardinalAddressNote("278 Main Street, PO Box 562, Richmondville, NY 12149, US");
    expect(n?.tone).toBe("amber");
    expect(n?.reason).toContain("PO Box");
    expect(n?.hint).toBeUndefined();
  });
});
