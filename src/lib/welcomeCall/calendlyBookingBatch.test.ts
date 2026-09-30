/**
 * `fetchPatientBookings` chunks under the gateway's 500-address cap.
 *
 * ⚠️ Not a nicety. The Care Coordinator's Patient Intake column reads ~1,750
 * rows (Partial Leads alone was 1,718 on 2026-09-10), most carrying a DTC form
 * address, so an unchunked request comes back **400 "at most 500 emails per
 * request"** and the whole column falls back to the monday mirror — exactly
 * what reading Calendly first was meant to stop. The Welcome Call column is
 * forty rows and would never have shown it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/shared/mondayEndpoint", () => ({
  MONDAY_GATEWAY_BASE: "https://gw.test",
  mondayIdentityHeaders: () => ({}),
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchPatientBookings, fetchWelcomeCallBooking } from "./calendlyBooking";

const addresses = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@example.com`);

const booking = (email: string) => ({
  eventUri: "u", eventName: "Medically Modern Intake Call",
  startTime: "2026-09-16T18:00:00Z", endTime: "2026-09-16T18:10:00Z",
  name: "A Patient", email, timezone: "America/New_York", rescheduleUrl: "",
});

let calls: { emails: string[]; kind: string }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { emails: string[]; kind: string };
    calls.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        kind: body.kind,
        // The real `lookupMany` answers EVERY address it was given.
        bookings: Object.fromEntries(body.emails.map((e) => [e, e === "p7@example.com" ? booking(e) : null])),
        through: "2026-10-06",
      }),
    };
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("fetchPatientBookings", () => {
  it("sends one request for a small column", async () => {
    const res = await fetchPatientBookings(addresses(40), "welcome");
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("welcome");
    expect(res.ok).toBe(true);
    expect(res.bookings.size).toBe(40);
  });

  it("chunks a big column at 500 and merges every answer", async () => {
    const res = await fetchPatientBookings(addresses(1754), "intake");
    expect(calls.map((c) => c.emails.length)).toEqual([500, 500, 500, 254]);
    expect(calls.every((c) => c.kind === "intake")).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.bookings.size).toBe(1754);
    expect(res.through).toBe("2026-10-06");
    expect(res.bookings.get("p7@example.com")?.email).toBe("p7@example.com");
    expect(res.bookings.get("p1200@example.com")).toBeNull();
  });

  it("dedupes and normalises before chunking, so the cap counts real addresses", async () => {
    await fetchPatientBookings([" A@X.com ", "a@x.com", "A@X.COM", "", "not an email"], "intake");
    expect(calls[0].emails).toEqual(["a@x.com"]);
  });

  it("fails the WHOLE lookup when one chunk fails — a partial map reads as 'not booked'", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { emails: string[] };
      n += 1;
      if (n === 2) return { ok: false, status: 502, json: async () => ({ ok: false, error: "gateway could not reach Calendly" }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, bookings: Object.fromEntries(body.emails.map((e) => [e, null])), through: "2026-10-06" }) };
    }));
    const res = await fetchPatientBookings(addresses(1200), "intake");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("gateway could not reach Calendly");
    expect(res.bookings.size).toBe(0);
  });

  it("asks nothing at all for a column with no addresses on file", async () => {
    const res = await fetchPatientBookings(["", "  ", "nope"], "intake");
    expect(calls).toHaveLength(0);
    expect(res.ok).toBe(true);
    expect(res.bookings.size).toBe(0);
  });
});

/**
 * PHONES ride in the same requests (CLAUDE.md §5.30l) — only 10 of 32 Welcome
 * Call patients had an email on 2026-09-30, all 32 a phone.
 */
describe("fetchPatientBookings — phones", () => {
  const numbers = (n: number) => Array.from({ length: n }, (_, i) => `917${String(1000000 + i)}`);

  it("sends ten-digit keys, deduped, beside the emails — and a phone-only column still asks", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { emails: string[]; phones: string[]; kind: string };
      calls.push(body);
      return { ok: true, status: 200, json: async () => ({
        ok: true, bookings: {}, through: "2026-10-20",
        byPhone: Object.fromEntries(body.phones.map((p) => [p, p === "9175550142" ? booking("") : null])),
      }) };
    }));
    const res = await fetchPatientBookings([], "welcome", ["(917) 555-0142", "+1 917 555 0142", "123", ""]);
    expect(calls).toHaveLength(1);
    expect((calls[0] as unknown as { phones: string[] }).phones).toEqual(["9175550142"]);
    expect(res.ok).toBe(true);
    expect(res.byPhone.get("9175550142")).not.toBeNull();
  });

  it("chunks the phones with the emails — request N carries the Nth slice of each", async () => {
    await fetchPatientBookings(addresses(600), "intake", numbers(1200));
    const sent = calls as unknown as { emails: string[]; phones: string[] }[];
    expect(sent.map((c) => c.emails.length)).toEqual([500, 100, 0]);
    expect(sent.map((c) => c.phones.length)).toEqual([500, 500, 200]);
  });

  it("an older gateway that ignores phones leaves byPhone EMPTY — not asked, never 'not booked'", async () => {
    const res = await fetchPatientBookings(addresses(3), "welcome", ["9175550142"]);
    expect(res.ok).toBe(true);
    expect(res.byPhone.size).toBe(0);
    expect(res.bookings.size).toBe(3);
  });
});

/** The Welcome Call chip asks by phone too (§5.30l). */
describe("fetchWelcomeCallBooking — email and phone", () => {
  let urls: string[] = [];
  beforeEach(() => {
    urls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ ok: true, booking: null, through: "2026-10-20", matchedBy: null }) };
    }));
  });

  it("sends both keys, the phone as ten digits, and always names the kind", async () => {
    await fetchWelcomeCallBooking("Pat@Example.com", "+1 (917) 555-0142");
    expect(urls[0]).toBe("https://gw.test/calendly/patient?email=Pat%40Example.com&phone=9175550142&kind=welcome");
  });

  it("asks by phone alone for a patient with no email — most Welcome Call patients", async () => {
    const res = await fetchWelcomeCallBooking("", "917-555-0142");
    expect(urls[0]).toBe("https://gw.test/calendly/patient?phone=9175550142&kind=welcome");
    expect(res.ok).toBe(true);
  });

  it("asks nothing, and says why, when there is neither", async () => {
    const res = await fetchWelcomeCallBooking("", "123");
    expect(urls).toHaveLength(0);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No email or phone/);
  });

  it("the patient header hands the chip the phone, not just the email", () => {
    const card = readFileSync(resolve(__dirname, "../../components/welcomeCall/PatientInfoCard.tsx"), "utf8");
    expect(card).toMatch(/<CallScheduledChip email=\{patient\.email\} phone=\{patient\.phone\} \/>/);
  });
});
