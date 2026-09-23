/**
 * `ConversationThread` after the extraction (COMMS_INBOX_PLAN.md §4.6): the
 * state went to `useConversation`, the composer to `Composer`, a bubble to
 * `MessageBubble` — and the screen must behave exactly as before, because it is
 * the same guards the Inbox now renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { api } = vi.hoisted(() => ({
  api: {
    fetchConversation: vi.fn(),
    sendMessage: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/assignedPatients/messagingApi", () => api);
vi.mock("@/components/inboundCalls/WatchCallbackButton", () => ({ default: () => null }));
vi.mock("@/lib/fax/ringcentralApi", () => ({ mmPhoneNumber: () => "+13475037148", fetchRcContentBlobUrl: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import ConversationThread from "./ConversationThread";

const PHONE = "+15550001111";
const msg = (id: number, direction: "Inbound" | "Outbound", text: string, min: number) => ({
  id,
  direction,
  text,
  time: new Date(Date.UTC(2026, 8, 23, 15, min)).toISOString(),
});

function renderThread(canText?: "yes" | "no" | "unknown") {
  return render(
    <ConversationThread
      phone={PHONE}
      patient={{ itemId: "900", name: "Jane Doe", phone: PHONE, boardId: "18410804557", boardName: "Welcome Call" }}
      onCall={() => {}}
      calling={false}
      canText={canText}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ConversationThread", () => {
  it("renders the thread and a live composer on a complete, consenting history", async () => {
    api.fetchConversation.mockResolvedValueOnce({ messages: [msg(1, "Inbound", "when does it ship?", 0)], complete: true });
    renderThread();
    await waitFor(() => expect(screen.getByText("when does it ship?")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Send/ })).toBeTruthy();
  });

  it("⚠️⚠️ a STOP blocks the composer", async () => {
    api.fetchConversation.mockResolvedValueOnce({ messages: [msg(1, "Inbound", "STOP", 0)], complete: true });
    renderThread();
    await waitFor(() => expect(screen.getByText(/opted out of texts/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
  });

  it("⚠️ a history we couldn't read in full is not consent", async () => {
    api.fetchConversation.mockResolvedValueOnce({ messages: [], complete: false });
    renderThread();
    await waitFor(() => expect(screen.getByText(/too long to load in full/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
  });

  it("⚠️ Can Text = No blocks it; blank does not", async () => {
    api.fetchConversation.mockResolvedValue({ messages: [], complete: true });
    const { unmount } = renderThread("no");
    await waitFor(() => expect(screen.getByText(/Can Text/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    unmount();
    renderThread("unknown");
    await waitFor(() => expect(screen.getByRole("button", { name: /Send/ })).toBeTruthy());
  });

  it("a send clears the draft, re-reads, and arms the late-failure recheck", async () => {
    api.fetchConversation.mockResolvedValue({ messages: [], complete: true });
    renderThread();
    const box = await screen.findByPlaceholderText(/Text from/);
    vi.useFakeTimers();
    fireEvent.change(box, { target: { value: "It ships Friday" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(api.sendMessage).toHaveBeenCalledWith({ to: PHONE, text: "It ships Friday", mondayItemId: "900" });
    expect((box as HTMLTextAreaElement).value).toBe("");
    const reads = api.fetchConversation.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(api.fetchConversation.mock.calls.length).toBe(reads + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    expect(api.fetchConversation.mock.calls.length).toBe(reads + 2);
    vi.useRealTimers();
  });
});
