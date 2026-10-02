/**
 * Why a patient is escalated, read from what the escalating person wrote (Josh, 2026-10-02). The fixtures are built
 * with Command Center's own writers, so a change to a writer's format fails here instead of silently reading "none".
 */
import { describe, it, expect, vi } from "vitest";
import { extractEscReason, edgeCaseReason, fetchEscReasons, intakeDecision } from "./escReason";
import { classifyEscalation } from "./escClass";
import { stampProposedStuck, stampEscalatedToFinal, stampReturnedToQueue } from "@/lib/masheke/proposedStuck";
import { proposeStuckNoteLine } from "@/lib/profile/unverifiedWrite";
import { stampNoteEntry } from "@/lib/shared/noteStamp";

const NOW = new Date(2026, 9, 1, 14, 33);
/** An intake decision line exactly as appendIntakeNote writes it. */
const intakeLine = (body: string) => stampNoteEntry(body, "Patient Intake", { initials: "KT", now: NOW });

describe("intake (Profile Send Off): note-stamped lines", () => {
  it("reads the reason, date and initials from a stamped Proposed stuck line", () => {
    const r = extractEscReason("INT", `call log\n\n${intakeLine(proposeStuckNoteLine("bad number", "processor"))}`);
    expect(r).toEqual({ source: "proposedStuck", text: "bad number", date: "Oct 1, 2026, 2:33 PM", by: "KT", earlier: false });
  });
  it("a manager's proposal from Manager Intervention keeps only the reason", () => {
    expect(extractEscReason("INT", intakeLine(proposeStuckNoteLine("declined", "manager-intervention"))).text).toBe("declined");
  });
  it("Escalated: is its own source, and the latest line wins", () => {
    const r = extractEscReason("INT", `${intakeLine(proposeStuckNoteLine("x", "processor"))}\n\n${intakeLine("Escalated: needs a manager")}`);
    expect(r.source).toBe("escalated"); expect(r.text).toBe("needs a manager");
  });
  it("a return written after the reason marks it as earlier", () => {
    const r = extractEscReason("INT", `${intakeLine("Escalated: a")}\n\n${intakeLine("Returned to pipeline: fixed")}`);
    expect(r.text).toBe("a"); expect(r.earlier).toBe(true);
  });
  it("bare (unstamped) lines still parse; call logs and imports do not", () => {
    expect(intakeDecision("Proposed stuck: no answer")?.body).toBe("no answer");
    expect(intakeDecision("[Sep 1, 2026, 3:36 PM] Patient Intake: Called, no answer —MT")).toBeNull();
    expect(intakeDecision("Notes: === Imported from board ===")).toBeNull();
  });
  it("the reason column and the classifier agree on a stamped intake line", () => {
    const it0 = { boardKey: "INT" as const, groupId: "g", values: {} };
    expect(classifyEscalation(it0, intakeLine(proposeStuckNoteLine("bad number", "processor")))).toBe("proposedStuck");
    expect(classifyEscalation(it0, intakeLine("Escalated: help"))).toBe("unclassified");
  });
});

describe("Medical Evaluation, Insurance, Welcome Call: bracket tags", () => {
  it("Proposed Stuck", () => {
    expect(extractEscReason("MN", `x\n\n${stampProposedStuck("doctor refuses", "2026-10-01", "JN")}`))
      .toEqual({ source: "proposedStuck", text: "doctor refuses", date: "2026-10-01", by: "JN", earlier: false });
  });
  it("Escalated to Final after a proposal: the manager's why is the latest", () => {
    const r = extractEscReason("INS", `${stampProposedStuck("a", "2026-09-30")}\n\n${stampEscalatedToFinal("payer won't budge", "2026-10-01", "JN")}`);
    expect(r.source).toBe("escalatedToFinal"); expect(r.text).toBe("payer won't budge");
  });
  it("Insurance's Auto-escalated line", () => {
    const r = extractEscReason("INS", "[Auto-escalated · 2026-10-01 · SB] In-Network = Out-of-Network; DME Benefits = Not Covered");
    expect(r).toMatchObject({ source: "autoEscalated", text: "In-Network = Out-of-Network; DME Benefits = Not Covered", by: "SB" });
  });
  it("a return after the reason marks it earlier", () => {
    expect(extractEscReason("WC", `${stampProposedStuck("a", "2026-09-30")}\n\n${stampReturnedToQueue("", "2026-10-01")}`).earlier).toBe(true);
  });
  it("no line: the Escalation Reason dropdown on Medical Evaluation and Welcome Call, never on Insurance", () => {
    expect(extractEscReason("MN", "call log", "Doctor Unresponsive")).toMatchObject({ source: "dropdown", text: "Doctor Unresponsive" });
    expect(extractEscReason("INS", "call log", "Doctor Unresponsive").source).toBe("none");
  });
  it("nothing written is 'none', not a guess", () => {
    expect(extractEscReason("WC", "")).toEqual({ source: "none", text: "", date: "", by: "", earlier: false });
  });
});

describe("automatic Edge Case triggers are named", () => {
  it("attempts used up, evaluated 3+ times, Auth Denied", () => {
    expect(edgeCaseReason("MN", { attemptsIndex: 0 })).toMatch(/attempts used up/);
    expect(edgeCaseReason("MN", { stageIndex: 8, evalCount: 3 })).toBe("Evaluated 3 times");
    expect(edgeCaseReason("INS", { groupId: "group_mm316hg2" })).toBe("In the Auth Denied group");
    expect(edgeCaseReason("WC", {})).toBe("");
  });
});

describe("fetchEscReasons", () => {
  it("reads only the asked rows, read-only, and returns reasons by row key", async () => {
    const gqlMod = await import("../data/gql");
    const calls: { query: string; vars: Record<string, unknown> }[] = [];
    gqlMod.__setGqlTransport(async (_u, init) => {
      const body = JSON.parse(String(init?.body)); calls.push({ query: body.query, vars: body.variables });
      const items = (body.variables.ids as string[]).map((id) => ({ id, group: { id: "g" }, column_values: [
        { id: "text_mm6vevjf", text: id === "1" ? stampProposedStuck("no doctor", "2026-10-01", "MT") : "" },
        { id: "color_mm1wz0vg", text: "Escalate", index: id === "2" ? 0 : 3 },
      ] }));
      return new Response(JSON.stringify({ data: { items, complexity: { before: 1e6, after: 1e6, reset_in_x_seconds: 1 } } }), { status: 200 });
    }, vi.fn(async () => {}));
    const out = await fetchEscReasons([{ key: "MN:1", boardKey: "MN", itemId: "1" }, { key: "MN:2", boardKey: "MN", itemId: "2" }]);
    expect(out["MN:1"]).toMatchObject({ source: "proposedStuck", text: "no doctor" });
    expect(out["MN:2"]).toMatchObject({ source: "edgeCase" });
    expect(calls).toHaveLength(1);
    expect(calls[0].query.trim().startsWith("query")).toBe(true); // read-only (the T-RO guard bans the word itself)
  });
});
