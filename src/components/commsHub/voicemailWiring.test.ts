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

  it("⚠️ opening a voicemail does NOT mark it heard", () => {
    // A fax is read by opening it; a voicemail is listened to — and the call
    // list opens one on its own now, so marking on open would empty the
    // Unheard filter as a rep scrolled. The menu is the only writer.
    const onSelect = page.match(/onSelect=\{\(phone\) => \{[\s\S]*?\}\}/)?.[0] ?? "";
    expect(onSelect).toMatch(/setSelectedVoicemail/);
    expect(onSelect).not.toMatch(/setVoicemailRead|setMessageRead/);
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

/**
 * The Phone / Text / Fax selector moved into the CENTRE of the Communications
 * header (Josh, 2026-09-15: *"we're losing so much space up here for the rest
 * of the tab — reformat this selector to be in the center"*), and the left rail
 * it replaced survives only below the breakpoint.
 */
describe("the tab selector sits in the header, not in a left rail", () => {
  it("is absolutely centred in the header row", () => {
    // `mx-auto` would not be centred: the title and the dialer are different
    // widths, so flex would leave it wherever the leftovers fall.
    expect(page).toMatch(/absolute left-1\/2 hidden -translate-x-1\/2[^"]*xl:flex/);
    expect(page).toMatch(/relative flex items-center gap-3 px-4 sm:px-6 py-4/);
  });

  it("⚠️ EXACTLY ONE of the two selectors is ever on screen", () => {
    // Both rendering at once is two live controls for one piece of state.
    expect(page).toMatch(/xl:flex/);
    expect(page).toMatch(/py-3 xl:hidden/);
  });

  it("⚠️ the breakpoint is xl — 1280 is measured, not chosen for looking round", () => {
    // Rendered against the compiled CSS at nine widths: md (768) overlapped
    // the dialer by 152px and the title by 68px, lg (1024) still by 24px.
    // 1280 leaves 188px / 104px of air. Lowering it needs a re-measure.
    expect(page).not.toMatch(/(md|lg):flex[^"]*ring-white\/20/);
    expect(page).not.toMatch(/py-3 (md|lg):hidden/);
  });

  it("⚠️ the header itself is UNCHANGED — navy, icon, eyebrow, title (§7)", () => {
    // The session that restyled this into a white strip had it sent back as
    // half-built. Moving a control INTO the header is not restyling it.
    expect(page).toMatch(/bg-gradient-navy text-navy-foreground/);
    expect(page).toMatch(/Medically Modern · RingCentral/);
    expect(page).toMatch(/<h1 className="truncate text-xl font-bold">Communications<\/h1>/);
  });

  it("the dialer gives up the centre and sits right, before the bell", () => {
    expect(page).toMatch(/ml-auto flex items-center gap-2 rounded-xl bg-white\/10/);
    expect(page).not.toMatch(/mx-auto flex items-center gap-2 rounded-xl bg-white\/10/);
  });
});
