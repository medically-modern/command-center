/**
 * The copy-number button belongs to the WELCOME CALL STAGE PAGE and nothing
 * else — a source scan, because the bug it guards against is a shared
 * component quietly reaching another screen.
 *
 * The history is the whole reason this file exists (CLAUDE.md §5.30's
 * two-screens table). Katie asked for a way to copy the patient's number off
 * the Welcome Call stage page, because it renders as the label of a `tel:`
 * link and dragging across it starts a link drag rather than a selection. It
 * shipped 2026-09-17 inside `masheke/mmKit`'s shared `PatientContact`, which
 * put it on all TEN headers. Brandon then asked for it off the **Care
 * Coordinator card**, where it was a fourth control on a crowded row — and
 * deleting it from `PatientContact` took it off the stage page too, undoing
 * her fix without anybody noticing. Josh, 2026-09-18: "welcome call only
 * should have it not care cordinator".
 *
 * So: the button exists, it is opt-in, and exactly one caller opts in.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

describe("the copy-number button is Welcome Call's alone", () => {
  it("is opt-in on PatientContact rather than always rendered", () => {
    const kit = readFileSync(join(SRC, "components/masheke/mmKit.tsx"), "utf8");
    expect(kit).toContain("function CopyPhoneButton");
    // The render is gated on the prop — not on `hideCopy`, which would make
    // every header opt OUT and is how it reached ten screens the first time.
    expect(kit).toContain("{showCopy && <CopyPhoneButton");
    expect(kit).not.toContain("hideCopy");
  });

  it("exactly ONE component passes showCopy, and it is the Welcome Call activity card", () => {
    const callers = files.filter((f) => /\bshowCopy\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1));
    expect(callers.sort()).toEqual([
      "components/masheke/mmKit.tsx",                    // the definition
      "components/welcomeCall/PatientActivityCard.tsx",  // the one caller
    ]);
  });

  it("the Care Coordinator card does NOT pass it", () => {
    const card = readFileSync(join(SRC, "components/careCoordinator/PatientCard.tsx"), "utf8");
    expect(card).toContain("<PatientContact");
    expect(card).not.toMatch(/\bshowCopy\b/);
  });

  it("copies the number AS DISPLAYED, not tel:'s stripped digits", () => {
    const kit = readFileSync(join(SRC, "components/masheke/mmKit.tsx"), "utf8");
    // A rep is pasting into RingCentral, a payer portal or a note, and
    // `+15555550100` is not what any of them want back.
    expect(kit).toContain("navigator.clipboard.writeText(display)");
  });

  it("says so when the clipboard refuses, rather than failing silently", () => {
    const kit = readFileSync(join(SRC, "components/masheke/mmKit.tsx"), "utf8");
    expect(kit).toContain('setState("failed")');
    expect(kit).toContain("Couldn't copy");
  });
});
