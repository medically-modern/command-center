/**
 * The sip-provision floor — the gateway's own guard against a provisioning
 * metronome (2026-09-25: one browser in an auth-classified registration loop
 * re-fetched provision at a flat ~6s for twelve minutes, ~10 RingCentral
 * sip-provision calls a minute, each minting a device record, feeding the
 * real RC 429 at 9:48 AM).
 *
 * The client's auth ladder (registration.ts) is the first fix; this floor is
 * what covers the tab that never reloads and runs the old flat retry for
 * days. Source scans, because standing up registerMessaging drags in the
 * S3-backed archives; the one BEHAVIOURAL pin — the floor sits below the
 * ladder's first rung — imports the real ladder.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { retryDelayMs } from "../../src/lib/softphone/registration";

const SRC = readFileSync(resolve(process.cwd(), "services/monday-gateway/messaging.mjs"), "utf8");
const route = SRC.slice(
  SRC.indexOf(`app.get("/messaging/sip-provision"`),
  SRC.indexOf("\n  });", SRC.indexOf(`app.get("/messaging/sip-provision"`)),
);
const floor = Number(/SIP_PROVISION_FLOOR_MS = ([\d_]+);/.exec(SRC)?.[1]?.replace(/_/g, ""));

describe("the /messaging/sip-provision floor", () => {
  it("⚠️ keep-in-agreement: the floor sits BELOW the client ladder's first auth rung", () => {
    // Equal or above, and every genuine credential recovery — the loop's own
    // fix — is refused by our own guard on its first retry.
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(retryDelayMs("auth", 0));
  });

  it("refuses INSIDE the floor with a 429 + Retry-After, BEFORE RingCentral is asked", () => {
    const refusal = route.indexOf("Retry-After");
    const upstream = route.indexOf("rcApiFetch(SIP_PROVISION_PATH");
    expect(route).toContain("status(429)");
    expect(refusal).toBeGreaterThan(0);
    expect(upstream).toBeGreaterThan(refusal); // the whole point: no device record minted
  });

  it("keys by caller + user agent — one person's two machines are not each other's floor", () => {
    expect(route).toMatch(/req\.headers\["user-agent"\]/);
    expect(route).toMatch(/\$\{who \|\| req\.ip \|\| "\?"\}/);
  });

  it("the map is bounded — a floor that leaks one entry per UA string is its own slow failure", () => {
    expect(route).toMatch(/sipProvisionLast\.size > \d+/);
    expect(route).toMatch(/sipProvisionLast\.delete\(/);
  });
});
