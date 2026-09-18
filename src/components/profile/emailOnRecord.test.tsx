import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { IntakeMessages } from "./IntakeMessages";

/**
 * Welcome Call can put an email ON the record (§5.31h).
 *
 * The card has always had an email tab and it was DEAD for most Welcome Call
 * patients: `text_mm1xc140` is blank on ~80% of them and that stage had no
 * field anywhere that writes it. These tests guard the three properties that
 * make adding one safe rather than merely possible:
 *
 *  1. **Opt-in.** Without `onSaveEmail` the card is byte-identical, because the
 *     intake page already edits this column through `intakeEditsFor` and two
 *     writers for one column is how they disagree (§5.31c).
 *  2. **The refusal runs BEFORE the write.** Everything downstream joins on this
 *     exact string — the Calendly mirror (§5.15), the "Call scheduled" chip
 *     (§5.31e), the Gmail thread read — so a typo does not fail loudly, it reads
 *     as "not booked" and "no previous emails" for ever.
 *  3. **The draft cannot outlive a patient switch** — §9's notes-box bug with an
 *     email address in it.
 */

// jsdom has no layout, so the card's scroll-to-latest effect throws on mount.
// Not a property under test — every render here would die in the effect.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

vi.mock("@/lib/assignedPatients/messagingApi", () => ({
  fetchConversation: vi.fn().mockResolvedValue({ messages: [], complete: true }),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  messagingConfigured: () => true,
}));

vi.mock("@/lib/shared/emailThreads", () => ({
  fetchEmailThreads: vi.fn().mockResolvedValue([]),
  fetchEmailThread: vi.fn().mockResolvedValue([]),
  sendEmailReply: vi.fn().mockResolvedValue(undefined),
  replyHeadersFor: () => ({}),
  GmailScopeMissingError: class extends Error {},
}));

const openEmailTab = () =>
  fireEvent.click(screen.getByRole("button", { name: /^email$/i }));

const emailInput = () => screen.getByLabelText(/patient email/i) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /save to monday/i });

