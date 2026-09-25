/**
 * Reports & Metrics — the numbers (§5.52).
 *
 * Every tile is a reading of a rule that already exists, so these tests pin
 * (1) the readings, with fixtures shaped like the live boards, and (2) the
 * agreements between this module and the modules it reads — `INFO_COL`'s
 * stage-start ids, the Subscription board's option lists, the role registry —
 * because a drift there is a wrong number with nothing erroring.
 */
import { describe, expect, it } from "vitest";
import {
  DTC_INTAKE_BOARD, LATE_LABELS, MR_EXPIRED_LABEL, PIPELINE_BOARD_IDS, STAGE_BOARDS,
  barPct, daysInStageOf, fmt, formLeadFacts, orderFacts, pipelineFacts, queueCards, queueHref,
  stageTiles, subscriptionFacts, topStepsText, type PipelineRow,
} from "./reportsRules";
import { BOARDS } from "@/lib/systemMgmt/mondayApi";
import { INFO_COL } from "@/lib/patient/infoStrip";
import { MACRO_STAGES } from "@/lib/patient/patientScreen";
import { STUCK_GROUP_IDS } from "@/lib/shared/profileStatus";
import { DAYS_TO_ORDER_OPTIONS, MR_STATUS_OPTIONS, STATUS_OPTIONS } from "@/lib/subscription/workflow";
import { ROLES } from "@/lib/config";
import { ROLE_GROUPS } from "@/lib/systemMgmt/operationsGroups";
import { GROUPS as ORDER_GROUPS } from "@/lib/orders/mondayApi";

const PROFILE = 18406352652;
const ME = 18406060017;
const INS = 18410601299;
const WC = 18410804557;
const SUB = 18407459988;

function row(over: Partial<PipelineRow> & { id: string; boardId: number }): PipelineRow {
  return {
    groupId: "group_live", isCompleted: false, stageAdvancerText: "", escalationLevel: null,
    escalated: false, stageStart: "", createdAt: "", ...over,
  };
}

describe("the pipeline boards", () => {
  it("are MACRO_STAGES minus DTC Intake, in stepper order", () => {
    expect(STAGE_BOARDS.map((s) => s.label)).toEqual(MACRO_STAGES.map((m) => m.label));
    expect(PIPELINE_BOARD_IDS).toEqual([PROFILE, ME, INS, WC]);
    expect(PIPELINE_BOARD_IDS).not.toContain(DTC_INTAKE_BOARD);
  });

  it("⚠️ the snapshot's stage-start column is INFO_COL's, board for board", () => {
    // Two hand-maintained maps of the same ids; this is what keeps them one.
    for (const b of BOARDS) {
      const info = INFO_COL[b.boardId];
      if (!info) {
        expect(b.stageStartColId ?? null, `${b.boardName} has no INFO_COL entry and must not claim a stage start`).toBeNull();
        continue;
      }
      expect(b.stageStartColId ?? null, `${b.boardName}`).toBe(info.stageStart);
    }
    // And every pipeline board is in the registry — a board the snapshot does
    // not read is a tile that quietly reads 0.
    for (const id of PIPELINE_BOARD_IDS) expect(BOARDS.some((b) => b.boardId === id), String(id)).toBe(true);
  });
});

describe("daysInStageOf", () => {
  it("reads the stage-start date first", () => {
    expect(daysInStageOf({ stageStart: "2026-09-20", createdAt: "2026-01-01T00:00:00Z" }, "2026-09-25")).toBe(5);
  });
  it("falls back to the creation date, in Eastern (Profile Send Off's rule)", () => {
    // 2026-09-22 02:30Z is still the evening of 9/21 in New York.
    expect(daysInStageOf({ stageStart: "", createdAt: "2026-09-22T02:30:00Z" }, "2026-09-25")).toBe(4);
  });
  it("a stage start in the future, or nothing at all, is unknown — never a negative", () => {
    expect(daysInStageOf({ stageStart: "2026-10-01", createdAt: "" }, "2026-09-25")).toBeNull();
    expect(daysInStageOf({ stageStart: "", createdAt: "" }, "2026-09-25")).toBeNull();
    expect(daysInStageOf({ stageStart: "not a date", createdAt: "garbage" }, "2026-09-25")).toBeNull();
  });
});

