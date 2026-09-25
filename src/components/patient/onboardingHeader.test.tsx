/**
 * The Onboarding view's snapshot header — Brandon's layout (pixel-match
 * Phase 2) over our real read-only tool: the stage heading, the sub-step tabs
 * with a check on the ones passed, the Snapshot / Live chip, the grey
 * Read-only chip, and "Open <tool>". FAKE data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import { buildStages } from "@/lib/patient/patientScreen";
import { INFO_COL } from "@/lib/patient/infoStrip";

vi.mock("@/components/patient/StagePanelEmbed", () => ({
  StagePanelEmbed: ({ subStage }: { subStage: string }) => <p>Embedded {subStage}</p>,
  StagePanelUnavailable: ({ tool }: { tool: string }) => <p>No panel for {tool}</p>,
}));

/** The signed-in person's RESOLVED access — what gates the Open link
 *  (2026-09-25). The default is a manager, which is also what the §5.3
 *  bootstrap resolves everyone to while `managers[]` is empty — so every
 *  test written before the gate behaves exactly as it did. */
const ctx = vi.hoisted(() => ({ access: { type: "manager" } as unknown }));
vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ctx,
}));

import { OnboardingView } from "./OnboardingView";

const MED = 18406060017;

function item(over: Partial<DossierItem> = {}): DossierItem {
  return {
    itemId: "1",
    name: "Jane Sample",
    phone: "5555550100",
    boardId: MED,
    boardName: "Medical Evaluation",
    groupId: "g",
    groupTitle: "2. Medical Necessity",
    isCompleted: false,
    isStuck: false,
    escalationText: "",
    escalationLevel: null,
    isProposedStuck: false,
    dob: "03/14/1958",
    route: "/confirm-receipt",
    stageAdvancerText: "Confirm Receipt",
    notes: "",
    notesColId: "",
    notesColType: null,
    nextActionDate: "",
    daysSinceStage: "",
    createdAt: "",
    cols: { [INFO_COL[MED].stageStart!]: "2026-09-01" },
    ...over,
  };
}

const dossierOf = (items: DossierItem[], active: DossierItem | null): PatientDossier => ({
  name: "Jane Sample",
  phone: "5555550100",
  active,
  path: [],
  alsoOn: [],
  items,
});

function renderView(
  items: DossierItem[],
  active: DossierItem | null,
  opts: { onTool?: (k: string) => void; toolKey?: string } = {},
) {
  const d = dossierOf(items, active);
  const steps = buildStages(d);
  const stepIdx = steps.findIndex((s) => s.stage.key === "mn");
  return render(
    <MemoryRouter>
      <div className="cc-pt">
        <OnboardingView
          dossier={d}
          steps={steps}
          stepIdx={stepIdx}
          onStep={() => {}}
          snapId=""
          onSnap={() => {}}
          toolKey={opts.toolKey ?? ""}
          onTool={opts.onTool ?? (() => {})}
        />
      </div>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T16:00:00Z"));
  ctx.access = { type: "manager" };
});
afterEach(() => vi.useRealTimers());

