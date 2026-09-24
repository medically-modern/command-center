/**
 * Communications opens as a RIGHT SIDE PANEL on the Care Coordinator dashboard
 * and nowhere else — a source scan, because the failure it guards against is a
 * shared component quietly reaching another screen.
 *
 * Brandon, 2026-09-24 (Masani dashboard notes): *"When we click
 * communications, let's just have it pop up on a right side-panel, don't need
 * to have a pop-up covering the entire screen"*. Josh chose that page only:
 * every other header keeps §5.50's full-screen pop-up. `PatientContact` is the
 * row on ELEVEN headers, and §5.30's two-screens table exists because a change
 * to it for one screen once undid a fix on another (the copy-number button,
 * `copyPhoneScope.test.ts`) — so the panel is opt-in and exactly one caller
 * opts in.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
/** Source with comments stripped — the files DOCUMENT the prop, and a scan of
 *  the raw text would count the explanation as a caller. */
const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the Communications side panel is the Care Coordinator card's alone", () => {
  it("is opt-in: the pop-up stays the default", () => {
    const button = read("components/comms/CommunicationsButton.tsx");
    expect(button).toContain('presentation = "popup"');
    // Non-modal only in panel mode — the pop-up stays modal, so everything
    // behind it stays unclickable exactly as §5.50 shipped it.
    expect(button).toContain("modal={!panel}");
  });

  it("exactly ONE component asks for the panel, and it is the dashboard card", () => {
    const callers = files
      .filter((f) => /commsPresentation="panel"|presentation="panel"/.test(code(f)))
      .map((f) => f.slice(SRC.length + 1));
    expect(callers).toEqual(["components/careCoordinator/PatientCard.tsx"]);
  });

  it("the row passes it through rather than deciding it", () => {
    const kit = read("components/masheke/mmKit.tsx");
    expect(kit).toContain("presentation={commsPresentation}");
  });

  it("opens one panel at a time, and outside clicks never close it", () => {
    const button = read("components/comms/CommunicationsButton.tsx");
    // A second card's button SWAPS the panel rather than stacking a second
    // one — two open composers, one of them hidden, is how a text goes to the
    // wrong patient.
    expect(button).toContain("PANEL.claim(panelId)");
    expect(button).toContain("if (id !== panelId) handleOpenChange(false)");
    expect(button).toContain("onInteractOutside={(e) => e.preventDefault()}");
  });

  it("stacks the fallback's texts and calls in the narrow panel", () => {
    // `lg:grid-cols-2` is a VIEWPORT breakpoint: in a ~760px panel on a wide
    // screen it would squeeze each half to ~380px.
    const view = read("components/comms/CommunicationsView.tsx");
    expect(view).toContain("narrow ? \"grid min-h-0 flex-1 grid-cols-1 grid-rows-2\"");
    expect(read("components/comms/CommunicationsButton.tsx")).toContain("narrow={panel}");
  });
});
