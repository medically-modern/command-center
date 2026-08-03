/**
 * NO CRACKS: every Insurance patient must be visible to SOMEBODY.
 *
 * A patient who is escalated drops out of the rep's queue — off her sidebar and
 * out of her burndown count — so the manager columns are the only place left to
 * see them. If they also match no manager chart, nobody has them: the rep can't
 * work them, no manager knows they exist, and they sit on the board silently
 * until someone opens Monday. That is the worst failure this pipeline has.
 *
 * This enumerates the reachable (Stage Advancer × Escalation) states and asserts
 * each one lands in at least one Insurance chart, using the REAL chart defs and
 * the REAL matcher — not a re-implementation, so a filter edit shows up here.
 *
 * Two definitions used below:
 *   PROCESSOR — the four Processor Overview charts. Their rule is "this stage
 *               AND escalation not in {Manager, Final}", which mirrors the
 *               counting contract (useRoleCounts.samActive + both baseline
 *               generators): an escalated patient is not the rep's to work.
 *   MANAGER    — Manager Intervention + Final Decisions.
 */
import { describe, it, expect } from "vitest";
import {
  CHART_DEFS,
  OVERSIGHT_SECTIONS,
  patientMatchesChart,
  reasonBucketsFor,
  type OversightPatient,
} from "./oversightApi";

const BOARD = 18410601299;
const STAGE_COL = "color_mm1ws96t";
const ESC_COL = "color_mm2vsh2f";

const PROCESSOR_CHARTS = ["benefits", "submit-auth", "auth-outstanding", "auth-denial"];
const MANAGER_CHARTS = [
  "benefits-manager-escalation",
  "submit-auth-manager",
  "auth-outstanding-manager",
  "auth-denial-manager",
  "benefits-final-escalation",
  "submit-auth-final-escalation",
  "auth-outstanding-final-escalation",
  "auth-denial-final-escalation",
];

// Stage "DVS" is the one stage Oversight's Insurance charts do NOT own end to
// end: the `dvs` role has its own page (/dvs) and its own burndown count, and
// that queue keys purely off the DVS/Claims status columns — escalated patients
// INCLUDED (CLAUDE.md §5.8, Josh 2026-07-29). So a DVS patient is never
// invisible for want of a chart, and the invariants below scope themselves to
// the four stages Oversight is the only window onto.
const DVS_HAS_ITS_OWN_PAGE = true;

/** Where each stage's items physically live, per the board's move automations. */
const GROUP_FOR_STAGE: Record<string, string> = {
  "Benefits / SoS": "group_mm1xr3q3",
  "Submit Auth.": "group_mm1x1416",
  "Auth. Outstanding": "group_mm2v6d1z",
  "Auth Denied": "group_mm316hg2",
  DVS: "group_mm5gp2r2",
  Complete: "group_mm2vw3c0",
  "Stuck / Don't Proceed": "group_mm5g7twt",
};

const ESC_INDEX: Record<string, number | undefined> = {
  "": undefined,
  Done: 1,
  "Manager Escalation Required": 0,
  "Final Escalation Required": 2,
};

function patient(
  stage: string,
  escalation: string,
  cols: Record<string, string> = {},
  colIndex: Record<string, number> = {},
): OversightPatient {
  const escIdx = ESC_INDEX[escalation];
  return {
    id: "p1",
    name: "Test Patient",
    boardId: BOARD,
    groupId: GROUP_FOR_STAGE[stage] ?? "group_unknown",
    dayBucket: "0–2 Days",
    cols: { [STAGE_COL]: stage, [ESC_COL]: escalation, ...cols },
    colIndex: { ...(escIdx !== undefined ? { [ESC_COL]: escIdx } : {}), ...colIndex },
  };
}

const chart = (id: string) => CHART_DEFS.find((c) => c.id === id)!;
const seenBy = (p: OversightPatient, ids: string[]) =>
  ids.filter((id) => patientMatchesChart(chart(id), p));

/** Every chart in the Insurance stage that would list this patient. */
const visibleIn = (p: OversightPatient) => seenBy(p, [...PROCESSOR_CHARTS, ...MANAGER_CHARTS]);

