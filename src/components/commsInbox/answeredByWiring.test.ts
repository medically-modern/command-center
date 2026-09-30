/**
 * The timeline must actually DRAW who picked up (§5.47d). The label has its own
 * tests in lib/commsInbox/timeline.test.ts; a label nothing renders is the
 * "code nothing calls" trap (§5.31b) — every one of those tests would pass and
 * Communications would look exactly as it did.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ItemTimeline wiring", () => {
  it("renders 'Picked up by …' on the call row", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/commsInbox/ItemTimeline.tsx"), "utf8");
    expect(src).toMatch(/answeredByLabel\(e\) && \(/);
    expect(src).toMatch(/Picked up by <span className="font-medium">\{answeredByLabel\(e\)\}<\/span>/);
  });
});