beforeEach(() => {
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("without onSaveEmail — the intake page, unchanged", () => {
  it("offers no way to add an address", () => {
    render(<IntakeMessages patientId="1" email="" phone="5555550100" />);
    openEmailTab();
    expect(screen.getByText("No email address on file.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add email/i })).toBeNull();
  });

  it("offers no way to change one either", () => {
    render(<IntakeMessages patientId="1" email="pat@example.com" phone="5555550100" />);
    openEmailTab();
    expect(screen.queryByRole("button", { name: /change email/i })).toBeNull();
  });
});

describe("the email editor", () => {
  it("adds an address the stage had no other way to record", async () => {
    const onSaveEmail = vi.fn().mockResolvedValue(undefined);
    render(<IntakeMessages patientId="1" email="" phone="5555550100" onSaveEmail={onSaveEmail} />);
    openEmailTab();
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    fireEvent.change(emailInput(), { target: { value: "  pat@example.com  " } });
    fireEvent.click(saveButton());

    // Trimmed: the Calendly join and the Gmail search match verbatim, and a
    // stray space is a match that silently finds nothing.
    await waitFor(() => expect(onSaveEmail).toHaveBeenCalledWith("pat@example.com"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("REFUSES a malformed address before any write, and says why", () => {
    const onSaveEmail = vi.fn().mockResolvedValue(undefined);
    render(<IntakeMessages patientId="1" email="" phone="5555550100" onSaveEmail={onSaveEmail} />);
    openEmailTab();
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    fireEvent.change(emailInput(), { target: { value: "pat.example.com" } });

    // The complaint is on screen BEFORE the press — a greyed-out Save with no
    // stated reason is the dead end §5.10/§5.20/§5.31c each record reversing.
    expect(screen.getByText(/doesn't look like an email address/i)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(onSaveEmail).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The rep's text survives so they can fix it rather than retype it.
    expect(emailInput().value).toBe("pat.example.com");
  });

  it("opens on the value the BOARD holds when correcting one", () => {
    render(
      <IntakeMessages patientId="1" email="typo@exmaple.com" phone="5555550100" onSaveEmail={vi.fn()} />,
    );
    openEmailTab();
    fireEvent.click(screen.getByRole("button", { name: /change email/i }));
    expect(emailInput().value).toBe("typo@exmaple.com");
  });

  it("treats a blank as a deliberate clear, like the phone editor beside it", async () => {
    const onSaveEmail = vi.fn().mockResolvedValue(undefined);
    render(
      <IntakeMessages patientId="1" email="pat@example.com" phone="5555550100" onSaveEmail={onSaveEmail} />,
    );
    openEmailTab();
    fireEvent.click(screen.getByRole("button", { name: /change email/i }));
    fireEvent.change(emailInput(), { target: { value: "" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaveEmail).toHaveBeenCalledWith(""));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("keeps the editor open with the draft when the board write FAILS", async () => {
    const onSaveEmail = vi.fn().mockRejectedValue(new Error("Monday 503"));
    render(<IntakeMessages patientId="1" email="" phone="5555550100" onSaveEmail={onSaveEmail} />);
    openEmailTab();
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    fireEvent.change(emailInput(), { target: { value: "pat@example.com" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(emailInput().value).toBe("pat@example.com");
  });

  it("Cancel writes nothing", () => {
    const onSaveEmail = vi.fn();
    render(<IntakeMessages patientId="1" email="" phone="5555550100" onSaveEmail={onSaveEmail} />);
    openEmailTab();
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    fireEvent.change(emailInput(), { target: { value: "pat@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onSaveEmail).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/patient email/i)).toBeNull();
  });
});

/**
 * ⚠️ `onSave` is re-bound to whoever is open, so a draft that survives a sidebar
 * click is one Save from writing the PREVIOUS patient's address onto the OPEN
 * one. The card is mounted without a key by both pages, so the editor carries
 * `key={patientId}` itself.
 *
 * ⚠️ TWO things enforce this today and only one of them is about email: the key,
 * and the card's own `setTab("text")` on a patient change, which unmounts the
 * whole email body. The behavioural test below therefore proves the OUTCOME and
 * cannot isolate the key — remove the key and it still passes, because the tab
 * reset covers it. The source scan is what pins the key, so a future change to
 * that unrelated effect cannot quietly take the guarantee with it.
 */
describe("the editor is keyed by patient", () => {
  it("is keyed in the source", () => {
    const src = readFileSync("src/components/profile/IntakeMessages.tsx", "utf8");
    expect(src).toMatch(/<EmailAddressRow\s+key=\{patientId\}/);
  });

  it("no draft survives a patient switch", () => {
    const onSaveEmail = vi.fn();
    const { rerender } = render(
      <IntakeMessages patientId="1" email="" phone="5555550100" onSaveEmail={onSaveEmail} />,
    );
    openEmailTab();
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    fireEvent.change(emailInput(), { target: { value: "first@example.com" } });

    rerender(<IntakeMessages patientId="2" email="" phone="5555550100" onSaveEmail={onSaveEmail} />);
    openEmailTab();
    expect(screen.queryByLabelText(/patient email/i)).toBeNull();
    expect(screen.getByRole("button", { name: /add email/i })).toBeInTheDocument();
  });
});

/**
 * Who passes it. Welcome Call is the stage with no other route; the intake page
 * must NOT pick it up quietly, or that column has two writers.
 */
describe("the opt-in stays opt-in", () => {
  it("Welcome Call passes it", () => {
    const src = readFileSync("src/components/welcomeCall/WelcomeCallForm.tsx", "utf8");
    expect(src).toMatch(/<IntakeMessages[\s\S]{0,600}onSaveEmail=\{onSaveEmail\}/);
  });

  it("the page wires it to the board writer, not to the overlay", () => {
    const src = readFileSync("src/pages/WelcomeCallPage.tsx", "utf8");
    const handler = src.slice(src.indexOf("const handleSaveEmail"));
    expect(handler.slice(0, 400)).toMatch(/sendEmailToMonday\(selected\.id, email\)/);
    // An overlay entry would light the header's Save button for work already
    // durably written — and this stage's send never writes COL.email at all,
    // so it would never land (§5.32d).
    expect(handler.slice(0, 400)).not.toMatch(/update\(/);
  });

  it("the intake page does NOT", () => {
    const src = readFileSync("src/pages/UnverifiedReferralsPage.tsx", "utf8");
    expect(src).not.toMatch(/onSaveEmail/);
  });
});
