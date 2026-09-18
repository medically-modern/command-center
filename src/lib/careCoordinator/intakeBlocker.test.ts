/**
 * `intakeBlocker` — the sentence a Review Profile card prints when the
 * dashboard can see why a patient has not been advanced (Josh, 2026-09-18:
 * "display the actual blocker").
 *
 * The population it was written for is Savannah French: a rep filled her in
 * on 2026-09-10, ticked Intake Call Complete, ran the benefits check, and it
 * came back `AAA 73 — Invalid/Missing Subscriber/Insured Name` twice. She then
 * disappeared from this dashboard entirely, because Intake Call Complete was
 * an EXCLUSION. The blocker is the other half of surfacing her.
 *
 * ⚠️ These assertions mirror `profile/intakeUnlock.evaluateUnlock`'s
 * conditions in ORDER. If that file's rules change, this is a keep-in-agreement
 * site — the dashboard may be narrower than the checklist, never different.
 */
import { describe, it, expect } from "vitest";
import { intakeBlocker, needsProfileReview } from "./workflow";

const facts = (over: Partial<Parameters<typeof intakeBlocker>[0]> = {}) => ({
  stediError: "", stediActive: "Yes", stediPlanName: "Anthem PPO",
  requestType: "", pumpNeed: "", cgmCoveragePath: "", ipCoveragePath: "",
  ...over,
});

describe("intakeBlocker", () => {
  it("an error outranks everything — a failed check is not a verdict on coverage", () => {
    // Savannah's real row: the error is present AND the plan came back. A
    // failed run means the identifiers did not match, so it can never be read
    // as "this patient is ineligible".
    expect(intakeBlocker(facts({
      stediError: "Incorrect information — verify the patient's details. | AAA 73 — Invalid/Missing Subscriber/Insured Name",
      stediActive: "", stediPlanName: "",
    }))).toMatch(/^Benefits check failed — /);
  });

  it("nothing back at all is 'hasn't run', not 'inactive'", () => {
    expect(intakeBlocker(facts({ stediActive: "", stediPlanName: "" })))
      .toBe("Benefits check hasn't run");
  });

  it("a run that came back with a plan but no active answer reads INACTIVE", () => {
    // It ran (a plan name is evidence of a result); coverage is the failure.
    expect(intakeBlocker(facts({ stediActive: "", stediPlanName: "Anthem PPO" })))
      .toBe("Coverage came back inactive");
    expect(intakeBlocker(facts({ stediActive: "No" }))).toBe("Coverage came back inactive");
  });

  it("accepts every spelling of active that intakeUnlock.coverageActive does", () => {
    for (const v of ["Yes", "active", "TRUE"]) {
      expect(intakeBlocker(facts({ stediActive: v }))).toBe("");
    }
  });

  it("names a missing coverage path only for a product actually in play", () => {
    expect(intakeBlocker(facts({ requestType: "CGM" }))).toBe("CGM Coverage Path not chosen");
    expect(intakeBlocker(facts({ requestType: "Insulin Pump" }))).toBe("Insulin Pump Coverage Path not chosen");
    expect(intakeBlocker(facts({ pumpNeed: "Need a new pump" }))).toBe("Insulin Pump Coverage Path not chosen");
    // A CGM-only patient is never asked for a pump path.
    expect(intakeBlocker(facts({ requestType: "CGM", cgmCoveragePath: "Insulin" }))).toBe("");
  });

  it("⚠️ a blank result is 'nothing we can see', NOT 'ready to advance'", () => {
    // This read is narrower than the profile page's checklist: `cgmInPlay`
    // there also consults Provided CGM Preference and CGM Data Awareness,
    // which this dashboard does not carry. A patient whose only CGM signal is
    // one of those comes back "" here and is still blocked on the page — which
    // is why the card prints nothing rather than a green "ready".
    expect(intakeBlocker(facts())).toBe("");
  });
});

describe("needsProfileReview", () => {
  const lead = (over: Partial<Parameters<typeof needsProfileReview>[0]> = {}) =>
    ({ dropOffStep: "", proceedPreference: "", intakeCallComplete: "", ...over });

  it("Intake Call Complete stands alone, whatever the form says", () => {
    expect(needsProfileReview(lead({ intakeCallComplete: "Yes", dropOffStep: "Step 4 - Doctor" }))).toBe(true);
    expect(needsProfileReview(lead({ intakeCallComplete: "yes" }))).toBe(true);
  });

  it("'Send request now' needs a FINISHED form", () => {
    expect(needsProfileReview(lead({ dropOffStep: "Completed", proceedPreference: "Send request now" }))).toBe(true);
    expect(needsProfileReview(lead({ dropOffStep: "Step 5 - Insurance", proceedPreference: "Send request now" }))).toBe(false);
  });

  it("an ordinary partial lead is not a review", () => {
    expect(needsProfileReview(lead({ dropOffStep: "Step 4 - Doctor" }))).toBe(false);
  });
});
