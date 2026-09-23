import { describe, it, expect } from "vitest";
import { CALL_LOG_FILTERS, TEXT_LOG_FILTERS, callLogMatches, textLogMatches } from "./logFilters";
import { buildConversations, type RcConversationRecord } from "./conversations";

const MM = "+13475037148";
const text = (dir: "Inbound" | "Outbound", at: string, who = "+15555550101"): RcConversationRecord => ({
  id: Math.floor(Math.random() * 1e9),
  type: "SMS",
  direction: dir,
  creationTime: at,
  readStatus: "Read",
  ...(dir === "Inbound"
    ? { from: { phoneNumber: who }, to: [{ phoneNumber: MM }] }
    : { from: { phoneNumber: MM }, to: [{ phoneNumber: who }] }),
});

describe("the Texts log — All · Received · Sent", () => {
  it("is exactly the mockup's three, in its order", () => {
    expect(TEXT_LOG_FILTERS.map((f) => f.label)).toEqual(["All", "Received", "Sent"]);
  });

  it("a thread with both directions appears under both — either, not 'last'", () => {
    const [both] = buildConversations([text("Inbound", "2026-09-01T10:00:00Z"), text("Outbound", "2026-09-01T11:00:00Z")]);
    expect(both.hasInbound && both.hasOutbound).toBe(true);
    expect(textLogMatches(both, "in")).toBe(true);
    expect(textLogMatches(both, "out")).toBe(true);
  });

  it("one we only ever sent to is Sent and not Received", () => {
    const [sent] = buildConversations([text("Outbound", "2026-09-01T11:00:00Z", "+15555550102")]);
    expect(textLogMatches(sent, "in")).toBe(false);
    expect(textLogMatches(sent, "out")).toBe(true);
    expect(textLogMatches(sent, "all")).toBe(true);
  });

  it("one that only ever texted us is Received and not Sent", () => {
    const [recv] = buildConversations([text("Inbound", "2026-09-01T11:00:00Z", "+15555550103")]);
    expect(textLogMatches(recv, "in")).toBe(true);
    expect(textLogMatches(recv, "out")).toBe(false);
  });
});

describe("the Calls log — All · Inbound · Outbound · Missed", () => {
  const answeredIn = { inbound: true, connected: true };
  const missedIn = { inbound: true, connected: false };
  const unansweredOut = { inbound: false, connected: false };

  it("is exactly the mockup's four, in its order", () => {
    expect(CALL_LOG_FILTERS.map((f) => f.label)).toEqual(["All", "Inbound", "Outbound", "Missed"]);
  });

  it("⚠️ Missed is an INBOUND call nobody answered — never an outbound one that rang out", () => {
    expect(callLogMatches(missedIn, "missed")).toBe(true);
    expect(callLogMatches(answeredIn, "missed")).toBe(false);
    expect(callLogMatches(unansweredOut, "missed")).toBe(false);
  });

  it("Inbound includes the missed ones; Outbound is ours, answered or not", () => {
    expect(callLogMatches(missedIn, "in")).toBe(true);
    expect(callLogMatches(answeredIn, "in")).toBe(true);
    expect(callLogMatches(unansweredOut, "in")).toBe(false);
    expect(callLogMatches(unansweredOut, "out")).toBe(true);
    expect(callLogMatches(answeredIn, "out")).toBe(false);
  });

  it("All is everything", () => {
    for (const r of [answeredIn, missedIn, unansweredOut]) expect(callLogMatches(r, "all")).toBe(true);
  });
});
