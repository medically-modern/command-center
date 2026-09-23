/**
 * §5.39j — a click on /access must not be undone by the 10s poll. GitHub can
 * serve the PREVIOUS access.json for a while after a PUT, and the poll used to
 * apply whatever it read, so a ticked chip flipped back and had to be clicked
 * again (Josh, 2026-09-23).
 *
 * And a save must not undo ANOTHER admin's click. A sha conflict used to be
 * retried by re-sending this browser's whole config with the fresh sha, which
 * overwrote whatever the other admin had saved in between (Greptile on
 * medically-modern/command-center-test PR #58).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MAX_CALL_ANSWERERS, configWithoutEmail, useAccess, type AccessConfig } from "./accessStore";

const { toast } = vi.hoisted(() => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("sonner", () => ({ toast }));

const MADD = "madd@medicallymodern.com";

const base: AccessConfig = {
  managers: ["josh@medicallymodern.com"],
  processors: { [MADD]: { name: "Madd", roles: [] } },
  callAnswerers: [],
};

function ghResponse(cfg: unknown, sha: string) {
  return new Response(JSON.stringify({ sha, content: btoa(JSON.stringify(cfg)) }), { status: 200 });
}

/** Let the fake clock and every promise behind it run for `ms`. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useAccess — local edits win over a stale poll", () => {
  let puts: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    puts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          puts.push(String(init.body));
          return new Response(JSON.stringify({ content: { sha: "new" } }), { status: 200 });
        }
        // Every GET answers with the ORIGINAL file — i.e. GitHub is stale.
        return ghResponse(base, "old");
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a poll right after a click does not put the chip back", async () => {
    const { result } = renderHook(() => useAccess());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.loading).toBe(false);

    act(() => result.current.setHomeView(MADD, "oversight", true));
    expect(result.current.config.processors[MADD].homeView?.[0]).toBe("oversight");

    // Two poll ticks land while GitHub still serves the old file.
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(result.current.config.processors[MADD].homeView?.[0]).toBe("oversight");
    expect(puts).toHaveLength(1);

    // …and neither of them handed its stale sha to the next save.
    act(() => result.current.setAbility(MADD, "comms", false));
    await settle();
    expect(puts).toHaveLength(2);
    expect(JSON.parse(puts[1]).sha).toBe("new");
  });

  it("two quick clicks are saved in order, the last save carrying both", async () => {
    const { result } = renderHook(() => useAccess());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => {
      result.current.setAbility(MADD, "comms", false);
      result.current.setAbility(MADD, "inventory", false);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const last = JSON.parse(atob(JSON.parse(puts[puts.length - 1]).content)) as AccessConfig;
    expect(last.processors[MADD].perms).toMatchObject({ comms: false, inventory: false });
  });
});

/**
 * GitHub's contents API, as the worker's /gh-state relays it (§10): a PUT is
 * accepted only when it names the file's CURRENT blob sha — any other sha is a
 * 409 — and a PUT with no sha, for a file that exists, is a 422.
 * `latencyMs` puts every request in flight for that long on the fake clock, so
 * a click can land while a save is still out.
 */
