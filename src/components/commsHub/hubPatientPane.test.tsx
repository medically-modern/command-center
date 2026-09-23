/**
 * The hub's right pane once the Inbox is on — the patient screen, embedded
 * (COMMS_INBOX_PLAN.md §7, Josh's D3), rendered. FAKE people, 555 numbers.
 *
 * The body is stubbed: it is the patient screen's own component and has its
 * own tests. What is tested here is what the PANE adds around it — the five
 * jobs the old pane did — and that its view state belongs to one patient.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildDossier, type DossierItem } from "@/lib/commsHub/dossier";

const m = vi.hoisted(() => ({
  append: vi.fn(async (_o: unknown) => "new body"),
  bodies: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/commsHub/dossierApi", () => ({
  appendNoteToRecord: (o: unknown) => m.append(o),
}));
vi.mock("@/components/commsHub/DossierSearch", () => ({
  default: () => <input aria-label="Find their profile" />,
}));
vi.mock("@/components/patient/PatientBody", () => ({
  PatientBody: (p: {
    embedded?: boolean;
    afterTop?: React.ReactNode;
    params: { get(n: string): string | null };
    setParam: (patch: Record<string, string>) => void;
    dossier: { name: string };
  }) => {
    m.bodies.push(p as never);
    return (
      <div data-testid="body" data-embedded={String(!!p.embedded)}>
        <span data-testid="who">{p.dossier.name}</span>
        {p.afterTop}
        <span data-testid="step">{String(p.params.get("step"))}</span>
        <button onClick={() => p.setParam({ step: "2" })}>pick step</button>
      </div>
    );
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import HubPatientPane from "./HubPatientPane";
import { profilePageHref } from "@/lib/patient/profileHref";

function it_(over: Partial<DossierItem> & { itemId: string; boardId: number; name: string }): DossierItem {
  return {
    phone: "+15550001111",
    boardName: over.boardId === 18410804557 ? "Welcome Call" : "Medical Evaluation",
    groupId: "g",
    groupTitle: "Welcome Call",
    isCompleted: false,
    isStuck: false,
    escalationText: "",
    escalationLevel: null,
    isProposedStuck: false,
    dob: "01/02/1960",
    route: "/welcome-call",
    stageAdvancerText: "",
    notes: "",
    notesColId: "text_mm6vqq2k",
    notesColType: "text",
    nextActionDate: "",
    daysSinceStage: "",
    createdAt: "",
    cols: {},
    ...over,
  } as DossierItem;
}

const live = it_({ itemId: "101", boardId: 18410804557, name: "Ada Sample", notes: "[9/1/26, 10:02 AM] Welcome Call: spoke to her —KT" });
const done = it_({
  itemId: "201",
  boardId: 18406060017,
  name: "Ada Sample",
  isCompleted: true,
  groupTitle: "Completed",
  route: "/evaluate",
  notes: "[8/1/26, 9:00 AM] Evaluate: MN established —JH",
});
const ada = buildDossier([live, done]);
const ben = buildDossier([it_({ itemId: "301", boardId: 18410804557, name: "Ben Sample" })]);

const show = (props: Partial<Parameters<typeof HubPatientPane>[0]> = {}) =>
  render(
    <MemoryRouter>
      <HubPatientPane dossier={ada} loading={false} error={null} phone="+15550001111" {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.bodies = [];
});

describe("HubPatientPane", () => {
  it("draws the patient screen's body, embedded, with the writable notes above the view", () => {
    show();
    const body = screen.getByTestId("body");
    expect(body.getAttribute("data-embedded")).toBe("true");
    // Job 2: the live stage's notes, writable.
    const notes = body.querySelector("[data-live-notes]") as HTMLElement;
    expect(notes).toBeTruthy();
    expect(notes.textContent).toContain("spoke to her");
    expect(screen.getByRole("button", { name: /Add a note/ })).toBeTruthy();
    // Job 3: every OTHER stage's notes, collapsed.
    expect(notes.textContent).toContain("Notes from other stages (1)");
    expect(notes.textContent).toContain("Medical Evaluation");
  });

  it("⚠️ the note composer writes through appendNoteToRecord, against the LIVE record", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Add a note/ }));
    fireEvent.change(screen.getByPlaceholderText(/Add to .* notes/), { target: { value: "called back" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add note" })));
    expect(m.append).toHaveBeenCalledWith(expect.objectContaining({ itemId: "101", boardId: 18410804557, text: "called back" }));
  });

  it("⚠️⚠️ job 1 — a shared number shows the switcher ABOVE the profile, and switching calls up", () => {
    const onSelectPerson = vi.fn();
    const { container } = show({ people: [ada, ben], selected: 0, onSelectPerson });
    const sw = container.querySelector("[data-household-switcher]") as HTMLElement;
    expect(sw.textContent).toContain("2 patients share this number");
    // Before the body in document order — it decides whose profile the rest is.
    expect(sw.compareDocumentPosition(screen.getByTestId("body")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ben Sample" }));
    expect(onSelectPerson).toHaveBeenCalledWith(1);
  });

  it("no switcher for a number only one patient has", () => {
    const { container } = show({ people: [ada] });
    expect(container.querySelector("[data-household-switcher]")).toBeNull();
  });

  it("job 4 — a number on no board offers the search, and a pick says it was found by search", () => {
    const onPick = vi.fn();
    const { unmount } = show({ dossier: null, onPick });
    expect(screen.getByText(/isn't on any pipeline board/)).toBeTruthy();
    expect(screen.getByLabelText("Find their profile")).toBeTruthy();
    unmount();

    const onClearPick = vi.fn();
    show({ phone: "+15550009999", picked: { itemId: "101", boardId: 18410804557, name: "Ada Sample", phone: "" }, onClearPick });
    expect(screen.getByText(/Found by search\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearPick).toHaveBeenCalled();
  });

  it("idle, loading and failed read the same as the old pane", () => {
    const { rerender } = render(
      <MemoryRouter>
        <HubPatientPane dossier={null} loading={false} error={null} phone={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/to see the patient's Command Center profile/)).toBeTruthy();
    rerender(
      <MemoryRouter>
        <HubPatientPane dossier={ada} loading error={null} phone="+15550001111" />
      </MemoryRouter>,
    );
    // ⚠️ `loading` alone hides the profile — never the previous patient's.
    expect(screen.getByText(/Looking them up/)).toBeTruthy();
    expect(screen.queryByTestId("body")).toBeNull();
    rerender(
      <MemoryRouter>
        <HubPatientPane dossier={null} loading={false} error="Monday 503" phone="+15550001111" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Couldn't load the profile/)).toBeTruthy();
  });

  it("⚠️ the view state belongs to ONE patient — the next one starts on their own defaults", () => {
    const { rerender } = show();
    expect(screen.getByTestId("step").textContent).toBe("null");
    fireEvent.click(screen.getByRole("button", { name: "pick step" }));
    expect(screen.getByTestId("step").textContent).toBe("2");
    rerender(
      <MemoryRouter>
        <HubPatientPane dossier={ben} loading={false} error={null} phone="+15550001111" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("who").textContent).toBe("Ben Sample");
    // Not one frame of Ada's step on Ben's screen: every render for Ben read null.
    const forBen = m.bodies.filter((b) => (b.dossier as { name: string }).name === "Ben Sample");
    expect(forBen.length).toBeGreaterThan(0);
    for (const b of forBen) expect((b.params as { get(n: string): string | null }).get("step")).toBeNull();
    // …and coming back to Ada is also a fresh start.
    rerender(
      <MemoryRouter>
        <HubPatientPane dossier={ada} loading={false} error={null} phone="+15550001111" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("step").textContent).toBe("null");
  });
});

describe("profilePageHref — the header's Open Profile Page", () => {
  it("opens the live record, carrying its board", () => {
    expect(profilePageHref(ada)).toBe("/patient/101?board=18410804557");
  });

  it("a patient with nothing live still opens — on the record the screen would anchor on", () => {
    const finished = buildDossier([done]);
    expect(profilePageHref(finished)).toBe("/patient/201?board=18406060017");
  });

  it("nothing to open without a record", () => {
    expect(profilePageHref(null)).toBeNull();
  });
});

/* ── the wiring, as source scans — each failure below is silent on screen ── */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const code = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("wiring — the five jobs come WITH the embedded screen (plan §7, Josh's D3)", () => {
  const PANE = code("src/components/commsHub/HubPatientPane.tsx");
  const OLD = code("src/components/commsHub/PatientDossierPanel.tsx");
  const VIEW = code("src/components/patient/OnboardingView.tsx");
  const HUB = code("src/pages/AssignedPatientsPage.tsx");

  it("each job is the old pane's OWN component, never a copy", () => {
    expect(PANE).toContain("<HouseholdSwitcher people={people} selected={selected} onSelectPerson={onSelectPerson} />"); // 1
    expect(PANE).toContain("<LiveNotes dossier={dossier} phone={phone}"); // 2 + 3
    expect(PANE).toContain("dossierPaneFallback({ phone, loading, error, dossier, idleHint, onPick })"); // 4
    expect(PANE).toContain("<FoundBySearchBanner"); // 4, after a pick
    expect(PANE).toMatch(/<PatientBody[\s\S]*?\bembedded\b/); // 5 rides the body's embedded mode
    // …and the old pane renders the same pieces, so the two cannot drift.
    for (const piece of ["<HouseholdSwitcher", "<LiveNotes", "dossierPaneFallback(", "<FoundBySearchBanner"]) {
      expect(OLD, piece).toContain(piece);
    }
    // ONE copy of the non-profile states: both panes import it, neither defines it.
    for (const src of [PANE, OLD]) {
      expect(src).toContain('import { dossierPaneFallback } from "');
      expect(src).not.toMatch(/function dossierPaneFallback\b/);
    }
  });

  it("⚠️ the notes box writes through appendNoteToRecord, and lists every other stage", () => {
    const live = OLD.slice(OLD.indexOf("export function LiveNotes"), OLD.indexOf("export function PatientDossierPanel"));
    expect(live).toContain("stageNoteTrail(dossier)");
    expect(live).toContain("<NoteComposer active={active} phone={phone}");
    const composer = OLD.slice(OLD.indexOf("export function NoteComposer"), OLD.indexOf("function newestLine"));
    expect(composer).toContain("await appendNoteToRecord({");
  });

  it("job 5 — embedded, the call-detail cards come BEFORE the stage tool", () => {
    const snap = VIEW.slice(VIEW.indexOf("function Snapshot"));
    expect(snap).toContain("buildStageDetail(item.boardId, item.cols)");
    const cards = snap.indexOf("sections.map((s) => (");
    expect(snap.indexOf("{!detailFirst && tool && <ToolPanel")).toBeLessThan(cards);
    expect(snap.indexOf("{detailFirst && tool && <ToolPanel")).toBeGreaterThan(cards);
    expect(VIEW).toContain("detailFirst={embedded}");
    // The live record's notes are the pane's own writable box — not drawn twice.
    expect(VIEW).toContain("{snap && !(embedded && snap.itemId === dossier.active?.itemId) && (");
  });

  it("⚠️ additive first — the embedded screen only with the Inbox on; off, the old pane untouched", () => {
    // `<HubPatientPane\s+dossier` — the bare tag name is a prefix of the
    // header's, and a looser pattern matched the HEADER's switch instead.
    expect(HUB).toMatch(/\{inboxOn \? \(\s*<HubPatientPane\s+dossier=\{dossier\.dossier\}[\s\S]*?\) : \(\s*<PatientDossierPanel/);
    expect(HUB).toMatch(/\{inboxOn \? \(\s*<HubPatientPaneHeader/);
    expect(HUB).toContain("Command Center profile");
    // The Inbox rail exists only when the Inbox is on, so it always embeds.
    const inboxBranch = HUB.slice(HUB.indexOf('{tab === "inbox" ? ('), HUB.indexOf(') : tab === "fax" ? ('));
    expect(inboxBranch).toContain("<HubPatientPane");
    expect(inboxBranch).not.toContain("<PatientDossierPanel");
    // A pencil's save re-derives the selected person, never the default one.
    expect((HUB.match(/onReload=\{dossier\.reload\}/g) ?? []).length).toBe(2);
  });

  it("the pane writes nothing of its own", () => {
    expect(PANE).not.toMatch(/change_(multiple_)?column_value|\bgql\(|\bfetch\(/);
  });
});
