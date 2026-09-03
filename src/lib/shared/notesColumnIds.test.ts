/**
 * The notes columns were re-created as plain `text` on 2026-09-03 (the long_text
 * originals cap at 2,000 chars and are hidden, not deleted). Every reader and
 * writer must point at the NEW ids; a stray old id would read the frozen
 * original and write into a column nothing displays. CLAUDE.md §10.
 */
import { describe, it, expect } from "vitest";
import { COL as MASHEKE } from "@/lib/masheke/mondayApi";
import { COL as SAMANTHA } from "@/lib/samantha/mondayApi";
import { COL as WELCOME } from "@/lib/welcomeCall/mondayApi";
import { COL as FINAL } from "@/lib/finalConfirm/mondayApi";
import { COL as SUBSCRIPTION } from "@/lib/subscription/mondayApi";
import { BOARDS } from "@/lib/systemMgmt/mondayApi";

const NEW = { ME: "text_mm6vevjf", INS: "text_mm6vzc7q", WC_NOTES: "text_mm6vqq2k", WC_MN: "text_mm6v4fny", WC_PSO: "text_mm6vvsjy", SUB: "text_mm6vp1z3" };
const RETIRED = ["long_text_mm27zjt2", "long_text_mm2ffsme", "long_text_mm5gx6j6", "long_text_mm5g1txs", "long_text_mm3rj7k7"];

describe("notes columns point at the uncapped text columns", () => {
  it("role COL maps", () => {
    expect(MASHEKE.mnEvalNotes).toBe(NEW.ME);
    expect(SAMANTHA.callReferenceNotes).toBe(NEW.INS);
    expect(WELCOME.notes).toBe(NEW.WC_NOTES); expect(WELCOME.mnWorkflowNotes).toBe(NEW.WC_MN); expect(WELCOME.profileSendOffNotes).toBe(NEW.WC_PSO);
    expect(FINAL.notes).toBe(NEW.WC_NOTES); expect(FINAL.mnWorkflowNotes).toBe(NEW.WC_MN); expect(FINAL.profileSendOffNotes).toBe(NEW.WC_PSO);
    expect(SUBSCRIPTION.subscriptionNotes).toBe(NEW.SUB);
  });
  it("the BOARDS registry, with the type declared text", () => {
    const by = (id: number) => BOARDS.find((b) => b.boardId === id)!;
    for (const [board, id] of [[18406060017, NEW.ME], [18410601299, NEW.INS], [18410804557, NEW.WC_NOTES], [18407459988, NEW.SUB]] as const) {
      expect(by(board).notesColId, String(board)).toBe(id);
      expect(by(board).notesColType, String(board)).toBe("text");
    }
  });
  it("no COL map or registry entry still names a retired id", () => {
    const all = [MASHEKE, SAMANTHA, WELCOME, FINAL, SUBSCRIPTION].flatMap((c) => Object.values(c as Record<string, string>)).concat(BOARDS.map((b) => b.notesColId ?? ""));
    for (const old of RETIRED) expect(all, old).not.toContain(old);
  });
});
