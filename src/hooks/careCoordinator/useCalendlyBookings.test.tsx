/**
 * `ready` answers "has THIS set of addresses been answered for" — not "has a
 * read ever succeeded".
 *
 * The distinction is the whole bug (found in a browser, 2026-09-16): the board
 * read lands first and the address list comes out of it, so the hook is mounted
 * with an EMPTY list, takes its no-addresses branch, and a plain boolean latches
 * true before a single address has been asked about. The page's "checking
 * Calendly" state then never rendered, and every patient with a welcome call
 * booked sat under Unscheduled — "ring this person, they haven't booked" — for
 * the whole real read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const fetchPatientBookings = vi.fn();

vi.mock("@/lib/welcomeCall/calendlyBooking", () => ({
  welcomeCallBookingAvailable: () => true,
  fetchPatientBookings: (...a: unknown[]) => fetchPatientBookings(...(a as [])),
}));

import { useCalendlyBookings } from "./useCalendlyBookings";

const booking = (email: string) => ({
  eventUri: "u", eventName: "Medically Modern Welcome Call",
  startTime: "2026-09-16T18:00:00Z", endTime: "2026-09-16T18:10:00Z",
  name: "A Patient", email, timezone: "America/New_York", rescheduleUrl: "",
});

describe("useCalendlyBookings", () => {
  beforeEach(() => { fetchPatientBookings.mockReset(); });

  it("is NOT ready for a real address list just because the empty one resolved", async () => {
    let resolve!: (v: unknown) => void;
    fetchPatientBookings.mockReturnValue(new Promise((r) => { resolve = r; }));

    // Mounted before the board read lands: no addresses yet.
    const { result, rerender } = renderHook(({ emails }) => useCalendlyBookings(emails, "welcome"), {
      initialProps: { emails: [] as string[] },
    });
    await waitFor(() => expect(result.current.ready).toBe(true)); // nothing to ask, nothing pending

    // The board lands. Now there ARE addresses, and nobody has answered yet.
    rerender({ emails: ["w0@example.com", "w1@example.com"] });
    await waitFor(() => expect(result.current.ready).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.byEmail.size).toBe(0);

    resolve({ ok: true, bookings: new Map([["w0@example.com", booking("w0@example.com")]]), error: null, through: "2026-10-06" });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.byEmail.get("w0@example.com")?.email).toBe("w0@example.com");
  });

  it("stays ready across a poll that returns the same addresses in another order", async () => {
    fetchPatientBookings.mockResolvedValue({ ok: true, bookings: new Map(), error: null, through: null });
    const { result, rerender } = renderHook(({ emails }) => useCalendlyBookings(emails, "welcome"), {
      initialProps: { emails: ["b@example.com", "a@example.com"] },
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const calls = fetchPatientBookings.mock.calls.length;

    rerender({ emails: ["a@example.com", "b@example.com"] });
    expect(result.current.ready).toBe(true);
    expect(fetchPatientBookings.mock.calls.length).toBe(calls);
  });

  it("a FAILED read is not ready either — the map is empty and must not read as 'nobody is booked'", async () => {
    fetchPatientBookings.mockResolvedValue({ ok: false, bookings: new Map(), error: "gateway could not reach Calendly", through: null });
    const { result } = renderHook(() => useCalendlyBookings(["w@example.com"], "welcome"));
    await waitFor(() => expect(result.current.error).toBe("gateway could not reach Calendly"));
    expect(result.current.ready).toBe(false);
  });
});

describe("useCalendlyBookings — the kind is part of the read", () => {
  it("asks for the kind it was given, and never shares an answer across kinds", async () => {
    fetchPatientBookings.mockReset();
    fetchPatientBookings.mockResolvedValue({ ok: true, bookings: new Map(), error: null, through: "2026-10-06" });

    const emails = ["p@example.com"];
    const a = renderHook(() => useCalendlyBookings(emails, "intake"));
    await waitFor(() => expect(a.result.current.ready).toBe(true));
    const b = renderHook(() => useCalendlyBookings(emails, "welcome"));
    await waitFor(() => expect(b.result.current.ready).toBe(true));

    // ⚠️ Two reads, not one coalesced into the other. The module-scope
    // in-flight key carries the kind; without it the intake column's request
    // would satisfy the welcome column's and each would render the other's
    // appointments.
    expect(fetchPatientBookings.mock.calls.map((c) => c[1])).toEqual(["intake", "welcome"]);
  });

  it("carries `through`, so the caller can tell 'outside the window' from 'not booked'", async () => {
    fetchPatientBookings.mockReset();
    fetchPatientBookings.mockResolvedValue({ ok: true, bookings: new Map(), error: null, through: "2026-10-06" });
    const { result } = renderHook(() => useCalendlyBookings(["q@example.com"], "intake"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.through).toBe("2026-10-06");
  });
});
