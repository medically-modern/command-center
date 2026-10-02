/**
 * Who answered, on the inbound-call card (Josh, 2026-10-02: "when it says answered can we show who answered?
 * Like victor or janelle"). The answering browser reports itself; the gateway names the call and tells every card.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findAnsweredCall } from "./callRules.mjs";

const src = (f) => readFileSync(resolve(process.cwd(), f), "utf8");
const NOW = 1_000_000;
const c = (over) => ({ id: "s-1", from: "+13475550101", startedAt: NOW - 10_000, state: "ringing", ...over });

describe("findAnsweredCall", () => {
  it("matches by the gateway's session id first", () => {
    const a = c({}), b = c({ id: "s-2", startedAt: NOW - 1_000 });
    expect(findAnsweredCall([a, b], { callId: "s-1", from: "+13475550101" }, NOW)).toBe(a);
  });
  it("falls back to the newest recent call from the same number when the INVITE had no session id", () => {
    const a = c({}), b = c({ id: "s-2", startedAt: NOW - 1_000 });
    expect(findAnsweredCall([a, b], { callId: "", from: "13475550101" }, NOW)).toBe(b);
  });
  it("never names somebody on an old call, or on a different caller", () => {
    expect(findAnsweredCall([c({ startedAt: NOW - 600_000 })], { callId: "s-1" }, NOW)).toBeNull();
    expect(findAnsweredCall([c({ startedAt: NOW - 600_000 })], { from: "+13475550101" }, NOW)).toBeNull();
    expect(findAnsweredCall([c({})], { from: "+12125550000" }, NOW)).toBeNull();
    expect(findAnsweredCall([c({})], {}, NOW)).toBeNull();
  });
});

describe("wiring", () => {
  const gw = src("services/monday-gateway/inboundCalls.mjs");
  const route = gw.slice(gw.indexOf('app.post("/calls/answered"'), gw.indexOf('app.post("/calls/claim"'));
  it("the route names the verified sign-in, never a body field, and tells every card", () => {
    expect(route).toContain("requireCaller(req, res)");
    expect(route.indexOf("requireCaller(")).toBeLessThan(route.indexOf("call.answeredBy = who"));
    expect(route).not.toMatch(/req\.body\?*\.(email|who|answeredBy)/);
    expect(route).toContain("broadcastUpdate(call)");
    expect(gw).toMatch(/answeredBy: c\.answeredBy \|\| null/); // publicCall carries it
  });
  it("⚠️ a pickup never ends a ringing call: the end event still writes Communications' `end` row, now answered", () => {
    expect(route).not.toMatch(/endedAt\s*=/);
    expect(route).not.toMatch(/kind: "end"/);
    expect(gw).toMatch(/outcome === "answered" \|\| existing\.claimedBy \|\| existing\.answeredBy/);
    expect(gw).toMatch(/call\.claimedBy \|\| call\.answeredBy \? "answered" : "missed"/); // the stale sweep agrees
  });
  it("the browser reports only once RingCentral says the call connected", () => {
    const sp = src("src/lib/softphone/softphone.ts");
    const once = sp.slice(sp.indexOf('session.once("answered"'), sp.indexOf("if (!session.answer)"));
    expect(once).toContain("reportAnswered({ callId: ring.sessionId, from: ring.from })");
  });
  it("the card says who", () => {
    const host = src("src/components/inboundCalls/IncomingCallHost.tsx");
    expect(host).toContain("`Answered by ${senderName(ring.answeredBy)}`");
    expect(host.indexOf("ring.answeredBy")).toBeLessThan(host.indexOf('ring.state === "answered") return "Answered"'));
  });
});
