import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * ⚠️ Every `<SupplyLengthField>` must be handed `supplyLengthOptions(payer)`.
 *
 * 75 days is Aetna-only (Brandon, 2026-09-09) while `callIntake.SUPPLY_LENGTHS`
 * contains it so the notes block can round-trip a saved selection. Making
 * `options` a required prop stops a caller falling back to the wrong list, but
 * `options: string[]` cannot say WHICH list — a future call site could hand it
 * a literal `["30","60","75","90"]` and offer an Aetna cadence to every payer,
 * and tsc would be perfectly happy (Greptile's nuance on PR #55).
 *
 * So the guarantee is pinned here instead, in the source-scanning style this
 * repo already uses for contracts the type system can't hold
 * (`profile/listColumns.test.ts`, `notesWriteShape.test.ts`,
 * `hooks/pendingAdvanceCoverage.test.ts`). The failure it prevents is silent on
 * screen: an ineligible length looks exactly like an eligible one.
 */

const SRC = resolve(__dirname, "../..");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules") tsxFiles(full, out);
    } else if (full.endsWith(".tsx") && !full.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("SupplyLengthField call sites", () => {
  const callSites = tsxFiles(SRC).filter((f) =>
    /<SupplyLengthField[\s>]/.test(readFileSync(f, "utf8")),
  );

  it("finds at least one, so the scan can't pass by finding nothing", () => {
    expect(callSites.length).toBeGreaterThan(0);
  });

  it("passes the payer's option list, never a literal", () => {
    for (const file of callSites) {
      const src = readFileSync(file, "utf8");
      // Each `<SupplyLengthField … />` block, up to its closing bracket.
      for (const [block] of src.matchAll(/<SupplyLengthField[\s\S]*?\/>/g)) {
        expect(
          /options=\{supplyLengthOptions\(/.test(block),
          `${file}: <SupplyLengthField> must pass options={supplyLengthOptions(...)}`,
        ).toBe(true);
      }
    }
  });
});
