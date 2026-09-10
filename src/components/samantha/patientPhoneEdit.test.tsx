import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { BenefitsPatientHeader } from "./BenefitsPatientHeader";
import type { Patient } from "@/lib/samantha/workflow";

/**
 * The patient's phone is the ONE editable field on this header, and it is
 * opt-in per page (Auth Outstanding today — Josh, 2026-09-10).
 *
 * ⚠️ The property that actually matters here is the REFUSAL. `writePhone`
 * routes through `planPhoneWrite`, which SKIPS a value it cannot parse rather
 * than throwing — so without a check before the write, a 9-digit number saves
 * GREEN having written nothing (§10's optimistic-UI trap). These tests fail if
 * the guard is removed or moved after the save.
 */

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

const patient = (over: Partial<Patient> = {}) =>
  ({
    id: "1",
    name: "Test Patient",
    dob: "1970-01-01",
    patientPhone: "5555550100",
    ...over,
  }) as Patient;

/** The header's status badge reads `?completedStage=`, so it needs a router. */
const renderHeader = (props: Parameters<typeof BenefitsPatientHeader>[0]) =>
  render(
    <MemoryRouter>
      <BenefitsPatientHeader {...props} />
    </MemoryRouter>,
  );

const editButton = () => screen.getByRole("button", { name: /edit phone number/i });
const phoneInput = () => screen.getByLabelText(/patient phone number/i) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /^save$/i });

beforeEach(() => {
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("the header without onSavePhone", () => {
  it("offers no way to edit — Benefits and Submit Auth stay read-only", () => {
    renderHeader({ patient: patient() });
    expect(screen.getByText("(555) 555-0100")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit phone number/i })).toBeNull();
  });
});

describe("the phone editor", () => {
  it("opens on the number the board holds, not on a formatted copy", () => {
    renderHeader({ patient: patient(), onSavePhone: vi.fn() });
    fireEvent.click(editButton());
    expect(phoneInput().value).toBe("5555550100");
  });

  it("REFUSES a number Monday would silently drop, before any write", async () => {
    const onSavePhone = vi.fn().mockResolvedValue(undefined);
    renderHeader({ patient: patient(), onSavePhone });
    fireEvent.click(editButton());
    fireEvent.change(phoneInput(), { target: { value: "555-0100" } }); // 7 digits
    fireEvent.click(saveButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // The whole point: nothing was written, and nothing claimed it was.
    expect(onSavePhone).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(String(toastError.mock.calls[0][1]?.description)).toContain("7 digits");
    // The rep's text survives so they can fix it rather than retype it.
    expect(phoneInput().value).toBe("555-0100");
  });

  it("refuses an extension rather than truncating it to ten digits", async () => {
    // Slicing "917-968-9304 x12" to ten would store a number that reaches the
    // wrong person — worse than the refusal (shared/phoneCell.ts).
    const onSavePhone = vi.fn().mockResolvedValue(undefined);
    renderHeader({ patient: patient(), onSavePhone });
    fireEvent.click(editButton());
    fireEvent.change(phoneInput(), { target: { value: "555-555-0100 x12" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onSavePhone).not.toHaveBeenCalled();
  });

  it("saves a ten-digit number however the rep typed it", async () => {
    const onSavePhone = vi.fn().mockResolvedValue(undefined);
    renderHeader({ patient: patient(), onSavePhone });
    fireEvent.click(editButton());
    fireEvent.change(phoneInput(), { target: { value: " (555) 555-0199 " } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSavePhone).toHaveBeenCalledWith("(555) 555-0199"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // Closed, so the next render shows the board's own answer.
    expect(screen.queryByLabelText(/patient phone number/i)).toBeNull();
  });

  it("treats a blank as a deliberate clear, like every other phone writer", async () => {
    const onSavePhone = vi.fn().mockResolvedValue(undefined);
    renderHeader({ patient: patient(), onSavePhone });
    fireEvent.click(editButton());
    fireEvent.change(phoneInput(), { target: { value: "" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSavePhone).toHaveBeenCalledWith(""));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("keeps the editor open with the draft when the board write FAILS", async () => {
    const onSavePhone = vi.fn().mockRejectedValue(new Error("Monday 503"));
    renderHeader({ patient: patient(), onSavePhone });
    fireEvent.click(editButton());
    fireEvent.change(phoneInput(), { target: { value: "5555550199" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    // Closing here would discard a number the rep just read off a call.
    expect(phoneInput().value).toBe("5555550199");
  });

  it("Cancel writes nothing", () => {
    const onSavePhone = vi.fn();
    renderHeader({ patient: patient(), onSavePhone });
    fireEvent.click(editButton());
    fireEvent.change(phoneInput(), { target: { value: "5555550199" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onSavePhone).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/patient phone number/i)).toBeNull();
  });
});

/**
 * ⚠️ A draft that outlives a sidebar click is the §9 notes-box bug with a PHONE
 * NUMBER in it — one Save from writing the previous patient's number onto the
 * open one. The header is mounted WITHOUT a key by all three pages, so React
 * reuses it across a patient switch; the editor carries `key={patient.id}` for
 * exactly this. A source scan, because a lost key fails nothing at runtime.
 */
describe("the editor is keyed by patient", () => {
  it("resets on a patient switch", () => {
    const src = readFileSync("src/components/samantha/BenefitsPatientHeader.tsx", "utf8");
    expect(src).toMatch(/<PatientPhoneLine[\s\S]{0,120}key=\{patient\.id\}/);
  });

  it("really does clear the draft when the id changes", () => {
    const onSavePhone = vi.fn();
    const { rerender } = renderHeader({ patient: patient(), onSavePhone });
    fireEvent.click(editButton());
    fireEvent.change(phoneInput(), { target: { value: "5555550199" } });

    rerender(
      <MemoryRouter>
        <BenefitsPatientHeader
          patient={patient({ id: "2", name: "Other Patient", patientPhone: "5555550102" })}
          onSavePhone={onSavePhone}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/patient phone number/i)).toBeNull();
    expect(screen.getByText("(555) 555-0102")).toBeInTheDocument();
  });
});

/**
 * The scoping is a decision, not an accident: §7 records this header as
 * read-only for everyone after a manager Edit-profile dialog was deliberately
 * removed. Widening the phone edit to Benefits or Submit Auth should be
 * somebody's call, so this fails the build if a page picks it up quietly.
 */
describe("which pages opt in", () => {
  const read = (f: string) => readFileSync(f, "utf8");

  it("Auth Outstanding passes onSavePhone", () => {
    expect(read("src/pages/AuthOutstandingPage.tsx")).toContain("onSavePhone=");
  });

  it("Benefits and Submit Auth deliberately do not", () => {
    expect(read("src/pages/ChaseBenefitsPage.tsx")).not.toContain("onSavePhone");
    expect(read("src/pages/SubmitAuthPage.tsx")).not.toContain("onSavePhone");
  });

  it("the write goes to the patient-phone column, straight to the board", () => {
    // Not into the overlay: `hasOverlay` drives Save Progress, and the send
    // that would carry it is the stage mover (weeks away).
    const src = read("src/pages/AuthOutstandingPage.tsx");
    expect(src).toMatch(/writePhone\(\s*selected\.id,\s*COL\.patientPhone/);
    expect(src).not.toMatch(/update\([^)]*patientPhone/);
  });
});
