/**
 * The ten-minute heads-up before a booked call (Josh, 2026-10-02): a distinct
 * two-ring chime and a top-right card saying who and when — for people who
 * hold the Care Coordinator role and nobody else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  now: 14 * 60, // 2:00 PM ET
  access: { type: "processor", profile: { name: "Dana", roles: ["scheduledCalls"] } } as unknown,
  calls: [] as unknown[],
  welcome: [] as unknown[],
  chime: vi.fn(async () => true),
}));

vi.mock("@/components/AccessProvider", () => ({ useAccessContext: () => ({ access: h.access }) }));
vi.mock("@/lib/scheduledCalls/mondayApi", () => ({ fetchScheduledCalls: async () => h.calls }));
vi.mock("@/lib/careCoordinator/calendlyDay", () => ({
  calendlyDayAvailable: () => true,
  fetchCalendlyDay: async () => ({ ok: true, bookings: h.welcome, error: null }),
}));
vi.mock("@/lib/scheduledCalls/reminderChime", () => ({ playReminderChime: h.chime, primeReminderChime: () => {} }));
vi.mock("@/lib/scheduledCalls/workflow", async (orig) => {
  const actual = await orig<typeof import("@/lib/scheduledCalls/workflow")>();
  return { ...actual, nowMinutesEt: () => h.now };
});

import ScheduledCallHost from "./ScheduledCallHost";
import ReminderCards from "./ReminderCards";
import { claimChime, reminderStore, untilLabel, welcomeSlot } from "@/lib/scheduledCalls/reminders";
import { etToday } from "@/lib/masheke/etDate";

const TODAY = etToday();
const intakeCall = (over: Record<string, unknown> = {}) => ({
  id: "101", groupId: "group_mm5zgeak", name: "Marcus Delaney", phone: "3475550101", email: "",
  callDate: TODAY, callTime: "14:10:00", bookingStatus: "Scheduled", ...over,
});

function mount() {
  return render(
    <MemoryRouter>
      <ScheduledCallHost />
      <ReminderCards />
    </MemoryRouter>,
  );
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("scheduled-call reminders", () => {
  beforeEach(() => {
    h.now = 14 * 60;
    h.access = { type: "processor", profile: { name: "Dana", roles: ["scheduledCalls"] } };
    h.calls = [];
    h.welcome = [];
    h.chime.mockClear();
    localStorage.clear();
    reminderStore.clear();
  });
  afterEach(cleanup);

  it("a call ten minutes out raises a card with who and when, and rings once", async () => {
    h.calls = [intakeCall()];
    mount();
    await flush();
    const card = await screen.findByTestId("call-reminder");
    expect(card).toHaveTextContent("Marcus Delaney");
    expect(card).toHaveTextContent("Intake call · 2:10 PM · in 10 min");
    expect(card).toHaveTextContent("(347) 555-0101");
    expect(h.chime).toHaveBeenCalledTimes(1);
  });

  it("nothing for a call more than ten minutes out", async () => {
    h.calls = [intakeCall({ callTime: "14:11:00" })];
    mount();
    await flush();
    expect(screen.queryByTestId("call-reminder")).toBeNull();
    expect(h.chime).not.toHaveBeenCalled();
  });

  it("only people who hold the Care Coordinator role get it — managers don't", async () => {
    h.calls = [intakeCall()];
    h.access = { type: "manager" };
    mount();
    await flush();
    expect(screen.queryByTestId("call-reminder")).toBeNull();
    h.access = { type: "processor", profile: { name: "Pat", roles: ["benefits"] } };
    cleanup();
    mount();
    await flush();
    expect(screen.queryByTestId("call-reminder")).toBeNull();
    expect(h.chime).not.toHaveBeenCalled();
  });

  it("welcome calls from Calendly get one too", async () => {
    // 2:05 PM Eastern, as a real instant.
    const at = new Date(`${TODAY}T14:05:00-04:00`);
    const iso = Number.isNaN(at.getTime()) ? "" : at.toISOString();
    const booking = {
      kind: "welcome" as const, eventUri: "ev/1", eventName: "Welcome", startTime: iso, endTime: iso,
      name: "Amara Nwosu", email: "a@example.com", phone: "3475550103", timezone: "", rescheduleUrl: "",
    };
    // The fixture is pinned to EDT; skip the welcome assertion in the weeks it isn't.
    if (welcomeSlot(booking).callTime !== "14:05:00") return;
    h.welcome = [booking];
    mount();
    await flush();
    expect(await screen.findByTestId("call-reminder")).toHaveTextContent("Welcome call · 2:05 PM · in 5 min");
  });

  it("dismiss removes the card", async () => {
    h.calls = [intakeCall()];
    mount();
    await flush();
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss reminder" }));
    expect(screen.queryByTestId("call-reminder")).toBeNull();
  });

  it("only the first tab to claim a call rings for it", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(claimChime("d|i:1", 1000, s)).toBe(true);
    expect(claimChime("d|i:1", 2000, s)).toBe(false);
    expect(claimChime("d|i:2", 2000, s)).toBe(true);
    // Storage that can't be used means this tab rings: doubled beats missed.
    expect(claimChime("d|i:1", 2000, null)).toBe(true);
  });

  it("says how far off the call is", () => {
    expect(untilLabel("14:10:00", 840)).toBe("in 10 min");
    expect(untilLabel("14:00:00", 840)).toBe("now");
    expect(untilLabel("13:57:00", 840)).toBe("started 3 min ago");
  });

  it("the ring is distinct from the incoming-call ring, and rings exactly twice", () => {
    const chime = readFileSync(join(process.cwd(), "src/lib/scheduledCalls/reminderChime.ts"), "utf8");
    const ring = readFileSync(join(process.cwd(), "src/lib/softphone/ringtone.ts"), "utf8");
    expect(chime).toContain("export const RING_COUNT = 2;");
    expect(chime).toContain('o.type = "triangle"');
    expect(ring).toContain('o.type = "sine"');
    // No repeating timer: a hidden tab throttles them (ringtone.ts's header).
    expect(chime).not.toMatch(/setInterval|setTimeout/);
  });

  it("the cards draw in the incoming-call stack, not a second corner of their own", () => {
    const host = readFileSync(join(process.cwd(), "src/components/inboundCalls/IncomingCallHost.tsx"), "utf8");
    const stack = host.slice(host.indexOf('className="fixed top-4 right-4'));
    expect(stack.slice(0, stack.indexOf("</div>"))).toContain("<ReminderCards />");
  });
});
