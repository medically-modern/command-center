import { describe, it, expect } from "vitest";
import { digitsKey, mergeRings, shownRings } from "./ringMerge";
import type { RingingCall } from "@/hooks/inboundCalls/useInboundCalls";
import type { SipRing } from "./types";

const sse = (over: Partial<RingingCall> = {}): RingingCall => ({
  id: "s-abc",
  from: "+13475550101",
  to: "+13475037148",
  callerName: "",
  startedAt: 1_000,
  state: "ringing",
  claimedBy: null,
  patient: { itemId: "1", name: "Pat Example", phone: "+13475550101", boardId: "b", boardName: "Welcome Call" },
  ...over,
});
const sip = (over: Partial<SipRing> = {}): SipRing => ({
  id: "call-id-1",
  sessionId: "s-abc",
  from: "13475550101",
  callerName: "WIRELESS CALLER",
  startedAt: 1_500,
  ...over,
});

describe("digitsKey", () => {
  it("reduces every rendering to the last ten digits", () => {
    expect(digitsKey("+13475550101")).toBe("3475550101");
    expect(digitsKey("(347) 555-0101")).toBe("3475550101");
    expect(digitsKey("13475550101")).toBe("3475550101");
  });
});

describe("mergeRings", () => {
  it("joins the gateway card and the SIP leg on the telephony session id — one card, answerable", () => {
    const m = mergeRings([sse()], [sip()]);
    expect(m).toHaveLength(1);
    expect(m[0].canAnswer).toBe(true);
    expect(m[0].patient?.name).toBe("Pat Example");
    expect(m[0].sip?.id).toBe("call-id-1");
    expect(m[0].sse?.id).toBe("s-abc");
  });

  it("falls back to the caller's digits when the INVITE carried no session id", () => {
    const m = mergeRings([sse()], [sip({ sessionId: "" })]);
    expect(m).toHaveLength(1);
    expect(m[0].canAnswer).toBe(true);
  });

  it("keeps the SSE-only card unanswerable — that is the Take-it path", () => {
    const m = mergeRings([sse()], []);
    expect(m).toHaveLength(1);
    expect(m[0].canAnswer).toBe(false);
    expect(m[0].sip).toBeNull();
  });

  it("renders a SIP-only ring on its own — the gateway stream being down must not hide a real ring", () => {
    const m = mergeRings([], [sip()]);
    expect(m).toHaveLength(1);
    expect(m[0].canAnswer).toBe(true);
    expect(m[0].patient).toBeNull();
    expect(m[0].from).toBe("13475550101");
  });

  it("a live SIP leg wins the state over a lagging gateway card", () => {
    const m = mergeRings([sse({ state: "missed" })], [sip()]);
    expect(m[0].state).toBe("ringing");
  });

  it("a gateway card that ended with no SIP leg stays ended", () => {
    const m = mergeRings([sse({ state: "answered", claimedBy: "janelle@medicallymodern.com" })], []);
    expect(m[0].state).toBe("answered");
    expect(m[0].claimedBy).toBe("janelle@medicallymodern.com");
  });

  it("keeps two different callers as two cards, oldest first", () => {
    const m = mergeRings(
      [sse({ id: "s-2", from: "+16095550199", startedAt: 3_000 }), sse()],
      [sip({ sessionId: "s-2", from: "16095550199", id: "c2", startedAt: 3_100 })],
    );
    expect(m.map((u) => u.key)).toEqual(["s:s-abc", "s:s-2"]);
    expect(m[0].canAnswer).toBe(false);
    expect(m[1].canAnswer).toBe(true);
  });

  it("the key is stable whichever half arrives first", () => {
    const a = mergeRings([sse()], [])[0].key;
    const b = mergeRings([], [sip()])[0].key;
    expect(a).toBe(b);
  });
});

describe("shownRings — a registered browser shows a call once it is rung here (§5.13c)", () => {
  it("⚠️ a gateway card with no SIP leg is held back while registered (the greeting; a fax)", () => {
    const merged = mergeRings([sse()], []);
    expect(shownRings(merged, true, new Set())).toEqual([]);
  });

  it("shows it the moment the leg arrives", () => {
    const merged = mergeRings([sse()], [sip()]);
    expect(shownRings(merged, true, new Set()).map((u) => u.canAnswer)).toEqual([true]);
  });

  it("keeps a card it already showed after the leg goes (answered elsewhere, missed)", () => {
    const merged = mergeRings([sse({ state: "answered" })], []);
    expect(shownRings(merged, true, new Set([merged[0].key]))).toHaveLength(1);
  });

  it("⚠️ a browser that is NOT registered still shows every card, with its reason", () => {
    const merged = mergeRings([sse()], []);
    expect(shownRings(merged, false, new Set())).toHaveLength(1);
  });
});

describe("who answered (Josh, 2026-10-02)", () => {
  it("a call another browser reported answering reads answered, with their name, once no leg rings here", () => {
    const [u] = mergeRings([sse({ answeredBy: "victor@medicallymodern.com" })], []);
    expect(u.state).toBe("answered");
    expect(u.answeredBy).toBe("victor@medicallymodern.com");
  });
  it("a leg still ringing here wins, as before", () => {
    const [u] = mergeRings([sse({ answeredBy: "victor@medicallymodern.com" })], [sip()]);
    expect(u.state).toBe("ringing");
  });
});
