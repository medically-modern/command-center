/**
 * The growing text box (Brandon, 2026-09-29: "Expand text box in insurance
 * follow-up so easier to send long texts"). Opt-in: the Communications popup
 * grows; every other composer is the two lines it always was.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import Composer from "./Composer";
import type { ConversationView } from "@/hooks/assignedPatients/useConversation";

const conversation = {
  consent: { optedOut: false, complete: true },
  loading: false,
  error: null,
  send: async () => {},
} as unknown as ConversationView;

const LONG = "Hi, this is Medically Modern. ".repeat(20);

describe("Composer grow", () => {
  it("sizes the box to its text when asked", () => {
    render(<Composer conversation={conversation} draft={LONG} onDraftChange={() => {}} grow />);
    const box = screen.getByPlaceholderText(/Text from/) as HTMLTextAreaElement;
    expect(box.style.height).toMatch(/px$/);
    expect(box.rows).toBe(3);
  });

  it("⚠️ absent, the box is the two lines every other screen has always had", () => {
    render(<Composer conversation={conversation} draft={LONG} onDraftChange={() => {}} />);
    const box = screen.getByPlaceholderText(/Text from/) as HTMLTextAreaElement;
    expect(box.style.height).toBe("");
    expect(box.rows).toBe(2);
  });

  it("the Communications popup — where Start Insurance Follow-Up lands — is what opts in", () => {
    expect(readFileSync("src/components/commsInbox/ItemTimeline.tsx", "utf8")).toContain("grow={view}");
    expect(readFileSync("src/components/comms/CommunicationsView.tsx", "utf8")).toMatch(/onSent=\{\(body\) => onTextSent\?\.\(body\)\}\s*grow\s*\/>/);
  });
});
