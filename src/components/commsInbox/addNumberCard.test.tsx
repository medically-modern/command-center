/**
 * The unmatched → patient card (COMMS_INBOX_PLAN.md §6), rendered.
 *
 * `lib/commsInbox/addNumber.test.ts` owns the RULE; this pins the WIRING the
 * rule cannot see: which buttons the card draws for each case, that a click
 * reaches the Monday writer and the link in that order, and that the handler
 * refuses a write the button already hid (§5.39h — the button is what a rep
 * sees, the handler is what stops the write).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";

const m = vi.hoisted(() => ({
  canEdit: true,
  calls: [] as string[],
  updatePatientContact: vi.fn(async (_o: Record<string, unknown>) => {}),
  linkNumber: vi.fn(async (_o: Record<string, unknown>) => ({ key: "p:18410804557:123" })),
  forgetDirectoryName: vi.fn((_k: string) => {}),
  invalidateInbox: vi.fn(() => {}),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/shell/AbilityLock", () => ({
  useAbility: () => m.canEdit,
  AbilityLockNote: () => <p>Edit profile is not assigned.</p>,
}));
vi.mock("@/lib/commsHub/dossierApi", () => ({
  updatePatientContact: (o: Record<string, unknown>) => {
    m.calls.push("monday");
    return m.updatePatientContact(o);
  },
}));
vi.mock("@/lib/commsInbox/api", () => ({
  linkNumber: (o: Record<string, unknown>) => {
    m.calls.push("link");
    return m.linkNumber(o);
  },
}));
vi.mock("@/hooks/commsHub/useDirectoryNames", () => ({ forgetDirectoryName: (k: string) => m.forgetDirectoryName(k) }));
vi.mock("@/hooks/commsInbox/useInbox", () => ({ invalidateInbox: () => m.invalidateInbox() }));
vi.mock("sonner", () => ({ toast: m.toast }));

import AddNumberCard from "./AddNumberCard";

const WELCOME_CALL = 18410804557; // carries Alternate Phone
const INSURANCE = 18410601299; // does not

function dossier(boardId: number, item: Partial<DossierItem> = {}): PatientDossier {
  const it = {
    itemId: "123",
    name: "Jane Sample",
    phone: "+15550001111",
    boardId,
    boardName: boardId === WELCOME_CALL ? "Welcome Call" : "Insurance",
    cols: boardId === WELCOME_CALL ? { phone_mm7265hp: "(555) 000-9999" } : {},
    isCompleted: false,
    ...item,
  } as DossierItem;
  return { name: "Jane Sample", phone: it.phone, active: it.isCompleted ? null : it, path: [], alsoOn: [], items: [it] };
}

const KEY = "n:" + "a".repeat(64);
const NUMBER = "+15552223333";

function renderCard(d: PatientDossier, onLinked = vi.fn(), onPickAgain = vi.fn()) {
  render(<AddNumberCard itemKey={KEY} number={NUMBER} dossier={d} onLinked={onLinked} onPickAgain={onPickAgain} />);
  return { onLinked, onPickAgain };
}

beforeEach(() => {
  m.canEdit = true;
  m.calls.length = 0;
  vi.clearAllMocks();
});

describe("AddNumberCard", () => {
  it("offers the alternate (naming what it replaces) and the primary, and asks about the right patient", () => {
    renderCard(dossier(WELCOME_CALL));
    expect(screen.getByText(/Jane Sample/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add as alternate phone/ })).toBeTruthy();
    expect(screen.getByText("(replaces (555) 000-9999)")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Use as primary phone instead/ })).toBeTruthy();
    // With an alternate on offer, a bare link is not.
    expect(screen.queryByRole("button", { name: /^Link to/ })).toBeNull();
  });

  it("⚠️ Add as alternate writes Monday FIRST, then links, then hands the new key back", async () => {
    const { onLinked } = renderCard(dossier(WELCOME_CALL));
    fireEvent.click(screen.getByRole("button", { name: /Add as alternate phone/ }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith("p:18410804557:123"));
    expect(m.calls).toEqual(["monday", "link"]);
    const write = m.updatePatientContact.mock.calls[0][0] as { values: Record<string, unknown> };
    expect(write.values).toEqual({ phone_mm7265hp: { phone: "5552223333", countryShortName: "US" } });
    expect(m.forgetDirectoryName).toHaveBeenCalledWith("5552223333");
    expect(m.invalidateInbox).toHaveBeenCalled();
    expect(m.toast.success).toHaveBeenCalled();
  });

  it("⚠️ a failed Monday write links NOTHING — the inbox never claims a number the record lacks", async () => {
    m.updatePatientContact.mockRejectedValueOnce(new Error("Monday said no"));
    const { onLinked } = renderCard(dossier(WELCOME_CALL));
    fireEvent.click(screen.getByRole("button", { name: /Add as alternate phone/ }));
    await waitFor(() => expect(m.toast.error).toHaveBeenCalledWith("Monday said no"));
    expect(m.linkNumber).not.toHaveBeenCalled();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("a board with no Alternate Phone offers the primary and a link, and says why", async () => {
    const { onLinked } = renderCard(dossier(INSURANCE));
    expect(screen.queryByRole("button", { name: /Add as alternate phone/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Use as primary phone instead/ })).toBeTruthy();
    expect(screen.getByText(/has no alternate phone/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Link to Jane Sample/ }));
    await waitFor(() => expect(onLinked).toHaveBeenCalled());
    // A link is the inbox's own state: nothing is written to Monday.
    expect(m.calls).toEqual(["link"]);
  });

  it("⚠️ without Edit profile: only the link, and the lock note names the switch", async () => {
    m.canEdit = false;
    renderCard(dossier(WELCOME_CALL));
    expect(screen.queryByRole("button", { name: /Add as alternate phone/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Use as primary phone instead/ })).toBeNull();
    expect(screen.getByText("Edit profile is not assigned.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Link to Jane Sample/ }));
    await waitFor(() => expect(m.linkNumber).toHaveBeenCalled());
    expect(m.updatePatientContact).not.toHaveBeenCalled();
  });

  it("a completed-only patient is linkable but never written, and the card says why", () => {
    renderCard(dossier(WELCOME_CALL, { isCompleted: true }));
    expect(screen.queryByRole("button", { name: /Use as primary phone instead/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Link to Jane Sample/ })).toBeTruthy();
    expect(screen.getByText(/only records are completed/)).toBeTruthy();
  });

  it("Pick someone else hands control back", () => {
    const { onPickAgain } = renderCard(dossier(WELCOME_CALL));
    fireEvent.click(screen.getByRole("button", { name: /Pick someone else/ }));
    expect(onPickAgain).toHaveBeenCalled();
    expect(m.calls).toEqual([]);
  });
});
