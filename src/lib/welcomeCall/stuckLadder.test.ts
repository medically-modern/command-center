/**
 * The Welcome Call board's Propose Stuck ladder (CLAUDE.md §5.34) — the write
 * ORDER of each rung, the label guard, and the two things the send path must
 * never do again.
 *
 * Every writer here is a status flip that moves a patient between people's
 * queues, so the order is the contract:
 *   · the reason lands in Notes BEFORE the status flips (a manager must never
 *     open a row whose reason has not landed);
 *   · a promotion to Final is REFUSED before any write when the board has no
 *     label at that id — Monday takes a write to a missing label id at HTTP
 *     200, so an unguarded promotion would stamp a reason and flip nothing;
 *   · Approve writes the Stage Advancer (the automation trigger) before it
 *     clears the flag; Return clears the Follow Up snooze before it clears the
 *     flag — the flip that makes the patient visible is always LAST.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const calls = vi.hoisted(() => [] as string[]);
const board = vi.hoisted(() => ({
  notes: "" as string,
  escalation: "" as string,
  /** Label ids the live Escalation column carries. */
  labels: [0, 1, 2] as number[],
}));

vi.mock("./mondayApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mondayApi")>();
  return {
    ...actual,
    readColumnTexts: vi.fn(async (_itemId: string, ids: string[]) =>
      ids.map((id) => ({
        id,
        text: id === actual.COL.notes ? board.notes : id === actual.COL.escalation ? board.escalation : "",
      })),
    ),
    writeLongText: vi.fn(async (_itemId: string, columnId: string, text: string) => {
      calls.push(`longtext:${columnId}:${text.split("\n").pop()}`);
    }),
    writeStatusIndex: vi.fn(async (_itemId: string, columnId: string, index: number) => {
      calls.push(`status:${columnId}:${index}`);
    }),
    clearStatusColumn: vi.fn(async (_itemId: string, columnId: string) => {
      calls.push(`clearStatus:${columnId}`);
    }),
    clearDateColumn: vi.fn(async (_itemId: string, columnId: string) => {
      calls.push(`clearDate:${columnId}`);
    }),
  };
});

vi.mock("@/lib/shared/statusOptions", () => ({
  fetchStatusOptions: vi.fn(async (_boardId: unknown, cols: string[]) => ({
    [cols[0]]: board.labels.map((index) => ({ index, label: `label-${index}` })),
  })),
  invalidateStatusOptions: vi.fn(() => calls.push("invalidate")),
}));

vi.mock("@/lib/shared/longText", () => ({
  assertTextLikeFits: vi.fn(async () => undefined),
}));
vi.mock("@/lib/shared/auth", () => ({ userInitials: () => "JH" }));
vi.mock("@/lib/masheke/etDate", () => ({ etToday: () => "2026-09-14" }));

import {
  proposeWelcomeCallStuck,
  approveWelcomeCallStuck,
  returnWelcomeCallToQueue,
  escalateWelcomeCallToFinal,
  STAGE_ADVANCER_STUCK,
} from "./mondayWrite";
import { COL, ESCALATION_INDEX } from "./mondayApi";
import { PROPOSED_STUCK_TAG, RETURNED_TO_QUEUE_TAG, APPROVED_STUCK_TAG, ESCALATED_TO_FINAL_TAG } from "@/lib/masheke/proposedStuck";

beforeEach(() => {
  calls.length = 0;
  board.notes = "";
  board.escalation = "";
  board.labels = [0, 1, 2];
});

describe("ESCALATION_INDEX — the label ids, read off the live board", () => {
  it("is the Medical Evaluation lineage: 0 manager · 1 done · 2 final", () => {
    expect(ESCALATION_INDEX).toEqual({ manager: 0, done: 1, final: 2 });
  });
});

describe("proposeWelcomeCallStuck", () => {
  it("stamps the reason into Notes FIRST, then flips Escalation to the manager rung", async () => {
    const level = await proposeWelcomeCallStuck("42", "doctor unreachable", "manager");
    expect(level).toBe("manager");
    expect(calls).toEqual([
      `longtext:${COL.notes}:[${PROPOSED_STUCK_TAG.slice(1)} · 2026-09-14 · JH] doctor unreachable`,
      `status:${COL.escalation}:${ESCALATION_INDEX.manager}`,
    ]);
  });

  it("promotes to Final when asked, and never DOWNGRADES a patient already at Final", async () => {
    board.escalation = "Final Escalation Required";
    const level = await proposeWelcomeCallStuck("42", "second look", "manager");
    expect(level).toBe("final");
    expect(calls.at(-1)).toBe(`status:${COL.escalation}:${ESCALATION_INDEX.final}`);
  });

  it("refuses a Final promotion BEFORE any write when the board has no label at id 2", async () => {
    board.labels = [0, 1]; // the live column before the label was added on 2026-09-14
    await expect(proposeWelcomeCallStuck("42", "reason", "final")).rejects.toThrow(/no "Final Escalation Required" label/);
    // Nothing reached the board — no stamp without a flip, and the option
    // cache is dropped so a retry after the board change sees the new label.
    expect(calls).toEqual(["invalidate"]);
  });

  it("still allows the MANAGER rung while id 2 is missing", async () => {
    board.labels = [0, 1];
    await proposeWelcomeCallStuck("42", "reason", "manager");
    expect(calls.at(-1)).toBe(`status:${COL.escalation}:${ESCALATION_INDEX.manager}`);
  });

  it("requires a reason", async () => {
    await expect(proposeWelcomeCallStuck("42", "   ", "manager")).rejects.toThrow(/reason is required/);
    expect(calls).toEqual([]);
  });

  it("appends to the LIVE notes, never clobbering what is already there", async () => {
    board.notes = "[Sep 1, 2026, 9:00 AM] Welcome Call: called, no answer —JH";
    await proposeWelcomeCallStuck("42", "won't pick up", "manager");
    expect(calls[0]).toMatch(/^longtext:/);
    // The stamped line is the LAST line of the appended body (the mock keeps it).
    expect(calls[0]).toContain("won't pick up");
  });
});

