import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOOSE_MATCH_MS, attributeSenders, senderFor, senderIndex } from "./sentAttribution.mjs";

const gatewaySrc = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");

const rows = [
  { rc_message_id: "m1", sender_email: "katie@medicallymodern.com", sent_at: "2026-09-22T13:00:00Z" },
  { rc_message_id: null, sender_email: "josh@medicallymodern.com", sent_at: "2026-09-22T14:00:00Z" },
  { rc_message_id: null, sender_email: "masheke@medicallymodern.com", sent_at: "2026-09-22T14:01:00Z" },
];

describe("who sent an outbound text", () => {
  it("matches RingCentral's id exactly when the send logged one", () => {
    expect(senderFor({ id: "m1", at: "2026-09-22T20:00:00Z" }, senderIndex(rows))).toBe("katie@medicallymodern.com");
  });
  it("otherwise the FIRST unlogged send to that number within two minutes", () => {
    expect(senderFor({ id: "x", at: "2026-09-22T14:00:30Z" }, senderIndex(rows))).toBe("josh@medicallymodern.com");
    expect(senderFor({ id: "x", at: new Date("2026-09-22T14:00:00Z").getTime() + LOOSE_MATCH_MS + 1000 }, senderIndex(rows))).toBe(
      "masheke@medicallymodern.com",
    );
  });
  it("an automated text — nobody here pressed Send — has no sender", () => {
    expect(senderFor({ id: "robot", at: "2026-09-22T09:00:00Z" }, senderIndex(rows))).toBe("");
  });
  it("stamps outbound messages in place, as the conversation route always has", () => {
    const messages = [
      { id: "m1", direction: "Outbound", time: "2026-09-22T13:00:05Z" },
      { id: "in", direction: "Inbound", time: "2026-09-22T14:00:10Z" },
    ];
    attributeSenders(messages, rows);
    expect(messages[0].sentBy).toBe("katie@medicallymodern.com");
    expect(messages[1].sentBy).toBeUndefined();
  });
  it("⚠️ the conversation route uses THIS rule — one rule, two readers", () => {
    const src = gatewaySrc("messaging.mjs");
    expect(src).toMatch(/attributeSenders\(messages, rows\.rows\)/);
    expect(src).not.toMatch(/loose\.find\(/);
  });
});
