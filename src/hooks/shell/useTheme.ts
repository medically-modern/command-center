/**
 * Read and set the colour theme (§5.44). Applied on mount so a stored theme
 * survives a reload, and on every change.
 */
import { useCallback, useEffect, useState } from "react";
import { applyTheme, readTheme, writeTheme } from "@/lib/shell/theme";

export function useTheme(): { theme: string; setTheme: (next: string) => void } {
  const [theme, setThemeState] = useState<string>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: string) => {
    writeTheme(next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
