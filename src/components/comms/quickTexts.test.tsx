/**
 * Suggested-text buttons under the Communications text box (Brandon,
 * 2026-10-02) — the rules, the bar, and the board scope.
 *
 * Josh: *"click button, text shows in send, only show it on specified board …
 * run some tests to make sure that we can have a replicable system for
 * suggested texts only landing on certain boards"*. The bar is drawn only when
 * a caller passes a board's context, so the scope half is a source scan: the
 * failure it guards is a shared component (`PatientContact` sits on eleven
 * headers) quietly carrying the buttons onto another screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import QuickTextBar from "./QuickTextBar";
import {
  applyQuickText, firstName, oonText, quickTextsFor, QUICK_TEXTS, type QuickTextsContext,
} from "@/lib/comms/quickTexts";
import { BOOKING_URLS } from "@/lib/scheduledCalls/bookingLink";
import { parseScheduling, resetSchedulingCache } from "@/lib/scheduledCalls/schedulingConfig";

const OON =
  "Hey Neesha - I just reviewed your profile, and unfortunately we are not in-network with your insurance. " +
  "We're hoping to get in-network with more insurances soon, so feel free to reach back out at a later time.";

describe("quick-text rules", () => {
  it("the OON text is Brandon's, word for word, with the first name", () => {
    expect(oonText({ name: "Neesha Patel" })).toBe(OON);
    expect(oonText({ name: "  " })).toMatch(/^Hey there - I just reviewed/);
    expect(firstName("Neesha  Patel")).toBe("Neesha");
  });

  it("fills an empty box, keeps typed words, and never stacks a second copy", () => {
    expect(applyQuickText("", "A")).toBe("A");
    expect(applyQuickText("  \n", "A")).toBe("A");
    expect(applyQuickText("Hi Neesha,  ", "A")).toBe("Hi Neesha,\n\nA");
    expect(applyQuickText("A", "A")).toBe("A");
  });

  it("only a named board has buttons", () => {
    expect(quickTextsFor(undefined)).toEqual([]);
    expect(quickTextsFor("careCoordinator").map((a) => a.id)).toEqual(["oon", "booking-link"]);
  });

  it("reads the scheduling endpoint field by field, falling back on each", () => {
    expect(parseScheduling(null)).toEqual({ intakeUrl: BOOKING_URLS.intake, phoneParam: { intake: "", welcome: "" } });
    expect(parseScheduling({ enabled: false, url: "https://x" }).intakeUrl).toBe(BOOKING_URLS.intake);
    expect(parseScheduling({ enabled: true, url: "https://cal/x", phone_prefill: "location", welcome: { phone_prefill: "" } }))
      .toEqual({ intakeUrl: "https://cal/x", phoneParam: { intake: "location", welcome: "" } });
  });
});

function Harness({ context, initial = "" }: { context: QuickTextsContext; initial?: string }) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <textarea aria-label="box" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <QuickTextBar context={context} draft={draft} onDraftChange={setDraft} />
    </>
  );
}

const box = () => screen.getByLabelText("box") as HTMLTextAreaElement;
const CTX: QuickTextsContext = {
  board: "careCoordinator",
  patient: { name: "Neesha Patel", email: "neesha@example.com", phone: "(347) 555-0101" },
  bookingKind: "intake",
};

describe("QuickTextBar", () => {
  const writeText = vi.fn(async (_t: string) => {});
  beforeEach(() => {
    resetSchedulingCache();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({ enabled: true, url: "https://calendly.com/mm/intake-live", phone_prefill: "location", welcome: { phone_prefill: "" } }),
    })));
  });
  afterEach(() => {
    cleanup();
    writeText.mockClear();
    vi.unstubAllGlobals();
  });

  it("OON text lands in the box and does NOT send — the rep presses Send", () => {
    render(<Harness context={CTX} />);
    fireEvent.click(screen.getByRole("button", { name: /OON text/ }));
    expect(box().value).toBe(OON);
    // There is no send control in the bar at all.
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
  });

  it("keeps what the rep already typed", () => {
    render(<Harness context={CTX} initial="Hi again," />);
    fireEvent.click(screen.getByRole("button", { name: /OON text/ }));
    expect(box().value).toBe(`Hi again,\n\n${OON}`);
  });

  it("Copy booking link copies the same prefilled link the card's dialog sends", async () => {
    render(<Harness context={CTX} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy booking link/ }));
    });
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(
      "https://calendly.com/mm/intake-live?name=Neesha%20Patel&email=neesha%40example.com&location=3475550101",
    );
    expect(box().value).toBe(""); // copying never touches the draft
    expect(await screen.findByRole("button", { name: /Copied/ })).toBeInTheDocument();
  });

  it("a Welcome Call card copies the welcome link", async () => {
    render(<Harness context={{ ...CTX, bookingKind: "welcome" }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy booking link/ }));
    });
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(`${BOOKING_URLS.welcome}?name=Neesha%20Patel&email=neesha%40example.com`);
  });
});

/* ── Scope: which boards get buttons ─────────────────────────────────────── */

const SRC = join(process.cwd(), "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
/** Comments stripped — the files DOCUMENT the prop, and a raw scan would
 *  count the explanation as a caller. */
const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (rel: string) => code(join(SRC, rel));

/**
 * Board → the ONE file allowed to hand that board's context to the panel.
 * ⚠️ To give another board buttons: add it to `QUICK_TEXTS`, pass the context
 * from that board's own header, and add the pair here.
 */
const ALLOWED: Record<string, string> = {
  careCoordinator: "components/careCoordinator/PatientCard.tsx",
};

describe("suggested texts land only on the boards that ask for them", () => {
  it("every board in the registry has exactly one allowed caller, and vice versa", () => {
    expect(Object.keys(QUICK_TEXTS).sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it("only the allowed files pass a context into the panel", () => {
    const callers = walk(SRC)
      .filter((f) => /commsQuickTexts=\{/.test(code(f)))
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(callers).toEqual(Object.values(ALLOWED).sort());
    for (const [board, file] of Object.entries(ALLOWED)) {
      expect(read(file)).toContain(`board: "${board}"`);
    }
  });

  it("nobody else hands the panel buttons by another road", () => {
    // The pass-throughs, and only them: PatientContact → CommunicationsButton
    // → CommunicationsView. A `quickTexts=` anywhere else is a second way in.
    const direct = walk(SRC)
      .filter((f) => /\bquickTexts=\{/.test(code(f)))
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(direct).toEqual(["components/comms/CommunicationsButton.tsx", "components/masheke/mmKit.tsx"]);
    expect(read("components/masheke/mmKit.tsx")).toContain("quickTexts={commsQuickTexts}");
    expect(read("components/comms/CommunicationsButton.tsx")).toContain("quickTexts={quickTexts}");
  });

  it("the bar is drawn only when a context came in, under BOTH text boxes", () => {
    const view = read("components/comms/CommunicationsView.tsx");
    expect(view).toMatch(/const quickBar = quickTexts \? \(\s*<QuickTextBar/);
    // The inbox timeline and the RingCentral fallback each get it.
    expect(view.match(/composerFooter=\{quickBar\}/g)).toHaveLength(2);
    expect(view).toMatch(/grow\s*\/>\s*\{composerFooter\}/);
    expect(read("components/commsInbox/ItemTimeline.tsx")).toMatch(/grow=\{view\} \/>\s*\{composerFooter\}/);
  });
});
