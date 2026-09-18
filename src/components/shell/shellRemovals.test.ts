/**
 * The 2026-09-18 removals, pinned as source scans (the `listColumns.test.ts`
 * convention) — every one of these is invisible on screen if it regresses.
 *
 * Josh, the same day:
 *   · "Connected — calls ring in this tab - move to top bar next to users …
 *      just a small ui componet and button that moves to this tab, show it with
 *      an icon instead of explaining"
 *   · "remove the managers processors view on the left side bar"
 *   · "remove system management, the search from there is now in the top bar,
 *      comment out stage maanger operations and oversight"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/**
 * The source with every comment removed — so "is this still live?" is a real
 * question rather than a guess about indentation.
 *
 * ⚠️ Block comments FIRST, and they are what matters here: a commented-out JSX
 * element sits inside `{/* … *\/}`, and its inner lines (`onClick={() =>
 * selectTab("operations")}`) start with no comment marker at all. A line-prefix
 * filter reads every one of them as live code, which is exactly backwards for a
 * test about things being commented out.
 */
const liveLines = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("//");
    })
    .join("\n");

describe("⚠️ the softphone is ONE component, in two forms", () => {
  const badge = read("components/inboundCalls/CallConnectionBadge.tsx");
  const header = read("components/shell/GlobalHeader.tsx");

  it("the header renders the shared badge, not a copy of it", () => {
    expect(header).toContain("CallConnectionBadge");
    expect(header).toContain("<CallConnectionBadge compact />");
  });

  it("⚠️ the `canAnswerCalls` gate lives in ONE place", () => {
    // A second copy in the header is how somebody who was never assigned gets a
    // phone icon — or, worse, how an assigned person stops getting one and
    // never learns their line is down (§5.13b).
    expect(badge).toContain("canAnswerCalls");
    expect(header).not.toContain("canAnswerCalls");
  });

  it("⚠️ compact still carries the ringtone MUTE", () => {
    // With the home sidebar off, the header is the only badge a manager has, so
    // the mute lives nowhere else.
    const compact = badge.slice(badge.indexOf("if (compact)"), badge.indexOf("return (\n    <div"));
    expect(compact).toContain("setRingMuted");
    expect(compact).toContain("takeOver");
  });

  it("⚠️ never declines a ringing call (§5.13b)", () => {
    expect(badge).not.toContain(".decline(");
    expect(badge).not.toContain(".toVoicemail(");
  });
});

