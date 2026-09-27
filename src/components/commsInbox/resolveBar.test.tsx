/**
 * The resolve bar (COMMS_INBOX_PLAN.md §1.1, §5): what each button sends, and
 * the two rules the server enforces too — Called needs a note, and a resolve
 * covers only what the rep was SHOWN.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { api, toast } = vi.hoisted(() => {
  class InboxConflict extends Error {
    constructor(
      message: string,
      readonly conflict: unknown,
      readonly moved: string | null,
    ) {
      super(message);
    }
  }
  return {
    api: {
      InboxConflict,
      resolveItem: vi.fn(),
      undoResolution: vi.fn(async () => {}),
      addResolutionNote: vi.fn(async () => {}),
    },
    toast: { error: vi.fn(), success: vi.fn() },
  };
});
const rc = vi.hoisted(() => ({
  markTextsRead: vi.fn(async (_n: string[], _c: number) => 0),
  reloadTextsIfLoaded: vi.fn(),
}));
vi.mock("@/lib/commsInbox/api", () => api);
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/fax/ringcentralApi", () => ({ markTextsRead: rc.markTextsRead }));
vi.mock("@/hooks/commsHub/useHubData", () => ({ reloadTextsIfLoaded: rc.reloadTextsIfLoaded }));

import ResolveBar, { type StickyResolution } from "./ResolveBar";
import type { ItemState } from "@/lib/commsInbox/rules";

const T = Date.parse("2026-09-23T18:10:00Z");
const KEY = "p:18410804557:900";
const SEEN = T + 5_000;
const NUMS = ["+15550001111", "+15550002222"];

const open = (over: Partial<ItemState> = {}): ItemState => ({
  open: true,
  openedBy: { at: T, kind: "text" },
  openCount: 1,
  waitMs: (3 * 60 + 12) * 60_000,
  over: false,
  reopened: false,
  lastInbound: null,
  previewKind: "text",
  preview: "",
  lastResolution: null,
  suggestion: null,
  attempts: [],
  stickyWaitMs: 0,
  lastAt: T,
  newestOpenAt: T,
  ...over,
});

const result = (how: string) => ({
  resolutionId: "11111111-2222-3333-4444-555555555555",
  how,
  label: how,
  coversThrough: SEEN,
  resolvedAt: T + 60_000,
  by: "katie@medicallymodern.com",
});

function renderBar(state: ItemState, sticky: StickyResolution | null = null) {
  const onResolved = vi.fn();
  const onUndone = vi.fn();
  const onChanged = vi.fn();
  render(
    <ResolveBar
      itemKey={KEY}
      textNumbers={NUMS}
      state={state}
      seenThrough={SEEN}
      sticky={sticky}
      onResolved={onResolved}
      onUndone={onUndone}
      onChanged={onChanged}
    />,
  );
  return { onResolved, onUndone, onChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  rc.markTextsRead.mockResolvedValue(0);
});

describe("open", () => {
  it("shows the counted wait and the three ways, labelled Mark resolved", () => {
    renderBar(open());
    expect(screen.getByText("Waiting 3h 12m")).toBeTruthy();
    expect(screen.getByText("Mark resolved")).toBeTruthy();
    for (const b of ["Called", "Texted", "No action needed", "Left voicemail"]) expect(screen.getByRole("button", { name: new RegExp(b) })).toBeTruthy();
  });

  it("the wait turns red over 24 counted hours", () => {
    renderBar(open({ over: true, waitMs: 30 * 3600_000 }));
    expect(screen.getByText("Waiting 1d 6h").className).toMatch(/text-destructive/);
  });

  it("⚠️⚠️ Called asks what was said and cannot resolve without it", async () => {
    const { onResolved } = renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: /^Called/ }));
    const input = screen.getByLabelText("Call note, required");
    const go = screen.getByRole("button", { name: "Resolve" });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.resolveItem).not.toHaveBeenCalled();

    api.resolveItem.mockResolvedValueOnce(result("called"));
    fireEvent.change(input, { target: { value: "told her it ships Friday" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(api.resolveItem).toHaveBeenCalledWith({ key: KEY, how: "called", note: "told her it ships Friday", seenThrough: SEEN });
    expect(onResolved.mock.calls[0][1]).toBe("told her it ships Friday");
  });

  it("⚠️ on a shared line the note goes to the patient the rep was LOOKING AT (2026-09-23 review)", async () => {
    api.resolveItem.mockResolvedValueOnce(result("texted"));
    const onResolved = vi.fn();
    render(
      <ResolveBar
        itemKey={KEY}
        textNumbers={NUMS}
        state={open()}
        seenThrough={SEEN}
        sticky={null}
        noteTarget={{ boardId: 18407459988, itemId: "202" }}
        onResolved={onResolved}
        onUndone={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Texted/ }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(api.resolveItem).toHaveBeenCalledWith(
      expect.objectContaining({ key: KEY, noteTarget: { boardId: 18407459988, itemId: "202" } }),
    );
  });

  it("Texted resolves at once, covering what the rep was shown", async () => {
    api.resolveItem.mockResolvedValueOnce(result("texted"));
    const { onResolved } = renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: /^Texted/ }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(api.resolveItem).toHaveBeenCalledWith(expect.objectContaining({ how: "texted", seenThrough: SEEN }));
  });

  it("⚠️ Left voicemail is an ATTEMPT — it never resolves the item", async () => {
    api.resolveItem.mockResolvedValueOnce(result("left_vm"));
    const { onResolved, onChanged } = renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: /Left voicemail/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onResolved).not.toHaveBeenCalled();
    expect(api.resolveItem).toHaveBeenCalledWith(expect.objectContaining({ how: "left_vm" }));
  });

  it("a suggestion highlights its button with the time and asks to Confirm", () => {
    renderBar(open({ suggestion: { how: "called", at: T + 30 * 60_000, by: "" } }));
    expect(screen.getByText("Confirm")).toBeTruthy();
    const b = screen.getByRole("button", { name: /^Called/ });
    // The time today, the date on another day — `formatShort` reads the ET day.
    expect(b.textContent).toMatch(/2:40 PM|Sep 23/);
    expect(b.getAttribute("title")).toMatch(/confirm to resolve/);
  });

  it("⚠️ a 409 names who resolved it, and re-reads — it never writes a second resolution", async () => {
    api.resolveItem.mockRejectedValueOnce(
      new api.InboxConflict("Already resolved", { how: "called", label: "Called", by: "masheke@medicallymodern.com", at: T }, null),
    );
    const { onResolved, onChanged } = renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: /^Texted/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onResolved).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Masheke already resolved this"));
  });
});

describe("resolved", () => {
  const resolved = (note = "") =>
    open({
      open: false,
      lastResolution: {
        resolutionId: "11111111-2222-3333-4444-555555555555",
        how: "texted",
        label: "Texted",
        by: "katie@medicallymodern.com",
        at: T,
        note,
        coversThrough: T,
        mirrored: false,
      },
    });
  const sticky: StickyResolution = { ...result("texted"), how: "texted", key: KEY, note: "" };

  it("shows how, who and when", () => {
    renderBar(resolved("sent the tracking link"));
    expect(screen.getByText(/Resolved · Texted · Katie/)).toBeTruthy();
    expect(screen.getByText(/sent the tracking link/)).toBeTruthy();
  });

  it("Undo and the optional note belong to the rep who just resolved it (sticky) only", () => {
    renderBar(resolved());
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByLabelText("Add a note (optional)")).toBeNull();
  });

  it("while sticky: Undo, and Add a note after Texted", async () => {
    const { onUndone, onChanged } = renderBar(resolved(), sticky);
    fireEvent.change(screen.getByLabelText("Add a note (optional)"), { target: { value: "sent the link" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.addResolutionNote).toHaveBeenCalledWith(sticky.resolutionId, "sent the link");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(onUndone).toHaveBeenCalled());
    expect(api.undoResolution).toHaveBeenCalledWith(sticky.resolutionId);
  });

  it("nothing at all for an item that has never been resolved and is not open", () => {
    const { container } = render(
      <ResolveBar
        itemKey={KEY}
        textNumbers={NUMS}
        state={open({ open: false })}
        seenThrough={null}
        sticky={null}
        onResolved={vi.fn()}
        onUndone={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

/* Josh, 2026-09-27: "if anything in comms is marked as resolved mark the most
 * recent text as read, the same way we do in the texts part of comms". */
