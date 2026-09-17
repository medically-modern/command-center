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
    expect(DOCTOR).toMatch(/doctorFaxMissing\(pt\)/);
    // The banner still says it blocks send-off — that sentence is what the two
    // checklist rows above make honest.
    expect(DOCTOR).toMatch(/blocks send-off/);
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
