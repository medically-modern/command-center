import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️ Reset must not blank a column the send writes UNCONDITIONALLY.
 *
 * `resetForNewPatient` calls `clearOverlay` — which already reverts every field
 * to what Monday holds — and then writes an overlay patch of explicit blanks to
 * empty fields on SCREEN. Those blanks are merged over the board's values on
 * every refetch, and a writer that always writes its column cannot tell that
 * blank from a rep deliberately removing something. So for an always-written
 * column, Reset followed by Send silently WIPES the patient's board value.
 *
 * Live when this test was written (Greptile, PR #57):
 *   · Monitor Qty — `coerceMonitorQty("")` is "0" and is pushed on every send,
 *     so Reset + Send overwrote a real monitor sale with 0.
 *   · Infusion Set 1/2 and their quantities — always written from 2026-09-10 so
 *     that REMOVING a set actually clears the board (Brandon's 2026-09-09 ask).
 *     Blanking them in Reset would have wiped a patient's whole infusion order.
 *
 * A source scan rather than a behavioural test, the `listColumns.test.ts`
 * convention: the hazard is one key in an object literal, it is invisible on
 * screen, and it costs a patient's order.
 */
describe("Welcome Call Reset does not blank always-written columns", () => {
  const src = readFileSync(join(__dirname, "WelcomeCallPage.tsx"), "utf8");

  const resetPatch = (() => {
    const start = src.indexOf("const resetForNewPatient");
    expect(start, "resetForNewPatient not found — did it move or get renamed?").toBeGreaterThan(-1);
    const end = src.indexOf("} as Partial<Patient>);", start);
    expect(end, "reset patch end marker not found").toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  /* Every field whose column mondayWrite pushes with no `if` guard. Adding a
     column to that set means removing it here too. */
  const alwaysWritten = [
    "monitorQty",
    "qtyInf1",
    "qtyInf2",
    "infusionSet1",
    "infusionSet2",
    "infusionSet1Index",
    "infusionSet2Index",
  ];

  for (const field of alwaysWritten) {
    it(`does not blank ${field}`, () => {
      expect(
        new RegExp(`\\b${field}\\s*:`).test(resetPatch),
        `Reset blanks ${field}, which the send writes unconditionally — Reset + Send would clear it on the board. clearOverlay already restores it from Monday; drop the key.`,
      ).toBe(false);
    });
  }

  /* The guard that makes Pump Qty's presence legitimate. If this write ever
     becomes unconditional, pumpQty has to leave the reset patch as well. */
  it("pumpQty may still be blanked only while its write stays guarded", () => {
    const writer = readFileSync(
      join(__dirname, "..", "lib", "welcomeCall", "mondayWrite.ts"),
      "utf8",
    );
    const guarded = writer.includes('if (pumpQtyToWrite !== "") tasks.push');
    if (!guarded) {
      expect(
        /\bpumpQty\s*:/.test(resetPatch),
        "Pump Qty is now written unconditionally, so Reset must stop blanking it.",
      ).toBe(false);
    } else {
      expect(guarded).toBe(true);
    }
  });
});
