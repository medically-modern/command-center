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

describe("the columns' booking notices", () => {
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

  it("gives BOTH columns a notice — the intake one names its fallback", () => {
    // Patient Intake has somewhere to fall back to (the monday mirror) and the
    // Welcome Call column does not, so the two sentences must differ: telling a
    // coordinator "Scheduled isn't filled in yet" would be false on a column
    // that is showing the mirror's bookings.
    expect(page).toMatch(/function IntakeBookingsNotice/);
    expect(page).toMatch(/function WelcomeBookingsNotice/);
    expect(page).toMatch(/mirrored onto monday/);
    expect(page).toMatch(/notice=\{<IntakeBookingsNotice/);
    expect(page).toMatch(/notice=\{<WelcomeBookingsNotice/);
  });

  it("asks Calendly for BOTH kinds, and names the kind at each call site", () => {
    // One index, two columns. An unnamed kind would put one column's
    // appointments in the other's Scheduled list.
    expect(page).toMatch(/useCalendlyBookings\(welcomeEmails, "welcome"\)/);
    expect(page).toMatch(/useCalendlyBookings\(intakeEmails, "intake"\)/);
    expect(page).toMatch(/calendly: intakeCalendly/);
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

/**
 * The column headers line up, at every width — measured, not reasoned about.
 *
 * ⚠️⚠️ **THE SECTION BARS SAT OUT OF LINE AT EVERY WIDTH BELOW 1600 AND
 * NOBODY HAD LOOKED.** §5.30c/d record this class three times; measured in a
 * browser on 2026-09-18 it was live again, in two independent places:
 *
 *  · the five-facet filter (2026-09-17) is **454px** and never wraps
 *    internally, against a 235px legend, so legend + gap + filter is 701px
 *    while the column is 768 / 688 / 608 / 518 at 1600 / 1440 / 1280 / 1100.
 *    It fitted at 1600 and dropped to a second line everywhere else, in the
 *    ONE column that has a filter: bars **17px** out at 1280 and 1100.
 *  · "Patient Intake" is **9px wider** than "Welcome Call", so between about
 *    1400 and 1470 the intake header wrapped and the welcome header did not:
 *    bars **42px** out, at 1440 — an ordinary laptop width.
 *
 * Both are now equal BY CONSTRUCTION — a fixed-height row of its own for the
 * filter, an explicit breakpoint for the header — rather than by fitting, so
 * the next control that is wider than its predecessor cannot do it again.
 * Verified in Chromium at 1024 · 1100 · 1200 · 1280 · 1366 · 1400 · 1440 ·
 * 1470 · 1500 · 1512 · 1600 · 1680 · 1920: delta 0 at every one.
 */
describe("the column header cannot drift between the two columns", () => {
  const col = read("src/components/careCoordinator/PipelineColumn.tsx");

  it("gives the filter its own row instead of the legend's", () => {
    // The legend block must not carry `controls` — that is what wrapped.
    const legend = col.slice(col.indexOf("Green edge"), col.indexOf("{controls}"));
    expect(legend).not.toContain("flex-wrap");
    // …and the controls row is always drawn, with a floor, in BOTH columns.
    expect(col).toMatch(/min-h-\[30px\][^>]*>\{controls\}</);
  });

  it("stacks the header by BREAKPOINT, never by content wrap", () => {
    const header = col.slice(col.indexOf("<header"), col.indexOf("</header>"));
    // `flex-wrap` here is the bug: it wraps on content, and the two titles are
    // different widths, so one column wraps and the other does not.
    expect(header).not.toContain("flex-wrap");
    expect(header).toContain("flex-col");
    expect(header).toMatch(/min-\[1500px\]:flex-row/);
  });

  /**
   * Brandon asked for the counters to go green on 2026-09-17 *"and add a
   * legend for that"*. They shipped green with a tooltip and no legend, so a
   * card carried two green signals and the column explained one of them.
   */
  it("names BOTH green signals — the card edge and the counters", () => {
    expect(col).toContain("Green edge");
    expect(col).toContain("Green count");
  });
});

describe("the intake filter", () => {
  const filter = read("src/components/careCoordinator/IntakeFilter.tsx");

  it("scrolls rather than wrapping, so its row is one line at every width", () => {
    const group = filter.slice(filter.indexOf('role="group"') - 400, filter.indexOf('role="group"') + 80);
    expect(group).toContain("flex-nowrap");
    expect(group).toContain("overflow-x-auto");
    // 454px of chips against a 446px column at the 1024 breakpoint: wrapping
    // drops one chip to a second line in this column alone.
    expect(group).not.toMatch(/\bflex-wrap\b/);
  });
});
