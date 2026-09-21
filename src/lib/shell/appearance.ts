/**
 * Light or dark surfaces — the app's appearance, separate from its colour
 * theme (§5.40).
 *
 * ⚠️⚠️ **DARK MODE WAS CONFIGURED, STYLED AND UNREACHABLE.** Tailwind has
 * carried `darkMode: ["class"]` and `index.css` a full `.dark` token block
 * since the first commit, and 59 component files carry 493 `dark:` variants —
 * but **nothing in `src/` has ever added that class**, and there is no
 * `prefers-color-scheme` fallback either. So all of it was dead code: a mode
 * the product could not enter, quietly accruing styling nobody could see.
 * `ThemePicker` writes `data-theme` for six COLOUR themes, none of which is
 * dark. This module is the switch that was missing.
 *
 * ⚠️ **Appearance is ORTHOGONAL to the colour theme, deliberately.** Making
 * "dark" a seventh entry in `THEMES` would force somebody to give up Emerald to
 * get dark surfaces, and would need a dark variant of each of the six
 * `[data-theme]` blocks to put it back. The two questions are "which accent
 * hue" and "how light are the surfaces"; they compose.
 *
 * ⚠️ **The default is LIGHT, and `"system"` is opt-in.** Every surface in this
 * app was drawn light and worked on for a year under that assumption, so
 * honouring the OS by default would flip the whole company to a mode nobody
 * asked for on one deploy — the same reasoning that makes an ability default ON
 * (§5.39c): absence is not a decision.
 */

export type Appearance = "light" | "dark" | "system";

const KEY = "mm-appearance";

export const DEFAULT_APPEARANCE: Appearance = "light";

/** Fired on the window so every mounted reader updates at once; `storage` only
 *  fires in OTHER tabs, so a same-tab change needs its own signal. */
export const APPEARANCE_EVENT = "mm-appearance-change";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    // An unrecognised value is a missing answer, never a third state — the same
    // rule every stored choice in this app follows (§5.20 `networkAnswer`).
    return raw === "dark" || raw === "light" || raw === "system" ? raw : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearance(next: Appearance): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* A browser that refuses storage still gets the toggle for this session —
       `useAppearance` holds the value in React state either way. */
  }
}

/** Does the OS ask for dark? A browser that cannot answer says light — the
 *  safe direction, since light is what every surface here was drawn for. */
export function systemPrefersDark(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** What `"system"` resolves to right now. Pure apart from the media query. */
export function resolveAppearance(a: Appearance): "light" | "dark" {
  if (a === "dark") return "dark";
  if (a === "light") return "light";
  return systemPrefersDark() ? "dark" : "light";
}

/**
 * Put the answer on `<html>`.
 *
 * ⚠️ **Both the class AND the attribute**, because two mechanisms already read
 * one each: Tailwind's `darkMode: ["class"]` compiles every `dark:` variant
 * against `.dark`, and `pages/patient/redesign.css` was written against
 * `:root[data-theme="dark"]`. Setting only one leaves half the app light.
 * ⚠️ `data-appearance` is a THIRD attribute rather than overwriting
 * `data-theme`: that one carries the colour theme, and clobbering it would drop
 * somebody's Emerald the moment they went dark.
 */
export function applyAppearance(a: Appearance): void {
  try {
    const dark = resolveAppearance(a) === "dark";
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.setAttribute("data-appearance", dark ? "dark" : "light");
  } catch {
    /* Never fail a first paint over a colour scheme. */
  }
}

/**
 * ⚠️ **`?appearance=light` — the recovery route, for the §5.39d reason.** A
 * colour scheme that renders some page unreadable is exactly the situation
 * where "find the settings gear" is not an answer; the layout switch shipped as
 * a one-way door and cost Josh the app for an afternoon. Send somebody stuck
 * `…/?appearance=light`.
 *
 * ⚠️ At module init, BEFORE React mounts — so it works even when the tree that
 * would hold the hook renders nothing useful, and so there is no light flash
 * before the first paint. The param is STRIPPED once applied, or every later
 * in-app navigation carries an instruction given once and a copied link
 * re-flips somebody else's browser.
 */
export function applyAppearanceAtBoot(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const want = params.get("appearance");
    if (want === "light" || want === "dark" || want === "system") {
      writeAppearance(want);
      params.delete("appearance");
      const qs = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
      );
    }
  } catch {
    /* A URL we cannot read is not worth failing the app's first paint over. */
  }
  applyAppearance(readAppearance());
}

/** Subscribe to OS changes. Only meaningful while the choice is `"system"`;
 *  the caller re-applies on every change rather than caching a resolution. */
export function watchSystemAppearance(onChange: () => void): () => void {
  try {
    const mq = window.matchMedia(DARK_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}
