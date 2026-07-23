/**
 * normalizeRecipients is the fax-vs-email routing rule shared by every send
 * panel: an "@" entry is an email (or an already-formed @rcfax address); a bare
 * number becomes <digits>@rcfax.com so RingCentral faxes it. A regression here
 * silently misroutes auth faxes, so lock the conversions down.
 */
import { describe, it, expect } from "vitest";
import { normalizeRecipients, cleanCc } from "./sendViaWorker";

describe("normalizeRecipients", () => {
  it("keeps plain emails as-is", () => {
    expect(normalizeRecipients(["nurse@clinic.com"])).toEqual(["nurse@clinic.com"]);
  });

  it("turns a bare number into <digits>@rcfax.com", () => {
    expect(normalizeRecipients(["5551234567"])).toEqual(["5551234567@rcfax.com"]);
  });

  it("strips formatting from a phone-style number", () => {
    expect(normalizeRecipients(["(555) 123-4567"])).toEqual(["5551234567@rcfax.com"]);
    expect(normalizeRecipients(["+1 555.123.4567"])).toEqual(["15551234567@rcfax.com"]);
  });

  it("leaves an already-formatted @rcfax address alone", () => {
    expect(normalizeRecipients(["5551234567@rcfax.com"])).toEqual(["5551234567@rcfax.com"]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(normalizeRecipients(["  a@x.com ", "", "   "])).toEqual(["a@x.com"]);
  });

  it("drops a digit-less entry that would collapse to just @rcfax.com", () => {
    expect(normalizeRecipients(["---"])).toEqual([]);
  });

  it("handles a mixed email + fax list", () => {
    expect(normalizeRecipients(["a@x.com", "8005551212"])).toEqual([
      "a@x.com",
      "8005551212@rcfax.com",
    ]);
  });
});

describe("cleanCc", () => {
  it("trims and drops empties", () => {
    expect(cleanCc([" a@x.com ", "", "b@x.com"])).toEqual(["a@x.com", "b@x.com"]);
  });
});
