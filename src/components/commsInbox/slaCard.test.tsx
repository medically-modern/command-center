/**
 * The Communications SLA card (COMMS_INBOX_PLAN.md §1.2, Josh's D8), rendered.
 *
 * What it must never do: count Left voicemail as a resolution, draw zeros for a
 * report it could not read, or hand somebody without Communications a link
 * into a page that walls them off.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SlaReport } from "@/lib/commsInbox/api";

const m = vi.hoisted(() => ({
  sla: vi.fn(),
  canWork: true,
}));

vi.mock("@/lib/commsInbox/api", async (orig) => {
  const real = await orig<typeof import("@/lib/commsInbox/api")>();
  return { ...real, fetchSla: (d: number) => m.sla(d) };
});
vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ({
    email: "josh@medicallymodern.com",
    config: {
      managers: ["josh@medicallymodern.com"],
      processors: { "katie.tyler@medicallymodern.com": { name: "Katie Tyler", roles: [] } },
    },
  }),
}));
vi.mock("@/components/shell/AbilityLock", () => ({ useAbility: () => m.canWork }));

import SlaCard, { OPEN_BREACHES_HREF } from "./SlaCard";

const H = 3600_000;
const NOW = Date.parse("2026-09-23T15:00:00Z");

function report(over: Partial<SlaReport> = {}): SlaReport {
  return {
    since: NOW - 30 * 24 * H,
    now: NOW,
    open: 14,
    over: 3,
    resolved: 20,
    within: 17,
    withinPct: 85,
    medianMs: 2 * H + 30 * 60_000,
    byHow: { called: 11, texted: 6, no_action: 3 },
    attempts: 7,
    reps: [
      { who: "katie.tyler@medicallymodern.com", resolved: 12, within: 11, withinPct: 92, medianMs: 90 * 60_000, hows: ["called", "texted"], attempts: 4 },
      { who: "brandon@medicallymodern.com", resolved: 0, within: 0, withinPct: null, medianMs: null, hows: [], attempts: 3 },
    ],
    ...over,
  };
}

const tile = (label: string) => document.querySelector(`[data-sla-tile="${label}"]`) as HTMLElement;
const show = () =>
  render(
    <MemoryRouter>
      <SlaCard />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.canWork = true;
});

describe("SlaCard", () => {
  it("draws the four tiles from the gateway's numbers, over the last 30 days", async () => {
    m.sla.mockResolvedValue(report());
    show();
    await screen.findByText("85%");
    expect(m.sla).toHaveBeenCalledWith(30);
    expect(within(tile("Unresolved now")).getByText("14")).toBeTruthy();
    expect(within(tile("Unresolved now")).getByText("3 over 24h")).toBeTruthy();
    expect(within(tile("Resolved within 24h")).getByText("17 of 20 in this period")).toBeTruthy();
    expect(within(tile("Median time to resolve")).getByText("2h 30m")).toBeTruthy();
    expect(tile("How it was resolved").textContent).toContain("Called 11");
    expect(tile("How it was resolved").textContent).toContain("No action needed 3");
  });

  it("⚠️⚠️ Left voicemail is shown BESIDE the resolutions and never added to them", async () => {
    m.sla.mockResolvedValue(report());
    show();
    await screen.findByText("85%");
    const how = tile("How it was resolved");
    // 20 resolved, not 27 — the seven attempts are their own line.
    expect(how.textContent).toContain("20 resolved");
    expect(how.textContent).not.toContain("27");
    expect(how.querySelector("[data-sla-attempts]")?.textContent).toContain("7 left voicemail");
    expect(how.textContent).not.toMatch(/Left voicemail \d/);
    // Per rep: a rep with attempts and nothing resolved reads 0 resolved, not 3.
    const brandon = document.querySelector('[data-sla-rep="brandon@medicallymodern.com"]') as HTMLElement;
    expect(brandon.textContent).toContain("Brandon");
    const cells = [...brandon.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells[1]).toBe("0");
    expect(cells[2]).toBe("—");
    expect(cells[5]).toBe("3");
  });

  it("names reps from the access list, with the email kept on hover", async () => {
    m.sla.mockResolvedValue(report());
    show();
    const cell = await screen.findByText("Katie Tyler");
    expect(cell.getAttribute("title")).toBe("katie.tyler@medicallymodern.com");
  });

  it("⚠️ a failed read says so and draws no numbers — then Try again reads again", async () => {
    m.sla.mockRejectedValueOnce(new Error("Loading the report failed (500)"));
    show();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("nothing here is counted");
    expect(document.querySelector("[data-sla-tile]")).toBeNull();
    expect(screen.queryByText("0 over 24h")).toBeNull();
    m.sla.mockResolvedValueOnce(report());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("85%")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("⚠️ a Refresh that fails takes the OLD numbers down with it — a stale report under an error still reads as current", async () => {
    m.sla.mockResolvedValueOnce(report());
    show();
    await screen.findByText("85%");
    m.sla.mockRejectedValueOnce(new Error("Loading the report failed (503)"));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("85%")).toBeNull();
    expect(document.querySelector("[data-sla-tile]")).toBeNull();
    // Not even the period line: it describes a report that is no longer shown.
    expect(document.querySelector('section[aria-label="Communications SLA"]')?.textContent).not.toContain("since");
  });

  it("an empty window reads as empty — dashes, not 0% and 0m", async () => {
    m.sla.mockResolvedValue(
      report({ open: 0, over: 0, resolved: 0, within: 0, withinPct: null, medianMs: null, byHow: {}, attempts: 0, reps: [] }),
    );
    show();
    expect(await screen.findByText("Nothing resolved yet")).toBeTruthy();
    expect(within(tile("Resolved within 24h")).getByText("—")).toBeTruthy();
    expect(within(tile("Median time to resolve")).getByText("—")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByText(/The report fills in as the team resolves items/)).toBeTruthy();
  });

  it("Open breaches opens the hub's Inbox on Over 24h", async () => {
    m.sla.mockResolvedValue(report());
    show();
    const link = await screen.findByRole("link", { name: /Open breaches/ });
    expect(link.getAttribute("href")).toBe(OPEN_BREACHES_HREF);
    expect(OPEN_BREACHES_HREF).toBe("/assigned-patients?inbox=over");
  });

  it("⚠️ without Communications the link is SHOWN and inert, with the reason", async () => {
    m.canWork = false;
    m.sla.mockResolvedValue(report());
    show();
    await screen.findByText("85%");
    const inert = screen.getByRole("link", { name: /Open breaches/ });
    expect(inert.getAttribute("aria-disabled")).toBe("true");
    expect(inert.getAttribute("href")).toBeNull();
    expect(inert.getAttribute("title")).toMatch(/Communications isn.t assigned to you/);
  });

  it("reads once on open and again only on Refresh — never polls", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      m.sla.mockResolvedValue(report());
      show();
      await screen.findByText("85%");
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(m.sla).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
      await waitFor(() => expect(m.sla).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
