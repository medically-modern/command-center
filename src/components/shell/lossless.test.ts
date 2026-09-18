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
const teamGrid = () => live(read("components/shell/TeamGrid.tsx"));

describe("⚠️ every manager tool still has a door in the redesign", () => {
  /** Where each one is reachable from. A tool with no door has left the app. */
  const doors: Array<[string, string, () => string]> = [
    ["Oversight", "/oversight", header],
    ["Operations", "/system-mgmt?tab=operations", header],
    ["Stage Manager", "/system-mgmt?tab=stageManager", header],
    ["System Management", "/system-mgmt", header],
    ["Access & permissions", "/access", header],
  ];

  for (const [label, route, src] of doors) {
    it(`${label} is reachable (${route})`, () => {
      expect(src()).toContain(route);
    });
  }

  it("the Manage menu renders them for a manager", () => {
    const h = header();
    expect(h).toMatch(/managerish && \(/);
    expect(h).toContain('title="Manager tools"');
  });

  it("Manage Access is ALSO on the team screen the roster rail became", () => {
    // The rail's footer carried it; dropping the rail dropped it, and the
    // header's Users button is admin-only — a manager who is not an admin
    // would have had no route to /access at all.
    expect(teamGrid()).toContain('navigate("/access")');
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
