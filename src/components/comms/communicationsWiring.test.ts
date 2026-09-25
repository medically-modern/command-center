/**
 * Source scans for the Communications popup, in-app calling and the
 * scrubbable player (Josh, 2026-09-24 — CLAUDE.md §5.50).
 *
 * Each of these fails SILENTLY if it regresses, which is why it is scanned
 * rather than trusted: a `tel:` link that comes back works on a laptop with the
 * RingCentral app and does nothing on one without it (the "clicked call and
 * nothing happened" report); an `<audio controls>` that comes back is a player
 * nobody can scrub; a popup that loses its view mode grows a Mark-resolved bar
 * Josh asked it not to have.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

/** Every non-test .ts/.tsx under src/, as [path, source]. */
function sources(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
        out.push([relative(ROOT, full), readFileSync(full, "utf8")]);
      }
    }
  };
  walk(resolve(ROOT, "src"));
  return out;
}

/** Comments stripped, so a file may DESCRIBE the old shapes it replaced. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("every phone number dials in the Command Center", () => {
  it("no `tel:` link survives anywhere in the app", () => {
    const offenders = sources()
      .filter(([, s]) => /href=\{?\s*[`"']tel:/.test(code(s)))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it("the patient header's Call button opens the in-app dial popup by default", () => {
    const kit = read("src/components/masheke/mmKit.tsx");
    expect(kit).toMatch(/onClick=\{onCall \?\? \(\(\) => setDialOpen\(true\)\)\}/);
    expect(kit).toMatch(/<DialPatientDialog open phone=\{tel\}/);
  });

  // ⚠️ It was a deliberate no-op, on the belief that a dialer there would spend
  // a second softphone slot. `useWebPhone` is a view over the ONE registration
  // every tab shares (§5.13b), so the rep pressed Call and nothing happened.
  it("the patient screen's Call is not a no-op", () => {
    const col = code(read("src/components/patient/PatientCommsColumn.tsx"));
    expect(col).not.toMatch(/onCall=\{\(\) => \{\}\}/);
    expect(col).toMatch(/onCall=\{\(\) => dialNumber\(activePhone\)\}/);
    // From 2026-09-25 the Call a rep SEES is the header's top-right button
    // (`call-top`), dialling whichever number the column is on — and "Call
    // alt" beside the alternate.
    expect(col).toMatch(/className="call-top"/);
    expect(col).toMatch(/onClick=\{\(\) => dialNumber\(activePhone\)\}/);
    expect(col).toMatch(/dialNumber\(alt\);/);
  });

  // ⚠️ The Care Coordinator card took `onCall` from 2026-09-22 and never handed
  // it on, so its Call was a `tel:` handoff while the page's CallPatientDialog
  // sat unused.
  it("the Care Coordinator card hands its onCall to the header", () => {
    expect(read("src/components/careCoordinator/PatientCard.tsx")).toMatch(/onCall=\{onCall\}/);
  });

  it("the doctor's-office Call buttons are ONE component, dialling in the page", () => {
    for (const f of ["src/components/masheke/ChaseClinicalsPanel.tsx", "src/components/masheke/ConfirmReceiptPanel.tsx"]) {
      const s = code(read(f));
      expect(s).toMatch(/import \{ CallBox \} from "@\/components\/masheke\/CallBox"/);
      expect(s).not.toMatch(/function CallBox\(/);
    }
    expect(read("src/components/masheke/CallBox.tsx")).toMatch(/<DialPatientDialog/);
  });
});

describe("one Communications button replaced every Text and Calls button", () => {
  it("the old Calls pop-up is gone, and nothing imports it", () => {
    const offenders = sources()
      .filter(([, s]) => /shared\/CallHistoryButton/.test(s))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
    expect(() => read("src/components/shared/CallHistoryButton.tsx")).toThrow();
  });

  it("the patient header renders Communications, and no text composer of its own", () => {
    const kit = code(read("src/components/masheke/mmKit.tsx"));
    expect(kit).toMatch(/<CommunicationsButton/);
    expect(kit).not.toMatch(/function TextCompose\(/);
    expect(kit).not.toMatch(/sendMessage\(/);
  });

  // ⚠️ *"there are no action items here"* — the popup is the hub's middle pane
  // in its VIEW mode: no Mark-resolved bar, no Left-voicemail, no Undo.
  it("the popup renders the hub's timeline in view mode, and view mode drops the resolve bar", () => {
    expect(read("src/components/comms/CommunicationsView.tsx")).toMatch(/<ItemTimeline[\s\S]{0,60}mode="view"/);
    const tl = read("src/components/commsInbox/ItemTimeline.tsx");
    expect(tl).toMatch(/const view = mode === "view";/);
    expect(tl).toMatch(/\{!view && \(\s*<ResolveBar/);
  });

  // ⚠️ The popup must never dead-end where the old buttons did not (§5.39f):
  // with the Inbox off or unreadable it shows the live thread and the call log.
  it("the popup falls back to the live thread and the call history", () => {
    const v = read("src/components/comms/CommunicationsView.tsx");
    expect(v).toMatch(/<CallHistoryList/);
    expect(v).toMatch(/useConversation\(/);
  });

  // Patient Intake's template buttons and its Call Log stamp ride on these.
  it("keeps the old Text button's contract: an outside open, a template, a sent callback", () => {
    const b = read("src/components/comms/CommunicationsButton.tsx");
    expect(b).toMatch(/draftOnOpen\(/);
    expect(b).toMatch(/draftAfterClose\(/);
    expect(b).toMatch(/onTextSent=\{onTextSent\}/);
    // A change of patient clears every draft, and does so BEFORE the template
    // is seeded — effects run in order.
    const clear = b.indexOf("setDrafts({});");
    const seed = b.indexOf("draftOnOpen(");
    expect(clear).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(seed);
  });
});

describe("every recording and voicemail plays in the scrubbable player", () => {
  it("no browser-controls <audio> is left in the app", () => {
    const offenders = sources()
      .filter(([, s]) => /<audio\b[^>]*\bcontrols\b/.test(code(s)))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it("the timeline, the call list, the voicemail pane and the Welcome Call box all use it", () => {
    for (const f of [
      "src/components/commsInbox/ItemTimeline.tsx",
      "src/components/shared/CallHistoryList.tsx",
      "src/components/commsHub/VoicemailDetail.tsx",
      "src/components/welcomeCall/PatientActivityCard.tsx",
    ]) {
      expect(read(f)).toMatch(/<AudioPlayer\b/);
    }
  });
});
