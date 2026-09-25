/**
 * Pipeline Oversight in Brandon's look (pixel-match Phase 7, §5.52), rendered:
 * the header, the in-oversight finder, the pinned patient card, and the
 * drill-down that shares its confirm dialog with that card.
 *
 * ⚠️ Josh, 2026-09-24: *"a search inside oversight would be helpful but it
 * would need to be keyed on only patients that are IN oversight"* — and every
 * rule of the job is *"just changing the visuals and not the backend"*. So the
 * finder must find only what the charts hold, and every button on the card
 * must be a door the drill-down already had: the same route, the same writer.
 *
 * The Monday read and EVERY writer are mocked — nothing here can reach a board.
 * The patients are invented ("Test Patient …", ids "1"–"5").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OversightPatient } from "@/lib/oversight/oversightApi";

const state = vi.hoisted(() => ({
  map: null as Map<string, OversightPatient[]> | null,
}));

const writers = vi.hoisted(() => ({
  approveProposedStuck: vi.fn(async (..._a: unknown[]) => {}),
  returnProposedToQueue: vi.fn(async (..._a: unknown[]) => {}),
  approveInsuranceStuck: vi.fn(async (..._a: unknown[]) => {}),
  returnInsuranceToQueue: vi.fn(async (..._a: unknown[]) => {}),
  escalateSubmitAuthToFinal: vi.fn(async (..._a: unknown[]) => {}),
  approveIntakeStuck: vi.fn(async (..._a: unknown[]) => {}),
  returnIntakeToPipeline: vi.fn(async (..._a: unknown[]) => {}),
  proposeIntakeStuck: vi.fn(async (..._a: unknown[]) => {}),
  approveWelcomeCallStuck: vi.fn(async (..._a: unknown[]) => {}),
  returnWelcomeCallToQueue: vi.fn(async (..._a: unknown[]) => {}),
  escalateWelcomeCallToFinal: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock("@/lib/oversight/oversightApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/oversight/oversightApi")>()),
  fetchOversightData: vi.fn(async () => state.map),
  fetchPriorityOptions: vi.fn(async () => ({ referralTypes: [], insurances: [] })),
  fetchPillColors: vi.fn(async () => ({})),
  approveProposedStuck: writers.approveProposedStuck,
  returnProposedToQueue: writers.returnProposedToQueue,
  approveInsuranceStuck: writers.approveInsuranceStuck,
  returnInsuranceToQueue: writers.returnInsuranceToQueue,
  escalateSubmitAuthToFinal: writers.escalateSubmitAuthToFinal,
}));
vi.mock("@/lib/profile/unverifiedWrite", async (orig) => ({
  ...(await orig<typeof import("@/lib/profile/unverifiedWrite")>()),
  approveIntakeStuck: writers.approveIntakeStuck,
  returnIntakeToPipeline: writers.returnIntakeToPipeline,
  proposeIntakeStuck: writers.proposeIntakeStuck,
}));
vi.mock("@/lib/welcomeCall/mondayWrite", async (orig) => ({
  ...(await orig<typeof import("@/lib/welcomeCall/mondayWrite")>()),
  approveWelcomeCallStuck: writers.approveWelcomeCallStuck,
  returnWelcomeCallToQueue: writers.returnWelcomeCallToQueue,
  escalateWelcomeCallToFinal: writers.escalateWelcomeCallToFinal,
}));
vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ({
    access: { type: "manager" },
    email: "tester@example.com",
    config: { managers: [], processors: { "tester@example.com": { name: "Test Manager", roles: [] } }, callAnswerers: [] },
  }),
}));
vi.mock("@/lib/shared/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/shared/auth")>()),
  getUser: () => null,
}));

// Imported after the mocks are registered.
const { default: OversightTab } = await import("./OversightTab");

const ME = 18406060017;
const INSURANCE = 18410601299;
const WELCOME_CALL = 18410804557;

function pt(id: string, name: string, boardId: number, dayBucket: OversightPatient["dayBucket"] = "3–5 Days"): OversightPatient {
  return { id, name, boardId, groupId: "group_test", dayBucket, cols: {}, colIndex: {} };
}

/** One Medical Evaluation row in all three columns, plus two other sections. */
function fakeMap(): Map<string, OversightPatient[]> {
  return new Map<string, OversightPatient[]>([
    ["evaluate", [pt("1", "Test Patient A", ME)]],
    ["evaluate-escalated-merged", [pt("2", "Test Patient B", ME, "9–12 Days")]],
    ["evaluate-proposed-stuck", [pt("3", "Test Patient C", ME, "30+ Days")]],
    ["benefits", [pt("4", "Test Patient D", INSURANCE)]],
    ["welcome-call-manager", [pt("5", "Test Patient E", WELCOME_CALL, "Unknown")]],
  ]);
}

