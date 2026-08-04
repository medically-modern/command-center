import { describe, expect, it } from "vitest";
import { isUnread } from "./useAssignedThreads";

/**
 * Per-rep unread. RingCentral's own readStatus is ACCOUNT-wide — one rep
 * opening a thread would clear the dot for everybody — so unread is derived
 * from "has the patient said anything since I last opened this".
 */
describe("isUnread", () => {
  it("is unread when the patient has written and the rep never opened it", () => {
    expect(isUnread("2026-08-04T10:00:00Z", null)).toBe(true);
  });

  it("is read once the rep opened it after the last inbound message", () => {
    expect(isUnread("2026-08-04T10:00:00Z", "2026-08-04T10:05:00Z")).toBe(false);
  });

  it("goes unread again when the patient replies after the last read", () => {
    expect(isUnread("2026-08-04T11:00:00Z", "2026-08-04T10:05:00Z")).toBe(true);
  });

  // A rep's own outbound reply carries no inbound timestamp, so a thread the
  // rep is actively working must not light up as unread for them.
  it("is never unread when the patient has never written", () => {
    expect(isUnread("", null)).toBe(false);
    expect(isUnread("", "2026-08-01T10:00:00Z")).toBe(false);
  });

  it("treats an exactly-equal stamp as read", () => {
    expect(isUnread("2026-08-04T10:00:00Z", "2026-08-04T10:00:00Z")).toBe(false);
  });
});