function fakeGitHub(initial: unknown, latencyMs = 0) {
  let n = 0;
  const file = { cfg: initial as AccessConfig, sha: "s0" };
  let previous = { ...file };
  let staleReads = 0;
  const puts: Array<{ sha?: string; cfg: AccessConfig; status: number }> = [];
  const commit = (cfg: AccessConfig) => {
    previous = { ...file };
    file.cfg = cfg;
    file.sha = `s${++n}`;
  };
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
    if (init?.method !== "PUT") {
      // GitHub can answer a GET with the version BEFORE the latest write.
      const served = staleReads > 0 ? (staleReads--, previous) : file;
      return ghResponse(served.cfg, served.sha);
    }
    const body = JSON.parse(String(init.body));
    const cfg = JSON.parse(atob(body.content)) as AccessConfig;
    const status = !body.sha ? 422 : body.sha !== file.sha ? 409 : 200;
    puts.push({ sha: body.sha, cfg, status });
    if (status !== 200) return new Response(JSON.stringify({ message: "sha does not match" }), { status });
    commit(cfg);
    return new Response(JSON.stringify({ content: { sha: file.sha } }), { status: 200 });
  });
  return {
    fetchImpl,
    puts,
    file,
    /** Another admin's save landing in the file behind this browser's back. */
    otherAdminWrites(fn: (c: AccessConfig) => AccessConfig) {
      commit(fn(file.cfg));
    },
    /** The next `k` reads still serve the version before the latest write. */
    serveStaleReads(k: number) {
      staleReads = k;
    },
  };
}

const withRole = (cfg: AccessConfig, email: string, role: string): AccessConfig => ({
  ...cfg,
  processors: {
    ...cfg.processors,
    [email]: { ...cfg.processors[email], roles: [...cfg.processors[email].roles, role] },
  },
});

