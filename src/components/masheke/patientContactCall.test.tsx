/**
 * The patient header's Call button (CLAUDE.md §5.50) — Josh, 2026-09-24:
 * *"the phone number throughout the command center doesnt call. i just went to
 * my name in subscription and clicked call and nothing happened. it should NOT
 * open ring central and should call directly from the app"*.
 *
 * It used to be an `<a href="tel:">`: a handoff to whatever the computer maps
 * phone links to, which is the RingCentral app on some machines and nothing at
 * all on others.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/shared/DialPatientDialog", () => ({
  DialPatientDialog: ({ phone, name }: { phone: string; name: string }) => (
    <div data-testid="dial" data-phone={phone} data-name={name} />
  ),
}));

import { PatientContact } from "./mmKit";

afterEach(cleanup);

describe("PatientContact — Call dials in the Command Center", () => {
  it("opens the in-app dial popup, never a tel: link", () => {
    const { container } = render(<PatientContact phone="(555) 555-0100" patientName="Jane Doe" />);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(screen.queryByTestId("dial")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /555.*0100/ }));
    const dial = screen.getByTestId("dial");
    expect(dial).toHaveAttribute("data-phone", "5555550100");
    expect(dial).toHaveAttribute("data-name", "Jane Doe");
  });

  // Patient Intake and the Care Coordinator card own a dial-then-log flow.
  it("hands the press to the page's own dialog when it has one", () => {
    const onCall = vi.fn();
    render(<PatientContact phone="(555) 555-0100" onCall={onCall} />);
    fireEvent.click(screen.getByRole("button", { name: /555.*0100/ }));
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("dial")).toBeNull();
  });

  it("carries the Communications button beside it, and no Text or Calls button", () => {
    render(<PatientContact phone="(555) 555-0100" />);
    expect(screen.getByRole("button", { name: /^Communications$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Text$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Calls/ })).toBeNull();
  });

  // The Insurance header already prints the number in its DOB line.
  it("can say 'Call' instead of printing the number twice, and still names it", () => {
    render(<PatientContact phone="(555) 555-0100" callLabel="Call" />);
    const call = screen.getByRole("button", { name: /^Call$/ });
    expect(call).toHaveAttribute("title", expect.stringContaining("555"));
  });

  it("says so when there is no number", () => {
    render(<PatientContact phone="" />);
    expect(screen.getByText("No phone on file")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