describe("⚠️ the home roster comes off only where a replacement exists", () => {
  const index = read("pages/Index.tsx");

  it("needs BOTH the redesign layout and viewOthers", () => {
    // Layout, so "as today" is untouched and the escape hatch is real (§5.39b).
    // viewOthers, so the three managers without the dropdown that replaces the
    // roster do not lose it and get nothing back.
    expect(index).toContain('layout === "redesign" && hasAbility(email, config, "viewOthers")');
  });

  it("⚠️ keeps the theme/sign-out button when the sidebar goes", () => {
    // ThemePickerButton IS sign-out, and the sidebar was its only home on this
    // screen. Twice now: once in the sidebar, once in the replacement.
    expect(index.split("ThemePickerButton").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("⚠️⚠️ and SIGN OUT is also in the header, where nothing can cover it", () => {
    // The floating button is `z-40` at bottom-left; the call-status notices are
    // `z-[60]` at the same corner, so an unhealthy call stream hides it.
    // Measured in a browser. Sign-out needs a route that cannot be covered.
    const header = read("components/shell/GlobalHeader.tsx");
    expect(header).toContain("signOut");
    expect(header).toContain("Sign out");
  });

  it("⚠️ the empty state stops pointing at a sidebar that is gone", () => {
    const dash = read("components/dashboard/DashboardMainView.tsx");
    expect(dash).toContain("hideSysMgmt");
    expect(dash).toContain("Viewing");
    // The old sentence survives for the layout that still HAS a sidebar.
    expect(dash).toContain("Select a team member from the sidebar");
  });
});

/**
 * ⚠️⚠️ **REVERSED THE SAME DAY — the reachability assertions now live in
 * `lossless.test.ts`, asserting the OPPOSITE of what this block used to.**
 *
 * Stage Manager, Operations and Oversight really were commented out on Josh's
 * word (*"comment out stage maanger operations and oversight"*), and this block
 * pinned that. It was the wrong thing to pin. Those three tabs are the ONLY
 * door each of those tools has, so switching them off took "move a patient
 * between stages" and "today's baseline vs live" out of the product
 * altogether — which is the loss he named hours later: *"same functionality
 * that existed in the original needs to exist here, the ui is the re-write not
 * the function, function should be lossless and will decide what gets cut
 * later"*. Brandon's own mockup header carries a **Manage ▾** menu listing all
 * three, so keeping them is his design too; the loss was ours.
 *
 * ⚠️ A test that pins a REMOVAL is only ever as good as the removal. Before
 * writing another one, check the thing being removed is reachable somewhere
 * else — that is the whole of what went wrong here.
 */
describe("⚠️ System Management keeps its own tabs", () => {
  const live = liveLines(read("pages/SystemMgmtPage.tsx"));

  it("keeps Search and Communications", () => {
    expect(live).toContain('selectTab("search")');
    expect(live).toContain('selectTab("communications")');
  });
});

describe("⚠️ the header advertises every live destination, and no dead one", () => {
  const header = read("components/shell/GlobalHeader.tsx");
  const live = liveLines(header);

  it("Pipeline Oversight goes to /oversight, which is a real route", () => {
    expect(live).toContain('navigate("/oversight")');
    expect(live).not.toContain("tab=oversight");
    expect(liveLines(read("App.tsx"))).toContain('path="/oversight"');
  });

  it("⚠️ System Management is back on the menu, under Manage", () => {
    // Off it on 2026-09-18 — *"remove system management, the search from there
    // is now in the top bar"* — which was true of SEARCH and of nothing else on
    // that page: Stage Manager, Operations and Oversight all live there too, and
    // each had no other door. Restored the same day under Brandon's own
    // **Manage ▾** heading, which is where his mockup puts it.
    // `lossless.test.ts` is the standing guard on all five entries.
    expect(live).toContain('navigate("/system-mgmt")');
  });

  it("⚠️ Reports & Metrics is off the PRIMARY TABS — its destination is undecided", () => {
    // A tab in primary navigation pointing at a page whose fate is undecided is
    // worse than a missing tab (§5.39b names the three ways back).
    //
    // ⚠️ The scan is the TABS array, NOT the file: Operations itself is not
    // lost — the Manage menu opens it, which is a different door answering a
    // different question. A whole-file `not.toContain("tab=operations")` would
    // fail on the door and read as though the tab had come back.
    const tabs = live.slice(live.indexOf("const TABS"), live.indexOf("export function GlobalHeader"));
    expect(tabs).not.toContain("tab=operations");
    expect(tabs).not.toContain("Reports & Metrics");
    // …but the definition survives, so restoring it is uncommenting one block.
    expect(header).toContain("Reports & Metrics");
  });

  it("every remaining tab points at a route that exists", () => {
    const app = liveLines(read("App.tsx"));
    const targets = [...live.matchAll(/to: "([^"]+)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      const path = t.split("?")[0];
      expect(app, `${t} has no route`).toContain(`path="${path}"`);
    }
  });

  it("the dashboard's System Management button is hidden in the redesign", () => {
    const dash = read("components/dashboard/DashboardMainView.tsx");
    expect(dash).toContain('layout === "redesign"');
    expect(dash).toContain("hideSysMgmt ? null");
  });
});


describe("⚠️ one navy bar, not two", () => {
  it("ProcessorView's own header is hidden inside the shell", () => {
    // A page keeping its own wordmark bar under the global one is the "two
    // designs stapled together" look §5.39b exists to avoid — found by
    // rendering the borrowed view, not by reading the code.
    expect(read("pages/ProcessorView.tsx")).toContain("data-cc-chrome");
    const css = read("pages/shell.css");
    expect(css).toContain(".cc-shell [data-cc-chrome] { display: none; }");
    // ⚠️ Scoped to `.cc-shell`, or the attribute would hide that header for
    // every processor with the redesign switched OFF — i.e. the escape hatch
    // would stop being one (§5.39b).
    expect(css).not.toMatch(/^\s*\[data-cc-chrome\]/m);
  });
});
