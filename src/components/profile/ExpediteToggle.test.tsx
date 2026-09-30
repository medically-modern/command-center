/**
 * The Expedited tick (§5.56): who sees it, and what a press does.
 *
 * Run: npx vitest run src/components/profile/ExpediteToggle.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  accessType: "manager" as "manager" | "processor",
  writeExpedited: vi.fn(async () => true),
}));
vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ({ access: { type: mocks.accessType } }),
}));
vi.mock("@/lib/profile/expedite", () => ({ writeExpedited: mocks.writeExpedited }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { ExpediteToggle } from "./ExpediteToggle";
import type { Patient } from "@/lib/profile/workflow";

const patient = (over: Partial<Patient> = {}) => ({ id: "42", name: "Pat", ...over }) as Patient;

function mount(p: Patient, disabled = false) {
  const onLocal = vi.fn();
  const onSettled = vi.fn();
  const view = render(<ExpediteToggle patient={p} onLocal={onLocal} onSettled={onSettled} disabled={disabled} />);
  return { ...view, onLocal, onSettled };
}

beforeEach(() => {
  mocks.accessType = "manager";
  mocks.writeExpedited.mockReset();
  mocks.writeExpedited.mockResolvedValue(true);
});

describe("who sees it", () => {
  it("a manager gets a live checkbox", () => {
    mount(patient());
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    expect(box).toBeEnabled();
  });

  it("a processor sees NOTHING on a normal patient", () => {
    mocks.accessType = "processor";
    const { container } = mount(patient());
    expect(container.querySelector(".xp-line")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("a processor sees an expedited patient's mark, read-only", () => {
    mocks.accessType = "processor";
    mount(patient({ expedited: "Expedited" }));
    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
  });

  it("the page can switch it off mid-save", () => {
    mount(patient(), true);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});

describe("a press", () => {
  it("shows the tick at once, writes the board, and settles once Monday reads it back", async () => {
    const { onLocal, onSettled } = mount(patient());
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onLocal).toHaveBeenCalledWith("42", { expedited: "Expedited" });
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith("42"));
    expect(mocks.writeExpedited).toHaveBeenCalledWith("42", true);
  });

  it("unticking clears", async () => {
    const { onLocal } = mount(patient({ expedited: "Expedited" }));
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onLocal).toHaveBeenCalledWith("42", { expedited: "" });
    await waitFor(() => expect(mocks.writeExpedited).toHaveBeenCalledWith("42", false));
  });

  it("not read back yet: keeps the overlay (no settle), so an Advance still carries it", async () => {
    mocks.writeExpedited.mockResolvedValue(false);
    const { onSettled } = mount(patient());
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(mocks.writeExpedited).toHaveBeenCalled());
    await Promise.resolve();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("a failed write puts the old value back", async () => {
    mocks.writeExpedited.mockRejectedValue(new Error("boom"));
    const { onLocal, onSettled } = mount(patient());
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith("42"));
    expect(onLocal).toHaveBeenLastCalledWith("42", { expedited: "" });
  });
});
