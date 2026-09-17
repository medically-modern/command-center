import { describe, it, expect } from "vitest";
import {
  canTextEvidenceSql,
  canTextFromMessages,
  canTextVerdicts,
  needsCanTextBackfill,
  summarise,
  MAX_LOOKUP_NUMBERS,
} from "./canTextRules.mjs";

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

describe("the live lookup", () => {
  it("asks the DB for evidence, never for a verdict", () => {
    const sql = canTextEvidenceSql();
    // ⚠️ The rule must not be re-expressed in SQL — see canTextEvidenceSql's
    // note. A `bool_or(...)` here would be a second, untested copy of
    // canTextFromMessages, on a rule whose drift looks exactly like "we have
    // never texted this patient".
    expect(sql).not.toMatch(/bool_or|delivered|inbound/i);
    expect(sql).toMatch(/GROUP BY phone_hmac, direction, message_status/);
    expect(sql).toMatch(/phone_hmac = ANY\(\$1\)/);
  });

  it("returns yes for a number with an inbound text", () => {
    const v = canTextVerdicts([
      { phone_hmac: "aaa", direction: "Inbound", message_status: "Received" },
    ]);
    expect(v.get("aaa")).toBe("yes");
  });

  it("returns yes for a number with a DELIVERED outbound text", () => {
    expect(canTextVerdicts([{ phone_hmac: "bbb", direction: "Outbound", message_status: "Delivered" }]).get("bbb"))
      .toBe("yes");
  });

  it("OMITS a number whose only evidence is Sent or SendingFailed", () => {
    // §5.5: accepted is not delivered. Absent, never "" and never "no" — the
    // caller must not be able to read this as a negative answer.
    const v = canTextVerdicts([
      { phone_hmac: "ccc", direction: "Outbound", message_status: "Sent" },
      { phone_hmac: "ccc", direction: "Outbound", message_status: "SendingFailed" },
    ]);
    expect(v.has("ccc")).toBe(false);
    expect(v.size).toBe(0);
  });

  it("keeps numbers apart", () => {
    const v = canTextVerdicts([
      { phone_hmac: "aaa", direction: "Inbound", message_status: "Received" },
      { phone_hmac: "bbb", direction: "Outbound", message_status: "Queued" },
    ]);
    expect([...v.keys()]).toEqual(["aaa"]);
  });

  it("survives junk rows", () => {
    expect(canTextVerdicts(null).size).toBe(0);
    expect(canTextVerdicts([null, {}, { phone_hmac: "" }]).size).toBe(0);
  });

  it("caps how many numbers one request may carry", () => {
    expect(MAX_LOOKUP_NUMBERS).toBeGreaterThan(2);
    expect(MAX_LOOKUP_NUMBERS).toBeLessThanOrEqual(100);
  });
});
