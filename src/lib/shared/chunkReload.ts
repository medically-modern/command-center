/**
 * Self-healing for stale deployments (the 2026-07-14 white-screen incident).
 *
 * Every Pages deploy replaces ALL content-hashed JS chunks, so a tab loaded
 * before a deploy still references chunk files that no longer exist on the
 * server. The first lazy() navigation after that 404s, the dynamic import
 * rejects, React throws during render, and the whole app unmounts to a blank
 * white page (reps keep tabs open for days, so this WILL recur after every
 * code deploy).
 *
 * Recovery: reload the page ONCE so the browser picks up the new index.html
 * with matching chunk hashes. A sessionStorage flag (per-tab, survives the
 * reload) stops a reload loop when the server itself is serving a broken
 * build (e.g. the base-path misdeploy of 2026-07-13) — the second consecutive
 * failure surfaces to AppErrorBoundary instead.
 */
import { lazy, type ComponentType } from "react";

const FLAG = "mm-chunk-reload";

/** A reload has been initiated in THIS document — don't fire another, and
 *  treat pending chunk failures as "reload in flight", not new errors. */
let reloadInFlight = false;

/** Reload the page to pick up a fresh deploy, at most once per tab between
 *  successful chunk loads. Returns true when a reload is in flight (this call
 *  initiated it, or an earlier one did); false means the guard already fired
 *  before this document loaded (or storage is unavailable) and the caller
 *  must surface the error instead. */
export function reloadOnceOnChunkError(): boolean {
  if (reloadInFlight) return true;
  try {
    if (sessionStorage.getItem(FLAG) === "1") return false;
    sessionStorage.setItem(FLAG, "1");
  } catch {
    // No storage → no way to break a reload loop. Don't risk one.
    return false;
  }
  reloadInFlight = true;
  window.location.reload();
  return true;
}

/** Re-arm the guard once a chunk load succeeds — the reload (or a later
 *  deploy) fixed things, so the NEXT stale-deploy failure may reload again. */
export function chunkLoadSucceeded(): void {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
}

/** Vite funnels failed chunk fetches (the lazy import itself AND its
 *  modulepreload'ed deps) through a cancelable "vite:preloadError" on window.
 *  preventDefault() = "handled": Vite then SWALLOWS the error and resolves the
 *  import with `undefined` — so only preventDefault when a reload is actually
 *  in flight; otherwise let Vite rethrow into lazyWithReload's catch. */
export function installChunkReloadGuard(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceOnChunkError()) event.preventDefault();
  });
}

/** Drop-in replacement for React.lazy(): a page chunk that fails to fetch
 *  (deploy replaced the hashed file) reloads once instead of white-screening. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's own constraint
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy<T>(async () => {
    let mod: { default: T } | undefined;
    try {
      mod = await factory();
    } catch (err) {
      if (reloadOnceOnChunkError()) {
        // Page is reloading — never resolve, so the Suspense fallback
        // (spinner) stays up instead of flashing an error.
        return new Promise<never>(() => {});
      }
      throw err; // guard already fired → AppErrorBoundary shows the reload screen
    }
    if (mod?.default) {
      chunkLoadSucceeded();
      return mod;
    }
    // Nullish/defaultless module = Vite swallowed a chunk failure because the
    // vite:preloadError listener preventDefault'ed it (reload in flight).
    // Returning it would crash React on `mod.default` and re-arm the guard as
    // a fake "success" — the exact reload loop this module exists to prevent.
    if (reloadOnceOnChunkError()) {
      return new Promise<never>(() => {});
    }
    throw new Error("Page failed to load (stale deployment?)");
  });
}
