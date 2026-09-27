import { describe, it, expect } from "vitest";
import {
  applyMessageReadOverrides,
  applyReadOverrides,
  buildConversations,
  overrideStillApplies,
  pruneMessageReadOverrides,
  pruneReadOverrides,
  resolvedTextIds,
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

describe("read overrides", () => {
  const unreadThread = buildConversations([
    msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", readStatus: "Unread", id: 11 }),
  ]);
  const readThread = buildConversations([msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", id: 11 })]);
  const K = "3475550101";

  it("clears the badge the moment a rep opens the thread", () => {
    const out = applyReadOverrides(unreadThread, new Map([[K, { unread: false, basedOnInboundId: 11 }]]));
    expect(out[0].unread).toBe(0);
    expect(out[0].unreadIds).toEqual([]);
  });

  it("re-badges a conversation the rep marked unread", () => {
    expect(readThread[0].unread).toBe(0);
    expect(applyReadOverrides(readThread, new Map([[K, { unread: true, basedOnInboundId: 11 }]]))[0].unread).toBe(1);
  });

  it("leaves untouched conversations alone", () => {
    expect(applyReadOverrides(unreadThread, new Map())).toBe(unreadThread);
  });

  it("STOPS masking once the patient sends a newer message", () => {
    // The bug this exists to prevent: a rep reads a thread, the patient texts
    // again an hour later, and the row stays looking read — gone from the very
    // filter that exists to surface it.
    const withNewer = buildConversations([
      msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", id: 11 }),
      msg({ dir: "Inbound", at: "2026-09-01T11:00:00Z", readStatus: "Unread", id: 22 }),
    ]);
    const stale = new Map([[K, { unread: false, basedOnInboundId: 11 }]]);
    expect(overrideStillApplies(withNewer[0], stale.get(K)!)).toBe(false);
    expect(applyReadOverrides(withNewer, stale)[0].unread).toBe(1);
  });

  it("keeps masking while the same message is the newest", () => {
    expect(overrideStillApplies(unreadThread[0], { unread: false, basedOnInboundId: 11 })).toBe(true);
  });

  it("prunes an override a newer message has retired", () => {
    const withNewer = buildConversations([
      msg({ dir: "Inbound", at: "2026-09-01T10:00:00Z", id: 11 }),
      msg({ dir: "Inbound", at: "2026-09-01T11:00:00Z", readStatus: "Unread", id: 22 }),
    ]);
    const pruned = pruneReadOverrides(withNewer, new Map([[K, { unread: false, basedOnInboundId: 11 }]]));
    expect(pruned.size).toBe(0);
  });

  it("returns the SAME map when nothing needs pruning, so callers can skip a render", () => {
    const live = new Map([[K, { unread: false, basedOnInboundId: 11 }]]);
    expect(pruneReadOverrides(unreadThread, live)).toBe(live);
  });

  it("keeps an override for a conversation that has scrolled out of the window", () => {
    // Absence is not evidence — discarding it would re-badge the row if the
    // conversation came back into the fetched window.
    const live = new Map([["9998887777", { unread: true, basedOnInboundId: 5 }]]);
    expect(pruneReadOverrides(unreadThread, live).size).toBe(1);
  });
});


describe("fax read overrides", () => {
  const faxes = [
    { id: 1, read: false },
    { id: 2, read: true },
  ];

  it("returns the SAME array when nothing is overridden, so no re-render", () => {
    expect(applyMessageReadOverrides(faxes, new Map())).toBe(faxes);
    // An override RingCentral has already caught up with changes nothing.
    expect(applyMessageReadOverrides(faxes, new Map([[2, true]]))).toBe(faxes);
  });

  it("applies a rep's click on top of RingCentral's answer", () => {
    const out = applyMessageReadOverrides(faxes, new Map([[1, true]]));
    expect(out).not.toBe(faxes);
    expect(out.map((f) => f.read)).toEqual([true, true]);
    // The source rows are untouched — the override layer never mutates.
    expect(faxes[0].read).toBe(false);
  });

  it("marks a read fax back to unread", () => {
    expect(applyMessageReadOverrides(faxes, new Map([[2, false]])).map((f) => f.read)).toEqual([false, false]);
  });

  it("prunes an override RingCentral has caught up with", () => {
    // This is what stops the map growing for the life of the tab — a rep opens
    // a lot of faxes in a day.
    expect([...pruneMessageReadOverrides(faxes, new Map([[2, true]]))]).toEqual([]);
  });

  it("keeps an override RingCentral still disagrees with", () => {
    expect([...pruneMessageReadOverrides(faxes, new Map([[1, true]]))]).toEqual([[1, true]]);
  });

  it("keeps an override for a fax that has dropped out of the window", () => {
    // Its absence is not evidence of anything, and discarding it would re-badge
    // the row if it scrolled back in — same rule as `pruneReadOverrides`.
    expect([...pruneMessageReadOverrides(faxes, new Map([[99, true]]))]).toEqual([[99, true]]);
  });

  it("returns the SAME map when nothing was pruned", () => {
    const m = new Map([[1, true]]);
    expect(pruneMessageReadOverrides(faxes, m)).toBe(m);
    expect(pruneMessageReadOverrides(faxes, new Map())).toEqual(new Map());
  });
});

/* A Comms resolve marks the item's texts read (Josh, 2026-09-27), the same ids
 * opening the conversation in the Text tab writes. */
describe("resolvedTextIds", () => {
  const COVER = Date.parse("2026-09-25T12:30:00Z");
  const unread = (id: number, at: string, who = P1, type = "SMS") =>
    msg({ dir: "Inbound", at, who, id, type, readStatus: "Unread" });

  it("every unread inbound text on the item's numbers — not only the newest", () => {
    const ids = resolvedTextIds(
      [unread(1, "2026-09-25T12:00:00Z"), unread(2, "2026-09-25T12:10:00Z"), msg({ dir: "Inbound", at: "2026-09-25T12:05:00Z", id: 3 })],
      [P1],
      COVER,
    );
    expect(ids.sort()).toEqual([1, 2]);
  });

  it("covers both of a patient's numbers, and no one else's", () => {
    const ids = resolvedTextIds(
      [unread(1, "2026-09-25T12:00:00Z", P1), unread(2, "2026-09-25T12:00:00Z", P2), unread(3, "2026-09-25T12:00:00Z", "+12125550000")],
      [P1, "(609) 555-0199"],
      COVER,
    );
    expect(ids.sort()).toEqual([1, 2]);
  });

  // ⚠️⚠️ A text after what the rep was shown stays OPEN in the Inbox — so unread.
  it("⚠️ never a text newer than what the resolve covered", () => {
    const ids = resolvedTextIds([unread(1, "2026-09-25T12:29:59Z"), unread(2, "2026-09-25T12:30:01Z")], [P1], COVER);
    expect(ids).toEqual([1]);
  });

  it("an MMS is a text; a voicemail or a fax on the same number is not", () => {
    const ids = resolvedTextIds(
      [unread(1, "2026-09-25T12:00:00Z", P1, "MMS"), unread(2, "2026-09-25T12:00:00Z", P1, "VoiceMail"), unread(3, "2026-09-25T12:00:00Z", P1, "Fax")],
      [P1],
      COVER,
    );
    expect(ids).toEqual([1]);
  });

  it("nothing without a usable number or cover", () => {
    expect(resolvedTextIds([unread(1, "2026-09-25T12:00:00Z")], [""], COVER)).toEqual([]);
    expect(resolvedTextIds([unread(1, "2026-09-25T12:00:00Z")], [P1], NaN)).toEqual([]);
  });
});
