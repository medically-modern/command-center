import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The prefill's two safety rules live in different files from the rule module,
 * and `tsc` is happy either way — so they are scanned. The
 * `phoneSlotsSource.test.ts` convention.
 *
 * 1. Pre-selecting must never WRITE. `pickProfile` calls `onUpdate`, which
 *    patches the patient from the Doctor DB — §5.20's hazard, where Select
 *    Correct Provider overwrites the doctor the referral actually named. An
 *    automatic `pickProfile` would do that on every page open.
 * 2. The pane must reset per patient. Its search, picked profile and that
 *    profile's Doctor DB notes were plain `useState` with nothing keyed on the
 *    patient, and neither caller passed a `key` — so a sidebar click left the
 *    previous patient's doctor on screen, with "Save to Doctor DB" live
 *    against their DB item.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const DOCTOR = read("./DoctorSection.tsx");
const PROFILE = read("../../pages/ProfilePage.tsx");
const INTAKE = read("../../pages/UnverifiedReferralsPage.tsx");

/** The prefill effect's body — the region that must stay write-free. */
const prefillEffect = (() => {
  const start = DOCTOR.indexOf("if (prefilledForRef.current === pt.id) return;");
  expect(start).toBeGreaterThan(-1);
  const end = DOCTOR.indexOf("}, [pt.id]);", start);
  expect(end).toBeGreaterThan(start);
  return DOCTOR.slice(start, end);
})();

describe("the prefill selects but never writes", () => {
  it("⚠️ the effect never calls onUpdate or pickProfile", () => {
    expect(prefillEffect).not.toMatch(/onUpdate\s*\(/);
    expect(prefillEffect).not.toMatch(/pickProfile\s*\(/);
    expect(prefillEffect).not.toMatch(/onClinicSelect\s*\(/);
  });

  it("the rep's own click is still what copies DB values onto the patient", () => {
    // pickProfile keeps its onUpdate — removing it would break the real flow.
    expect(DOCTOR).toMatch(/const pickProfile[\s\S]{0,900}onUpdate\(\{/);
    expect(DOCTOR).toMatch(/onClick=\{\(\) => pickProfile\(r\)\}/);
  });

  it("it reads the shared rules rather than re-deriving them", () => {
    expect(prefillEffect).toMatch(/prefillNpi\(pt\)/);
    expect(prefillEffect).toMatch(/prefillSelection\(recs, npi\)/);
    expect(prefillEffect).toMatch(/prefillLocation\(recs, key\)/);
  });
});

describe("the pane is per patient", () => {
  it("both callers key it on the patient", () => {
    expect(PROFILE).toMatch(/<DoctorSection key=\{pt\.id\}/);
    expect(INTAKE).toMatch(/<DoctorSection\s*\n\s*key=\{selected\.id\}/);
  });

  it("and the effect resets the previous patient's state itself", () => {
    // Belt and braces: correct even if a future caller drops the key.
    for (const reset of [
      "setSelectedKey(null)",
      "setSelectedItemId(null)",
      'setNotes("")',
      "setFollowers([])",
      "setCount(null)",
    ]) {
      expect(prefillEffect).toContain(reset);
    }
  });

  it("a slow lookup can't paint an earlier patient's doctor onto a later one", () => {
    expect(prefillEffect).toMatch(/prefilledForRef\.current !== pt\.id/);
  });
});

describe("the lookup obeys the incident rules", () => {
  it("is cached per NPI at module scope, not re-asked per render", () => {
    expect(DOCTOR).toMatch(/const prefillCache = new Map<string, DoctorRecord\[\]>\(\)/);
    expect(prefillEffect).toMatch(/prefillCache\.get\(npi\)/);
    expect(prefillEffect).toMatch(/prefillCache\.set\(npi, recs\)/);
  });

  it("⚠️ does NOT cache a failure — re-opening the patient retries", () => {
    // A cached failure pins the pane blank for the session with nothing
    // erroring (§5.28's fetchDirectoryNames lesson).
    const catchArm = prefillEffect.slice(prefillEffect.indexOf(".catch("));
    expect(catchArm).not.toMatch(/prefillCache\.set/);
  });

  it("runs on patient change only — never on a timer", () => {
    expect(prefillEffect).not.toMatch(/setInterval|setTimeout/);
  });

  it("⚠️ depends on the patient ID alone, never on the patient object", () => {
    // `pt` is rebuilt on every keystroke by the page's overlay, so depending on
    // it would reset the doctor pane while the rep types — the incident's rule 2
    // with a state reset attached.
    expect(DOCTOR).toMatch(/\}, \[pt\.id\]\);/);
    expect(DOCTOR).not.toMatch(/\}, \[pt\]\);/);
  });
});
