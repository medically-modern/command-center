/**
 * Remove from Stuck (§5.57) — the plan per board, reading Monday's activity
 * log for where a patient was, and what each step writes. FAKE data only: the
 * log rows below are shaped like Monday's (`move_pulse_from_group` with
 * `source_group`/`dest_group`, `update_column_value` with
 * `previous_value`/`value`), with no patient in them.
 */
import { describe, expect, it } from "vitest";
import {
  STUCK_PLANS,
  advancerWrite,
  canRemoveFromStuck,
  stillStuck,
  stuckOriginFromLog,
  stuckPlanFor,
  targetFromOrigin,
  type ActivityLogEntry,
  type StuckPlan,
} from "./removeFromStuck";
import { STUCK_GROUP_IDS } from "@/lib/shared/profileStatus";
import { STUCK_LABELS } from "@/lib/systemMgmt/mondayApi";
import { GROUPS as WC_GROUPS } from "@/lib/welcomeCall/mondayApi";
import { GROUPS as FC_GROUPS } from "@/lib/finalConfirm/mondayApi";
import { GROUPS as ME_GROUPS } from "@/lib/masheke/mondayApi";
import { SUB_STAGE_INDEX } from "@/lib/masheke/mondayMapping";
import { GROUPS as INS_GROUPS } from "@/lib/samantha/mondayApi";
import { GROUPS as PSO_GROUPS } from "@/lib/profile/mondayApi";
import { STAGE_ADVANCER_STUCK } from "@/lib/welcomeCall/mondayWrite";

const WC = STUCK_PLANS[18410804557];
const ME = STUCK_PLANS[18406060017];
const INS = STUCK_PLANS[18410601299];
const PSO = STUCK_PLANS[18406352652];

let tick = 17900000000000000n;
/** Monday's log is newest-first; these helpers stamp increasing ticks so a
 *  fixture can be written oldest-first and shuffled. */
function at(): string {
  tick += 1000n;
  return tick.toString();
}
function move(plan: StuckPlan, from: { id: string; title: string }, to = plan.stuckGroupId): ActivityLogEntry {
  return {
    event: "move_pulse_from_group",
    created_at: at(),
    data: JSON.stringify({ source_group: from, dest_group: { id: to, title: "Stuck" }, group_id: from.id }),
  };
}
function adv(plan: StuckPlan, from: { index: number; text: string } | null, to: { index: number; text: string }): ActivityLogEntry {
  return {
    event: "update_column_value",
    created_at: at(),
    data: JSON.stringify({
      column_id: plan.advancerColId,
      previous_value: from ? { label: { index: from.index, text: from.text } } : null,
      value: { label: { index: to.index, text: to.text } },
    }),
  };
}
function noise(colId = "color_mm1wwm05"): ActivityLogEntry {
  return {
    event: "update_column_value",
    created_at: at(),
    data: JSON.stringify({ column_id: colId, previous_value: null, value: { label: { index: 1, text: "3–5 Days" } } }),
  };
}

describe("the plans are the boards' own ids", () => {
  it("every Stuck group is one STUCK_GROUP_IDS knows", () => {
    for (const plan of Object.values(STUCK_PLANS)) expect(STUCK_GROUP_IDS).toContain(plan.stuckGroupId);
  });

  it("the Stuck advancer text is the board's own, as Search reads it", () => {
    for (const plan of [WC, ME, INS]) expect(plan.stuckAdvancerText).toBe(STUCK_LABELS[plan.boardId]);
    expect(WC.stuckAdvancerIndex).toBe(STAGE_ADVANCER_STUCK);
  });

  it("Welcome Call's two groups are the two queues' groups", () => {
    expect(WC.stuckGroupId).toBe(WC_GROUPS.stuck);
    expect(WC.targets.find((t) => t.key === "welcomeCall")!.groupId).toBe(WC_GROUPS.welcomeCall);
    expect(WC.targets.find((t) => t.key === "finalConfirm")!.groupId).toBe(FC_GROUPS.finalProfileConfirmation);
  });

  it("Medical Evaluation: one group, and the sub-stage ids are masheke's", () => {
    for (const t of ME.targets) expect(t.groupId).toBe(ME_GROUPS.medicalNecessity);
    const idx = (k: string) => (ME.targets.find((t) => t.key === k)!.advancer as { index: number }).index;
    expect(idx("evaluate")).toBe(SUB_STAGE_INDEX.evaluate);
    expect(idx("sendRequest")).toBe(SUB_STAGE_INDEX.sendRequest);
    expect(idx("confirmReceipt")).toBe(SUB_STAGE_INDEX.confirmReceipt);
    expect(idx("chase")).toBe(SUB_STAGE_INDEX.chase);
    expect(idx("doctorAppointment")).toBe(SUB_STAGE_INDEX.doctorAppointment);
  });

  it("Insurance: the three working groups are samantha's", () => {
    const g = (k: string) => INS.targets.find((t) => t.key === k)!.groupId;
    expect(g("benefits")).toBe(INS_GROUPS.benefits);
    expect(g("submitAuth")).toBe(INS_GROUPS.submitAuth);
    expect(g("authOutstanding")).toBe(INS_GROUPS.authOutstanding);
  });

  it("Profile Send Off: the groups are profile's, and there is no advancer", () => {
    expect(PSO.stuckGroupId).toBe(PSO_GROUPS.stuck);
    expect(PSO.advancerColId).toBeNull();
    const g = (k: string) => PSO.targets.find((t) => t.key === k)!.groupId;
    expect(g("intake")).toBe(PSO_GROUPS.intake);
    expect(g("alreadyInSystem")).toBe(PSO_GROUPS.alreadyInSystem);
    expect(g("partialLeads")).toBe(PSO_GROUPS.newFormPartial);
    expect(g("completedForms")).toBe(PSO_GROUPS.newFormCompleted);
    expect(g("cleanUp")).toBe(PSO_GROUPS.profileCleanUp);
    for (const t of PSO.targets) expect(t.advancer.kind).toBe("none");
  });

  it("no target sends a patient to a Stuck or Completed group", () => {
    for (const plan of Object.values(STUCK_PLANS)) {
      for (const t of plan.targets) {
        expect(STUCK_GROUP_IDS).not.toContain(t.groupId);
        expect(t.groupId).not.toBe(plan.stuckGroupId);
      }
    }
  });

  it("⚠️⚠️ Welcome Call never writes 'Welcome Call' (7) back — it re-runs the welcome texts", () => {
    for (const t of WC.targets) {
      if (t.advancer.kind === "write") expect(t.advancer.index).not.toBe(7);
    }
    expect(WC.targets.find((t) => t.key === "welcomeCall")!.advancer).toEqual({ kind: "clearIfStuck" });
  });

  it("DTC Intake (read-only here) and Subscription have no plan", () => {
    expect(stuckPlanFor(18392794310)).toBeNull();
    expect(stuckPlanFor(18407459988)).toBeNull();
  });
});