describe("the snapshot header", () => {
  it("his stage heading: the name, where it stands, and how long they've been here", () => {
    const live = item();
    renderView([live], live);
    expect(screen.getByRole("heading", { name: "Medical Evaluation" })).toBeInTheDocument();
    expect(screen.getByText(/5 steps · in progress · the tool below shows today's values/)).toBeInTheDocument();
    // 9/1 → 9/24 is 23 days: past a fortnight, so red.
    const chip = screen.getByText(/23 days here/);
    expect(chip.className).toContain("red");
  });

  it("the sub-step tabs: a check on each step passed, a dot where they are, the rest locked", () => {
    const live = item();
    renderView([live], live);
    const tabs = within(screen.getByRole("tablist", { name: "Steps on this board" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Evaluate",
      "Send Request",
      "Confirm Receipt",
      "Chase Clinicals",
      "Doctor Appts",
    ]);
    expect(tabs[0].querySelector("svg")).not.toBeNull();
    expect(tabs[1].querySelector("svg")).not.toBeNull();
    expect(tabs[2].querySelector("svg")).toBeNull();
    expect(tabs[2].querySelector(".dot")).not.toBeNull();
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs[3]).toBeDisabled();
  });

  it("picking a passed step asks for it, and the chip then says those are TODAY's values", () => {
    const onTool = vi.fn();
    const live = item();
    const { unmount } = renderView([live], live, { onTool });
    expect(screen.getByText("Live — the patient is here now")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Send Request/ }));
    expect(onTool).toHaveBeenCalledWith("Send Request");
    unmount();
    // Opened on that passed step: not a snapshot, and not where they are.
    renderView([live], live, { toolKey: "Send Request" });
    expect(screen.getByText("Live record · today's values")).toBeInTheDocument();
    expect(screen.queryByText("Live — the patient is here now")).toBeNull();
  });

  it("his grey Read-only chip and 'Open <tool>' for the step shown", () => {
    const live = item();
    renderView([live], live);
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Confirm Receipt/ })).toHaveAttribute(
      "href",
      expect.stringContaining("/confirm-receipt"),
    );
    expect(screen.getByText("Embedded Confirm Receipt")).toBeInTheDocument();
  });

  it("⚠️ a finished record is a green Snapshot, and Open still lands in review mode", () => {
    const done = item({ isCompleted: true, stageAdvancerText: "Chase Clinicals" });
    renderView([done], null);
    expect(screen.getByText(/Snapshot · as it looked when this stage was left/)).toBeInTheDocument();
    const open = screen.getByRole("link", { name: /Open / });
    expect(open.getAttribute("href")).toContain("completedStage=");
    expect(open).toHaveAttribute("title", expect.stringContaining("review mode"));
    // No "days here" on a stage the patient has left.
    expect(screen.queryByText(/days here/)).toBeNull();
  });

  it("⚠️ two records on one stage keep their own row — his sample never has two", () => {
    const old = item({ itemId: "1", isCompleted: true, groupTitle: "Completed" });
    const live = item({ itemId: "2" });
    renderView([old, live], live);
    expect(screen.getByText("This patient has 2 profiles in this stage")).toBeInTheDocument();
  });
});

describe("⚠️⚠️ the Open link is ROLE-GATED (Josh, 2026-09-25)", () => {
  // "people who are assigned the ROLE of final profile confirmation should
  // see it — people who arent assigned that rols shouldnt see it and it
  // should be the read only thing." The read-only embed renders for everyone;
  // only the door into the live tool follows the role.
  it("a processor ASSIGNED the tool's role gets the door", () => {
    ctx.access = { type: "processor", profile: { name: "Rep", roles: ["confirmReceipt"] } };
    const live = item();
    renderView([live], live);
    expect(screen.getByRole("link", { name: /Open Confirm Receipt/ })).toBeInTheDocument();
  });

  it("a processor WITHOUT the role sees no link — and still gets the read-only embed", () => {
    ctx.access = { type: "processor", profile: { name: "Rep", roles: ["welcomeCall", "finalConfirm"] } };
    const live = item();
    renderView([live], live);
    expect(screen.queryByRole("link", { name: /Open / })).toBeNull();
    expect(screen.getByText("Embedded Confirm Receipt")).toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
  });

  it("a manager keeps every door — §5.3's model, applied to the link", () => {
    ctx.access = { type: "manager" };
    const live = item();
    renderView([live], live);
    expect(screen.getByRole("link", { name: /Open Confirm Receipt/ })).toBeInTheDocument();
  });

  it("⚠️ the gate covers a COMPLETED record's review-mode door too", () => {
    // A non-assigned rep loses nothing they could act on: the embed below
    // shows the same frozen record.
    ctx.access = { type: "processor", profile: { name: "Rep", roles: ["benefits"] } };
    const done = item({ isCompleted: true, stageAdvancerText: "Chase Clinicals" });
    renderView([done], null);
    expect(screen.queryByRole("link", { name: /Open / })).toBeNull();
  });
});
