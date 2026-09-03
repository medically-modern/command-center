/**
 * ONE PATIENT, ONE COLUMN.
 *
 * The manager views read as a pipeline: Processor Overview is what the reps are
 * working, Manager Intervention is what a manager has to unblock, Final
 * Decisions is what is waiting on a stuck call. Those three numbers are only
 * meaningful if they PARTITION the stage — the moment a patient can be counted
 * in two of them, every column total is inflated by an unknown amount and the
 * dashboard stops being a measure of anything.
 *
 * It broke exactly that way (Brandon, 2026-08-12): the Medical Evaluation
 * processor charts excluded escalation index 2 but not index 0, so 20 escalated
 * patients — Ruben Dickens the reported one — sat in Processor Overview and
 * Manager Intervention at once, while being absent from the rep's sidebar and
 * her burndown count, which both drop escalated patients (§5.8).
 *
 * `insuranceCoverage.test.ts` is the other half of this pair: it asserts nobody
 * falls through the cracks, this asserts nobody is counted twice. Both use the
 * REAL chart defs and the REAL matcher, so a filter edit shows up here.
 *
 * The known exception is recorded, not hidden — see the Insurance block.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CHART_DEFS,
  OVERSIGHT_SECTIONS,
  PROFILE_IN_SYSTEM_GROUP,
  patientMatchesChart,
  type OversightPatient,
} from "./oversightApi";

const MASHEKE = 18406060017;
const MASHEKE_GROUP = "group_mm1xf2jb";
const STAGE_COL = "color_mm1wyr92";     // Sub-Stage (the stage advancer)
const ESC_COL = "color_mm1x7997";       // Escalation: 0 = Manager, 1 = Done, 2 = Final
const ATTEMPTS_COL = "color_mm1wz0vg";  // MN Attempts ("Escalate" = attempt 4+)
const COUNTER_COL = "numeric_mm4bhjc8"; // Evaluation Counter
const METHOD_COL = "color_mm1xw7y5";    // Clinicals Method
const APPT_COL = "date_mm5w2vsf";       // Appointment Date

const PROFILE = 18406352652;
const IN_SYSTEM_COL = "color_mm2xe7r8";

const chart = (id: string) => CHART_DEFS.find((c) => c.id === id)!;
const section = (id: string) => OVERSIGHT_SECTIONS.find((s) => s.id === id)!;

/** Chart ids that actually resolve to a def, in the order the column renders. */
const resolved = (ids: string[] | undefined) =>
  (ids ?? []).filter((id) => CHART_DEFS.some((c) => c.id === id));

/**
 * Which of a section's three columns would list this patient, by name.
 * A stacked chart's population is its own filter rule, which is a superset of
 * its two series — the same evaluation `stackedSeries` uses to split the bars.
 */
function columnsHolding(sectionId: string, p: OversightPatient): string[] {
  const s = section(sectionId);
  const cols: [string, string[]][] = [
    ["Processor Overview", resolved(s.chartIds)],
    ["Manager Intervention", resolved(s.secondaryChartIds)],
    ["Final Decisions", resolved(s.tertiaryChartIds)],
  ];
  return cols
    .filter(([, ids]) => ids.some((id) => patientMatchesChart(chart(id), p)))
    .map(([name]) => name);
}

// ── Medical Evaluation ───────────────────────────────────────────────────

function mePatient(over: {
  stage: string;
  escIndex?: number;
  attempts?: string;
  counter?: string;
  method?: string;
  appt?: string;
}): OversightPatient {
  return {
    id: "p1",
    name: "Test Patient",
    boardId: MASHEKE,
    groupId: MASHEKE_GROUP,
    dayBucket: "0–2 Days",
    cols: {
      [STAGE_COL]: over.stage,
      [ATTEMPTS_COL]: over.attempts ?? "Attempt 1",
      [COUNTER_COL]: over.counter ?? "1",
      [METHOD_COL]: over.method ?? "Fax",
      [APPT_COL]: over.appt ?? "",
    },
    colIndex: over.escIndex === undefined ? {} : { [ESC_COL]: over.escIndex },
  };
}

