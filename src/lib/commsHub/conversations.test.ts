import { describe, it, expect } from "vitest";
import {
  applyReadOverrides,
  buildConversations,
  totalUnread,
  type RcConversationRecord,
} from "./conversations";

const P1 = "+13475550101", P2 = "+16095550199", MM = "+13475037148";

function msg(over: Partial<RcConversationRecord> & { dir: "Inbound" | "Outbound"; at: string; who?: string }): RcConversationRecord {
  const { dir, at, who = P1, ...rest } = over;
  return {
    id: Math.floor(Math.random() * 1e9),
    type: "SMS",
    direction: dir,
    creationTime: at,
    readStatus: "Read",
    ...(dir === "Inbound"
      ? { from: { phoneNumber: who }, to: [{ phoneNumber: MM }] }
      : { from: { phoneNumber: MM }, to: [{ phoneNumber: who }] }),
    ...rest,
  };
}

describe("buildConversations", () => {
  it("collapses a thread into one row keyed on the patient", () => {
    const rows = buildConversations([
      msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", subject: "hi" }),
      msg({ dir: "Outbound", at: "2026-09-01T11:00:00Z", subject: "hello back" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("3475550101");
    expect(rows[0].preview).toBe("hello back");
    expect(rows[0].lastDirection).toBe("Outbound");
  });

  it("orders newest conversation first", () => {
    const rows = buildConversations([
      msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", who: P1 }),
      msg({ dir: "Inbound", at: "2026-09-01T12:00:00Z", who: P2 }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["6095550199", "3475550101"]);
  });

  it("counts only INBOUND unread", () => {
    // RingCentral reports outbound as Read on send, so counting both
    // directions would make every conversation permanently read.
    const rows = buildConversations([
      msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", readStatus: "Unread", id: 11 }),
      msg({ dir: "Inbound", at: "2026-09-01T10:05:00Z", readStatus: "Unread", id: 12 }),
      msg({ dir: "Outbound", at: "2026-09-01T09:00:00Z", readStatus: "Unread", id: 13 }),
    ]);
    expect(rows[0].unread).toBe(2);
    expect(rows[0].unreadIds.sort()).toEqual([11, 12]);
    expect(totalUnread(rows)).toBe(2);
  });

  it("names the newest inbound message, which is what mark-as-unread flips", () => {
    const rows = buildConversations([
      msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", id: 11 }),
      msg({ dir: "Inbound", at: "2026-09-01T12:00:00Z", id: 22 }),
      msg({ dir: "Outbound", at: "2026-09-01T13:00:00Z", id: 33 }),
    ]);
    expect(rows[0].newestInboundId).toBe(22);
  });

  it("describes a media-only MMS instead of showing an empty row", () => {
    const rows = buildConversations([
      msg({
        dir: "Inbound",
        at: "2026-09-01T10:00:00Z",
        type: "MMS",
        subject: "",
        attachments: [{ id: 1, type: "MmsAttachment", contentType: "image/jpeg" }],
      }),
    ]);
    expect(rows[0].preview).toContain("Attachment");
  });

  it("ignores Fax and VoiceMail rows in the same store", () => {
    expect(buildConversations([msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", type: "Fax" })])).toEqual([]);
  });

  it("flags a failed outbound text so it is visible from the LIST", () => {
    const rows = buildConversations([
      msg({ dir: "Outbound", at: "2026-09-01T10:00:00Z", messageStatus: "SendingFailed", subject: "hi" }),
    ]);
    expect(rows[0].failed).toBe(true);
  });

  it("does not call a still-sending message failed", () => {
    // STATUS decides and an unknown status is PENDING, never failed (§5.5) —
    // marking an in-flight message undelivered makes the rep double-text.
    const rows = buildConversations([
      msg({ dir: "Outbound", at: "2026-09-01T10:00:00Z", messageStatus: "Queued", subject: "hi" }),
    ]);
    expect(rows[0].failed).toBe(false);
  });

  it("never opens a conversation with our own line", () => {
    const rows = buildConversations(
      [{ type: "SMS", direction: "Inbound", creationTime: "2026-09-01T10:00:00Z", from: { phoneNumber: MM }, to: [{ phoneNumber: MM }] }],
      { ownNumbers: [MM] },
    );
    expect(rows).toEqual([]);
  });
});

describe("applyReadOverrides", () => {
  const base = buildConversations([
    msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", readStatus: "Unread", id: 11 }),
  ]);

  it("clears the badge the moment a rep opens the thread", () => {
    const out = applyReadOverrides(base, new Map([["3475550101", false]]));
    expect(out[0].unread).toBe(0);
    expect(out[0].unreadIds).toEqual([]);
  });

  it("re-badges a conversation the rep marked unread", () => {
    const read = buildConversations([msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", id: 11 })]);
    expect(read[0].unread).toBe(0);
    expect(applyReadOverrides(read, new Map([["3475550101", true]]))[0].unread).toBe(1);
  });

  it("leaves untouched conversations alone", () => {
    expect(applyReadOverrides(base, new Map())).toBe(base);
  });
});
