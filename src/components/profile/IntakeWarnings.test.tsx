/**
 * The warnings panel and pop-up (§5.20b), rendered.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntakeWarningsDialog, IntakeWarningsPanel } from "./IntakeWarnings";
import { parseIntakeWarnings } from "@/lib/profile/intakeWarnings";
import { ANTHEM_NETWORK_HEADLINE, anthemNetworkGuidance } from "@/lib/profile/networkVerdict";
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
    hasNotices: true,
    dialogOpen: false,
    setDialogOpen: vi.fn(),
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

  it("shows the Check with patient note on its own, too", () => {
    const anthem = anthemNetworkGuidance({ stediAddress: "22 Oak Ave, Scranton, PA 18503" });
    render(<IntakeWarningsPanel state={state({ warnings: [], anthem, verdict: "checkWithPatient" })} />);
    expect(screen.getByRole("note")).toHaveTextContent("Insurance has them in PA");
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = render(<IntakeWarningsPanel state={state({ warnings: [], anthem: null })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("IntakeWarningsDialog", () => {
  it("lists the Anthem steps, the blocks and the confirmations", () => {
    const anthem = anthemNetworkGuidance({ stediAddress: "1 Main St, Newark, NJ 07102" });
    render(
      <IntakeWarningsDialog
        state={state({ dialogOpen: true, anthem, acks: ["MEDICARE_PUMP_MEDICAID_ID"] })}
        patientName="Test Patient"
      />,
    );
    expect(screen.getByText(ANTHEM_NETWORK_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText(/change Primary Insurance to Horizon BCBS/)).toBeInTheDocument();
    expect(screen.getByText("Can't be advanced")).toBeInTheDocument();
    expect(screen.getByText(/— confirmed/)).toBeInTheDocument();
  });

  it("Got it closes it", () => {
    const s = state({ dialogOpen: true });
    render(<IntakeWarningsDialog state={s} />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(s.setDialogOpen).toHaveBeenCalledWith(false);
  });
});
