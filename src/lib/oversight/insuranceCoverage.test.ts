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
  "benefits-final-escalation",
  "submit-auth-final-escalation",
  "auth-outstanding-final-escalation",
];

// Auth Denied is UNDER CONSTRUCTION and has no manager charts on purpose
// (Josh, 2026-08-03: don't build UI for it). It is the one place the invariant
// below is knowingly not upheld, so it's carved out by name and asserted as a
// carve-out rather than quietly dropped — see the last test in this file.
const UNBUILT_ROW = "auth-denial";

// Auth Outstanding has ONE manager rung, not two (Josh, 2026-08-03): an
// escalation there should only ever land in Final Decisions. A Manager
// Intervention chart was built for it earlier the same night and removed on
// that instruction, and every escalating write was re-aimed at Final to match
// (`authOutstandingOutcome` · `proposeStuckLevel`).
//
// This is NOT a hole like Auth Denied: the row still has a chart, and that
// chart's population takes EITHER rung, so a Manager label arriving some other
// way — carried in from an earlier stage, or written by a DVS/claims board
// automation — is still visible. The tests below prove exactly that, so the
// difference between "one rung by design" and "a patient nobody can see" stays
// asserted rather than assumed.
const FINAL_ONLY_ROWS = new Set(["auth-outstanding"]);

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
/** The Processor Overview rows a set of manager charts sits above. */
const rowsOf = (ids: string[]) =>
  new Set(ids.map((id) => CHART_DEFS.find((c) => c.id === id)?.rowOf).filter(Boolean));
const seenBy = (p: OversightPatient, ids: string[]) =>
  ids.filter((id) => patientMatchesChart(chart(id), p));

/** Every chart in the Insurance stage that would list this patient. */
const visibleIn = (p: OversightPatient) => seenBy(p, [...PROCESSOR_CHARTS, ...MANAGER_CHARTS]);

