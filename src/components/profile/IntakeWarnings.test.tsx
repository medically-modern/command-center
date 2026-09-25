/**
 * The warnings panel (§5.20b), rendered. The pop-up was DELETED on
 * 2026-09-25 (Brandon: "get rid of that big pop-up that comes up when you
 * click into their profile") — its removal is pinned at the bottom.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as IW from "./IntakeWarnings";
const { IntakeWarningsPanel } = IW;
import { parseIntakeWarnings } from "@/lib/profile/intakeWarnings";
import { ANTHEM_PANEL_HEADLINE, ANTHEM_STATES_TEXT, anthemNetworkGuidance } from "@/lib/profile/networkVerdict";
import type { IntakeWarningsState } from "@/hooks/profile/useIntakeWarnings";

const RAW = [
  "MEDICAID_MCO_OON|BLOCK|The Medicaid plan on file is an MCO we are not contracted with.",
  "MEDICARE_PUMP_MEDICAID_ID|CONFIRM:Has NY Medicaid ID|Confirm the Medicaid ID.",
  "UHC_AETNA_PUMP_MGMT|CONFIRM:Management approved|Needs management approval.",
].join("\n");

function state(over: Partial<IntakeWarningsState> = {}): IntakeWarningsState {
  return {
    warnings: parseIntakeWarnings(RAW),
    acks: [],
    verdict: "yes",
    anthem: null,
    gatePatient: null,
    busyKey: null,
    toggle: vi.fn(async () => true),
    markCheckStarted: vi.fn(),
    ...over,
  };
}

describe("IntakeWarningsPanel", () => {
  it("shows a BLOCK in full with what to do, and every CONFIRM as a box", () => {
    render(<IntakeWarningsPanel state={state()} />);
    expect(screen.getByText(/not contracted with/)).toBeInTheDocument();
    expect(screen.getByText("This patient can't be advanced. Let them know.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Has NY Medicaid ID/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Management approved/ })).not.toBeChecked();
    expect(screen.getByText("3 open")).toBeInTheDocument();
  });

  it("ticking an ordinary box writes straight away", () => {
    const s = state();
    render(<IntakeWarningsPanel state={s} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Has NY Medicaid ID/ }));
    expect(s.toggle).toHaveBeenCalledWith(s.warnings[1], true);
  });

  it("an override asks for the reason first, and won't save without one", async () => {
    const s = state();
    render(<IntakeWarningsPanel state={s} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Management approved/ }));
    expect(s.toggle).not.toHaveBeenCalled();
    const save = screen.getByRole("button", { name: "Save and tick" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Reason for/ }), { target: { value: "Corey OK'd it" } });
    await act(async () => { fireEvent.click(save); });
    expect(s.toggle).toHaveBeenCalledWith(s.warnings[2], true, "Corey OK'd it");
    // Saved: the reason box closes.
    expect(screen.queryByRole("textbox", { name: /Reason for/ })).not.toBeInTheDocument();
  });

  it("a ticked box reads as ticked and stops counting as open", () => {
    render(<IntakeWarningsPanel state={state({ acks: ["MEDICARE_PUMP_MEDICAID_ID"] })} />);
    expect(screen.getByRole("checkbox", { name: /Has NY Medicaid ID/ })).toBeChecked();
    expect(screen.getByText("2 open")).toBeInTheDocument();
  });

  it("locks every box while a check is running", () => {
    render(<IntakeWarningsPanel state={state()} disabled />);
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
  });

  it("shows the Check with patient note on its own, too — and its heading NAMES the states (Brandon, 2026-09-25)", () => {
    const anthem = anthemNetworkGuidance({ stediAddress: "22 Oak Ave, Scranton, PA 18503" });
    render(<IntakeWarningsPanel state={state({ warnings: [], anthem, verdict: "checkWithPatient" })} />);
    const note = screen.getByRole("note");
    // "Let's just add the 4 states to this warning at bottom of benefit
    // check" — plus Wyoming, which Josh added; the heading reads the one
    // shared constant so it cannot drift from the backend's verdict.
    expect(note).toHaveTextContent(ANTHEM_PANEL_HEADLINE);
    expect(note).toHaveTextContent(`In network only if they live in ${ANTHEM_STATES_TEXT}`);
    expect(note).toHaveTextContent("Insurance has them in PA");
    expect(note).toHaveTextContent("confirm where they live before moving forward");
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = render(<IntakeWarningsPanel state={state({ warnings: [], anthem: null })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the pop-up stays deleted (Brandon, 2026-09-25)", () => {
  it("⚠️ the module exports NO dialog — the panel is the one place the check speaks", () => {
    expect("IntakeWarningsDialog" in IW).toBe(false);
  });
});