function UrlProbe() {
  const loc = useLocation();
  return <output data-testid="url">{`${loc.pathname}${loc.search}`}</output>;
}
const url = () => screen.getByTestId("url").textContent ?? "";

async function mount(entry = "/system-mgmt?tab=oversight") {
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <OversightTab />
      <UrlProbe />
    </MemoryRouter>,
  );
  await screen.findByText(/patients in the pipeline/);
  return view;
}

const finder = () => screen.getByRole("combobox", { name: "Search the pipeline" });
const stageSelect = () => screen.getByRole("combobox", { name: "Stage" }) as HTMLSelectElement;
const card = () => screen.getByRole("region", { name: "Pinned patient" });

function type(text: string) {
  fireEvent.focus(finder());
  fireEvent.change(finder(), { target: { value: text } });
}

async function pin(text: string, name: string) {
  type(text);
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: new RegExp(name) }));
  await waitFor(() => expect(within(card()).getByText(name)).toBeTruthy());
}

beforeEach(() => {
  localStorage.clear();
  state.map = fakeMap();
  for (const fn of Object.values(writers)) fn.mockClear();
});

describe("the header — Brandon's `.ov-hdr`", () => {
  it("names the signed-in person and counts everybody the charts hold, once each", async () => {
    await mount();
    expect(screen.getByRole("heading", { level: 1, name: "Pipeline Oversight" })).toBeTruthy();
    expect(screen.getByText("Test Manager · 5 patients in the pipeline")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit scoring/ })).toBeTruthy();
  });

  it("the stage is a native select listing every section", async () => {
    await mount();
    const sel = stageSelect();
    expect(sel.tagName).toBe("SELECT");
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      "Patient Intake", "Medical Evaluation", "Insurance", "Welcome Call",
    ]);
    fireEvent.change(sel, { target: { value: "insurance" } });
    expect(stageSelect().value).toBe("insurance");
    expect(screen.getByRole("heading", { level: 2, name: "Insurance" })).toBeTruthy();
    expect(url()).toContain("stage=insurance");
  });
});

