/**
 * "How many times have we called them, and they us" — from OUR call archive
 * (Josh, 2026-09-24). The verdict is the SPA's own `callConnected`, fed the
 * archive's raw leg results, so these fixtures are the shapes the gateway's
 * `toCallRow` stores.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callNumberKey,
  countArchivedCalls,
  countLabel,
  formatSinceDate,
  type ArchivedCallRow,
} from "./callCounts";

let n = 0;
const row = (over: Partial<ArchivedCallRow> = {}): ArchivedCallRow => ({
  callId: `c${++n}`,
  direction: "Outbound",
  result: "Call connected",
  legResults: [],
  durationSec: 60,
  startedAt: "2026-09-20T15:00:00.000Z",
  ...over,
});

describe("countArchivedCalls", () => {
  it("splits by direction: Outbound is we-called, Inbound is they-called", () => {
    const c = countArchivedCalls([
      row({ direction: "Outbound" }),
      row({ direction: "Outbound", result: "No Answer", durationSec: 0 }),
      row({ direction: "Inbound", result: "Accepted" }),
    ]);
    expect(c).toMatchObject({ weCalled: 2, weReached: 1, theyCalled: 1, theyMissed: 0, total: 3 });
  });

  it("⚠️ reads the LEGS — a claimed inbound call is answered even when the parent says Missed (§5.16)", () => {
    const c = countArchivedCalls([
      row({ direction: "Inbound", result: "Missed", legResults: ["Missed", "Accepted"], durationSec: 0 }),
    ]);
    expect(c.theyMissed).toBe(0);
  });

  it("a voicemail left is missed AND counted as a voicemail", () => {
    const c = countArchivedCalls([
      row({ direction: "Inbound", result: "Voicemail", durationSec: 35 }),
      row({ direction: "Inbound", result: "Missed", durationSec: 0 }),
    ]);
    expect(c).toMatchObject({ theyCalled: 2, theyMissed: 2, theyVoicemail: 1 });
  });

  it("⚠️ a named missed result outranks ring time in the duration (§5.16)", () => {
    const c = countArchivedCalls([row({ direction: "Inbound", result: "Missed", durationSec: 18 })]);
    expect(c.theyMissed).toBe(1);
  });

  it("an outbound call that reached their voicemail was not answered", () => {
    const c = countArchivedCalls([row({ direction: "Outbound", result: "Voicemail", durationSec: 40 })]);
    expect(c).toMatchObject({ weCalled: 1, weReached: 0 });
  });

  it("a call is counted once, however many lists it arrives in", () => {
    const one = row({ callId: "dup" });
    expect(countArchivedCalls([one, { ...one }]).total).toBe(1);
  });

  it("no rows is zero calls — a real answer, only ever from a SUCCESSFUL read", () => {
    expect(countArchivedCalls([])).toMatchObject({ total: 0, weCalled: 0, theyCalled: 0, capped: false });
  });

  it("carries the capped flag through", () => {
    expect(countArchivedCalls([row()], { capped: true }).capped).toBe(true);
  });
});

describe("labels and keys", () => {
  it("a capped count reads as a floor", () => {
    expect(countLabel(12, false)).toBe("12");
    expect(countLabel(1000, true)).toBe("1000+");
  });

  it("keys a number on its last ten digits and refuses a short one", () => {
    expect(callNumberKey("+1 (555) 555-0100")).toBe("5555550100");
    expect(callNumberKey("15555550100")).toBe("5555550100");
    expect(callNumberKey("555-0100")).toBe("");
    expect(callNumberKey("")).toBe("");
  });

  it("⚠️ the since-date is EASTERN — an evening call is not moved a day (§5.15)", () => {
    // 2026-06-19 01:30 UTC is still June 18 in New York.
    expect(formatSinceDate("2026-06-19T01:30:00.000Z")).toBe("Jun 18, 2026");
    expect(formatSinceDate(null)).toBe("");
    expect(formatSinceDate("not a date")).toBe("");
  });
});

describe("the fetch — POST /calls/archive/query, the route that already exists", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
    vi.stubEnv("VITE_MONDAY_GATEWAY_URL", "https://gw.test");
    vi.stubGlobal("fetch", vi.fn(fetchImpl));
    vi.resetModules();
    return import("./callCounts");
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("asks for everything we hold on the number, and nothing about any other", async () => {
    const m = await load(async () => json({ ok: true, sinceDays: 3650, limit: 1000, calls: [] }));
    await m.fetchArchivedCalls("(555) 555-0100");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://gw.test/calls/archive/query");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ phones: ["(555) 555-0100"], sinceDays: 3650, limit: 1000 });
  });

  it("⚠️ a failure THROWS — never an empty list, which would read as 'never called'", async () => {
    const m = await load(async () => json({ ok: false, error: "db down" }, 502));
    await expect(m.fetchArchivedCalls("5555550100")).rejects.toThrow(/502/);
    const m2 = await load(async () => json({ ok: false }));
    await expect(m2.fetchArchivedCalls("5555550100")).rejects.toThrow();
  });

  it("a full page is capped — the numbers are a floor, and the screen says so", async () => {
    const calls = Array.from({ length: 3 }, (_, i) => ({ callId: `x${i}`, direction: "Inbound" }));
    const m = await load(async () => json({ ok: true, limit: 3, calls }));
    expect((await m.fetchArchivedCalls("5555550100")).capped).toBe(true);
  });

  it("the since-date comes from the health route, and is null when the archive is off", async () => {
    const m = await load(async () => json({ enabled: true, oldest: "2026-06-18T14:00:00.000Z" }));
    expect(await m.fetchArchiveOldest()).toBe("2026-06-18T14:00:00.000Z");
    const m2 = await load(async () => json({ ok: true, enabled: false }));
    expect(await m2.fetchArchiveOldest()).toBeNull();
    const m3 = await load(async () => {
      throw new Error("offline");
    });
    expect(await m3.fetchArchiveOldest()).toBeNull();
  });

  it("no gateway, no archive: it refuses rather than pretending", async () => {
    vi.stubEnv("VITE_MONDAY_GATEWAY_URL", "");
    vi.resetModules();
    const m = await import("./callCounts");
    await expect(m.fetchArchivedCalls("5555550100")).rejects.toThrow(/No call archive/);
    expect(await m.fetchArchiveOldest()).toBeNull();
  });
});
