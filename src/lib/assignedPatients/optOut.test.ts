import { describe, expect, it } from "vitest";
import { consentSignal, consentState, isOptedOut, type ConsentMessage } from "./optOut";

const inbound = (text: string, time = "2026-08-01T10:00:00Z"): ConsentMessage => ({
  direction: "Inbound",
  text,
  time,
});
const outbound = (text: string, time = "2026-08-01T10:00:00Z"): ConsentMessage => ({
  direction: "Outbound",
  text,
  time,
});

describe("consentSignal", () => {
  it("recognises the CTIA opt-out keywords regardless of case or punctuation", () => {
    for (const k of ["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "cancel", "QUIT", "end", "stopall"]) {
      expect(consentSignal(k), k).toBe("optOut");
    }
  });

  it("recognises opt-in keywords", () => {
    for (const k of ["START", "start", "unstop", "YES"]) {
      expect(consentSignal(k), k).toBe("optIn");
    }
  });

  // The whole point of the whole-message rule: a false positive silently blocks
  // a rep from texting a patient who never asked to be left alone.
  it("does NOT fire on a keyword used inside a sentence", () => {
    for (const t of [
      "please stop by the office tomorrow",
      "can you cancel my order",
      "I want to start the new supplies",
      "yes please send it",
      "no end in sight",
    ]) {
      expect(consentSignal(t), t).toBeNull();
    }
  });

  it("ignores empty and whitespace-only messages", () => {
    expect(consentSignal("")).toBeNull();
    expect(consentSignal("   ")).toBeNull();
  });
});

describe("consentState", () => {
  it("is opted in by default", () => {
    expect(isOptedOut([inbound("hi there")])).toBe(false);
    expect(consentState([]).optedOut).toBe(false);
  });

  it("opts out on an inbound STOP", () => {
    const s = consentState([inbound("hi"), inbound("STOP", "2026-08-02T10:00:00Z")]);
    expect(s.optedOut).toBe(true);
    expect(s.keyword).toBe("stop");
    expect(s.since).toBe("2026-08-02T10:00:00Z");
  });

  // Consent is the patient's to give. A rep typing "stop" must never revoke it.
  it("ignores OUTBOUND keywords entirely", () => {
    expect(isOptedOut([outbound("STOP"), outbound("unsubscribe")])).toBe(false);
  });

  it("lets a later START re-opt the patient in", () => {
    expect(
      isOptedOut([
        inbound("STOP", "2026-08-01T10:00:00Z"),
        inbound("START", "2026-08-03T10:00:00Z"),
      ]),
    ).toBe(false);
  });

  it("re-opts OUT when STOP is the most recent signal", () => {
    expect(
      isOptedOut([
        inbound("STOP", "2026-08-01T10:00:00Z"),
        inbound("START", "2026-08-02T10:00:00Z"),
        inbound("stop", "2026-08-04T10:00:00Z"),
      ]),
    ).toBe(true);
  });

  // Order is resolved from timestamps, not array position — getting this
  // backwards would turn a STOP into an opt-in.
  it("sorts by time rather than trusting caller order", () => {
    expect(
      isOptedOut([
        inbound("START", "2026-08-02T10:00:00Z"),
        inbound("STOP", "2026-08-05T10:00:00Z"),
        inbound("hello", "2026-08-01T10:00:00Z"),
      ]),
    ).toBe(true);
  });
});

/**
 * A conversation long enough to be truncated used to read as "no STOP seen" and
 * silently re-enable the composer for someone who had opted out. Absence of
 * evidence is not consent.
 */
describe("consentState with an incomplete history", () => {
  it("blocks sending when the history is truncated and no signal was seen", () => {
    const s = consentState([inbound("hello")], false);
    expect(s.optedOut).toBe(true);
    expect(s.unknown).toBe(true);
  });

  it("marks it unknown rather than pretending to know why", () => {
    const s = consentState([], false);
    expect(s.unknown).toBe(true);
    expect(s.keyword).toBeNull();
    expect(s.since).toBeNull();
  });

  it("still reports a real opt-out as a real opt-out, not unknown", () => {
    const s = consentState([inbound("STOP", "2026-08-02T10:00:00Z")], false);
    expect(s.optedOut).toBe(true);
    expect(s.unknown).toBe(false);
    expect(s.keyword).toBe("stop");
  });

  // An opt-in postdates anything we couldn't see, so it stands on its own.
  it("trusts an explicit opt-in even on a truncated history", () => {
    const s = consentState(
      [inbound("STOP", "2026-08-01T10:00:00Z"), inbound("START", "2026-08-03T10:00:00Z")],
      false,
    );
    expect(s.optedOut).toBe(false);
    expect(s.unknown).toBe(false);
  });

  it("defaults to treating the history as complete", () => {
    expect(isOptedOut([inbound("hello")])).toBe(false);
  });
});
