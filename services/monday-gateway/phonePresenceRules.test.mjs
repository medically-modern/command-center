/**
 * Is each answerer's browser actually on the line? (phonePresenceRules.mjs)
 *
 * The property every test here defends: a browser that is CLOSED is normal and
 * must never read as broken. §5.13 records what happened the last time that
 * line was crossed — the "no Command Center browser is connected" check paged
 * every evening until it was removed on 2026-08-17.
 */
import { describe, it, expect } from "vitest";
import {
  PRESENCE_STALE_MS,
  PRESENCE_TROUBLE_MS,
  normalizeReport,
  presenceFaults,
  summarize,
  verdictFor,
} from "./phonePresenceRules.mjs";

const NOW = 1_700_000_000_000;
const row = (over = {}) => ({
  email: "katie@medicallymodern.com",
  instanceId: "abc",
  registration: "registered",
  detail: null,
  leader: true,
  userAgent: "Chrome",
  since: NOW - 60_000,
  at: NOW - 5_000,
  ...over,
});

describe("normalizeReport — a browser may not name itself", () => {
  it("⚠️ takes the email from the verified identity, never the body", () => {
    const r = normalizeReport("katie@medicallymodern.com", {
      email: "josh@medicallymodern.com",
      registration: "registered",
    });
    // A browser that could name itself could report somebody else as healthy.
    expect(r.email).toBe("katie@medicallymodern.com");
  });

  it("refuses a registration value it does not recognise", () => {
    expect(normalizeReport("k@m.com", { registration: "excellent" }).registration).toBe("off");
    expect(normalizeReport("k@m.com", { registration: "full" }).registration).toBe("full");
  });

  it("still gives a browser with no instance id a row, under a name that cannot collide", () => {
    expect(normalizeReport("k@m.com", {}).instanceId).toBe("no-instance");
  });

  it("bounds the free text a browser can store", () => {
    const r = normalizeReport("k@m.com", { detail: "x".repeat(5_000), userAgent: "y".repeat(5_000) });
    expect(r.detail.length).toBe(300);
    expect(r.userAgent.length).toBe(300);
  });
});

describe("verdictFor — closed is not broken", () => {
  it("reads a registered browser as connected", () => {
    expect(verdictFor(row(), NOW).state).toBe("connected");
  });

  it("⚠️ reads a browser that stopped reporting as GONE, never as trouble", () => {
    // People go home. This is the check that must never page.
    expect(verdictFor(row({ at: NOW - PRESENCE_STALE_MS - 1 }), NOW).state).toBe("gone");
    // Even one that was mid-failure when it went away.
    expect(verdictFor(row({ registration: "error", at: NOW - PRESENCE_STALE_MS - 1 }), NOW).state).toBe("gone");
  });

  it("tolerates a missed beat or two — a slow request is not an outage", () => {
    expect(verdictFor(row({ at: NOW - PRESENCE_STALE_MS + 1_000 }), NOW).state).toBe("connected");
  });

  it("gives a failing browser time to recover before calling it trouble", () => {
    const failing = (heldFor) => verdictFor(row({ registration: "error", since: NOW - heldFor }), NOW).state;
    expect(failing(30_000)).toBe("waiting");
    expect(failing(PRESENCE_TROUBLE_MS + 1)).toBe("trouble");
  });

  it("does the same for a full line, which clears itself in about two minutes", () => {
    expect(verdictFor(row({ registration: "full", since: NOW - 30_000 }), NOW).state).toBe("waiting");
    expect(verdictFor(row({ registration: "full", since: NOW - PRESENCE_TROUBLE_MS - 1 }), NOW).state).toBe("trouble");
  });

  it("⚠️ catches a browser STUCK on connecting — the failure that shows no error at all", () => {
    expect(verdictFor(row({ registration: "registering", since: NOW - 3_000 }), NOW).state).toBe("waiting");
    expect(verdictFor(row({ registration: "registering", since: NOW - PRESENCE_TROUBLE_MS - 1 }), NOW).state).toBe(
      "trouble",
    );
  });

  it("shows the browser's own sentence when it has one", () => {
    const v = verdictFor(row({ registration: "error", detail: "Can't reach RingCentral's phone server. Retrying…", since: NOW - PRESENCE_TROUBLE_MS - 1 }), NOW);
    expect(v.label).toMatch(/Can't reach RingCentral/);
  });
});

describe("summarize — driven by who is ASSIGNED", () => {
  it("⚠️ lists an assigned answerer who has never reported at all", () => {
    // The most important line on the page, and a rows-only view omits it.
    const s = summarize(["katie@medicallymodern.com"], [], NOW);
    expect(s.people).toHaveLength(1);
    expect(s.people[0].connected).toBe(false);
    expect(s.people[0].state).toBe("gone");
    expect(s.connected).toBe(0);
  });

  it("counts somebody covered when ANY of their browsers is registered", () => {
    const s = summarize(
      ["katie@medicallymodern.com"],
      [row({ instanceId: "edge", registration: "error", since: NOW - 9_999_999 }), row({ instanceId: "chrome" })],
      NOW,
    );
    expect(s.people[0].connected).toBe(true);
    // ...and still shows the broken one, which is holding one of the five.
    expect(s.people[0].browsers).toHaveLength(2);
  });

  it("leads with the worst browser when none of them is connected", () => {
    const s = summarize(
      ["katie@medicallymodern.com"],
      [row({ instanceId: "a", registration: "off" }), row({ instanceId: "b", registration: "error", since: NOW - PRESENCE_TROUBLE_MS - 1 })],
      NOW,
    );
    expect(s.people[0].state).toBe("trouble");
  });

  it("counts browsers reporting from somebody no longer assigned — each one eats a slot", () => {
    const s = summarize(["josh@medicallymodern.com"], [row()], NOW);
    expect(s.unassigned).toBe(1);
  });
});

describe("presenceFaults — one way only", () => {
  it("says nothing when nobody has a browser open", () => {
    expect(presenceFaults([], NOW)).toEqual([]);
    expect(presenceFaults([row({ at: NOW - PRESENCE_STALE_MS - 1, registration: "error" })], NOW)).toEqual([]);
  });

  it("says nothing while everything is connected", () => {
    expect(presenceFaults([row()], NOW)).toEqual([]);
  });

  it("reports a browser that is open, reporting, and has not been able to ring", () => {
    const f = presenceFaults([row({ registration: "error", detail: "Can't reach RingCentral's phone server. Retrying…", since: NOW - 40 * 60_000 })], NOW);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/katie@medicallymodern\.com/);
    expect(f[0]).toMatch(/40 min/);
  });

  it("⚠️ stays quiet when their OTHER browser is registered — they are being rung fine", () => {
    const f = presenceFaults(
      [
        row({ instanceId: "edge", registration: "error", since: NOW - 40 * 60_000 }),
        row({ instanceId: "chrome", registration: "registered" }),
      ],
      NOW,
    );
    expect(f).toEqual([]);
  });

  it("does not page for a failure that is still inside the recovery window", () => {
    expect(presenceFaults([row({ registration: "error", since: NOW - 60_000 })], NOW)).toEqual([]);
  });
});
