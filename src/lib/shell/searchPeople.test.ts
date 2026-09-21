import { describe, expect, it } from "vitest";
import { groupKeyFor, groupSearchHits, hitCaption, last10, pickLead } from "./searchPeople";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";

/**
 * ⚠️ The fixtures are the SHAPE of the real case Josh reported on 2026-09-21 —
 * six board records for one patient, two of them a duplicate pair — with
 * fictional names and a fictional number. The boards, groups, escalation rung
 * and the fact that TWO stages ran twice are what matter and are real; the PHI
 * is not in the repo (§9).
 */
const BOARD = {
  intake: { id: 18406352652, name: "Profile Send Off Board" },
  mn: { id: 18406060017, name: "Medical Evaluation" },
  ins: { id: 18410601299, name: "Insurance" },
  wc: { id: 18410804557, name: "Welcome Call" },
  orders: { id: 18405457690, name: "New Order Board" },
};

function row(p: Partial<SystemPatient> & { id: string; boardId: number }): SystemPatient {
  return {
    name: "JAMIE RIVERS",
    phone: "5555550142",
    boardName: "",
    groupId: "",
    groupTitle: "",
    roleRoute: "",
    pipelineStage: "",
    escalated: false,
    escalationText: "",
    escalationLevel: null,
    escalationNotes: "",
    hasPage: true,
    isCompleted: false,
    daysSinceStage: "",
    notes: "",
    stageAdvancerText: "",
    nextActionDate: "",
    ...p,
  } as SystemPatient;
}

/** The reported patient: two completed intake records, a completed MN record
 *  AND an escalated one beside it, a completed Insurance record, and one live
 *  Welcome Call record. */
const SIX: SystemPatient[] = [
  row({ id: "1001", boardId: BOARD.intake.id, boardName: BOARD.intake.name, groupTitle: "Completed", isCompleted: true }),
  row({ id: "1002", boardId: BOARD.intake.id, boardName: BOARD.intake.name, groupTitle: "Completed", isCompleted: true }),
  row({ id: "2001", boardId: BOARD.mn.id, boardName: BOARD.mn.name, groupTitle: "Completed", isCompleted: true }),
  row({
    id: "2002", boardId: BOARD.mn.id, boardName: BOARD.mn.name, groupTitle: "2. Medical Necessity",
    escalated: true, escalationText: "Final Escalation Required", escalationLevel: "final",
  }),
  row({ id: "3001", boardId: BOARD.ins.id, boardName: BOARD.ins.name, groupTitle: "Complete", isCompleted: true }),
  row({ id: "4001", boardId: BOARD.wc.id, boardName: BOARD.wc.name, groupTitle: "Welcome Call", pipelineStage: "Welcome Call" }),
];

describe("one row per patient, not one per board item", () => {
  it("⚠️ folds all six records into ONE hit", () => {
    const hits = groupSearchHits(SIX);
    expect(hits).toHaveLength(1);
    expect(hits[0].rows).toHaveLength(6);
  });

  it("⚠️⚠️ opens the ACTIVE record — Josh: \"her active profile is welcome call\"", () => {
    expect(groupSearchHits(SIX)[0].lead.id).toBe("4001");
    expect(groupSearchHits(SIX)[0].bucket).toBe("active");
  });

  it("⚠️ the STUCK record is not dropped — it is on the hit, one click further in", () => {
    const hit = groupSearchHits(SIX)[0];
    expect(hit.rows.map((r) => r.id)).toContain("2002");
  });

  it("the caption says the stage AND that there is more behind it", () => {
    expect(hitCaption(groupSearchHits(SIX)[0])).toBe("Welcome Call · +5 more records");
  });

  it("a patient with one record says just the stage", () => {
    const hit = groupSearchHits([SIX[5]])[0];
    expect(hitCaption(hit)).toBe("Welcome Call");
  });

  it("⚠️ a stuck patient with no live record opens on the stuck one", () => {
    const noLive = SIX.filter((r) => r.id !== "4001");
    expect(pickLead(noLive).id).toBe("2002");
    expect(groupSearchHits(noLive)[0].bucket).toBe("stuck");
  });

  it("⚠️ being worked outranks being further along — a live Insurance record beats a completed Welcome Call one", () => {
    const rows = [
      row({ id: "9001", boardId: BOARD.wc.id, boardName: BOARD.wc.name, isCompleted: true }),
      row({ id: "9002", boardId: BOARD.ins.id, boardName: BOARD.ins.name }),
    ];
    expect(pickLead(rows).id).toBe("9002");
  });

  it("a wholly finished patient opens on the FURTHEST completed record", () => {
    const done = SIX.filter((r) => r.isCompleted);
    expect(pickLead(done).id).toBe("3001");
  });
});

describe("⚠️⚠️ a name is not an identity — the folding fails closed", () => {
  it("two patients on DIFFERENT numbers stay two rows", () => {
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, name: "MARIA GARCIA", phone: "5555550101" }),
      row({ id: "b", boardId: BOARD.ins.id, name: "MARIA GARCIA", phone: "5555550102" }),
    ]);
    expect(hits).toHaveLength(2);
  });

  it("a record with NO phone stands alone — SystemPatient carries no DOB to corroborate with", () => {
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, phone: "5555550142" }),
      row({ id: "b", boardId: BOARD.ins.id, phone: "" }),
    ]);
    expect(hits).toHaveLength(2);
  });

  it("a record with no NAME stands alone", () => {
    expect(groupKeyFor(row({ id: "z", boardId: BOARD.wc.id, name: "" }))).toBe("alone:z");
  });

  it("the same number written three ways is one person", () => {
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, phone: "5555550142" }),
      row({ id: "b", boardId: BOARD.ins.id, phone: "(555) 555-0142" }),
      row({ id: "c", boardId: BOARD.mn.id, phone: "+15555550142" }),
    ]);
    expect(hits).toHaveLength(1);
  });

  it("personKey's own annotations still fold — '(copy)' is not a second patient", () => {
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, name: "JAMIE RIVERS" }),
      row({ id: "b", boardId: BOARD.ins.id, name: "JAMIE RIVERS (copy)" }),
    ]);
    expect(hits).toHaveLength(1);
  });

  it("⚠️ ORDERS never fold — one item per reorder, and a row opens /orders", () => {
    const hits = groupSearchHits([
      row({ id: "o1", boardId: BOARD.orders.id, boardName: BOARD.orders.name }),
      row({ id: "o2", boardId: BOARD.orders.id, boardName: BOARD.orders.name }),
      row({ id: "4001", boardId: BOARD.wc.id, boardName: BOARD.wc.name }),
    ]);
    expect(hits).toHaveLength(3);
    expect(hits.filter((h) => h.bucket === "orders")).toHaveLength(2);
  });
});

describe("ordering", () => {
  it("⚠️ keeps the order the search ranked, rather than re-sorting", () => {
    const hits = groupSearchHits([
      row({ id: "b1", boardId: BOARD.wc.id, name: "ZARA WEST", phone: "5555550199" }),
      ...SIX,
    ]);
    expect(hits.map((h) => h.name)).toEqual(["ZARA WEST", "JAMIE RIVERS"]);
  });

  it("the lead is first in `rows`, so \"+N more\" is stable between polls", () => {
    expect(groupSearchHits(SIX)[0].rows[0].id).toBe("4001");
  });
});

describe("last10", () => {
  it("takes the last ten digits and ignores everything else", () => {
    expect(last10("+1 (555) 555-0142")).toBe("5555550142");
    expect(last10("5555550142")).toBe("5555550142");
    expect(last10("")).toBe("");
  });
});
