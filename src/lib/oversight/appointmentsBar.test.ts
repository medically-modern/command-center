import { describe, expect, it } from "vitest";
import {
  CHART_DEFS,
  OVERSIGHT_SECTIONS,
  type ChartDef,
  type OversightPatient,
  patientMatchesChart,
} from "./oversightApi";

const MASHEKE = 18406060017;
const SUB_STAGE = "color_mm1wyr92";
const ESCALATION = "color_mm1x7997";

const chart = (id: string): ChartDef => {
  const c = CHART_DEFS.find((d) => d.id === id);
  if (!c) throw new Error(`missing chart ${id}`);
  return c;
};

function patient(over: { stage: string; escalationIndex?: number }): OversightPatient {
  return {
    id: "p1",
    name: "Test Patient",
    boardId: MASHEKE,
    groupId: "group_mm1xf2jb",
    dayBucket: "30+ Days",
    cols: { [SUB_STAGE]: over.stage, [ESCALATION]: "" },
    colIndex: over.escalationIndex === undefined ? {} : { [ESCALATION]: over.escalationIndex },
  } as unknown as OversightPatient;
}

const PROCESSOR = "doctor-appointments";
const MANAGER = "doctor-appointments-manager";
const FINAL = "doctor-appointments-final";

describe("Doctor Appointments — the Oversight row", () => {
  it("has a chart in all three manager columns", () => {
    const me = OVERSIGHT_SECTIONS.find((s) => s.id === "medical-evaluation")!;
    expect(me.chartIds).toContain(PROCESSOR);
    expect(me.secondaryChartIds).toContain(MANAGER);
    expect(me.tertiaryChartIds).toContain(FINAL);
  });

  it("aligns all three on one row", () => {
    expect(chart(MANAGER).rowOf).toBe(PROCESSOR);
    expect(chart(FINAL).rowOf).toBe(PROCESSOR);
  });

  it("routes each escalation state to exactly one column", () => {
    const active = patient({ stage: "Doctor Appointment" });
    const escalated = patient({ stage: "Doctor Appointment", escalationIndex: 0 });
    const proposed = patient({ stage: "Doctor Appointment", escalationIndex: 2 });

    expect(patientMatchesChart(chart(PROCESSOR), active)).toBe(true);
    expect(patientMatchesChart(chart(MANAGER), active)).toBe(false);
    expect(patientMatchesChart(chart(FINAL), active)).toBe(false);

    // Three failed attempts -> Manager Intervention, NOT the processor column.
    expect(patientMatchesChart(chart(PROCESSOR), escalated)).toBe(false);
    expect(patientMatchesChart(chart(MANAGER), escalated)).toBe(true);
    expect(patientMatchesChart(chart(FINAL), escalated)).toBe(false);

    // "Won't schedule / wants to cancel" -> Final Decisions.
    expect(patientMatchesChart(chart(PROCESSOR), proposed)).toBe(false);
    expect(patientMatchesChart(chart(MANAGER), proposed)).toBe(false);
    expect(patientMatchesChart(chart(FINAL), proposed)).toBe(true);
  });

  it("covers EVERY escalation value — §7, a state matching no chart is invisible", () => {
    for (const escalationIndex of [undefined, 0, 1, 2]) {
      const p = patient({ stage: "Doctor Appointment", escalationIndex });
      const hit = [PROCESSOR, MANAGER, FINAL].filter((id) =>
        patientMatchesChart(chart(id), p),
      );
      expect(hit, `escalation ${String(escalationIndex)}`).toHaveLength(1);
    }
  });

  it("never claims a chase patient, and the chase charts never claim these", () => {
    const chasing = patient({ stage: "Chase Clinicals" });
    for (const id of [PROCESSOR, MANAGER, FINAL]) {
      expect(patientMatchesChart(chart(id), chasing), id).toBe(false);
    }
    const outreach = patient({ stage: "Doctor Appointment" });
    for (const id of ["chase-fax", "chase-email-parachute"]) {
      expect(patientMatchesChart(chart(id), outreach), id).toBe(false);
    }
  });

  it("Final Decisions can act — it carries the proposed-stuck decision + reason", () => {
    expect(chart(FINAL).decision).toBe("proposed-stuck");
    expect(chart(FINAL).drilldownCols.some((c) => c.colId === "__proposedReason__")).toBe(true);
  });

  it("surfaces the attempt log — it lives in MN notes, not columns", () => {
    for (const id of [PROCESSOR, MANAGER, FINAL]) {
      expect(chart(id).notesColId, id).toBe("long_text_mm27zjt2");
      expect(chart(id).drilldownCols.map((c) => c.colId), id).toContain("date_mm5w2vsf");
    }
  });
});

