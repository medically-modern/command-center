/**
 * The embedded stage panels (§5.39c) — the two things that are silent when they
 * break, and the sub-stage rule.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { subStagesFor, defaultSubStage, SUB_STAGES, hasSubStagePanels } from "@/lib/patient/stagePanels";
import type { DossierItem } from "@/lib/commsHub/dossier";

const read = (p: string) => readFileSync(p, "utf8");
/**
 * ⚠️ **A source scan must read CODE, not prose.** Both files document the very
 * writers they must not call — naming `writeLongText` and `useMondayPatients`
 * is how the reasoning survives — so a raw-text scan fails on its own comments
 * and the only way to pass it is to delete the explanation. Comments are
 * stripped, both the line and the block kind.
 */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const EMBED = read("src/components/patient/StagePanelEmbed.tsx");
const EMBED_CODE = code(EMBED);
const VIEW = read("src/components/patient/OnboardingView.tsx");

const item = (over: Partial<DossierItem>): DossierItem =>
  ({
    itemId: "1",
    name: "A",
    phone: "",
    boardId: 18406060017,
    boardName: "Medical Evaluation",
    groupId: "g",
    groupTitle: "2. Medical Necessity",
    isCompleted: false,
    isStuck: false,
    isProposedStuck: false,
    escalationText: "",
    escalationLevel: null,
    dob: "",
    route: "/evaluate",
    stageAdvancerText: "",
    notes: "",
    notesColId: "",
    notesColType: null,
    nextActionDate: "",
    daysSinceStage: "",
    cols: {},
    ...over,
  }) as DossierItem;

describe("which tools a record has been through", () => {
  it("everything at or before the item's own sub-stage is reached", () => {
    const steps = subStagesFor(item({ stageAdvancerText: "Confirm Receipt" }));
    expect(steps.map((s) => `${s.label}:${s.reached ? "y" : "n"}`)).toEqual([
      "Evaluate:y",
      "Send Request:y",
      "Confirm Receipt:y",
      "Chase Clinicals:n",
      "Doctor Appts:n",
    ]);
    expect(steps.filter((s) => s.current).map((s) => s.key)).toEqual(["Confirm Receipt"]);
  });

  it("a COMPLETED record has reached every tool, whatever its advancer says", () => {
    // The advancer is routinely left on the last working value rather than a
    // terminal one, so reading position alone greys out the tools a manager
    // opens a finished record to read.
    const steps = subStagesFor(item({ isCompleted: true, stageAdvancerText: "Evaluate MN" }));
    expect(steps.every((s) => s.reached)).toBe(true);
    // …and none of them is "live", because the patient is not there any more.
    expect(steps.some((s) => s.current)).toBe(false);
  });

  it("an UNRECOGNISED advancer greys out nothing", () => {
    // A blank column, or a label added to the board since — neither is evidence
    // the patient skipped a step, and hiding a tool on that basis is the one
    // direction this must never fail in.
    for (const raw of ["", "Something New"]) {
      const steps = subStagesFor(item({ stageAdvancerText: raw }));
      expect(steps.every((s) => s.reached)).toBe(true);
      expect(steps.some((s) => s.current)).toBe(false);
    }
  });

  it("opens on where the patient is, else the last step they reached", () => {
    expect(defaultSubStage(subStagesFor(item({ stageAdvancerText: "Chase Clinicals" })))).toBe("Chase Clinicals");
    expect(defaultSubStage(subStagesFor(item({ isCompleted: true, stageAdvancerText: "x" })))).toBe("Doctor Appointment");
  });

  it("a board with no embeddable tools has no toggle", () => {
    // Profile Send Off: its two tools render inline in 2,000- and 4,000-line
    // pages, so there is nothing to embed and nothing to toggle between.
    expect(subStagesFor(item({ boardId: 18406352652 }))).toEqual([]);
    expect(hasSubStagePanels(18406352652)).toBe(false);
    expect(hasSubStagePanels(18406060017)).toBe(true);
  });
});

