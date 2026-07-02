import { describe, expect, it } from "vitest";
import {
  interpretStediError, SOLUTION_CONNECTION, SOLUTION_INCORRECT_INFO,
} from "./stediErrors";

describe("interpretStediError", () => {
  it("returns null for blank input", () => {
    expect(interpretStediError("")).toBeNull();
    expect(interpretStediError("   ")).toBeNull();
  });

  it("maps AAA 42 (payer connection) to the retry solution", () => {
    const r = interpretStediError("Unable to Respond at Current Time")!;
    expect(r.code).toBe("42");
    expect(r.isConnectionError).toBe(true);
    expect(r.solution).toBe(SOLUTION_CONNECTION);
    expect(r.description).toBe("Unable to Respond at Current Time");
  });

  it("maps known subscriber errors to their AAA codes with the info solution", () => {
    const id = interpretStediError("Invalid/Missing Subscriber/Insured ID")!;
    expect(id.code).toBe("72");
    expect(id.isConnectionError).toBe(false);
    expect(id.solution).toBe(SOLUTION_INCORRECT_INFO);

    const name = interpretStediError("Invalid/Missing Subscriber/Insured Name")!;
    expect(name.code).toBe("73");

    const provider = interpretStediError("Provider Ineligible for Inquiries")!;
    expect(provider.code).toBe("50");
  });

  it("matches the most specific description first", () => {
    expect(interpretStediError("Subscriber Found, Patient Not Found")!.code).toBe("77");
    expect(interpretStediError("Patient Not Found")!.code).toBe("67");
  });

  it("leaves service-side errors uncoded but still recommends checking info", () => {
    const r = interpretStediError("Missing required field: General Insurance")!;
    expect(r.code).toBeNull();
    expect(r.solution).toBe(SOLUTION_INCORRECT_INFO);
  });

  it("honors an explicit code in the text", () => {
    expect(interpretStediError("Eligibility failed — payer connection error (AAA 42)")!.code).toBe("42");
    expect(interpretStediError("error code 80: transaction terminated")!.code).toBe("80");
  });

  it("strips a canned solution prefix the service prepended", () => {
    const r = interpretStediError(
      "Incorrect information — verify the patient's details, or run Insurance Discovery / the Eligibility Agent in the Stedi portal. | Missing required field: Member ID",
    )!;
    expect(r.description).toBe("Missing required field: Member ID");
    expect(r.code).toBeNull();
    expect(r.solution).toBe(SOLUTION_INCORRECT_INFO);
  });
});
