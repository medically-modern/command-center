/**
 * V2-C (BUILD-SPEC §0.5): calls per day never shows a misleading number. Read-only fetches are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/shared/auth", () => ({ getIdToken: () => "t" }));
import { callsPerDay } from "@/components/onboardingOversight/v2/Overview";

const rec = (dir: string, name: string, ext: string, iso = "2026-09-30T15:00:00Z") => dir === "Outbound"
  ? { direction: "Outbound", startTime: iso, from: { name, extensionId: ext } }
  : { direction: "Inbound", startTime: iso, legs: [{ master: false, result: "Call connected", to: { name, extensionId: ext } }] };
const load = async (responses: unknown[]) => {
  vi.resetModules(); vi.stubEnv("VITE_MONDAY_GATEWAY_URL", "https://gw.example");
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => responses.shift() }));
  vi.stubGlobal("fetch", fetchMock);
  return (await import("./calls")).fetchStaffCalls(28);
};
const DAYS = ["2026-09-30", "2026-09-29", "2026-09-28", "2026-09-25", "2026-09-24"];

describe("calls per day (V2-C)", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  it("V2-C1 a person with no call-log entry shows '—', not 0; a person with calls shows a whole number", async () => {
    const c = await load([{ records: Array.from({ length: 10 }, () => rec("Outbound", "Masani Doe", "101")), navigation: {} }]);
    expect(c.status).toBe("ok");
    expect(callsPerDay(c, "Masani", DAYS, ["Masani", "Sam"])).toBe(2);
    expect(callsPerDay(c, "Sam", DAYS, ["Masani", "Sam"])).toBeNull();
  });
  it("V2-C2 a first name on two extensions shows '—' (would merge two people)", async () => {
    const c = await load([{ records: [rec("Outbound", "Sam A", "201"), rec("Inbound", "Sam B", "202")], navigation: {} }]);
    expect(c.ambiguous).toContain("sam"); expect(callsPerDay(c, "Sam", DAYS, ["Sam"])).toBeNull();
  });
  it("V2-C3 a log longer than the page cap is not shown (no silent truncation)", async () => {
    const page = { records: [rec("Outbound", "Masani Doe", "101")], navigation: { nextPage: { uri: "x" } } };
    const c = await load(Array.from({ length: 20 }, () => ({ ...page })));
    expect(c.status).toBe("unavailable"); expect(c.reason).toMatch(/truncated/);
  });
  it("V2-C4 archive fallback: processors show '—'; a full archive page is treated as truncated", async () => {
    vi.resetModules(); vi.stubEnv("VITE_MONDAY_GATEWAY_URL", "https://gw.example");
    let n = 0; vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? { ok: false, status: 403, json: async () => ({}) } : { ok: true, json: async () => ({ calls: [{ startedAt: "2026-09-30T15:00:00Z", answeredName: "Victor V" }] }) })));
    const c = await (await import("./calls")).fetchStaffCalls(28);
    expect(c.source).toBe("archive"); expect(callsPerDay(c, "Victor", DAYS, ["Victor"], false)).toBe(0); expect(callsPerDay(c, "Masani", DAYS, ["Masani"], true)).toBeNull();
    vi.resetModules(); n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? { ok: false, status: 403, json: async () => ({}) } : { ok: true, json: async () => ({ calls: Array.from({ length: 1000 }, () => ({ startedAt: "2026-09-30T15:00:00Z", answeredName: "Victor V" })) }) })));
    const t = await (await import("./calls")).fetchStaffCalls(28);
    expect(t.status).toBe("unavailable"); expect(t.reason).toMatch(/truncated/);
  });
});
