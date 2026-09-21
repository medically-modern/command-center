/**
 * Read and set the app's appearance (§5.40), live across tabs and across OS
 * changes.
 *
 * ⚠️ THREE listeners, and each covers a gap the others do not. `storage` fires
 * only in OTHER tabs, so a toggle in this one would not repaint the popover
 * that contains it; `APPEARANCE_EVENT` covers the same tab; the media query
 * covers the OS flipping under a `"system"` choice, which no storage event
 * announces. Missing any one produces a control that looks broken exactly
 * where somebody is pressing it.
 */
import { useCallback, useEffect, useState } from "react";
import {
  APPEARANCE_EVENT,
  applyAppearance,
  readAppearance,
  resolveAppearance,
  watchSystemAppearance,
  writeAppearance,
  type Appearance,
} from "@/lib/shell/appearance";

export function useAppearance(): {
  appearance: Appearance;
  resolved: "light" | "dark";
  setAppearance: (next: Appearance) => void;
} {
  const [appearance, setState] = useState<Appearance>(readAppearance);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveAppearance(readAppearance()));

  useEffect(() => {
    const sync = () => {
      const next = readAppearance();
      setState(next);
      setResolved(resolveAppearance(next));
      // Re-apply rather than trusting whoever wrote the value to have applied
      // it: `?appearance=` and another tab both change storage without ever
      // touching THIS document's <html>.
      applyAppearance(next);
    };
    window.addEventListener("storage", sync);
    window.addEventListener(APPEARANCE_EVENT, sync);
    const stopWatching = watchSystemAppearance(sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(APPEARANCE_EVENT, sync);
      stopWatching();
    };
  }, []);

  const setAppearance = useCallback((next: Appearance) => {
    writeAppearance(next);
    applyAppearance(next);
    setState(next);
    setResolved(resolveAppearance(next));
    window.dispatchEvent(new Event(APPEARANCE_EVENT));
  }, []);

  return { appearance, resolved, setAppearance };
}
