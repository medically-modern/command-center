import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The fax requirement is on BOTH routes to Advance to MN, and the banner that
 * announces it reads the same rule — scanned, because the defect this closes
 * was not a wrong file, it was a rule present on one page and absent on the
 * other while a shared component claimed it on both.
 *
 * `tsc` was happy throughout: `ProfilePage` had its own inline
 * `clinicalsMethod === "Fax"` check, `UnverifiedReferralsPage` had nothing, and
 * `DoctorSection` had a third copy inside the banner whose own text ends "it
 * blocks send-off". On the intake page that sentence was false.
 *
 * The `phoneSlotsSource.test.ts` / `secondaryAnswerSource.test.ts` convention.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const PROFILE = read("../../pages/ProfilePage.tsx");
const INTAKE = read("../../pages/UnverifiedReferralsPage.tsx");
const DOCTOR = read("../../components/profile/DoctorSection.tsx");

describe("both send-off routes require the fax", () => {
  it("ProfilePage's checklist reads the shared rule", () => {
    expect(PROFILE).toMatch(/faxMethodChosen\(selected\)/);
    expect(PROFILE).toMatch(/hasDoctorFax\(selected\)/);
    expect(PROFILE).toMatch(/DOCTOR_FAX_ROW_LABEL/);
  });

  it("the intake page's checklist reads it too — this is the row that was missing", () => {
    expect(INTAKE).toMatch(/faxMethodChosen\(selected\)/);
    expect(INTAKE).toMatch(/hasDoctorFax\(selected\)/);
    expect(INTAKE).toMatch(/DOCTOR_FAX_ROW_LABEL/);
  });

  it("DoctorSection's banner reads it as well, so its claim is true on both pages", () => {
    expect(DOCTOR).toMatch(/doctorFaxGap\(pt\)/);
    // The banner still says it blocks send-off — that sentence is what the two
    // checklist rows above make honest.
    expect(DOCTOR).toMatch(/blocks send-off/);
  });

  it("the banner distinguishes blank from malformed", () => {
    /* "Add a fax" is wrong for a field already holding `smweissoffice@gmail.com`
       (a live row): a rep sees a filled box and a message asking them to fill
       it, and concludes the page is broken. */
    expect(DOCTOR).toMatch(/faxGap === "blank"/);
    expect(DOCTOR).toMatch(/isn.t a fax address/);
  });
});

describe("the requirement is the rcfax SHAPE, not merely a non-empty box", () => {
  const RULE = read("./doctorFaxRequired.ts");
  const FAX = read("../shared/faxAddress.ts");

  it("hasDoctorFax defers to the one shape test", () => {
    // Josh, 2026-09-17: "@rcfax.com address, is what needs to be required if
    // doctor is a fax doctor". A second copy of the shape here would drift from
    // the normalizer that produces these values — so the rule file may DISCUSS
    // rcfax (its header explains why the shape is checked at all) and must not
    // IMPLEMENT it. Comments are stripped before asserting that.
    expect(RULE).toMatch(/isFaxAddress\(p\.doctorFax/);
    const code = RULE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/rcfax/i);
    expect(code).not.toMatch(/RCFAX_SUFFIX/);
  });

  it("the shape test lives beside toFaxAddress / splitFaxAddress", () => {
    expect(FAX).toMatch(/export function isFaxAddress/);
  });

  it("⚠️ the suffix match stays case-insensitive", () => {
    // `3367130547@RCFAX.com` is live and deliverable; refusing it would block a
    // working fax, the one direction this check must never fail in.
    expect(FAX).toMatch(/isFaxAddress[\s\S]{0,400}toLowerCase\(\)/);
  });
});

describe("nobody re-inlines the condition", () => {
  const inline = /clinicalsMethod\s*===\s*["']Fax["']/;

  it("not on either page", () => {
    expect(PROFILE).not.toMatch(inline);
    expect(INTAKE).not.toMatch(inline);
  });

  it("not in the banner", () => {
    expect(DOCTOR).not.toMatch(inline);
  });
});

describe("the gate is what Advance actually reads", () => {
  it("ProfilePage's Advance is disabled on the checklist", () => {
    // `canSubmit = missing.length === 0`, and the button takes `!p.canSubmit`.
    expect(PROFILE).toMatch(/canSubmit\s*=\s*missing\.length\s*===\s*0/);
    expect(PROFILE).toMatch(/disabled=\{!p\.canSubmit/);
  });

  it("the intake page's Advance is disabled on the same count", () => {
    // A row added to `readiness` only blocks because canAdvance reads
    // readyMissing; if that ever stops being true the row becomes decoration.
    expect(INTAKE).toMatch(/readyMissing\s*=\s*readiness\.filter\(\(i\)\s*=>\s*!i\.ok\)\.length/);
    expect(INTAKE).toMatch(/canAdvance\s*=\s*unlock\.unlocked\s*&&\s*readyMissing\s*===\s*0/);
  });
});
