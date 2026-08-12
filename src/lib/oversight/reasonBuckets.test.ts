/**
 * Reason-bucketed oversight charts (Katie/Brandon 2026-07-29) — the Insurance
 * manager-view redesign where the x-axis is one bar per REASON instead of the
 * day buckets:
 *
 *   - Benefits · Manager Intervention: Inactive insurance · Pump SoS ·
 *     Check outstanding >5d (union population — the bars ARE the chart).
 *   - Benefits · Final Decisions: Propose Stuck · Universal Check
 *     (categorize mode — population stays Escalation = Final).
 *   - Submit Auth · Manager Intervention (the merged DVS chart): DVS Retry ·
 *     DVS Manual Review · Propose Stuck.
 *
 * These tests go through patientMatchesChart / reasonBucketsFor — the exact
 * evaluation the fetch, the bars, the drill-down filter, and the __reasons__
 * column all share.
 */
import { describe, expect, it } from "vitest";
import {
  CHART_DEFS,
  patientMatchesChart,
  reasonBucketsFor,
  type ChartDef,
  type OversightPatient,
} from "./oversightApi";

const chart = (id: string): ChartDef => {
  const c = CHART_DEFS.find((c) => c.id === id);
  if (!c) throw new Error(`chart def missing: ${id}`);
  return c;
};

const INSURANCE = 18410601299;
const STAGE_COL = "color_mm1ws96t";
const ESC_COL = "color_mm2vsh2f";
const ACTIVE_COL = "color_mm5q9y3";
const INNET_COL = "color_mm2vhwan";
const DME_COL = "color_mm2vt8xg";
const DAYS_COL = "color_mm1wwm05";
const NOT_CLEAR_COL = "dropdown_mm2vez5a";
const NOTES_COL = "long_text_mm2ffsme";
const SUPPLIES_DVS_COL = "color_mm26pk1a";
const PUMP_DVS_COL = "color_mm578kbd";

function patient(
  cols: Record<string, string>,
  colIndex: Record<string, number> = {},
): OversightPatient {
  return {
    id: "1",
    name: "Test Patient",
    boardId: INSURANCE,
    groupId: "group_mm1xr3q3",
    dayBucket: "Unknown",
    cols,
    colIndex,
  };
}

const atBenefits = (
  cols: Record<string, string> = {},
  colIndex: Record<string, number> = {},
) => patient({ [STAGE_COL]: "Benefits / SoS", ...cols }, colIndex);

