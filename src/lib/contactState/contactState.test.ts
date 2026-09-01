import { describe, it, expect } from "vitest";
import { buildContactStates, contactKey, type RcMessageRecord } from "./contactState";
import type { RcCallLogRecord } from "../callHistory/callHistory";

const PATIENT = "+13475550101";
const OTHER = "+16095550199";
const MM = "+13475037148";

function sms(dir: "Inbound" | "Outbound", at: string, patient = PATIENT, type = "SMS"): RcMessageRecord {
  return dir === "Inbound"
    ? { type, direction: dir, creationTime: at, from: { phoneNumber: patient }, to: [{ phoneNumber: MM }] }
    : { type, direction: dir, creationTime: at, from: { phoneNumber: MM }, to: [{ phoneNumber: patient }] };
}

function call(
  dir: "Inbound" | "Outbound",
  at: string,
  extra: Partial<RcCallLogRecord> = {},
  patient = PATIENT,
): RcCallLogRecord {
  return dir === "Inbound"
    ? { direction: dir, startTime: at, from: { phoneNumber: patient }, to: { phoneNumber: MM }, ...extra }
    : { direction: dir, startTime: at, from: { phoneNumber: MM }, to: { phoneNumber: patient }, ...extra };
}

const K = contactKey(PATIENT);

describe("contactKey", () => {
  it("reduces every rendering of a number to the same 10 digits", () => {
    expect(contactKey("+1 (347) 555-0101")).toBe("3475550101");
    expect(contactKey("3475550101")).toBe("3475550101");
    expect(contactKey("13475550101")).toBe("3475550101");
  });
});

describe("text lane", () => {
  it("is awaitingOurReply when the patient sent the last message", () => {
    const m = buildContactStates([sms("Outbound", "2026-09-01T10:00:00Z"), sms("Inbound", "2026-09-01T11:00:00Z")], []);
    expect(m.get(K)?.text).toBe("awaitingOurReply");
  });

  it("is weRepliedLast when we sent the last message", () => {
    const m = buildContactStates([sms("Inbound", "2026-09-01T10:00:00Z"), sms("Outbound", "2026-09-01T11:00:00Z")], []);
    expect(m.get(K)?.text).toBe("weRepliedLast");
  });

  it("counts an MMS — a photo reply is still a reply", () => {
    const m = buildContactStates(
      [sms("Outbound", "2026-09-01T10:00:00Z"), sms("Inbound", "2026-09-01T11:00:00Z", PATIENT, "MMS")],
      [],
    );
    expect(m.get(K)?.text).toBe("awaitingOurReply");
  });

  it("ignores Fax and VoiceMail rows sharing the message store", () => {
    // The account-wide read cannot filter these out at the API, so a fax from
    // the same number must not read as an unanswered text.
    const m = buildContactStates(
      [sms("Outbound", "2026-09-01T10:00:00Z"), sms("Inbound", "2026-09-01T11:00:00Z", PATIENT, "Fax")],
      [],
    );
    expect(m.get(K)?.text).toBe("weRepliedLast");
  });

  it("keys off the patient, never the MM line", () => {
    const m = buildContactStates([sms("Inbound", "2026-09-01T11:00:00Z")], [], { ownNumbers: [MM] });
    expect([...m.keys()]).toEqual([K]);
  });

  it("keeps two patients apart", () => {
    const m = buildContactStates(
      [sms("Inbound", "2026-09-01T11:00:00Z"), sms("Outbound", "2026-09-01T12:00:00Z", OTHER)],
      [],
    );
    expect(m.get(K)?.text).toBe("awaitingOurReply");
    expect(m.get(contactKey(OTHER))?.text).toBe("weRepliedLast");
  });
});

describe("call lane", () => {
  it("is missedTheirCall for an inbound call nobody answered", () => {
    const m = buildContactStates([], [call("Inbound", "2026-09-01T10:00:00Z", { result: "Missed" })]);
    expect(m.get(K)?.call).toBe("missedTheirCall");
  });

  it("is weCalledThem for an outbound call, answered or not", () => {
    expect(
      buildContactStates([], [call("Outbound", "2026-09-01T10:00:00Z", { result: "No Answer" })]).get(K)?.call,
    ).toBe("weCalledThem");
    expect(
      buildContactStates([], [call("Outbound", "2026-09-01T10:00:00Z", { result: "Accepted" })]).get(K)?.call,
    ).toBe("weCalledThem");
  });

  it("reports NOTHING for an inbound call we answered", () => {
    // Not one of the four situations, and "we called them" would be a lie
    // about who dialled.
    const m = buildContactStates([], [call("Inbound", "2026-09-01T10:00:00Z", { result: "Accepted" })]);
    expect(m.has(K)).toBe(false);
  });

  it("reads the LEGS, so a CLAIMED inbound call is not reported as missed", () => {
    // Claiming forwards the call, which tears down the inbound leg and can
    // stamp the parent with a terminal-looking result (CLAUDE.md §5.13). A rep
    // who took the call must not leave a rose mark behind.
    const m = buildContactStates(
      [],
      [call("Inbound", "2026-09-01T10:00:00Z", { result: "Stopped", legs: [{ result: "Accepted", duration: 92 }] })],
    );
    expect(m.has(K)).toBe(false);
  });

  it("does not turn ring time on a missed call into a conversation", () => {
    // RingCentral reports ring seconds in `duration` on some missed calls.
    const m = buildContactStates([], [call("Inbound", "2026-09-01T10:00:00Z", { result: "Missed", duration: 18 })]);
    expect(m.get(K)?.call).toBe("missedTheirCall");
  });

  it("flags a voicemail without changing the lane", () => {
    const m = buildContactStates([], [call("Inbound", "2026-09-01T10:00:00Z", { result: "Voicemail" })]);
    expect(m.get(K)?.call).toBe("missedTheirCall");
    expect(m.get(K)?.voicemail).toBe(true);
  });

  it("takes the MOST RECENT call, not the worst one", () => {
    // They rang and we missed it; we rang back an hour later. We responded —
    // a mark that latched onto the missed call would never clear.
    const m = buildContactStates(
      [],
      [
        call("Inbound", "2026-09-01T09:00:00Z", { result: "Missed" }),
        call("Outbound", "2026-09-01T10:00:00Z", { result: "No Answer" }),
      ],
    );
    expect(m.get(K)?.call).toBe("weCalledThem");
    expect(m.get(K)?.voicemail).toBe(false);
  });
});

describe("both lanes together", () => {
  it("yields at most two marks, one per lane", () => {
    const s = buildContactStates(
      [sms("Inbound", "2026-09-01T11:00:00Z")],
      [call("Outbound", "2026-09-01T10:00:00Z", { result: "No Answer" })],
    ).get(K);
    expect(s?.text).toBe("awaitingOurReply");
    expect(s?.call).toBe("weCalledThem");
  });

  it("omits a patient with no contact at all", () => {
    expect(buildContactStates([], []).size).toBe(0);
  });

  it("drops records with an unreadable time rather than dating them to 1970", () => {
    const m = buildContactStates(
      [sms("Outbound", "2026-09-01T10:00:00Z"), { type: "SMS", direction: "Inbound", from: { phoneNumber: PATIENT } }],
      [],
    );
    expect(m.get(K)?.text).toBe("weRepliedLast");
  });

  it("ignores a number too short to be a US line", () => {
    const m = buildContactStates([sms("Inbound", "2026-09-01T10:00:00Z", "5551234")], []);
    expect(m.size).toBe(0);
  });
});