describe("the finder — only patients IN oversight", () => {
  it("lists the matching pipeline patients with their stage and column", async () => {
    await mount();
    type("test patient");
    const listbox = await screen.findByRole("listbox");
    const rows = within(listbox).getAllByRole("option");
    expect(rows.map((r) => r.querySelector(".nm")?.textContent)).toEqual([
      "Test Patient A", "Test Patient B", "Test Patient C", "Test Patient D", "Test Patient E",
    ]);
    expect(rows[0].textContent).toContain("Medical Evaluation · 3–5 Days");
    expect(within(rows[1]).getByText("Manager intervention")).toBeTruthy();
    expect(within(rows[2]).getByText("Final decisions")).toBeTruthy();
    // An unknown day bucket is left off rather than printed.
    expect(rows[4].textContent).not.toContain("Unknown");
    expect(within(listbox).getByText(/^5 matches across every stage/)).toBeTruthy();
  });

  it("⚠️ a name the charts do not hold is never found — it says so instead", async () => {
    await mount();
    type("Test Nobody");
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryAllByRole("option")).toHaveLength(0);
    expect(within(listbox).getByText(/No patient named “Test Nobody” is in the pipeline right now/)).toBeTruthy();
  });

  it("asks for more before searching one letter", async () => {
    await mount();
    type("t");
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Keep typing — a patient's name.")).toBeTruthy();
  });

  it("picking a row switches the stage to theirs and pins them on top", async () => {
    await mount();
    expect(stageSelect().value).toBe("intake");
    await pin("patient c", "Test Patient C");
    expect(stageSelect().value).toBe("medical-evaluation");
    expect(screen.getByRole("heading", { level: 2, name: "Medical Evaluation" })).toBeTruthy();
    // The query clears and the list closes.
    expect((finder() as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(url()).toContain("patient=3");
    expect(url()).toContain("stage=medical-evaluation");
  });

  it("arrow keys move the highlight and Enter picks it; Escape clears", async () => {
    await mount();
    type("test patient");
    await screen.findByRole("listbox");
    fireEvent.keyDown(finder(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(finder(), { key: "Enter" });
    await waitFor(() => expect(within(card()).getByText("Test Patient B")).toBeTruthy());

    type("test");
    await screen.findByRole("listbox");
    fireEvent.keyDown(finder(), { key: "Escape" });
    expect((finder() as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("the pinned card — every button an existing door", () => {
  it("a Final Decisions patient gets Approve Stuck + Return to Queue, and the chips name their charts", async () => {
    await mount();
    await pin("patient c", "Test Patient C");
    const c = within(card());
    expect(c.getByText("30+ Days in stage")).toBeTruthy();
    expect(c.getByText("Evaluate (Proposed Stuck)").className).toContain("red");
    expect(c.getByRole("button", { name: /Approve Stuck/ })).toBeTruthy();
    expect(c.getByRole("button", { name: /Return to Queue/ })).toBeTruthy();
    expect(c.queryByRole("button", { name: /Escalate to Final/ })).toBeNull();
    expect(c.getByRole("link", { name: /Open profile/ }).getAttribute("href")).toBe(`/patient/3?board=${ME}`);
  });

  it("⚠️ a Processor Overview patient has nothing to decide — no decision buttons", async () => {
    await mount();
    await pin("patient a", "Test Patient A");
    const c = within(card());
    for (const label of [/Approve Stuck/, /Return to Queue/, /Escalate to Final/]) {
      expect(c.queryByRole("button", { name: label })).toBeNull();
    }
    expect(c.getByRole("button", { name: /Open in stage tool/ })).toBeTruthy();
  });

  it("⚠️ a Manager Intervention chart with no decision offers none either", async () => {
    await mount();
    await pin("patient b", "Test Patient B");
    const c = within(card());
    expect(c.getByText("Evaluate (Escalated)").className).toContain("amber");
    expect(c.queryByRole("button", { name: /Escalate to Final/ })).toBeNull();
  });

  it("Return to Queue confirms through the drill-down's dialog and calls the SAME writer", async () => {
    await mount();
    await pin("patient c", "Test Patient C");
    fireEvent.click(within(card()).getByRole("button", { name: /Return to Queue/ }));
    const dialog = await screen.findByRole("dialog", { name: "Return Test Patient C to the queue" });
    // Final Decisions' return keeps the note optional.
    expect(within(dialog).getByText("Add a note (optional)")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Return to Queue/ }));
    await waitFor(() => expect(writers.returnProposedToQueue).toHaveBeenCalledTimes(1));
    const [id, note] = writers.returnProposedToQueue.mock.calls[0];
    expect(id).toBe("3");
    expect(note).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writers.approveProposedStuck).not.toHaveBeenCalled();
  });

  it("Escalate to Final REQUIRES the note, then writes the Welcome Call board's own escalation", async () => {
    await mount();
    await pin("patient e", "Test Patient E");
    const c = within(card());
    expect(c.getByText("Days in stage unknown")).toBeTruthy();
    fireEvent.click(c.getByRole("button", { name: /Escalate to Final/ }));
    const dialog = await screen.findByRole("dialog", { name: "Escalate Test Patient E to Final Decisions" });
    const confirm = within(dialog).getByRole("button", { name: /Escalate to Final Decisions/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  sample reason  " } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(writers.escalateWelcomeCallToFinal).toHaveBeenCalledWith("5", "sample reason"));
  });

  it("Cancel and Escape close the dialog without writing", async () => {
    await mount();
    await pin("patient c", "Test Patient C");
    fireEvent.click(within(card()).getByRole("button", { name: /Approve Stuck/ }));
    const dialog = await screen.findByRole("dialog", { name: "Approve Test Patient C as Stuck" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: /Approve Stuck/ }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writers.approveProposedStuck).not.toHaveBeenCalled();
  });

  it("Open in stage tool opens the drill-down row's own destination, in manager mode", async () => {
    await mount();
    await pin("patient c", "Test Patient C");
    fireEvent.click(within(card()).getByRole("button", { name: /Open in stage tool/ }));
    await waitFor(() => expect(url().startsWith("/evaluate?")).toBe(true));
    const params = new URLSearchParams(url().split("?")[1]);
    expect(params.get("patientId")).toBe("3");
    expect(params.get("from")).toBe("system-mgmt");
    expect(params.get("mv")).toBe("final-decisions");
    expect(params.get("mvc")).toBe("evaluate-proposed-stuck");
    expect(params.get("manager")).toBe("1");
  });

  it("says when the pinned patient is in another stage, and switches on request", async () => {
    await mount();
    await pin("patient c", "Test Patient C");
    fireEvent.change(stageSelect(), { target: { value: "insurance" } });
    expect(card().textContent).toContain("This patient is in Medical Evaluation, not Insurance");
    fireEvent.click(within(card()).getByRole("button", { name: "switch to their stage" }));
    expect(stageSelect().value).toBe("medical-evaluation");
  });

  it("✕ clears the card and the URL", async () => {
    await mount();
    await pin("patient c", "Test Patient C");
    expect(url()).toContain("patient=3");
    fireEvent.click(within(card()).getByRole("button", { name: "Clear the pinned patient" }));
    expect(screen.queryByRole("region", { name: "Pinned patient" })).toBeNull();
    expect(url()).not.toContain("patient=");
  });

  it("is seeded from the URL, so Back from a stage tool lands on the same pin", async () => {
    await mount("/system-mgmt?tab=oversight&stage=medical-evaluation&patient=3");
    expect(within(card()).getByText("Test Patient C")).toBeTruthy();
    expect(stageSelect().value).toBe("medical-evaluation");
  });

  it("a pin the Map no longer holds says so rather than rendering an empty card", async () => {
    await mount("/system-mgmt?tab=oversight&patient=999");
    expect(card().textContent).toContain("This patient isn't in the pipeline any more");
  });
});

describe("the drill-down still decides — through the extracted dialog", () => {
  it("a Final Decisions row's Approve Stuck confirms and writes as before", async () => {
    await mount("/system-mgmt?tab=oversight&stage=medical-evaluation");
    fireEvent.click(screen.getByRole("button", { name: /^Evaluate \(Proposed Stuck\)/ }));
    const row = (await screen.findByText("Test Patient C")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Approve Stuck" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve Test Patient C as Stuck" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "sample note" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Approve Stuck/ }));
    await waitFor(() => expect(writers.approveProposedStuck).toHaveBeenCalledWith("3", "sample note"));
  });

  it("Escape closes the dialog first and leaves the drill-down open", async () => {
    await mount("/system-mgmt?tab=oversight&stage=medical-evaluation");
    fireEvent.click(screen.getByRole("button", { name: /^Evaluate \(Proposed Stuck\)/ }));
    const row = (await screen.findByText("Test Patient C")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Return to Queue" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Test Patient C").closest("tr")).toBeTruthy();
    expect(url()).toContain("chart=evaluate-proposed-stuck");
  });
});

// ── Source scans — the protections a regression would remove silently ──────

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Comments explain the rules; only code counts. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const TAB = code(read("src/components/oversight/OversightTab.tsx"));
const CSS_RAW = read("src/components/oversight/oversight.css");
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, "");

describe("OversightTab.tsx", () => {
  it("uses a native select — the shadcn Select is gone", () => {
    expect(TAB).not.toMatch(/from "@\/components\/ui\/select"/);
  });

  it("mirrors the pinned patient into the URL", () => {
    expect(TAB).toMatch(/next\.set\("patient", focusId\)/);
    expect(TAB).toMatch(/next\.delete\("patient"\)/);
  });

  it("⚠️ reads the decision rules from oversightFocus — no second copy here", () => {
    expect(TAB).toMatch(/decisionCopy\(/);
    expect(TAB).toMatch(/decisionActions\(/);
    expect(TAB).not.toMatch(/const BOT_OWNED_REASONS/);
    expect(TAB).not.toMatch(/const isBotOwnedRow/);
    // Both surfaces confirm through the one dialog.
    expect(TAB.match(/<DecisionConfirmModal\b/g)?.length).toBe(2);
  });

  it("the old in-stage name filter is gone — the finder pins instead of hiding bars", () => {
    expect(TAB).not.toMatch(/fuzzyNameMatch/);
    expect(TAB).not.toMatch(/bySearch/);
  });

  it("the chart card and plot wear Brandon's classes", () => {
    expect(TAB).toMatch(/const CHART_CARD_CLASS =\s*"[^"]*\bhist\b[^"]*"/);
    expect(TAB).toMatch(/const CHART_PLOT_CLASS =\s*"[^"]*\bhbars\b[^"]*"/);
  });

  it("the page puts its header strip in the page scope and loads the sheet", () => {
    const page = read("src/pages/OversightPage.tsx");
    expect(page).toMatch(/className="cc-ov-page\b/);
    expect(page).toMatch(/import "@\/components\/oversight\/oversight\.css"/);
    expect(TAB).toMatch(/import "\.\/oversight\.css"/);
  });
});

describe("oversight.css", () => {
  const selectors = [...CSS.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith("@"))
    .flatMap((s) => s.split(",").map((x) => x.trim()));

  it("⚠️ every selector is scoped to .cc-ov / .cc-ov-page — nothing reaches .pf-root or .bnr", () => {
    expect(selectors.length).toBeGreaterThan(50);
    for (const sel of selectors) {
      expect(sel, sel).toMatch(/(^|[\s>])\.cc-ov(-page)?(?![\w-])/);
    }
  });

  it("colours are tokens or his HSL — no hex but #fff", () => {
    const hex = CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex.filter((h) => h.toLowerCase() !== "#fff")).toEqual([]);
  });

  it("cancels Tailwind's `outline` utility on his outline buttons, with a focus ring AFTER it", () => {
    // Tailwind has a utility literally named `outline` (outline-style: solid)
    // and Brandon's button variant is `btn outline` — the patient screen
    // learned this the hard way (outlineCollision.test.ts).
    const cancel = CSS.search(/\.cc-ov \.btn\.outline\s*\{[^}]*outline-style:\s*none/);
    const focus = CSS.search(/\.cc-ov \.btn:focus-visible\s*\{\s*outline:\s*2px solid/);
    expect(cancel).toBeGreaterThan(-1);
    expect(focus).toBeGreaterThan(cancel);
  });
});
