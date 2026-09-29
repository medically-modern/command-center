/**
 * The one-sentence conclusion on the "Already in System" pill. The notes
 * below are SHAPED like the live write-ups (read 2026-09-29) with every
 * identifier replaced — no patient data (§9).
 */
import { describe, expect, it } from "vitest";
import { dupCheckSummary, inSystemHover, splitSentences } from "./dupCheckSummary";

const LEADS_WITH_VERDICT = `[8/17/2026, 1:53 PM] Duplicate Check: Duplicate — updated info
Linked by: Matched on phone, email, date of birth and phonetic last name + birth year; the only identifier that disagreed was member ID.
Confidence: high
Current status: Test Patient completed Medical Evaluation on 08/11/2026 and moved straight into Insurance.
Pipeline history:
  · Medical Evaluation: Completed (Completed) — last activity 2026-08-14
Changes:
  ~ Member ID 1: 111 → 11100
Recommended: Do not open a new order — apply the updated member ID to the active Insurance item after confirming it against the card, and close this referral as a duplicate.
This is a duplicate of an existing patient, not a new order — same request (Insulin Pump, Mobi) and same doctor (Dr. Test, NPI 0000000000) we are already working. Test Patient cleared Medical Evaluation on 08/11/2026. Everything else is noise.
Patient UID: 00000000-0000-0000-0000-000000000000
—Claude`;

const LEADS_WITH_IDENTITY = `[8/12/2026, 4:17 PM] Duplicate Check: Duplicate — updated info
Linked by: Matched on member ID, phone, email, DOB — nothing disagreed.
Confidence: high
Recommended: Do not just close this out. Update the active Subscription Board item with the payer, then close the referral as a duplicate of the existing subscription.
This is the same Test Patient we already serve — member ID, phone, email, DOB all agree, so identity confidence is high. He sits on an active legacy Subscription Board item created 03/03/2026. The referral is for CGM, and because the existing record's product fields are blank there is no evidence of a serving change — treat this as populating missing data on the existing subscription, not a new line of business. One thing to resolve: the address differs and should be confirmed by phone.
—Claude`;

const DIFFERENT_SERVING = `[9/2/2026, 10:05 AM] Duplicate Check: New order — different serving
⚠️ DIFFERENT SERVING: This referral is for CGM (Dexcom G7), not the Insulin Pump (Mobi) we already supply — treat it as a NEW CGM order for an existing patient, not a duplicate to close.
Linked by: phone, DOB.
Recommended: Open a CGM order.
Same patient, new product.
—Claude`;

describe("dupCheckSummary", () => {
  it("the summary's first sentence when it states the verdict", () => {
    expect(dupCheckSummary(LEADS_WITH_VERDICT)).toEqual({
      label: "Duplicate — updated info",
      sentence:
        "This is a duplicate of an existing patient, not a new order — same request (Insulin Pump, Mobi) and same doctor (Dr. Test, NPI 0000000000) we are already working.",
    });
  });

  it("⚠️ a summary that leads with identity → the LAST sentence that states a verdict", () => {
    expect(dupCheckSummary(LEADS_WITH_IDENTITY)!.sentence).toMatch(/^The referral is for CGM.*treat this as populating/);
  });

  it("a different-serving line wins outright", () => {
    expect(dupCheckSummary(DIFFERENT_SERVING)).toEqual({
      label: "New order — different serving",
      sentence:
        "This referral is for CGM (Dexcom G7), not the Insulin Pump (Mobi) we already supply — treat it as a NEW CGM order for an existing patient, not a duplicate to close.",
    });
  });

  it("reads the NEWEST write-up, and stops at a rep's note appended after it", () => {
    const notes = `${DIFFERENT_SERVING}\n${LEADS_WITH_VERDICT}\n[Sep 25, 2026, 4:23 PM] Profile Send-Off: called, left VM —MT`;
    expect(dupCheckSummary(notes)!.label).toBe("Duplicate — updated info");
    expect(dupCheckSummary(notes)!.sentence).not.toMatch(/left VM/);
  });

  it("no write-up → null; a write-up with no summary → the label and no sentence", () => {
    expect(dupCheckSummary("[Sep 25, 2026, 4:23 PM] Profile Send-Off: called —MT")).toBeNull();
    expect(dupCheckSummary("")).toBeNull();
    expect(dupCheckSummary("[9/1/2026, 9:00 AM] Duplicate Check: Needs review\n—Claude")).toEqual({
      label: "Needs review",
      sentence: "",
    });
  });

  it("caps a long sentence at a word, with an ellipsis", () => {
    const long = `[9/1/2026, 9:00 AM] Duplicate Check: Duplicate\nRecommended: Close it.\nThis is a duplicate ${"of a very long record ".repeat(20)}end.\n—Claude`;
    const s = dupCheckSummary(long)!.sentence;
    expect(s.length).toBeLessThanOrEqual(220);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("splitSentences", () => {
  it("never breaks on Dr., a page number, an initial or a list number", () => {
    expect(splitSentences("Signed by Dr. Test on p. 4 for Pat M. Example. Then group 2. Medical review. Done.")).toEqual([
      "Signed by Dr. Test on p. 4 for Pat M. Example.",
      "Then group 2. Medical review.",
      "Done.",
    ]);
  });
  it("keeps a closing quote with its sentence", () => {
    expect(splitSentences('It said "Fidelis." Then it stopped.')).toEqual(['It said "Fidelis."', "Then it stopped."]);
  });
});

describe("inSystemHover — never blank", () => {
  it("label and sentence when there is a write-up", () => {
    expect(inSystemHover(DIFFERENT_SERVING)).toMatch(/^New order — different serving: This referral is for CGM/);
  });
  it("a verdict with no write-up (a partial lead) says what the verdict means", () => {
    expect(inSystemHover("", "Duplicate")).toMatch(/^Duplicate check: Duplicate\./);
  });
  it("notes not read yet → the caller's fallback, never 'no write-up'", () => {
    expect(inSystemHover(undefined, "Duplicate", "The duplicate check matched this person")).toBe(
      "The duplicate check matched this person",
    );
  });
  it("nothing at all → where to look", () => {
    expect(inSystemHover("", "")).toMatch(/See Profile Send Off Notes/);
  });
});
