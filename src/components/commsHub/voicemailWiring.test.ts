/**
 * The Voicemail wiring, scanned at the source (the `listColumns.test.ts`
 * convention).
 *
 * Every rule below is SILENT ON SCREEN when it breaks — a missing context menu
 * looks like a design choice, a voicemail marked heard on open looks like an
 * empty Unheard filter, and a call that stops opening its message looks like a
 * call that left none. None of them throws, so nothing else would catch them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");

const panel = read("components/commsHub/PhonePanel.tsx");
const page = read("pages/AssignedPatientsPage.tsx");
const detail = read("components/commsHub/VoicemailDetail.tsx");

describe("voicemail rows carry the right-click menu (Josh, 2026-09-15)", () => {
  it("the list wraps its rows in a ContextMenu", () => {
    expect(panel).toMatch(/ContextMenuTrigger/);
    expect(panel).toMatch(/onSetVoicemailRead\(v, false\)/);
    expect(panel).toMatch(/onSetVoicemailRead\(v, true\)/);
  });

  it("says heard / unheard, matching the Unheard filter beside it", () => {
    expect(panel).toMatch(/Mark as unheard/);
    expect(panel).toMatch(/Mark as heard/);
  });

  it("the page passes the handler", () => {
    expect(page).toMatch(/onSetVoicemailRead=\{setVoicemailRead\}/);
  });

  it("⚠️ writes RingCentral's own readStatus, never a local-only flag", () => {
    // Reps work this same line in the RingCentral desktop app (§5.28).
    expect(page).toMatch(/setVoicemailRead[\s\S]{0,900}setMessageRead\(v\.id, read\)/);
  });

  it("⚠️ reuses the fax override rule rather than a third copy of it", () => {
    expect(page).toMatch(/applyMessageReadOverrides\(voicemails\.data/);
    expect(page).toMatch(/pruneMessageReadOverrides\(voicemails\.data/);
  });

  it("⚠️ the list the panel renders is the OVERRIDDEN one", () => {
    // Passing `voicemails.data` would leave a row springing back to unheard
    // until the next poll landed — the override would be written and unread.
    expect(page).toMatch(/voicemails=\{voicemailList\}/);
    expect(page).not.toMatch(/voicemails=\{voicemails\.data\}/);
  });

  it("opening a voicemail marks it heard, and the menu puts it back", () => {
    // Josh, 2026-09-15: "opening it marks it read, right clicking and marking
    // it unread puts it back on unread" — the same contract the fax list has.
    const onSelect = page.match(/onSelect=\{\(phone\) => \{[\s\S]*?\n {14}\}\}/)?.[0] ?? "";
    expect(onSelect).toMatch(/setSelectedVoicemail/);
    expect(onSelect).toMatch(/if \(vm && !vm\.read\) setVoicemailRead\(vm, true\)/);
  });

  it("⚠️ a call that auto-opens one marks it heard ONCE, not on every render", () => {
    // The effect reads `voicemailList`, which the override changes — so without
    // the guard, marking it unread re-runs the effect and re-marks it heard: a
    // right-click that visibly undoes itself.
    expect(page).toMatch(/autoHeard\.current\.has\(v\.id\)/);
    expect(page).toMatch(/autoHeard\.current\.add\(v\.id\)/);
  });

  it("⚠️ read state is SYSTEM-WIDE by construction, never per browser", () => {
    // `setMessageRead` PUTs RingCentral's own readStatus on the shared
    // extension, so one rep marking it read is read for everyone (§5.13b).
    // The override map is only this browser's few seconds before its own poll.
    expect(page).toMatch(/setMessageRead\(v\.id, read\)/);
    expect(page).not.toMatch(/localStorage[\s\S]{0,80}(voicemail|readStatus)/i);
  });
});

describe("a call that left a voicemail opens it above the thread", () => {
  it("the panel hands the page the whole call, not just its number", () => {
    // `voicemailForCall` joins on the call's start time and its voicemail
    // verdict; a phone string carries neither.
    expect(panel).toMatch(/onSelectCall\(\{ phone: r\.phone, at: r\.at, voicemail: r\.voicemail \}\)/);
    expect(page).toMatch(/onSelectCall=\{\(call\) => \{/);
  });

  it("the detail pane stacks the message over the thread", () => {
    expect(page).toMatch(/callVoicemail && <VoicemailDetail voicemail=\{callVoicemail\} fill=\{false\} \/>/);
    expect(page).toMatch(/voicemailForCall\(selectedCall, voicemailList\)/);
  });

  it("⚠️ stacked, it must not claim flex-1 — the thread underneath needs the room", () => {
    expect(detail).toMatch(/fill \? "min-h-0 flex-1" : "max-h-\[45%\] shrink-0/);
  });
});
