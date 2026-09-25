import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({
  readColumnText: vi.fn(),
  clearStatus: vi.fn(),
  writeNumber: vi.fn(),
  writeStatusIndex: vi.fn(),
}));
vi.mock("./mondayApi", async () => {
  const actual = await vi.importActual<typeof import("./mondayApi")>("./mondayApi");
  return {
    ...actual,
    readColumnText: api.readColumnText,
    clearStatus: api.clearStatus,
    writeNumber: api.writeNumber,
    writeStatusIndex: api.writeStatusIndex,
  };
});

const vw = vi.hoisted(() => ({
  executeWritesWithVerification: vi.fn(),
}));
vi.mock("@/lib/shared/verifiedWrite", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shared/verifiedWrite")>(
    "@/lib/shared/verifiedWrite",
  );
  return { ...actual, executeWritesWithVerification: vw.executeWritesWithVerification };
});

import { CASH_PAY_ACTION_INDEX, COL } from "./mondayApi";
import type { WriteTask } from "@/lib/shared/verifiedWrite";
import { generateCashPayLink } from "./mondayWrite";

/**
 * Two pre-production flight-check findings (2026-09-25), both invisible on
 * screen — a green card over a mint that was never asked for — so these tests
 * are the only thing that would catch either coming back.
 *
 * 1. ⚠️ `expectedText` is matched EXACTLY against Monday's read-back, with
 *    deliberately NO snapshot-difference escape hatch, and a number column
 *    reads back with no trailing zero — so toFixed's "1030.70" against the
 *    cell's "1030.7" could never verify: every total whose cents end in 0
 *    (~1 in 10) failed for ever. The declared `value`, `expectedText` and what
 *    `writeNumber` serializes (`String(num)`) must be byte-identical.
 *
 * 2. ⚠️ `executeWritesWithVerification` RETURNS data-write failures (it throws
 *    only on a verification timeout) — every other caller checks the array.
 *    Discarded here, a failed Cash Pay Amount write resolved cleanly and the
 *    card's 45s watcher ended on "No answer yet" over a board holding nothing.
 */
describe("generateCashPayLink", () => {
  beforeEach(() => {
    api.readColumnText.mockReset().mockResolvedValue("");
    api.clearStatus.mockReset().mockResolvedValue(undefined);
    api.writeNumber.mockReset().mockResolvedValue(undefined);
    api.writeStatusIndex.mockReset().mockResolvedValue(undefined);
    vw.executeWritesWithVerification.mockReset().mockResolvedValue([]);
  });

  function sentTasks(): WriteTask[] {
    const call = vw.executeWritesWithVerification.mock.calls[0];
    expect(call).toBeDefined();
    return (call[0] as { tasks: WriteTask[] }).tasks;
  }
  function amountTask(): WriteTask {
    const t = sentTasks().find((x) => x.columnId === COL.cashPayAmount);
    expect(t).toBeDefined();
    return t as WriteTask;
  }

  it("⚠️ a trailing-zero-cents total agrees with itself end to end", async () => {
    await generateCashPayLink("42", 1030.7);
    const t = amountTask();
    // The canonical string, everywhere — never toFixed's "1030.70".
    expect(t.value).toBe("1030.7");
    expect(t.expectedText).toBe("1030.7");
    expect(t.value).toBe(t.expectedText);
    // And what writeNumber actually serializes (String(num), mondayApi.ts) is
    // the same string the verify phase will demand back.
    await t.fn();
    expect(api.writeNumber).toHaveBeenCalledWith("42", COL.cashPayAmount, 1030.7);
    expect(String(api.writeNumber.mock.calls[0][2])).toBe(t.expectedText);
  });

  it("whole dollars and single-decimal cents canonicalize the same way", async () => {
    await generateCashPayLink("42", 250.0);
    expect(amountTask().expectedText).toBe("250");
    vw.executeWritesWithVerification.mockClear();
    await generateCashPayLink("42", 105.9);
    expect(amountTask().expectedText).toBe("105.9");
  });

  it("an ordinary total still rounds to cents and is unchanged", async () => {
    // Debbie's quote to the cent — and a float artifact still rounds.
    await generateCashPayLink("42", 1030.69);
    expect(amountTask().value).toBe("1030.69");
    vw.executeWritesWithVerification.mockClear();
    await generateCashPayLink("42", 1030.694999);
    expect(amountTask().value).toBe("1030.69");
  });

  it("⚠️ RETURNED failures throw, naming the column — never a clean resolve", async () => {
    vw.executeWritesWithVerification.mockResolvedValue([
      `Cash Pay Amount (${COL.cashPayAmount}): boom`,
    ]);
    await expect(generateCashPayLink("42", 1030.69)).rejects.toThrow(/Cash Pay Amount/);
    await expect(generateCashPayLink("42", 1030.69)).rejects.toThrow(/no link was requested/);
  });

  it("a clean send resolves, with the action column as the held-back stage", async () => {
    await expect(generateCashPayLink("42", 1030.69)).resolves.toBeUndefined();
    const opts = vw.executeWritesWithVerification.mock.calls[0][0] as {
      stageColumnId: string;
      tasks: WriteTask[];
    };
    expect(opts.stageColumnId).toBe(COL.cashPayAction);
    const stage = opts.tasks.find((t) => t.columnId === COL.cashPayAction);
    expect(stage?.value).toEqual({ index: CASH_PAY_ACTION_INDEX.generate });
    // No expectedText on the trigger — the §9 no-op guard is the CLEAR above,
    // not a refusal, because a cleared column is about to change by design.
    expect(stage?.expectedText).toBeUndefined();
  });

  it("still refuses an order that already has a link, before any write", async () => {
    api.readColumnText.mockImplementation(async (_id: string, col: string) =>
      col === COL.cashPayLink ? "https://checkout.stripe.com/c/pay/cs_x" : "",
    );
    await expect(generateCashPayLink("42", 1030.69)).rejects.toThrow(/already has a payment link/);
    expect(vw.executeWritesWithVerification).not.toHaveBeenCalled();
  });
});
