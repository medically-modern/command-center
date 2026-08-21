import { describe, it, expect } from "vitest";
import { referralDoctorInfo, isCareCentrixReferral } from "./referralDoctorInfo";

/** The real CareCentrix item the gap was reported on (Profile Send Off
 *  12866837152, 2026-08-21), as its create-item automation left it: verified
 *  doctor name + phone copied, both Provided columns blank, no clinic address
 *  until Select Correct Provider runs. */
const careCentrixAsCreated = {
  referralSource: "CareCentrix",
  formProvidedDoctorName: "",
  formProvidedClinicPhone: "",
  doctorName: "Josh Test 2",
  doctorPhone: "13102138290",
  clinicAddress: "",
};

/** A DTC web-form lead — the mirror image: the patient's own answers are in the
 *  Provided columns and the verified doctor columns are empty. */
const dtcFormLead = {
  referralSource: "Patient",
  formProvidedDoctorName: "Dr. Smith",
  formProvidedClinicPhone: "Brooklyn office",
  doctorName: "",
  doctorPhone: "",
  clinicAddress: "",
};

describe("isCareCentrixReferral", () => {
  it("matches the board label, case- and space-insensitively", () => {
    expect(isCareCentrixReferral("CareCentrix")).toBe(true);
    expect(isCareCentrixReferral(" carecentrix ")).toBe(true);
  });

  it("does not match the other referral sources", () => {
    for (const source of ["Patient", "Tandem", "Beta Bionics", "Doctor", "", null, undefined]) {
      expect(isCareCentrixReferral(source)).toBe(false);
    }
  });
});

describe("referralDoctorInfo", () => {
  it("fills both slots from the referral when CareCentrix left them blank", () => {
    const info = referralDoctorInfo(careCentrixAsCreated);
    expect(info.doctorName).toBe("Josh Test 2");
    // Clinic Address is not copied by the manual form's automation, so the
    // doctor phone is what the field can actually show on a fresh referral.
    expect(info.clinicPhoneOrLocation).toBe("13102138290");
    expect(info.fromReferral).toBe(true);
  });

  it("prefers the clinic address once a provider has been picked", () => {
    const info = referralDoctorInfo({
      ...careCentrixAsCreated,
      clinicAddress: "741 Jeffries Road, Big Bear Lake, CA 92315",
    });
    expect(info.clinicPhoneOrLocation).toBe("741 Jeffries Road, Big Bear Lake, CA 92315");
  });

  it("never shadows what the patient actually provided", () => {
    const info = referralDoctorInfo({
      ...careCentrixAsCreated,
      formProvidedDoctorName: "Dr Patient-Said",
      formProvidedClinicPhone: "the one on Main St",
    });
    expect(info.doctorName).toBe("Dr Patient-Said");
    expect(info.clinicPhoneOrLocation).toBe("the one on Main St");
    expect(info.fromReferral).toBe(false);
  });

  it("fills only the blank slot when one of the two was provided", () => {
    const info = referralDoctorInfo({
      ...careCentrixAsCreated,
      formProvidedDoctorName: "Dr Patient-Said",
    });
    expect(info.doctorName).toBe("Dr Patient-Said");
    expect(info.clinicPhoneOrLocation).toBe("13102138290");
    expect(info.fromReferral).toBe(true);
  });

  it("leaves every other referral source exactly as the board has it", () => {
    expect(referralDoctorInfo(dtcFormLead)).toEqual({
      doctorName: "Dr. Smith",
      clinicPhoneOrLocation: "Brooklyn office",
      fromReferral: false,
    });
    // A doctor referral carries a verified doctor too — it must NOT leak into
    // the provided card, which is a record of what the patient said.
    expect(referralDoctorInfo({
      referralSource: "Doctor",
      doctorName: "Dr. Referrer",
      doctorPhone: "3475550101",
      clinicAddress: "1 Main St, Albany, NY 12207",
    })).toEqual({ doctorName: "", clinicPhoneOrLocation: "", fromReferral: false });
  });

  it("stays blank, and unflagged, when the referral carries no doctor either", () => {
    expect(referralDoctorInfo({ referralSource: "CareCentrix" })).toEqual({
      doctorName: "", clinicPhoneOrLocation: "", fromReferral: false,
    });
  });

  it("trims, so a whitespace-only column does not count as an answer", () => {
    const info = referralDoctorInfo({
      ...careCentrixAsCreated,
      formProvidedDoctorName: "   ",
      doctorName: "  Josh Test 2  ",
    });
    expect(info.doctorName).toBe("Josh Test 2");
    expect(info.fromReferral).toBe(true);
  });
});
