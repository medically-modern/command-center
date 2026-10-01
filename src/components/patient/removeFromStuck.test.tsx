/**
 * Remove from Stuck on the patient screen (§5.57) — beside the red Stuck chip,
 * managers only, and nothing written until the manager confirms a stage.
 * FAKE data only; Monday is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import { buildStages } from "@/lib/patient/patientScreen";

vi.mock("@/components/patient/StagePanelEmbed", () => ({
  StagePanelEmbed: ({ subStage }: { subStage: string }) => <p>Embedded {subStage}</p>,
  StagePanelUnavailable: ({ tool }: { tool: string }) => <p>No panel for {tool}</p>,
}));

const ctx = vi.hoisted(() => ({
  access: { type: "manager" } as unknown,
  email: "",
  config: { managers: [], processors: {} } as unknown,
}));
vi.mock("@/components/AccessProvider", () => ({ useAccessContext: () => ctx }));

const api = vi.hoisted(() => ({
  readStuckOrigin: vi.fn(),
  removeFromStuck: vi.fn(),
}));
vi.mock("@/lib/oversight/removeFromStuckApi", () => api);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { OnboardingView } from "./OnboardingView";
import { STUCK_PLANS } from "@/lib/oversight/removeFromStuck";

const WC = 18410804557;
const WC_PLAN = STUCK_PLANS[WC];

function item(over: Partial<DossierItem> = {}): DossierItem {
  return {
    itemId: "900",
    name: "Pat Example",
    phone: "5555550100",
    boardId: WC,
    boardName: "Welcome Call",
    groupId: "group_mm1xyczx",
    groupTitle: "Stuck",
    isCompleted: false,
    isStuck: true,
    escalationText: "Done",
    escalationLevel: null,
    isProposedStuck: false,
    dob: "01/02/1970",
    route: "/welcome-call",
    stageAdvancerText: "Stuck / Don't Proceed",
    notes: "",
    notesColId: "text_mm6vqq2k",
    notesColType: "text",
    nextActionDate: "",
    daysSinceStage: "",
    createdAt: "",
    cols: {},
    ...over,
  };
}

function renderView(it: DossierItem, onChanged = vi.fn()) {
  const d: PatientDossier = {
    name: it.name,
    phone: "5555550100",
    active: it.isStuck ? null : it,
    path: [],
    alsoOn: [],
    items: [it],
  };
  const steps = buildStages(d);
  const stepIdx = steps.findIndex((s) => s.items.some((x) => x.itemId === it.itemId));
  render(
    <MemoryRouter>
      <div className="cc-pt">
        <OnboardingView
          dossier={d}
          steps={steps}
          stepIdx={stepIdx}
          onStep={() => {}}
          snapId=""
          onSnap={() => {}}
          toolKey=""
          onTool={() => {}}
          onChanged={onChanged}
        />
      </div>
    </MemoryRouter>,
  );
  return { onChanged };
}

beforeEach(() => {
  ctx.access = { type: "manager" };
  api.readStuckOrigin.mockReset();
  api.removeFromStuck.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
});

describe("the button", () => {
  it("a manager gets it, beside the red Stuck chip", () => {
    api.readStuckOrigin.mockReturnValue(new Promise(() => {}));
    renderView(item());
    const chip = screen.getByText(/Stuck — out of the pipeline/);
    const btn = screen.getByRole("button", { name: /Remove from Stuck/ });
    // Same row as the chip — Brandon: "next to the stuck warning on top".
    expect(btn.parentElement).toBe(chip.parentElement);
    // Opening it writes nothing.
    expect(api.removeFromStuck).not.toHaveBeenCalled();
  });

  it("⚠️ a processor does not", () => {
    ctx.access = { type: "processor", profile: { name: "Rep", roles: ["welcomeCall"] } };
    renderView(item());
    expect(screen.getByText(/Stuck — out of the pipeline/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove from Stuck/ })).toBeNull();
  });

  it("not on a record that is not Stuck", () => {
    renderView(
      item({ groupId: "group_mm1wvq8p", groupTitle: "Welcome Call", isStuck: false, stageAdvancerText: "Welcome Call" }),
    );
    expect(screen.queryByRole("button", { name: /Remove from Stuck/ })).toBeNull();
  });
});

describe("the panel", () => {
  it("preselects where Monday's history says they were, and the press saves to Monday", async () => {
    const welcome = WC_PLAN.targets.find((t) => t.key === "welcomeCall")!;
    api.readStuckOrigin.mockResolvedValue({
      origin: { fromGroupId: "group_mm1wvq8p", fromGroupTitle: "Welcome Call", fromAdvancerIndex: 7, fromAdvancerText: "Welcome Call" },
      target: welcome,
    });
    api.removeFromStuck.mockResolvedValue({ groupTitle: "Welcome Call", alreadyOut: false, noteSaved: true });
    const { onChanged } = renderView(item());

    fireEvent.click(screen.getByRole("button", { name: /Remove from Stuck/ }));
    await screen.findByText(/moved to Stuck from Welcome Call/);
    expect(api.readStuckOrigin).toHaveBeenCalledTimes(1);
    const select = screen.getByLabelText("Back to") as HTMLSelectElement;
    expect(select.value).toBe("welcomeCall");
    // The caveat for this step is on screen before the press.
    expect(screen.getByText(/cleared rather than set back/)).toBeTruthy();

    const confirm = screen.getAllByRole("button", { name: /Remove from Stuck/ }).at(-1)!;
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(api.removeFromStuck).toHaveBeenCalledTimes(1));
    const call = api.removeFromStuck.mock.calls[0][0];
    expect(call.target.key).toBe("welcomeCall");
    expect(call.itemId).toBe("900");
    expect(call.notes).toEqual({ columnId: "text_mm6vqq2k", columnType: "text" });
    // Josh: "with a notif that it sucessfully sent to monday".
    expect(toast.success).toHaveBeenCalledWith(
      "Pat Example removed from Stuck",
      expect.objectContaining({ description: "Saved to Monday — back in Welcome Call." }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("with no history, nothing is preselected and the press waits for a pick", async () => {
    api.readStuckOrigin.mockResolvedValue({ origin: null, target: null });
    renderView(item());
    fireEvent.click(screen.getByRole("button", { name: /Remove from Stuck/ }));
    await screen.findByText(/doesn't show where they were/);
    const select = screen.getByLabelText("Back to") as HTMLSelectElement;
    expect(select.value).toBe("");
    const confirm = screen.getAllByRole("button", { name: /Remove from Stuck/ }).at(-1)! as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(select, { target: { value: "finalConfirm" } });
    expect(confirm.disabled).toBe(false);
  });

  it("a failed write says so, keeps the panel, and re-reads nothing", async () => {
    api.readStuckOrigin.mockResolvedValue({ origin: null, target: WC_PLAN.targets[0] });
    api.removeFromStuck.mockRejectedValue(new Error("Monday still shows this patient as Stuck"));
    const { onChanged } = renderView(item());
    fireEvent.click(screen.getByRole("button", { name: /Remove from Stuck/ }));
    await screen.findByText(/Monday's history/);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Remove from Stuck/ }).at(-1)!);
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Monday still shows this patient as Stuck/).length).toBeGreaterThan(0);
  });
});
