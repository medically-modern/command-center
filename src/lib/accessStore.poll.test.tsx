/**
 * §5.39j — a click on /access must not be undone by the 10s poll. GitHub can
 * serve the PREVIOUS access.json for a while after a PUT, and the poll used to
 * apply whatever it read, so a ticked chip flipped back and had to be clicked
 * again (Josh, 2026-09-23).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAccess, type AccessConfig } from "./accessStore";

const base: AccessConfig = {
  managers: ["josh@medicallymodern.com"],
  processors: { "madd@medicallymodern.com": { name: "Madd", roles: [] } },
  callAnswerers: [],
};

function ghResponse(cfg: AccessConfig, sha: string) {
  return new Response(JSON.stringify({ sha, content: btoa(JSON.stringify(cfg)) }), { status: 200 });
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

    act(() => result.current.setHomeView("madd@medicallymodern.com", "oversight", true));
    expect(result.current.config.processors["madd@medicallymodern.com"].homeView?.[0]).toBe("oversight");

    // Two poll ticks land while GitHub still serves the old file.
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(result.current.config.processors["madd@medicallymodern.com"].homeView?.[0]).toBe("oversight");
    expect(puts).toHaveLength(1);
  });

  it("two quick clicks are saved in order, the last save carrying both", async () => {
    const { result } = renderHook(() => useAccess());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => {
      result.current.setAbility("madd@medicallymodern.com", "comms", false);
      result.current.setAbility("madd@medicallymodern.com", "inventory", false);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const last = JSON.parse(atob(JSON.parse(puts[puts.length - 1]).content)) as AccessConfig;
    expect(last.processors["madd@medicallymodern.com"].perms).toMatchObject({ comms: false, inventory: false });
  });
});
