// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoSelectPatient } from "./useAutoSelectPatient";

const p = (id: string) => ({ id });

type Props = {
  initialLoading: boolean;
  all: { id: string }[];
  visible: { id: string }[];
  selectedId: string | null;
  pinnedId?: string | null;
};

function render(props: Props, setSelectedId = vi.fn()) {
  const result = renderHook(
    ({ initialLoading, all, visible, selectedId, pinnedId }: Props) =>
      useAutoSelectPatient(initialLoading, all, visible, selectedId, setSelectedId, pinnedId),
    { initialProps: props },
  );
  return { ...result, setSelectedId };
}

describe("useAutoSelectPatient", () => {
  it("does nothing while the first fetch is still loading (cached list must not drive selection)", () => {
    const { setSelectedId } = render({
      initialLoading: true,
      all: [p("stale-1"), p("stale-2")],
      visible: [p("stale-1")],
      selectedId: null,
    });
    expect(setSelectedId).not.toHaveBeenCalled();
  });

  it("selects the first VISIBLE patient once loaded", () => {
    const { setSelectedId } = render({
      initialLoading: false,
      all: [p("escalated-hidden"), p("active-1"), p("active-2")],
      visible: [p("active-1"), p("active-2")],
      selectedId: null,
    });
    expect(setSelectedId).toHaveBeenCalledWith("active-1");
  });

  it("selects nothing when the visible list is empty", () => {
    const { setSelectedId } = render({
      initialLoading: false,
      all: [p("escalated-hidden")],
      visible: [],
      selectedId: null,
    });
    // selectedId is already null → no redundant set
    expect(setSelectedId).not.toHaveBeenCalled();
  });

  it("keeps a selection that is hidden by the sidebar filter but still on the board", () => {
    const { setSelectedId } = render({
      initialLoading: false,
      all: [p("escalated-hidden"), p("active-1")],
      visible: [p("active-1")],
      selectedId: "escalated-hidden",
    });
    expect(setSelectedId).not.toHaveBeenCalled();
  });

  it("clears a still-on-the-board selection once the sidebar has NOTHING left to work", () => {
    // The rep finishes the last patient in the queue: they're still in
    // `all` (snoozed/completed, not gone from the board) but no longer
    // visible. Their profile used to stay on screen next to an empty
    // sidebar, which reads as a live assignment.
    const { setSelectedId } = render({
      initialLoading: false,
      all: [p("just-completed")],
      visible: [],
      selectedId: "just-completed",
    });
    expect(setSelectedId).toHaveBeenCalledWith(null);
  });

  it("keeps a deep-linked patient open even when the queue is empty", () => {
    // Manager drill-downs open patients that are deliberately off-queue.
    const { setSelectedId } = render({
      initialLoading: false,
      all: [p("from-oversight")],
      visible: [],
      selectedId: "from-oversight",
      pinnedId: "from-oversight",
    });
    expect(setSelectedId).not.toHaveBeenCalled();
  });

  it("holds a selection through ONE missed list, then falls back on the second consecutive miss", () => {
    const setSelectedId = vi.fn();
    const { rerender } = render(
      {
        initialLoading: false,
        all: [p("working"), p("next-up")],
        visible: [p("working"), p("next-up")],
        selectedId: "working",
      },
      setSelectedId,
    );
    expect(setSelectedId).not.toHaveBeenCalled();
    // poll lands without "working" — first miss holds (transient dropout self-heals)
    rerender({
      initialLoading: false,
      all: [p("next-up")],
      visible: [p("next-up")],
      selectedId: "working",
    });
    expect(setSelectedId).not.toHaveBeenCalled();
    // second consecutive miss — the patient really advanced off the board
    rerender({
      initialLoading: false,
      all: [p("next-up")],
      visible: [p("next-up")],
      selectedId: "working",
    });
    expect(setSelectedId).toHaveBeenCalledWith("next-up");
  });

  it("self-heals when the missing patient reappears before the second miss", () => {
    const setSelectedId = vi.fn();
    const { rerender } = render(
      {
        initialLoading: false,
        all: [p("working"), p("other")],
        visible: [p("working"), p("other")],
        selectedId: "working",
      },
      setSelectedId,
    );
    rerender({
      initialLoading: false,
      all: [p("other")],
      visible: [p("other")],
      selectedId: "working",
    });
    // patient comes back — miss counter resets, selection untouched
    rerender({
      initialLoading: false,
      all: [p("working"), p("other")],
      visible: [p("working"), p("other")],
      selectedId: "working",
    });
    rerender({
      initialLoading: false,
      all: [p("other")],
      visible: [p("other")],
      selectedId: "working",
    });
    expect(setSelectedId).not.toHaveBeenCalled();
  });

  it("holds the selection when a fetch comes back empty (malformed/partial response)", () => {
    const setSelectedId = vi.fn();
    const { rerender } = render(
      {
        initialLoading: false,
        all: [p("working")],
        visible: [p("working")],
        selectedId: "working",
      },
      setSelectedId,
    );
    rerender({ initialLoading: false, all: [], visible: [], selectedId: "working" });
    rerender({ initialLoading: false, all: [], visible: [], selectedId: "working" });
    expect(setSelectedId).not.toHaveBeenCalled();
  });

  it("never moves a deep-linked (pinned) selection, even when its injection fetch fails", () => {
    const setSelectedId = vi.fn();
    const { rerender } = render(
      {
        initialLoading: false,
        all: [p("active-1"), p("active-2")],
        visible: [p("active-1"), p("active-2")],
        selectedId: "deep-linked",
        pinnedId: "deep-linked",
      },
      setSelectedId,
    );
    rerender({
      initialLoading: false,
      all: [p("active-1"), p("active-2")],
      visible: [p("active-1"), p("active-2")],
      selectedId: "deep-linked",
      pinnedId: "deep-linked",
    });
    rerender({
      initialLoading: false,
      all: [p("active-1"), p("active-2")],
      visible: [p("active-1"), p("active-2")],
      selectedId: "deep-linked",
      pinnedId: "deep-linked",
    });
    expect(setSelectedId).not.toHaveBeenCalled();
  });

  it("clears a stale selection (after two misses) when nothing is visible", () => {
    const setSelectedId = vi.fn();
    const { rerender } = render(
      {
        initialLoading: false,
        all: [p("working"), p("escalated-hidden")],
        visible: [p("working")],
        selectedId: "working",
      },
      setSelectedId,
    );
    rerender({
      initialLoading: false,
      all: [p("escalated-hidden")],
      visible: [],
      selectedId: "working",
    });
    rerender({
      initialLoading: false,
      all: [p("escalated-hidden")],
      visible: [],
      selectedId: "working",
    });
    expect(setSelectedId).toHaveBeenCalledWith(null);
  });

  it("recovers after the first real fetch replaces a stale cached list", () => {
    const setSelectedId = vi.fn();
    // mount with cached list, nothing selected, still loading
    const { rerender } = render(
      {
        initialLoading: true,
        all: [p("stale-cached-1")],
        visible: [p("stale-cached-1")],
        selectedId: null,
      },
      setSelectedId,
    );
    expect(setSelectedId).not.toHaveBeenCalled();
    // first fetch lands with the real role list
    rerender({
      initialLoading: false,
      all: [p("real-1"), p("real-2")],
      visible: [p("real-1"), p("real-2")],
      selectedId: null,
    });
    expect(setSelectedId).toHaveBeenCalledWith("real-1");
  });
});
