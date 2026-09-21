/**
 * The six colour themes (§5.44) — the accent hue, and nothing else.
 *
 * ⚠️ Moved out of `components/ThemePicker.tsx` when the lower-left floating
 * gear was removed (Josh, 2026-09-21: *"putt everything in the lower left
 * setting into the upper right settings"*). It lived inside a component, which
 * is why the header could not offer it without importing that component's
 * popover as well.
 *
 * ⚠️ **Separate from APPEARANCE** (`lib/shell/appearance.ts`), and the two
 * compose: a theme shifts `--primary` / `--accent` / `--ring` and the navy
 * gradients, appearance shifts how light the surfaces are. That is why `.dark`
 * deliberately names none of the tokens these blocks own — at equal specificity
 * the `[data-theme]` blocks win on source order, so a value set in both
 * survives only under the default theme (§5.40).
 */

export interface ThemeDef {
  id: string;
  label: string;
  /** Tailwind class for the swatch dot in the settings menu. */
  swatch: string;
}

export const THEMES: readonly ThemeDef[] = [
  { id: "default", label: "Clinical Blue", swatch: "bg-blue-600" },
  { id: "slate", label: "Slate", swatch: "bg-slate-500" },
  { id: "emerald", label: "Emerald", swatch: "bg-emerald-600" },
  { id: "violet", label: "Violet", swatch: "bg-violet-600" },
  { id: "rose", label: "Rose", swatch: "bg-rose-500" },
  { id: "amber", label: "Amber", swatch: "bg-amber-500" },
] as const;

const KEY = "mm-theme";
export const DEFAULT_THEME = "default";

/** ⚠️ Every storage access is wrapped: it comes back empty in a private window
 *  and the accessor can throw where site data is blocked, and a colour theme is
 *  never worth failing a first paint over. */
export function readTheme(): string {
  try {
    const raw = localStorage.getItem(KEY);
    return THEMES.some((t) => t.id === raw) ? (raw as string) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeTheme(next: string): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* Held in React state for this session either way. */
  }
}

/** ⚠️ The DEFAULT theme REMOVES the attribute rather than setting
 *  `data-theme="default"` — there is no such block in `index.css`, so setting
 *  it would leave every themed token at its `:root` value while the attribute
 *  claims a theme is on. */
export function applyTheme(next: string): void {
  try {
    const root = document.documentElement;
    if (next === DEFAULT_THEME) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
  } catch {
    /* Never fail a first paint over a colour. */
  }
}