describe("stuckOriginFromLog — where Monday says they were", () => {
  it("Welcome Call: the move AND the advancer change both point at Welcome Call", () => {
    const log = [
      noise(),
      adv(WC, { index: 7, text: "Welcome Call" }, { index: 2, text: "Stuck / Don't Proceed" }),
      move(WC, { id: "group_mm1wvq8p", title: "Welcome Call" }),
      noise(),
    ].reverse();
    const o = stuckOriginFromLog(WC, log)!;
    expect(o).toMatchObject({ fromGroupId: "group_mm1wvq8p", fromAdvancerIndex: 7 });
    expect(targetFromOrigin(WC, o)!.key).toBe("welcomeCall");
  });

  it("Welcome Call dragged into Stuck by hand: the move alone decides", () => {
    const log = [move(WC, { id: "group_mm2x8jtj", title: "Final Profile Confirmation" }), noise()];
    const o = stuckOriginFromLog(WC, log)!;
    expect(o.fromAdvancerIndex).toBeNull();
    expect(targetFromOrigin(WC, o)!.key).toBe("finalConfirm");
  });

  it("⚠️ Medical Evaluation is told apart by the ADVANCER — every step shares one group", () => {
    const log = [
      adv(ME, { index: 10, text: "Confirm Receipt" }, { index: 15, text: "Stuck" }),
      move(ME, { id: "group_mm1xf2jb", title: "2. Medical Necessity" }),
    ];
    expect(targetFromOrigin(ME, stuckOriginFromLog(ME, log))!.key).toBe("confirmReceipt");
  });

  it("⚠️ …so a Medical Evaluation move with no advancer change is NOT guessed", () => {
    const log = [move(ME, { id: "group_mm1xf2jb", title: "2. Medical Necessity" })];
    const o = stuckOriginFromLog(ME, log);
    expect(o?.fromGroupId).toBe("group_mm1xf2jb");
    expect(targetFromOrigin(ME, o)).toBeNull();
  });

  it("Insurance reads the advancer first", () => {
    const log = [
      adv(INS, { index: 6, text: "Auth. Outstanding" }, { index: 2, text: "Stuck / Don't Proceed" }),
      move(INS, { id: "group_mm2v6d1z", title: "Auth Outstanding" }),
    ];
    expect(targetFromOrigin(INS, stuckOriginFromLog(INS, log))!.key).toBe("authOutstanding");
  });

  it("Insurance DVS — the advancer wins over the group the item lingered in", () => {
    const log = [
      adv(INS, { index: 1, text: "DVS" }, { index: 2, text: "Stuck / Don't Proceed" }),
      move(INS, { id: "group_mm1xr3q3", title: "Benefits" }),
    ];
    expect(targetFromOrigin(INS, stuckOriginFromLog(INS, log))!.key).toBe("dvs");
  });

  it("Profile Send Off — the group is the whole answer", () => {
    const log = [noise("text_mm2vf40t"), move(PSO, { id: "group_mm6c3rhb", title: "Profile Clean-Up" })];
    expect(targetFromOrigin(PSO, stuckOriginFromLog(PSO, log))!.key).toBe("cleanUp");
  });

  it("the NEWEST way into Stuck wins — stuck, returned, stuck again", () => {
    const log = [
      move(WC, { id: "group_mm1wvq8p", title: "Welcome Call" }),
      move(WC, { id: "group_mm1xyczx", title: "Stuck" }, "group_mm2x8jtj"), // returned to FPC
      move(WC, { id: "group_mm2x8jtj", title: "Final Profile Confirmation" }),
    ];
    // Shuffled, as an API page is no promise of order beyond newest-first.
    const o = stuckOriginFromLog(WC, [log[1], log[2], log[0]])!;
    expect(o.fromGroupId).toBe("group_mm2x8jtj");
  });

  it("a move OUT of Stuck, or between working groups, is not a way in", () => {
    const log = [
      move(WC, { id: "group_mm1xyczx", title: "Stuck" }, "group_mm1wvq8p"),
      move(WC, { id: "group_mm1wvq8p", title: "Welcome Call" }, "group_mm2x8jtj"),
    ];
    expect(stuckOriginFromLog(WC, log)).toBeNull();
  });

  it("an item imported straight into Stuck has no history — the manager picks", () => {
    expect(stuckOriginFromLog(WC, [noise(), noise()])).toBeNull();
    expect(targetFromOrigin(WC, null)).toBeNull();
  });

  it("a group the button cannot return them to is named, not matched", () => {
    const o = stuckOriginFromLog(WC, [move(WC, { id: "group_mm1x5c0", title: "Escalation" })])!;
    expect(o.fromGroupTitle).toBe("Escalation");
    expect(targetFromOrigin(WC, o)).toBeNull();
  });

  it("unreadable rows are skipped, never thrown on", () => {
    const bad: ActivityLogEntry = { event: "update_column_value", created_at: "x", data: "{not json" };
    const log = [bad, move(WC, { id: "group_mm1wvq8p", title: "Welcome Call" })];
    expect(stuckOriginFromLog(WC, log)!.fromGroupId).toBe("group_mm1wvq8p");
  });
});

