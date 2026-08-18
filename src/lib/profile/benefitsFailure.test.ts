import { describe, expect, it } from "vitest";
import { formatBenefitsFailure } from "./benefitsFailure";

// Shapes below are the live board's, verbatim (text_mm1x9tje, 2026-08-18).
const GUIDANCE =
  "Incorrect information — verify the patient's details, or run Insurance Discovery / the Eligibility Agent in the Stedi portal.";

describe("formatBenefitsFailure", () => {
  it("is null for blank — no failure, no callout", () => {
    expect(formatBenefitsFailure("")).toBeNull();
    expect(formatBenefitsFailure(undefined)).toBeNull();
    expect(formatBenefitsFailure("   ")).toBeNull();
  });

  it("splits guidance | AAA cause", () => {
    const f = formatBenefitsFailure(
      `${GUIDANCE} | AAA 72 — Invalid/Missing Subscriber/Insured ID (Please Correct and Resubmit)`,
    );
    expect(f).toEqual({
      guidance: GUIDANCE,
      cause: "AAA 72 — Invalid/Missing Subscriber/Insured ID (Please Correct and Resubmit)",
    });
  });

  it("digs the message out of a Stedi HTTP blob", () => {
    const f = formatBenefitsFailure(
      `${GUIDANCE} | Stedi HTTP 400: {"message": "subscriber.memberId: the value must match the pattern of \\"^[A-Za-z0-9- ]+$\\".", "code": "INVALID_REQUEST_BODY", "eligibilitySearchId": "019ffcf8", "id": "ec_019ffcf8"}`,
    );
    expect(f?.cause).toBe(
      'subscriber.memberId: the value must match the pattern of "^[A-Za-z0-9- ]+$". (Stedi HTTP 400)',
    );
    expect(f?.guidance).toBe(GUIDANCE);
  });

  it("keeps an unparseable blob verbatim rather than dropping it", () => {
    const f = formatBenefitsFailure(`${GUIDANCE} | Stedi HTTP 400: {not json`);
    expect(f?.cause).toBe("Stedi HTTP 400: {not json");
  });

  it("a line with no pipe is all cause — never invented guidance", () => {
    const f = formatBenefitsFailure("Payer timeout");
    expect(f).toEqual({ cause: "Payer timeout", guidance: "" });
  });

  it("extra pipes stay inside the cause", () => {
    const f = formatBenefitsFailure("Check this | AAA 42 | with a pipe");
    expect(f).toEqual({ guidance: "Check this", cause: "AAA 42 | with a pipe" });
  });
});
