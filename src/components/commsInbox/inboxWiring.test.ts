/**
 * ⚠️ The Inbox is WIRED the way COMMS_INBOX_PLAN.md §10 says it must be.
 *
 * §5.31b's rule: *"a module nobody calls does not fail; it is absent, and its
 * green tests say otherwise."* Each assertion is a source scan because each
 * failure is silent on screen — a second copy of the opt-out guard still sends,
 * a note copied before Undo is over still reads fine on Monday, a RingCentral
 * read in the badge store still shows a number.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const src = (p: string) => readFileSync(resolve(root, p), "utf8");
/** Source with comments removed — several files document the very calls they must not make. */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const dirFiles = (dir: string) =>
  readdirSync(resolve(root, dir))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
    .map((f) => join(dir, f));

/** Every non-test source file under a directory, recursively. */
const srcFiles = (dir: string): string[] =>
  readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? srcFiles(join(dir, e.name))
      : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

const INBOX_SRC = [...dirFiles("src/components/commsInbox"), ...dirFiles("src/lib/commsInbox"), ...dirFiles("src/hooks/commsInbox")];
const PAGE = code("src/pages/AssignedPatientsPage.tsx");

describe("the thread's guards — one copy (plan §4.6)", () => {
  it("the scan found the Inbox's files", () => {
    expect(INBOX_SRC.length).toBeGreaterThanOrEqual(8);
  });

  it("⚠️⚠️ the timeline reuses the thread's composer and conversation, never a copy", () => {
    const tl = code("src/components/commsInbox/ItemTimeline.tsx");
    expect(tl).toContain('import Composer from "@/components/assignedPatients/Composer"');
    expect(tl).toContain('import { useConversation } from "@/hooks/assignedPatients/useConversation"');
    expect(tl).toContain("<Composer conversation={live} canText={canText}");
    for (const f of INBOX_SRC) {
      const c = code(f);
      expect(c, f).not.toMatch(/\bsendMessage\(/);
      expect(c, f).not.toMatch(/\bconsentState\(/);
      expect(c, f).not.toContain("assignedPatients/optOut");
    }
  });

  it("the hub's own thread renders the same two pieces", () => {
    const thread = code("src/components/assignedPatients/ConversationThread.tsx");
    expect(thread).toContain("useConversation(phone, patient?.itemId)");
    expect(thread).toContain("<Composer conversation={conversation} canText={canText} />");
    expect(thread).not.toMatch(/\bsendMessage\(/);
    expect(code("src/components/assignedPatients/Composer.tsx")).not.toMatch(/\bsendMessage\(/);
    expect(code("src/hooks/assignedPatients/useConversation.ts")).toMatch(/\bsendMessage\(/);
  });

  it("⚠️ the live copy wins a collision — the merge is the timeline's only source of texts on screen", () => {
    expect(code("src/components/commsInbox/ItemTimeline.tsx")).toContain("mergeLiveTexts(item.timeline, conversation.messages");
  });
});

describe("the network (plan §4.6, §4.7)", () => {
  it("⚠️⚠️ the inbox stores read Postgres through the gateway, never RingCentral", () => {
    const store = code("src/hooks/commsInbox/useInbox.ts");
    expect(store).not.toContain("ringcentralApi");
    expect(store).not.toContain("/rc/");
    expect(code("src/lib/commsInbox/api.ts")).not.toContain("ringcentralApi");
  });

  it("⚠️ nothing in the Inbox calls fetch() itself — a presigned URL is a bare src, never fetched", () => {
    for (const f of [...dirFiles("src/components/commsInbox"), ...dirFiles("src/hooks/commsInbox")]) {
      expect(code(f), f).not.toMatch(/\bfetch\(/);
    }
  });

  it("⚠️ no hand-rolled Monday mutation — numbers go through updatePatientContact, notes through appendNoteToRecord", () => {
    for (const f of INBOX_SRC) {
      const c = code(f);
      expect(c, f).not.toContain("change_multiple_column_values");
      expect(c, f).not.toContain("change_column_value");
      expect(c, f).not.toMatch(/\bgql\(/);
    }
    expect(code("src/components/commsInbox/AddNumberCard.tsx")).toContain("{ updatePatientContact, linkNumber, forgetDirectoryName }");
    expect(code("src/hooks/commsInbox/useInbox.ts")).toContain("await appendNoteToRecord({");
  });

  it("every Call that dials through the softphone reports who dialed, through ONE entry point", () => {
    // The hub: every Call goes through dialNumber, which reports first.
    const dialNumber = PAGE.slice(PAGE.indexOf("const dialNumber = useCallback"), PAGE.indexOf("const dialNumber = useCallback") + 200);
    expect(dialNumber).toContain("reportDial(phone);");
    expect(PAGE).not.toMatch(/void dial\(/);
    // ⚠️ EVERY file that dials, found by scanning — not a list of the ones we
    // knew about. A dialer added later (the intake page's DialPatientDialog
    // arrived that way, 2026-09-23) would otherwise place calls nobody is
    // credited with, and nothing would error.
    const DIAL = /(?:\.|\b)dial\(/;
    const dialers = srcFiles("src")
      .filter((f) => !f.startsWith("src/lib/softphone/"))
      .filter((f) => DIAL.test(code(f)));
    expect(dialers).toEqual(expect.arrayContaining([
      "src/pages/AssignedPatientsPage.tsx",
      "src/components/careCoordinator/CallPatientDialog.tsx",
      "src/components/shared/DialPatientDialog.tsx",
    ]));
    for (const f of dialers) {
      const c = code(f);
      const report = c.indexOf("reportDial(");
      expect(report, `${f} dials without reportDial`).toBeGreaterThan(-1);
      expect(report, `${f} dials before it reports`).toBeLessThan(c.search(DIAL));
    }
    // Only while the module is on — and never guessed before the switch is read.
    const store = code("src/hooks/commsInbox/useInbox.ts");
    const fn = store.slice(store.indexOf("export function reportDial("), store.indexOf("export function useCommsConfig"));
    expect(fn).toContain("if (c.enabled) reportDialed(number);");
    expect(fn).toContain("if (configStore.get().enabled) reportDialed(number);");
  });
});

describe("the Monday copy happens when the rep moves on (plan §5.4)", () => {
  it("⚠️⚠️ releasing the sticky row is what copies the note — THAT note, named", () => {
    const release = PAGE.slice(PAGE.indexOf("const releaseSticky = useCallback"), PAGE.indexOf("const openItem = useCallback"));
    // The one moved on from is copied now; anything else waits out its Undo
    // window, because another tab may still offer Undo on it (2026-09-23 review).
    expect(release).toContain("void flushCommsOutbox(s.resolutionId);");
    expect(release).toContain("if (!s) return;");
  });

  it("opening ANOTHER item releases it; re-opening the same one does not", () => {
    expect(PAGE).toContain("if (stickyRef.current && stickyRef.current.key !== key) releaseSticky();");
  });

  it("moving on releases it in ANY rail — another item or none — and the page catches up on open and on leave", () => {
    expect(PAGE).toContain("if (stickyRef.current && stickyRef.current.key !== openKey) releaseSticky();");
    expect(PAGE).toContain("}, [openKey, logKeyPending, releaseSticky]);");
    const flush = PAGE.slice(PAGE.indexOf("if (!commsConfig.enabled) return;\n    void flushCommsOutbox();"));
    // Leaving copies the note still held here, by name.
    expect(flush).toContain("return () => {\n      void flushCommsOutbox(stickyRef.current?.resolutionId);");
  });

  it("⚠️ a log row's key still being LOOKED UP is not moving on (2026-09-23 review)", () => {
    // While it loads the open key reads null; releasing then copied the note and
    // took its Undo away on the way to re-opening the very same item.
    expect(PAGE).toContain("const logKeyPending = logRail && logItemKey.loading;");
    const eff = PAGE.slice(PAGE.indexOf("const logKeyPending"), PAGE.indexOf("}, [openKey, logKeyPending, releaseSticky]);"));
    expect(eff.indexOf("if (logKeyPending) return;")).toBeGreaterThan(-1);
    expect(eff.indexOf("if (logKeyPending) return;")).toBeLessThan(eff.indexOf("releaseSticky()"));
  });

  it("⚠️ the open item is compared with its row — a row that leaves and comes back changed is re-read", () => {
    expect(PAGE).toContain("const rowSig = selectedRow ? inboxStateSig(selectedRow) : \"\";");
    expect(PAGE).toContain("itemSigRef.current = item && item.key === selectedKey ? inboxStateSig(item.state) : \"\";");
    expect(PAGE).toContain("if (!rowSig || !loaded || loaded === rowSig) return;");
    // The old guard that read a returning row as a first sighting is gone.
    expect(PAGE).not.toContain("!prev.sig");
  });

  it("⚠️ a matched item's pane falls back to the item's own record, in the Inbox AND the log rails", () => {
    expect(PAGE).toContain("tab === \"inbox\" || logRail ? inboxAnchor : null,");
    expect(PAGE).toMatch(/if \(!item \|\| isUnmatchedKey\(item\.key\) \|\| !item\.itemId \|\| !item\.boardId\) return null;/);
  });

  it("⚠️ on a shared line the note follows the patient on screen, through to the resolve", () => {
    expect(PAGE).toContain("noteTarget={inboxNoteTarget}");
    const tl = code("src/components/commsInbox/ItemTimeline.tsx");
    expect(tl).toContain("noteTarget={noteTarget}");
    const rb = code("src/components/commsInbox/ResolveBar.tsx");
    expect(rb).toContain("...(noteTarget ? { noteTarget } : {})");
  });

  it("⚠️ the copy claims before it writes", () => {
    const store = code("src/hooks/commsInbox/useInbox.ts");
    const copy = store.slice(store.indexOf("export async function copyOne"));
    expect(copy.indexOf("claimMirror(")).toBeGreaterThan(-1);
    expect(copy.indexOf("claimMirror(")).toBeLessThan(copy.indexOf("appendNoteToRecord("));
  });
});

describe("additive first (plan §8)", () => {
  it("the Inbox rail exists only when the gateway switches it on", () => {
    expect(PAGE).toContain("(inboxOn ? INBOX_TABS : TABS)");
    expect(PAGE).toContain("const inboxOn = commsConfig.ui;");
    // The existing three rails are untouched.
    expect(PAGE).toContain('{ id: "phone", label: "Phone", Icon: Phone },');
    expect(PAGE).toContain('{ id: "text", label: "Text", Icon: MessageSquare },');
    expect(PAGE).toContain('{ id: "fax", label: "Fax", Icon: Printer },');
  });

  it("the header badge is the unresolved count, only when the Inbox is on", () => {
    const header = code("src/components/shell/GlobalHeader.tsx");
    expect(header).toContain('useInboxBadge(commsConfig.ui && hasAbility(who, config, "comms"))');
    expect(header).toContain('t.key === "comms" && inboxBadge ? inboxBadge.open : 0');
  });
});

describe("the resolve bar (plan §5)", () => {
  it("⚠️ Called never resolves without a note", () => {
    expect(code("src/components/commsInbox/ResolveBar.tsx")).toContain('if (how === "called" && !text.trim()) return;');
  });

  it("⚠️ it is keyed on the item, so a half-typed note cannot follow the rep", () => {
    expect(code("src/components/commsInbox/ItemTimeline.tsx")).toMatch(/<ResolveBar\s+key=\{item\.key\}/);
  });

  it("⚠️ seenThrough is what the rep was shown, and nothing newer", () => {
    expect(code("src/components/commsInbox/ItemTimeline.tsx")).toContain(
      "seenThroughFor(entries, item.state.newestOpenAt)",
    );
  });
});

describe("adding a number to a patient (plan §6)", () => {
  it("⚠️ the card's handler re-checks Edit profile — the hidden button is not the gate", () => {
    const card = code("src/components/commsInbox/AddNumberCard.tsx");
    expect(card).toContain('const canEdit = useAbility("editProfile");');
    expect(card).toContain('if (as !== "link" && (!canEdit || !opts.primary)) return;');
    // And it writes through the one rule, never around it.
    expect(card).toContain("addNumberToPatient(");
    expect(card).not.toMatch(/updatePatientContact\(\s*\{/);
  });

  it("⚠️ a failed text is never suggested as Texted — the browser reads the SPA's one delivery rule", () => {
    const tl = code("src/lib/commsInbox/timeline.ts");
    expect(tl).toContain('import { smsDeliveryState } from "@/lib/shared/smsDelivery"');
    expect(tl).toContain('smsDeliveryState(e.status) === "failed"');
  });
});

describe("phase 3 — the logs open the item (plan §1.2, Josh's D4)", () => {
  it("⚠️ a log row opens its number's item — and only once the Inbox is on", () => {
    expect(PAGE).toContain("const logRail = inboxOn && isLogTab(tab);");
    expect(PAGE).toContain('const logItemKey = useItemKeyForNumber(logRail ? logPhone : "");');
    expect(PAGE).toContain("const inboxItem = useInboxItem(openKey);");
    // One rendering of the item, whichever rail opened it.
    expect(PAGE.match(/<ItemTimeline\b/g)?.length).toBe(1);
    expect(PAGE.match(/itemTimeline\(item\)/g)?.length).toBe(2);
  });

  it("⚠️⚠️ a log never dead-ends: if the Inbox can't be read, the old thread renders", () => {
    const branch = PAGE.slice(PAGE.indexOf("{logRail &&\n"), PAGE.indexOf('{tab === "text" &&\n            !logRail'));
    expect(branch).toContain("logItemKey.error || inboxItem.error ?");
    expect(branch).toContain("{legacyLogDetail()}");
    expect(PAGE).toContain("<ConversationThread\n          key={logPhone}");
  });

  it("⚠️ nothing the old thread header had is lost — the watch-callback bell comes along", () => {
    const tl = code("src/components/commsInbox/ItemTimeline.tsx");
    expect(tl).toContain("<WatchCallbackButton phone={active.e164} label={item.name} />");
  });

  it("the switched-off hub is untouched: Text and Phone keep their own details", () => {
    expect(PAGE).toContain('{tab === "text" &&\n            !logRail &&');
    expect(PAGE).toContain('{tab === "phone" &&');
  });

  it("the Unread / Unheard FILTERS retire only with the Inbox on — the read flag stays", () => {
    expect(PAGE).toContain("logFilter={inboxOn ? textLog : undefined}");
    expect(PAGE).toContain("onLogFilter={inboxOn ? setTextLog : undefined}");
    expect(PAGE).toContain("log={{ callFilter: callLog, onCallFilter: setCallLog }}");
    // With the Inbox on, only Inbox (unresolved) and Fax (unread) carry a count.
    const badge = PAGE.slice(PAGE.indexOf("const badge ="), PAGE.indexOf("return (\n              <button\n                key={id}"));
    expect(badge).toContain("inboxOn\n                    ? 0");
    // The row menus that flip RingCentral's read flag are still wired.
    expect(PAGE).toContain("onMarkUnread={markUnread}");
    expect(PAGE).toContain("onSetVoicemailRead={setVoicemailRead}");
  });

  it("⚠️ a log row's key is bound to the number it was asked for", () => {
    const hook = code("src/hooks/commsInbox/useInbox.ts");
    const fn = hook.slice(hook.indexOf("export function useItemKeyForNumber"));
    expect(fn).toContain("const mine = got.phone === phone;");
    expect(fn).toContain("key: phone && mine ? got.key : null,");
    // …and the item itself is only ever the one asked for.
    expect(hook).toContain("item: item && item.key === key ? item : null");
  });
});

describe("phase 3 — the patient screen's compact bar (plan §1.2)", () => {
  const bar = code("src/components/commsInbox/PatientResolveBar.tsx");

  it("is the Inbox's own ResolveBar, compact, at the top of the column", () => {
    expect(bar).toContain('import ResolveBar, { type StickyResolution } from "@/components/commsInbox/ResolveBar";');
    expect(bar).toContain("compact");
    const col = code("src/components/patient/PatientCommsColumn.tsx");
    expect(col.indexOf("<PatientResolveBar numbers={[phone, alt]} noteTarget={noteTarget} />")).toBeGreaterThan(-1);
    // The screen's own record: a note made on this patient's screen is theirs.
    expect(code("src/pages/PatientPage.tsx")).toContain("noteTarget={noteTarget}");
    expect(col.indexOf("<PatientResolveBar")).toBeLessThan(col.indexOf('<div className="hd">'));
  });

  it("⚠️ renders nothing with the Inbox off — the patient screen is what it was", () => {
    expect(bar).toContain("if (!cfg.ui || !data) return null;");
    expect(bar).toContain("if (!state.open && !state.lastResolution) return null;");
  });

  it("⚠️ leaving the patient is 'moving on': the note is copied then, not before", () => {
    expect(bar).toMatch(/return \(\) => \{\s*void flushCommsOutbox\(stickyRef\.current\?\.resolutionId\);/);
    // The column is keyed on the record, which is what makes a patient change an unmount.
    expect(code("src/pages/PatientPage.tsx")).toContain("<PatientCommsColumn\n            key={active?.itemId ?? itemId}");
  });

  it("reads Postgres on open and after an action — never a poll, never RingCentral", () => {
    expect(bar).not.toMatch(/setInterval|setTimeout/);
    expect(bar).not.toMatch(/ringcentralApi|\/rc\//);
    expect(bar).toContain("fetchCommsState(");
  });
});

describe("phase 4 — the SLA card on Reports & Metrics (plan §1.2, Josh's D8)", () => {
  const REPORTS = code("src/pages/OperationsPage.tsx");
  const CARD = code("src/components/commsInbox/SlaCard.tsx");

  it("renders only with the Inbox switched on — off, the page is the blank one it was", () => {
    expect(REPORTS).toMatch(/comms\.ui \? \(\s*<div className="mx-auto max-w-6xl">\s*<SlaCard \/>/);
    expect(REPORTS).toContain("No reports available yet");
    // It borrows nothing: still not the Operations burndown (lossless.test.ts).
    expect(REPORTS).not.toContain("<OperationsTab");
  });

  it("⚠️⚠️ every number is the gateway's — the browser keeps no second copy of the report", () => {
    expect(CARD).toContain("await fetchSla(SLA_DAYS)");
    for (const f of [CARD, code("src/lib/commsInbox/sla.ts")]) {
      expect(f).not.toContain("countedWaitMs");
      expect(f).not.toMatch(/\bmedian\(/);
      expect(f).not.toContain("OVER_AFTER_MS");
    }
  });

  it("reads once on open and on Refresh — never polled, never RingCentral", () => {
    expect(CARD).not.toMatch(/setInterval|setTimeout/);
    expect(CARD).not.toContain("ringcentralApi");
  });

  it("⚠️ Open breaches lands on the hub's Over 24h view, read once and taken off the URL", () => {
    expect(CARD).toContain('export const OPEN_BREACHES_HREF = "/assigned-patients?inbox=over"');
    expect(code("src/App.tsx")).toContain('path="/assigned-patients"');
    expect(PAGE).toContain('const inboxViewParam = searchParams.get("inbox");');
    expect(PAGE).toMatch(/view: inboxViewParam === "over" \|\| inboxViewParam === "all" \? inboxViewParam : "open"/);
    expect(PAGE).toContain('next.delete("inbox");');
    expect(PAGE).toContain("{ replace: true }");
  });

  it("⚠️ the link reads the SIGNED-IN person's Communications ability, and is inert without it", () => {
    expect(CARD).toContain('const canWork = useAbility("comms");');
    expect(CARD).toMatch(/aria-disabled="true"/);
  });
});