describe("Benefits · Manager Intervention (reason union)", () => {
  const c = chart("benefits-manager-escalation");

  it("is reason-bucketed with the three agreed bars", () => {
    expect(c.reasonBuckets?.map((b) => b.label)).toEqual([
      "Inactive insurance",
      "Pump SoS",
      "Check outstanding >5d",
    ]);
  });

  // Board automation 7921298383 (active, verified live): when Days changes to
  // "6–8 Days" at the Benefits stage, Escalation → Manager Escalation
  // Required. Declared up here because all three bars now take the label.
  const MGR = { [ESC_COL]: "Manager Escalation Required" };
  const MGR_IDX = { [ESC_COL]: 0 };

  it("Inactive insurance = Active? at index 2, at the Benefits stage, WITH the label", () => {
    const p = atBenefits({ ...MGR, [ACTIVE_COL]: "Inactive" }, { ...MGR_IDX, [ACTIVE_COL]: 2 });
    expect(patientMatchesChart(c, p)).toBe(true);
    expect(reasonBucketsFor(c, p)).toEqual(["Inactive insurance"]);
    // Active (index 1) or unanswered → not in the chart at all.
    expect(patientMatchesChart(c, atBenefits(MGR, { ...MGR_IDX, [ACTIVE_COL]: 1 }))).toBe(true); // label alone still counts
    expect(reasonBucketsFor(c, atBenefits(MGR, { ...MGR_IDX, [ACTIVE_COL]: 1 }))).toEqual([]);
    expect(patientMatchesChart(c, atBenefits())).toBe(false);
  });

  it("Pump SoS = Not Clear Products contains Insulin Pump — other products don't count", () => {
    const pump = atBenefits({ ...MGR, [NOT_CLEAR_COL]: "Insulin Pump, CGM Sensors" }, MGR_IDX);
    expect(reasonBucketsFor(c, pump)).toEqual(["Pump SoS"]);
    const sensorsOnly = atBenefits({ ...MGR, [NOT_CLEAR_COL]: "CGM Sensors" }, MGR_IDX);
    expect(reasonBucketsFor(c, sensorsOnly)).toEqual([]);
    // …and with no escalation at all, a Not Clear pump is not in this chart:
    // that patient is still the rep's, in Processor Overview.
    expect(patientMatchesChart(c, atBenefits({ [NOT_CLEAR_COL]: "Insulin Pump" }))).toBe(false);
  });

  // The bar = that label AND days ≥ 6–8 (Josh 2026-07-29).
  const MGR_ESC = MGR;

  it("Check outstanding >5d = Manager escalation AND Days at 6–8 or beyond", () => {
    for (const idx of [2, 3, 4, 6, 7, 8]) {
      expect(reasonBucketsFor(c, atBenefits(MGR_ESC, { [DAYS_COL]: idx }))).toEqual([
        "Check outstanding >5d",
      ]);
    }
    // The label alone isn't overdue (fresh patient escalated for another
    // reason)…
    expect(patientMatchesChart(c, atBenefits(MGR_ESC, { [DAYS_COL]: 0 }))).toBe(false);
    expect(patientMatchesChart(c, atBenefits(MGR_ESC, { [DAYS_COL]: 1 }))).toBe(false);
    // …and days alone aren't either: a manager clearing the escalation
    // (Return to Queue) removes the patient from the bar even though the
    // days keep climbing, and pre-automation patients were never flipped.
    expect(patientMatchesChart(c, atBenefits({}, { [DAYS_COL]: 3 }))).toBe(false);
    // A FINAL-escalated overdue patient belongs to Final Decisions, not here.
    expect(
      patientMatchesChart(c, atBenefits({ [ESC_COL]: "Final Escalation Required" }, { [DAYS_COL]: 3 })),
    ).toBe(false);
  });

  // Reversed 2026-08-12 (Brandon). The bars were board FACTS with no escalation
  // condition, which caught a patient whose label was missing — but a fact
  // outlives the escalation it caused, so a manager's Return to Queue handed
  // the patient back to the rep and left them on this bar anyway, uncleanable
  // and counted in two columns. All three facts already write the label (the
  // Benefits send for Inactive and pump SoS, automation 7921298383 for days),
  // so keying on it loses nothing: a fact set directly on the board without a
  // label leaves the patient in Processor Overview, visible and being worked.
  it("Inactive and Pump SoS require the escalation label — a fact alone is the REP's", () => {
    expect(patientMatchesChart(c, atBenefits({}, { [ACTIVE_COL]: 2 }))).toBe(false);
    expect(patientMatchesChart(c, atBenefits({ [NOT_CLEAR_COL]: "Insulin Pump" }))).toBe(false);
    // A manager clearing the escalation takes the row off the chart entirely —
    // the whole point: it is how they hand the patient back.
    const cleared = atBenefits({ [ESC_COL]: "Done", [NOT_CLEAR_COL]: "Insulin Pump" }, { [ESC_COL]: 1, [ACTIVE_COL]: 2 });
    expect(patientMatchesChart(c, cleared)).toBe(false);
  });

  it("a patient can be in several bars at once; a non-Benefits stage is never in the chart", () => {
    const multi = atBenefits(
      { ...MGR_ESC, [NOT_CLEAR_COL]: "Insulin Pump" },
      { ...MGR_IDX, [ACTIVE_COL]: 2, [DAYS_COL]: 3 },
    );
    expect(reasonBucketsFor(c, multi)).toEqual([
      "Inactive insurance",
      "Pump SoS",
      "Check outstanding >5d",
    ]);
    const wrongStage = patient(
      { [STAGE_COL]: "Auth. Outstanding" },
      { [ACTIVE_COL]: 2 },
    );
    expect(patientMatchesChart(c, wrongStage)).toBe(false);
  });
});

describe("Benefits · Final Decisions (categorize within Escalation = Final)", () => {
  const c = chart("benefits-final-escalation");
  const finalEsc = { [ESC_COL]: "Final Escalation Required" };

  it("population is the escalation label — a patient matching neither bar still counts", () => {
    const legacy = atBenefits(finalEsc);
    expect(patientMatchesChart(c, legacy)).toBe(true);
    expect(reasonBucketsFor(c, legacy)).toEqual([]);
  });

  it("Propose Stuck bar keys on the [Proposed Stuck note stamp", () => {
    const proposed = atBenefits({
      ...finalEsc,
      [NOTES_COL]: "[Benefits] called payer\n\n[Proposed Stuck · 2026-07-29 · JR] Payer unresponsive",
    });
    expect(reasonBucketsFor(c, proposed)).toEqual(["Propose Stuck"]);
  });

  it("Universal Check bar = OON / Medicare not Primary / DME Partial-No on the board", () => {
    expect(reasonBucketsFor(c, atBenefits({ ...finalEsc, [INNET_COL]: "Out-of-Network" }))).toEqual(
      ["Universal Check"],
    );
    expect(
      reasonBucketsFor(c, atBenefits({ ...finalEsc, [INNET_COL]: "Medicare not Primary" })),
    ).toEqual(["Universal Check"]);
    expect(reasonBucketsFor(c, atBenefits({ ...finalEsc, [DME_COL]: "Partial / No" }))).toEqual([
      "Universal Check",
    ]);
    // Inactive is NOT a Universal Check reason — it escalates to Manager
    // Intervention instead of Final Decisions.
    expect(reasonBucketsFor(c, atBenefits({ ...finalEsc, [ACTIVE_COL]: "Inactive" }))).toEqual([]);
  });

  it("a failed check without the Final escalation is not in this chart (it's not decided-ready)", () => {
    expect(patientMatchesChart(c, atBenefits({ [INNET_COL]: "Out-of-Network" }))).toBe(false);
  });

  it("a proposed patient whose check also failed shows in both bars", () => {
    const both = atBenefits({
      ...finalEsc,
      [INNET_COL]: "Out-of-Network",
      [NOTES_COL]: "[Proposed Stuck · 2026-07-29] rep gave up",
    });
    expect(reasonBucketsFor(c, both)).toEqual(["Propose Stuck", "Universal Check"]);
  });
});

