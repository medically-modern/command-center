/**
 * The "office replied, no new records" card, rendered.
 *
 * The rules are covered in lib/subscription/recordsReply.test.ts. This is
 * about the two things only the DOM can show: that the card reaches the screen
 * at all, and that what a rep presses produces the write this feature promised.
 *
 * The one that matters most is the appointment date. Writing it arms a real
 * fax to the office, so a test that it can only leave here attached to "Same
 * old records" is a test about what lands in somebody's fax machine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const recordRecordsReplyVerified = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/subscription/mondayWrite", () => ({
  recordRecordsReplyVerified: (...args: unknown[]) => recordRecordsReplyVerified(...args),
  saveVisitDateVerified: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RecordsReplyCard } from "./UpdateClinicalsPage";
import type { ClinicalsRow } from "./UpdateClinicalsPage";

const PATIENT: ClinicalsRow = {
  id: "3000000003",
  name: "Sam Sample",
  board: "subscription",
  boardLabel: "Subscription",
  stage: "Active",
  mr: "MR Expired",
  mnExpiry: "2026-06-01",
};

const onSaved = vi.fn();
const setup = () => render(<RecordsReplyCard patient={PATIENT} onSaved={onSaved} />);
const pick = (label: string) => fireEvent.click(screen.getByText(label));
const save = () => fireEvent.click(screen.getByRole("button", { name: /record reply/i }));
const saveBtn = () => screen.getByRole("button", { name: /record reply/i }) as HTMLButtonElement;

beforeEach(() => {
  recordRecordsReplyVerified.mockClear();
  onSaved.mockClear();
});

describe("the three answers reach the screen", () => {
  it("offers all three, and nothing else until one is picked", () => {
    setup();
    expect(screen.getByText("Same old records")).toBeTruthy();
    expect(screen.getByText("New provider")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /record reply/i })).toBeNull();
  });
});

describe("same old records", () => {
  it("records the choice on its own", async () => {
    setup();
    pick("Same old records");
    save();
    await waitFor(() => expect(recordRecordsReplyVerified).toHaveBeenCalled());
    expect(recordRecordsReplyVerified).toHaveBeenCalledWith("3000000003", {
      noteLine: "Same old records",
      apptDate: undefined,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("carries an appointment date through to the write", async () => {
    const { container } = setup();
    pick("Same old records");
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-10-13" } });
    save();
    await waitFor(() => expect(recordRecordsReplyVerified).toHaveBeenCalled());
    expect(recordRecordsReplyVerified).toHaveBeenCalledWith("3000000003", {
      noteLine: "Same old records — next appt 10/13/2026",
      apptDate: "2026-10-13",
    });
  });

  it("says what the date is going to do, since nothing else would", () => {
    const { container } = setup();
    pick("Same old records");
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2027-10-13" } });
    expect(screen.getByText(/ask the office again the day after this/i)).toBeTruthy();

    // A date already gone arms nothing, because monday fires date automations
    // on arrival and never retroactively. Still saveable, but say so.
    fireEvent.change(date, { target: { value: "2020-01-02" } });
    expect(screen.getByText(/already passed/i)).toBeTruthy();
    expect(saveBtn().disabled).toBe(false);
  });
});

describe("new provider", () => {
  it("is offered NO appointment date — that fax would go to the old office", () => {
    const { container } = setup();
    pick("New provider");
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it("saves without details, because the move itself is the news", async () => {
    setup();
    pick("New provider");
    save();
    await waitFor(() => expect(recordRecordsReplyVerified).toHaveBeenCalled());
    expect(recordRecordsReplyVerified).toHaveBeenCalledWith("3000000003", {
      noteLine: "New provider",
      apptDate: undefined,
    });
  });
});

describe("other", () => {
  it("will not save empty, and says why rather than just greying out", () => {
    setup();
    pick("Other");
    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByText(/records nothing/i)).toBeTruthy();
  });

  it("saves her words once they are there", async () => {
    setup();
    pick("Other");
    fireEvent.change(screen.getByPlaceholderText(/not been seen since 2025/i), {
      target: { value: "patient moved to Florida" },
    });
    expect(saveBtn().disabled).toBe(false);
    save();
    await waitFor(() => expect(recordRecordsReplyVerified).toHaveBeenCalled());
    expect(recordRecordsReplyVerified).toHaveBeenCalledWith("3000000003", {
      noteLine: "Other — patient moved to Florida",
      apptDate: undefined,
    });
  });
});

describe("changing your mind", () => {
  it("drops what belonged to the answer you moved off", async () => {
    // Type a provider, switch to Same old records, save. That text must not
    // ride along under a heading it was never written for.
    setup();
    pick("New provider");
    fireEvent.change(screen.getByPlaceholderText(/name, practice/i), { target: { value: "Dr Ruiz" } });
    pick("Same old records");
    expect(screen.queryByDisplayValue("Dr Ruiz")).toBeNull();

    save();
    await waitFor(() => expect(recordRecordsReplyVerified).toHaveBeenCalled());
    expect(recordRecordsReplyVerified).toHaveBeenCalledWith("3000000003", {
      noteLine: "Same old records",
      apptDate: undefined,
    });
  });

  it("lets you unpick an answer entirely", () => {
    setup();
    pick("Other");
    expect(screen.getByRole("button", { name: /record reply/i })).toBeTruthy();
    pick("Other");
    expect(screen.queryByRole("button", { name: /record reply/i })).toBeNull();
  });
});

describe("when the write fails", () => {
  it("keeps what she typed, so it is not retyped from memory", async () => {
    recordRecordsReplyVerified.mockRejectedValueOnce(new Error("Monday said no"));
    setup();
    pick("Other");
    fireEvent.change(screen.getByPlaceholderText(/not been seen since 2025/i), {
      target: { value: "office says chart is closed" },
    });
    save();
    await waitFor(() => expect(recordRecordsReplyVerified).toHaveBeenCalled());
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    expect(screen.getByDisplayValue("office says chart is closed")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
