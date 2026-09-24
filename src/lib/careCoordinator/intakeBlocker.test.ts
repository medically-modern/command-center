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
import { readFileSync } from "node:fs";
import { intakeBlocker, intakeBlockerDetail, needsProfileReview, reviewCardBlocker } from "./workflow";

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
    const err = "Incorrect information — verify the patient's details. | AAA 73 — Invalid/Missing Subscriber/Insured Name";
    expect(intakeBlocker(facts({ stediError: err, stediActive: "", stediPlanName: "" })))
      .toBe("Benefits check failed");
  });

  /**
   * ⚠️ The payer's reason is SHORTENED OUT OF THE SENTENCE, NOT DROPPED
   * (Brandon, 2026-09-22). Stedi returns its guidance and the raw AAA code as
   * one string, which on a card is four lines of runbook where a coordinator
   * is deciding who to ring. `intakeBlockerDetail` is what the card hangs off
   * the line's `title`, so the code that says WHICH identifier did not match
   * is one hover away rather than gone.
   */
  it("keeps the payer's own reason as the detail", () => {
    const err = "Incorrect information | AAA 73 — Invalid/Missing Subscriber/Insured Name";
    expect(intakeBlockerDetail({ stediError: err })).toBe(err);
    expect(intakeBlockerDetail({ stediError: "" })).toBe("");
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

/**
 * What the Review Profile card's rose banner says once the network pill took
 * over the benefits check's verdict (Brandon, 2026-09-24: "instead of the
 * benefits check failed banner or the benefits check hasn't run banner … let's
 * just replace all of that with a pill").
 */
describe("reviewCardBlocker", () => {
  it("never repeats what the pill says: failed and hasn't-run are the pill's now", () => {
    expect(reviewCardBlocker(facts({ stediError: "AAA 73", stediActive: "", stediPlanName: "" }))).toBe("");
    expect(reviewCardBlocker(facts({ stediActive: "", stediPlanName: "" }))).toBe("");
  });

  it("⚠️ still names a missing coverage path BEHIND a failed check", () => {
    // `intakeBlocker` stops at the first failure, so filtering its answer
    // would have hidden this — the one blocker the pill does not cover.
    expect(reviewCardBlocker(facts({ stediError: "AAA 73", requestType: "CGM" })))
      .toBe("CGM Coverage Path not chosen");
    expect(reviewCardBlocker(facts({ stediActive: "", stediPlanName: "", requestType: "Insulin Pump" })))
      .toBe("Insulin Pump Coverage Path not chosen");
  });

  it("keeps INACTIVE coverage on the banner — that is not a network answer", () => {
    expect(reviewCardBlocker(facts({ stediActive: "No" }))).toBe("Coverage came back inactive");
    // And inactive still stops the search, as intakeBlocker does.
    expect(reviewCardBlocker(facts({ stediActive: "No", requestType: "CGM" }))).toBe("Coverage came back inactive");
  });

  it("leaves intakeBlocker itself exactly as it was", () => {
    expect(intakeBlocker(facts({ stediError: "AAA 73", requestType: "CGM" }))).toBe("Benefits check failed");
    expect(intakeBlocker(facts({ stediActive: "", stediPlanName: "" }))).toBe("Benefits check hasn't run");
  });

  it("is what the Review Profile bucket carries on its entries", () => {
    const src = readFileSync("src/lib/careCoordinator/workflow.ts", "utf8");
    expect(src).toContain("blocker: reviewCardBlocker(lead),");
  });
});