describe("patients waiting on a booked visit ride the Doctor Appointments row", () => {
  const APPT_DATE = "date_mm5w2vsf";
  const METHOD = "color_mm1xw7y5";

  function chasePatient(apptDate: string, escalationIndex?: number): OversightPatient {
    return {
      id: "p2",
      name: "Waiting Patient",
      boardId: MASHEKE,
      groupId: "group_mm1xf2jb",
      dayBucket: "30+ Days",
      cols: {
        [SUB_STAGE]: "Chase Clinicals",
        [APPT_DATE]: apptDate,
        [METHOD]: "Fax",
        [ESCALATION]: "",
      },
      colIndex: escalationIndex === undefined ? {} : { [ESCALATION]: escalationIndex },
    } as unknown as OversightPatient;
  }

  // Anchored well past any plausible "today" so the date compare is stable.
  const FUTURE = "2099-09-16";
  const PAST = "2020-01-05";

  it("a chase patient with a FUTURE appointment shows on Doctor Appointments, not chase", () => {
    const waiting = chasePatient(FUTURE);
    expect(patientMatchesChart(chart(PROCESSOR), waiting)).toBe(true);
    expect(patientMatchesChart(chart("chase-fax"), waiting)).toBe(false);
  });

  it("drops back to chase once the appointment date has passed", () => {
    const seen = chasePatient(PAST);
    expect(patientMatchesChart(chart(PROCESSOR), seen)).toBe(false);
    expect(patientMatchesChart(chart("chase-fax"), seen)).toBe(true);
  });

  it("a chase patient with NO appointment is untouched", () => {
    const plain = chasePatient("");
    expect(patientMatchesChart(chart(PROCESSOR), plain)).toBe(false);
    expect(patientMatchesChart(chart("chase-fax"), plain)).toBe(true);
  });

  it("is never counted on both rows at once", () => {
    for (const d of [FUTURE, PAST, ""]) {
      const p = chasePatient(d);
      const rows = [PROCESSOR, "chase-fax"].filter((id) => patientMatchesChart(chart(id), p));
      expect(rows, `appointment "${d}"`).toHaveLength(1);
    }
  });

  it("an escalated waiting patient lands in the manager column, not the processor one", () => {
    const escalated = chasePatient(FUTURE, 0);
    expect(patientMatchesChart(chart(MANAGER), escalated)).toBe(true);
    expect(patientMatchesChart(chart(PROCESSOR), escalated)).toBe(false);
  });

  /**
   * The "not counted twice" rule holds in EVERY column, not just Processor
   * Overview. It regressed in the manager ones because the appointment
   * exclusion was only ever added to the two processor charts: a chase patient
   * at attempt 4+ who then gets an appointment date keeps MN Attempts =
   * "Escalate", so they showed on the Doctor Appointments bar AND the Chase bar
   * of Manager Intervention at the same time. Same for 3rd+ round and for a
   * proposed-stuck patient in Final Decisions.
   */
  const MN_ATTEMPTS = "color_mm1wz0vg";
  const EVAL_COUNTER = "numeric_mm4bhjc8";

  const CROSS_COLUMN: {
    label: string;
    apptRow: string;
    chaseRow: string;
    escalationIndex: number;
    extraCols: Record<string, string>;
  }[] = [
    { label: "Attempt 4+", apptRow: MANAGER, chaseRow: "chase-fax-escalations", escalationIndex: 0, extraCols: { [MN_ATTEMPTS]: "Escalate" } },
    { label: "3rd+ round", apptRow: MANAGER, chaseRow: "chase-fax-escalated-3rd", escalationIndex: 0, extraCols: { [EVAL_COUNTER]: "4" } },
    { label: "Proposed stuck", apptRow: FINAL, chaseRow: "chase-fax-proposed-stuck", escalationIndex: 2, extraCols: {} },
    { label: "Attempt 4+ (email/parachute)", apptRow: MANAGER, chaseRow: "chase-email-parachute-escalations", escalationIndex: 0, extraCols: { [METHOD]: "Parachute", [MN_ATTEMPTS]: "Escalate" } },
    { label: "3rd+ round (email/parachute)", apptRow: MANAGER, chaseRow: "chase-email-parachute-escalated-3rd", escalationIndex: 0, extraCols: { [METHOD]: "Parachute", [EVAL_COUNTER]: "4" } },
    { label: "Proposed stuck (email/parachute)", apptRow: FINAL, chaseRow: "chase-email-parachute-proposed-stuck", escalationIndex: 2, extraCols: { [METHOD]: "Parachute" } },
  ];

  it.each(CROSS_COLUMN)(
    "$label: a waiting patient is on the appointments row only, never the chase row too",
    ({ apptRow, chaseRow, escalationIndex, extraCols }) => {
      const waiting = { ...chasePatient(FUTURE, escalationIndex) };
      waiting.cols = { ...waiting.cols, ...extraCols };
      expect(patientMatchesChart(chart(apptRow), waiting)).toBe(true);
      expect(patientMatchesChart(chart(chaseRow), waiting)).toBe(false);

      // The exclusion is scoped to a FUTURE visit — once it has happened the
      // patient is an ordinary escalated chase patient again and must come back
      // to the chase chart, or the escalation would go invisible (§7).
      const seen = { ...chasePatient(PAST, escalationIndex) };
      seen.cols = { ...seen.cols, ...extraCols };
      expect(patientMatchesChart(chart(chaseRow), seen)).toBe(true);
      expect(patientMatchesChart(chart(apptRow), seen)).toBe(false);
    },
  );
});
