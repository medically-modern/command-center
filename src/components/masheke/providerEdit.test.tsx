/**
 * Provider edits on Medical Evaluation — two reports, 2026-09-29:
 *  - *"I updated the fax number for [a patient]'s provider in Confirm Receipt
 *    and I can't send the fax again"*
 *  - *"I obtained new provider details for a patient. I'm not easily seeing
 *    where I can update this information … from Send Request stage."*
 *
 * The editor sat behind "Show details" AND a small Edit toggle, and what it
 * held reached Monday only when the stage advanced. These pin the visible door,
 * the Save provider write, and the rule that a draft belongs to its patient.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Patient } from "@/lib/masheke/workflow";

const saveDoctorEdits = vi.fn<(id: string, draft: Record<string, string>) => Promise<void>>();
vi.mock("@/lib/masheke/mondayApi", () => ({
  saveDoctorEdits: (id: string, draft: Record<string, string>) => saveDoctorEdits(id, draft),
}));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));
// Header furniture that reads the network — irrelevant here.
vi.mock("@/components/shared/DoctorNotesPanel", () => ({ DoctorNotesPanel: () => null }));
vi.mock("@/components/shared/PatientProfileStatus", () => ({ MashekeProfileStatus: () => null }));
vi.mock("@/components/shared/FaxStatusBadge", () => ({ FaxStatusBadge: () => null }));
vi.mock("@/components/shared/DialPatientDialog", () => ({ DialPatientDialog: () => null }));
vi.mock("@/components/comms/CommunicationsButton", () => ({ CommunicationsButton: () => null }));

import { SendRequestHeaderCard } from "./SendRequestHeaderCard";

const FIRST: Patient = {
  id: "111",
  name: "Test Patient",
  doctorName: "Test Doctor",
  doctorFax: "2155550199@rcfax.com",
  doctorPhone: "2155550199",
  clinicalsMethod: "Fax",
} as Patient;
const OTHER: Patient = { ...FIRST, id: "222", name: "Other Patient", doctorFax: "7185550123@rcfax.com" } as Patient;

/** The page: an overlay that takes the card's patches, like useMondayPatients. */
function Page({ start }: { start: Patient }) {
  const [patients, setPatients] = useState<Record<string, Patient>>({ [FIRST.id]: FIRST, [OTHER.id]: OTHER });
  const [id, setId] = useState(start.id);
  const selected = patients[id];
  return (
    <>
      <button onClick={() => setId(id === FIRST.id ? OTHER.id : FIRST.id)}>switch</button>
      <SendRequestHeaderCard
        patient={selected}
        onDoctorEdit={(patch) => setPatients((p) => ({ ...p, [selected.id]: { ...p[selected.id], ...patch } }))}
      />
    </>
  );
}

const faxBox = () =>
  within(screen.getByText("Doctor Fax", { selector: "p" }).parentElement as HTMLElement).getByRole("textbox");

beforeEach(() => {
  saveDoctorEdits.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
  toastSuccess.mockReset();
});
afterEach(cleanup);

describe("the provider editor is one click away", () => {
  it("Edit provider opens the edit grid without hunting through Show details", () => {
    render(<Page start={FIRST} />);
    expect(screen.queryByText("Doctor Fax", { selector: "p" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Edit provider/ }));
    expect(faxBox()).toHaveValue("2155550199@rcfax.com");
  });

  it("is not offered where the page gives no editor", () => {
    render(<SendRequestHeaderCard patient={FIRST} />);
    expect(screen.queryByRole("button", { name: /Edit provider/ })).toBeNull();
  });
});

describe("Save provider writes to Monday now", () => {
  it("writes only what the rep changed, and shows the fax as the board stores it", async () => {
    render(<Page start={FIRST} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit provider/ }));
    const save = screen.getByRole("button", { name: /Save provider to Monday/ });
    expect(save).toBeDisabled(); // nothing changed yet
    fireEvent.change(faxBox(), { target: { value: "(215) 555-0100" } });
    expect(save).toBeEnabled();
    await act(async () => {
      fireEvent.click(save);
    });
    expect(saveDoctorEdits).toHaveBeenCalledWith("111", { doctorFax: "(215) 555-0100" });
    expect(toastSuccess).toHaveBeenCalled();
    expect(faxBox()).toHaveValue("2155550100@rcfax.com");
    expect(save).toBeDisabled(); // saved — nothing pending
  });

  it("refuses a fax that would save but go nowhere, and writes nothing", async () => {
    render(<Page start={FIRST} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit provider/ }));
    fireEvent.change(faxBox(), { target: { value: "215555010" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save provider to Monday/ }));
    });
    expect(saveDoctorEdits).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Fix these before saving", expect.anything());
  });

  it("keeps the edit on screen when Monday refuses, so it can be retried", async () => {
    saveDoctorEdits.mockRejectedValueOnce(new Error("Doctor Fax: boom"));
    render(<Page start={FIRST} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit provider/ }));
    fireEvent.change(faxBox(), { target: { value: "2155550100" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save provider to Monday/ }));
    });
    expect(toastError).toHaveBeenCalledWith("Couldn't save provider details", expect.anything());
    expect(faxBox()).toHaveValue("2155550100");
    expect(screen.getByRole("button", { name: /Save provider to Monday/ })).toBeEnabled();
  });

  it("a draft belongs to its patient — switching never saves it onto the next one", () => {
    render(<Page start={FIRST} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit provider/ }));
    fireEvent.change(faxBox(), { target: { value: "2155550100" } });
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    // The card isn't keyed by patient; the grid is still open, on OTHER now.
    expect(faxBox()).toHaveValue("7185550123@rcfax.com");
    expect(screen.getByRole("button", { name: /Save provider to Monday/ })).toBeDisabled();
  });

  it("…and the unsaved edit is still saveable after switching back", async () => {
    render(<Page start={FIRST} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit provider/ }));
    fireEvent.change(faxBox(), { target: { value: "2155550100" } });
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save provider to Monday/ }));
    });
    expect(saveDoctorEdits).toHaveBeenCalledTimes(1);
    expect(saveDoctorEdits).toHaveBeenCalledWith("111", { doctorFax: "2155550100" });
  });
});

/**
 * The two send surfaces, scanned (the panels need the whole board read to
 * render). Each check fails with its fix removed.
 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SEND = strip(readFileSync("src/components/masheke/SendRequestPanel.tsx", "utf8"));
const CONFIRM = strip(readFileSync("src/components/masheke/ConfirmReceiptPanel.tsx", "utf8"));

describe("a corrected fax reaches the send", () => {
  it("Send Request's To box follows the doctor's contact after mount", () => {
    // Seeded once at mount, it kept the old number however the header changed.
    // The rule is tested in doctorEdits.test.ts; this pins that it is CALLED.
    const effect = SEND.slice(SEND.indexOf("const prefillRef"), SEND.indexOf("}, [chanValue]);"));
    expect(effect.length).toBeGreaterThan(100);
    expect(effect).toContain("followDoctorContact(recipients, prev, next)");
    expect(effect).toContain("setRecipients(followed)");
  });

  it("Confirm Receipt's Re-send unlocks when the number changes", () => {
    const effect = CONFIRM.slice(CONFIRM.indexOf("const recipientRef"), CONFIRM.indexOf("}, [recipient]);"));
    expect(effect).toContain("setFaxResent(false)");
    expect(effect).toContain("setResentNow(false)");
  });
});
