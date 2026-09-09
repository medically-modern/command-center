import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmCheck } from "./CallIntakeFields";
import { emptyIntake, type CallIntake } from "@/lib/welcomeCall/callIntake";
import { pumpConfirmLabel } from "@/lib/welcomeCall/sendGates";

/**
 * ⚠️ Ticking the pump confirmation must RECORD the model, not just the boolean.
 * The field existed for a commit before the checkbox wrote to it, so every new
 * confirmation saved blank — which the staleness rule then reads as stale
 * forever. Greptile caught it on PR #55; this is the pin.
 */
const renderCheck = (intake: CallIntake, pumpType: string) => {
  const onChange = vi.fn();
  render(
    <ConfirmCheck
      intake={intake}
      onChange={onChange}
      field="pump"
      label={pumpConfirmLabel(pumpType)}
      recordPumpModel={pumpType}
    />,
  );
  return onChange;
};

describe("the pump confirmation checkbox", () => {
  it("records the model on tick", () => {
    const onChange = renderCheck(emptyIntake(), "t:slim");
    fireEvent.click(screen.getByRole("checkbox"));
    const next = onChange.mock.calls[0][0] as CallIntake;
    expect(next.confirmed.pump).toBe(true);
    expect(next.pumpConfirmedModel).toBe("t:slim");
  });

  it("clears the model on untick", () => {
    // A stored model with no tick behind it reads back as a confirmation
    // nobody made.
    const i = emptyIntake();
    i.confirmed.pump = true;
    i.pumpConfirmedModel = "t:slim";
    const onChange = renderCheck(i, "t:slim");
    fireEvent.click(screen.getByRole("checkbox"));
    const next = onChange.mock.calls[0][0] as CallIntake;
    expect(next.confirmed.pump).toBe(false);
    expect(next.pumpConfirmedModel).toBe("");
  });

  it("names the model in the label", () => {
    renderCheck(emptyIntake(), "Mobi");
    expect(screen.getByText(/Pump type confirmed verbally with the patient \(Mobi\)/)).toBeTruthy();
  });

  it("⚠️ leaves pumpConfirmedModel alone for a non-pump check", () => {
    // Only the pump check passes recordPumpModel; the address check must not
    // touch the field.
    const onChange = vi.fn();
    render(<ConfirmCheck intake={emptyIntake()} onChange={onChange} field="address" />);
    fireEvent.click(screen.getByRole("checkbox"));
    const next = onChange.mock.calls[0][0] as CallIntake;
    expect(next.confirmed.address).toBe(true);
    expect(next.pumpConfirmedModel).toBe("");
  });
});