describe("escalateWelcomeCallToFinal (Manager Intervention → Final Decisions)", () => {
  it("requires a note, guards the label, stamps, then flips to Final", async () => {
    await expect(escalateWelcomeCallToFinal("42", "")).rejects.toThrow(/note is required/);
    expect(calls).toEqual([]);
    await escalateWelcomeCallToFinal("42", "payer denied twice");
    expect(calls).toEqual([
      `longtext:${COL.notes}:[${ESCALATED_TO_FINAL_TAG.slice(1)} · 2026-09-14 · JH] payer denied twice`,
      `status:${COL.escalation}:${ESCALATION_INDEX.final}`,
    ]);
  });

  it("is idempotent on retry — a stamp already in Notes is not appended twice", async () => {
    board.notes = `[${ESCALATED_TO_FINAL_TAG.slice(1)} · 2026-09-14 · JH] payer denied twice`;
    await escalateWelcomeCallToFinal("42", "payer denied twice");
    expect(calls).toEqual([`status:${COL.escalation}:${ESCALATION_INDEX.final}`]);
  });
});

describe("approveWelcomeCallStuck (Final Decisions → Stuck)", () => {
  it("optional note, then Stage Advancer → Stuck / Don't Proceed, then Escalation → Done", async () => {
    await approveWelcomeCallStuck("42", "no path forward");
    expect(calls).toEqual([
      `longtext:${COL.notes}:[${APPROVED_STUCK_TAG.slice(1)} · 2026-09-14 · JH] no path forward`,
      `status:${COL.stageAdvancer}:${STAGE_ADVANCER_STUCK}`,
      `status:${COL.escalation}:${ESCALATION_INDEX.done}`,
    ]);
  });

  it("writes no note line when the manager left the box blank", async () => {
    await approveWelcomeCallStuck("42");
    expect(calls).toEqual([
      `status:${COL.stageAdvancer}:${STAGE_ADVANCER_STUCK}`,
      `status:${COL.escalation}:${ESCALATION_INDEX.done}`,
    ]);
  });

  it("targets the Stuck label the board's move automation (7918322174) keys on", () => {
    expect(STAGE_ADVANCER_STUCK).toBe(2);
  });
});

describe("returnWelcomeCallToQueue (send back to pipeline)", () => {
  it("stamps (defaulting the note), clears the Follow Up snooze, and clears the flag LAST", async () => {
    await returnWelcomeCallToQueue("42");
    expect(calls).toEqual([
      `longtext:${COL.notes}:[${RETURNED_TO_QUEUE_TAG.slice(1)} · 2026-09-14 · JH] Returned by a manager`,
      `clearStatus:${COL.followUp}`,
      `clearDate:${COL.followUpDate}`,
      `status:${COL.escalation}:${ESCALATION_INDEX.done}`,
    ]);
  });

  it("carries the manager's own note when given", async () => {
    await returnWelcomeCallToQueue("42", "call the daughter first");
    expect(calls[0]).toContain("call the daughter first");
  });
});

/* ── The send path must stay out of the Escalation column ──
   `escalated` is hydrated from the board now. A send that re-wrote it would
   re-assert a proposal or overwrite a manager's decision on every Send (§7's
   Insurance lesson). Source scan, the listColumns.test.ts convention. */
describe("neither stage's send writes the Escalation column", () => {
  it.each([
    ["src/lib/welcomeCall/mondayWrite.ts", "sendPatientToMonday", "sendWelcomeCallTextToMonday"],
    ["src/lib/finalConfirm/mondayWrite.ts", "sendPatientToMonday", null],
  ])("%s", (file, sendFn, textFn) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    const start = src.indexOf(`export async function ${sendFn}(`);
    expect(start).toBeGreaterThan(-1);
    const end = textFn ? src.indexOf(`export async function ${textFn}(`) : src.length;
    const body = src.slice(start, end);
    // A task or a direct write naming the escalation column inside the send.
    expect(body).not.toMatch(/columnId:\s*COL\.escalation\b/);
    expect(body).not.toMatch(/writeStatusIndex\([^)]*COL\.escalation/);
    expect(src).not.toMatch(/if \(p\.escalated\)/);
  });
});
