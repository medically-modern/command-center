import { describe, it, expect } from "vitest";
import { expectedItems, expectedItemsColumns, EXPECTED_COL } from "./expectedItems";

const SUB = 18407459988;
const C = EXPECTED_COL;

/** The shape of a live Subscription row, from the 2026-09-22 board read. */
const row = (o: Partial<Record<keyof typeof C, string>>) => {
  const cols: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) cols[C[k as keyof typeof C]] = v as string;
  return cols;
};

describe("expectedItemsColumns", () => {
  it("names all seven ids on the Subscription board", () => {
    expect(expectedItemsColumns(SUB).sort()).toEqual(Object.values(C).sort());
  });

  it("is empty on every other board — no other board has these columns", () => {
    expect(expectedItemsColumns(18410804557)).toEqual([]);
    expect(expectedItemsColumns(18406060017)).toEqual([]);
  });

  it("declares the three ids stageDetail also fetches, rather than relying on it", () => {
    // ⚠️ Keying this module on what another map happens to fetch is the
    // coupling that goes silently blank when that map is trimmed (§5.11).
    for (const id of ["color_mkxmdscr", "color_mkxm50f9", "numeric_mkw839ks"]) {
      expect(expectedItemsColumns(SUB)).toContain(id);
    }
  });
});

describe("expectedItems — Brandon's four lines", () => {
  it("builds a pump patient's lines in his order: sets, cartridges, sensors", () => {
    // A real row: Mobi, AutoSoft XC 9mm 43" ×3, 3 cartridges, no CGM.
    expect(
      expectedItems(SUB, row({
        infusionSet1: 'AutoSoft XC 9 mm 43"', infQty1: "3",
        infusionSet2: "", infQty2: "0",
        cartridgeQty: "3",
        sensorsType: "Not Serving", cgmQty: "3",
      })),
    ).toEqual(['3 × AutoSoft XC 9 mm 43"', "3 × cartridges"]);
  });

  it("names the sensor product with a 'sensors' suffix", () => {
    expect(
      expectedItems(SUB, row({
        infusionSet1: "Not Serving", sensorsType: "Dexcom G7", cgmQty: "3",
      })),
    ).toEqual(["3 × Dexcom G7 sensors"]);
  });

  it("carries a second infusion set when there is one", () => {
    expect(
      expectedItems(SUB, row({
        infusionSet1: 'TruSteel 6 mm 23"', infQty1: "3",
        infusionSet2: 'VariSoft 13 mm 23"', infQty2: "2",
      })),
    ).toEqual(['3 × TruSteel 6 mm 23"', '2 × VariSoft 13 mm 23"']);
  });

  it("is empty for a board that has none of these columns", () => {
    expect(expectedItems(18410804557, row({ infusionSet1: "x", infQty1: "3" }))).toEqual([]);
  });

  it("is empty for a profile that names nothing — the slot renders its own dash", () => {
    expect(expectedItems(SUB, row({ infusionSet1: "Not Serving", sensorsType: "Not Serving" }))).toEqual([]);
    expect(expectedItems(SUB, undefined)).toEqual([]);
  });
});

describe('⚠️ "Not Serving" is the common value, not an edge case', () => {
  it("drops it, whatever its casing", () => {
    // 37 of the 60 live rows read it on Sensors Type alone; without the filter
    // the strip would list "Not Serving" as an item on most patients.
    expect(expectedItems(SUB, row({ sensorsType: "Not Serving", cgmQty: "3" }))).toEqual([]);
    expect(expectedItems(SUB, row({ sensorsType: "not serving", cgmQty: "3" }))).toEqual([]);
    expect(expectedItems(SUB, row({ infusionSet1: "Not Serving", infQty1: "3" }))).toEqual([]);
  });

  it("drops a blank product too — a quantity with nothing to count is not a line", () => {
    expect(expectedItems(SUB, row({ infusionSet2: "", infQty2: "4" }))).toEqual([]);
    expect(expectedItems(SUB, row({ sensorsType: "   ", cgmQty: "3" }))).toEqual([]);
  });
});

describe("⚠️ a BLANK quantity and a ZERO are different facts", () => {
  it("renders the product alone when nobody has filled the quantity in", () => {
    // Measured 2026-09-22: 18 of the 22 CGM-serving rows carry a blank CGM
    // Qty — 82% — so "— × Dexcom G7 sensors" would be the everyday case.
    expect(expectedItems(SUB, row({ sensorsType: "Dexcom G7", cgmQty: "" }))).toEqual([
      "Dexcom G7 sensors",
    ]);
    expect(expectedItems(SUB, row({ infusionSet1: "TruSteel 6 mm 23\"", infQty1: "" }))).toEqual([
      'TruSteel 6 mm 23"',
    ]);
  });

  it("DROPS a line whose quantity is a stated zero", () => {
    // Inf. Qty 2 reads "0" on essentially every live row. A zero says none of
    // this ships; it must never read as "nobody has said".
    expect(expectedItems(SUB, row({ infusionSet2: 'VariSoft 13 mm 23"', infQty2: "0" }))).toEqual([]);
    expect(expectedItems(SUB, row({ sensorsType: "Dexcom G7", cgmQty: "0" }))).toEqual([]);
    expect(expectedItems(SUB, row({ cartridgeQty: "0" }))).toEqual([]);
  });

  it("drops a negative, and treats an unreadable quantity as blank", () => {
    expect(expectedItems(SUB, row({ infusionSet1: "A", infQty1: "-2" }))).toEqual([]);
    expect(expectedItems(SUB, row({ infusionSet1: "A", infQty1: "n/a" }))).toEqual(["A"]);
  });
});

describe("⚠️ cartridges have no product column on this board", () => {
  it("renders the bare word Brandon writes, never the pump", () => {
    // Supplies Type is the PUMP (t:slim · Mobi · iLet) and the profile card
    // already names it; there is no cartridge product to print.
    const lines = expectedItems(SUB, { ...row({ cartridgeQty: "3" }), color_mkxmnheg: "t:slim" });
    expect(lines).toEqual(["3 × cartridges"]);
    expect(lines.join(" ")).not.toContain("t:slim");
  });

  it("needs a real quantity — a blank cartridge count is not a line", () => {
    expect(expectedItems(SUB, row({ cartridgeQty: "" }))).toEqual([]);
  });
});
