/**
 * Which shell the app renders in (§5.39) — Brandon's redesign, or today's
 * layout.
 *
 * This is HIS OWN mechanism, not an invention: the 2026-09-18 mockup carries a
 * toolbar switch reading "Layout: the redesign" / "Layout: as today (for
 * comparison)", and the file opens on the redesign. Porting the switch with it
 * is what makes a whole-app navigation change additive — the one thing a new
 * global header cannot be on its own.
 *
 * ⚠️ **"as today" must be byte-identical, or the escape hatch is not one.**
 * With the shell off, `AppShell` renders its children and nothing else: no
 * wrapper element, no class, no stylesheet effect. Every rule in `shell.css` is
 * scoped under `.cc-shell`, which only exists while the redesign is on. That is
 * what lets this ship on by default — a rep who hates it, or a page that
 * misbehaves under the header, is one click from exactly the app they had.
 *
 * ⚠️ **Per browser, in localStorage, and every access is wrapped.** It comes
 * back empty in a private window and the accessor can throw where site data is
 * blocked (§ artifact storage rules apply to the SPA too), so a failure reads
 * as the default rather than crashing the shell that renders every page.
 */

export type ShellLayout = "redesign" | "current";

const KEY = "mm-shell-layout";

/**
 * ⚠️ **The default is the REDESIGN** (Josh, 2026-09-18: "everyone, on by
 * default"). A toggle nobody can find is the state this build was already in —
 * the patient screen shipped with one door, buried in the Communications hub,
 * and the first thing reported was "I see nothing".
 */
export const DEFAULT_LAYOUT: ShellLayout = "redesign";

export function readLayout(): ShellLayout {
  try {
    const raw = localStorage.getItem(KEY);
    // An unrecognised value is a missing answer, never a third state — the same
    // rule every query param in this app follows (§5.20 `networkAnswer`).
    return raw === "current" || raw === "redesign" ? raw : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function writeLayout(next: ShellLayout): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* A browser that refuses storage still gets the toggle for this session —
       `useShellLayout` holds the value in React state either way. */
  }
}

/** Fired on the window so every mounted reader updates at once; `storage` only
 *  fires in OTHER tabs, so a same-tab toggle needs its own signal. */
export const LAYOUT_EVENT = "mm-shell-layout-change";
