import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️ The Order Frequency select must offer `frequency.options`, never a literal.
 *
 * 75 days is **Aetna-only** (Brandon, 2026-09-09). `frequencyState` derives the
 * options from the payer via `supplyLengthOptions`, so the eligibility rule
 * holds — but only while the control actually renders THAT list. A future edit
 * could hand it `["30","60","75","90"]` inline and offer an Aetna cadence to
 * every payer, and tsc would be perfectly happy: `string[]` cannot say which
 * list it is.
 *
 * This replaces `supplyLengthOptionsSource.test.ts`, which pinned the same
 * guarantee on `SupplyLengthField` before that control was deleted. The
 * guarantee migrated with the feature rather than quietly lapsing — which is
 * the point, because the failure is invisible on screen: an ineligible cadence
 * looks exactly like an eligible one.
 */
const FORM = join(process.cwd(), "src/components/welcomeCall/WelcomeCallForm.tsx");

describe("the Order Frequency select", () => {
  const src = readFileSync(FORM, "utf8");

  it("exists, so the scan can't pass by finding nothing", () => {
    expect(src).toContain("Order Frequency");
    expect(src).toContain("frequencyState({");
  });

  it("renders the payer-derived options", () => {
    expect(src).toContain("frequency.options.map(");
  });

  /* A literal list beside the select is the exact regression this exists for. */
  it("never hardcodes a length list", () => {
    expect(src).not.toMatch(/\[\s*"30"\s*,\s*"60"\s*,\s*"75"\s*,\s*"90"\s*\]/);
    expect(src).not.toMatch(/\[\s*"30"\s*,\s*"60"\s*,\s*"90"\s*\]/);
  });

  /* The board takes an INDEX, and Monday assigned these from the label colour
     rather than the index the create call asked for. A hand-written index is
     dropped without an error (§5.20). */
  it("maps the label to an index through ORDER_FREQUENCY_INDEX", () => {
    expect(src).toContain("ORDER_FREQUENCY_INDEX[daysToLabel(");
  });
});
