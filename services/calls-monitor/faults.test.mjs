import { beforeAll, describe, expect, it } from "vitest";

/**
 * The fault rules are the whole point of the monitor: an alert that stays quiet
 * during a real outage is worse than no monitor, because it reads as an
 * all-clear. Each case below is a way inbound calling has failed or can fail.
 */
let faults;
beforeAll(async () => {
  // Stops index.mjs from running a live check on import.
  process.env.CALLS_MONITOR_TEST = "1";
  ({ faults } = await import("./index.mjs"));
});

const healthy = {
  configured: true,
  error: null,
  subscriptionId: "sub-1",
  subscriptionStatus: "Active",
  subscribers: 2,
  events: { seen: 40, rings: 6, unparsed: 0 },
};
const ctx = { handshake: true };

describe("faults", () => {
  it("stays quiet when everything is healthy", () => {
    expect(faults(healthy, ctx)).toEqual([]);
  });

  it("reports the gateway being unreachable", () => {
    expect(faults(null, ctx)[0]).toMatch(/did not respond/);
  });

  // The one that matters most: the id survives blacklisting unchanged, so
  // checking only for its presence would report health during a real outage.
  it("catches a blacklisted subscription even though the id is still there", () => {
    const f = faults({ ...healthy, subscriptionStatus: "Blacklisted" }, ctx);
    expect(f.join(" ")).toMatch(/Blacklisted.*not Active/);
  });

  it("catches a missing subscription", () => {
    expect(faults({ ...healthy, subscriptionId: null }, ctx).join(" ")).toMatch(/No RingCentral subscription/);
  });

  it("catches a webhook that stopped answering the handshake", () => {
    const f = faults(healthy, { ...ctx, handshake: false });
    expect(f.join(" ")).toMatch(/validation handshake/);
  });

  it("does not complain when the handshake was not probed", () => {
    expect(faults(healthy, { ...ctx, handshake: null })).toEqual([]);
  });

  // The envelope bug's signature: deliveries land, get acked, get discarded.
  it("catches every event being unparseable", () => {
    const f = faults({ ...healthy, events: { seen: 33, rings: 0, unparsed: 33 } }, ctx);
    expect(f.join(" ")).toMatch(/unparseable/);
  });

  it("does not cry about a quiet line with no events at all", () => {
    expect(faults({ ...healthy, events: { seen: 0, rings: 0, unparsed: 0 } }, ctx)).toEqual([]);
  });

  it("does not cry when some events parse", () => {
    expect(faults({ ...healthy, events: { seen: 10, rings: 2, unparsed: 3 } }, ctx)).toEqual([]);
  });

  it("reports a gateway that says it is unconfigured", () => {
    expect(faults({ ...healthy, configured: false }, ctx).join(" ")).toMatch(/not configured/);
  });

  it("passes a gateway error through verbatim", () => {
    const f = faults({ ...healthy, error: "CallControl permission is required" }, ctx);
    expect(f.join(" ")).toMatch(/CallControl permission is required/);
  });

  it("reports several problems at once rather than only the first", () => {
    const f = faults({ ...healthy, subscriptionStatus: "Suspended", configured: false }, ctx);
    expect(f.length).toBe(2);
  });
});
