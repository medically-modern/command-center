import { describe, expect, it } from "vitest";
import {
  foldRedundantOrders,
  groupKeyFor,
  groupSearchHits,
  hitCaption,
  last10,
  orderFoldsInto,
  pickLead,
  sameHuman,
} from "./searchPeople";
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
    dob: "03/14/1958",
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

  it("⚠️ the caption is the STAGE and nothing else — no record count", () => {
    // Josh, 2026-09-22: "Shouldn't show the +4 more records". §5.42 put one
    // there so a folded row would not read like a single-record patient; from
    // the floor it reads as clutter about our own data model. The records are
    // still all on the hit and still all reachable one click in.
    expect(hitCaption(groupSearchHits(SIX)[0])).toBe("Welcome Call");
    expect(hitCaption(groupSearchHits(SIX)[0])).not.toMatch(/more record/);
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

describe("⚠️⚠️ the row opens the SUBSCRIPTION record when there is one", () => {
  const SUB = 18407459988;

  it("a subscribed patient's row leads with their Subscription record", () => {
    // Josh, 2026-09-22: "it should open up to their subscription page if
    // they're on it, and the onboarding tab if subscription profile does not
    // exist". A patient who has reached Subscription is being SERVED, so
    // opening their Welcome Call record is the wrong half of the record.
    const hits = groupSearchHits([
      ...SIX,
      row({ id: "5001", boardId: SUB, boardName: "Subscription Board - Updated", groupTitle: "Active" }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].lead.id).toBe("5001");
  });

  it("⚠️ it beats a LIVE pipeline record, not just a finished one", () => {
    expect(
      pickLead([
        row({ id: "4001", boardId: BOARD.wc.id, groupTitle: "Welcome Call" }),
        row({ id: "5001", boardId: SUB, groupTitle: "Active" }),
      ]).id,
    ).toBe("5001");
  });

  it("with no Subscription record the old ranking still decides", () => {
    expect(groupSearchHits(SIX)[0].lead.id).toBe("4001");
  });
});

describe("⚠️⚠️ a name is not an identity — the folding fails closed", () => {
  it("two patients on DIFFERENT numbers with different DOBs stay two rows", () => {
    // Two real Maria Garcias: nothing but the name agrees, so they must not
    // fold. (Same name + same DOB DOES fold since 2026-09-25 — the
    // changed-number test below.)
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, name: "MARIA GARCIA", phone: "5555550101", dob: "03/14/1958" }),
      row({ id: "b", boardId: BOARD.ins.id, name: "MARIA GARCIA", phone: "5555550102", dob: "07/22/1961" }),
    ]);
    expect(hits).toHaveLength(2);
  });

  it("⚠️⚠️ a BLANK phone folds on the DOB — this is the case Josh kept seeing", () => {
    // A completed record routinely carries a blank or differently-typed phone
    // (§5.28), so keying on `name|phone10` alone left every one of them in its
    // own row: the folding looked implemented and did nothing for the patients
    // it was written for.
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, phone: "5555550142" }),
      row({ id: "b", boardId: BOARD.ins.id, phone: "", dob: "03/14/1958" }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].rows).toHaveLength(2);
  });

  it("a blank phone and NO dob on either side still stands alone", () => {
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, phone: "5555550142", dob: "" }),
      row({ id: "b", boardId: BOARD.ins.id, phone: "", dob: "" }),
    ]);
    expect(hits).toHaveLength(2);
  });

  it("a blank phone whose DOB DISAGREES stands alone", () => {
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, phone: "5555550142", dob: "03/14/1958" }),
      row({ id: "b", boardId: BOARD.ins.id, phone: "", dob: "11/02/1971" }),
    ]);
    expect(hits).toHaveLength(2);
  });

  it("⚠️⚠️ an agreeing DOB folds ACROSS a changed number (Josh, 2026-09-25)", () => {
    // The measured case: the phone corrected at Welcome Call left the
    // onboarding records on the old number and the Subscription record on the
    // new one — one human, two rows. Name + DOB is still two signals; a
    // differing phone no longer vetoes them.
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, phone: "5555550142", dob: "03/14/1958" }),
      row({ id: "b", boardId: BOARD.ins.id, phone: "5555550199", dob: "03/14/1958" }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].rows).toHaveLength(2);
  });

  it("⚠️ two non-blank phones that differ WITHOUT an agreeing DOB stay apart", () => {
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, phone: "5555550142", dob: "03/14/1958" }),
      row({ id: "b", boardId: BOARD.ins.id, phone: "5555550199", dob: "" }),
    ]);
    expect(hits).toHaveLength(2);
  });

  it("⚠️ a bridging record MERGES two clusters that did not yet know they matched", () => {
    // Phone-only, DOB-only, then one carrying both — order must not decide it.
    const hits = groupSearchHits([
      row({ id: "a", boardId: BOARD.wc.id, phone: "5555550142", dob: "" }),
      row({ id: "b", boardId: BOARD.ins.id, phone: "", dob: "03/14/1958" }),
      row({ id: "c", boardId: BOARD.mn.id, phone: "5555550142", dob: "03/14/1958" }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].rows).toHaveLength(3);
  });

  it("sameHuman is the rule, and it is the one `nameMatchAccepted` uses", () => {
    const withPhone = row({ id: "a", boardId: BOARD.wc.id, phone: "5555550142", dob: "03/14/1958" });
    const blankPhone = row({ id: "b", boardId: BOARD.ins.id, phone: "", dob: "3-14-1958" });
    expect(sameHuman(withPhone, blankPhone)).toBe(true);
    expect(sameHuman(withPhone, row({ id: "c", boardId: BOARD.ins.id, phone: "", dob: "" }))).toBe(false);
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

  it("the lead is first in `rows`, so the folded set is stable between polls", () => {
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

describe("an order whose patient is already on screen is folded away", () => {
  /** The reported case: a name search that returned her Subscription record
   *  and three of her orders (Josh, 2026-09-23). */
  const order = (id: string, over: Partial<SystemPatient> = {}) =>
    row({ id, boardId: BOARD.orders.id, boardName: BOARD.orders.name, ...over });

  const hits = (rows: SystemPatient[]) => foldRedundantOrders(groupSearchHits(rows));

  it("⚠️ drops the orders and keeps the patient", () => {
    const out = hits([
      row({ id: "5001", boardId: 18407459988, boardName: "Subscription Board", pipelineStage: "Subscriptions" }),
      order("9001"),
      order("9002"),
      order("9003"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].lead.id).toBe("5001");
  });

  it("⚠️⚠️ an order with NO patient on screen still stands on its own", () => {
    // A CAH / PO / tracking query matches the order board and nothing else
    // (§5.35), so folding these away would break the lookup Josh asked for.
    const out = hits([order("9001"), order("9002")]);
    expect(out).toHaveLength(2);
    expect(out.every((h) => h.bucket === "orders")).toBe(true);
  });

  it("⚠️ each order keeps its OWN row, so a pasted CAH number opens that order", () => {
    const out = hits([order("9001"), order("9002"), order("9003")]);
    expect(out.map((h) => h.lead.id)).toEqual(["9001", "9002", "9003"]);
  });

  it("⚠️ a different patient's order is NOT folded away by a same-named hit", () => {
    // Two patients called JAMIE RIVERS, one of whom has an order. The phones
    // contradict, so nothing may claim the order belongs to the row on screen.
    const out = hits([
      row({ id: "4001", boardId: BOARD.wc.id, phone: "5555550142" }),
      order("9001", { phone: "5555559999" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("a blank phone on either side has nothing to contradict with, so it folds", () => {
    // The order board carries no DOB (§5.44), so the phone is all there is —
    // and the cost of folding is a row missing from ONE drop-down, with the
    // Orders folder, /orders and the patient's Orders tab all still on it.
    expect(orderFoldsInto(order("9001", { phone: "" }), groupSearchHits([row({ id: "4001", boardId: BOARD.wc.id })])[0])).toBe(true);
    expect(orderFoldsInto(order("9001"), groupSearchHits([row({ id: "4001", boardId: BOARD.wc.id, phone: "" })])[0])).toBe(true);
  });

  it("a DIFFERENT name never folds, whatever the phone says", () => {
    const out = hits([
      row({ id: "4001", boardId: BOARD.wc.id, name: "ZARA WEST" }),
      order("9001", { name: "JAMIE RIVERS" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("an order carrying a number the patient used to have still folds", () => {
    const out = hits([
      row({ id: "4001", boardId: BOARD.wc.id, phone: "5555550142", dob: "03/14/1958" }),
      row({ id: "3001", boardId: BOARD.ins.id, phone: "5555550142", dob: "03/14/1958", isCompleted: true, groupTitle: "Complete" }),
      order("9001", { phone: "5555550142" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("patients are untouched — this pass only ever removes ORDER rows", () => {
    const before = groupSearchHits(SIX);
    expect(foldRedundantOrders(before)).toEqual(before);
  });
});
