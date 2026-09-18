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

  it("draws NO LANE for an inbound call we answered", () => {
    // Not one of the four situations, and "we called them" would be a lie
    // about who dialled.
    //
    // ⚠️ This used to assert the number was ABSENT from the map, which was the
    // same statement while the lanes were all the map held. From 2026-09-17 it
    // also carries the high-water facts, and an answered inbound call is
    // exactly the case `reachedByCall` exists to report — so the entry is kept
    // and the LANES are what must stay empty. `ContactStateMarks` renders per
    // lane and returns null when neither produces a glyph, so the sidebars are
    // unchanged; the assertion just has to say what it always meant.
    const m = buildContactStates([], [call("Inbound", "2026-09-01T10:00:00Z", { result: "Accepted" })]);
    expect(m.get(K)?.call).toBeNull();
    expect(m.get(K)?.text).toBeNull();
    // ⚠️ And it does NOT count as reaching them: `reachedByCall` is
    // outbound-only (Josh, 2026-09-17: "they answered our call"). We spoke to
    // this patient, but ringing them is still untested.
    expect(m.get(K)?.reachedByCall).toBe(false);
  });

  it("reads the LEGS, so a CLAIMED inbound call is not reported as missed", () => {
    // Claiming forwards the call, which tears down the inbound leg and can
    // stamp the parent with a terminal-looking result (CLAUDE.md §5.13). A rep
    // who took the call must not leave a rose mark behind.
    const m = buildContactStates(
      [],
      [call("Inbound", "2026-09-01T10:00:00Z", { result: "Stopped", legs: [{ result: "Accepted", duration: 92 }] })],
    );
    expect(m.get(K)?.call).toBeNull();
    // ...and it is still not "they answered our call" — see above.
    expect(m.get(K)?.reachedByCall).toBe(false);
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

describe("reached — the high-water facts (Brandon, 2026-09-17)", () => {
  // ⚠️ These are deliberately NOT the lanes. The lanes answer "who owes whom
  // a reply right now", so the newest event wins; these answer "have we ever
  // got through to this person this week", which is what the Care
  // Coordinator's green icons say.
  it("counts a reply even when we answered it and had the last word", () => {
    const m = buildContactStates(
      [
        sms("Inbound", "2026-09-01T10:00:00Z"),
        sms("Outbound", "2026-09-02T10:00:00Z"),
      ],
      [],
    );
    // The LANE says we replied last...
    expect(m.get(K)?.text).toBe("weRepliedLast");
    // ...and the fact still says they have replied to us.
    expect(m.get(K)?.reachedByText).toBe(true);
  });

  it("does not claim a reply when every text was ours", () => {
    const m = buildContactStates([sms("Outbound", "2026-09-02T10:00:00Z")], []);
    expect(m.get(K)?.reachedByText).toBe(false);
  });

  it("counts a connected call even when a later one went unanswered", () => {
    const m = buildContactStates([], [
      call("Outbound", "2026-09-01T10:00:00Z", { result: "Call connected", duration: 120 }),
      call("Outbound", "2026-09-03T10:00:00Z", { result: "No Answer" }),
    ]);
    expect(m.get(K)?.reachedByCall).toBe(true);
    expect(m.get(K)?.calls).toBe(2);
  });

  it("does not claim we got through when nothing connected", () => {
    const m = buildContactStates([], [
      call("Inbound", "2026-09-01T10:00:00Z", { result: "Missed", duration: 18 }),
    ]);
    expect(m.get(K)?.reachedByCall).toBe(false);
    expect(m.get(K)?.calls).toBe(1);
  });
});
