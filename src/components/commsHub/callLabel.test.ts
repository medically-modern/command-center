/**
 * What a call row says happened.
 *
 * ⚠️ "Outgoing" / "Incoming" name the call's DIRECTION, which is not the
 * question a rep is asking — beside a patient's name, outgoing to whom?
 * (Josh, 2026-09-02.) The sidebar contact marks already settled this
 * vocabulary; these cases pin the list to the same words.
 */
import { describe, it, expect } from "vitest";
import { callLabel } from "./PhonePanel";

const call = (over: Partial<{ voicemail: boolean; inbound: boolean; connected: boolean }> = {}) => ({
  voicemail: false,
  inbound: false,
  connected: true,
  ...over,
});

describe("callLabel", () => {
  it("says WHO called, not which direction the packets went", () => {
    expect(callLabel(call({ inbound: false }))).toBe("We called");
    expect(callLabel(call({ inbound: true, connected: true }))).toBe("They called");
  });

  it("distinguishes a missed call from an answered one", () => {
    expect(callLabel(call({ inbound: true, connected: false }))).toBe("Missed their call");
  });

  it("uses WE, not YOU — the line is shared by several reps", () => {
    // The person reading the row is usually not the person who dialled.
    expect(callLabel(call())).not.toMatch(/\byou\b/i);
  });

  it("voicemail outranks the missed label — it left something to listen to", () => {
    expect(callLabel(call({ voicemail: true, inbound: true, connected: false }))).toBe("Left voicemail");
  });

  it("never calls an unanswered OUTBOUND call missed — nobody was trying to reach us", () => {
    expect(callLabel(call({ inbound: false, connected: false }))).toBe("We called");
  });
});
