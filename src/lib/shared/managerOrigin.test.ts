import { describe, it, expect } from "vitest";
import { PIN_DEEP_LINK_PARAM, pinnedDeepLinkId } from "./managerOrigin";

/**
 * `?pin=1` — Pipeline Oversight and Search open a patient the page must SHOW,
 * whatever this browser hid after an earlier action (Mary Mathis, 2026-09-28:
 * Josh proposed her stuck on Welcome Call, then clicked her in Oversight and got
 * the other escalated patients and an empty panel).
 */
describe("pinnedDeepLinkId", () => {
  const sp = (q: string) => new URLSearchParams(q);

  it("returns the deep-linked id when the link is pinned", () => {
    expect(pinnedDeepLinkId(sp("patientId=12707050564&from=system-mgmt&pin=1"))).toBe("12707050564");
  });

  it("is null for an unpinned deep link — the Hub, the Fax panel, the dashboard", () => {
    // Reps work patients from those; for a rep the hide is the re-press guard.
    expect(pinnedDeepLinkId(sp("patientId=1&from=system-mgmt"))).toBeNull();
    expect(pinnedDeepLinkId(sp("patientId=1&from=patient"))).toBeNull();
  });

  it("is null with no patient, and for any value but 1", () => {
    expect(pinnedDeepLinkId(sp("pin=1"))).toBeNull();
    expect(pinnedDeepLinkId(sp("patientId=1&pin=true"))).toBeNull();
    expect(pinnedDeepLinkId(sp("patientId=1&pin=0"))).toBeNull();
  });

  it("the param name is the contract Oversight and Search write", () => {
    expect(PIN_DEEP_LINK_PARAM).toBe("pin");
  });
});