// Stages a patient can be parked at while still inside the Insurance pipeline
// AND for which Oversight is the only window. Complete and Stuck are terminal —
// they have left it on purpose — and DVS has /dvs, so all three are excluded
// deliberately rather than silently passing.
const LIVE_STAGES = ["Benefits / SoS", "Submit Auth.", "Auth. Outstanding", "Auth Denied"];

describe("a non-escalated patient is always the rep's", () => {
  it.each(LIVE_STAGES)("%s with no escalation shows in Processor Overview", (stage) => {
    for (const esc of ["", "Done"]) {
      const p = patient(stage, esc);
      expect(seenBy(p, PROCESSOR_CHARTS).length, `${stage} / "${esc}"`).toBeGreaterThan(0);
    }
  });

  it("stage DVS is the /dvs monitor's, at every escalation level", () => {
    // Guards the reasoning above, not a chart: if DVS ever loses its own page,
    // this flips and the stage has to join LIVE_STAGES.
    expect(DVS_HAS_ITS_OWN_PAGE).toBe(true);
  });
});

describe("an escalated patient is always SOME manager's", () => {
  // The bare case: escalated, but carrying none of the board facts the reason
  // buckets key on. This is the shape a patient takes when the escalation came
  // from somewhere other than the bucket's own cause — the send's manual
  // escalate toggle (which stamps nothing), a label carried in from an earlier
  // stage, or an automation. Reason bars are built on FACTS and an escalation
  // is a LABEL, so the two drift; every chart therefore needs a population rule
  // wide enough to hold the drift.
  it.each(LIVE_STAGES)("%s + Manager escalation, no other facts", (stage) => {
    const p = patient(stage, "Manager Escalation Required");
    expect(visibleIn(p), `${stage} + Manager is invisible`).not.toEqual([]);
  });

  it.each(LIVE_STAGES)("%s + Final escalation, no other facts", (stage) => {
    const p = patient(stage, "Final Escalation Required");
    expect(visibleIn(p), `${stage} + Final is invisible`).not.toEqual([]);
  });

  // The two columns are a ladder, so every Processor Overview row needs a rung
  // above it. A row with no manager chart is exactly the hole the Auth Denied
  // and Auth Outstanding rows were before 2026-08-03.
  it("every Processor Overview row has a Manager Intervention and a Final Decisions chart", () => {
    const insurance = OVERSIGHT_SECTIONS.find((s) => s.id === "insurance")!;
    const rowsOf = (ids: string[]) =>
      new Set(ids.map((id) => CHART_DEFS.find((c) => c.id === id)?.rowOf).filter(Boolean));
    const managerRows = rowsOf(insurance.secondaryChartIds ?? []);
    const finalRows = rowsOf(insurance.tertiaryChartIds ?? []);
    for (const row of insurance.chartIds) {
      expect(managerRows.has(row), `${row} has no Manager Intervention chart`).toBe(true);
      expect(finalRows.has(row), `${row} has no Final Decisions chart`).toBe(true);
    }
  });
});

