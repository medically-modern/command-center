/**
 * A drag handle on the LEFT edge of a right-hand pane — the width of the
 * patient profile against the conversation (Brandon, 2026-09-29: *"Make a
 * slider for comms tab so can control width of comms vs patient profile. make
 * it dynamic and vertically scaleable back and forth"*).
 *
 * Two screens use it, each with its own remembered width:
 *  · the Communications hub — thread | patient profile (`AssignedPatientsPage`);
 *  · the patient screen — patient profile | Texts & Calls (`PatientPage`).
 *
 * The pane follows the pointer while dragging; arrow keys move it 24px;
 * a double-click puts the screen's own default layout back.
 *
 * ⚠️ The width is a per-viewer convenience in `localStorage` (§ browser
 * storage: every read and write is try/catch'd, and a blocked store just
 * means the default layout). It is a PIXEL width, clamped where it is DRAWN
 * (`paneWidthCss`) against the container, so a width saved on a big monitor
 * can never squeeze the other side to nothing on a laptop.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

export const PANE_MIN_PX = 320;

function readStored(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= PANE_MIN_PX ? Math.round(n) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, px: number | null) {
  try {
    if (px === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(Math.round(px)));
  } catch {
    /* A blocked store only means the width is not remembered. */
  }
}

/**
 * The remembered width of one screen's right pane — null means the screen's
 * own default layout. `set` draws a width without saving it (while dragging);
 * `commit` saves; `reset` forgets.
 */
export function usePaneWidth(storageKey: string) {
  const [width, setWidth] = useState<number | null>(() => readStored(storageKey));
  const commit = useCallback(
    (px: number | null) => {
      setWidth(px);
      writeStored(storageKey, px);
    },
    [storageKey],
  );
  const reset = useCallback(() => commit(null), [commit]);
  return { width, set: setWidth, commit, reset };
}

/**
 * The CSS width for a remembered pixel width: never under the floor, and never
 * so wide that less than `reservePx` of the container is left for the rest.
 */
export function paneWidthCss(px: number, reservePx: number, minPx = PANE_MIN_PX): string {
  return `max(${minPx}px, min(${Math.round(px)}px, calc(100% - ${Math.round(reservePx)}px)))`;
}

/** The width a drag asks for, clamped the same way `paneWidthCss` draws it. */
export function clampPane(px: number, containerPx: number, reservePx: number, minPx = PANE_MIN_PX): number {
  const max = Math.max(minPx, containerPx - reservePx);
  return Math.round(Math.min(Math.max(px, minPx), max));
}

export function PaneResizer({
  pane,
  width,
  onDrag,
  onCommit,
  onReset,
  reservePx,
  minPx = PANE_MIN_PX,
  label = "Resize the patient profile",
  className,
}: {
  /** The right-hand pane this handle sits on — measured when a drag starts. */
  pane: React.RefObject<HTMLElement>;
  width: number | null;
  onDrag: (px: number) => void;
  onCommit: (px: number) => void;
  onReset: () => void;
  /** What the other side (and anything else in the container) keeps, at least. */
  reservePx: number;
  /** The narrowest the pane may be dragged — the screen's own floor. */
  minPx?: number;
  label?: string;
  className?: string;
}) {
  const drag = useRef<{ right: number; container: number; last: number } | null>(null);

  const start = (e: PointerEvent<HTMLDivElement>) => {
    const el = pane.current;
    if (!el || e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    const container = el.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
    drag.current = { right: rect.right, container, last: rect.width };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.last = clampPane(d.right - e.clientX, d.container, reservePx, minPx);
    onDrag(d.last);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit(d.last);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const el = pane.current;
    if (!el) return;
    e.preventDefault();
    const container = el.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
    const now = el.getBoundingClientRect().width;
    // The handle is on the pane's LEFT edge: left makes the pane wider.
    onCommit(clampPane(now + (e.key === "ArrowLeft" ? 24 : -24), container, reservePx, minPx));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width ?? undefined}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={key}
      data-pane-resizer
      className={cn(
        "group absolute inset-y-0 -left-[5px] z-20 flex w-[10px] cursor-col-resize touch-none select-none items-center justify-center outline-none",
        className,
      )}
    >
      <span className="h-full w-[2px] bg-transparent transition-colors group-hover:bg-primary/40 group-focus-visible:bg-primary/60 group-active:bg-primary/60" />
      <span className="absolute h-10 w-[6px] rounded-full border border-muted-foreground/40 bg-background shadow-sm transition-colors group-hover:border-primary/60 group-active:border-primary" />
    </div>
  );
}
