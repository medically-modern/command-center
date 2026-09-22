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

  it("⚠️⚠️ Oversight is down to TWO doors, and this is where that is recorded", () => {
    // Josh trimmed it off the settings menu on 2026-09-21. What is left is the
    // assignable `oversight` HOME VIEW and the /oversight URL — so a manager
    // who has not been given that home view has no route to it from the
    // chrome. That is a narrowing, accepted deliberately; if it bites, the fix
    // is a header TAB, because this menu is settings now, not navigation.
    expect(header(), "Oversight is back on the settings menu").not.toContain('navigate("/oversight")');
    const host = live(read("components/shell/HomeViewHost.tsx"));
    expect(host, "the home view is the last door and it is gone too").toContain("oversight");
    const store = live(read("lib/accessStore.ts"));
    expect(store).toMatch(/HOME_VIEWS[^;]*"oversight"/);
    expect(live(read("App.tsx"))).toContain('path="/oversight"');
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

  it("⚠️⚠️ the settings menu is down to ONE manager entry, and it is still gated", () => {
    // Everything else moved to the top bar or was trimmed. Access & permissions
    // stays because the Users button beside it is ADMIN-only and only reads as
    // manager-wide while `admins` is empty (§5.39c).
    const h = header();
    const section = h.slice(h.indexOf("{managerish && ("), h.indexOf("</>\n              )}"));
    expect(section, "/access escaped the manager gate").toContain('navigate("/access")');
    expect(h, "the Manage button is back").not.toContain('title="Manager tools"');
  });

  it("⚠️⚠️ System Management and Stage Manager left the menu — the top bar has them", () => {
    // "as far as system managment goes the full top bar now handles that", and
    // Stage Manager is a header tab in its own right. Checked tab by tab rather
    // than taken on trust: Search IS the header's search box, Communications,
    // Stage Manager and Operations are tabs. The routes survive for bookmarks.
    const h = header();
    expect(h).not.toContain('navigate("/system-mgmt")');
    expect(h).not.toContain('navigate("/stage-manager")');
    expect(h, "the search box went with it").toContain("<GlobalSearch");
    for (const to of ['to: "/assigned-patients"', 'to: "/stage-manager"', 'to: "/operations"']) {
      expect(h, `${to} is not a tab`).toContain(to);
    }
    const app = live(read("App.tsx"));
    expect(app).toContain('path="/system-mgmt"');
    expect(app).toContain('path="/stage-manager"');
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

  it("⚠️⚠️ Operations kept a door when Reports & Metrics stopped opening it", () => {
    /* Josh, 2026-09-22: "Reports and metrics - just say No reports available
       yet - and have a blank screen". That tab was Operations' ONLY route:
       §5.44 took System Management off the settings menu, so blanking
       `/operations` alone would have taken "today's baseline vs live" out of
       the product — §5.39f's failure for the third time, and silently, because
       the route keeps answering. */
    const h = header();
    expect(h, "Daily operations left the settings menu").toContain(
      'navigate("/system-mgmt?tab=operations")',
    );
    // And the tab really is blank now, so this door is the only one.
    const page = live(read("pages/OperationsPage.tsx"));
    expect(page).toContain("No reports available yet");
    expect(page, "the Reports tab is borrowing Operations again").not.toContain("<OperationsTab");
    // The tool itself is untouched and still wired into System Management.
    expect(sysMgmt()).toContain('label="Operations"');
    expect(sysMgmt()).toContain("<OperationsTab");
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
