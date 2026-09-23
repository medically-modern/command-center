/**
 * The patient screen's compact resolve bar (COMMS_INBOX_PLAN.md §1.2), rendered.
 *
 * What it must never do: show anything with the Inbox switched off (the patient
 * screen must be exactly what it was), paint the previous patient's item, or
 * copy a note to Monday before the rep moves on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ItemState } from "@/lib/commsInbox/rules";

const m = vi.hoisted(() => ({
  cfg: { enabled: true, ui: true, loaded: true },
  state: vi.fn(),
  resolve: vi.fn(),
  flush: vi.fn(async () => {}),
  invalidate: vi.fn(),
}));

vi.mock("@/hooks/commsInbox/useInbox", () => ({
  useCommsConfig: () => m.cfg,
  flushCommsOutbox: () => m.flush(),
  invalidateInbox: () => m.invalidate(),
}));
vi.mock("@/lib/commsInbox/api", async (orig) => {
  const real = await orig<typeof import("@/lib/commsInbox/api")>();
  return {
    ...real,
    fetchCommsState: (n: string[]) => m.state(n),
    resolveItem: (o: unknown) => m.resolve(o),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PatientResolveBar } from "./PatientResolveBar";

const KEY = "p:18410804557:123";
const T = Date.parse("2026-09-22T14:00:00Z");

function st(over: Partial<ItemState> = {}): ItemState {
  return {
    open: true,
    openedBy: { at: T, kind: "text" },
    openCount: 1,
    waitMs: 3 * 3600_000,
    over: false,
    reopened: false,
    lastInbound: { at: T, kind: "text", preview: "hi" },
    previewKind: "text",
    preview: "hi",
    lastResolution: null,
    suggestion: null,
    attempts: [],
    stickyWaitMs: 0,
    lastAt: T,
    newestOpenAt: T,
    ...over,
  };
}

beforeEach(() => {
  m.cfg = { enabled: true, ui: true, loaded: true };
  vi.clearAllMocks();
});

describe("PatientResolveBar", () => {
  it("shows the open item's wait and the three ways to resolve, compact", async () => {
    m.state.mockResolvedValue({ key: KEY, state: st() });
    render(<PatientResolveBar numbers={["+15550001111", "", "+15550002222"]} />);
    expect(await screen.findByText("Waiting 3h 0m")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Called" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No action needed" })).toBeTruthy();
    // Both numbers, blanks dropped — an item is the PATIENT's, whichever line.
    expect(m.state).toHaveBeenCalledWith(["5550001111", "5550002222"]);
  });

  it("with no open item, shows the last resolution", async () => {
    m.state.mockResolvedValue({
      key: KEY,
      state: st({
        open: false,
        lastResolution: {
          resolutionId: "r1",
          how: "called",
          label: "Called",
          by: "katie.tyler@medicallymodern.com",
          at: T,
          note: "ships Friday",
          coversThrough: T,
          mirrored: true,
        },
      }),
    });
    render(<PatientResolveBar numbers={["+15550001111"]} />);
    expect(await screen.findByText(/Resolved · Called · Katie/)).toBeTruthy();
    // Not this session's resolution, so no Undo.
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("⚠️ renders NOTHING with the Inbox switched off — and asks nothing", async () => {
    m.cfg = { enabled: false, ui: false, loaded: true };
    const { container } = render(<PatientResolveBar numbers={["+15550001111"]} />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
    expect(m.state).not.toHaveBeenCalled();
  });

  it("renders nothing for a patient with neither an open item nor a resolution", async () => {
    m.state.mockResolvedValue({ key: KEY, state: st({ open: false }) });
    const { container } = render(<PatientResolveBar numbers={["+15550001111"]} />);
    await waitFor(() => expect(m.state).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("resolves at once, offers Undo, and ⚠️ copies the note only when the rep moves on", async () => {
    m.state.mockResolvedValueOnce({ key: KEY, state: st() });
    m.resolve.mockResolvedValue({
      resolutionId: "r9",
      how: "no_action",
      label: "No action needed",
      coversThrough: T,
      resolvedAt: T + 60_000,
      by: "masani@medicallymodern.com",
    });
    // The re-read after resolving has not landed yet — the bar must not wait for it.
    m.state.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<PatientResolveBar numbers={["+15550001111"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "No action needed" }));
    expect(await screen.findByText(/Resolved · No action needed · Masani/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    // seenThrough is the state's own newest open event.
    expect(m.resolve).toHaveBeenCalledWith(expect.objectContaining({ key: KEY, how: "no_action", seenThrough: T }));
    expect(m.flush).not.toHaveBeenCalled();
    unmount();
    expect(m.flush).toHaveBeenCalledTimes(1);
  });

  it("⚠️ a slow answer for the previous patient never paints over the next one", async () => {
    let first: (v: unknown) => void = () => {};
    m.state.mockReturnValueOnce(new Promise((r) => (first = r)));
    m.state.mockResolvedValueOnce({ key: "p:18410804557:999", state: st({ waitMs: 60_000 }) });
    const { rerender } = render(<PatientResolveBar numbers={["+15550001111"]} />);
    rerender(<PatientResolveBar numbers={["+15550009999"]} />);
    expect(await screen.findByText("Waiting 1m")).toBeTruthy();
    await act(async () => first({ key: KEY, state: st({ waitMs: 5 * 3600_000 }) }));
    expect(screen.queryByText("Waiting 5h 0m")).toBeNull();
    expect(screen.getByText("Waiting 1m")).toBeTruthy();
  });
});
