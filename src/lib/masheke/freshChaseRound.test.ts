import { describe, it, expect } from "vitest";
import { buildFreshChaseRound } from "./mondayWrite";
import type { Patient } from "./workflow";

const p = (over: Partial<Patient>) => over as Pick<Patient, "chaseAttempt1" | "chaseAttempt2" | "chaseAttempt3">;

describe("buildFreshChaseRound — a booked visit restarts the chase", () => {
  it("folds the spent chase attempts into the notes and asks for the clears", () => {
    const r = buildFreshChaseRound("8/1/26 · Chase: faxed —JH", p({
      chaseAttempt1: "8/4/26 · No answer",
      chaseAttempt2: "8/7/26 · Left VM",
      chaseAttempt3: "8/9/26 · Refax sent",
    }));
    expect(r.hasAttempts).toBe(true);
    expect(r.notes).toContain("Chase Clinicals notes");
    expect(r.notes).toContain("Attempt 3: 8/9/26 · Refax sent");
    // The caller's own line survives ahead of the rollup.
    expect(r.notes.startsWith("8/1/26 · Chase: faxed —JH")).toBe(true);
  });

  it("NEVER touches Confirm Receipt's columns", () => {
    // ChaseClinicalsPanel parses them for its "who actually confirmed receipt"
    // banner, and the patient is not going back through that stage. Even when a
    // confirm column is populated it must not appear in the rollup.
    const r = buildFreshChaseRound("notes", p({
      confirmAttempt1: "8/2/26 · Confirmed · spoke to Dana",
      chaseAttempt1: "8/4/26 · No answer",
    } as Partial<Patient>));
    expect(r.notes).not.toContain("Confirm Receipt notes");
    expect(r.notes).not.toContain("spoke to Dana");
  });

  it("reports nothing to clear when no chase attempt was ever logged", () => {
    // The counter still resets — the caller writes MN Attempts unconditionally —
    // but three no-op blanking writes would be noise in the activity log.
    const r = buildFreshChaseRound("notes", p({}));
    expect(r.hasAttempts).toBe(false);
    expect(r.notes).toBe("notes");
  });
});
