/**
 * V2-1..4 (DESIGN INTENT v2): four tiles with Brandon's names, one row per stage, By Employee, every number opens a
 * Tandem-style list with exactly the v2 columns; no internal codes, no decimals or fractions; generated names off-line.
 * PG-2: non-managers are blocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const accessState = { type: "manager" as string };
vi.mock("@/components/AccessProvider", () => ({ useAccessContext: () => ({ access: { type: accessState.type }, config: { managers: [], processors: {}, callAnswerers: [] } }) }));
vi.mock("@/hooks/useOnboardingOversight", async () => {
  const { demoSnapshot } = await import("@/lib/onboardingOversight/__fixtures__/demoSnapshot");
  const snap = demoSnapshot();
  return { useOnboardingOversight: () => ({ snapshot: snap, status: "ready", progress: "", error: null, itemsOnly: false, refresh: vi.fn(), reset: vi.fn(), fixture: true }) };
});
import OnboardingOversightPage from "@/pages/OnboardingOversightPage";

describe("Onboarding Oversight page (v2)", () => {
  beforeEach(() => { accessState.type = "manager"; });
  const page = (q = "") => render(<MemoryRouter initialEntries={[`/onboarding-oversight${q}`]}><OnboardingOversightPage /></MemoryRouter>);
  const heads = (t: Element) => [...t.querySelectorAll("thead th")].map((x) => x.textContent ?? "");
  const stageNames = () => [...document.querySelectorAll(".mt-stage .mt-name")].map((x) => x.textContent);
  const num = (td: Element | undefined) => Number(td?.querySelector(".pn, .pn-text")?.textContent ?? 0) || 0;
  it("V2-1 overview: four tiles with health borders and a share of pipeline; By Stage = Stage | In Stage | Past Due (Esc.) | 100% bar; no zeros, icons, codes, comparisons (CR-16, minimalism)", () => {
    page();
    const tiles = [...document.querySelectorAll(".v2-tile-label")].map((x) => x.textContent);
    expect(tiles).toEqual(["In Pipeline", "On Track", "Processor Past Due", "Escalations Past Due", "Onboarding Complete"]); // Overview v3
    const subs = [...document.querySelectorAll(".v2-tile-sub")].map((x) => x.textContent ?? "");
    expect(subs).toEqual([expect.stringMatching(/^\d+% of pipeline$/), expect.stringMatching(/^\d+% of pipeline$/), expect.stringMatching(/^\d+% of pipeline$/), "last 28 days"]);
    const n = (i: number) => Number(document.querySelectorAll(".v2-tile-n")[i].textContent);
    expect(n(1) + n(2) + n(3)).toBe(n(0)); // On Track + Processor Past Due + Escalations Past Due = In Pipeline
    const heads2 = [...document.querySelectorAll(".fs-h")].map((x) => x.textContent ?? "");
    expect(heads2.map((h) => h.split(":")[0])).toEqual(["Escalations Past Due", "Processor Past Due"]); // "Where it's breaking" removed (Brandon)
    for (const h of heads2) expect(h).toMatch(/^[A-Za-z ]+: \d+ \(\d+%\)$/);
    const pctOf = (h: string) => Number(/\((\d+)%\)/.exec(h)?.[1] ?? 0); if (heads2.every((h) => !/: 0 /.test(h))) expect(pctOf(heads2[0]) + pctOf(heads2[1])).toBe(100);
    expect(document.querySelectorAll(".fs-muted").length).toBe(0); // priority never greys overview rows
    fireEvent.click(screen.getByRole("tab", { name: "By Stage detail" }));
    expect(document.querySelector(".v2-tile")!.className).toMatch(/h-none/); // In Pipeline is a total, not health
    expect([...document.querySelectorAll(".v2-tile")].slice(2, 4).every((t) => /\bh-(green|yellow|orange|red)\b/.test(t.className))).toBe(true);
    expect(stageNames()).toEqual(["Intake", "Medical Necessity", "Insurance", "Welcome Call"]);
    expect(heads(document.querySelector(".mt")!)).toEqual(["Stage", "In Stage", "Processor Past Due", "Escalation Past Due", "Past Due"]);
    expect(document.querySelectorAll(".mt-sub").length).toBe(0); // sub-stages collapsed by default
    for (const tr of document.querySelectorAll(".mt-stage")) expect(tr.className).toMatch(/\bh-(green|yellow|orange|red|none)\b/);
    for (const seg of document.querySelectorAll(".sb-seg")) expect(seg.textContent).toBe(""); // colour only in the bar, no icons or numbers inside
    for (const l of document.querySelectorAll(".sb-label")) expect(l.textContent).toMatch(/^\d+% processor · \d+% escalation$/);
    for (const td of document.querySelectorAll(".mt td.mt-n")) expect(td.textContent).not.toBe("0");
    const text = document.body.textContent ?? "";
    for (const code of [/\b1\.1\.\d/, /MGR:/, /FINAL:/, /needs help/i, /doing well/i, /\bLate\b/, /vs prior/i, /better|worse/i, /[▲▼○◐↩⏸✎]/, /Due Soon/]) expect(text).not.toMatch(code);
  });
  it("V2-2 By Employee: two plain tables with 1-2 word headers; names only", () => {
    page(); fireEvent.click(screen.getByRole("tab", { name: "By Employee" }));
    const ts = [...document.querySelectorAll(".mt")];
    expect(heads(ts[0])).toEqual(["Processor", "Patients", "Not Started", "Past Due", "Worked/day", "New/day", "Past Due share"]);
    expect(heads(ts[1])).toEqual(["Escalation", "Patients", "Past Due", "Untouched", "Worked", "Past Due share"]); // rows are owner x kind, plus a Sent back row
    expect(screen.getAllByText(/^Janelle · /).length).toBeGreaterThan(0); expect(screen.getAllByText(/^Katie · /).length).toBeGreaterThan(0); // owner x kind rows
  });
  it("V2-3 a tile opens its breakdown first (stages bold, sub-stages collapsed, plain numbers, owner names only), and a cell opens the list (CR-16)", () => {
    page();
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".v2-tile")][2]);
    expect(document.querySelector(".bk-title")?.textContent).toMatch(/^Processor Past Due · \d+$/);
    expect(heads(document.querySelector(".bk .mt")!)).toEqual(["Stage", "Past Due", "Not Started", "Attempted", "Returned", "Owner"]);
    const first = document.querySelector(".mt-stage")!; const total = num(first.querySelectorAll("td")[1]);
    const toggle = first.querySelector<HTMLButtonElement>(".mt-toggle"); if (toggle) { fireEvent.click(toggle);
      const subs = [...document.querySelectorAll(".mt-sub")]; if (subs.length) expect(subs.reduce((n, tr) => n + num(tr.querySelectorAll("td")[1]), 0)).toBe(total); }
    for (const td of document.querySelectorAll(".mt td.mt-who")) expect(td.textContent).not.toMatch(/\d/);
    expect(document.querySelector(".tt-tag, .tt-strip, .v2-seg")).toBeNull();
    fireEvent.click(document.querySelector(".mt-stage")!.querySelectorAll("td")[1].querySelector("button")!);
    expect(document.querySelector(".tt-title")?.textContent ?? "").toMatch(/^[A-Za-z ]+ · Processor Past Due · \d+$/);
    expect(screen.getByLabelText("Search name or ID")).toBeTruthy();
    // one stage and all with the processor: those constant columns are hidden (no duplicate labels)
    expect([...document.querySelectorAll(".tt-th")].map((x) => x.textContent?.replace(/[↑↓]/g, "").trim()).filter((h) => h !== "Stage" && h !== "With" && h !== "Sub-stage")).toEqual(["Patient", "Time in stage", "Last action", "Attempts"]); // constant columns hidden
    const table = document.querySelector(".tt-table")!; const t = table.textContent ?? "";
    expect(t).not.toMatch(/\d\.\d+\s*d|\d+\/\d+d/); // no decimals, no x/y fractions
    if (table.querySelector("tbody tr")) expect(within(table as HTMLElement).getAllByText(/^since /).length).toBeGreaterThan(0);
  });
  it("V2-3b lists open sorted Stage (pipeline order) → sub-stage (workflow order) → longest time first; Sub-stage has no sort of its own (CR-16)", () => {
    page("?list=tile:pipeline");
    const ORDER = ["Intake", "Medical Necessity", "Insurance", "Welcome Call"];
    const SUBS = ["Initial Intake to First Call", "Calling the Patient", "Profile Send-off", "Evaluation", "Send Request", "Confirm Receipt", "Chase Clinicals", "Doctor Appointment", "Benefits", "Submit Auth", "Auth Outstanding", "Auth Denied", "DVS", "Welcome Call", "Final Profile Cleanup"];
    const rows = [...document.querySelectorAll(".tt-row")].map((tr) => [ORDER.indexOf(tr.querySelector(".tt-c-stage")!.textContent!) * 100 + SUBS.indexOf(tr.querySelector(".tt-c-sub")!.textContent!), parseInt(tr.querySelector(".tt-c-time .tt-strong")!.textContent!) || 0]);
    expect(rows.length).toBeGreaterThan(1);
    for (let i = 1; i < rows.length; i++) { expect(rows[i][0]).toBeGreaterThanOrEqual(rows[i - 1][0]); if (rows[i][0] === rows[i - 1][0]) expect(rows[i][1]).toBeLessThanOrEqual(rows[i - 1][1]); }
    expect(screen.queryByRole("button", { name: /^Sub-stage/ })).toBeNull();
  });
  it("V2-4 off-line data shows generated names, never undefined", () => {
    page(); fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".v2-tile")][4]);
    for (const n of [...document.querySelectorAll(".tt-name")].slice(0, 10)) expect(n.textContent).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
  it("V2-5 clicking a stage expands its sub-stages in place (indented, lighter), adding up to the stage", () => {
    page("?tab=stage");
    const row = [...document.querySelectorAll(".mt-stage")].find((tr) => tr.querySelector(".mt-name")?.textContent === "Medical Necessity")!;
    const total = num(row.querySelectorAll("td")[1]);
    fireEvent.click(row.querySelector(".mt-toggle")!);
    const subs = [...document.querySelectorAll(".mt-sub")]; expect(subs.length).toBeGreaterThan(0);
    expect(subs.reduce((n, tr) => n + num(tr.querySelectorAll("td")[1]), 0)).toBe(total);
  });
  it("V2-6 a processor's name opens their working list; By step shows the same counts by step, adding up to the person", () => {
    page(); fireEvent.click(screen.getByRole("tab", { name: "By Employee" }));
    const row = document.querySelector(".mt .mt-stage")!; const total = num(row.querySelectorAll("td")[1]);
    fireEvent.click(row.querySelector(".mt-toggle")!);
    expect(document.querySelector(".wl")).toBeTruthy();
    expect(document.querySelector(".wl-burn")?.textContent).toMatch(/calls\/day/);
    fireEvent.click(screen.getByRole("button", { name: "By step" }));
    expect(heads(document.querySelector(".mt")!)[0]).toBe("Step");
    expect([...document.querySelectorAll(".mt tbody tr")].reduce((n, tr) => n + num(tr.querySelectorAll("td")[1]), 0)).toBe(total);
  });
  it("V2-8 an escalation owner's name opens their working list: headline, burn-down, past due untouched first (oldest first), group by sub-stage, plain rows (CR-16)", () => {
    page(); fireEvent.click(screen.getByRole("tab", { name: "By Employee" }));
    const jan = [...document.querySelectorAll<HTMLButtonElement>(".mt .mt-toggle")].find((b) => (b.textContent ?? "").startsWith("Janelle")); expect(jan).toBeTruthy(); if (!jan) return;
    fireEvent.click(jan);
    expect(document.querySelector(".wl .tt-title")?.textContent).toBe("Janelle");
    expect(document.querySelector(".wl-big")?.textContent).toMatch(/In escalation.*Past Due.*Untouched/);
    expect(document.querySelector(".wl-burn")?.textContent).toMatch(/^\d+\/day to clear in 2 weeks · cleared today (\d+|–)$/);
    expect([...document.querySelectorAll(".wl .tt-th")].map((x) => x.textContent).filter((h) => h !== "Stage")).toEqual(["Patient", "Sub-stage", "Days", "Before escalation", "Decision", "Attempts"]);
    const days = [...document.querySelectorAll(".wl .tt-row .tt-c-time")].map((x) => parseInt(x.textContent ?? "") || 0);
    if (days.length > 1 && days[0] > 2 && days[1] > 2) expect(days[0]).toBeGreaterThanOrEqual(days[1]); // past due untouched first, oldest first
    expect(document.querySelector(".wl .tt-tag")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Group by sub-stage" }));
    if (days.length) expect(document.querySelectorAll(".wl-group").length).toBeGreaterThan(0);
  });
  it("V2-9 Due Soon is not on the overview; processors' working lists carry it as a state (manager view)", () => {
    page(); expect(document.body.textContent).not.toMatch(/Due Soon/);
    fireEvent.click(screen.getByRole("tab", { name: "By Employee" }));
    fireEvent.click(document.querySelector(".mt .mt-stage .mt-toggle")!);
    expect(document.querySelector(".wl")).toBeTruthy();
  });
  it("V2-7 edited normal times mark the toggle 'custom' until reset to Brandon's values", () => {
    page();
    expect(screen.getByRole("button", { name: /Normal times/ }).textContent).not.toMatch(/custom/);
    fireEvent.click(screen.getByRole("button", { name: /Normal times/ }));
    fireEvent.change(screen.getByLabelText("Normal days for Send Request"), { target: { value: "4" } });
    expect(screen.getByRole("button", { name: /Normal times/ }).textContent).toMatch(/custom/);
    fireEvent.click(screen.getByRole("button", { name: /Reset to Brandon's values/ }));
    expect(screen.getByRole("button", { name: /Normal times/ }).textContent).not.toMatch(/custom/);
  });
  it("PG-2 blocks non-managers", () => {
    accessState.type = "processor"; page();
    expect(screen.getByText("Managers only.")).toBeTruthy();
  });
});

