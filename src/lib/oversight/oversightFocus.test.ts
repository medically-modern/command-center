/**
 * The in-oversight finder and the pinned patient's rules (pixel-match Phase 7,
 * §5.52) — Josh, 2026-09-24: *"a search inside oversight would be helpful but
 * it would need to be keyed on only patients that are IN oversight"*.
 *
 * ⚠️⚠️ The population is the Map the charts already hold. These tests pin the
 * two ways that could quietly stop being true — a finder that reaches past the
 * Map (a patient no chart shows), and one that matches on something other than
 * the name (a column value that happens to contain the query) — and the
 * decision rules the pinned card shares with the drill-down, because two
 * readings of "which rows get a button" is how one surface offers a decision
 * the other refuses.
 *
 * Every patient here is invented: "Test Patient …", 555-style ids, no board data.
 */
import { describe, expect, it } from "vitest";
import {
  CHART_DEFS,
  OVERSIGHT_SECTIONS,
  type ChartDef,
  type OversightPatient,
} from "./oversightApi";
import {
  BOT_OWNED_REASONS,
  MAX_SEARCH_ROWS,
  MIN_SEARCH_CHARS,
  columnOf,
  decisionActions,
  decisionCopy,
  isBotOwnedRow,
  pipelinePeople,
  searchEmptyLine,
  searchFootLine,
  searchPipeline,
  sectionOf,
  seniorChart,
} from "./oversightFocus";

const chart = (id: string): ChartDef => {
  const c = CHART_DEFS.find((x) => x.id === id);
  if (!c) throw new Error(`chart def missing: ${id}`);
  return c;
};

const ME = 18406060017;
const INSURANCE = 18410601299;
const WELCOME_CALL = 18410804557;
const STAGE_COL = "color_mm1ws96t";
const ESC_COL = "color_mm2vsh2f";
const SUPPLIES_DVS_COL = "color_mm26pk1a";
const INSURANCE_NOTES_COL = "text_mm6vzc7q";

function pt(id: string, name: string, over: Partial<OversightPatient> = {}): OversightPatient {
  return {
    id,
    name,
    boardId: ME,
    groupId: "group_test",
    dayBucket: "3–5 Days",
    cols: {},
    colIndex: {},
    ...over,
  };
}

const map = (entries: Record<string, OversightPatient[]>) => new Map(Object.entries(entries));

describe("pipelinePeople — who is IN oversight", () => {
  it("lists a patient ONCE however many charts count them, with every chart", () => {
    const a = pt("1", "Test Patient A");
    const people = pipelinePeople(
      map({
        "evaluate-proposed-stuck": [a],
        evaluate: [a],
        "evaluate-escalated-merged": [a],
      }),
    );
    expect(people).toHaveLength(1);
    // In CHART_DEFS order — the order the columns render in — whatever order
    // the Map happened to hold them.
    const order = (id: string) => CHART_DEFS.findIndex((c) => c.id === id);
    const ids = people[0].charts.map((c) => c.id);
    expect(new Set(ids)).toEqual(new Set(["evaluate", "evaluate-escalated-merged", "evaluate-proposed-stuck"]));
    expect([...ids].sort((x, y) => order(x) - order(y))).toEqual(ids);
    expect(people[0].sectionId).toBe("medical-evaluation");
    expect(people[0].sectionTitle).toBe("Medical Evaluation");
  });

  it("counts only charts the screen RENDERS — a stacked chart's source series is not a chart of its own", () => {
    const a = pt("1", "Test Patient A");
    const people = pipelinePeople(
      map({ "evaluate-escalated-3rd": [a], "evaluate-escalated-merged": [a] }),
    );
    expect(people[0].charts.map((c) => c.id)).toEqual(["evaluate-escalated-merged"]);
  });

  it("⚠️ a patient held ONLY by a chart no section renders is not in the pipeline", () => {
    // `evaluate-escalated-3rd` feeds the merged chart's red series; its own
    // population is a subset of the merged chart's, so nobody real is lost —
    // and a finder that listed its rows would find patients no column shows.
    expect(pipelinePeople(map({ "evaluate-escalated-3rd": [pt("9", "Test Patient Z")] }))).toEqual([]);
    expect(pipelinePeople(map({ "no-such-chart": [pt("9", "Test Patient Z")] }))).toEqual([]);
  });

  it("is empty before the first read", () => {
    expect(pipelinePeople(null)).toEqual([]);
    expect(pipelinePeople(undefined)).toEqual([]);
    expect(pipelinePeople(new Map())).toEqual([]);
  });
});