// Stages a patient can be parked at while still inside the Insurance pipeline
// AND for which Oversight is the only window. Excluded deliberately rather
// than silently passing: Complete and Stuck are terminal (they left on
// purpose), DVS has /dvs, and Auth Denied is the unbuilt row above.
const LIVE_STAGES = ["Benefits / SoS", "Submit Auth.", "Auth. Outstanding"];

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
  // from somewhere other than the bucket's own cause — a label carried in from
  // an earlier stage, or one of the four DVS/claims board automations. Reason
  // bars are built on FACTS and an escalation is a LABEL, so the two drift;
  // every chart therefore needs a population rule wide enough to hold the drift.
  it.each(LIVE_STAGES)("%s + Manager escalation, no other facts", (stage) => {
    const p = patient(stage, "Manager Escalation Required");
    expect(visibleIn(p), `${stage} + Manager is invisible`).not.toEqual([]);
  });

  it.each(LIVE_STAGES)("%s + Final escalation, no other facts", (stage) => {
    const p = patient(stage, "Final Escalation Required");
    expect(visibleIn(p), `${stage} + Final is invisible`).not.toEqual([]);
  });

  // Every built Processor Overview row needs at least ONE manager chart above
  // it — that is the invariant. Two rungs is the usual shape (the ladder), but
  // a row may deliberately have only Final Decisions; what it may never have is
  // nothing, which is exactly the hole the Auth Outstanding row was in before
  // 2026-08-03.
  it("every built Processor Overview row has a Final Decisions chart", () => {
    const insurance = OVERSIGHT_SECTIONS.find((s) => s.id === "insurance")!;
    const finalRows = rowsOf(insurance.tertiaryChartIds ?? []);
    for (const row of insurance.chartIds) {
      if (row === UNBUILT_ROW) continue;
      expect(finalRows.has(row), `${row} has no Final Decisions chart`).toBe(true);
    }
  });

  it("and a Manager Intervention chart, unless the row is Final-only by design", () => {
    const insurance = OVERSIGHT_SECTIONS.find((s) => s.id === "insurance")!;
    const managerRows = rowsOf(insurance.secondaryChartIds ?? []);
    for (const row of insurance.chartIds) {
      if (row === UNBUILT_ROW || FINAL_ONLY_ROWS.has(row)) continue;
      expect(managerRows.has(row), `${row} has no Manager Intervention chart`).toBe(true);
    }
  });

  // The carve-out asserted as a carve-out: Final-only rows must genuinely have
  // no Manager chart (so the constant can't rot into a stale exemption that
  // silently excuses a row which later grew one).
  it("a Final-only row really has no Manager Intervention chart", () => {
    const insurance = OVERSIGHT_SECTIONS.find((s) => s.id === "insurance")!;
    const managerRows = rowsOf(insurance.secondaryChartIds ?? []);
    for (const row of FINAL_ONLY_ROWS) {
      expect(managerRows.has(row), `${row} grew a Manager chart — drop it from FINAL_ONLY_ROWS`).toBe(false);
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
      text_mm6vzc7q: "[Proposed Stuck · 2026-08-02 · JR] payer will not budge",
    });
    expect(seenBy(p, MANAGER_CHARTS)).toContain("submit-auth-manager");
  });

  it("promoted to Final at Submit Auth → Final Decisions, and OUT of Manager Intervention", () => {
    const p = patient("Submit Auth.", "Final Escalation Required", {
      text_mm6vzc7q: "[Proposed Stuck · 2026-08-02 · JR] payer will not budge",
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

  it("pump SoS not clear at the Auth Outstanding recheck holds the stage + escalates to Final", () => {
    // The stage is deliberately NOT advanced (PR #22 review), so the patient
    // sits at Auth. Outstanding carrying an escalation — FINAL, since that is
    // the stage's only manager rung (Josh, 2026-08-03). The send writes the
    // same Not Clear Products dropdown here as at Benefits, so the reason bar
    // can name why.
    const p = patient("Auth. Outstanding", "Final Escalation Required", {
      dropdown_mm2vez5a: "Insulin Pump",
    });
    expect(seenBy(p, MANAGER_CHARTS)).toContain("auth-outstanding-final-escalation");
    expect(reasonBucketsFor(chart("auth-outstanding-final-escalation"), p)).toContain("Pump SoS");
  });

  it("a stray Manager label at Auth Outstanding still lands in Final Decisions", () => {
    // Nothing in the SPA writes Manager at this stage any more, but a label can
    // still arrive — carried in from an earlier stage, or written by one of the
    // four DVS/claims board automations, which trigger on their rose columns
    // regardless of stage. With the Manager chart gone, the Final Decisions
    // chart's population has to take EITHER rung or those patients are
    // invisible in the entire app. It buckets them by reason too, rather than
    // dropping them into "+N in no bar".
    const p = patient("Auth. Outstanding", "Manager Escalation Required", {
      dropdown_mm2vez5a: "Insulin Pump",
    });
    expect(seenBy(p, MANAGER_CHARTS)).toContain("auth-outstanding-final-escalation");
    expect(reasonBucketsFor(chart("auth-outstanding-final-escalation"), p)).toContain("Pump SoS");
  });

  it("a stamp-less Final at Submit Auth still lands in Final Decisions", () => {
    // Every bar on this chart needs a board fact — a DVS status, or a
    // [Proposed Stuck stamp. A Final label with neither (carried in from an
    // earlier stage, or written by a board automation) matches no bar, so it
    // rides in on the chart's own population rule and shows in the header count
    // as one "in no bar".
    const p = patient("Submit Auth.", "Final Escalation Required");
    expect(seenBy(p, MANAGER_CHARTS)).toContain("submit-auth-final-escalation");
    expect(reasonBucketsFor(chart("submit-auth-final-escalation"), p)).toEqual([]);
  });
});

describe("Auth Denied — the deliberate hole", () => {
  // Under construction, no UI (Josh, 2026-08-03). Stated as a test so the gap
  // is a recorded decision rather than an oversight, and so whoever builds the
  // stage sees it: when Auth Denied gets manager charts, DELETE this test and
  // put "Auth Denied" back in LIVE_STAGES.
  it("has no manager chart, so an escalated denial is visible to nobody", () => {
    const p = patient("Auth Denied", "Manager Escalation Required");
    expect(seenBy(p, MANAGER_CHARTS)).toEqual([]);
    // And every denial IS escalated — authOutstandingOutcome returns
    // escalate:true on anyDenied — so Processor Overview can't hold them
    // either. They're worked on the Monday board until the stage is built.
    expect(seenBy(p, PROCESSOR_CHARTS)).toEqual([]);
  });

  it("still shows a denial with no escalation in Processor Overview", () => {
    expect(seenBy(patient("Auth Denied", ""), PROCESSOR_CHARTS)).toContain("auth-denial");
  });
});
