/**
 * ⚠️ **Tailwind has a utility literally named `outline`** — it compiles to
 * `outline-style: solid` — and Brandon's button variant is ALSO called
 * `outline` (`btn outline xs`). The two match the same class attribute, so
 * every outline button on the patient screen drew a 3px currentColor ring that
 * read as a heavy black border. Found by rendering the Onboarding header's
 * "Open <tool>" link on 2026-09-24; the reorder form's "Open form" and the
 * patient screen's "Try again" had carried it since they shipped.
 *
 * Nothing errors when this regresses — the page just looks wrong — so it is
 * pinned here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/pages/patient/redesign.css"), "utf8");
/** Comments explain the rule; only the rules themselves count. */
const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the Tailwind `outline` collision", () => {
  it("cancels the utility's ring on the patient screen's outline buttons", () => {
    expect(rules).toMatch(/\.cc-pt \.btn\.outline\s*\{\s*outline-style:\s*none;\s*\}/);
  });

  it("gives keyboard focus a ring of its own, declared AFTER the cancel so it wins", () => {
    // Author CSS outranks the browser's own focus style, so cancelling the
    // outline alone would leave keyboard users with no focus indicator at all.
    const cancel = rules.search(/\.cc-pt \.btn\.outline\s*\{\s*outline-style:\s*none/);
    const focus = rules.search(/\.cc-pt \.btn:focus-visible\s*\{\s*outline:\s*2px solid/);
    expect(cancel).toBeGreaterThan(-1);
    expect(focus).toBeGreaterThan(cancel);
  });
});
