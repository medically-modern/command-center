import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { phoneLine, type RcLineState } from "./rcLine";
import { readCachedSipInfo, writeCachedSipInfo, SIP_INFO_KEY } from "./registration";
import type { SipInfo } from "ringcentral-web-phone/types";

const base: RcLineState = {
  loaded: true,
  configured: true,
  connected: false,
  broken: false,
  extension: null,
  notice: null,
};

describe("phoneLine (§5.13c)", () => {
  it("⚠️ nothing registers until the status is in — a connected answerer must not spend one of Katie's five first", () => {
    expect(phoneLine(true, { ...base, loaded: false })).toEqual({ enabled: false, line: null });
  });

  it("a connected person rings on their own line, assigned or not", () => {
    expect(phoneLine(false, { ...base, connected: true })).toEqual({ enabled: true, line: "own" });
    expect(phoneLine(true, { ...base, connected: true })).toEqual({ enabled: true, line: "own" });
  });

  it("an answerer who has not connected keeps the shared line, exactly as before", () => {
    expect(phoneLine(true, base)).toEqual({ enabled: true, line: "shared" });
  });

  it("everybody else is not rung", () => {
    expect(phoneLine(false, base)).toEqual({ enabled: false, line: null });
  });

  it("⚠️ a dead grant stays on 'own' (provisioning says connect again) — never quietly back onto Katie's line", () => {
    expect(phoneLine(true, { ...base, connected: true, broken: true })).toEqual({ enabled: true, line: "own" });
  });
});

describe("the sipInfo cache is per LINE", () => {
  const SIP = { username: "u", domain: "d", outboundProxy: "p" } as unknown as SipInfo;
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it("never hands the shared line's credentials to a person now on their own line, or the reverse", () => {
    const s = mem();
    writeCachedSipInfo(s, "v@medicallymodern.com", SIP, 1_000, "shared");
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000, "own")).toBeNull();
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000, "shared")).toEqual(SIP);
    writeCachedSipInfo(s, "v@medicallymodern.com", SIP, 1_000, "own");
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000, "own")).toEqual(SIP);
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000, "shared")).toBeNull();
  });

  it("an entry written before lines existed was the shared line", () => {
    const s = mem();
    s.setItem(SIP_INFO_KEY, JSON.stringify({ email: "v@medicallymodern.com", at: 1_000, sipInfo: SIP }));
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000, "shared")).toEqual(SIP);
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000, "own")).toBeNull();
  });
});

describe("wiring", () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), "src", f), "utf8");

  it("⚠️ the host sets the LINE before enabling, so the first registration is on the right extension", () => {
    const host = read("components/inboundCalls/IncomingCallHost.tsx");
    const setLine = host.indexOf("setLine(line);");
    const setEnabled = host.indexOf("setEnabled(enabled);");
    expect(setLine).toBeGreaterThan(0);
    expect(setEnabled).toBeGreaterThan(setLine);
    expect(host).toContain("phoneLine(answerer, rcLine)");
  });

  it("the badge and the host read the same `phoneLine`", () => {
    expect(read("components/inboundCalls/CallConnectionBadge.tsx")).toContain("phoneLine(answerer, rcLine)");
  });

  it("⚠️ a line change never re-registers under a live call", () => {
    const sp = read("lib/softphone/softphone.ts");
    expect(sp).toContain("if (this.wp && this.wpLine !== this.line && !this.active) this.release();");
  });

  it("⚠️ rcLine asks the gateway on load and on change, never on a timer (INCIDENT_2026-08-20)", () => {
    const src = read("lib/softphone/rcLine.ts");
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });
});
