/**
 * What a call row says happened.
 *
 * ⚠️ "Outgoing" / "Incoming" name the call's DIRECTION, which is not the
 * question a rep is asking — beside a patient's name, outgoing to whom?
 * (Josh, 2026-09-02.) The sidebar contact marks already settled this
 * vocabulary; these cases pin the list to the same words.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe("callLabel's second argument — 'Left voicemail' claims a MESSAGE (Brandon, 2026-09-25)", () => {
  // RingCentral's result "Voicemail" only means the voicemail SYSTEM answered;
  // whether a message exists is `voicemailForCall`'s join against the message
  // store — the same join the row's own click uses. Brandon hung up in the
  // greeting on purpose ("didn't leave a voicemail"), and the rail said
  // "Left voicemail" while the timeline said "Missed call". One fact, one join.
  const vmSaysSo = call({ voicemail: true, inbound: true, connected: false });

  it("hasMessage=false overrides the RC result — the system answered, nobody spoke", () => {
    expect(callLabel(vmSaysSo, false)).toBe("Missed their call");
  });

  it("hasMessage=true claims the message even when the result column didn't", () => {
    expect(callLabel(call({ voicemail: false, inbound: true, connected: false }), true)).toBe("Left voicemail");
  });

  it("hasMessage=null falls back to the RC result — the join hasn't loaded, don't invent an answer", () => {
    expect(callLabel(vmSaysSo, null)).toBe("Left voicemail");
    expect(callLabel(call({ inbound: true, connected: false }), null)).toBe("Missed their call");
  });

  it("⚠️ the rail actually PASSES the join — a default-arg fallback is how this regresses silently", () => {
    // The label reads right in every test above with the second argument never
    // wired; only the render site says whether the join reaches the screen.
    const src = readFileSync(resolve(process.cwd(), "src/components/commsHub/PhonePanel.tsx"), "utf8");
    expect(src).toContain("callLabel(r, vmMatched ? vmMatched.has(r.id) : null)");
    // …and the set is built from the SAME join the click uses, never a second rule.
    expect(src).toMatch(/voicemailForCall\(\{ phone: r\.phone, at: r\.at, voicemail: true \}, voicemails\)/);
  });
});
