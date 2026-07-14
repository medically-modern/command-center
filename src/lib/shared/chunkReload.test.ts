/**
 * Stale-deploy self-healing (chunkReload.ts) — locks in the one-shot reload
 * contract so a refactor can't reintroduce either failure mode:
 *   - no reload at all → stale tabs white-screen after every deploy
 *   - unbounded reloads → a genuinely broken deploy reload-loops forever
 *     (the vite:preloadError/undefined-module trap: preventDefault makes Vite
 *     resolve the failed import with `undefined`, which must NOT count as a
 *     successful load).
 *
 * vi.resetModules() simulates a page reload: fresh module state (the
 * `reloadInFlight` latch) while sessionStorage persists, exactly like a tab.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// jsdom's window.location.reload is not writable — swap the whole object.
const reload = vi.fn();
let originalLocation: Location;

beforeEach(() => {
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, reload },
    writable: true,
    configurable: true,
  });
  sessionStorage.clear();
  reload.mockClear();
  vi.resetModules();
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
});

async function load() {
  return import("@/lib/shared/chunkReload");
}

describe("reloadOnceOnChunkError", () => {
  it("reloads on the first chunk failure", async () => {
    const m = await load();
    expect(m.reloadOnceOnChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a second failure in the SAME document reports in-flight without a second reload", async () => {
    const m = await load();
    m.reloadOnceOnChunkError();
    expect(m.reloadOnceOnChunkError()).toBe(true); // in flight — callers keep the spinner up
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does NOT reload again after the reload (broken deploy must not loop)", async () => {
    const m1 = await load();
    m1.reloadOnceOnChunkError();
    vi.resetModules(); // the page reloads → fresh module, sessionStorage persists
    const m2 = await load();
    expect(m2.reloadOnceOnChunkError()).toBe(false); // caller must surface the error
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a successful chunk load", async () => {
    const m1 = await load();
    m1.reloadOnceOnChunkError();
    vi.resetModules();
    const m2 = await load();
    m2.chunkLoadSucceeded(); // reload picked up a good deploy
    expect(m2.reloadOnceOnChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe("lazyWithReload undefined-module trap", () => {
  it("does NOT treat a Vite-swallowed failure (undefined module) as success", async () => {
    const m = await load();
    // Simulate: vite:preloadError already fired and initiated the reload…
    expect(m.reloadOnceOnChunkError()).toBe(true);
    // …then the import resolves with undefined (Vite swallowed the error).
    const factory = () =>
      Promise.resolve(undefined as unknown as { default: React.ComponentType });
    m.lazyWithReload(factory);
    // Give the async loader a tick — it must NOT clear the guard flag.
    await new Promise((r) => setTimeout(r, 10));
    expect(sessionStorage.getItem("mm-chunk-reload")).toBe("1");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("installChunkReloadGuard (vite:preloadError)", () => {
  it("prevents default while a reload is in flight, exactly one reload", async () => {
    const m = await load();
    m.installChunkReloadGuard();

    const first = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // A dep failure often follows the entry failure in the same document —
    // still handled (page is reloading), still only one reload.
    const second = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
