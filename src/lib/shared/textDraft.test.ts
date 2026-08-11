import { describe, it, expect } from "vitest";
import { draftOnOpen, draftAfterClose } from "./textDraft";

const CGM = "Hi Tee, here's a link to upload your CGM data: https://x/u/abc";
const INSURANCE = "Hi Tee, it's the team at Medically Modern! We're working on your benefits…";

describe("draftOnOpen", () => {
  it("seeds an empty box with the template", () => {
    expect(draftOnOpen("", CGM)).toBe(CGM);
  });

  it("leaves the box alone when there is no template", () => {
    // The plain Text button beside the patient's name opens an empty composer —
    // a rep texting about something else shouldn't have to clear a template.
    expect(draftOnOpen("", undefined)).toBe("");
    expect(draftOnOpen("half a sentence", undefined)).toBe("half a sentence");
  });

  it("never overwrites what the rep typed", () => {
    expect(draftOnOpen("Hi Tee, calling about your pump", CGM)).toBe("Hi Tee, calling about your pump");
  });
});

describe("draftAfterClose", () => {
  it("throws away a template the rep never touched", () => {
    expect(draftAfterClose(CGM, CGM)).toBe("");
  });

  it("keeps words the rep typed", () => {
    // Radix closes on outside click and Esc. Eating a half-written message
    // because the rep clicked past the dialog would be the worse bug.
    expect(draftAfterClose("Hi Tee, quick question —", CGM)).toBe("Hi Tee, quick question —");
  });

  it("keeps an EDITED template — it stopped being ours the moment they typed", () => {
    expect(draftAfterClose(`${CGM} — call me after!`, CGM)).toBe(`${CGM} — call me after!`);
  });

  it("is a no-op when we never seeded anything", () => {
    expect(draftAfterClose("typed from scratch", null)).toBe("typed from scratch");
    expect(draftAfterClose("", null)).toBe("");
  });
});

describe("the bug this pair exists to prevent", () => {
  it("a second template replaces the first one, once the box has been closed", () => {
    // The exact sequence Josh hit: Generate CGM data link → close without
    // sending → Start Insurance Follow-Up. Before the close rule, step 3 showed
    // the CGM text, because the box was no longer empty for it to land in.
    let msg = "";
    let seeded: string | null = null;

    msg = draftOnOpen(msg, CGM); seeded = CGM;
    expect(msg).toBe(CGM);

    msg = draftAfterClose(msg, seeded); seeded = null;
    expect(msg).toBe("");

    msg = draftOnOpen(msg, INSURANCE); seeded = INSURANCE;
    expect(msg).toBe(INSURANCE);
  });

  it("fails the same way again if the close rule is dropped", () => {
    // Pin the CAUSE, not just the symptom: seeding alone cannot fix this.
    let msg = draftOnOpen("", CGM);
    msg = draftOnOpen(msg, INSURANCE); // no close in between
    expect(msg).toBe(CGM); // still the first template — this is the old behaviour
  });
});