describe("stageTiles", () => {
  const today = "2026-09-25";
  const rows: PipelineRow[] = [
    row({ id: "p1", boardId: PROFILE, stageStart: "", createdAt: "2026-09-15T12:00:00Z" }),  // 10 days
    row({ id: "p2", boardId: PROFILE, createdAt: "2026-09-21T12:00:00Z" }),                  // 4 days
    row({ id: "lead", boardId: PROFILE, groupId: "group_mm5z87zt", createdAt: "2026-09-24T12:00:00Z" }),
    row({ id: "pdone", boardId: PROFILE, isCompleted: true }),
    row({ id: "m1", boardId: ME, stageStart: "2026-09-18" }),                                // 7 days
    row({ id: "mstuck", boardId: ME, groupId: STUCK_GROUP_IDS[0] }),
    row({ id: "i1", boardId: INS, stageStart: "2026-09-25" }),                               // 0 days
    row({ id: "i2", boardId: INS, stageAdvancerText: "Stuck / Don't Proceed" }),
    row({ id: "w1", boardId: WC }),                                                          // no date
    row({ id: "dtc", boardId: DTC_INTAKE_BOARD }),
    row({ id: "sub", boardId: SUB }),
  ];

  it("counts ACTIVE rows per stage, leaves web-form leads out of Intake, averages the dated ones", () => {
    const tiles = stageTiles(rows, new Set(["lead"]), today);
    expect(tiles.map((t) => [t.label, t.count, t.avgDays])).toEqual([
      ["Intake", 2, 7],              // p1 + p2; the lead and the completed row are out
      ["Medical Evaluation", 1, 7],  // the stuck row is not active
      ["Insurance", 1, 0],           // a stuck advancer is not active
      ["Welcome Call", 1, null],     // counted, but no date to average
    ]);
  });

  it("a lead id only ever bites on Intake, and DTC Intake / Subscription rows count nowhere", () => {
    const tiles = stageTiles(rows, new Set(["m1", "dtc", "sub"]), today);
    expect(tiles.find((t) => t.key === "mn")?.count).toBe(1);
    expect(tiles.reduce((a, t) => a + t.count, 0)).toBe(6);
  });

  it("with no lead set, the form-group row counts as Intake", () => {
    expect(stageTiles(rows, undefined, today)[0].count).toBe(3);
  });
});

describe("pipelineFacts", () => {
  it("stuck = the search folder's rule (group · advancer · Final proposal); escalated = the flag on a live row", () => {
    const facts = pipelineFacts([
      row({ id: "a", boardId: ME, groupId: STUCK_GROUP_IDS[0] }),
      row({ id: "b", boardId: INS, stageAdvancerText: "Stuck / Don't Proceed" }),
      row({ id: "c", boardId: WC, escalationLevel: "final", escalated: true }),
      row({ id: "d", boardId: ME, escalationLevel: "manager", escalated: true }),
      row({ id: "e", boardId: ME, escalated: true, isCompleted: true }),
      row({ id: "f", boardId: DTC_INTAKE_BOARD, groupId: STUCK_GROUP_IDS[0], escalated: true }),
      row({ id: "g", boardId: SUB, escalated: true }),
    ]);
    expect(facts).toEqual({ stuck: 3, escalated: 2, known: 7 });
  });
});

describe("formLeadFacts", () => {
  const rows = [
    { id: "1", groupId: "g", dropOffStep: "Step 5 - Insurance" },
    { id: "2", groupId: "g", dropOffStep: "Step 5 - Insurance" },
    { id: "3", groupId: "g", dropOffStep: "Step 3 - What they need" },
    { id: "4", groupId: "g", dropOffStep: "Completed" },
    { id: "5", groupId: "g", dropOffStep: "" },
    { id: "6", groupId: "g", dropOffStep: "   " },
  ];
  it("a blank step is an imported row, not a lead (§5.24 · §5.30)", () => {
    const f = formLeadFacts(rows);
    expect(f.leads).toBe(4);
    expect(f.imported).toBe(2);
    expect([...f.leadIds].sort()).toEqual(["1", "2", "3", "4"]);
  });
  it("steps come most-common first, ties by name, and the sub-line takes two", () => {
    const f = formLeadFacts(rows);
    expect(f.steps).toEqual([
      { step: "Step 5 - Insurance", n: 2 },
      { step: "Completed", n: 1 },
      { step: "Step 3 - What they need", n: 1 },
    ]);
    expect(topStepsText(f)).toBe("2 at Step 5 - Insurance · 1 at Completed");
    expect(topStepsText({ steps: [] })).toBe("");
  });
});

