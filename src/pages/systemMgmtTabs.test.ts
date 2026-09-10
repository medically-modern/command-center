/**
 * System Management's tab strip — a source scan (the `listColumns.test.ts`
 * convention).
 *
 * Two of these properties are load-bearing and neither fails loudly if it
 * regresses:
 *
 *  · The **Communications hub must MOUNT ONLY on its own tab.** Every
 *    RingCentral poll inside it is scoped to the mounted tab (§5.28, "only the
 *    OPEN tab polls"), so a "simplification" to `hidden`/CSS toggling — or to
 *    rendering it always and switching with `display` — would poll the shared
 *    account from a screen nobody is looking at. That is INCIDENT_2026-08-20's
 *    shape, and it would look like nothing at all on this page.
 *  · **`?tab=escalations` must still resolve to a real tab.** The Escalations
 *    tab is commented out, not deleted, so a stale bookmark or a Back into that
 *    URL would otherwise select a tab with no button and no body — a blank
 *    screen with no way out.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(process.cwd(), "src/pages/SystemMgmtPage.tsx"), "utf8");
const hub = readFileSync(join(process.cwd(), "src/pages/AssignedPatientsPage.tsx"), "utf8");

/**
 * The source with every comment removed.
 *
 * ⚠️ Required, and the reason is the point of this whole file: the Escalations
 * tab is COMMENTED OUT rather than deleted, so a raw scan finds its markup and
 * cannot tell "still shipping" from "kept for the day it comes back". Only the
 * comment-free source answers "is this rendered".
 */
const live = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const livePage = live(page);

describe("the Communications tab", () => {
  it("is in the strip", () => {
    expect(page).toContain('selectTab("communications")');
    expect(page).toContain('label="Communications"');
  });

  it("mounts the hub CONDITIONALLY, never hidden", () => {
    expect(livePage).toContain('{activeTab === "communications" && (');
    expect(livePage).toContain("<CommsHub embedded />");
    // If this ever becomes a `hidden` prop or a `display:none` class, the hub
    // keeps polling RingCentral from an unopened tab.
    expect(page).not.toMatch(/<CommsHub[^>]*hidden/);
  });

  it("keeps the rest of the page off the hub's tab", () => {
    // The hub owns a three-pane full-height layout; <main>'s scrolling
    // max-width column would squash it.
    expect(page).toContain('{activeTab !== "communications" && (');
  });

  it("loads the hub lazily, through the chunk-reload wrapper (§9)", () => {
    expect(page).toContain('const CommsHub = lazyWithReload(() => import("./AssignedPatientsPage"))');
  });
});

describe("embedding the hub", () => {
  it("is opt-in and defaults to the standalone page", () => {
    expect(hub).toContain("embedded = false");
  });

  it("KEEPS the dialer and the ring-settings bell", () => {
    // These are the only way to call an arbitrary number and the only way to
    // change which calls ring you — dropping the header wholesale would lose
    // both with nothing saying so.
    expect(hub).toContain('aria-label="Call any number"');
    expect(hub).toContain("setRingSettings(true)");
  });

  it("renders the SAME header — navy bar, icon and title", () => {
    // Josh, 2026-09-10: "exactly the same". The first cut restyled the header
    // into a plain white strip and dropped the icon and the title, and the view
    // was reported as incomplete — as "there's no way to send a text" — while
    // the composer was in fact present and reachable at every viewport. A
    // header that says nothing is what made a working screen look broken.
    const header = live(hub.slice(hub.indexOf("<header"), hub.indexOf("</header>")));
    expect(header).toContain("bg-gradient-navy");
    expect(header).toContain(">Communications</h1>");
    // Nothing in the header may branch on `embedded` except the back button.
    const branches = header.match(/embedded/g) ?? [];
    expect(branches).toHaveLength(1);
    expect(header).toContain("{!embedded && (");
  });

  it("stops claiming the viewport height when embedded", () => {
    expect(hub).toContain('embedded ? "min-h-0 flex-1" : "h-screen bg-gradient-subtle"');
  });

  it("gets a DEFINITE height from the host, never a minimum", () => {
    // ⚠️ The whole reason the hub can be embedded at all. Its three panes are
    // `flex-1 min-h-0` and scroll internally, and `min-h-0` can only bound a
    // parent that HAS a definite height. Under the page's ordinary
    // `min-h-screen` the flex row's height is auto, so the conversation list
    // grows to fit all 732 of its rows, the document scrolls, and both the
    // message composer and the profile pane's centred spinner end up thousands
    // of pixels below the fold — reported 2026-09-10 as "there's literally no
    // bar to send a text at the bottom" and "no loading animation for command
    // center profile as well".
    //
    // ⚠️ It only reproduces WITH VOLUME. Measured in a browser at 1440x900:
    // with 800 conversations and `min-h-screen` the document is 48,063px tall
    // and the composer sits at y=47,993; with `h-screen` it is 900px and the
    // composer is at 830. With a two-conversation fixture the content fits
    // inside 100vh and the two are pixel-identical — which is how this was
    // once "verified" fixed and reverted. Any re-test needs a long list.
    expect(livePage).toContain('activeTab === "communications" ? "h-screen overflow-hidden" : "min-h-screen"');
    // The navy header must not be squeezed by the flex row below it.
    expect(livePage).toMatch(/<header className="shrink-0 bg-gradient-navy/);
  });
});

describe("the Escalations tab is commented out, not deleted", () => {
  it("has no button and no live body", () => {
    expect(livePage).not.toContain('selectTab("escalations")');
    expect(livePage).not.toContain("<EscalationView");
    // …and the chip that reported a count this page can no longer show.
    expect(livePage).not.toContain("Escalation{escalated.length !== 1");
  });

  it("sends an old ?tab=escalations link somewhere real", () => {
    // Absent from the initialTab chain ⇒ it falls through to "search".
    const chain = livePage.slice(livePage.indexOf("const initialTab"), livePage.indexOf("const [activeTab"));
    expect(chain).not.toContain('"escalations"');
  });

  it("keeps everything needed to put it back", () => {
    // The union member, the view, the fetch and the removal handler all stay,
    // so restoring the tab is uncommenting two blocks.
    expect(page).toContain('| "escalations" |');
    expect(page).toContain("EscalationView");
    expect(page).toContain("handleRemoveEscalation");
  });
});
