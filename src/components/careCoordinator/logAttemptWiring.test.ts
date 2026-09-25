/**
 * Log call attempt reaches every call the dashboard can place — during AND
 * after (Josh, 2026-09-25: *"make sure log call attempt here is wired up to
 * work post and during call"*).
 *
 * Scanned rather than driven because every failure here is silent in the
 * `listColumns.test.ts` way: a booking popup that loses its Log button still
 * dials happily, and the attempt — the counter, the follow-up date, the
 * "what happened" note — simply never gets written. That is exactly the
 * state this page shipped in: the day strip could place a scheduled call
 * (the coordinator's MAIN call) and then offered nowhere to say what came
 * of it, and a card call could only be logged while its dialog stayed open,
 * because the one road back to the form — Call — placed a whole new call.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { calendlyEntry, intakeEntry } from "@/lib/careCoordinator/scheduleEntries";
import type { ScheduledCall } from "@/lib/scheduledCalls/workflow";
import type { CalendlyBooking } from "@/lib/careCoordinator/calendlyDay";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
const DIALOG = read("./CallPatientDialog.tsx");
const BOOKING = read("./BookingDetailsDialog.tsx");
const GRID = read("./ScheduleGrid.tsx");
const CARDS = read("./cards.tsx");
const CARD = read("./PatientCard.tsx");
const PAGE = read("../../pages/CareCoordinatorPage.tsx");

describe("the one attempt form opens WITHOUT dialing", () => {
  it("a log-only target places no call", () => {
    // `dial: false` is the post-call opening; dialing there rings a patient
    // who was just spoken to.
    expect(DIALOG).toMatch(/if \(!target \|\| target\.dial === false\) return;/);
  });

  it("…and a call already live to this number is never dialed on top of", () => {
    // Closing the form mid-call and pressing Call to get it back used to
    // place a second call over the first.
    expect(DIALOG).toMatch(/phone\.call\.phone\.replace\(\/\\D\/g, ""\)\.endsWith\(digits\)\) return;/);
  });
});

describe("the day strip's booking popup — the scheduled call's own form", () => {
  it("offers Log call attempt after the call, for a booking that resolved to a patient", () => {
    expect(BOOKING).toMatch(/onLogAttempt && entry\.itemId && \(/);
    expect(BOOKING).toMatch(/Log call attempt/);
  });

  it("offers it DURING the call too, on the dial popup", () => {
    // DialPatientDialog renders its Log button only when given the handler.
    const dial = BOOKING.slice(BOOKING.indexOf("<DialPatientDialog"));
    expect(dial).toMatch(/onLogAttempt=\{entry\.itemId && onLogAttempt/);
  });

  it("the grid threads the page's handler through, closing the popup on the way", () => {
    expect(GRID).toMatch(/onLogAttempt=\{onLogAttempt \? \(e\) => \{ setOpenBooking\(null\); onLogAttempt\(e\); \} : undefined\}/);
  });

  it("the page wires it to the strip, and never writes against a guessed counter", () => {
    expect(PAGE).toMatch(/onLogAttempt=\{logFromBooking\}/);
    // The board row supplies the attempt number; a row still loading refuses
    // rather than writing attempt 1 over a real 3.
    const fn = PAGE.slice(PAGE.indexOf("const logFromBooking"));
    expect(fn.slice(0, 2200)).toContain("if (!row) {");
    expect(fn.slice(0, 2200)).toContain("dial: false");
  });
});

describe("the cards' post-call path", () => {
  it("every card variant passes a log-only handler beside its Call", () => {
    const wired = CARDS.match(/onLogAttempt=\{logAttemptHandler\(/g) ?? [];
    expect(wired).toHaveLength(5);
  });

  it("the handler is the SAME target as Call, log-only, and needs no phone", () => {
    const fn = CARDS.slice(CARDS.indexOf("function logAttemptHandler"));
    expect(fn.slice(0, 600)).toContain("dial: false");
    // Call refuses without a number (a dial needs one); logging must not —
    // an attempt against a patient with no number on file is still real.
    expect(fn.slice(0, 600)).not.toContain("item.phone.trim()");
  });

  it("the card renders the button when the handler is there", () => {
    expect(CARD).toMatch(/\{onLogAttempt && \(/);
    expect(CARD).toMatch(/Log attempt/);
  });
});

describe("a strip entry knows which patient it is", () => {
  const call: ScheduledCall = {
    id: "13100000001", name: "Jane Sample", callDate: "2026-09-25", callTime: "14:00:00",
    bookingStatus: "Scheduled", email: "jane@example.com", phone: "5165550100",
    requestType: "", reason: "", groupId: "group_a",
  } as ScheduledCall;

  it("a mirror entry carries its monday item id", () => {
    expect(intakeEntry(call).itemId).toBe("13100000001");
  });

  it("a Calendly entry carries the id its resolution found — or null, never a guess", () => {
    const b = {
      eventUri: "https://api.calendly.com/scheduled_events/x", eventName: "Intake call",
      kind: "intake", name: "Jane Sample", email: "jane@example.com",
      startTime: "2026-09-25T18:00:00Z", endTime: "2026-09-25T18:10:00Z",
    } as CalendlyBooking;
    expect(calendlyEntry(b, () => ({ id: "13100000001", phone: "5165550100" })).itemId).toBe("13100000001");
    expect(calendlyEntry(b, () => null).itemId).toBeNull();
    // The unmatched entry stays renderable — the call exists — it just has
    // nobody to log against, and the popup's button keys off exactly that.
    expect(calendlyEntry(b, () => null).href).toBeNull();
  });
});
