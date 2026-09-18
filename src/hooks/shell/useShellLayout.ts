/**
 * Read and set the shell layout (§5.39), live across tabs.
 *
 * ⚠️ TWO listeners, and both are needed. `storage` fires only in OTHER tabs, so
 * a toggle in this one would not repaint the header that contains the toggle;
 * `LAYOUT_EVENT` covers the same tab. Missing either produces a control that
 * looks broken exactly where somebody is pressing it.
 */
import { useCallback, useEffect, useState } from "react";
import { LAYOUT_EVENT, readLayout, writeLayout, type ShellLayout } from "@/lib/shell/layout";

export function useShellLayout(): [ShellLayout, (next: ShellLayout) => void] {
  const [layout, setLayout] = useState<ShellLayout>(readLayout);

  useEffect(() => {
    const sync = () => setLayout(readLayout());
    window.addEventListener("storage", sync);
    window.addEventListener(LAYOUT_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(LAYOUT_EVENT, sync);
    };
  }, []);

  const set = useCallback((next: ShellLayout) => {
    writeLayout(next);
    setLayout(next);
    window.dispatchEvent(new Event(LAYOUT_EVENT));
  }, []);

  return [layout, set];
}
