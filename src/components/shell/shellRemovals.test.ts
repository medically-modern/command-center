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

  it("⚠️⚠️ `Index` is the \"as today\" dashboard ONLY — the redesign never renders it", () => {
    // §5.39h: the redesign's home is the signed-in person's own view
    // (`homeProfileFor`), so the roster branch that used to live here is GONE
    // rather than dormant — a screen nothing can reach is the dead code §5.11
    // exists to warn about. The one caller gates it on the layout.
    const host = liveLines(read("components/shell/HomeViewHost.tsx"));
    expect(host).toContain("if (!redesign) return <Index />;");
    expect(index).not.toContain("rosterReplaced");
  });

  it("⚠️⚠️ sign-out survived the floating gear's deletion", () => {
    // That button WAS the app's sign-out on the no-sidebar home, which is why
    // it was pinned here. It is gone (Josh, 2026-09-21: "putt everything in the
    // lower left setting into the upper right settings"), so what has to hold
    // now is that the header's settings menu carries sign-out, the appearance
    // switch and the six colour themes — everything the floating one held.
    const header = read("components/shell/GlobalHeader.tsx");
    expect(header).toContain("signOut");
    expect(header).toContain("setAppearance(");
    expect(header).toContain("THEMES.map(");
    for (const f of ["pages/Index.tsx", "pages/ProcessorView.tsx"]) {
      expect(read(f), f).not.toContain("ThemePickerButton");
    }
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

  it("⚠️ Pipeline Oversight is off the settings menu — the home view is its door", () => {
    // Trimmed 2026-09-21. The route is real and stays; what reaches it now is
    // the assignable `oversight` home view, not a link in the chrome.
    expect(read("components/shell/GlobalHeader.tsx")).not.toContain('navigate("/oversight")');
    expect(read("App.tsx")).toContain('path="/oversight"');
  });

  it("⚠️ System Management is OFF the menu again — the top bar covers its tabs", () => {
    // It was restored on 2026-09-18 because commenting its tabs out took Stage
    // Manager and Operations out of the product entirely. Both are header tabs
    // in their own right now, so the page itself no longer needs advertising
    // (Josh, 2026-09-21). ⚠️ The ROUTE must survive — a bookmark still works,
    // and its Search tab's pipeline chart has no other home.
    expect(read("components/shell/GlobalHeader.tsx")).not.toContain('navigate("/system-mgmt")');
    expect(read("App.tsx")).toContain('path="/system-mgmt"');
  });

  it("⚠️ Reports & Metrics is BACK, and ability-gated", () => {
    // §5.39b left it commented out because it pointed at Operations while
    // Operations was switched off. Operations is live again (§5.39f), so the
    // collision is gone; Josh, 2026-09-19: *"same with inventory reports
    // metrics etrc"* — i.e. it is one of the abilities that must be
    // functional, which needs the tab to exist.
    const tabs = live.slice(live.indexOf("const TABS"), live.indexOf("export function GlobalHeader"));
    expect(tabs).toContain("tab=operations");
    expect(tabs).toContain("Reports & Metrics");
    expect(tabs).toContain('ability: "reports"');
  });

  it("⚠️⚠️ every ability-gated tab is gated, and My Dashboard is not", () => {
    // Josh: *"if i dont assign myself communications the tab should be removed
    // from the top bar for me"*. A tab with no `ability` is unconditional, so
    // the check is per-tab and not a count.
    const tabs = live.slice(live.indexOf("const TABS"), live.indexOf("export function GlobalHeader"));
    for (const [key, ability] of [["comms", "comms"], ["inventory", "inventory"], ["reports", "reports"]]) {
      const block = tabs.slice(tabs.indexOf(`key: "${key}"`));
      expect(block.slice(0, block.indexOf("},")), `${key} is not gated`).toContain(`ability: "${ability}"`);
    }
    const home = tabs.slice(tabs.indexOf('key: "home"'));
    expect(home.slice(0, home.indexOf("},"))).not.toContain("ability:");
    // …and the filter is what makes the field do anything.
    expect(live).toContain("TABS.filter((t) => !t.ability || hasAbility(who, config, t.ability))");
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
