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
    // The Manage menu is gone entirely (2026-09-21); Oversight's door is the
    // settings menu's manager section, plus the home view and the tab.
    expect(header(), "the Manage button came back").not.toContain('title="Manager tools"');
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

  it("⚠️ the MANAGE ▾ menu is gone, and the orphan that needed a home got one", () => {
    // Josh, 2026-09-21: "also remove the manage tab". Two of its three entries
    // did not exist elsewhere at the time; Access & permissions still needs
    // this menu (the Users button beside it is ADMIN-only), so it moved here.
    const h = header();
    expect(h, "the Manage button is still here").not.toContain('title="Manager tools"');
    expect(h).toContain('navigate("/access")');
  });

  it("⚠️⚠️ …and moving it did not WIDEN it — the section is manager-gated", () => {
    // That section was ungated before the move; the Manage menu was gated.
    // Folding an admin-shaped entry into an ungated list is how a move becomes
    // a widening.
    const h = header();
    const section = h.slice(h.indexOf("{managerish && ("), h.indexOf("</>\n              )}"));
    for (const route of ['navigate("/access")', 'navigate("/oversight")', 'navigate("/stage-manager")']) {
      expect(section, `${route} escaped the manager gate`).toContain(route);
    }
  });

  it("⚠️⚠️ System Management left the menu — every TAB of it is on the top bar", () => {
    // Josh, 2026-09-21: "as far as system managment goes the full top bar now
    // handles that". Checked rather than taken on trust, tab by tab: Search IS
    // the header's search box, Communications and Stage Manager are header
    // tabs, Operations is what Reports & Metrics opens, Oversight is on this
    // menu. The route survives for a bookmark; it is just not advertised.
    const h = header();
    expect(h, "System Management is back on the menu").not.toContain('navigate("/system-mgmt")');
    expect(h, "the search box went with it").toContain("<GlobalSearch");
    for (const to of ['to: "/assigned-patients"', 'to: "/stage-manager"', 'to: "/operations"']) {
      expect(h, `${to} is not a tab`).toContain(to);
    }
    expect(h).toContain('navigate("/oversight")');
    expect(live(read("App.tsx")), "the route itself is gone").toContain('path="/system-mgmt"');
  });

  it("⚠️⚠️ the FAXES section left too — and only ONE of the two had another door", () => {
    // Josh, 2026-09-21: "no need for the faxes section in settings i think
    // either". Checked before removing, because §5.39c added /fax BESIDE
    // /fax-inbox and this menu was the only place both appeared.
    const h = header();
    expect(h, "the Faxes section is back").not.toContain('navigate("/fax-inbox")');
    expect(h).not.toContain('navigate("/fax")');

    // /fax-inbox keeps a REAL door: the FAX role bar, special-cased in both
    // burndowns to open it (§4).
    expect(live(read("components/dashboard/DailyBurndown.tsx"))).toContain('navigate("/fax-inbox")');
    expect(live(read("components/systemMgmt/OperationsTab.tsx"))).toContain("/fax-inbox?from=system-mgmt");

    // /fax has NO door left. That is accepted, not overlooked: its function —
    // an inbound fax joined to the sending office and that office's patients —
    // is the Communications hub's Fax tab (§5.28), which is a header tab.
    expect(live(read("App.tsx")), "the route is gone as well").toContain('path="/fax"');
    expect(live(read("hooks/commsHub/useHubData.ts")), "the hub lost its fax list").toContain("fax");
  });

  it("⚠️ Access is on the settings menu AND the Users button, which is admin-only", () => {
    // `isAdmin` is true for every manager only while `admins` is empty
    // (§5.39c). The day somebody names the first admin, the settings menu is
    // the one route a non-admin manager has to /access.
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