describe("searchPipeline — the finder", () => {
  const people = pipelinePeople(
    map({
      evaluate: [pt("1", "Test Patient Alpha"), pt("2", "Test Patient Bravo")],
      benefits: [pt("3", "Sample Person Charlie", { boardId: INSURANCE })],
      "welcome-call": [
        pt("4", "Sample Person Delta", {
          boardId: WELCOME_CALL,
          // A column that happens to contain the query must never match.
          cols: { [STAGE_COL]: "Zulu Kilo", [ESC_COL]: "Bravo" },
        }),
      ],
    }),
  );

  it("finds a patient by name, across every stage", () => {
    expect(searchPipeline(people, "bravo").map((p) => p.patient.id)).toEqual(["2"]);
    expect(searchPipeline(people, "charlie").map((p) => p.patient.id)).toEqual(["3"]);
    expect(searchPipeline(people, "delta").map((p) => p.sectionId)).toEqual(["welcome-call"]);
  });

  it("⚠️ never finds somebody the Map does not hold", () => {
    expect(searchPipeline(people, "Echo")).toEqual([]);
    expect(searchPipeline(people, "Test Patient Echo")).toEqual([]);
  });

  it("⚠️ is NAME ONLY — a column value containing the query finds nothing", () => {
    // Delta's stage column reads "Zulu Kilo" and nobody is called that.
    expect(searchPipeline(people, "zulu")).toEqual([]);
    expect(searchPipeline(people, "kilo")).toEqual([]);
    // Her escalation column reads "Bravo"; only the patient NAMED Bravo answers.
    expect(searchPipeline(people, "bravo").map((p) => p.patient.id)).toEqual(["2"]);
  });

  it(`needs ${MIN_SEARCH_CHARS} characters, not counting spaces`, () => {
    expect(MIN_SEARCH_CHARS).toBe(2);
    expect(searchPipeline(people, "")).toEqual([]);
    expect(searchPipeline(people, "a")).toEqual([]);
    expect(searchPipeline(people, "  a  ")).toEqual([]);
    expect(searchPipeline(people, "al").length).toBeGreaterThan(0);
  });

  it(`stops at ${MAX_SEARCH_ROWS} rows`, () => {
    const many = pipelinePeople(
      map({ evaluate: Array.from({ length: 20 }, (_, i) => pt(String(100 + i), `Test Patient ${i}`)) }),
    );
    expect(searchPipeline(many, "test patient")).toHaveLength(MAX_SEARCH_ROWS);
    expect(searchPipeline(many, "test patient", 3)).toHaveLength(3);
  });

  it("ranks an exact substring above a typo match, and keeps pipeline order among ties", () => {
    // "jonson" is an in-order subsequence of "Johnson" (fuzzy) and a substring
    // of "Jonson" (exact).
    const list = pipelinePeople(
      map({
        evaluate: [pt("1", "Test Johnson"), pt("2", "Test Jonson"), pt("3", "Test Jonson Two")],
      }),
    );
    expect(searchPipeline(list, "jonson").map((p) => p.patient.id)).toEqual(["2", "3", "1"]);
  });
});

