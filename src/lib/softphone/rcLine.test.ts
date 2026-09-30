import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lastKnownStatus, phoneLine, type RcLineState } from "./rcLine";
import { readCachedSipInfo, writeCachedSipInfo, SIP_INFO_KEY, sipInfoKeyFor } from "./registration";
import type { SipInfo } from "ringcentral-web-phone/types";

const base: RcLineState = {
  loaded: true,
  configured: true,
  connected: false,
  broken: false,
  sharedLine: false,
  extension: null,
  notice: null,
};

describe("phoneLine (§5.13c) — connecting your own login IS being a call answerer", () => {
  it("⚠️ nothing registers until the status is in", () => {
    expect(phoneLine(false, { ...base, loaded: false })).toEqual({ enabled: false, line: null });
  });

  it("a connected person is rung, on their own line", () => {
    expect(phoneLine(false, { ...base, connected: true })).toEqual({ enabled: true, line: "own" });
  });

  it("⚠️ somebody who has not connected is not rung — there is no assigned list any more (Josh 2026-09-30)", () => {
    expect(phoneLine(false, base)).toEqual({ enabled: false, line: null });
  });

  it("⚠️ a dead grant stays on 'own' (provisioning says connect again) — never quietly onto Katie's line", () => {
    expect(phoneLine(false, { ...base, connected: true, broken: true })).toEqual({ enabled: true, line: "own" });
  });

  it("⚠️ connected to the SHARED extension itself (Katie, or her login): rung on the shared line — never a second set of credentials", () => {
    // Josh 2026-09-30: connected with Katie's login, the browser swapped between
    // two credentials on one extension and ended refused, looping and silent.
    expect(phoneLine(false, { ...base, connected: true, sharedLine: true })).toEqual({ enabled: true, line: "shared" });
  });

  it("a build without Google sign-in (local dev) rings everyone on the shared line, as before", () => {
    expect(phoneLine(true, { ...base, loaded: false })).toEqual({ enabled: true, line: "shared" });
  });
});

describe("a failed status read is not an answer", () => {
  const raw = JSON.stringify({ email: "v@medicallymodern.com", configured: true, connected: true, extension: { number: "13", name: "V" } });

  it("⚠️ keeps a connected person on their own line — never falls back to Katie's", () => {
    expect(lastKnownStatus(raw, "v@medicallymodern.com")).toMatchObject({ connected: true, extension: { number: "13" } });
  });

  it("is per person — somebody else's last status on a shared machine is never used", () => {
    expect(lastKnownStatus(raw, "k@medicallymodern.com")).toBeNull();
    expect(lastKnownStatus(null, "v@medicallymodern.com")).toBeNull();
    expect(lastKnownStatus("{not json", "v@medicallymodern.com")).toBeNull();
  });
});

describe("the sipInfo cache is per LINE", () => {
  const SIP = { username: "u", domain: "d", outboundProxy: "p" } as unknown as SipInfo;
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  const OWN = { username: "own", domain: "d", outboundProxy: "p" } as unknown as SipInfo;

  it("keeps each line's credentials apart — neither ever overwrites or stands in for the other", () => {
    const s = mem();
    writeCachedSipInfo(s, "v@medicallymodern.com", SIP, 1_000, "shared");
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000, "own")).toBeNull();
    writeCachedSipInfo(s, "v@medicallymodern.com", OWN, 1_000, "own");
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000, "own")).toEqual(OWN);
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000, "shared")).toEqual(SIP);
  });

  it("⚠️ the shared line is cached exactly where it always was", () => {
    expect(sipInfoKeyFor("shared")).toBe(SIP_INFO_KEY);
    const s = mem();
    s.setItem(SIP_INFO_KEY, JSON.stringify({ email: "v@medicallymodern.com", at: 1_000, sipInfo: SIP }));
    expect(readCachedSipInfo(s, "v@medicallymodern.com", 2_000)).toEqual(SIP);
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
    expect(host).toContain("phoneLine(!authRequired(), rcLine)");
  });

  it("the badge and the host read the same `phoneLine`, and neither reads the old assignment", () => {
    const badge = read("components/inboundCalls/CallConnectionBadge.tsx");
    const host = read("components/inboundCalls/IncomingCallHost.tsx");
    expect(badge).toContain("phoneLine(!authRequired(), rcLine)");
    expect(badge).not.toMatch(/canAnswerCalls\(/);
    expect(host).not.toMatch(/canAnswerCalls\(/);
  });

  it("⚠️ a line change never re-registers under a live call", () => {
    const sp = read("lib/softphone/softphone.ts");
    expect(sp).toContain("if (this.wp && this.wpLine !== this.effectiveLine() && !this.active) this.release();");
  });

  it("⚠️ never registers on the shared line when it asked for the person's own", () => {
    const sp = read("lib/softphone/softphone.ts");
    const refuse = sp.indexOf('if (line === "own" && got !== "own")');
    const cache = sp.indexOf("writeCachedSipInfo(store, email, sipInfo, Date.now(), line);");
    expect(refuse).toBeGreaterThan(0);
    expect(cache).toBeGreaterThan(refuse);
  });

  it("⚠️ OUTGOING calls always go out on the shared line — only answering moved (Josh 2026-09-30)", () => {
    const sp = read("lib/softphone/softphone.ts");
    const dial = sp.slice(sp.indexOf("private async doDial"), sp.indexOf("private failDial"));
    expect(dial).toContain("this.dialingShared = true;");
    // A registration already under way for the own line is swapped before the INVITE.
    expect(dial.indexOf("if (this.wp && this.wpLine !== this.effectiveLine())")).toBeLessThan(dial.indexOf("this.wp.call("));
    expect(sp).toContain('return this.dialingShared ? "shared" : this.line;');
    // Back to the own line when the call ends.
    const end = sp.slice(sp.indexOf("private endActive"));
    expect(end.slice(0, 400)).toContain("this.dialingShared = false;");
    // And the gateway is asked for a specific line every time.
    expect(sp).toContain("/messaging/sip-provision?line=${line}");
  });

  it("⚠️ a line change mid-registration is reconciled AFTER `registering` clears", () => {
    const sp = read("lib/softphone/softphone.ts");
    const cleared = sp.indexOf("this.registering = null;\n      }\n");
    const moved = sp.indexOf("if (this.isLeader && this.effectiveLine() !== line) this.reconcile();");
    expect(cleared).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(cleared);
  });

  it("⚠️ rcLine asks the gateway on load and on change, never on a timer (INCIDENT_2026-08-20)", () => {
    const src = read("lib/softphone/rcLine.ts");
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });
});

describe("the auth refusal names RingCentral's code", () => {
  it("says which SIP status refused the credentials, when it has one", async () => {
    const { describeRegistrationFailure } = await import("./registration");
    expect(describeRegistrationFailure("auth", new Error("SIP/2.0 403 Forbidden"))).toBe(
      "RingCentral rejected this browser's phone credentials (SIP 403). Fetching fresh ones…",
    );
    expect(describeRegistrationFailure("auth", new Error("unauthorized"))).toBe(
      "RingCentral rejected this browser's phone credentials. Fetching fresh ones…",
    );
  });
});
