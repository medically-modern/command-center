import { describe, it, expect } from "vitest";
import {
  VOICEMAIL_AFTER_CALL_MS,
  VOICEMAIL_BEFORE_CALL_MS,
  pickedCall,
  voicemailForCall,
  type PickedCall,
} from "./callVoicemail";

const CALL_AT = "2026-09-15T14:30:00.000Z";
const at = (offsetMs: number) => new Date(new Date(CALL_AT).getTime() + offsetMs).toISOString();

const vm = (id: number, fromNumber: string, creationTime: string) => ({ id, fromNumber, creationTime });

const call = (over: Partial<PickedCall> = {}): PickedCall => ({
  phone: "+15555550101",
  at: CALL_AT,
  voicemail: true,
  ...over,
});

describe("voicemailForCall", () => {
  it("matches the message that number left just after the call", () => {
    const list = [vm(1, "+15555550101", at(95_000))];
    expect(voicemailForCall(call(), list)?.id).toBe(1);
  });

  it("matches whatever digit shape either side stores", () => {
    // RingCentral and our boards both render numbers inconsistently; the last
    // ten digits are the only substring present in every rendering.
    const list = [vm(1, "(555) 555-0101", at(60_000))];
    expect(voicemailForCall(call({ phone: "15555550101" }), list)?.id).toBe(1);
  });

  it("⚠️ takes the NEAREST message, not the first — the list is newest-first", () => {
    const list = [
      vm(2, "+15555550101", at(12 * 60_000)), // a later call's message, listed first
      vm(1, "+15555550101", at(90_000)),
    ];
    expect(voicemailForCall(call(), list)?.id).toBe(1);
  });

  it("⚠️ is null for a call the log does NOT say reached voicemail", () => {
    // Otherwise an ordinary answered call would show that caller's last
    // message, and a rep would listen to it believing it was just left.
    const list = [vm(1, "+15555550101", at(90_000))];
    expect(voicemailForCall(call({ voicemail: false }), list)).toBeNull();
  });

  it("is null for another number's message", () => {
    expect(voicemailForCall(call(), [vm(1, "+15555550102", at(90_000))])).toBeNull();
  });

  it("ignores a message outside the window on either side", () => {
    expect(voicemailForCall(call(), [vm(1, "+15555550101", at(VOICEMAIL_AFTER_CALL_MS + 1000))])).toBeNull();
    expect(voicemailForCall(call(), [vm(1, "+15555550101", at(-VOICEMAIL_BEFORE_CALL_MS - 1000))])).toBeNull();
  });

  it("accepts a small clock skew, since two subsystems stamp the two records", () => {
    expect(voicemailForCall(call(), [vm(1, "+15555550101", at(-30_000))])?.id).toBe(1);
  });

  it("⚠️ the window runs FORWARD — a message is created during or after the call", () => {
    // Asymmetric on purpose: widening the backward side is what would attach
    // the PREVIOUS call's voicemail to this one.
    expect(VOICEMAIL_AFTER_CALL_MS).toBeGreaterThan(VOICEMAIL_BEFORE_CALL_MS);
  });

  it("fails closed on everything unreadable", () => {
    expect(voicemailForCall(null, [vm(1, "+15555550101", at(0))])).toBeNull();
    expect(voicemailForCall(call(), null)).toBeNull();
    expect(voicemailForCall(call(), [])).toBeNull();
    expect(voicemailForCall(call({ at: "" }), [vm(1, "+15555550101", at(0))])).toBeNull();
    expect(voicemailForCall(call({ at: "not a date" }), [vm(1, "+15555550101", at(0))])).toBeNull();
    expect(voicemailForCall(call({ phone: "" }), [vm(1, "+15555550101", at(0))])).toBeNull();
    expect(voicemailForCall(call({ phone: "123" }), [vm(1, "123", at(0))])).toBeNull();
    expect(voicemailForCall(call(), [vm(1, "+15555550101", "")])).toBeNull();
  });
});

describe("pickedCall", () => {
  it("reads the OTHER party, per direction", () => {
    const inbound = pickedCall({
      direction: "Inbound",
      startTime: CALL_AT,
      from: { phoneNumber: "+15555550101" },
      to: { phoneNumber: "+13475037148" },
      result: "Voicemail",
    });
    expect(inbound).toEqual({ phone: "+15555550101", at: CALL_AT, voicemail: true });

    const outbound = pickedCall({
      direction: "Outbound",
      startTime: CALL_AT,
      from: { phoneNumber: "+13475037148" },
      to: { phoneNumber: "+15555550101" },
      result: "Call connected",
    });
    expect(outbound).toEqual({ phone: "+15555550101", at: CALL_AT, voicemail: false });
  });

  it("⚠️ reads the LEGS for the voicemail verdict (§5.16)", () => {
    // A claimed call's outcome lands on a leg, not the parent.
    const r = pickedCall({
      direction: "Inbound",
      startTime: CALL_AT,
      from: { phoneNumber: "+15555550101" },
      result: "Accepted",
      legs: [{ result: "Voicemail" }],
    });
    expect(r.voicemail).toBe(true);
  });
});