describe("Submit Auth · Manager Intervention (merged DVS + proposals, union)", () => {
  const c = chart("submit-auth-manager");

  const atDvs = (cols: Record<string, string> = {}) =>
    patient({ [STAGE_COL]: "DVS", ...cols });
  const atSubmitAuth = (cols: Record<string, string> = {}) =>
    patient({ [STAGE_COL]: "Submit Auth.", ...cols });

  it("carries the three agreed bars and sits on the Submit Auth row", () => {
    expect(c.reasonBuckets?.map((b) => b.label)).toEqual([
      "DVS Retry",
      "DVS Manual Review",
      "Propose Stuck",
    ]);
    expect(c.rowOf).toBe("submit-auth");
    expect(c.decision).toBe("submit-auth-manager");
  });

  it("DVS Retry = stage DVS with a Retry Queued trigger status", () => {
    expect(reasonBucketsFor(c, atDvs({ [SUPPLIES_DVS_COL]: "Retry Queued" }))).toEqual([
      "DVS Retry",
    ]);
    expect(reasonBucketsFor(c, atDvs({ [PUMP_DVS_COL]: "Retry Queued" }))).toEqual(["DVS Retry"]);
    expect(patientMatchesChart(c, atDvs())).toBe(false);
  });

  it("DVS Manual Review = the failed-ish DVS statuses / claims failures — STATUS-ONLY", () => {
    expect(reasonBucketsFor(c, atDvs({ [SUPPLIES_DVS_COL]: "Manual Review" }))).toEqual([
      "DVS Manual Review",
    ]);
    expect(reasonBucketsFor(c, atDvs({ [PUMP_DVS_COL]: "Denied" }))).toEqual([
      "DVS Manual Review",
    ]);
    expect(reasonBucketsFor(c, atDvs({ "color_mm284z0b": "Claims Denied" }))).toEqual([
      "DVS Manual Review",
    ]);
    // An escalation label alone does NOT qualify (Josh 2026-07-29): no
    // automation flips DVS patients to a manager escalation, so a label
    // carried in from an earlier stage must not classify a patient as
    // manual review — the /dvs rail and this bar key purely off statuses.
    expect(
      patientMatchesChart(c, atDvs({ [ESC_COL]: "Manager Escalation Required" })),
    ).toBe(false);
  });

  it("Propose Stuck = Submit Auth stage + Manager escalation + the note stamp", () => {
    const proposed = atSubmitAuth({
      [ESC_COL]: "Manager Escalation Required",
      [NOTES_COL]: "[Proposed Stuck · 2026-07-29 · BE] Auth portal rejects the NPI",
    });
    expect(reasonBucketsFor(c, proposed)).toEqual(["Propose Stuck"]);
  });

  it("a manually-toggled Submit Auth escalation without the stamp stays OUT of the chart", () => {
    // The send's escalate toggle also writes Manager Escalation Required —
    // the stamp requirement is what keeps those out of the Propose Stuck bar.
    const toggled = atSubmitAuth({ [ESC_COL]: "Manager Escalation Required" });
    expect(patientMatchesChart(c, toggled)).toBe(false);
  });

  it("a FINAL-escalated Submit Auth proposal has left this chart (it's in Final Decisions now)", () => {
    const escalated = atSubmitAuth({
      [ESC_COL]: "Final Escalation Required",
      [NOTES_COL]: "[Proposed Stuck · 2026-07-29] x\n\n[Escalated to Final · 2026-07-29 · MGR] agreed",
    });
    expect(patientMatchesChart(c, escalated)).toBe(false);
    // …and it matches the Final Decisions chart for its stage.
    expect(patientMatchesChart(chart("submit-auth-final-escalation"), escalated)).toBe(true);
  });
});