describe("the columns and the senior chart", () => {
  it("columnOf / sectionOf read the section layout", () => {
    expect(columnOf("evaluate")).toBe(1);
    expect(columnOf("evaluate-escalated-merged")).toBe(2);
    expect(columnOf("evaluate-proposed-stuck")).toBe(3);
    expect(columnOf("not-a-chart")).toBe(1);
    expect(sectionOf("benefits-final-escalation")).toEqual({ id: "insurance", title: "Insurance" });
    expect(sectionOf("not-a-chart")).toBeNull();
  });

  it("every rendered chart has exactly one section and one column", () => {
    for (const s of OVERSIGHT_SECTIONS) {
      for (const id of [...s.chartIds, ...(s.secondaryChartIds ?? []), ...(s.tertiaryChartIds ?? [])]) {
        expect(sectionOf(id)?.id, id).toBe(s.id);
      }
    }
  });

  it("seniorChart prefers Final Decisions over Manager Intervention over Processor Overview", () => {
    const one = chart("evaluate");
    const two = chart("evaluate-escalated-merged");
    const three = chart("evaluate-proposed-stuck");
    expect(seniorChart([one, two, three])?.id).toBe(three.id);
    expect(seniorChart([three, one, two])?.id).toBe(three.id);
    expect(seniorChart([one, two])?.id).toBe(two.id);
    expect(seniorChart([one])?.id).toBe(one.id);
    expect(seniorChart([])).toBeNull();
  });
});

describe("decisionActions — the drill-down's rule, shared with the pinned card", () => {
  const atDvs = (cols: Record<string, string>) =>
    pt("5", "Test Patient DVS", { boardId: INSURANCE, cols: { [STAGE_COL]: "DVS", ...cols } });
  const atSubmitAuth = (cols: Record<string, string>, colIndex: Record<string, number> = {}) =>
    pt("6", "Test Patient Auth", { boardId: INSURANCE, cols: { [STAGE_COL]: "Submit Auth.", ...cols }, colIndex });
  const labels = (c: ChartDef, p: OversightPatient) => decisionActions(c, p).map((a) => `${a.action}:${a.label}`);

  it("⚠️ a Submit Auth manager row that is ONLY a bot state gets no buttons", () => {
    const retry = atDvs({ [SUPPLIES_DVS_COL]: "Retry Queued" });
    expect(isBotOwnedRow(["DVS Retry"])).toBe(true);
    expect(decisionActions(chart("submit-auth-manager"), retry)).toEqual([]);
  });

  it("⚠️ …but a row with NO reason at all is not a bot state — it is the one most likely stranded", () => {
    const bare = atSubmitAuth({ [ESC_COL]: "Manager Escalation Required" }, { [ESC_COL]: 0 });
    expect(isBotOwnedRow([])).toBe(false);
    expect(labels(chart("submit-auth-manager"), bare)).toEqual([
      "escalate:Escalate to Final",
      "return:Return to Queue",
    ]);
  });

  it("a human reason on the Submit Auth manager chart gets both buttons", () => {
    const proposed = atSubmitAuth(
      {
        [ESC_COL]: "Manager Escalation Required",
        [INSURANCE_NOTES_COL]: "[Proposed Stuck · 2026-09-01 · TP] sample reason",
      },
      { [ESC_COL]: 0 },
    );
    expect(labels(chart("submit-auth-manager"), proposed)).toEqual([
      "escalate:Escalate to Final",
      "return:Return to Queue",
    ]);
  });

  it("the bot-owned exemption is INSURANCE-only: every intake escalation is a human's", () => {
    const c = chart("profile-send-off-unverified-escalated");
    expect(c.decision).toBe("intake-manager");
    expect(labels(c, pt("7", "Test Patient Intake"))).toEqual([
      "escalate:Escalate to Final",
      "return:Return to Queue",
    ]);
  });

  it("Final Decisions charts offer Approve Stuck + Return to Queue", () => {
    for (const id of ["evaluate-proposed-stuck", "benefits-final-escalation", "welcome-call-final", "profile-send-off-unverified-stuck"]) {
      expect(labels(chart(id), pt("8", "Test Patient Final")), id).toEqual([
        "approve:Approve Stuck",
        "return:Return to Queue",
      ]);
    }
  });

  it("Welcome Call's Manager Intervention escalates or returns", () => {
    expect(labels(chart("welcome-call-manager"), pt("9", "Test Patient WC"))).toEqual([
      "escalate:Escalate to Final",
      "return:Return to Queue",
    ]);
  });

  it("a chart with no decision offers none — a Processor Overview patient has nothing to decide", () => {
    for (const id of ["evaluate", "benefits", "evaluate-escalated-merged", "welcome-call"]) {
      expect(chart(id).decision, id).toBeUndefined();
      expect(decisionActions(chart(id), pt("10", "Test Patient Plain")), id).toEqual([]);
    }
  });

  it("BOT_OWNED_REASONS names exactly the two DVS bars", () => {
    expect([...BOT_OWNED_REASONS].sort()).toEqual(["DVS Manual Review", "DVS Retry"]);
    expect(isBotOwnedRow(["DVS Retry", "Propose Stuck"])).toBe(false);
    expect(isBotOwnedRow(["DVS Retry", "DVS Manual Review"])).toBe(true);
  });
});

