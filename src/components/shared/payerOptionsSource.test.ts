import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️ Every Primary Insurance picker must render the LIVE board list, never a
 * hardcoded table directly.
 *
 * The index is the only binding — the label is display-only — and four boards
 * number their labels independently, so a hardcoded table is meaningful against
 * exactly one board and nothing checks that it still is. The failure is silent
 * in the worst possible way: on 2026-09-11 "Health Plans Inc (PHCS)" was created
 * into slot 7 on Insurance and Welcome Call, and Final Confirm's select — which
 * carried `{ index: 7, label: "United Healthcare Commercial" }`, a label on no
 * board — went from writing nothing to writing a real, WRONG payer, with a green
 * toast, which then rode to Subscription and Order by label text.
 *
 * `tsc` cannot catch a reversion here: `{index, label}[]` cannot say which board
 * it came from. A source scan can, which is why this is one (the
 * `orderFrequencyOptionsSource.test.ts` / `listColumns.test.ts` convention).
 *
 * Verified to fail when `options={primaryInsuranceOptions}` is reverted to
 * `options={PRIMARY_INSURANCE_OPTIONS}` in either file.
 */
const FINAL_CONFIRM = join(process.cwd(), "src/components/finalConfirm/PatientInfoCard.tsx");
const SUBSCRIPTION = join(process.cwd(), "src/components/subscription/PatientInfoCard.tsx");

const PICKERS = [
  { name: "Final Confirm", path: FINAL_CONFIRM, board: '"welcomeCall"' },
  { name: "Subscription", path: SUBSCRIPTION, board: '"subscription"' },
] as const;

describe("the Primary Insurance pickers", () => {
  for (const picker of PICKERS) {
    describe(picker.name, () => {
      const src = readFileSync(picker.path, "utf8");

      it("has a Primary Insurance select, so the scan can't pass by finding nothing", () => {
        expect(src).toContain("Primary Insurance");
        expect(src).toContain("options={primaryInsuranceOptions}");
      });

      it("sources its options from the board it writes to", () => {
        expect(src).toContain("usePayerOptions(");
        expect(src).toContain(`usePayerOptions(${picker.board})`);
        expect(src).toContain("payers.optionsFor(");
      });

      /**
       * ⚠️ The hardcoded table may only ever be passed as the FALLBACK argument
       * of `optionsFor`. Handed straight to the select it is the original bug.
       */
      it("never hands the hardcoded table to the select", () => {
        expect(src).not.toMatch(/options=\{\s*PRIMARY_INSURANCE_OPTIONS\s*\}/);
      });

      /**
       * ⚠️ The index must travel WITH the option the rep chose. Looking the
       * index up in the hardcoded table after the fact re-introduces the split
       * between what was displayed and what gets written — which is the bug in
       * a different shape.
       */
      it("resolves the chosen index from the same list it rendered", () => {
        expect(src).not.toMatch(/PRIMARY_INSURANCE_OPTIONS\.find\(/);
      });

      /* The phantom label, by name, in case a revert restores it verbatim. */
      it("does not name a payer that exists on no board", () => {
        expect(src).not.toContain("United Healthcare Commercial");
      });
    });
  }
});

describe("the Insurance send", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/samantha/mondayWrite.ts"), "utf8");

  /**
   * This path has no picker to take an index from — it re-writes the payer it
   * just read off the item — so it resolves the index from the live board
   * itself. A wrong index here does not fail: it overwrites a correct value
   * with another real payer and reports success.
   */
  it("resolves the payer index from the live Insurance board", () => {
    expect(src).toContain("resolvePayerIndex('insurance', p.primaryInsurance)");
  });

  it("keeps the hardcoded map only as the fallback", () => {
    expect(src).toMatch(/live \?\? PRIMARY_INSURANCE_INDEX\[/);
  });
});