/** Every shape a Medical Evaluation patient can take, as a flat case list. */
const ME_STAGES = [
  { stage: "Evaluate MN", method: "Fax" },
  { stage: "Send Request", method: "Fax" },
  { stage: "Confirm Receipt", method: "Fax" },
  { stage: "Chase Clinicals", method: "Fax" },
  { stage: "Chase Clinicals", method: "" },          // blank method counts as Fax (§5.9)
  { stage: "Chase Clinicals", method: "Email" },
  { stage: "Chase Clinicals", method: "Parachute" },
  { stage: "Doctor Appointment", method: "Fax" },
];
// undefined = the column was never set (no index at all), which is a distinct
// case from "Done" and is what most of the board actually looks like.
const ME_ESCALATIONS = [undefined, 1, 0, 2];
const ME_ATTEMPTS = ["Attempt 1", "Escalate"];
const ME_COUNTERS = ["1", "3"];
const ME_APPTS = ["", "2099-01-01", "2001-01-01"]; // none · booked ahead · long past

const ME_CASES = ME_STAGES.flatMap((s) =>
  ME_ESCALATIONS.flatMap((escIndex) =>
    ME_ATTEMPTS.flatMap((attempts) =>
      ME_COUNTERS.flatMap((counter) =>
        ME_APPTS.map((appt) => ({
          ...s,
          escIndex,
          attempts,
          counter,
          appt,
          label:
            `${s.stage}${s.method ? ` (${s.method || "blank"})` : ""} · esc ${escIndex ?? "unset"}` +
            ` · ${attempts} · counter ${counter} · appt ${appt || "none"}`,
        })),
      ),
    ),
  ),
);

describe("Medical Evaluation columns partition the stage", () => {
  it("no patient is ever in two columns at once", () => {
    const doubled = ME_CASES.filter((c) => columnsHolding("medical-evaluation", mePatient(c)).length > 1)
      .map((c) => `${c.label} → ${columnsHolding("medical-evaluation", mePatient(c)).join(" + ")}`);
    expect(doubled).toEqual([]);
  });

  it("no patient is in NO column — an invisible patient is worse than a doubled one", () => {
    const orphans = ME_CASES.filter((c) => columnsHolding("medical-evaluation", mePatient(c)).length === 0)
      .map((c) => c.label);
    expect(orphans).toEqual([]);
  });

  // The reported bug, pinned as its own case: Ruben Dickens' exact board state
  // on the day Brandon reported it.
  it("an escalated Confirm Receipt patient at attempt 4+ is the MANAGER's only", () => {
    const ruben = mePatient({ stage: "Confirm Receipt", escIndex: 0, attempts: "Escalate", counter: "1" });
    expect(columnsHolding("medical-evaluation", ruben)).toEqual(["Manager Intervention"]);
  });

  it.each(["Evaluate MN", "Send Request", "Confirm Receipt", "Chase Clinicals"])(
    "%s: an unescalated patient is the REP's only",
    (stage) => {
      for (const escIndex of [undefined, 1]) {
        const p = mePatient({ stage, escIndex });
        expect(columnsHolding("medical-evaluation", p), `esc ${escIndex ?? "unset"}`).toEqual([
          "Processor Overview",
        ]);
      }
    },
  );

  it.each(["Evaluate MN", "Send Request", "Confirm Receipt", "Chase Clinicals"])(
    "%s: index 0 goes to Manager Intervention, index 2 to Final Decisions",
    (stage) => {
      expect(columnsHolding("medical-evaluation", mePatient({ stage, escIndex: 0 }))).toEqual([
        "Manager Intervention",
      ]);
      expect(columnsHolding("medical-evaluation", mePatient({ stage, escIndex: 2 }))).toEqual([
        "Final Decisions",
      ]);
    },
  );

  // The gap the merged charts' population rules exist to close. Before them,
  // an escalation that matched neither series had Processor Overview to fall
  // back on; now that column excludes escalated patients, so nothing would
  // hold this patient at all.
  it("an escalation matching NEITHER series is still on the manager's chart", () => {
    for (const stage of ["Evaluate MN", "Send Request", "Confirm Receipt", "Chase Clinicals"]) {
      const p = mePatient({ stage, escIndex: 0, attempts: "Attempt 1", counter: "1" });
      expect(columnsHolding("medical-evaluation", p), stage).toEqual(["Manager Intervention"]);
    }
  });

  // Returning a patient to the rep clears the Escalation and deliberately
  // leaves MN Attempts alone — it is the attempt history, not a queue flag.
  it("a manager's Return to Queue hands the patient back, and the manager bar lets go", () => {
    const returned = mePatient({ stage: "Chase Clinicals", escIndex: 1, attempts: "Escalate" });
    expect(columnsHolding("medical-evaluation", returned)).toEqual(["Processor Overview"]);
  });

  // A booked visit moves the patient to the Doctor Appointments row and off the
  // chase charts, at every escalation level — never both (§5.12).
  it.each([undefined, 1, 0, 2])("a chase patient with a booked visit sits on ONE row (esc %s)", (escIndex) => {
    const p = mePatient({ stage: "Chase Clinicals", escIndex, appt: "2099-01-01" });
    const chaseRows = ["chase-fax", "chase-fax-escalated-merged", "chase-fax-proposed-stuck"];
    expect(chaseRows.filter((id) => patientMatchesChart(chart(id), p))).toEqual([]);
    expect(columnsHolding("medical-evaluation", p).length).toBe(1);
  });
});

