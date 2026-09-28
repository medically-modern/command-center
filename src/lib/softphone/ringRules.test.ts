/**
 * Which calls make a sound (§5.13b, ringRules.ts).
 *
 * The bug these pin is silent by construction: a call card that pops with no
 * ringtone looks exactly like a quiet afternoon, and the rep only finds out
 * afterwards that somebody called. Each `it` below is one of the ways that
 * happened.
 */
import { describe, it, expect } from "vitest";
import { audibleRings, nextExpiryMs, ringingCards, sameRings, RING_AUDIBLE_MS } from "./ringRules";

const card = (over: Partial<Parameters<typeof ringingCards>[0][number]> = {}) => ({
  id: "s-1",
  state: "ringing" as const,
  claimedBy: null,
  startedAt: 1_000,
  ...over,
});

describe("ringingCards — the gateway's cards that should be audible", () => {
  it("rings for a card whether or not this browser holds the SIP leg", () => {
    // The whole point: the gateway's webhook reaches every assigned answerer,
    // the SIP INVITE only reaches a registered browser. Silence used to be
    // keyed on the second.
    expect(ringingCards([card()])).toEqual([{ id: "s-1", startedAt: 1_000 }]);
  });

  it("does not ring for a call that has ended", () => {
    expect(ringingCards([card({ state: "missed" }), card({ id: "s-2", state: "answered" })])).toEqual([]);
  });

  it("does not ring for a call somebody has already taken", () => {
    expect(ringingCards([card({ claimedBy: "janelle@medicallymodern.com" })])).toEqual([]);
  });
});

describe("audibleRings — one sound per call, and never for long", () => {
  const ids = (rings: { id: string }[]) => rings.map((r) => r.id);

  it("joins the SIP leg and the card for ONE call into one ring", () => {
    const rings = [
      { id: "s-1", startedAt: 1_000 },
      { id: "s-1", startedAt: 1_200 },
      { id: "s-2", startedAt: 1_000 },
    ];
    expect(ids(audibleRings(rings, new Set(), 2_000))).toEqual(["s-1", "s-2"]);
  });

  it("a dismissed ring is silent — X is the speaker as well as the card", () => {
    expect(ids(audibleRings([{ id: "s-1", startedAt: 1_000 }], new Set(["s-1"]), 2_000))).toEqual([]);
  });

  it("stops chiming once the call is past any window it could be taken in", () => {
    const rang = 1_700_000_000_000;
    const rings = [{ id: "s-1", startedAt: rang }];
    expect(ids(audibleRings(rings, new Set(), rang + RING_AUDIBLE_MS - 1))).toEqual(["s-1"]);
    expect(ids(audibleRings(rings, new Set(), rang + RING_AUDIBLE_MS))).toEqual([]);
  });

  it("⚠️ a ring with no start time is treated as fresh, never as silent", () => {
    // A missing timestamp is a gap in what the gateway sent, not evidence the
    // call is old — and the failure of guessing wrong here is a missed call.
    expect(ids(audibleRings([{ id: "s-1", startedAt: 0 }], new Set(), 9_000_000))).toEqual(["s-1"]);
  });
});

describe("nextExpiryMs — one timer, not a poll", () => {
  it("counts down to the oldest ring's cut-off", () => {
    const rings = [
      { id: "a", startedAt: 1_000 },
      { id: "b", startedAt: 5_000 },
    ];
    expect(nextExpiryMs(rings, 1_000)).toBe(RING_AUDIBLE_MS);
    expect(nextExpiryMs(rings, 1_000 + RING_AUDIBLE_MS + 10)).toBe(0);
  });

  it("has nothing to arm when no ring carries a start time", () => {
    expect(nextExpiryMs([{ id: "a", startedAt: 0 }], 1_000)).toBeNull();
    expect(nextExpiryMs([], 1_000)).toBeNull();
  });
});

describe("sameRings — the guard on the cross-tab post", () => {
  it("is true for an unchanged set and false for any change", () => {
    const a = [{ id: "s-1", startedAt: 1 }];
    expect(sameRings(a, [{ id: "s-1", startedAt: 1 }])).toBe(true);
    expect(sameRings(a, [{ id: "s-1", startedAt: 2 }])).toBe(false);
    expect(sameRings(a, [{ id: "s-2", startedAt: 1 }])).toBe(false);
    expect(sameRings(a, [])).toBe(false);
  });
});
