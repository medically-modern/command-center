/**
 * The reload nudge, rendered (§5.54): it appears only for a real newer build,
 * "Later" really hides it, and — the rule that matters most — Reload is
 * refused while this browser is on a call, because reloading the tab that
 * holds the phone ends the call for the patient on the line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const phoneState: { call: unknown } = { call: null };
vi.mock("@/hooks/softphone/useSoftphone", () => ({
  useSoftphone: () => phoneState,
}));

import NewVersionBanner from "./NewVersionBanner";

const deployed = (entry: string) =>
  `<html><head><script type="module" crossorigin src="/x/assets/${entry}"></script></head></html>`;

function runningAs(entry: string | null) {
  document.head.querySelectorAll("script[data-test-entry]").forEach((s) => s.remove());
  if (!entry) return;
  const s = document.createElement("script");
  s.type = "module";
  s.setAttribute("src", `/x/assets/${entry}`);
  s.setAttribute("data-test-entry", "1");
  document.head.appendChild(s);
}

async function settle() {
  // Let the mount-time check's fetch and state update land.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("NewVersionBanner", () => {
  beforeEach(() => {
    phoneState.call = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    runningAs(null);
  });

  it("says nothing — and fetches nothing — when this tab's build is unknown (dev, tests)", async () => {
    runningAs(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewVersionBanner />);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("A new version is ready")).toBeNull();
  });

  it("says nothing when the deployed build is the one this tab runs", async () => {
    runningAs("index-SAME.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(deployed("index-SAME.js"))));
    render(<NewVersionBanner />);
    await settle();
    expect(screen.queryByText("A new version is ready")).toBeNull();
  });

  it("offers the reload when a newer build is live", async () => {
    runningAs("index-OLD.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(deployed("index-NEW.js"))));
    render(<NewVersionBanner />);
    await settle();
    expect(screen.getByText("A new version is ready")).toBeTruthy();
    expect((screen.getByText("Reload") as HTMLButtonElement).disabled).toBe(false);
  });

  it("⚠️ refuses to reload while this browser is on a call — it would end the call", async () => {
    runningAs("index-OLD.js");
    phoneState.call = { callId: "c1", status: "connected" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(deployed("index-NEW.js"))));
    render(<NewVersionBanner />);
    await settle();
    const reload = screen.getByText("Reload") as HTMLButtonElement;
    expect(reload.disabled).toBe(true);
    expect(reload.title).toMatch(/Finish your call first/);
  });

  it("'Later' hides it", async () => {
    runningAs("index-OLD.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(deployed("index-NEW.js"))));
    render(<NewVersionBanner />);
    await settle();
    fireEvent.click(screen.getByText("Later"));
    expect(screen.queryByText("A new version is ready")).toBeNull();
  });

  it("⚠️ a failed check is silence, not a nudge", async () => {
    runningAs("index-OLD.js");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<NewVersionBanner />);
    await settle();
    expect(screen.queryByText("A new version is ready")).toBeNull();
  });
});
