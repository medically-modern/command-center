// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { unwritableDoctorFields } from "./DvsPage";

describe("unwritableDoctorFields", () => {
  it("passes a clean draft", () => {
    expect(
      unwritableDoctorFields({
        doctorName: "Dr. Alice Roberts",
        doctorPhone: "(347) 555-0101",
        doctorEmail: "alice@clinic.com",
        doctorFax: "7166465502@rcfax.com",
      }),
    ).toEqual([]);
  });

  it("catches a phone Monday would drop on the floor", () => {
    // writePhone skips anything that isn't 10 digits — silently, so the save
    // reports success having written nothing.
    expect(unwritableDoctorFields({ doctorPhone: "347555010" })).toEqual([
      "Phone (needs 10 digits)",
    ]);
  });

  it("catches an unparseable email and fax", () => {
    expect(unwritableDoctorFields({ doctorEmail: "drsmith@", doctorFax: "not a fax" })).toEqual([
      "Email (not a valid address)",
      "Fax (not a valid address)",
    ]);
  });

  it("treats blanking a field as valid — clearing is a real edit", () => {
    expect(
      unwritableDoctorFields({ doctorPhone: "", doctorEmail: "", doctorFax: "" }),
    ).toEqual([]);
  });

  it("ignores fields the rep didn't touch", () => {
    expect(unwritableDoctorFields({ doctorName: "Dr. Who" })).toEqual([]);
  });

  it("says nothing about free-text fields, which always write", () => {
    expect(
      unwritableDoctorFields({ doctorNpi: "abc", clinicName: "New Clinic", clinicAddress: "1 Main St" }),
    ).toEqual([]);
  });
});
