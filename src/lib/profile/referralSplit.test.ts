import { describe, it, expect } from "vitest";
import { isAlreadyInSystem, isUnverifiedReferral, profileReferralRole } from "./referralSplit";

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

describe("isAlreadyInSystem", () => {
  it("matches only the 'Yes' label, case/whitespace tolerant", () => {
    expect(isAlreadyInSystem("Yes")).toBe(true);
    expect(isAlreadyInSystem(" yes ")).toBe(true);
    expect(isAlreadyInSystem("YES")).toBe(true);
  });

  it("treats No / blank / unset as NOT in system", () => {
    // A blank column must never pull a patient out of the verified or
    // unverified queue — the intake automations don't always set it.
    expect(isAlreadyInSystem("No")).toBe(false);
    expect(isAlreadyInSystem("")).toBe(false);
    expect(isAlreadyInSystem(null)).toBe(false);
    expect(isAlreadyInSystem(undefined)).toBe(false);
  });
});

describe("profileReferralRole (three-way intake split)", () => {
  it("routes Already In System 'Yes' to inSystem, whatever the referral is", () => {
    expect(profileReferralRole("Patient", "Patient", "Yes")).toBe("inSystem");
    expect(profileReferralRole("Manufacturer", "Tandem", "Yes")).toBe("inSystem");
    expect(profileReferralRole("Payor", "CareCentrix", "Yes")).toBe("inSystem");
    expect(profileReferralRole("", "", " yes ")).toBe("inSystem");
  });

  it("sends everything not in system to VERIFIED, whatever the referral", () => {
    // Josh, 2026-08-10: 1. Intake no longer splits on referral type/source.
    // Patient Intake is the DTC form's two GROUPS and nothing else, so these
    // two — which used to route to "unverified" — stay with Verified Referrals.
    // Routing them away would filter them off /profile's list while the role
    // count and the profile-send-off chart still counted them.
    expect(profileReferralRole("Patient", "Tandem", "No")).toBe("verified");
    expect(profileReferralRole("Payor", "CareCentrix", "")).toBe("verified");
    expect(profileReferralRole("Manufacturer", "Tandem", "No")).toBe("verified");
    expect(profileReferralRole("Doctor", "Patient", null)).toBe("verified");
    expect(profileReferralRole(null, undefined, undefined)).toBe("verified");
  });

  it("still answers 'is this an unverified referral?' for labelling", () => {
    // The predicate is intact — it just no longer decides the queue.
    expect(isUnverifiedReferral("Patient", "Tandem")).toBe(true);
    expect(isUnverifiedReferral("Payor", "CareCentrix")).toBe(true);
    expect(isUnverifiedReferral("Doctor", "Patient")).toBe(false);
  });

  it("puts every patient in exactly one queue (the counting contract)", () => {
    const cases: [string, string, string][] = [
      ["Patient", "Patient", "Yes"], ["Patient", "Patient", "No"],
      ["Manufacturer", "Tandem", "Yes"], ["Manufacturer", "Tandem", ""],
      ["Doctor", "Doctor", "No"], ["", "CareCentrix", ""],
    ];
    for (const [type, source, inSystem] of cases) {
      const role = profileReferralRole(type, source, inSystem);
      const matches = (["inSystem", "unverified", "verified"] as const).filter((r) => r === role);
      expect(matches).toHaveLength(1);
    }
  });
});
