// H1 — no double-write on a lost gateway ACK.
// The gateway POST is idempotent on idempotencyKey, so the ONLY unsafe move is
// re-running the whole transaction on the client path after the gateway may have
// already created the job. decideLostAck encodes that safety rule; these tests
// pin it so a future edit can't reintroduce the double-write.
// Run: npx vitest run src/lib/shared/gatewaySend.test.ts
import { describe, it, expect } from "vitest";
import { decideLostAck } from "./gatewaySend";

describe("decideLostAck — H1 double-write guard", () => {
  it("offline → park in the outbox (queued-offline), never fall back", () => {
    expect(decideLostAck(false, false)).toBe("queued-offline");
    // even if an earlier attempt saw an HTTP error, being offline now means park
    expect(decideLostAck(false, true)).toBe("queued-offline");
  });

  it("online + gateway returned an ERROR STATUS → job not persisted → safe client fallback", () => {
    // res.ok === false means POST /send never got past validation/insert, so no
    // server job exists to double-write; the caller may re-run on the client.
    expect(decideLostAck(true, true)).toBe("fallback");
  });

  it("online + NO response (ambiguous lost ack) → park for idempotent retry, NEVER fall back", () => {
    // This is the double-write trap: the job MAY have been created while the ACK
    // was lost. Must NOT return 'fallback'.
    const decision = decideLostAck(true, false);
    expect(decision).toBe("queued-unconfirmed");
    expect(decision).not.toBe("fallback");
  });

  it("only a definitive gateway error status ever authorizes a client fallback", () => {
    const cases: Array<[boolean, boolean]> = [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ];
    const fallbacks = cases.filter(([online, httpErr]) => decideLostAck(online, httpErr) === "fallback");
    // exactly one combination — online AND a real HTTP error response
    expect(fallbacks).toEqual([[true, true]]);
  });
});
