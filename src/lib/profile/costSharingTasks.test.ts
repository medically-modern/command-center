import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({ writeNumber: vi.fn() }));
vi.mock("./mondayApi", async () => {
  const actual = await vi.importActual<typeof import("./mondayApi")>("./mondayApi");
  return { ...actual, writeNumber: api.writeNumber };
});

import { COL } from "./mondayApi";
import { buildCostSharingTasks, buildAdvanceTasks } from "./unverifiedWrite";
import type { Patient } from "./workflow";

/**
 * The benefits-check answer has to reach the columns the board HOP copies.
 *
 * Katie, 2026-09-18: *"every patient i have seen on welcome call has
 * 'deductible not on fine' [not on file] and OOP max not on file on the
 * calculator"*. Stedi writes its answer into this board's `stediIndividual*`
 * columns; hop automation 7917676280 fills Medical Evaluation's plain
 * Deductible Remaining / OOP Max Remaining from the WORKING numeric columns
 * (`numeric_mm1zv64b` / `numeric_mm1zxktp`), and that plain pair is what rides
 * on to Insurance and Welcome Call and what `welcomeCall/oopContext` reads.
 *
 * Only `profile/mondayWrite.buildDataTasks` — the `/profile` route — had ever
 * bridged the two, so every patient advanced through the DTC intake pages
 * reached Welcome Call with both blank although eligibility had answered.
 * Measured 2026-09-18: 6/6 SNJ-sourced Welcome Call patients had a real Stedi
 * value upstream and an empty working column, against 4/4 manufacturer /
 * patient referrals carrying both and matching exactly.
 *
 * Every assertion below is on a task list or on the argument handed to
 * `writeNumber` — the failure this guards against is silent on every screen
 * (green send, empty column, "not on file" two boards later), so the test is
 * the only thing that would catch it.
 */
const patient = (over: Partial<Patient> = {}) =>
  ({ id: "123", name: "Test Patient", ...over }) as unknown as Patient;

const columnsOf = (tasks: { columnId: string }[]) => tasks.map((t) => t.columnId);

describe("buildCostSharingTasks", () => {
  beforeEach(() => {
    api.writeNumber.mockReset().mockResolvedValue(undefined);
  });

  it("carries all five working columns from the Stedi answer", () => {
    const cols = columnsOf(buildCostSharingTasks(patient({
      stediCoinsurance: "20",
      stediIndividualDeductible: "1500",
      stediIndividualDeductibleRemaining: "500",
      stediIndividualOopMax: "6000",
      stediIndividualOopMaxRemaining: "2500",
    })));
    expect(cols).toEqual([
      COL.workingCoinsurance,
      COL.workingDeductible,
      COL.workingDeductibleRemaining,
      COL.workingOopMax,
      COL.workingOopMaxRemaining,
    ]);
  });

  /**
   * The commonest live answer, and the one a truthiness regression drops in
   * silence. `cleanNumberValue` returns a STRING, so "0" is truthy and the
   * task is pushed — but a rewrite guarding on `Number(raw)`, or comparing
   * numerically, would read a met deductible as nothing to write and blank the
   * column for precisely the patients who owe $0. That is the figure Katie has
   * to be able to explain on the call (§5.31f).
   */
  it("writes a ZERO — a met deductible is an answer, not a blank", async () => {
    const tasks = buildCostSharingTasks(patient({
      stediIndividualDeductibleRemaining: "0",
      stediIndividualOopMaxRemaining: "0",
    }));
    expect(columnsOf(tasks)).toEqual([COL.workingDeductibleRemaining, COL.workingOopMaxRemaining]);
    await tasks[0].fn();
    expect(api.writeNumber).toHaveBeenCalledWith("123", COL.workingDeductibleRemaining, "0");
  });

  it("prefers the rep's own working value over Stedi's", async () => {
    const tasks = buildCostSharingTasks(patient({
      workingDeductibleRemaining: "250",
      stediIndividualDeductibleRemaining: "500",
    }));
    expect(columnsOf(tasks)).toEqual([COL.workingDeductibleRemaining]);
    await tasks[0].fn();
    // Same precedence as buildDataTasks on the /profile route, so the two
    // cannot disagree about a patient's deductible.
    expect(api.writeNumber).toHaveBeenCalledWith("123", COL.workingDeductibleRemaining, "250");
  });

  it("hands writeNumber the RAW value, exactly as the /profile route does", async () => {
    const tasks = buildCostSharingTasks(patient({ stediCoinsurance: "20%" }));
    await tasks[0].fn();
    expect(api.writeNumber).toHaveBeenCalledWith("123", COL.workingCoinsurance, "20%");
  });

  it("pushes nothing for a blank or unparseable source", () => {
    // `writeNumber` cleans and returns without writing when nothing is left, so
    // a task here would fail read-back verification and BLOCK the advance for a
    // patient whose eligibility simply never answered.
    expect(buildCostSharingTasks(patient())).toEqual([]);
    expect(buildCostSharingTasks(patient({ stediIndividualDeductible: "   " }))).toEqual([]);
    expect(buildCostSharingTasks(patient({ stediCoinsurance: "%" }))).toEqual([]);
  });
});

describe("the advance carries the cost-sharing columns", () => {
  /**
   * The wiring, not the rule. `buildAdvanceTasks` is what feeds
   * `executeWritesWithVerification` with `Move to Onboarding` held back, so
   * these columns are verified INDEXED before the hop fires — a plain write
   * beside the advance would race automation 7917676280. A refactor that drops
   * the spread leaves every rule above passing and the bug back.
   */
  it("includes them in the ONE verified batch", () => {
    const cols = columnsOf(buildAdvanceTasks(
      patient({ stediIndividualDeductibleRemaining: "500", stediIndividualOopMaxRemaining: "2500" }),
      { edits: { dob: "01/02/1990" }, verified: {} },
    ));
    expect(cols).toContain(COL.workingDeductibleRemaining);
    expect(cols).toContain(COL.workingOopMaxRemaining);
    expect(cols).not.toContain(COL.moveToOnboarding); // verifiedWrite holds that back
  });

  it("leaves a patient with no eligibility answer exactly as it was", () => {
    expect(buildAdvanceTasks(patient(), { edits: {}, verified: {} })).toEqual([]);
  });
});
