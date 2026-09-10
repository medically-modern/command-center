import { describe, it, expect } from "vitest";
import { canTextFromMessages, needsCanTextBackfill, summarise } from "./canTextRules.mjs";

const inbound = (over = {}) => ({ direction: "Inbound", message_status: "Received", ...over });
const outbound = (status) => ({ direction: "Outbound", message_status: status });

describe("canTextFromMessages", () => {
  it("says yes on any INBOUND text — the handoff's own rule", () => {
    expect(canTextFromMessages([inbound()])).toBe("yes");
  });

  it("says yes on a DELIVERED outbound text", () => {
    expect(canTextFromMessages([outbound("Delivered")])).toBe("yes");
  });

  it("does NOT count a merely SENT outbound text", () => {
    // §5.5: an accepted text is not a delivered text. RingCentral flips a text
    // to a landline to SendingFailed seconds AFTER accepting it, so counting
    // "Sent" would mark exactly the landlines Yes.
    expect(canTextFromMessages([outbound("Sent")])).toBe("");
    expect(canTextFromMessages([outbound("Queued")])).toBe("");
  });

  it("NEVER says no — a failed text is not proof the number can't receive", () => {
    // A landline, a disconnected mobile, a typo and a carrier having a bad
    // afternoon all look identical here, and a wrong No routes this patient's
    // reorders to a call queue silently.
    expect(canTextFromMessages([outbound("SendingFailed")])).toBe("");
    expect(canTextFromMessages([outbound("SendingFailed"), outbound("SendingFailed")])).toBe("");
  });

  it("says yes when a delivery follows a failure", () => {
    expect(canTextFromMessages([outbound("SendingFailed"), outbound("Delivered")])).toBe("yes");
  });

  it("is unknown for a number with no messages at all", () => {
    expect(canTextFromMessages([])).toBe("");
    expect(canTextFromMessages(undefined)).toBe("");
  });

  it("ignores malformed rows rather than throwing", () => {
    expect(canTextFromMessages([null, {}, inbound()])).toBe("yes");
  });

  it("matches the status case-insensitively", () => {
    expect(canTextFromMessages([outbound("delivered")])).toBe("yes");
  });
});

describe("needsCanTextBackfill", () => {
  it("takes a row with a number and a blank Can Text", () => {
    expect(needsCanTextBackfill({ phone: "5555550100", canText: "" })).toBe(true);
  });

  it("SKIPS a row a rep has already answered", () => {
    // A rep answered it on the phone with the patient. That beats anything a
    // message log can infer, in both directions.
    expect(needsCanTextBackfill({ phone: "5555550100", canText: "Yes" })).toBe(false);
    expect(needsCanTextBackfill({ phone: "5555550100", canText: "No" })).toBe(false);
  });

  it("skips a row with no number", () => {
    expect(needsCanTextBackfill({ phone: "", canText: "" })).toBe(false);
    expect(needsCanTextBackfill({ phone: "   ", canText: "" })).toBe(false);
  });
});

describe("summarise", () => {
  it("counts what a run would do", () => {
    const s = summarise([
      { eligible: true, verdict: "yes" },
      { eligible: true, verdict: "" },
      { eligible: false, verdict: "" },
    ]);
    expect(s).toEqual({ scanned: 3, eligible: 2, yes: 1, unknown: 1 });
  });
});
