/**
 * The Supabase board page (docs/claude/5.55 *The board page*): it draws the
 * copy the way monday draws a board, says so when a read fails, and never
 * writes anything.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MirrorBoard } from "@/lib/supabaseBoard/boardApi";

const fetchMirrorBoard = vi.fn();
vi.mock("@/lib/supabaseBoard/boardApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabaseBoard/boardApi")>()),
  fetchMirrorBoard: (...a: unknown[]) => fetchMirrorBoard(...a),
}));

const { default: SupabaseBoardPage } = await import("./SupabaseBoardPage");

/* Synthetic board — no real patient. */
const BOARD: MirrorBoard = {
  board: { id: "18406352652", name: "Profile Send Off Board", itemsOnMonday: 2823, syncedAt: new Date().toISOString() },
  groups: [
    { id: "g_intake", title: "1. Intake", color: "#579bfc" },
    { id: "g_stuck", title: "Stuck", color: "#e2445c" },
    { id: "g_done", title: "Completed", color: "#00c875" },
  ],
  columns: [
    { id: "color_x", title: "Already In System", type: "status" },
    { id: "date_x", title: "Date of Intake", type: "date" },
    { id: "text_empty", title: "Never Filled", type: "text" },
  ],
  labels: { color_x: { "0": { label: "Yes", hex: "#df2f4a" }, "1": { label: "No", hex: "#00c875" } } },
  items: [
    { id: "101", name: "Alpha Tester", groupId: "g_intake", createdAt: null, updatedAt: null, cells: { color_x: { t: "No", i: 1 }, date_x: { t: "2026-09-28" } } },
    { id: "102", name: "Beta Tester", groupId: "g_done", createdAt: null, updatedAt: null, cells: { color_x: { t: "Yes", i: 0 } } },
  ],
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <SupabaseBoardPage />
    </MemoryRouter>,
  );

describe("SupabaseBoardPage", () => {
  beforeEach(() => fetchMirrorBoard.mockReset());

  it("draws groups, a status cell in its label's colour, and monday's short date", async () => {
    fetchMirrorBoard.mockResolvedValue({ ok: true, data: BOARD });
    renderPage();
    const intake = await screen.findByTestId("sbd-group-g_intake");
    expect(within(intake).getByText("1. Intake")).toBeTruthy();
    expect(within(intake).getByText("1 item")).toBeTruthy();
    const status = within(intake).getByTitle("No");
    expect(status.getAttribute("style")).toMatch(/background: (rgb\(0, 200, 117\)|#00c875)/);
    expect(within(intake).getByText("Sep 28")).toBeTruthy();
    // The name opens the patient in the Command Center.
    expect(within(intake).getByText("Alpha Tester").closest("a")?.getAttribute("href")).toBe("/patient/101?board=18406352652");
  });

  it("an empty group is one collapsed line; a column nobody has filled is hidden until asked for", async () => {
    fetchMirrorBoard.mockResolvedValue({ ok: true, data: BOARD });
    renderPage();
    const stuck = await screen.findByTestId("sbd-group-g_stuck");
    expect(within(stuck).getByText("No items")).toBeTruthy();
    expect(stuck.querySelector("table")).toBeNull();
    expect(screen.queryAllByText("Never Filled")).toHaveLength(0);
    fireEvent.click(screen.getByText("2 columns with data"));
    expect(screen.getAllByText("Never Filled").length).toBeGreaterThan(0);
  });

  it("search narrows the rows like monday's board search", async () => {
    fetchMirrorBoard.mockResolvedValue({ ok: true, data: BOARD });
    renderPage();
    await screen.findByText("Alpha Tester");
    fireEvent.change(screen.getByLabelText("Search the board"), { target: { value: "beta" } });
    expect(screen.queryByText("Alpha Tester")).toBeNull();
    expect(screen.getByText("Beta Tester")).toBeTruthy();
    expect(screen.getByTestId("sbd-count").textContent).toBe("1 of 2 items");
  });

  it("a failed read says so on screen — never an empty board", async () => {
    fetchMirrorBoard.mockResolvedValue({ ok: false, error: "Could not read the Supabase copy" });
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't read the Supabase copy.");
    expect(screen.queryByText("No patients in the copy yet", { exact: false })).toBeNull();
  });

  it("a failed refresh keeps the last copy on screen and says it is the last one", async () => {
    fetchMirrorBoard.mockResolvedValueOnce({ ok: true, data: BOARD }).mockResolvedValueOnce({ ok: false, error: "HTTP 502" });
    renderPage();
    await screen.findByText("Alpha Tester");
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("showing the last one read"));
    expect(screen.getByText("Alpha Tester")).toBeTruthy();
  });
});

describe("wiring", () => {
  const SRC = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(SRC, p), "utf8");
  it("the route exists, System Management has the door, and the page never writes", () => {
    expect(read("App.tsx")).toContain('<Route path="/supabase-board" element={<SupabaseBoardPage />} />');
    expect(read("pages/SystemMgmtPage.tsx")).toContain('navigate("/supabase-board")');
    const page = read("pages/SupabaseBoardPage.tsx") + read("lib/supabaseBoard/boardApi.ts");
    expect(page).not.toMatch(/mutation|executeWritesWithVerification|method:\s*"POST"|gql\(/);
  });
});