describe("subscriptionFacts", () => {
  it("⚠️ the labels are the board's own option lists", () => {
    const labels = (o: { label: string }[]) => o.map((x) => x.label);
    expect(labels(STATUS_OPTIONS)).toEqual(expect.arrayContaining(["Active", "Paused"]));
    for (const l of LATE_LABELS) expect(labels(DAYS_TO_ORDER_OPTIONS), l).toContain(l);
    expect(labels(MR_STATUS_OPTIONS)).toContain(MR_EXPIRED_LABEL);
  });
  it("matches exactly — Dead is neither, Order Day Arrived is not late, <5 Days is not expired", () => {
    expect(subscriptionFacts([
      { status: "Active", daysToOrder: "Very Late", mr: "MR Expired" },
      { status: "Active ", daysToOrder: "Order Day Passed", mr: "MR <5 Days" },
      { status: "Paused", daysToOrder: "Order Day Arrived", mr: "MR Valid" },
      { status: "Dead", daysToOrder: "Very Late", mr: "MR Expired" },
      { status: "", daysToOrder: "", mr: "" },
    ])).toEqual({ active: 2, paused: 1, late: 3, mrExpired: 2 });
  });
});

describe("orderFacts", () => {
  const o = (over: Record<string, unknown>) => ({
    groupId: ORDER_GROUPS.order, orderStatus: "Order", apiStatus: "", holdReason: "", apiMessage: "",
    backordered: "", inactiveProducts: "", substitutionStatus: "", preCheck: "", ...over,
  });
  it("open is the orders slice's OPEN_STAGES; hold and backordered are its flags", () => {
    expect(orderFacts([
      o({}),                                                                                   // to place
      o({ orderStatus: "Process Claim", apiStatus: "Warning", holdReason: "Credit Check Failure" }), // on hold
      o({ orderStatus: "Process Claim", apiStatus: "Accepted", backordered: "AutoSoft 90 6mm 23\"" }),
      o({ orderStatus: "Process Claim", apiStatus: "Delivered", holdReason: "Credit Check Failure" }), // closed — a stale hold
      o({ groupId: ORDER_GROUPS.cancelled, orderStatus: "Order" }),
    ])).toEqual({ open: 3, hold: 1, backordered: 1 });
  });
});

describe("queue bars", () => {
  it("the door rule is the burndowns' — FAX opens the inbox, Auth Denied opens nothing, no route opens nothing", () => {
    expect(queueHref({ id: "fax", route: "" })).toBe("/fax-inbox");
    expect(queueHref({ id: "authDenied", route: "/auth-denied" })).toBeNull();
    expect(queueHref({ id: "evaluate", route: "/evaluate" })).toBe("/evaluate");
    expect(queueHref({ id: "mystery", route: "" })).toBeNull();
  });
  it("Brandon's sqrt fill, floored at 3 when there is anything to show", () => {
    expect(barPct(0, 100)).toBe(0);
    expect(barPct(null, 100)).toBe(0);
    expect(barPct(100, 100)).toBe(100);
    expect(barPct(25, 100)).toBe(50);
    expect(barPct(1, 10000)).toBe(3);
  });
  it("groups the registry as Operations does, places every role but Communications, dashes a missing count", () => {
    const cards = queueCards({ evaluate: 12, fax: 3, authDenied: 2 }, { evaluate: 4 });
    expect(cards.map((c) => c.title)).toEqual(ROLE_GROUPS.map((g) => g.title));
    const bars = cards.flatMap((c) => c.bars);
    const ids = bars.map((b) => b.role.id);
    for (const r of ROLES) expect(ids.includes(r.id), r.id).toBe(r.id !== "assignedPatients");
    const ev = bars.find((b) => b.role.id === "evaluate")!;
    expect(ev).toMatchObject({ count: 12, esc: 4, pct: 100, href: "/evaluate" });
    expect(bars.find((b) => b.role.id === "fax")).toMatchObject({ count: 3, esc: 0, href: "/fax-inbox" });
    expect(bars.find((b) => b.role.id === "authDenied")).toMatchObject({ count: 2, href: null });
    expect(bars.find((b) => b.role.id === "benefits")).toMatchObject({ count: null, pct: 0, esc: 0 });
  });
});

describe("fmt", () => {
  it("thousands separators", () => {
    expect(fmt(1754)).toBe("1,754");
    expect(fmt(0)).toBe("0");
  });
});
