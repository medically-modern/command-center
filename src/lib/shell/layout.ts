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

/**
 * ⚠️⚠️ **A ONE-TIME MIGRATION OFF THE OLD LAYOUT** (§5.44). The toggle was
 * removed on 2026-09-21 (Josh: *"remove switch to tlayout as it ws"*) — and
 * removing a control does not move the browsers already sitting behind it.
 * Anybody whose localStorage said `"current"` would have opened the app into a
 * layout with no header, which is where the toggle used to live, and therefore
 * no way out but a URL they do not know about. That is precisely the one-way
 * door §5.39d records costing Josh an afternoon, so it is closed by moving
 * them rather than by trusting nobody is there.
 *
 * ⚠️ It runs AFTER `applyLayoutFromUrl`, so `?layout=current` still works for
 * the length of a page view — the mechanism survives for comparison, it is
 * just no longer somewhere a person can land by accident. Set the flag so a
 * deliberate param is not undone by the same boot that honoured it.
 */
export function migrateOffOldLayout(fromUrl: boolean): void {
  if (fromUrl) return;
  try {
    if (localStorage.getItem(KEY) === "current") writeLayout(DEFAULT_LAYOUT);
  } catch {
    /* A browser that refuses storage was never stuck in the first place. */
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

/**
 * ⚠️⚠️ **`?layout=redesign` — THE RECOVERY ROUTE, and it exists because this
 * shipped as a ONE-WAY DOOR** (Josh, 2026-09-18). The toggle was in the global
 * header's gear menu alone, and "as today" removes the header: switching away
 * deleted the only control that could switch back, from every page at once.
 * The settings popover now carries the toggle in both layouts — but that
 * popover is not on EVERY page (the patient screen and the stage pages have no
 * settings menu), so a link is the one route that works from wherever somebody
 * is stuck. Send them `…/?layout=redesign`.
 *
 * ⚠️ **At module init, BEFORE React mounts** — deliberately not a hook. A
 * layout that renders a broken or empty screen is exactly when a hook inside
 * that tree will not run, and the recovery has to work anyway. It also means
 * one execution rather than one per `useShellLayout` caller.
 *
 * ⚠️ The param is STRIPPED with `replaceState` once applied: leaving it on the
 * URL makes every later in-app navigation carry an instruction the person gave
 * once, and a copied link would re-flip somebody else's browser.
 */
export function applyLayoutFromUrl(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const want = params.get("layout");
    if (want !== "redesign" && want !== "current") return false;
    writeLayout(want);
    params.delete("layout");
    const qs = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );
    return true;
  } catch {
    /* A URL we cannot read is not worth failing the app's first paint over. */
    return false;
  }
}
