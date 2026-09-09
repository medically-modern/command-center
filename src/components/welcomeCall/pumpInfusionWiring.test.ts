/**
 * The Welcome Call form actually USES the order rules — a source scan.
 *
 * ⚠️ This is the `listColumns.test.ts` convention, and it exists because of a
 * real review finding: `infusionSelection`, `infusionStock` and `sendGates`
 * shipped written and TESTED but never called, so every one of their rules
 * passed in CI while production kept using the raw board options. A module
 * nobody calls does not fail — it is simply absent, and its green tests say
 * otherwise. Greptile held PR #55 open on exactly that.
 *
 * So the assertion is about the CALL SITES, not the rules (those have their own
 * suites). A cleanup that "simplifies" the form back to `liveOptions[...]`, or
 * drops the send gate, fails here rather than quietly reverting the feature.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const form = readFileSync(
  join(process.cwd(), "src/components/welcomeCall/WelcomeCallForm.tsx"),
  "utf8",
);
const page = readFileSync(
  join(process.cwd(), "src/pages/WelcomeCallPage.tsx"),
  "utf8",
);

describe("infusion selection is wired into the form", () => {
  it("filters both set lists by pump compatibility", () => {
    expect(form).toContain("compatibleSetOptions(patient.pumpType, rawSet1Options");
    expect(form).toContain("compatibleSetOptions(patient.pumpType, rawSet2Options");
  });

  it("excludes each slot's partner so Set 2 cannot repeat Set 1", () => {
    expect(form).toContain("{ exclude: patient.infusionSet2 }");
    expect(form).toContain("{ exclude: patient.infusionSet1 }");
  });

  /* Without this a filter can blank a control the board says has a value. */
  it("re-admits whatever the board actually holds", () => {
    expect(form.match(/withCurrentSelection\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("clears sets a pump CHANGE invalidated, quantity included", () => {
    expect(form).toContain("setsInvalidatedByPump(");
    // The quantity must go with the set — a quantity attached to no set is the
    // §5.12 shape where a counter and its columns disagree.
    expect(form).toContain('onFieldChange("qtyInf1", "")');
    expect(form).toContain('onFieldChange("qtyInf2", "")');
  });

  it("reads the two quantities against the order total", () => {
    expect(form).toContain("infusionQtyPlan({");
    expect(form).toContain("orderTotal: DEFAULT_INFUSION_QTY");
  });
});

describe("stock is read once and rendered per set", () => {
  it("uses the shared hook, never a fetch per set", () => {
    expect(form).toContain("useInfusionStock()");
    // A per-slot or per-render fetch is INCIDENT_2026-08-20's shape.
    expect(form).not.toContain("fetchInfusionStock(");
  });

  it("renders a verdict for both slots", () => {
    expect(form.match(/stockVerdict\(patient\.infusionSet[12],/g)?.length).toBe(2);
  });

  /* Display only. Brandon asked to SHOW stock; refusing an order on it is a
     separate decision nobody has made, so `blocked` must not reach the gate. */
  it("does not gate the send on stock", () => {
    expect(page).not.toContain("blocked");
  });
});

describe("the send gate is wired to the button it explains", () => {
  it("computes the unmet requirements", () => {
    expect(page).toContain("unmetSendRequirements({");
  });

  it("disables Send and lists the reasons from ONE source", () => {
    // A disabled control with no stated reason is what reps report as broken,
    // so the same array must do both jobs.
    expect(page).toContain("sendGaps.length > 0");
    expect(page).toContain("...sendGaps.map((g) => g.label)");
  });

  /* Brandon: hide it and don't require it when a pump device isn't served.
     `servingIncludesPump` is TRUE for "Supplies" — using it here would demand a
     pump confirmation from a patient who already owns theirs (§5.22). */
  it("scopes the pump confirmation to a served pump DEVICE", () => {
    expect(form).toContain("needsPumpConfirmation(effectiveServing)");
    expect(form).not.toContain("servingIncludesPump(effectiveServing) && intake.confirmed");
  });
});