// ── Insurance ────────────────────────────────────────────────────────────

const INSURANCE = 18410601299;
const INS_STAGE_COL = "color_mm1ws96t";
const INS_ESC_COL = "color_mm2vsh2f";
const GROUP_FOR_STAGE: Record<string, string> = {
  "Benefits / SoS": "group_mm1xr3q3",
  "Submit Auth.": "group_mm1x1416",
  "Auth. Outstanding": "group_mm2v6d1z",
  "Auth Denied": "group_mm316hg2",
};
const ESC_LABEL: Record<number, string> = {
  0: "Manager Escalation Required",
  1: "Done",
  2: "Final Escalation Required",
};

function insPatient(stage: string, escIndex?: number, cols: Record<string, string> = {}): OversightPatient {
  return {
    id: "p1",
    name: "Test Patient",
    boardId: INSURANCE,
    groupId: GROUP_FOR_STAGE[stage] ?? "group_unknown",
    dayBucket: "0–2 Days",
    cols: {
      [INS_STAGE_COL]: stage,
      ...(escIndex === undefined ? {} : { [INS_ESC_COL]: ESC_LABEL[escIndex] }),
      ...cols,
    },
    colIndex: escIndex === undefined ? {} : { [INS_ESC_COL]: escIndex },
  };
}

