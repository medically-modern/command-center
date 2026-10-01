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

describe("only people on their own RingCentral line are rung — and a tab can take the phone over", () => {
  it("the host gates the stream, the cards and the store on the person's OWN connected line (§5.13c)", () => {
    const host = codeOnly(read("src/components/inboundCalls/IncomingCallHost.tsx"));
    // Since 2026-09-30 connecting IS being a call answerer; the /access list no longer decides.
    expect(host).toMatch(/phoneLine\(!authRequired\(\), rcLine\)/);
    expect(host).not.toMatch(/canAnswerCalls\(/);
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

  it("⚠️ the admin page has no answering assignment any more — no cap, no chip, no count (§5.13c)", () => {
    const admin = codeOnly(read("src/pages/AccessAdminPage.tsx"));
    expect(admin).not.toMatch(/MAX_CALL_ANSWERERS|setCallAnswerer|callAnswerers/);
    const editor = codeOnly(read("src/components/shell/AbilitiesEditor.tsx"));
    expect(editor).not.toMatch(/Answers calls|onAnswersCalls|MAX_CALL_ANSWERERS/);
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
    expect(runtime).toMatch(/audible\.length && !this\.active && !this\.ringMuted\) \{\s*this\.ringtone\.start\(\)/);
    const badge = codeOnly(read("src/components/inboundCalls/CallConnectionBadge.tsx"));
    expect(badge).toMatch(/phone\.setRingMuted\(!phone\.ringMuted\)/);
  });

  /**
   * ⚠️ The ring follows the CARD (§5.13b, 2026-09-28). Keyed on the SIP leg
   * again, every one of these is a card that pops in silence: the line full,
   * a registration retry in flight, or the RingCentral desktop app holding the
   * newest registration for the shared extension. Nothing on screen says the
   * sound was skipped, so the build is the only place it can fail.
   */
  it("the sound is keyed on the gateway's cards, not only on this browser's SIP legs", () => {
    const runtime = codeOnly(read("src/lib/softphone/softphone.ts"));
    // The union the ringtone is decided from must still carry the cards.
    expect(runtime).toMatch(/this\.cardRings/);
    expect(runtime).toMatch(/this\.tabCardRings/);
    expect(runtime).toMatch(/audibleRings\(/);
    const host = codeOnly(read("src/components/inboundCalls/IncomingCallHost.tsx"));
    // Cards ring whenever this browser is NOT registered (line full, retrying,
    // error). Registered, the SIP leg rings and a card with no leg is not shown
    // (shownRings: the greeting, a fax — §5.13c, 2026-10-01).
    expect(host).toMatch(/setCardRings\(registered \? \[\] : ringingCards\(calls\)\)/);
    // X has to reach the tab making the sound, not just this tab's list.
    expect(host).toMatch(/dismiss\(u\.sse\.id\);\s*phone\.ignore\(u\.sse\.id\);/);
  });

  /**
   * ⚠️ The tab that makes the sound is the LEADER tab, which is whichever tab
   * took the Web Lock first — very often not the one the rep is looking at.
   * Chrome throttles a hidden tab's timers to once a second, and to once a
   * minute after a few minutes ("intensive throttling"), so a chime repeated
   * on a timer can be a single blip. Web Audio scheduled on the context's own
   * clock is not throttled.
   */
  it("the ringtone schedules the whole ring on the audio clock, with no repeating timer", () => {
    const tone = codeOnly(read("src/lib/softphone/ringtone.ts"));
    expect(tone).not.toMatch(/setInterval|setTimeout/);
    expect(tone).toMatch(/ctx\.currentTime/);
    // And the context is opened on a user gesture, not at ring time: a tab
    // nobody has clicked in cannot resume one, and resume() is asynchronous.
    const runtime = codeOnly(read("src/lib/softphone/softphone.ts"));
    expect(runtime).toMatch(/pointerdown/);
    expect(runtime).toMatch(/this\.ringtone\.prime\(\)/);
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

/**
 * ⚠️ Whether a browser is registered is invisible everywhere except the
 * browser itself: the SIP socket goes browser → RingCentral directly, and the
 * sipInfo cache means a healthy browser asks the gateway for credentials about
 * once a week (§5.13b). Drop the report and the whole class of "assigned, at
 * their desk, silently unable to ring" goes back to being something only a rep
 * can tell you about — which is how it stayed hidden until 2026-09-28.
 */
describe("every browser reports whether it is actually on the line", () => {
  it("the host reports this browser's registration, gated on the assignment", () => {
    const host = codeOnly(read("src/components/inboundCalls/IncomingCallHost.tsx"));
    expect(host).toMatch(/usePhoneStateReport\(phone, phone\.instanceId, enabled\)/);
  });

  it("only the LEADER tab reports, and on one timer — never one per tab or per render", () => {
    const hook = codeOnly(read("src/hooks/inboundCalls/usePhoneStateReport.ts"));
    expect(hook).toMatch(/if \(!enabled \|\| !leader\) return;/);
    expect((hook.match(/setInterval/g) || []).length).toBe(1);
  });

  it("a failed report can never break the phone", () => {
    // Monitoring that could stop a call being answered is worse than the blind
    // spot it closes.
    const api = codeOnly(read("src/lib/inboundCalls/callsApi.ts"));
    expect(api).toMatch(/export async function reportPhoneState[\s\S]{0,600}catch \{/);
  });

  it("the readout is mounted on /access and reads the gateway's verdicts, not its own", () => {
    const page = codeOnly(read("src/pages/AccessAdminPage.tsx"));
    // The gateway lists everyone on their own line itself (connectedEmails).
    expect(page).toMatch(/<PhoneLineHealth answerers=\{\[\]\}/);
    const panel = codeOnly(read("src/components/inboundCalls/PhoneLineHealth.tsx"));
    // It renders `state`/`label` as given. A second opinion on "healthy" is
    // how a board ends up disagreeing with the alert that wakes somebody.
    expect(panel).not.toMatch(/registration === "registered"/);
    expect(panel).toMatch(/fetchPhoneHealth\(/);
  });

  it("⚠️ colours the dots with hsl(var(--token)), never a bare var() — §5.40", () => {
    // The shadcn tokens are HSL COMPONENTS, so `var(--muted-foreground)` is an
    // invalid background that computes to transparent, and the var() fallback
    // never fires because the variable IS defined. Measured: the dot vanished.
    const panel = codeOnly(read("src/components/inboundCalls/PhoneLineHealth.tsx"));
    expect(panel).not.toMatch(/background:\s*"var\(--/);
    expect(panel).not.toMatch(/"var\(--[a-z-]+,/);
  });
});

/**
 * ⚠️ "Take it" — forwarding the ringing call to a personal phone — is GONE
 * (Josh, 2026-09-28, after a test call rang his cell: "it sent to my phone???
 * which it should never fucking do"; policy first stated 2026-09-25). The
 * gateway keeps /calls/claim so a rollback is client-only, but no UI may grow
 * back into it: with no SIP leg the card explains the registration state
 * instead of offering the one thing the policy bans.
 */
describe("a ringing call is never forwarded to a personal phone", () => {
  it("no client code calls the claim route or renders a Take it button", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const code = codeOnly(readFileSync(file, "utf8"));
      if (/claimCall|\/calls\/claim|"Take it"|>Take it</.test(code)) offenders.push(file.replace(ROOT + "/", ""));
    }
    expect(offenders).toEqual([]);
  });

  it("a card with no SIP leg explains WHY it can't be answered", () => {
    const host = codeOnly(read("src/components/inboundCalls/IncomingCallHost.tsx"));
    expect(host).toMatch(/reasonForNoAnswer\(phone\.registration, phone\.registrationError, seconds\)/);
    // ⚠️ During the greeting nobody is rung yet: "another device" must wait.
    expect(host).toMatch(/seconds < FIRST_RING_GRACE_S/);
    // Every registration state has a sentence — a silent dead-end card is the
    // failure this replaced.
    for (const state of ['case "full"', 'case "registering"', 'case "registered"', 'case "error"']) {
      expect(host).toContain(state);
    }
  });

  it("no user-facing sentence points at Take it any more", () => {
    // The full-line message used to end "or use Take it to ring your phone" —
    // pointing at the banned path exactly when the allowed one is broken.
    const reg = codeOnly(read("src/lib/softphone/registration.ts"));
    expect(reg).not.toMatch(/Take it/);
    const status = codeOnly(read("src/components/inboundCalls/SoftphoneStatus.tsx"));
    expect(status).not.toMatch(/Take it/);
  });
});
