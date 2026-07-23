import { describe, it, expect } from "vitest";
import { buildAuthFaxSubject, buildAuthFaxBody, titleCase } from "./authFaxTemplate";
import type { Patient } from "./workflow";
import type { ResolvedProduct } from "./hcpcRules";

const patient = {
  id: "1",
  name: "marcus feldman",
  dob: "07/22/1985",
  primaryInsurance: "Aetna",
  memberId1: "W123456789",
} as Patient;

const products = [
  { product: "insulin_pump", hcpc: "E0784" },
  { product: "sensors", hcpc: "A4239" },
] as ResolvedProduct[];

describe("authFaxTemplate", () => {
  it("title-cases the patient name in the subject", () => {
    expect(buildAuthFaxSubject(patient)).toBe(
      "Prior authorization request — Marcus Feldman · Aetna",
    );
  });

  it("omits the payer from the subject when there's no primary insurance", () => {
    expect(buildAuthFaxSubject({ ...patient, primaryInsurance: "" } as Patient)).toBe(
      "Prior authorization request — Marcus Feldman",
    );
  });

  it("body includes patient, plan, member id, and every HCPCS line", () => {
    const body = buildAuthFaxBody(patient, products);
    expect(body).toContain("Patient: Marcus Feldman");
    expect(body).toContain("DOB: 07/22/1985");
    expect(body).toContain("Plan: Aetna");
    expect(body).toContain("Member ID: W123456789");
    expect(body).toContain("HCPCS E0784");
    expect(body).toContain("HCPCS A4239");
    expect(body).toContain("NPI: 1023042348");
    expect(body).toContain("Aetna Prior Authorization Department");
  });

  it("skips blank optional fields (no member id row when missing)", () => {
    const body = buildAuthFaxBody({ ...patient, memberId1: "" } as Patient, products);
    expect(body).not.toContain("Member ID:");
  });

  it("titleCase handles multi-word names", () => {
    expect(titleCase("JANE VAN DER BERG")).toBe("Jane Van Der Berg");
  });
});
