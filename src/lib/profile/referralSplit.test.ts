import { describe, it, expect } from "vitest";
import { isUnverifiedReferral } from "./referralSplit";

describe("isUnverifiedReferral (Verified vs Unverified role split)", () => {
  it("routes Referral Type 'Patient' to Unverified regardless of source", () => {
    expect(isUnverifiedReferral("Patient", "")).toBe(true);
    expect(isUnverifiedReferral("Patient", "Tandem")).toBe(true);
    expect(isUnverifiedReferral("Patient", "Doctor")).toBe(true);
  });

  it("routes Referral Source 'CareCentrix' to Unverified regardless of type", () => {
    expect(isUnverifiedReferral("", "CareCentrix")).toBe(true);
    expect(isUnverifiedReferral("Payor", "CareCentrix")).toBe(true);
    expect(isUnverifiedReferral("Manufacturer", "CareCentrix")).toBe(true);
  });

  it("is case/whitespace tolerant (board label re-casing must not move patients)", () => {
    expect(isUnverifiedReferral("PATIENT", "")).toBe(true);
    expect(isUnverifiedReferral(" patient ", "")).toBe(true);
    expect(isUnverifiedReferral("", "Carecentrix")).toBe(true);
    expect(isUnverifiedReferral("", " CARECENTRIX ")).toBe(true);
  });

  it("does NOT treat Referral SOURCE 'Patient' as unverified (only the TYPE column)", () => {
    // "Patient" is also a Referral Source label (index 0) — a patient-sourced
    // referral with a non-Patient type stays with Verified Referrals.
    expect(isUnverifiedReferral("Manufacturer", "Patient")).toBe(false);
    expect(isUnverifiedReferral("Doctor", "Patient")).toBe(false);
  });

  it("keeps every other type/source combination with Verified Referrals", () => {
    expect(isUnverifiedReferral("Manufacturer", "Tandem")).toBe(false);
    expect(isUnverifiedReferral("Payor", "Beta Bionics")).toBe(false);
    expect(isUnverifiedReferral("Doctor", "Doctor")).toBe(false);
    expect(isUnverifiedReferral("Advocacy Group", "Solace Advocates")).toBe(false);
    expect(isUnverifiedReferral("", "")).toBe(false);
    expect(isUnverifiedReferral(null, undefined)).toBe(false);
  });
});
