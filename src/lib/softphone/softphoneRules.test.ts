/**
 * Source-scan pins for the browser softphone (§5.13b) — the `listColumns.test.ts`
 * convention: the properties below are invisible when broken (a call that a
 * colleague could no longer take, a second overlay, a second registration), so
 * the build is the only place they can fail loudly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Strip comments so a warning ABOUT decline() does not trip the scan. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the browser never declines a ringing call", () => {
  it("no source file under src/ calls decline() or toVoicemail() on a session", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const code = codeOnly(readFileSync(file, "utf8"));
      if (/\.(decline|toVoicemail)\s*\(/.test(code)) offenders.push(file.replace(ROOT + "/", ""));
    }
    expect(offenders).toEqual([]);
  });

  it("dismissing a card is local: the host wires X to ignore(), never to a SIP action", () => {
    const host = codeOnly(read("src/components/inboundCalls/IncomingCallHost.tsx"));
    expect(host).toMatch(/phone\.ignore\(/);
  });
});

describe("one registration per browser, no surprises from the SDK", () => {
  const runtime = codeOnly(read("src/lib/softphone/softphone.ts"));

  it("turns the SDK's auto-answer off — an Alert-Info header must never answer a call without a click", () => {
    expect(runtime).toMatch(/autoAnswer:\s*false/);
  });

  it("passes the browser's stable instanceId to every WebPhone it creates", () => {
    const ctor = runtime.match(/new WebPhone\(\{[^}]*\}\)/g) || [];
    expect(ctor.length).toBeGreaterThan(0);
    for (const c of ctor) expect(c).toMatch(/instanceId:\s*this\.instanceId/);
  });

  it("elects a leader tab with Web Locks under the shared lock name", () => {
    expect(runtime).toMatch(/navigator\.locks/);
    expect(runtime).toMatch(/LOCK_NAME/);
  });

  it("attaches session listeners through the WebPhone's own events, never after `await wp.call()`", () => {
    expect(runtime).toMatch(/wp\.on\("inboundCall"/);
    expect(runtime).toMatch(/wp\.on\("outboundCall"/);
    // The old hook's bug: `const session = await wp.call(...); session.on("answered", …)`.
    expect(runtime).not.toMatch(/const \w+ = await this\.wp\.call\([^)]*\);\s*\n\s*\w+\.on\(/);
  });

  it("the Comms Hub hook no longer talks to the SDK — the softphone is the only registrar", () => {
    const hub = codeOnly(read("src/hooks/assignedPatients/useWebPhone.ts"));
    expect(hub).not.toMatch(/ringcentral-web-phone/);
    expect(hub).toMatch(/useSoftphone/);
    const sdkImporters = walk(join(ROOT, "src")).filter((f) =>
      /from "ringcentral-web-phone"/.test(codeOnly(readFileSync(f, "utf8"))),
    );
    expect(sdkImporters.map((f) => f.replace(ROOT + "/", ""))).toEqual(["src/lib/softphone/softphone.ts"]);
  });
});

describe("only assigned answerers are rung — and a tab can take the phone over", () => {
  it("the host reads the assignment from access.json and gates the stream, the cards and the store on it", () => {
    const host = codeOnly(read("src/components/inboundCalls/IncomingCallHost.tsx"));
    expect(host).toMatch(/canAnswerCalls\(email, config\)/);
    expect(host).toMatch(/useInboundCalls\(enabled\)/);
    expect(host).toMatch(/setEnabled\(enabled\)/);
    expect(host).toMatch(/enabled && merged\.map/);
  });

  it("the runtime never reads a self-service opt-in from storage", () => {
    const runtime = codeOnly(read("src/lib/softphone/softphone.ts"));
    expect(runtime).not.toMatch(/browserRing|BROWSER_RING_KEY/);
    const reg = codeOnly(read("src/lib/softphone/registration.ts"));
    expect(reg).not.toMatch(/BROWSER_RING_KEY/);
  });

  it("the admin page and the store share one cap, RingCentral's five", () => {
    const admin = codeOnly(read("src/pages/AccessAdminPage.tsx"));
    expect(admin).toMatch(/MAX_CALL_ANSWERERS/);
    expect(admin).not.toMatch(/of 5\b/);
    const store = codeOnly(read("src/lib/accessStore.ts"));
    expect(store).toMatch(/MAX_CALL_ANSWERERS = 5/);
  });

  it("takeover steals the Web Lock and the losing tab demotes on AbortError", () => {
    const runtime = codeOnly(read("src/lib/softphone/softphone.ts"));
    expect(runtime).toMatch(/steal:\s*true/);
    expect(runtime).toMatch(/"AbortError"/);
    // Never mid-call: the audio would be pulled out from under the caller.
    expect(runtime).toMatch(/takeOver = \(\): void => \{\s*if \(this\.isLeader\) return;\s*if \(this\.snapshot\.call\) return;/);
  });

  it("the ringtone honours the per-browser mute, and the badge exposes it", () => {
    const runtime = codeOnly(read("src/lib/softphone/softphone.ts"));
    expect(runtime).toMatch(/ringing && !this\.active && !this\.ringMuted\) this\.ringtone\.start\(\)/);
    const badge = codeOnly(read("src/components/inboundCalls/CallConnectionBadge.tsx"));
    expect(badge).toMatch(/phone\.setRingMuted\(!phone\.ringMuted\)/);
  });

  it("both home pages carry the connection badge", () => {
    for (const f of ["src/pages/Index.tsx", "src/pages/ProcessorView.tsx"]) {
      expect(codeOnly(read(f))).toMatch(/<CallConnectionBadge/);
    }
  });
});

describe("one call overlay, mounted app-wide", () => {
  it("only IncomingCallHost renders <CallOverlay", () => {
    const mounts = walk(join(ROOT, "src"))
      .filter((f) => /<CallOverlay\b/.test(codeOnly(readFileSync(f, "utf8"))))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(mounts).toEqual(["src/components/inboundCalls/IncomingCallHost.tsx"]);
  });

  it("the host merges the gateway's cards with the SIP rings rather than drawing two", () => {
    const host = codeOnly(read("src/components/inboundCalls/IncomingCallHost.tsx"));
    expect(host).toMatch(/mergeRings\(/);
    expect(host).toMatch(/useSoftphone\(/);
  });

  it("App.tsx still mounts the host once, outside the router", () => {
    const app = codeOnly(read("src/App.tsx"));
    expect((app.match(/<IncomingCallHost \/>/g) || []).length).toBe(1);
  });
});