describe("a resolve marks the item's texts read", () => {
  it.each(["texted", "no_action"] as const)("%s marks the covered texts on the item's numbers read", async (how) => {
    api.resolveItem.mockResolvedValueOnce(result(how));
    const { onResolved } = renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: how === "texted" ? /^Texted/ : /^No action needed/ }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    await waitFor(() => expect(rc.markTextsRead).toHaveBeenCalledWith(NUMS, SEEN));
  });

  it("Called marks them read too, once the note resolves it", async () => {
    api.resolveItem.mockResolvedValueOnce(result("called"));
    renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: /^Called/ }));
    fireEvent.change(screen.getByLabelText("Call note, required"), { target: { value: "ships Friday" } });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(rc.markTextsRead).toHaveBeenCalledWith(NUMS, SEEN));
  });

  // ⚠️ An attempt resolves nothing — the item stays open, so its texts stay unread.
  it("⚠️ Left voicemail marks nothing", async () => {
    api.resolveItem.mockResolvedValueOnce(result("left_vm"));
    const { onChanged } = renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: /Left voicemail/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(rc.markTextsRead).not.toHaveBeenCalled();
  });

  it("⚠️ a refused resolve (409) marks nothing", async () => {
    api.resolveItem.mockRejectedValueOnce(new api.InboxConflict("taken", null, null));
    const { onChanged } = renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: /^Texted/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(rc.markTextsRead).not.toHaveBeenCalled();
  });

  it("pulls the Text list forward when something was marked, and not when nothing was", async () => {
    rc.markTextsRead.mockResolvedValueOnce(2);
    api.resolveItem.mockResolvedValueOnce(result("texted"));
    renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: /^Texted/ }));
    await waitFor(() => expect(rc.reloadTextsIfLoaded).toHaveBeenCalledTimes(1));

    rc.reloadTextsIfLoaded.mockClear();
    rc.markTextsRead.mockResolvedValueOnce(0);
    api.resolveItem.mockResolvedValueOnce(result("texted"));
    renderBar(open());
    fireEvent.click(screen.getAllByRole("button", { name: /^Texted/ })[1]);
    await waitFor(() => expect(rc.markTextsRead).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(rc.reloadTextsIfLoaded).not.toHaveBeenCalled();
  });

  // The resolve has LANDED — a RingCentral failure must say so, not undo it.
  it("a failed RingCentral write is reported, and the resolve stands", async () => {
    rc.markTextsRead.mockRejectedValueOnce(new Error("RingCentral unread-text read failed (503)"));
    api.resolveItem.mockResolvedValueOnce(result("texted"));
    const { onResolved } = renderBar(open());
    fireEvent.click(screen.getByRole("button", { name: /^Texted/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toMatch(/^Resolved — but couldn't mark the text read/);
    expect(onResolved).toHaveBeenCalled();
    expect(api.undoResolution).not.toHaveBeenCalled();
  });
});