describe("decisionCopy — what a decision means on each kind of chart", () => {
  it("Medical Evaluation's Proposed Stuck re-dates and quotes the MN notes", () => {
    const c = decisionCopy(chart("evaluate-proposed-stuck"));
    expect(c.isDecisionChart).toBe(true);
    expect(c.returnRedates).toBe(true);
    expect(c.returnClearsSnooze).toBe(false);
    expect(c.reasonNotesLabel).toBe("MN Notes");
    expect(c.isEscalateChart).toBe(false);
    expect(c.skipBotRows).toBe(false);
  });

  it("Insurance's Final Decisions quote the Reference Notes and do not re-date", () => {
    const c = decisionCopy(chart("benefits-final-escalation"));
    expect(c.returnRedates).toBe(false);
    expect(c.returnClearsSnooze).toBe(false);
    expect(c.reasonNotesLabel).toBe("Reference Notes");
  });

  it("the Welcome Call board clears a snooze instead of writing a date", () => {
    for (const id of ["welcome-call-manager", "welcome-call-final"]) {
      const c = decisionCopy(chart(id));
      expect(c.returnClearsSnooze, id).toBe(true);
      expect(c.reasonNotesLabel, id).toBe("Welcome Call Notes");
      expect(c.returnRedates, id).toBe(false);
    }
  });

  it("the three Manager Intervention kinds escalate; only Submit Auth skips bot rows", () => {
    expect(decisionCopy(chart("submit-auth-manager"))).toMatchObject({ isEscalateChart: true, skipBotRows: true });
    expect(decisionCopy(chart("profile-send-off-unverified-escalated"))).toMatchObject({ isEscalateChart: true, skipBotRows: false });
    expect(decisionCopy(chart("welcome-call-manager"))).toMatchObject({ isEscalateChart: true, skipBotRows: false });
    expect(decisionCopy(chart("benefits-final-escalation"))).toMatchObject({ isEscalateChart: false, skipBotRows: false });
  });

  it("quotes the column the proposal was STAMPED in, which is not always the chart's notes", () => {
    for (const c of CHART_DEFS.filter((x) => x.decision)) {
      expect(decisionCopy(c).returnNotesColId, c.id).toBe(c.reasonColId ?? c.notesColId);
    }
  });

  it("a chart with no decision is not a decision chart", () => {
    expect(decisionCopy(chart("evaluate")).isDecisionChart).toBe(false);
  });
});

describe("the finder's words", () => {
  it("says how many rows it shows, singular and plural", () => {
    expect(searchFootLine(1)).toMatch(/^1 match across every stage · /);
    expect(searchFootLine(3)).toMatch(/^3 matches across every stage · /);
    expect(searchFootLine(3)).toContain("picking one switches the stage below and pins the patient on top");
  });

  it("asks for more before it says nobody, and names what it does not search", () => {
    expect(searchEmptyLine("a")).toBe("Keep typing — a patient's name.");
    const none = searchEmptyLine("  Test Nobody  ");
    expect(none).toContain("“Test Nobody”");
    expect(none).toContain("the header search covers every board");
  });
});
