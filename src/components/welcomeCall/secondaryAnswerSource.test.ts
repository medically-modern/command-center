import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️ The card and the send gate must read the secondary answer through ONE
 * function, `secondaryStateFor`.
 *
 * Unknown is the only answer with no board representation (Brandon,
 * 2026-09-09: *"patients often don't know"*), because clearing Secondary
 * Insurance would destroy a real policy record rather than record a shrug. So
 * anything that re-reads the COLUMN is answering a different question from the
 * control the rep just used. That is how this shipped: the block held Unknown
 * in its own `useState` while `WelcomeCallPage` fell back to
 * `secondaryInsuranceEdited ?? secondaryInsurance`, so a patient already
 * carrying NY Medicaid showed **Unknown** on screen with Advance held shut on a
 * CIN the rep had just said nobody knew — a gate with no passing move
 * (Greptile, PR #56).
 *
 * The failure is invisible from either file alone: each one is internally
 * consistent, and tsc is happy with both. Only the pair is wrong, which is why
 * this is a scan rather than a type.
 */
const PAGE = join(process.cwd(), "src/pages/WelcomeCallPage.tsx");
const BLOCK = join(process.cwd(), "src/components/welcomeCall/InsuranceAuthSection.tsx");

describe("the secondary-coverage answer", () => {
  const page = readFileSync(PAGE, "utf8");
  const block = readFileSync(BLOCK, "utf8");

  it("is read by both the send gate and the card, so the scan can't pass on absence", () => {
    expect(page).toContain("secondaryMissing({");
    expect(page).toContain("secondaryStateFor(selected)");
    expect(block).toContain("secondaryStateFor(patient)");
  });

  /* Either file reaching for the column again is the regression. */
  it("is never re-derived from the column at either end", () => {
    expect(page).not.toContain("secondaryStateFromBoard");
    expect(block).not.toContain("secondaryStateFromBoard");
  });

  /* Unknown has to survive a poll and reach the page, so it rides the overlay
     rather than component state — a local flag is what the page couldn't see. */
  it("keeps Unknown on the overlay, not inside the card", () => {
    expect(block).toContain('onFieldChange("secondaryUnknown"');
    expect(block).not.toMatch(/useState[<(]/);
  });
});