describe("Insurance columns partition the stage", () => {
  const STAGES = ["Benefits / SoS", "Submit Auth.", "Auth. Outstanding"];
  /** The board facts the Benefits manager bars key on, in every combination. */
  const FACTS: [string, Record<string, string>, Record<string, number>][] = [
    ["none", {}, {}],
    ["inactive", { color_mm5q9y3: "Inactive" }, { color_mm5q9y3: 2 }],
    ["pump SoS", { dropdown_mm2vez5a: "Insulin Pump" }, {}],
    ["overdue", {}, { color_mm1wwm05: 3 }],
    ["stamped", { text_mm6vzc7q: "[Proposed Stuck · JR] payer won't budge" }, {}],
    [
      "all",
      { color_mm5q9y3: "Inactive", dropdown_mm2vez5a: "Insulin Pump", text_mm6vzc7q: "[Proposed Stuck · JR] x" },
      { color_mm5q9y3: 2, color_mm1wwm05: 3 },
    ],
  ];

  it.each(STAGES)("%s: exactly one column, at every escalation × board-fact combination", (stage) => {
    for (const escIndex of [undefined, 1, 0, 2]) {
      for (const [label, cols, idx] of FACTS) {
        const p = insPatient(stage, escIndex, cols);
        Object.assign(p.colIndex, idx);
        expect(
          columnsHolding("insurance", p),
          `${stage} · esc ${escIndex ?? "unset"} · facts: ${label}`,
        ).toHaveLength(1);
      }
    }
  });

  it.each(STAGES)("%s: escalated patients leave Processor Overview", (stage) => {
    for (const escIndex of [0, 2]) {
      expect(columnsHolding("insurance", insPatient(stage, escIndex))).not.toContain(
        "Processor Overview",
      );
    }
  });

  // Closed 2026-08-12 (Brandon). The Benefits Manager Intervention bars
  // "Inactive insurance" and "Pump SoS" used to be pure board FACTS with no
  // escalation condition, which put a non-escalated patient in two columns —
  // the same shape as the Medical Evaluation bug above, from the other side.
  // Every one of those facts already writes the label, so the bars now require
  // it and the three Insurance columns partition the stage like ME's do.
  it.each([
    ["Inactive insurance", { color_mm5q9y3: "Inactive" }, { color_mm5q9y3: 2 }],
    ["Pump SoS", { dropdown_mm2vez5a: "Insulin Pump" }, {}],
    ["Days in stage", {}, { color_mm1wwm05: 3 }],
  ])("a Benefits patient with the %s FACT but no label is the REP's alone", (_label, cols, idx) => {
    const p = insPatient("Benefits / SoS", undefined, cols);
    Object.assign(p.colIndex, idx);
    expect(columnsHolding("insurance", p)).toEqual(["Processor Overview"]);
  });

  // The manager's way out. Return to Queue clears the escalation, and the row
  // has to leave their column — with the fact still on the board, which is why
  // keying the bars on the fact made it uncleanable.
  it("clearing the escalation hands a factful patient back to the rep", () => {
    const p = insPatient("Benefits / SoS", 1, {
      color_mm5q9y3: "Inactive",
      dropdown_mm2vez5a: "Insulin Pump",
    });
    p.colIndex.color_mm5q9y3 = 2;
    expect(columnsHolding("insurance", p)).toEqual(["Processor Overview"]);
  });

  // Brandon, 2026-08-12: "any profile with that status should show up in that
  // middle column if the manager escalation status is checked". The chart's
  // population rule is the label itself, so a patient carrying it is listed
  // even when no bar describes why — footnoted as "+N in no bar".
  it("the label ALONE puts a Benefits patient in Manager Intervention", () => {
    const bare = insPatient("Benefits / SoS", 0);
    expect(columnsHolding("insurance", bare)).toEqual(["Manager Intervention"]);
    expect(patientMatchesChart(chart("benefits-manager-escalation"), bare)).toBe(true);
  });
});

// ── Patient Intake ───────────────────────────────────────────────────────

const INTAKE_FORM_GROUP = "group_mm5zgeak";
/** Profile Clean-Up — the intake stage's second sub-stage (§5.20). It has its
 *  own row of three charts, so it has to partition exactly like the others. */
const INTAKE_CLEANUP_GROUP = "group_mm6c3rhb";
const INTAKE_ESC_COL = "color_mm5zww42";

function intakePatient(groupId: string, escIndex?: number, inSystem = ""): OversightPatient {
  return {
    id: "p1",
    name: "Test Patient",
    boardId: PROFILE,
    groupId,
    dayBucket: "0–2 Days",
    cols: { [IN_SYSTEM_COL]: inSystem },
    colIndex: escIndex === undefined ? {} : { [INTAKE_ESC_COL]: escIndex },
  };
}

