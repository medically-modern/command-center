/**
 * ⚠️⚠️ **NOBODY MAY BE STRANDED IN A LAYOUT THEY CANNOT LEAVE.**
 *
 * The layout switch shipped as a ONE-WAY DOOR on 2026-09-18: the toggle lived
 * only in the global header's gear menu, and "as today" removes the header — so
 * switching away deleted the only control that could switch back, on every page
 * at once. Reported the same day: *"i saw it for a minute and then pressed show
 * me the original view and never was able to get back"*.
 *
 * ⚠️ **The TOGGLE was removed on 2026-09-21** (Josh: *"remove switch to tlayout
 * as it ws"*) — the redesign is the app now. That does not retire this file, it
 * changes what it has to prove: removing a control does not move the browsers
 * already sitting behind it, so the guarantee is now a one-time MIGRATION plus
 * `?layout=`, and both are pinned below.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_LAYOUT,
  applyLayoutFromUrl,
  migrateOffOldLayout,
  readLayout,
} from "@/lib/shell/layout";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/** Source with comments stripped, so "is this live?" is a real question. */
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join("\n");

describe("⚠️⚠️ the one-time migration off the old layout", () => {
  beforeEach(() => localStorage.clear());

  it("moves a browser stored on the old layout to the redesign", () => {
    // Without this, removing the toggle strands them: the old layout has no
    // header, the header is where the toggle was, so there is no way out but a
    // URL they have never been told about.
    localStorage.setItem("mm-shell-layout", "current");
    migrateOffOldLayout(false);
    expect(readLayout()).toBe("redesign");
  });

  it("leaves a browser already on the redesign alone", () => {
    localStorage.setItem("mm-shell-layout", "redesign");
    migrateOffOldLayout(false);
    expect(readLayout()).toBe("redesign");
  });

  it("⚠️ does NOT undo a deliberate ?layout=current in the same boot", () => {
    // The mechanism survives for comparison; it is just no longer a control
    // anybody lands on by accident. Honouring the param and then migrating it
    // away in the same breath would make the param look broken.
    localStorage.setItem("mm-shell-layout", "current");
    migrateOffOldLayout(true);
    expect(readLayout()).toBe("current");
  });

  it("runs from main.tsx, fed by whether the URL asked", () => {
    const main = live(read("main.tsx"));
    expect(main).toContain("migrateOffOldLayout(applyLayoutFromUrl())");
  });
});

describe("⚠️ the toggle is gone from every menu", () => {
  it("no component writes the layout any more", () => {
    // One settings menu now, in the header (Josh, 2026-09-21), and it does not
    // offer the old layout at all.
    const header = live(read("components/shell/GlobalHeader.tsx"));
    expect(header).not.toContain("setLayout(");
    expect(header).not.toContain("Switch to the layout as it was");
  });

  it("⚠️ and the floating lower-left gear it used to live in is deleted", () => {
    // "putt everything in the lower left setting into the upper right
    // settings" — its appearance switch, its six colour themes and its
    // sign-out are all on the header's gear menu.
    for (const f of ["pages/Index.tsx", "pages/ProcessorView.tsx"]) {
      expect(live(read(f)), f).not.toContain("ThemePickerButton");
    }
    const header = live(read("components/shell/GlobalHeader.tsx"));
    expect(header).toContain("THEMES.map(");
    expect(header).toContain("setAppearance(");
    expect(header).toContain("signOut");
  });
});