describe("useAccess — a save never overwrites another admin's save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.error.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a 409 re-applies THIS save's edit to the fresh file — the final PUT carries both changes", async () => {
    const gh = fakeGitHub(base);
    vi.stubGlobal("fetch", gh.fetchImpl);
    const { result } = renderHook(() => useAccess());
    await settle();

    // Another admin saves between our load and our click, so our sha is behind.
    gh.otherAdminWrites((c) => withRole(c, MADD, "evaluate"));
    act(() => result.current.setAbility(MADD, "comms", false));
    await settle();

    expect(gh.puts.map((p) => p.status)).toEqual([409, 200]);
    const last = gh.puts[gh.puts.length - 1];
    expect(last.sha).toBe("s1");
    expect(last.cfg.processors[MADD].roles).toEqual(["evaluate"]); // theirs
    expect(last.cfg.processors[MADD].perms).toEqual({ comms: false }); // ours
    expect(gh.file.cfg).toEqual(last.cfg);
    // The screen shows the merge, not just our half of it.
    expect(result.current.config.processors[MADD]).toMatchObject({ roles: ["evaluate"], perms: { comms: false } });
  });

  it("two browsers ticking different chips a few seconds apart both land in the file", async () => {
    const gh = fakeGitHub(base);
    vi.stubGlobal("fetch", gh.fetchImpl);
    // Two browsers are two copies of the module: nothing is shared but the file.
    vi.resetModules();
    const { useAccess: useAccessA } = await import("./accessStore");
    vi.resetModules();
    const { useAccess: useAccessB } = await import("./accessStore");
    const a = renderHook(() => useAccessA());
    const b = renderHook(() => useAccessB());
    await settle();

    act(() => a.result.current.setAbility(MADD, "comms", false)); // A ticks a chip…
    await settle(2_000);
    act(() => b.result.current.toggleProcessorRole(MADD, "evaluate")); // …B ticks another
    await settle();

    const both = { roles: ["evaluate"], perms: { comms: false } };
    expect(gh.file.cfg.processors[MADD]).toMatchObject(both);
    // B sees A's change as soon as its merge lands…
    expect(b.result.current.config.processors[MADD]).toMatchObject(both);
    // …and A sees B's once its own quiet window has passed and a poll lands.
    await settle(45_000);
    expect(a.result.current.config.processors[MADD]).toMatchObject(both);
  });

  it("a re-read that is still stale is retried, never written over", async () => {
    const gh = fakeGitHub(base);
    vi.stubGlobal("fetch", gh.fetchImpl);
    const { result } = renderHook(() => useAccess());
    await settle();

    gh.otherAdminWrites((c) => withRole(c, MADD, "evaluate"));
    gh.serveStaleReads(1); // the first read after the 409 still serves the old file
    act(() => result.current.setAbility(MADD, "comms", false));
    await settle(5_000);

    expect(gh.puts.map((p) => p.status)).toEqual([409, 409, 200]);
    expect(gh.file.cfg.processors[MADD]).toMatchObject({ roles: ["evaluate"], perms: { comms: false } });
  });

  it("a click made while the conflicting save is still out rides the merged write", async () => {
    const gh = fakeGitHub(base, 100);
    vi.stubGlobal("fetch", gh.fetchImpl);
    const { result } = renderHook(() => useAccess());
    await settle(100);

    gh.otherAdminWrites((c) => withRole(c, MADD, "evaluate"));
    act(() => result.current.setAbility(MADD, "comms", false));
    await settle(50); // the PUT is in flight…
    act(() => result.current.setAbility(MADD, "inventory", false)); // …when the next click lands
    await settle(1_000);

    const all = { roles: ["evaluate"], perms: { comms: false, inventory: false } };
    expect(gh.file.cfg.processors[MADD]).toMatchObject(all);
    expect(result.current.config.processors[MADD]).toMatchObject(all);
  });

  it("a replayed role keeps its meaning: two admins turning the same role ON leaves it on", async () => {
    const gh = fakeGitHub(base);
    vi.stubGlobal("fetch", gh.fetchImpl);
    const { result } = renderHook(() => useAccess());
    await settle();

    gh.otherAdminWrites((c) => withRole(c, MADD, "evaluate"));
    // On our screen it is still off, so this click turns it ON. Re-run as a
    // toggle on top of the other admin's save, it would turn it back off.
    act(() => result.current.toggleProcessorRole(MADD, "evaluate"));
    await settle();

    expect(gh.file.cfg.processors[MADD].roles).toEqual(["evaluate"]);
    expect(result.current.config.processors[MADD].roles).toEqual(["evaluate"]);
  });

  it("a merge that adds nothing is still written, so a stale re-read cannot swallow the click", async () => {
    const gh = fakeGitHub(base);
    vi.stubGlobal("fetch", gh.fetchImpl);
    const { result } = renderHook(() => useAccess());
    await settle();

    gh.otherAdminWrites((c) => withRole(c, MADD, "evaluate")); // one admin turns it on…
    gh.otherAdminWrites((c) => ({ ...c, processors: { ...c.processors, [MADD]: { name: "Madd", roles: [] } } })); // …another off again
    gh.serveStaleReads(1); // …and our first re-read still shows it on
    act(() => result.current.toggleProcessorRole(MADD, "evaluate")); // off on our screen: turn it ON
    await settle(5_000);

    expect(gh.puts.map((p) => p.status)).toEqual([409, 409, 200]);
    expect(gh.file.cfg.processors[MADD].roles).toEqual(["evaluate"]);
    expect(result.current.config.processors[MADD].roles).toEqual(["evaluate"]);
  });

  it("the last answering slot, taken by another admin first, refuses ours on the merge — and says so", async () => {
    const four = ["p1", "p2", "p3", "p4"].map((p) => `${p}@medicallymodern.com`);
    const gh = fakeGitHub({ ...base, callAnswerers: four });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const { result } = renderHook(() => useAccess());
    await settle();

    gh.otherAdminWrites((c) => ({ ...c, callAnswerers: [...c.callAnswerers, "katie@medicallymodern.com"] }));
    let accepted = false;
    act(() => { accepted = result.current.setCallAnswerer(MADD, true); });
    expect(accepted).toBe(true); // four of five were taken on this screen
    await settle();

    expect(gh.file.cfg.callAnswerers).toHaveLength(MAX_CALL_ANSWERERS);
    expect(gh.file.cfg.callAnswerers).not.toContain(MADD);
    expect(result.current.config.callAnswerers).toEqual(gh.file.cfg.callAnswerers);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(MADD));
  });

  it("removal wins: a change to somebody another admin just removed does not bring them back", async () => {
    const gh = fakeGitHub(base);
    vi.stubGlobal("fetch", gh.fetchImpl);
    const { result } = renderHook(() => useAccess());
    await settle();

    gh.otherAdminWrites((c) => configWithoutEmail(c, MADD));
    // Still on our screen, so the click is taken — an ability entry would be
    // enough for `resolveAccess` to let her sign in again.
    act(() => result.current.setAbility(MADD, "comms", false));
    await settle();

    expect(Object.keys(gh.file.cfg.processors)).not.toContain(MADD);
    expect(Object.keys(result.current.config.processors)).not.toContain(MADD);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(`${MADD} was removed by another admin`));
  });

  it("a pure manager — no processor entry — can still be given a role", async () => {
    const corey = "corey@medicallymodern.com";
    const gh = fakeGitHub({ ...base, managers: [...base.managers, corey] });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const { result } = renderHook(() => useAccess());
    await settle();

    act(() => result.current.toggleProcessorRole(corey, "evaluate"));
    await settle();
    expect(gh.file.cfg.processors[corey]).toEqual({ name: "corey", roles: ["evaluate"] });
    expect(gh.file.cfg.managers).toContain(corey);
  });

  it("a write keeps a top-level key this build does not know about", async () => {
    const gh = fakeGitHub({ ...base, futureSetting: { on: true } });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const { result } = renderHook(() => useAccess());
    await settle();

    act(() => result.current.setAbility(MADD, "comms", false));
    await settle();
    expect((gh.file.cfg as unknown as Record<string, unknown>).futureSetting).toEqual({ on: true });

    // …through a merged retry as well as a clean write.
    gh.otherAdminWrites((c) => withRole(c, MADD, "evaluate"));
    act(() => result.current.setAbility(MADD, "inventory", false));
    await settle();
    expect(gh.puts[gh.puts.length - 1].status).toBe(200);
    expect((gh.file.cfg as unknown as Record<string, unknown>).futureSetting).toEqual({ on: true });
    expect(gh.file.cfg.processors[MADD]).toMatchObject({ roles: ["evaluate"], perms: { comms: false, inventory: false } });
  });

  it("a file gone missing mid-merge is re-created from this browser's view, never from nothing", async () => {
    const gh = fakeGitHub(base);
    let gone = false;
    const puts: Array<{ sha?: string; cfg: AccessConfig }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!gone) return gh.fetchImpl(url, init);
        if (init?.method !== "PUT") return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
        const body = JSON.parse(String(init.body));
        puts.push({ sha: body.sha, cfg: JSON.parse(atob(body.content)) });
        return body.sha
          ? new Response(JSON.stringify({ message: "sha does not match" }), { status: 409 })
          : new Response(JSON.stringify({ content: { sha: "s9" } }), { status: 201 });
      }),
    );
    const { result } = renderHook(() => useAccess());
    await settle();

    gone = true;
    act(() => result.current.setAbility(MADD, "comms", false));
    await settle();

    const last = puts[puts.length - 1];
    expect(last.sha).toBeUndefined();
    // Not an empty config with one edit on it — that would drop every manager
    // and put the whole company into bootstrap mode.
    expect(last.cfg.managers).toEqual(base.managers);
    expect(last.cfg.processors[MADD]).toMatchObject({ name: "Madd", perms: { comms: false } });
    expect(result.current.config.managers).toEqual(base.managers);
  });

  it("a save that cannot land still toasts", async () => {
    const gh = fakeGitHub(base);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === "PUT" ? new Response("{}", { status: 500 }) : gh.fetchImpl(url, init),
      ),
    );
    const { result } = renderHook(() => useAccess());
    await settle();

    act(() => result.current.setAbility(MADD, "comms", false));
    await settle();
    expect(toast.error).toHaveBeenCalledWith("Couldn't save that access change. Refresh the page and try again.");
    expect(gh.file.cfg).toEqual(base);
  });
});
