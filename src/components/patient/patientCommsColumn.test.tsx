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
/* The Postgres call counts (Josh, 2026-09-24) — the SAME hook the Care
   Coordinator cards read (§5.30i); here it is the answer it hands the column. */
const totalsView = vi.hoisted(() => ({
  current: { byNumber: new Map(), coverage: null as null | { callsSince: string | null; textsSince: string | null } },
}));
const totalsArgs = vi.hoisted(() => [] as string[][]);
vi.mock("@/hooks/careCoordinator/useContactTotals", () => ({
  useContactTotals: (phones: string[]) => {
    totalsArgs.push([...phones]);
    return totalsView.current;
  },
}));
vi.mock("@/lib/assignedPatients/messagingApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/assignedPatients/messagingApi")>()),
  messagingConfigured: () => true,
}));
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
  totalsArgs.length = 0;
  totalsView.current = { byNumber: new Map(), coverage: null };
});

const answer = (callsOut: number | null, callsIn: number | null, reachedByCall = false) => ({
  callsOut,
  callsIn,
  textsOut: 0,
  textsIn: 0,
  reachedByCall,
});
/** Both numbers answered: 12 out / 5 in, 3 of them with the alternate. */
function bothAnswered() {
  totalsView.current = {
    byNumber: new Map([
      ["5555550100", answer(10, 4, true)],
      ["5555550199", answer(2, 1)],
    ]),
    coverage: { callsSince: "2026-06-18T14:00:00.000Z", textsSince: null },
  };
}

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

  it("Texts shows the thread's count once it has loaded", () => {
    const { container } = renderColumn();
    const onCount = threadProps.last?.onCount as (n: number) => void;
    act(() => onCount(7));
    const [texts] = Array.from(container.querySelectorAll(".side-tabs button"));
    expect(texts.querySelector(".n")?.textContent).toBe("7");
  });

  it("before anything loads there is no count at all — never a 0 we did not read", () => {
    const { container } = renderColumn();
    expect(container.querySelector(".side-tabs .n")).toBeNull();
  });
});

describe("⚠️ Calls N — from OUR call archive in Postgres (Josh, 2026-09-24)", () => {
  it("asks about the patient's BOTH numbers, through the Care Coordinator's hook", () => {
    renderColumn();
    expect(totalsArgs.at(-1)).toEqual(["15555550100", "5555550199"]);
  });

  it("the Calls tab carries the total once both numbers have answered", () => {
    bothAnswered();
    const { container } = renderColumn();
    const calls = Array.from(container.querySelectorAll(".side-tabs button"))[1];
    expect(calls.querySelector(".n")?.textContent).toBe("17");
  });

  it("⚠️ no total from one of the two numbers", () => {
    totalsView.current = { byNumber: new Map([["5555550100", answer(10, 4)]]), coverage: null };
    const { container } = renderColumn();
    expect(container.querySelector(".side-tabs .n")).toBeNull();
  });

  it("the Calls tab leads with we called / they called, and says when our records begin", () => {
    bothAnswered();
    renderColumn("calls");
    const card = screen.getByTestId("call-counts");
    expect(card.textContent).toContain("Calls on record · since Jun 18, 2026");
    expect(card.textContent).toContain("We called12");
    expect(card.textContent).toContain("They've picked up");
    expect(card.textContent).toContain("They called5");
    expect(card.textContent).toContain("Includes 3 with the alternate number (Sam Helper).");
  });

  it("⚠️ the archive being off shows NO numbers — never a 0 standing in for an answer", () => {
    totalsView.current = {
      byNumber: new Map([
        ["5555550100", answer(null, null)],
        ["5555550199", answer(null, null)],
      ]),
      coverage: null,
    };
    const { container } = renderColumn("calls");
    const card = screen.getByTestId("call-counts");
    expect(card.textContent).toContain("aren't available");
    expect(card.textContent).not.toMatch(/\d/);
    expect(container.querySelector(".side-tabs .n")).toBeNull();
  });

  it("counting says so rather than showing zeros", () => {
    renderColumn("calls");
    expect(screen.getByTestId("call-counts").textContent).toContain("Counting calls");
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
