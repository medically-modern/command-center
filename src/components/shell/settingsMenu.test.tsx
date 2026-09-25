/**
 * Brandon's settings menu (§5.52): who you are, Calls, Appearance, Sign out —
 * on the ring preferences that already exist, with NO Texts section (Josh,
 * 2026-09-24: "notify about new texts from my patients - dont build that yet").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join("\n");

const access = {
  email: "me@medicallymodern.com",
  config: { managers: [], processors: {}, callAnswerers: ["me@medicallymodern.com"] },
};
vi.mock("@/components/AccessProvider", () => ({ useAccessContext: () => access }));

const phone = {
  leader: true,
  enabled: true,
  registration: "registered",
  ringMuted: false,
  registrationError: null,
  lastError: null,
  rings: [],
  call: null,
  setRingMuted: vi.fn(),
  takeOver: vi.fn(),
};
vi.mock("@/hooks/softphone/useSoftphone", () => ({ useSoftphone: () => phone }));

const fetchRingPrefs = vi.fn();
const saveRingPrefs = vi.fn();
vi.mock("@/lib/inboundCalls/callsApi", () => ({
  fetchRingPrefs: (...a: unknown[]) => fetchRingPrefs(...a),
  saveRingPrefs: (...a: unknown[]) => saveRingPrefs(...a),
}));
vi.mock("@/lib/shared/auth", () => ({
  authRequired: () => true,
  getUser: () => ({ email: "me@medicallymodern.com", name: "Me" }),
  signOut: () => {},
}));
// Radix, portals and a fetch of its own — not what this test is about.
vi.mock("@/components/inboundCalls/RingPreferencesDialog", () => ({
  default: () => null,
  askDesktopAlerts: vi.fn(),
}));

import { CallSettings } from "./CallSettings";
import { callStatusLine } from "@/lib/shell/callStatusLine";

beforeEach(() => {
  fetchRingPrefs.mockReset();
  saveRingPrefs.mockReset();
  saveRingPrefs.mockResolvedValue(undefined);
  fetchRingPrefs.mockResolvedValue({ mode: "all", forwardNumber: "5555550100", allow: [] });
  access.config.callAnswerers = ["me@medicallymodern.com"];
  phone.ringMuted = false;
  phone.setRingMuted.mockReset();
});

describe("the menu's shape", () => {
  const header = live(read("components/shell/GlobalHeader.tsx"));
  const calls = live(read("components/shell/CallSettings.tsx"));
  const badge = live(read("components/inboundCalls/CallConnectionBadge.tsx"));

  it("is Brandon's: who · Calls · Appearance · Sign out, with the dot on the gear", () => {
    expect(header).toContain('className="menu settings"');
    expect(header).toContain('className="who"');
    expect(header).toContain("<CallSettings");
    expect(header).toContain("className={`sdot ");
    expect(header).toContain('className="segc sm"');
    expect(header).toContain("Sign out");
  });

  it("⚠️ has NO Texts section — Josh: \"dont build that yet\"", () => {
    expect(header).not.toMatch(/eyebrow">Texts/);
    expect(header).not.toContain("textNotify");
    expect(calls).not.toContain("Texts");
  });

  it("⚠️ the Calls section reads the badge's ONE status, never `canAnswerCalls` itself", () => {
    expect(calls).toContain("useCallStatus");
    expect(calls).not.toContain("canAnswerCalls");
    expect(badge).toContain("export function useCallStatus");
    expect(badge.split("canAnswerCalls(").length - 1).toBe(1);
  });

  it("⚠️ the ring-mode controls are GONE and stay gone (Josh, 2026-09-25)", () => {
    // "Remove the ability to select which call rings them and the pinned
    // numbers — the ring tone in the browser stays." Everyone connected rings
    // for every call, and the "Take it" forward-number EDITOR went the same
    // night ("we dont do call forwarding anymore everyone answers in the
    // browser") — no per-person call setting is stored from here at all.
    expect(calls).not.toContain("Which calls ring me");
    expect(calls).not.toContain("Ring me for incoming patient calls");
    expect(calls).not.toContain("Only my patients");
    expect(calls).not.toContain("saveRingPrefs");
    expect(calls).not.toContain("The number Take it forwards to");
    expect(calls).toContain("Alert me when this tab is in the background");
    expect(calls).toContain("Play a ringtone in this browser");
  });
});

describe("the status sentence", () => {
  it("is his three, and the badge's own when ringing", () => {
    expect(callStatusLine(false, true, "x")).toBe("Calls don't ring you — you're not a call answerer");
    expect(callStatusLine(true, false, "x")).toBe("Ringing is paused for you");
    expect(callStatusLine(true, true, "Connected — calls ring in this tab")).toBe("Connected — calls ring in this tab");
  });
});

describe("the Calls section, rendered", () => {
  it("an answerer: the line's status, the ringtone on, and the alerts opt-in", async () => {
    render(<CallSettings />);
    expect(await screen.findByText("Connected — calls ring in this tab")).toBeTruthy();
    const rows = screen.getAllByRole("switch");
    expect(rows).toHaveLength(1); // the ringtone — the mode rows are gone
    expect(rows[0].getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Alert me when this tab is in the background…")).toBeTruthy();
    // No per-person call setting is stored from here any more.
    expect(fetchRingPrefs).not.toHaveBeenCalled();
  });

  it("the ringtone row is the per-browser mute, not a prefs write", async () => {
    render(<CallSettings />);
    await screen.findByText("Connected — calls ring in this tab");
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(phone.setRingMuted).toHaveBeenCalledWith(true);
    expect(saveRingPrefs).not.toHaveBeenCalled();
  });

  it("⚠️ a non-answerer sees the ringtone DISABLED with his sentence — and no dialog opener", () => {
    access.config.callAnswerers = [];
    render(<CallSettings />);
    expect(screen.getByText("Calls don't ring you — you're not a call answerer")).toBeTruthy();
    for (const row of screen.getAllByRole("switch")) {
      expect(row.getAttribute("aria-disabled")).toBe("true");
      expect(row.getAttribute("title")).toBe("Ask an admin to make you a call answerer");
    }
    expect(fetchRingPrefs).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(saveRingPrefs).not.toHaveBeenCalled();
  });
});