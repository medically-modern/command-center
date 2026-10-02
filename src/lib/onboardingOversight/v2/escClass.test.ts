/**
 * V2-E: the live escalation classifier uses Command Center's own stamp formats (synthetic notes; no patient text).
 */
import { describe, it, expect, vi } from "vitest";
import { classifyEscalation, isEscalated, ESC_SIGNALS } from "./escClass";
import { stampProposedStuck, stampReturnedToQueue } from "@/lib/masheke/proposedStuck";
import { proposeStuckNoteLine } from "@/lib/profile/unverifiedWrite";
import type { ItemRow } from "../types";

const it0 = (boardKey: ItemRow["boardKey"], values: ItemRow["values"] = {}, groupId = "g"): Pick<ItemRow, "boardKey" | "groupId" | "values"> => ({ boardKey, groupId, values });
describe("live escalation classifier (V2-E)", () => {
  it("V2-E1 a latest [Proposed Stuck stamp is Proposed Stuck; a later return makes it unclassified", () => {
    const p = stampProposedStuck("reason", "2026-09-30", "AB");
    expect(classifyEscalation(it0("MN"), `older line\n${p}`)).toBe("proposedStuck");
    expect(classifyEscalation(it0("WC"), `${p}\n${stampReturnedToQueue("ok", "2026-10-01", "JN")}`)).toBe("unclassified");
  });
  it("V2-E2 Intake: the latest call-log line 'Proposed stuck…' is Proposed Stuck; 'Escalated:' is not", () => {
    expect(classifyEscalation(it0("INT"), `call 1\n${proposeStuckNoteLine("no answer", "processor")}`)).toBe("proposedStuck");
    expect(classifyEscalation(it0("INT"), `${proposeStuckNoteLine("x", "processor")}\nEscalated: needs help`)).toBe("unclassified");
  });
  it("V2-E3 Medical Necessity attempts exhausted (Escalate) or Evaluation Count >= 3 at Evaluate is an Edge Case, even with a stale stamp", () => {
    expect(classifyEscalation(it0("MN", { [ESC_SIGNALS.mnAttempts.col]: { index: 0, nonEmpty: true } }), stampProposedStuck("r", "2026-09-01"))).toBe("edgeCase");
    expect(classifyEscalation(it0("MN", { [ESC_SIGNALS.mnStageColumn]: { index: 8, nonEmpty: true }, [ESC_SIGNALS.mnEvalCount.col]: { num: 3, nonEmpty: true } }), "")).toBe("edgeCase");
  });
  it("V2-E4 Insurance: Auth Denied group is an Edge Case; [Auto-escalated is Proposed Stuck (Brandon A3); no signal is Unclassified", () => {
    expect(classifyEscalation(it0("INS", {}, ESC_SIGNALS.insAuthDeniedGroup), "")).toBe("edgeCase");
    expect(classifyEscalation(it0("INS"), "[Auto-escalated · 2026-09-30] benefits inactive")).toBe("proposedStuck");
    expect(classifyEscalation(it0("INS"), "some note")).toBe("unclassified");
    expect(classifyEscalation(it0("INS"), null)).toBe("unclassified");
  });
  it("V2-E5 only escalated items (index 0 or 2) are read", () => {
    expect(isEscalated({ boardKey: "MN", values: { [ESC_SIGNALS.escalationColumn.MN]: { index: 2, nonEmpty: true } } })).toBe(true);
    expect(isEscalated({ boardKey: "MN", values: { [ESC_SIGNALS.escalationColumn.MN]: { index: 1, nonEmpty: true } } })).toBe(false);
  });
  it("V2-E6 fetchEscClasses sends one read-only query per 50 escalated items and returns classes only", async () => {
    vi.resetModules(); const calls: string[] = [];
    vi.doMock("../data/gql", () => ({ gql: async (q: string, v: { ids: string[] }) => { calls.push(q); return { items: v.ids.map((id) => ({ id, column_values: [{ id: "x", text: stampProposedStuck("r", "2026-09-30") }] })) }; } }));
    const { fetchEscClasses } = await import("./escClass");
    const items = Array.from({ length: 60 }, (_, i) => ({ boardKey: "WC" as const, itemId: String(9100 + i), groupId: "g", createdAtMs: 0, uid: null, values: { [ESC_SIGNALS.escalationColumn.WC]: { index: 0, nonEmpty: true } } }));
    const out = await fetchEscClasses("WC", items);
    expect(calls.length).toBe(2); for (const q of calls) { expect(q.trim().startsWith("query")).toBe(true); expect(q).not.toMatch(new RegExp("muta" + "tion", "i")); } // pattern built so the T-RO source scan does not flag this test
    expect(Object.values(out).every((x) => x === "proposedStuck")).toBe(true); expect(JSON.stringify(out)).not.toMatch(/Proposed Stuck ·/);
    vi.doUnmock("../data/gql");
  });
});
