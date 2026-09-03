import { describe, it, expect } from "vitest";
import { deriveValidity, computeCgmInvalidReasons, cgmLanguageMissingLabel } from "./evalState";
import type { EvalState } from "./evalState";
import type { Patient } from "./workflow";

/**
 * CGM language blocks Medical Necessity (Josh, 2026-09-03).
 *
 * `deriveValidity` is what the Evaluate banner renders AND what routes the send
 * (`validity.established` → "Completed" vs "Send Request"). Its CGM section
 * checked the script and the coverage path and then stopped, so a patient whose
 * records carried no insulin or hypoglycemia language read "Medical Necessity
 * Established" and skipped Send Request. The IP side always checked every one
 * of its requirements — which is exactly why the bug was CGM-only.
 */

/** A patient whose every non-CGM input is already satisfied, so each assertion
 *  below turns on the CGM language answer alone. */
const patient = { primaryInsurance: "Aetna" } as unknown as Patient;

function state(over: Partial<EvalState> = {}): EvalState {
  return {
    // CGM: script received and valid, on a language-bearing path.
    cgmScriptReceived: "Yes",
    cgmScriptValid: "Valid",
    cgmCoveragePath: "Insulin",
    cgmLanguage: "Yes",
    // Everything else MN needs.
    diagnosis: "E11.65",
    mrReceived: "Yes",
    lastVisitDate: new Date().toISOString().slice(0, 10),
    ...over,
  } as EvalState;
}

const validity = (over: Partial<EvalState> = {}) =>
  deriveValidity(state(over), patient, true, false);

describe("CGM language and Medical Necessity", () => {
  it("establishes MN when the language is present — the baseline still passes", () => {
    expect(validity().established).toBe(true);
  });

  it.each([
    ["Insulin" as const, "Insulin Language Missing"],
    ["Hypo" as const, "Hypoglycemia Language Missing"],
  ])("a %s path with language No is NOT established", (path, label) => {
    const v = validity({ cgmCoveragePath: path, cgmLanguage: "No" });
    expect(v.established).toBe(false);
    expect(v.cgmReasons).toContain(label);
  });

  it("an UNANSWERED language is not established either", () => {
    // MN cannot rest on a question nobody answered — the same test every IP
    // requirement uses.
    const v = validity({ cgmLanguage: undefined });
    expect(v.established).toBe(false);
  });

  it("an Invalid language is not established, and says invalid rather than missing", () => {
    const v = validity({ cgmLanguage: "Invalid" });
    expect(v.established).toBe(false);
    expect(v.cgmReasons).toContain("CGM Language invalid");
    expect(v.cgmReasons).not.toContain("Insulin Language Missing");
  });

  it("does not ask for language on a path that has none", () => {
    // "Hypo Invalid" and "Missing" already fail on the path itself; the point
    // is that they fail for THAT reason and don't also grow a language row.
    for (const path of ["Hypo Invalid", "Missing"] as const) {
      const v = validity({ cgmCoveragePath: path, cgmLanguage: undefined });
      expect(v.cgmReasons).not.toContain("Insulin Language Missing");
      expect(v.cgmReasons).not.toContain("Hypoglycemia Language Missing");
    }
  });

  it("a Not Serving CGM never blocks on language", () => {
    const v = validity({ cgmCoveragePath: "Not Serving", cgmLanguage: undefined });
    expect(v.sections.cgm.shown).toBe(false);
    expect(v.established).toBe(true);
  });

  it("is silent when CGM isn't being evaluated at all", () => {
    const v = deriveValidity(state({ cgmLanguage: "No" }), patient, false, false);
    expect(v.established).toBe(true);
  });

  it("the board dropdown agrees with the banner", () => {
    // ⚠️ Two producers, one answer: `deriveValidity` drives the banner and the
    // Monday preview, `computeCgmInvalidReasons` writes the actual dropdown.
    // Before this fix a missing language failed neither.
    for (const path of ["Insulin", "Hypo"] as const) {
      const s = state({ cgmCoveragePath: path, cgmLanguage: "No" });
      expect(computeCgmInvalidReasons(s, true)).toContain(cgmLanguageMissingLabel(path));
      expect(deriveValidity(s, patient, true, false).cgmReasons)
        .toContain(cgmLanguageMissingLabel(path));
    }
  });

  it("uses the board's exact labels, capital M included", () => {
    // These strings go into dropdown_mm2xncfh. A mismatch does not error — it
    // creates a duplicate label (§5.6/§9). Verified live 2026-09-03.
    expect(cgmLanguageMissingLabel("Insulin")).toBe("Insulin Language Missing");
    expect(cgmLanguageMissingLabel("Hypo")).toBe("Hypoglycemia Language Missing");
  });
});
