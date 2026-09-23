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

  it("every Call on the hub reports who dialed, and only while the module is on", () => {
    expect(PAGE).toContain("if (commsConfig.enabled) reportDialed(phone);");
    expect(PAGE).not.toMatch(/void dial\(/);
  });
});

describe("the Monday copy happens when the rep moves on (plan §5.4)", () => {
  it("⚠️⚠️ releasing the sticky row is what copies the note", () => {
    const release = PAGE.slice(PAGE.indexOf("const releaseSticky = useCallback"), PAGE.indexOf("const openItem = useCallback"));
    expect(release).toContain("void flushCommsOutbox();");
    expect(release).toContain("if (!stickyRef.current) return;");
  });

  it("opening ANOTHER item releases it; re-opening the same one does not", () => {
    expect(PAGE).toContain("if (stickyRef.current && stickyRef.current.key !== key) releaseSticky();");
  });

  it("leaving the Inbox rail releases it, and the page catches up on open and on leave", () => {
    expect(PAGE).toContain('if (tab !== "inbox") releaseSticky();');
    const flush = PAGE.slice(PAGE.indexOf("if (!commsConfig.enabled) return;\n    void flushCommsOutbox();"));
    expect(flush).toContain("return () => {\n      void flushCommsOutbox();");
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
    expect(PAGE).toContain("(inboxOn ? [INBOX_TAB, ...TABS] : TABS)");
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