describe("what the press writes", () => {
  const t = (plan: StuckPlan, key: string) => plan.targets.find((x) => x.key === key)!;

  it("Welcome Call: clears the advancer ONLY while it says Stuck", () => {
    expect(advancerWrite(WC, t(WC, "welcomeCall"), "Stuck / Don't Proceed")).toEqual({ clear: true });
    // Dragged into Stuck by hand — it kept "Welcome Call", which is left alone.
    expect(advancerWrite(WC, t(WC, "welcomeCall"), "Welcome Call")).toBeNull();
    expect(advancerWrite(WC, t(WC, "welcomeCall"), "")).toBeNull();
  });

  it("Final Confirm writes Review Profile (0)", () => {
    expect(advancerWrite(WC, t(WC, "finalConfirm"), "Stuck / Don't Proceed")).toEqual({ index: 0 });
  });

  it("Medical Evaluation and Insurance write the step's own label id", () => {
    expect(advancerWrite(ME, t(ME, "chase"), "Stuck")).toEqual({ index: 11 });
    expect(advancerWrite(INS, t(INS, "submitAuth"), "Stuck / Don't Proceed")).toEqual({ index: 4 });
  });

  it("Profile Send Off writes no advancer", () => {
    expect(advancerWrite(PSO, t(PSO, "intake"), "")).toBeNull();
  });
});

describe("who is offered the button, and when it worked", () => {
  const rec = (over: Partial<{ boardId: number; groupId: string; stageAdvancerText: string; isCompleted: boolean }>) => ({
    boardId: 18410804557,
    groupId: "group_mm1xyczx",
    stageAdvancerText: "Stuck / Don't Proceed",
    isCompleted: false,
    ...over,
  });

  it("a record in the Stuck group", () => {
    expect(canRemoveFromStuck(rec({}))).toBe(true);
    expect(canRemoveFromStuck(rec({ boardId: 18406352652, stageAdvancerText: "" }))).toBe(true);
  });

  it("⚠️ a half-done removal — working group, advancer still Stuck — is offered it again", () => {
    expect(canRemoveFromStuck(rec({ boardId: 18406060017, groupId: "group_mm1xf2jb", stageAdvancerText: "Stuck" }))).toBe(true);
  });

  it("not a live record, a completed one, or a board with no plan", () => {
    expect(canRemoveFromStuck(rec({ groupId: "group_mm1wvq8p", stageAdvancerText: "Welcome Call" }))).toBe(false);
    expect(canRemoveFromStuck(rec({ isCompleted: true }))).toBe(false);
    expect(canRemoveFromStuck(rec({ boardId: 18392794310, groupId: "group_mkyw7wy8" }))).toBe(false);
  });

  it("stillStuck reads the group, then the advancer", () => {
    expect(stillStuck(WC, "group_mm1xyczx", "")).toBe(true);
    expect(stillStuck(WC, "group_mm1wvq8p", "Stuck / Don't Proceed")).toBe(true);
    expect(stillStuck(WC, "group_mm1wvq8p", "")).toBe(false);
    expect(stillStuck(PSO, "group_mm1xf2jb", "")).toBe(false);
  });
});
