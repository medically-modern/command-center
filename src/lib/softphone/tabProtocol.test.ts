import { describe, it, expect } from "vitest";
import { followerView, isTabMessage } from "./tabProtocol";
import type { PhoneSnapshot } from "./types";

const snap: PhoneSnapshot = {
  leader: true,
  enabled: true,
  ringMuted: false,
  registration: "registered",
  registrationError: null,
  lastError: null,
  rings: [{ id: "c1", sessionId: "s-1", from: "13475550101", callerName: "", startedAt: 1 }],
  call: null,
};

describe("isTabMessage", () => {
  it("accepts the shapes the leader and followers exchange", () => {
    expect(isTabMessage({ type: "state", from: "t1", state: snap })).toBe(true);
    expect(isTabMessage({ type: "hello", from: "t2" })).toBe(true);
    expect(isTabMessage({ type: "bye", from: "t1" })).toBe(true);
    expect(isTabMessage({ type: "cmd", cmd: "answer", callId: "c1" })).toBe(true);
    expect(isTabMessage({ type: "cmd", cmd: "mute", muted: true })).toBe(true);
    expect(isTabMessage({ type: "cmd", cmd: "dial", phone: "+13475550101" })).toBe(true);
  });
  it("rejects anything else — another tab on an older build must not crash this one", () => {
    expect(isTabMessage(null)).toBe(false);
    expect(isTabMessage("state")).toBe(false);
    expect(isTabMessage({ type: "state" })).toBe(false);
    expect(isTabMessage({ type: "cmd", cmd: "decline" })).toBe(false);
    expect(isTabMessage({ type: "explode" })).toBe(false);
  });
});

describe("followerView", () => {
  it("mirrors the leader with leader:false", () => {
    const v = followerView(snap, true);
    expect(v.leader).toBe(false);
    expect(v.registration).toBe("registered");
    expect(v.rings).toHaveLength(1);
  });
  it("reads the assignment locally, never waiting on the leader for it", () => {
    expect(followerView(snap, false).enabled).toBe(false);
  });
  it("carries this browser's own mute, never the leader's copy of it", () => {
    expect(followerView(snap, true, true).ringMuted).toBe(true);
    expect(followerView(null, true, true).ringMuted).toBe(true);
    expect(followerView(snap, true).ringMuted).toBe(false);
  });
  it("is an honest placeholder before any leader has spoken", () => {
    expect(followerView(null, true).registration).toBe("registering");
    expect(followerView(null, false).registration).toBe("off");
    expect(followerView(null, true).rings).toEqual([]);
  });
});