describe("the embed cannot write", () => {
  it("renders inside an `inert` wrapper", () => {
    // ⚠️ This is the guard, not a style: every internal write in the ten panels
    // sits in an event handler, and `inert` stops the handler running. Losing
    // it makes a read-only audit screen live.
    expect(EMBED).toMatch(/inert=""/);
    expect(EMBED).toMatch(/className="stage-embed"/);
  });

  it("hands every panel a no-op instead of a writer", () => {
    expect(EMBED_CODE).toMatch(/const NOOP = \(\) => \{\};/);
    // No callback prop is wired to anything that could reach Monday.
    expect(EMBED_CODE).not.toMatch(/mondayWrite|writeLongText|runVerifiedSend|sendPatientToMonday/);
    expect(EMBED_CODE).not.toMatch(/change_(multiple_)?column_value/);
  });

  it("switches off the live fax poll", () => {
    // ⚠️ `useFaxStatus` polls RingCentral out to ~33 minutes / 56 requests when
    // a fax went out TODAY (§5.9b). Behind a frozen panel nobody can act on the
    // answer, so it is waste — and RingCentral is the shared account
    // INCIDENT_2026-08-20 took down. Both panels that carry it are gated.
    expect(EMBED_CODE).toMatch(/<SendRequestPanel[^>]*embedded/);
    expect(EMBED_CODE).toMatch(/<ConfirmReceiptPanel[^>]*embedded/);
    const sr = code(read("src/components/masheke/SendRequestPanel.tsx"));
    const cr = code(read("src/components/masheke/ConfirmReceiptPanel.tsx"));
    expect(sr).toMatch(/const faxActive = !embedded &&/);
    expect(cr).toMatch(/const faxActive = !embedded &&/);
    // …and the live pages still poll, because there the chip is the whole point.
    expect(code(read("src/pages/SendRequestPage.tsx"))).not.toMatch(/embedded/);
    expect(code(read("src/pages/ConfirmReceiptPage.tsx"))).not.toMatch(/embedded/);
  });

  it("mounts the PANEL, never the page's polling hook", () => {
    // `masheke/useMondayPatients` backfills a blank Next Action Date and
    // self-heals a stale escalation ON READ — a screen that only looks must not
    // trigger that (§5.30), and a second 30-second board poll behind the
    // patient screen is INCIDENT_2026-08-20's shape.
    expect(EMBED_CODE).not.toMatch(/useMondayPatients/);
    expect(EMBED_CODE).not.toMatch(/setInterval|setTimeout/);
  });
});

describe("the view and the embed agree about which tools have a panel", () => {
  it("every PANELLED pair has a case in panelFor, and vice versa", () => {
    // ⚠️ A pair listed in the view with no case here renders an empty panel AND
    // no fallback cards — a blank screen that reads as broken rather than as a
    // missing feature.
    const listed = [...VIEW.matchAll(/"(\d{11}):([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(listed.length).toBe(10);
    for (const pair of listed) {
      const [board, key] = pair.split(/:(.*)/s);
      expect(EMBED, `panelFor has no case for ${pair}`).toContain(`boardId === ${board}`);
      expect(EMBED, `panelFor has no case for ${pair}`).toContain(`case "${key}":`);
    }
    // And every case in panelFor is one the view will actually reach.
    const cases = [...EMBED.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);
    for (const key of cases) {
      expect(listed.some((p) => p.endsWith(`:${key}`)), `panelFor renders ${key} but the view never asks for it`).toBe(true);
    }
  });

  it("every panelled sub-stage is a real key in SUB_STAGES", () => {
    // The key IS the board's own Stage Advancer label — the join. A typo here
    // matches no record and the tab simply never resolves.
    const listed = [...VIEW.matchAll(/"(\d{11}):([^"]+)"/g)];
    for (const [, board, key] of listed) {
      const defs = SUB_STAGES[Number(board)];
      expect(defs, `board ${board} is not in SUB_STAGES`).toBeDefined();
      expect(defs.map((s) => s.key)).toContain(key);
    }
  });

  it("a sub-stage with no page offers no link", () => {
    // Auth Denied is deliberately unbuilt (§7), so its route is empty and
    // `subStageOpenHref` returns null rather than a dead link.
    const denied = SUB_STAGES[18410601299].find((s) => s.key === "Auth Denied");
    expect(denied?.route).toBe("");
  });
});

describe("the Open link survives", () => {
  it("is still rendered, and aims at the selected sub-stage", () => {
    // Josh, 2026-09-21: "add the per page pannels he has but leave the link to
    // open them." The embed is read-only, so the link is the only route to a
    // tool a rep can work in.
    expect(VIEW).toMatch(/<OpenTool item=\{snap\} tool=\{tool\} \/>/);
    expect(VIEW).toMatch(/subStageOpenHref\(item, tool\.route\)/);
    expect(VIEW).toMatch(/\?\? itemOpenHref\(item\)/);
  });
});
