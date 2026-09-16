/**
 * The two things a Care Coordinator column has to say out loud, both found by
 * the 2026-09-16 page audit and both silent failures before it.
 *
 * 1. **"Scheduled" must never read as empty while Calendly is still being
 *    asked.** Welcome calls exist in Calendly alone, so every patient sits in
 *    Unscheduled until that read lands — and it cannot even start until the
 *    board read has produced the addresses to ask about. Measured against a
 *    slow gateway: the column sat at `Scheduled 0 · Unscheduled 15` with no
 *    notice at all, four booked patients listed as people to ring. A FAILED
 *    read was covered; an unfinished one was not.
 *
 * 2. **A section bar must set its own text colour.** `--mm-mint` is a
 *    near-white with no `.dark` override, so the Unscheduled bar rendered
 *    `rgb(241,245,248)` on it in dark mode — the word vanished. Every other
 *    `--mm-mint` user in the app pairs it with `--mm-teal`; this one didn't.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the Welcome Call column's booking notice", () => {
  const page = read("src/pages/CareCoordinatorPage.tsx");

  it("reads `ready`, so an unfinished Calendly read is not rendered as 'nobody is booked'", () => {
    expect(page).toMatch(/bookings\.ready/);
    // Three states, never two: checking · could not check · fine.
    expect(page).toMatch(/Checking Calendly/);
    expect(page).toMatch(/Couldn't check Calendly/);
  });

  it("still says so when the read FAILED, and when there is no gateway at all", () => {
    expect(page).toMatch(/bookings\.error/);
    expect(page).toMatch(/bookings\.available/);
  });
});

describe("the section bars", () => {
  const col = read("src/components/careCoordinator/PipelineColumn.tsx");

  it("give the mint (Unscheduled) bar an explicit text colour", () => {
    const tone = /unscheduled:\s*"([^"]+)"/.exec(col)?.[1] ?? "";
    expect(tone).toContain("var(--mm-mint)");
    expect(tone).toMatch(/text-\[color:var\(--mm-teal\)\]/);
  });

  it("never colours a bar or its count with `foreground`/`background`, which invert in dark mode", () => {
    const block = col.slice(col.indexOf("const SECTION_TONE"), col.indexOf("export function Section"));
    expect(block).not.toMatch(/text-background|bg-foreground|text-foreground/);
  });
});
