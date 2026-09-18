/**
 * ⚠️⚠️ **A MANAGER'S HOME PAGE MUST NOT BE A BLANK SCREEN.**
 *
 * Removing the Managers/Processors rail (§5.39c) left `Index`'s `rosterReplaced`
 * branch rendering `DashboardMainView person={null}` — an icon, the word
 * "Dashboard", and one line telling the reader to use a dropdown that only shows
 * OTHER people's screens. That was the whole of a manager's landing page.
 * Reported as *"the views are super wrong"* (Josh, 2026-09-18) and confirmed by
 * rendering it: 900px of empty page.
 *
 * The roster is the CONTENT of that screen. The ask was to move it off the left
 * rail, so it moves into the main area — it does not disappear.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/** Source with comments stripped, so "is this live?" is a real question. */
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join("\n");

describe("⚠️ the roster moved, it did not vanish", () => {
  const index = live(read("pages/Index.tsx"));

  it("the no-sidebar branch renders the team, not an empty dashboard", () => {
    // The branch must reach TeamGrid. Before this it went straight to
    // DashboardMainView with a null person, which is the blank card.
    expect(index).toContain("TeamGrid");
    expect(index).toMatch(/<TeamGrid[\s\S]{0,200}people=\{visiblePeople\}/);
  });

  it("DashboardMainView is only reached with a person selected", () => {
    // The blank state is still correct for the OLD layout (which has a sidebar
    // to point at), so it is not deleted — it is just never the landing page of
    // a screen with no roster on it.
    const branch = index.slice(index.indexOf("if (rosterReplaced)"), index.indexOf("if (rosterReplaced)") + 1400);
    expect(branch).toMatch(/selectedPerson \?[\s\S]*DashboardMainView person=\{selectedPerson\}/);
    expect(branch).not.toMatch(/DashboardMainView person=\{selectedPerson\}[\s\S]{0,80}\)\s*;?\s*$/);
  });

  it("a selected person has a way back to the team", () => {
    // Without it, picking somebody is a one-way trip on a screen whose only
    // other control borrows a DIFFERENT person's view — the dead end §5.39d
    // records for the layout switch, one level down.
    const branch = index.slice(index.indexOf("if (rosterReplaced)"), index.indexOf("if (rosterReplaced)") + 1400);
    expect(branch).toMatch(/setSelectedKey\(""\)/);
    expect(branch).toContain("Team");
  });
});

describe("⚠️ what the rail carried comes with it", () => {
  const grid = live(read("components/shell/TeamGrid.tsx"));

  it("keeps Oversight and Manage Access reachable", () => {
    // Both lived in the sidebar's chrome — the "Managers" tab and the footer
    // button — so dropping the rail dropped them with it.
    expect(grid).toContain('navigate("/oversight")');
    expect(grid).toContain('navigate("/access")');
  });

  it("selects with ?user=, never ?viewing=", () => {
    // `?user=` is the MANAGER's view of that person (their bars, their
    // workload); `?viewing=` is that person's own home screen (§5.39c). Two
    // different questions — the grid answers the first, as the sidebar did.
    expect(grid).toContain("onSelect");
    expect(grid).not.toContain("viewing");
  });

  it("says the same thing the sidebar said about each person", () => {
    // One wording, so the two screens cannot disagree about who is a manager
    // or how many bars somebody has.
    expect(grid).toContain("Manager · ");
    expect(grid).toContain("Full access");
    expect(grid).toContain("No roles");
  });

  it("an empty roster names the move that fixes it", () => {
    // A fresh config is a real state, and it must not read like the blank
    // screen this component replaced.
    expect(grid).toMatch(/Nobody is set up yet/);
  });

  it("writes nothing", () => {
    for (const forbidden of ["mondayWrite", "change_column_value", "executeWritesWithVerification"]) {
      expect(grid).not.toContain(forbidden);
    }
  });
});
