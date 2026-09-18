/**
 * ⚠️⚠️ **THE LAYOUT SWITCH MUST BE REVERSIBLE FROM INSIDE BOTH LAYOUTS.**
 *
 * It shipped as a ONE-WAY DOOR on 2026-09-18: the toggle lived only in the
 * global header's gear menu, and "as today" removes the header — so switching
 * away deleted the only control that could switch back, on every page at once.
 * Reported the same day: *"i saw it for a minute and then pressed show me the
 * original view and never was able to get back"*.
 *
 * Everything here is that failure, pinned.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DEFAULT_LAYOUT, applyLayoutFromUrl, readLayout } from "@/lib/shell/layout";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/** Source with comments stripped, so "is this live?" is a real question. */
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join("\n");

vi.mock("@/lib/shared/auth", () => ({
  authRequired: () => false,
  signOut: () => {},
  getUser: () => null,
}));

describe("⚠️ the way back", () => {
  beforeEach(() => localStorage.clear());

  it("is in the settings popover, which renders in BOTH layouts", async () => {
    const { ThemePickerButton } = await import("@/components/ThemePicker");
    localStorage.setItem("mm-shell-layout", "current");
    render(<ThemePickerButton />);
    fireEvent.click(screen.getByTitle("Settings"));

    // Stuck in "as today": the control offered must take you BACK.
    const back = screen.getByText("Switch to the new layout");
    fireEvent.click(back);
    expect(readLayout()).toBe("redesign");
  });

  it("offers the other direction once you are in the redesign", async () => {
    const { ThemePickerButton } = await import("@/components/ThemePicker");
    localStorage.setItem("mm-shell-layout", "redesign");
    render(<ThemePickerButton />);
    fireEvent.click(screen.getByTitle("Settings"));
    expect(screen.getByText("Switch to the layout as it was")).toBeTruthy();
  });

  it("⚠️ the gear menu is NOT the only writer any more", () => {
    // The whole bug: one call site, inside a menu that one layout deletes.
    const writers = ["components/shell/GlobalHeader.tsx", "components/ThemePicker.tsx"]
      .filter((f) => live(read(f)).includes("setLayout("));
    expect(writers.length).toBeGreaterThanOrEqual(2);
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

describe("⚠️ nothing may cover the settings button", () => {
  // It is sign-out AND the layout escape hatch, and it sits at
  // `fixed bottom-4 left-4 z-40`. The call notices were at the same corner
  // with z-[60] and pointer events on, and a browser reported the click
  // intercepted by them — along with "Manage Access" in the old sidebar.
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

  it("and it clears the button visually, so the hatch stays findable", () => {
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
