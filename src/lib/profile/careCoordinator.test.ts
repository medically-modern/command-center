import { describe, it, expect } from "vitest";
import { coordinatorNoteLine, extractCoordinator } from "./careCoordinator";
import { appendStampedNote } from "../shared/noteStamp";

describe("coordinatorNoteLine", () => {
  it("is a stable, matchable shape", () => {
    expect(coordinatorNoteLine("Jane Doe")).toBe("Care Coordinator: Jane Doe");
  });

  it("trims", () => {
    expect(coordinatorNoteLine("  Jane Doe  ")).toBe("Care Coordinator: Jane Doe");
  });
});

describe("extractCoordinator", () => {
  it("reads the name back out of a fully stamped line", () => {
    // The round trip that matters: what appendStampedNote actually writes has
    // to be readable by the parser a later stage will use.
    const notes = appendStampedNote("", coordinatorNoteLine("Jane Doe"), "Patient Intake", {
      initials: "JH",
    });
    expect(extractCoordinator(notes)).toBe("Jane Doe");
  });

  it("takes the LAST assignment — ownership can change hands", () => {
    let notes = appendStampedNote("", coordinatorNoteLine("Jane Doe"), "Patient Intake", { initials: "JH" });
    notes = appendStampedNote(notes, "Called patient, no answer.", "Patient Intake", { initials: "JH" });
    notes = appendStampedNote(notes, coordinatorNoteLine("Sam Ruiz"), "Patient Intake", { initials: "BE" });
    expect(extractCoordinator(notes)).toBe("Sam Ruiz");
  });

  it("ignores ordinary notes and empty logs", () => {
    expect(extractCoordinator("")).toBeNull();
    expect(extractCoordinator(undefined)).toBeNull();
    expect(extractCoordinator("[Aug 10] Patient Intake: Called the patient. —JH")).toBeNull();
  });

  it("reads a bare line too — other stages stamp differently", () => {
    expect(extractCoordinator("Care Coordinator: Sam Ruiz")).toBe("Sam Ruiz");
  });

  it("does not swallow a name containing an em dash in the initials slot only", () => {
    expect(extractCoordinator("Care Coordinator: Jane Doe —JH")).toBe("Jane Doe");
  });
});