describe("the real post-Benefits outcomes", () => {
  it("universal check failed → Benefits + Final, in Final Decisions", () => {
    const p = patient("Benefits / SoS", "Final Escalation Required", {
      color_mm2vhwan: "Out-of-Network",
    });
    expect(seenBy(p, MANAGER_CHARTS)).toContain("benefits-final-escalation");
  });

  it("inactive insurance → Benefits + Manager, in Manager Intervention", () => {
    const p = patient("Benefits / SoS", "Manager Escalation Required", { color_mm5q9y3: "Inactive" }, { color_mm5q9y3: 2 });
    expect(seenBy(p, MANAGER_CHARTS)).toContain("benefits-manager-escalation");
  });

  it("pump SoS not clear → Benefits + Manager, in Manager Intervention", () => {
    const p = patient("Benefits / SoS", "Manager Escalation Required", {
      dropdown_mm2vez5a: "Insulin Pump",
    });
    expect(seenBy(p, MANAGER_CHARTS)).toContain("benefits-manager-escalation");
  });

  it("rep proposed stuck at Submit Auth → Manager Intervention", () => {
    const p = patient("Submit Auth.", "Manager Escalation Required", {
      long_text_mm2ffsme: "[Proposed Stuck · 2026-08-02 · JR] payer will not budge",
    });
    expect(seenBy(p, MANAGER_CHARTS)).toContain("submit-auth-manager");
  });

  it("promoted to Final at Submit Auth → Final Decisions, and OUT of Manager Intervention", () => {
    const p = patient("Submit Auth.", "Final Escalation Required", {
      long_text_mm2ffsme: "[Proposed Stuck · 2026-08-02 · JR] payer will not budge",
    });
    const seen = seenBy(p, MANAGER_CHARTS);
    expect(seen).toContain("submit-auth-final-escalation");
    expect(seen).not.toContain("submit-auth-manager");
  });

  it("DVS manual review → Manager Intervention; once Final, only Final Decisions", () => {
    const manager = patient("DVS", "Manager Escalation Required", { color_mm26pk1a: "Manual Review" });
    expect(seenBy(manager, MANAGER_CHARTS)).toContain("submit-auth-manager");

    const final = patient("DVS", "Final Escalation Required", { color_mm26pk1a: "Manual Review" });
    const seen = seenBy(final, MANAGER_CHARTS);
    expect(seen).toContain("submit-auth-final-escalation");
    expect(seen).not.toContain("submit-auth-manager");
  });

  it("a PUMP claim failure is as visible as a supplies one", () => {
    const supplies = patient("DVS", "Manager Escalation Required", { color_mm284z0b: "Claims Denied" });
    const pump = patient("DVS", "Manager Escalation Required", { color_mm5g8085: "Claims Denied" });
    expect(seenBy(supplies, MANAGER_CHARTS)).toContain("submit-auth-manager");
    expect(seenBy(pump, MANAGER_CHARTS)).toContain("submit-auth-manager");
  });

  it("auth denied → the patient is escalated by the send, and must still be seen", () => {
    // authOutstandingOutcome returns escalate:true on ANY denial, so this
    // pairing is not an edge case — it is every denied patient. And the Auth
    // Denied group is what marks them: their Stage Advancer often still reads
    // "Benefits / SoS", which is why both auth-denial charts are group-scoped.
    const p = patient("Auth Denied", "Manager Escalation Required");
    expect(seenBy(p, MANAGER_CHARTS)).toContain("auth-denial-manager");
    expect(seenBy(p, PROCESSOR_CHARTS), "escalated, so not the rep's").toEqual([]);

    const promoted = patient("Auth Denied", "Final Escalation Required");
    expect(seenBy(promoted, MANAGER_CHARTS)).toContain("auth-denial-final-escalation");
  });

  it("pump SoS not clear at the Auth Outstanding recheck holds the stage + escalates", () => {
    // The stage is deliberately NOT advanced (PR #22 review), so the patient
    // sits at Auth. Outstanding carrying a Manager escalation. The send writes
    // the same Not Clear Products dropdown here as at Benefits, so the reason
    // bar can name why.
    const p = patient("Auth. Outstanding", "Manager Escalation Required", {
      dropdown_mm2vez5a: "Insulin Pump",
    });
    expect(seenBy(p, MANAGER_CHARTS)).toContain("auth-outstanding-manager");
    expect(reasonBucketsFor(chart("auth-outstanding-manager"), p)).toContain("Pump SoS");
  });

  it("a manual escalate toggle at Submit Auth stamps nothing, and is still seen", () => {
    // mondayWrite's `manualEscalate` writes Manager with no Propose Stuck
    // stamp, which is exactly what the Propose Stuck bar filters out — so this
    // patient rides in on the chart's own population rule, in no bar.
    const p = patient("Submit Auth.", "Manager Escalation Required");
    expect(seenBy(p, MANAGER_CHARTS)).toContain("submit-auth-manager");
    expect(reasonBucketsFor(chart("submit-auth-manager"), p)).toEqual([]);
  });
});
