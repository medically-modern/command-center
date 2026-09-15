/**
 * A call card must leave the screen when the call does.
 *
 * Josh, 2026-09-15: *"when calls end or are picked up remove the tab from
 * showing, they linger there for 1000 of seconds."* Source scans, because
 * every failure here is silent — a card that never clears looks exactly like a
 * call that is still ringing, which is the one thing it must never look like.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const hook = read("src/hooks/inboundCalls/useInboundCalls.ts");
const gateway = read("services/monday-gateway/inboundCalls.mjs");
const rules = read("services/monday-gateway/callRules.mjs");

describe("the gateway ends rings no terminal event arrived for", () => {
  it("sweeps, broadcasts the update and lets the prune drop it", () => {
    expect(gateway).toMatch(/function sweepStaleRings\(\)/);
    expect(gateway).toMatch(/staleRings\(calls\.values\(\), now\)/);
    expect(gateway).toMatch(/sweepStaleRings\(\)[\s\S]{0,200}const now = Date\.now\(\)/);
    // The broadcast is the half that clears the card already on screen; the
    // endedAt is the half that stops it being re-pushed to the next browser.
    expect(gateway).toMatch(/call\.endedAt = now;\s*\n\s*broadcastUpdate\(call\)/);
  });

  it("⚠️ has its OWN timer — the webhook path is the thing that failed", () => {
    // Hanging the recovery off the next event hangs it off the thing that
    // stopped arriving.
    expect(gateway).toMatch(/setInterval\(\(\) => pruneCalls\(\), SWEEP_EVERY_MS\)/);
  });

  it("⚠️ a CLAIMED call is swept as answered, never missed", () => {
    // Or the rep who took the call watches their own card flip to Missed.
    expect(gateway).toMatch(/call\.state = call\.claimedBy \? "answered" : "missed"/);
  });

  it("records why, so a run of them is findable later", () => {
    expect(gateway).toMatch(/swept — no terminal event after/);
  });

  it("⚠️ the rule lives in callRules, testable without a webhook", () => {
    expect(rules).toMatch(/export function staleRings\(/);
    expect(rules).toMatch(/export const MAX_RING_MS/);
  });
});

describe("the browser ends a card whose update it missed", () => {
  it("expires a ringing card past the window and then clears it", () => {
    expect(hook).toMatch(/const MAX_RING_MS = /);
    expect(hook).toMatch(/now - c\.startedAt > MAX_RING_MS/);
    expect(hook).toMatch(/expire\(c\.id\);\s*\n\s*scheduleClear\(c\.id\)/);
  });

  it("⚠️ ONE timer over the list, never one per card", () => {
    // A card re-renders on every name resolution and every update; a timer in
    // that path multiplies (INCIDENT_2026-08-20's shape, in miniature).
    expect(hook).toMatch(/setInterval\(\(\) => \{[\s\S]{0,400}for \(const c of calls\)/);
  });

  it("⚠️ its window is LONGER than the gateway's, so the honest update wins", () => {
    const client = Number(/const MAX_RING_MS = ([\d_]+)/.exec(hook)?.[1].replace(/_/g, ""));
    const server = Number(/export const MAX_RING_MS = ([\d_]+)/.exec(rules)?.[1].replace(/_/g, ""));
    expect(client).toBeGreaterThan(server);
  });

  it("still clears on a real terminal update, which stays the normal path", () => {
    expect(hook).toMatch(/if \(call\.state !== "ringing"\) scheduleClear\(call\.id\)/);
  });
});
