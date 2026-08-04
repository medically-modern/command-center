import { describe, expect, it, beforeAll } from "vitest";

/**
 * The assignment store keys on HMAC(pepper, E.164) rather than the phone
 * number, so normalization is load-bearing: if the same patient hashes
 * differently depending on how their number was typed, their assignment
 * silently stops matching and their conversation disappears from the rep's
 * inbox with no error anywhere.
 */
let toE164;
let phoneHmac;

beforeAll(async () => {
  // Must be set before import — the module reads it at load time, and without
  // it phoneHmac throws rather than falling back to an unpeppered digest.
  process.env.PHONE_HMAC_PEPPER = "test-pepper-not-a-real-secret";
  const mod = await import("./phoneHash.mjs");
  toE164 = mod.toE164;
  phoneHmac = mod.phoneHmac;
});

describe("toE164", () => {
  it("normalizes every format a number gets typed or returned in", () => {
    for (const raw of [
      "3475037148",
      "13475037148",
      "+13475037148",
      "(347) 503-7148",
      "347-503-7148",
      "347.503.7148",
      " +1 (347) 503-7148 ",
    ]) {
      expect(toE164(raw), raw).toBe("+13475037148");
    }
  });

  it("returns empty for junk rather than a bogus number", () => {
    expect(toE164("")).toBe("");
    expect(toE164(null)).toBe("");
    expect(toE164(undefined)).toBe("");
  });

  it("passes through an already-E.164 international number", () => {
    expect(toE164("+442071838750")).toBe("+442071838750");
  });

  // Regression: a short/partial Monday value used to fall through to
  // "+" + digits, fabricating a valid-LOOKING number. "+310213829" was read by
  // RingCentral as a Netherlands number and rejected on send, and matched no
  // conversation on read, so the thread rendered empty with no explanation.
  it("returns empty for a number too short to place, rather than inventing one", () => {
    for (const bad of ["0213829", "213829", "12345", "+310213829", "555-1234"]) {
      expect(toE164(bad), bad).toBe("");
    }
  });

  it("rejects a + number longer than E.164 allows", () => {
    expect(toE164("+1234567890123456")).toBe("");
  });

  it("still accepts a plausible international number", () => {
    expect(toE164("+44 20 7183 8750")).toBe("+442071838750");
  });
});

describe("phoneHmac", () => {
  it("hashes every format of the same number identically", () => {
    const want = phoneHmac("+13475037148");
    for (const raw of ["3475037148", "13475037148", "(347) 503-7148", "347-503-7148"]) {
      expect(phoneHmac(raw), raw).toBe(want);
    }
  });

  it("gives different numbers different hashes", () => {
    expect(phoneHmac("+13475037148")).not.toBe(phoneHmac("+13475037149"));
  });

  it("is a hex digest, not the number", () => {
    const h = phoneHmac("+13475037148");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("3475037148");
  });

  it("returns empty for an unusable number so callers can reject it", () => {
    expect(phoneHmac("")).toBe("");
    expect(phoneHmac("nope")).toBe("");
  });
});
