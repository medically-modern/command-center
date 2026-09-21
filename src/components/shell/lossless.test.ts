/**
 * ⚠️⚠️ **THE REDESIGN IS A UI REWRITE, NOT A FUNCTION REWRITE.**
 *
 * Josh, 2026-09-18: *"same functionality that existed in the original needs to
 * exist here, the ui is the re-write not the function, function should be
 * lossless and will decide what gets cut later"* — and *"his ui is what we move
 * towards but our function is paramount and needs to remain."*
 *
 * That is a standing rule, not a one-off fix, so it is pinned here. Every
 * feature the old shell could reach must still have a DOOR in the redesign
 * layout. A page whose only entry point was a button the redesign deleted has
 * left the app, however intact its route is — which is exactly what happened to
 * Stage Manager and Operations: commented out on 2026-09-18, and they exist
 * nowhere else, so "move a patient between stages" and "today's baseline vs
 * live" were simply gone until this test existed.
 *
 * Brandon's own mockup header carries a **Manage ▾** menu listing Oversight ·
 * Operations · Stage Manager · Access & permissions, so keeping them is his
 * design too — the loss was ours, not his.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join("\n");

const header = () => live(read("components/shell/GlobalHeader.tsx"));
const sysMgmt = () => live(read("pages/SystemMgmtPage.tsx"));

describe("⚠️ every manager tool still has a door in the redesign", () => {
  /**
   * Where each one is reachable from. A tool with no door has left the app.
   *
   * ⚠️ **The doors MOVED on 2026-09-21 and this list moved with them** (Josh:
   * *"in manage menu remove oversight and operations from that menu"* ·
   * *"make reports and metrics ONLY the daily operations screen"* · *"add stage
   * manager as an assignable top tab"*). Operations and Stage Manager were
   * promoted OUT of a menu and into the header's own tabs, which is a better
   * door, not a lost one — so what this list asserts is the promotion rather
   * than the old wording. Oversight is the one that left the header entirely;
   * its own test is below, because its door is no longer a link.
   */
  const doors: Array<[string, string, () => string]> = [
    ["Operations — the Reports & Metrics tab", "/operations", header],
    ["Stage Manager — its own tab", "/stage-manager", header],
    ["System Management", "/system-mgmt", header],
    ["Access & permissions", "/access", header],
  ];

  for (const [label, route, src] of doors) {
    it(`${label} is reachable (${route})`, () => {
      expect(src()).toContain(route);
    });
  }

  it("⚠️⚠️ Oversight left the MANAGE menu — and still has three doors", () => {
    // Josh took it off that menu on 2026-09-21, naming the Manage menu
    // specifically. It is a trim rather than a removal only because every
    // other way in still works, so this asserts the removal AND the survivors:
    //   · the settings (gear) menu's "Pipeline Oversight", a different menu;
    //   · `homeView: "oversight"`, assignable per person on /access, which
    //     renders the live Oversight page as somebody's landing screen;
    //   · /system-mgmt's own Oversight tab.
    // If any of those goes, Oversight needs a link back in the header FIRST.
    const manageMenu = header().split('<div className="eyebrow">Managers</div>')[1]?.split("</span>")[0] ?? "";
    expect(manageMenu, "the Manage menu still lists Oversight").not.toContain("Oversight");
    expect(manageMenu, "…and still lists Operations").not.toContain("Operations");
    expect(header(), "no door left in the header at all").toContain('navigate("/oversight")');
    const host = live(read("components/shell/HomeViewHost.tsx"));
    expect(host).toContain("oversight");
    expect(sysMgmt()).toContain('label="Oversight"');
    const store = live(read("lib/accessStore.ts"));
    expect(store).toMatch(/HOME_VIEWS[^;]*"oversight"/);
  });

  it("⚠️ a header tab is not a gate — both new routes are gated at the route too", () => {
    // §5.39h: the route still answers a typed URL, a bookmark and a Back.
    // Stage Manager in particular WRITES the Stage Advancer, which is what
    // every board automation fires on.
    const app = live(read("App.tsx"));
    expect(app).toMatch(/ability="reports"[\s\S]{0,120}OperationsPage/);
    expect(app).toMatch(/ability="stageManager"[\s\S]{0,120}StageManagerPage/);
  });

  it("the Manage menu renders them for a manager", () => {
    const h = header();
    expect(h).toMatch(/managerish && \(/);
    expect(h).toContain('title="Manager tools"');
  });

  it("⚠️ Manage Access is ALSO on the Manage menu, not only the admin-only Users button", () => {
    // The roster rail's footer carried it; the rail is gone (§5.39h — the home
    // is now the signed-in person's own view and the roster's job belongs to
    // the Viewing dropdown), and the header's Users button is ADMIN-only — so
    // a manager who is not an admin would have had no route to /access at all.
    // The Manage menu is manager-gated, which is the wider set.
    const h = header();
    expect(h).toContain('"/access"');
    expect(h).toMatch(/managerish && \(/);
  });

  it("⚠️⚠️ the roster's own job survived its rail — the Viewing dropdown", () => {
    // A manager looked at somebody's workload by picking them in the rail.
    // Removing the rail without this would have taken that away (§5.39e records
    // the first attempt doing exactly that and leaving a blank page).
    const host = live(read("components/shell/HomeViewHost.tsx"));
    expect(host).toContain("processorPeople");
    expect(host).toContain("setViewAs");
    const sw = live(read("components/shell/HomeViewSwitch.tsx"));
    expect(sw).toContain('aria-label="Whose view to show"');
  });
});

describe("⚠️ the tabs those doors open are actually wired", () => {
  it("Stage Manager, Operations and Oversight are not commented out", () => {
    const s = sysMgmt();
    // The tab BUTTONS must be live source, not inside a block comment — `live()`
    // strips comments, so finding them here means they really render.
    for (const label of ['label="Stage Manager"', 'label="Operations"', 'label="Oversight"']) {
      expect(s).toContain(label);
    }
  });

  it("?tab= lands on the tab it names rather than falling through to Search", () => {
    const s = sysMgmt();
    for (const t of ["operations", "stageManager", "oversight"]) {
      expect(s).toMatch(new RegExp(`tabParam === "${t}" \\? "${t}"`));
    }
  });
});

describe("⚠️ what the old dashboard reached, the new one still reaches", () => {
  it("the ad-hoc task tiles are still built from the role registry", () => {
    // Subscription · Orders · Update Clinicals · Communications were four
    // buttons under the bars. They are role bars, so they survive as long as
    // DailyBurndown keeps splitting them out — not as long as somebody
    // remembers to link them.
    const burn = live(read("components/dashboard/DailyBurndown.tsx"));
    for (const id of ["updateClinicals", "subscription", "assignedPatients", "orders"]) {
      expect(burn).toContain(`"${id}"`);
    }
  });
});
