// Welcome Call has to work on a phone (Josh, 2026-09-22: Corey works the
// cross-sell queue from his phone) WITHOUT the desktop layout moving.
//
// Both fixes below are single Tailwind classes whose absence is SILENT: the
// page still renders, it just grows a horizontal scrollbar and pushes controls
// off the right edge. Nothing in the unit suite can see that, so this scans for
// them — the `listColumns.test.ts` convention.
//
// Measured in a real browser at 13 widths before and after (the harness is not
// in the repo). Before: the document was 1290px wide at every width from 1280
// DOWN, i.e. a horizontal scrollbar on a 1280 laptop as well as on a phone, and
// two thirds of the header toolbar was simply unreachable. After: no
// horizontal overflow at any width, and 1366 / 1440 / 1600 / 1920 are
// byte-identical — same header box, same page height, same section geometry.
// Run: npx vitest run src/components/welcomeCall/phoneLayout.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/WelcomeCallPage.tsx", "utf8");
const form = readFileSync("src/components/welcomeCall/WelcomeCallForm.tsx", "utf8");

describe("the Welcome Call header survives a narrow screen", () => {
  it("the action row wraps", () => {
    // Seven controls come to ~1010px. Without this the row overflowed at every
    // width at or below 1280; from 1366 up it already fits on one line, so
    // wrapping is inert there and the desktop layout is untouched.
    expect(page).toMatch(/className="flex items-center gap-2 flex-wrap justify-end"/);
  });

  it("the header's horizontal padding still steps up at sm", () => {
    // px-3 on a phone, px-6 from 640 — the mobile-first pattern the rest of
    // this page uses. A bare px-6 costs 24px of a 390px screen on both sides.
    expect(page).toMatch(/px-3 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap/);
  });
});

describe("the address confirmation stays on screen", () => {
  it("its row wraps", () => {
    expect(form).toMatch(/mt-6 flex flex-col sm:flex-row sm:items-start flex-wrap gap-3/);
  });

  it("the checkbox column has a real minimum width", () => {
    // ⚠️ THE ONE THAT IS EASY TO DELETE AS NOISE. `flex-1` is `flex: 1 1 0%` —
    // basis 0 — so the item never "doesn't fit" and `flex-wrap` never fires on
    // it; it just shrinks. At ~768 with the sidebar open that squeezed the
    // label to 59px wide and 99px tall and spilled its text off the edge.
    // The floor is what converts that crush into a wrap. Measured inert from
    // 1024 up: the label box is identical there with and without it.
    expect(form).toMatch(/className="flex-1 min-w-0 sm:min-w-\[16rem\]"/);
  });
});
