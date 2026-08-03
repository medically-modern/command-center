import { describe, expect, it } from "vitest";
import {
  APPENDIX_BUCKET,
  CHART_DEFS,
  type OversightPatient,
  matchesAppendixBar,
  patientMatchesChart,
} from "./oversightApi";

const MASHEKE = 18406060017;
const SUB_STAGE = "color_mm1wyr92";
const METHOD = "color_mm1xw7y5";
const ESCALATION = "color_mm1x7997";

const chart = (id: string) => {
  const c = CHART_DEFS.find((d) => d.id === id);
  if (!c) throw new Error(`missing chart ${id}`);
  return c;
};

function patient(over: {
  stage: string;
  method?: string;
  escalationIndex?: number;
}): OversightPatient {
  return {
    id: "p1",
    name: "Test Patient",
    boardId: MASHEKE,
    groupId: "group_mm1xf2jb",
    dayBucket: "30+ Days",
    cols: {
      [SUB_STAGE]: over.stage,
      [METHOD]: over.method ?? "",
      [ESCALATION]: "",
    },
    colIndex: over.escalationIndex === undefined ? {} : { [ESCALATION]: over.escalationIndex },
  } as unknown as OversightPatient;
}

describe("Doctor Appointments — the Oversight appendix bar", () => {
  it("both chase charts carry an Appointments bar", () => {
    for (const id of ["chase-fax", "chase-email-parachute"]) {
      expect(chart(id).appendixBar, id).toBeDefined();
      expect(chart(id).appendixBar!.short, id).toBe("Appts");
    }
  });

  it("splits parked patients by Clinicals Method, exactly like the chase pair", () => {
    const fax = patient({ stage: "Doctor Appointment", method: "Fax" });
    const blank = patient({ stage: "Doctor Appointment", method: "" });
    const email = patient({ stage: "Doctor Appointment", method: "Email" });
    const para = patient({ stage: "Doctor Appointment", method: "Parachute" });

    // Fax + blank belong to the Fax row (a missing method counts as fax, §5.9).
    expect(matchesAppendixBar(chart("chase-fax"), fax)).toBe(true);
    expect(matchesAppendixBar(chart("chase-fax"), blank)).toBe(true);
    expect(matchesAppendixBar(chart("chase-fax"), email)).toBe(false);
    expect(matchesAppendixBar(chart("chase-fax"), para)).toBe(false);

    // Email rides with Parachute, same as the chase roles.
    expect(matchesAppendixBar(chart("chase-email-parachute"), email)).toBe(true);
    expect(matchesAppendixBar(chart("chase-email-parachute"), para)).toBe(true);
    expect(matchesAppendixBar(chart("chase-email-parachute"), fax)).toBe(false);
  });

  it("never claims a patient who is still in the chase stage", () => {
    const chasing = patient({ stage: "Chase Clinicals", method: "Fax" });
    expect(matchesAppendixBar(chart("chase-fax"), chasing)).toBe(false);
    // ...but the chart still owns them via its own rule.
    expect(patientMatchesChart(chart("chase-fax"), chasing)).toBe(true);
  });

  it("keeps an ESCALATED appointment patient visible — §7 blindness rule", () => {
    // Three failed outreach attempts escalate to Manager Intervention. That
    // removes the patient from the rep queue AND the role count, so if no chart
    // claimed them they'd be invisible in the entire app.
    const escalated = patient({
      stage: "Doctor Appointment",
      method: "Fax",
      escalationIndex: 0,
    });
    expect(matchesAppendixBar(chart("chase-fax"), escalated)).toBe(true);
    expect(patientMatchesChart(chart("chase-fax"), escalated)).toBe(true);
  });

  it("excludes a stuck PROPOSAL — index 2 belongs to Final Decisions", () => {
    const proposed = patient({
      stage: "Doctor Appointment",
      method: "Fax",
      escalationIndex: 2,
    });
    expect(matchesAppendixBar(chart("chase-fax"), proposed)).toBe(false);
  });

  it("fetches the columns its filter conditions on", () => {
    // A filter column missing from the fetch silently matches nothing.
    for (const id of ["chase-fax", "chase-email-parachute"]) {
      const cols = chart(id).drilldownCols.map((c) => c.colId);
      expect(cols, id).toContain("date_mm5w2vsf"); // Appointment Date
    }
  });

  it("uses a bucket key that can't collide with a day-bucket label", () => {
    expect(APPENDIX_BUCKET).toBe("__appendix__");
  });
});
