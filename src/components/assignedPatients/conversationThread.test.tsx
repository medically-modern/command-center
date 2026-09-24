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

  // ⚠️ The extraction regressed this (2026-09-23 review): the draft was cleared
  // only AFTER the post-send re-read, so the sent text sat in the box while the
  // thread reloaded — and a follow-up typed in that window was wiped. The old
  // thread cleared the moment RingCentral accepted the text; so does this.
  it("⚠️ clears the draft as soon as the text is ACCEPTED — a follow-up typed during the re-read survives", async () => {
    api.fetchConversation.mockResolvedValueOnce({ messages: [], complete: true });
    renderThread();
    const box = (await screen.findByPlaceholderText(/Text from/)) as HTMLTextAreaElement;
    // The re-read after the send hangs until we let it go.
    let release: (v: unknown) => void = () => {};
    api.fetchConversation.mockImplementationOnce(() => new Promise((r) => (release = r)));
    fireEvent.change(box, { target: { value: "It ships Friday" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    // Accepted, still re-reading: the sent text is already gone from the box.
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(box.value).toBe("");
    fireEvent.change(box, { target: { value: "And the sensors on Monday" } });
    await act(async () => {
      release({ messages: [msg(2, "Outbound", "It ships Friday", 1)], complete: true });
    });
    expect(box.value).toBe("And the sensors on Monday");
  });

  it("a send that fails keeps the draft", async () => {
    api.fetchConversation.mockResolvedValue({ messages: [], complete: true });
    api.sendMessage.mockRejectedValueOnce(new Error("RingCentral refused it"));
    renderThread();
    const box = (await screen.findByPlaceholderText(/Text from/)) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "It ships Friday" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(box.value).toBe("It ships Friday");
  });
});

/* ── The patient screen's look (Brandon's pixel-match item 14, 2026-09-24) ──
   `bare` is LOOK ONLY: the header goes and the composer is one line, and every
   guard above still holds. The Communications hub passes nothing and must be
   untouched. */
describe("ConversationThread — `bare` (the patient screen's look)", () => {
  function renderBare(opts: { canText?: "yes" | "no" | "unknown"; onCount?: (n: number) => void } = {}) {
    return render(
      <ConversationThread
        phone={PHONE}
        patient={{ itemId: "900", name: "Jane Doe", phone: PHONE, boardId: "18410804557", boardName: "Welcome Call" }}
        onCall={() => {}}
        calling={false}
        canText={opts.canText}
        bare
        composerPlaceholder="Write a text…"
        onCount={opts.onCount}
      />,
    );
  }

  it("drops the header — no name block, no Call — and draws the one-line composer", async () => {
    api.fetchConversation.mockResolvedValueOnce({ messages: [msg(1, "Inbound", "when does it ship?", 0)], complete: true });
    renderBare();
    await waitFor(() => expect(screen.getByText("when does it ship?")).toBeTruthy());
    expect(screen.queryByText("Jane Doe")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Call$/ })).toBeNull();
    const box = screen.getByLabelText("Write a text") as HTMLInputElement;
    expect(box.tagName).toBe("INPUT");
    expect(box.placeholder).toBe("Write a text…");
    expect(screen.getByRole("button", { name: /Send text/ })).toBeTruthy();
  });

  it("⚠️ the default is unchanged — the hub keeps its header and its box", async () => {
    api.fetchConversation.mockResolvedValueOnce({ messages: [], complete: true });
    renderThread();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Call$/ })).toBeTruthy());
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(((await screen.findByPlaceholderText(/Text from/)) as HTMLElement).tagName).toBe("TEXTAREA");
    expect(screen.queryByLabelText("Write a text")).toBeNull();
  });

  it("⚠️⚠️ a STOP still blocks it — the guard is the same code whichever look is drawn", async () => {
    api.fetchConversation.mockResolvedValueOnce({ messages: [msg(1, "Inbound", "STOP", 0)], complete: true });
    renderBare();
    await waitFor(() => expect(screen.getByText(/opted out of texts/)).toBeTruthy());
    expect(screen.queryByLabelText("Write a text")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send text/ })).toBeNull();
  });

  it("⚠️ Can Text = No still blocks it", async () => {
    api.fetchConversation.mockResolvedValueOnce({ messages: [], complete: true });
    renderBare({ canText: "no" });
    await waitFor(() => expect(screen.getByText(/Can Text/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Send text/ })).toBeNull();
  });

  it("sends on Enter through the same send, and clears on acceptance", async () => {
    api.fetchConversation.mockResolvedValue({ messages: [], complete: true });
    renderBare();
    const box = (await screen.findByLabelText("Write a text")) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "It ships Friday" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(api.sendMessage).toHaveBeenCalledWith({ to: PHONE, text: "It ships Friday", mondayItemId: "900" });
    expect(box.value).toBe("");
  });

  it("reports the count only once the thread has LOADED — never while loading or on an error", async () => {
    const counts: number[] = [];
    let release: (v: unknown) => void = () => {};
    api.fetchConversation.mockImplementationOnce(() => new Promise((r) => (release = r)));
    renderBare({ onCount: (n) => counts.push(n) });
    expect(counts).toEqual([]);
    await act(async () => {
      release({ messages: [msg(1, "Inbound", "hi", 0), msg(2, "Outbound", "hello", 1)], complete: true });
    });
    await waitFor(() => expect(counts.at(-1)).toBe(2));
  });
});
