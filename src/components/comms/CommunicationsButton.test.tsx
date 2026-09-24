/**
 * `CommunicationsButton` owns what must outlive the popup: whether it is open,
 * and the composer's drafts (CLAUDE.md §5.50). It inherited the old Text
 * button's contract — Patient Intake opens it from its own buttons with a
 * template in the box, and stamps its Call Log from every text sent — and a
 * regression there is silent: the wrong template, or a Call Log with no record
 * of a link that went out.
 *
 * The popup's body is stubbed: it is the hub's timeline, tested on its own.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/comms/CommunicationsView", () => ({
  CommunicationsView: (p: {
    phone: string;
    altPhone?: string;
    name: string;
    draftFor: (k: string) => string;
    setDraftFor: (k: string, t: string) => void;
    onTextSent?: (b: string) => void;
  }) => {
    const key = p.phone.replace(/\D/g, "").slice(-10);
    return (
      <div data-testid="view" data-phone={p.phone} data-alt={p.altPhone ?? ""}>
        <textarea
          aria-label="draft"
          value={p.draftFor(key)}
          onChange={(e) => p.setDraftFor(key, e.target.value)}
        />
        <button type="button" onClick={() => p.onTextSent?.(p.draftFor(key))}>
          stub send
        </button>
      </div>
    );
  },
}));

import { CommunicationsButton } from "./CommunicationsButton";

afterEach(cleanup);

const openIt = () => fireEvent.click(screen.getByRole("button", { name: /^Communications$/ }));
const draft = () => screen.getByLabelText("draft") as HTMLTextAreaElement;
const closeIt = () => fireEvent.click(screen.getByRole("button", { name: "Close" }));

describe("CommunicationsButton", () => {
  it("renders nothing with no usable number, so every header can drop it in", () => {
    const { container } = render(<CommunicationsButton phone="" />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<CommunicationsButton phone="555-0100" />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("opens full screen, titled with whose communications they are", () => {
    render(<CommunicationsButton phone="(555) 555-0100" altPhone="555-555-0199" patientName="Jane Doe" />);
    expect(screen.queryByTestId("view")).toBeNull();
    openIt();
    expect(screen.getByRole("dialog", { name: "Communications with Jane Doe" })).toBeInTheDocument();
    expect(screen.getByTestId("view")).toHaveAttribute("data-alt", "555-555-0199");
    closeIt();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps what the rep typed across a close and re-open", () => {
    render(<CommunicationsButton phone="(555) 555-0100" />);
    openIt();
    fireEvent.change(draft(), { target: { value: "Calling you back now" } });
    closeIt();
    openIt();
    expect(draft().value).toBe("Calling you back now");
  });

  // ⚠️ Patient Intake's Start Insurance Follow-Up: the page pushes the popup
  // open with a template. An UNTOUCHED template is thrown away on close, so
  // the next plain open starts empty.
  it("seeds a template from an outside open, and discards it untouched", () => {
    const { rerender } = render(
      <CommunicationsButton phone="(555) 555-0100" textPrefill="Here is your upload link" open />,
    );
    expect(draft().value).toBe("Here is your upload link");
    closeIt();
    rerender(<CommunicationsButton phone="(555) 555-0100" />);
    openIt();
    expect(draft().value).toBe("");
  });

  it("never overwrites words the rep already typed with a template", () => {
    const { rerender } = render(<CommunicationsButton phone="(555) 555-0100" />);
    openIt();
    fireEvent.change(draft(), { target: { value: "my own words" } });
    closeIt();
    rerender(<CommunicationsButton phone="(555) 555-0100" textPrefill="A template" open />);
    expect(draft().value).toBe("my own words");
  });

  // ⚠️ §9's notes-box rule: a half-typed text must never follow a sidebar
  // click onto somebody else.
  it("clears every draft on a change of patient", () => {
    const { rerender } = render(<CommunicationsButton phone="(555) 555-0100" />);
    openIt();
    fireEvent.change(draft(), { target: { value: "for the first patient" } });
    closeIt();
    rerender(<CommunicationsButton phone="(555) 555-0142" />);
    openIt();
    expect(draft().value).toBe("");
  });

  it("tells the page about every text sent (Patient Intake's Call Log stamp)", () => {
    const onTextSent = vi.fn();
    render(<CommunicationsButton phone="(555) 555-0100" onTextSent={onTextSent} />);
    openIt();
    fireEvent.change(draft(), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "stub send" }));
    expect(onTextSent).toHaveBeenCalledWith("hello");
  });

  it("reports its own close to the page that opened it", () => {
    const onOpenChange = vi.fn();
    render(<CommunicationsButton phone="(555) 555-0100" onOpenChange={onOpenChange} />);
    openIt();
    closeIt();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
