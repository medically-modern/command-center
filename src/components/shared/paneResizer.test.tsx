import { describe, expect, it, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useRef } from "react";
import { PANE_MIN_PX, PaneResizer, clampPane, paneWidthCss, paneWidthCssExpr, usePaneWidth } from "./PaneResizer";

describe("clampPane / paneWidthCss", () => {
  it("never under the floor, never past what the other side keeps", () => {
    expect(clampPane(100, 1400, 520)).toBe(PANE_MIN_PX);
    expect(clampPane(700, 1400, 520)).toBe(700);
    expect(clampPane(1200, 1400, 520)).toBe(880);
    expect(paneWidthCss(700, 520)).toBe("max(320px, min(700px, calc(100% - 520px)))");
  });

  it("paneWidthCssExpr takes the reserve as a CSS expression (the hub's list)", () => {
    expect(paneWidthCssExpr(480, "360px + clamp(23.5rem,36%,34rem)", 320)).toBe(
      "max(320px, min(480px, calc(100% - (360px + clamp(23.5rem,36%,34rem)))))",
    );
  });
});

describe("usePaneWidth", () => {
  beforeEach(() => localStorage.clear());

  it("remembers a committed width per screen, and reset forgets it", () => {
    const { result, unmount } = renderHook(() => usePaneWidth("k1"));
    expect(result.current.width).toBeNull();
    act(() => result.current.commit(600));
    expect(localStorage.getItem("k1")).toBe("600");
    unmount();
    const again = renderHook(() => usePaneWidth("k1"));
    expect(again.result.current.width).toBe(600);
    act(() => again.result.current.reset());
    expect(localStorage.getItem("k1")).toBeNull();
    expect(again.result.current.width).toBeNull();
  });

  it("a dragged width is drawn but not saved until the drag ends", () => {
    const { result } = renderHook(() => usePaneWidth("k2"));
    act(() => result.current.set(500));
    expect(result.current.width).toBe(500);
    expect(localStorage.getItem("k2")).toBeNull();
  });

  it("garbage in storage is the default layout, never a 0px pane", () => {
    localStorage.setItem("k3", "12");
    expect(renderHook(() => usePaneWidth("k3")).result.current.width).toBeNull();
  });
});

describe("PaneResizer", () => {
  function Harness({ onCommit, onReset }: { onCommit: (n: number) => void; onReset: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div>
        <div ref={ref}>
          <PaneResizer pane={ref} width={null} onDrag={() => {}} onCommit={onCommit} onReset={onReset} reservePx={520} />
        </div>
      </div>
    );
  }

  it("is a keyboard-reachable vertical separator; double-click resets", () => {
    let reset = 0;
    render(<Harness onCommit={() => {}} onReset={() => reset++} />);
    const handle = screen.getByRole("separator", { name: /resize/i });
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.tabIndex).toBe(0);
    fireEvent.doubleClick(handle);
    expect(reset).toBe(1);
  });
});

describe("PaneResizer edges — the arrow pointing AWAY from the pane widens it", () => {
  /** jsdom lays nothing out, so the pane and its container are given sizes. */
  function sized(el: HTMLElement | null, width: number, left = 100) {
    if (!el) return;
    el.getBoundingClientRect = () => ({ width, left, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
  }
  function Edge({ edge, onCommit, reserve }: { edge?: "left" | "right"; onCommit: (n: number) => void; reserve: number | (() => number) }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div ref={(el) => sized(el, 1400, 0)}>
        <div ref={(el) => { (ref as { current: HTMLDivElement | null }).current = el; sized(el, 400); }}>
          <PaneResizer pane={ref} width={null} onDrag={() => {}} onCommit={onCommit} onReset={() => {}} reservePx={reserve} edge={edge} />
        </div>
      </div>
    );
  }

  it("a right-edge handle (the hub's list): → wider, ← narrower", () => {
    const got: number[] = [];
    render(<Edge edge="right" onCommit={(n) => got.push(n)} reserve={520} />);
    const h = screen.getByRole("separator");
    fireEvent.keyDown(h, { key: "ArrowRight" });
    fireEvent.keyDown(h, { key: "ArrowLeft" });
    expect(got).toEqual([424, 376]);
  });

  it("a left-edge handle (the default) is unchanged: ← wider", () => {
    const got: number[] = [];
    render(<Edge onCommit={(n) => got.push(n)} reserve={520} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(got).toEqual([424]);
  });

  it("a reserve FUNCTION is read at the press — the neighbour's live width", () => {
    const got: number[] = [];
    // 1400 container − 1000 reserve leaves 400: the pane cannot grow past it.
    render(<Edge edge="right" onCommit={(n) => got.push(n)} reserve={() => 1000} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(got).toEqual([400]);
  });
});

describe("wiring — both screens carry the handle", () => {
  it("the Communications hub's profile pane and the patient screen's comms column", () => {
    const hub = readFileSync("src/pages/AssignedPatientsPage.tsx", "utf8");
    expect(hub).toMatch(/<PaneResizer[\s\S]*?pane=\{profilePaneRef\}/);
    expect(hub).toMatch(/ref=\{profilePaneRef\}[\s\S]*?data-hub-profile-pane/);
    // The hub's LIST pane too (Josh, 2026-10-01): a right-edge handle on the
    // list, sitting on the list | thread boundary.
    expect(hub).toMatch(/ref=\{listPaneRef\}[\s\S]*?data-hub-list-pane/);
    expect(hub).toMatch(/<PaneResizer\s+pane=\{listPaneRef\}\s+edge="right"/);
    const pt = readFileSync("src/pages/PatientPage.tsx", "utf8");
    expect(pt).toMatch(/<PaneResizer[\s\S]*?pane=\{commsPaneRef\}/);
    expect(pt).toMatch(/paneRef=\{commsPaneRef\}/);
  });
});