describe("Patient Intake columns partition the stage", () => {
  it("the three intake queues stay mutually exclusive", () => {
    for (const groupId of [
      "group_mm1xf2jb", INTAKE_FORM_GROUP, INTAKE_CLEANUP_GROUP, PROFILE_IN_SYSTEM_GROUP,
    ]) {
      for (const inSystem of ["", "No", "Yes"]) {
        for (const escIndex of [undefined, 1, 0, 2]) {
          const p = intakePatient(groupId, escIndex, inSystem);
          const held = columnsHolding("intake", p);
          expect(held.length, `${groupId} · in-system "${inSystem}" · esc ${escIndex ?? "unset"}`)
            .toBeLessThanOrEqual(1);
        }
      }
    }
  });

  // Every escalation state of a Clean-Up patient must match SOME chart, or the
  // patient is invisible app-wide (§7): an escalation takes them off the rep's
  // sidebar AND out of useRoleCounts, so a chart is the only place left.
  it("Profile Clean-Up patients land in exactly one column at every rung", () => {
    for (const escIndex of [undefined, 1, 0, 2]) {
      const p = intakePatient(INTAKE_CLEANUP_GROUP, escIndex);
      expect(
        columnsHolding("intake", p),
        `clean-up · esc ${escIndex ?? "unset"}`,
      ).toHaveLength(1);
    }
  });

  it("routes the Clean-Up charts to the page that renders the right pane", () => {
    // /unverified-referrals renders the LEFT pane only, so a manager sent
    // there would not see the work the chart is about. Read as TEXT rather
    // than imported: CHART_ROUTES lives in a .tsx component and this suite is
    // deliberately node-only.
    const tab = readFileSync("src/components/oversight/OversightTab.tsx", "utf8");
    const routes = tab.slice(tab.indexOf("const CHART_ROUTES"));
    for (const id of [
      "profile-send-off-cleanup",
      "profile-send-off-cleanup-escalated",
      "profile-send-off-cleanup-stuck",
    ]) {
      expect(routes, id).toContain(`"${id}": "/profile-cleanup"`);
    }
  });

  // The chart read a permanent 0 because the board's "Already In System" group
  // was fetched by nothing (Brandon, 2026-08-12). Both routes in are asserted:
  // the group itself, and the status flag on a patient still sitting in one of
  // the other queues.
  it("Already In System matches BOTH the group and the status flag", () => {
    const byGroup = intakePatient(PROFILE_IN_SYSTEM_GROUP);
    expect(patientMatchesChart(chart("profile-send-off-in-system"), byGroup)).toBe(true);

    const byStatus = intakePatient("group_mm1xf2jb", undefined, "Yes");
    expect(patientMatchesChart(chart("profile-send-off-in-system"), byStatus)).toBe(true);

    const byStatusOnForm = intakePatient(INTAKE_FORM_GROUP, undefined, "Yes");
    expect(patientMatchesChart(chart("profile-send-off-in-system"), byStatusOnForm)).toBe(true);
  });

  it("and takes the group even when the status column is still blank", () => {
    // Group membership is the marker — items arrive there by a board move, and
    // the column is not always written.
    const blank = intakePatient(PROFILE_IN_SYSTEM_GROUP, undefined, "");
    expect(columnsHolding("intake", blank)).toEqual(["Processor Overview"]);
  });

  it("an Already In System patient is NOT also a Verified or Unverified referral", () => {
    const flagged = intakePatient("group_mm1xf2jb", undefined, "Yes");
    expect(patientMatchesChart(chart("profile-send-off"), flagged)).toBe(false);
    expect(patientMatchesChart(chart("profile-send-off-unverified"), flagged)).toBe(false);
  });
});
