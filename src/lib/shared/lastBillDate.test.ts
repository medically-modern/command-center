/**
 * The two Last Bill Date families — which one wins, and what must not regress.
 *
 * Fixtures are REAL Welcome Call board rows, read 2026-09-10, so these fail if
 * the resolution ever stops catching the thing Brandon reported.
 */
import { describe, it, expect } from "vitest";

import { resolveLastBill, resolveLastBillDates, formatLastBill } from "./lastBillDate";

describe("resolveLastBill", () => {
  it("uses the SoS column when the legacy one is blank — the reported bug", () => {
    // Tommy Cole (12854165138): CGM Sensors SoS Last Bill = 2025-03-14, legacy
    // Sensors Last Bill Date = "" because that product's SoS came back Clear.
    // The screen said "—" while the date sat one column over.
    expect(resolveLastBill("2025-03-14", "")).toBe("2025-03-14");
  });

  it("still uses the legacy column when the SoS one is blank", () => {
    // Dawn Plummer (12779955177): legacy 2026-04-12, SoS blank — a record
    // written before the SoS family existed. This direction is why the fix is
    // a FALLBACK and not a re-point: 13 live Welcome Call rows look like this,
    // and every one of them would have gone blank.
    expect(resolveLastBill("", "2026-04-12")).toBe("2026-04-12");
  });

  it("agrees with itself when both carry the same date", () => {
    // Czeslaw Musialowski (12702996506) — the ordinary "Not Clear" shape, where
    // both columns are written from the same rep answer. Every "both present"
    // pair in the live sample is identical, so the preference only breaks a tie.
    expect(resolveLastBill("2026-06-09", "2026-06-09")).toBe("2026-06-09");
  });

  it("prefers the SoS column when the two disagree", () => {
    // Not observed live, but the SoS column is rewritten on every Benefits send
    // for every billed product, while the legacy one is only maintained on the
    // Not-Clear path — so it is the one that self-corrects.
    expect(resolveLastBill("2026-08-31", "2024-01-01")).toBe("2026-08-31");
  });

  it("is blank only when both are", () => {
    expect(resolveLastBill("", "")).toBe("");
  });

  it("treats whitespace as blank in either column", () => {
    expect(resolveLastBill("  ", "2026-04-12")).toBe("2026-04-12");
    expect(resolveLastBill("2026-04-12", "  ")).toBe("2026-04-12");
  });
});

describe("resolveLastBillDates", () => {
  it("drops blanks, so an unbilled line reaches computeNextOrder as an empty list", () => {
    // `computeNextOrder([])` means "no billing history". Passing "" through
    // would make it look like a date the caller could parse.
    expect(resolveLastBillDates([{ sos: "", legacy: "" }])).toEqual([]);
  });

  it("keeps caller order for a two-column line", () => {
    // Mark Edelman (12998734620) — supplies only: BOTH SoS columns carry
    // 2026-03-18 and both legacy columns are blank, so the Supplies row had no
    // last bill date and no computed next order date at all.
    expect(
      resolveLastBillDates([
        { sos: "2026-03-18", legacy: "" },
        { sos: "2026-03-18", legacy: "" },
      ]),
    ).toEqual(["2026-03-18", "2026-03-18"]);
  });

  it("mixes the two families across one line without losing either", () => {
    // Sensors resolves from the SoS column, monitor from the legacy one.
    expect(
      resolveLastBillDates([
        { sos: "2026-05-26", legacy: "" },
        { sos: "", legacy: "2026-01-01" },
      ]),
    ).toEqual(["2026-05-26", "2026-01-01"]);
  });

  it("can only ever return MORE dates than the legacy family alone", () => {
    // The additive property is the whole safety argument: every legacy date
    // survives, and SoS dates are added. Pinned so a later "simplification"
    // to a single column has to argue with a failing test.
    const pairs = [
      { sos: "2025-03-14", legacy: "" },
      { sos: "", legacy: "2026-04-12" },
      { sos: "", legacy: "" },
    ];
    const legacyOnly = pairs.map((x) => x.legacy).filter(Boolean);
    const resolved = resolveLastBillDates(pairs);
    expect(resolved.length).toBeGreaterThan(legacyOnly.length);
    for (const d of legacyOnly) expect(resolved).toContain(d);
  });
});

describe("formatLastBill", () => {
  it("renders the board's naive-ET string as MM/DD/YYYY", () => {
    expect(formatLastBill("2024-01-01")).toBe("01/01/2024");
    expect(formatLastBill("2026-12-31")).toBe("12/31/2026");
  });

  /* ⚠️ The whole reason this is string surgery. A Date built from a naive
     board value in a non-ET runtime lands on the previous day, and the result
     reads as a real date rather than as a bug (CLAUDE.md §9). This test would
     fail on a `new Date(...).toLocaleDateString()` implementation under the
     UTC container CI runs in. */
  it("never shifts the day", () => {
    expect(formatLastBill("2024-03-01")).toBe("03/01/2024");
    expect(formatLastBill("2024-01-01T00:00:00Z")).toBe("01/01/2024");
  });

  it("returns '' for anything that is not a leading YYYY-MM-DD", () => {
    expect(formatLastBill("")).toBe("");
    expect(formatLastBill("   ")).toBe("");
    expect(formatLastBill("01/01/2024")).toBe("");
  });
});
