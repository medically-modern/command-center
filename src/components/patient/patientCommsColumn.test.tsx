/**
 * The patient screen's right column in Brandon's look (pixel-match item 14,
 * 2026-09-24) — LOOK ONLY (Josh: "leave communcaitons alone"). Rendered with
 * the Communications pieces stubbed, so what is checked is this column's own
 * markup: the two tabs, the Texts count, the number line and its chips.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Contacts } from "@/lib/patient/contacts";

const dial = vi.hoisted(() => vi.fn(async () => {}));
const reported = vi.hoisted(() => [] as string[]);
const threadProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));

vi.mock("@/hooks/assignedPatients/useWebPhone", () => ({
  useWebPhone: () => ({ call: null, dial }),
}));
vi.mock("@/hooks/commsInbox/useInbox", () => ({
  reportDial: (n: string) => reported.push(n),
}));
vi.mock("@/components/assignedPatients/ConversationThread", () => ({
  default: (p: Record<string, unknown>) => {
    threadProps.last = p;
    return <div data-testid="thread">thread for {String(p.phone)}</div>;
  },
}));
vi.mock("@/components/comms/CommunicationsButton", () => ({
  CommunicationsButton: () => <button type="button">Communications</button>,
}));
vi.mock("@/components/patient/RecentNotes", () => ({ RecentNotes: () => <div>Recent notes</div> }));
vi.mock("@/components/commsInbox/PatientResolveBar", () => ({ PatientResolveBar: () => null }));

import { PatientCommsColumn } from "./PatientCommsColumn";

const CONTACTS: Contacts = {
  primaryContact: "Patient",
  alternateContact: "Caregiver",
  caregiverName: "Sam Helper",
  caregiverAuthorized: true,
  alternatePhone: "(555) 555-0199",
  alternatePhoneRaw: "5555550199",
  canText: "yes",
  lastPatientContact: "",
  any: true,
};

function renderColumn(side: "texts" | "calls" = "texts", contacts: Contacts | null = CONTACTS) {
  const onSide = vi.fn();
  const r = render(
    <div className="cc-pt">
      <PatientCommsColumn
        phone="15555550100"
        patient={null}
        side={side}
        onSide={onSide}
        active={null}
        contacts={contacts}
        onNoteAppended={() => {}}
      />
    </div>,
  );
  return { ...r, onSide };
}

beforeEach(() => {
  dial.mockClear();
  reported.length = 0;
  threadProps.last = null;
});

describe("Brandon's right column (item 14) — the look", () => {
  it("the header is the two tabs and nothing else", () => {
    const { container } = renderColumn();
    const hd = container.querySelector(".pt-side .hd") as HTMLElement;
    const buttons = Array.from(hd.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(buttons).toEqual(["Texts", "Calls"]);
  });

  it("the thread is drawn BARE — its own header off, his one-line composer on", () => {
    renderColumn();
    expect(threadProps.last?.bare).toBe(true);
    expect(threadProps.last?.composerPlaceholder).toBe("Write a text…");
  });

  it("Texts shows the thread's count once it has loaded; ⚠️ Calls shows none", () => {
    const { container } = renderColumn();
    const onCount = threadProps.last?.onCount as (n: number) => void;
    act(() => onCount(7));
    const [texts, calls] = Array.from(container.querySelectorAll(".side-tabs button"));
    expect(texts.querySelector(".n")?.textContent).toBe("7");
    // Counting calls means reading RingCentral's call log for every patient
    // opened (§5.16) — no number beats one we cannot stand behind.
    expect(calls.querySelector(".n")).toBeNull();
  });

  it("before the thread loads there is no count at all — never a 0 we did not read", () => {
    const { container } = renderColumn();
    expect(container.querySelector(".side-tabs .n")).toBeNull();
  });

  it("the number line formats both numbers (xxx) xxx-xxxx", () => {
    const { container } = renderColumn();
    const line = container.querySelector(".numline")?.textContent ?? "";
    expect(line).toContain("(555) 555-0100");
    expect(line).toContain("alt (555) 555-0199 · Sam Helper");
    expect(line).toContain("primary · Patient");
  });
});

describe("⚠️ nothing a rep could do before is gone", () => {
  it("Call — a chip beside the primary number — dials it, and says who dialed first (§5.49)", () => {
    renderColumn();
    fireEvent.click(screen.getByRole("button", { name: /^Call$/ }));
    expect(reported).toEqual(["15555550100"]);
    expect(dial).toHaveBeenCalledWith("15555550100");
  });

  it("Call alt dials the alternate and points the column at it", () => {
    renderColumn();
    fireEvent.click(screen.getByRole("button", { name: /Call alt/ }));
    expect(dial).toHaveBeenCalledWith("5555550199");
    expect(threadProps.last?.phone).toBe("5555550199");
    // Still offered while on the alternate, as in his numline.
    expect(screen.getByRole("button", { name: /Call alt/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Back to primary/ })).toBeTruthy();
  });

  it("Text alt switches the thread, and names the number it will text", () => {
    renderColumn();
    fireEvent.click(screen.getByRole("button", { name: /Text alt/ }));
    expect(threadProps.last?.phone).toBe("5555550199");
    expect(threadProps.last?.composerPlaceholder).toBe("Write a text to (555) 555-0199…");
  });

  it("the Calls tab keeps the Communications button (§5.50)", () => {
    renderColumn("calls");
    expect(screen.getByRole("button", { name: "Communications" })).toBeTruthy();
  });

  it("no alternate number: no alt chips, and the primary still has its Call", () => {
    renderColumn("texts", { ...CONTACTS, alternatePhone: "", alternatePhoneRaw: "" });
    expect(screen.queryByRole("button", { name: /Call alt|Text alt/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Call$/ })).toBeTruthy();
  });
});