describe("⚠️ ?layout= recovers a browser from any page", () => {
  beforeEach(() => localStorage.clear());

  const at = (search: string) => {
    window.history.replaceState({}, "", `/patient/123${search}`);
    applyLayoutFromUrl();
  };

  it("applies the layout named in the URL", () => {
    at("?layout=current");
    expect(readLayout()).toBe("current");
    at("?layout=redesign");
    expect(readLayout()).toBe("redesign");
  });

  it("⚠️ STRIPS the param, keeping the rest of the query", () => {
    // Left on, every later navigation carries a one-off instruction, and a
    // copied link re-flips somebody else's browser.
    at("?board=18410804557&layout=redesign");
    expect(window.location.search).toBe("?board=18410804557");
    expect(window.location.pathname).toBe("/patient/123");
  });

  it("ignores an unrecognised value rather than inventing a third state", () => {
    localStorage.setItem("mm-shell-layout", "current");
    at("?layout=banana");
    expect(readLayout()).toBe("current");
    expect(window.location.search).toBe("?layout=banana");
  });

  it("runs before React, from main.tsx", () => {
    const main = live(read("main.tsx"));
    expect(main).toContain("applyLayoutFromUrl()");
    // Before the root renders, or a tree that renders nothing useful takes the
    // recovery down with it. ⚠️ Compared against the CALL, not the import —
    // `import { createRoot }` is line 1 and would pass this trivially.
    expect(main.indexOf("applyLayoutFromUrl()")).toBeLessThan(main.indexOf("createRoot(document"));
  });
});

describe('⚠️ "as today" renders today\'s app, and nothing from the redesign', () => {
  it("AppShell's current branch is still a bare fragment", () => {
    expect(live(read("components/shell/AppShell.tsx"))).toContain('if (layout !== "redesign") return <>{children}</>;');
  });

  it("⚠️ the home-view model is OFF — no Viewing strip over the old dashboard", () => {
    // It sits at the ROUTE, outside AppShell, so without this gate the strip
    // rendered above the manager dashboard with no header over it.
    const host = live(read("components/shell/HomeViewHost.tsx"));
    expect(host).toContain('const redesign = layout === "redesign"');
    expect(host).toContain("redesign && hasAbility(email, config, \"viewOthers\")");
    // The toggle too, not just the picker.
    expect(host).toMatch(/redesign \? homeViewsOf\(ownerEmail, config\)/);
  });

  it("the default is unchanged", () => {
    expect(DEFAULT_LAYOUT).toBe("redesign");
  });
});

describe("⚠️ the call notices may never intercept a click", () => {
  // They sit at `fixed bottom-4 left-4 z-[60]`, and with pointer events ON a
  // browser reported them swallowing clicks on whatever was underneath — the
  // old floating settings gear and the sidebar's "Manage Access". That gear has
  // since been deleted, but the rule is the one worth keeping: a status notice
  // is not a control and must not behave like one, whatever it happens to
  // cover next.
  it("the call notices cannot intercept a click, whatever they cover", () => {
    const host = live(read("components/inboundCalls/IncomingCallHost.tsx"));
    // The fix that holds however tall the stack grows or where it moves.
    expect(host).toMatch(/fixed bottom-\d+ left-4 z-\[60\][^"]*pointer-events-none/);
    expect(host).not.toMatch(/fixed bottom-\d+ left-4 z-\[60\][^"]*pointer-events-auto/);
  });

  it("but the one real control in them still takes clicks", () => {
    // Reload is the only interactive thing in either notice, and it is what a
    // rep presses when the stream is dead. pointer-events-none on the stack
    // would swallow it too without this.
    const note = live(read("components/inboundCalls/CallStreamStatus.tsx"));
    expect(note).toMatch(/pointer-events-auto[^"]*/);
    expect(note).toContain("Reload");
  });

  it("and it sits clear of the corner rather than on top of it", () => {
    const host = live(read("components/inboundCalls/IncomingCallHost.tsx"));
    expect(host).not.toContain("fixed bottom-4 left-4 z-[60]");
  });
});

describe("⚠️ no page may depend on the shell for its only way out", () => {
  it("the patient screen carries its own Back", () => {
    // Measured 0 controls leading anywhere in "as today" before this.
    const page = live(read("pages/PatientPage.tsx"));
    expect(page).toContain("useBackNavigation");
    expect(page).toContain("<BackRow />");
    // In EVERY branch, the error states included.
    const branches = (page.match(/className="cc-pt"/g) || []).length;
    expect((page.match(/<BackRow \/>/g) || []).length).toBe(branches);
  });
});
