/**
 * The Fax Inbox — Brandon's 50/50 screen (pixel-match Phase 5, 2026-09-24),
 * rendered against fakes: the list, the pick, the office, the likely matches
 * and the classic list's function folded in (Mark read / unread, View,
 * Download, Load more). Nothing here reaches RingCentral or Monday.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InboundFax } from "@/lib/fax/ringcentralApi";

const fetchInboundFaxes = vi.fn();
const setFaxRead = vi.fn();
const fetchFaxBlobUrl = vi.fn();
vi.mock("@/lib/fax/ringcentralApi", () => ({
  fetchInboundFaxes: (...a: unknown[]) => fetchInboundFaxes(...a),
  setFaxRead: (...a: unknown[]) => setFaxRead(...a),
  fetchFaxBlobUrl: (...a: unknown[]) => fetchFaxBlobUrl(...a),
}));

const fetchFaxMatches = vi.fn();
const fetchDoctorDbByFax = vi.fn();
vi.mock("@/lib/commsHub/dossierApi", () => ({
  fetchFaxMatches: (...a: unknown[]) => fetchFaxMatches(...a),
  fetchDoctorDbByFax: (...a: unknown[]) => fetchDoctorDbByFax(...a),
}));

const openFileViewer = vi.fn();
vi.mock("@/components/shared/FileViewerModal", () => ({
  openFileViewer: (...a: unknown[]) => openFileViewer(...a),
}));

// The pane's own machinery is tested in its own suites; here the patient list
// behind it is a fixture, and the two cards that fetch on mount are stubs.
const useClinicalsPatients = vi.fn();
vi.mock("@/components/updateClinicals/ClinicalsWork", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/updateClinicals/ClinicalsWork")>();
  return { ...actual, useClinicalsPatients: () => useClinicalsPatients() };
});
vi.mock("@/components/subscription/MnDocsPanel", () => ({
  MnDocsPanel: ({ itemId }: { itemId: string }) => <div data-testid="mn-docs">docs for {itemId}</div>,
}));
vi.mock("@/components/shell/AbilityLock", () => ({
  useAbility: () => true,
  AbilityLockNote: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import FaxBarPage from "./FaxBarPage";
import { faxFileName, faxPatientChip } from "@/lib/fax/faxInbox";

const fax = (over: Partial<InboundFax> = {}): InboundFax => ({
  id: 1,
  fromNumber: "+15555550101",
  fromName: "NORTHGATE DIABETES",
  fromLocation: "Albany, NY",
  creationTime: "2026-09-24T13:41:00.000Z",
  pages: 3,
  read: false,
  attachmentUri: "https://media.ringcentral.com/restapi/v1.0/account/1/extension/2/message-store/1/content/1",
  contentType: "application/pdf",
  ...over,
});

const FAXES = [
  fax(),
  fax({ id: 2, fromNumber: "+15555550102", fromName: "", fromLocation: "", pages: 1, read: true }),
  fax({ id: 3, fromNumber: "+15555550103", fromName: "RIVERSIDE ENDO", read: false, pages: 12 }),
];

const matchRow = (over: Record<string, unknown> = {}) => ({
  itemId: "9001",
  name: "Jane Sample",
  boardId: 18406060017,
  boardName: "Medical Evaluation",
  groupTitle: "2. Medical Necessity",
  isCompleted: false,
  isStuck: false,
  route: "/chase-fax",
  stage: "Chase Clinicals",
  clinicalsMethod: "Fax",
  nextActionDate: "2026-09-25",
  doctorName: "Dr Pat Example",
  clinicName: "Northgate Diabetes Center",
  npi: "1234567890",
  doctorPhone: "5555550100",
  doctorFax: "5555550101@rcfax.com",
  ...over,
});

const clinicalsFixture = {
  patients: [
    { id: "9001", name: "Jane Sample", board: "mn", boardLabel: "Med Necessity", stage: "Chase Clinicals" },
    { id: "8001", name: "Sub Sample", board: "subscription", boardLabel: "Subscription", stage: "Active", dob: "01/02/1960" },
  ],
  loading: false,
  initialLoading: false,
  error: null,
  refetch: vi.fn(),
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/fax-inbox"]}>
      <Routes>
        <Route path="/fax-inbox" element={<FaxBarPage />} />
        <Route path="/patient/:id" element={<div data-testid="patient-screen" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchInboundFaxes.mockReset();
  setFaxRead.mockReset();
  fetchFaxBlobUrl.mockReset();
  fetchFaxMatches.mockReset();
  fetchDoctorDbByFax.mockReset();
  openFileViewer.mockReset();
  useClinicalsPatients.mockReset();
  useClinicalsPatients.mockReturnValue(clinicalsFixture);
  fetchInboundFaxes.mockResolvedValue({ faxes: FAXES, hasMore: true, total: 5 });
  setFaxRead.mockResolvedValue(undefined);
  fetchFaxBlobUrl.mockResolvedValue("blob:fake");
  fetchFaxMatches.mockResolvedValue([matchRow(), matchRow({ itemId: "7001", name: "Ins Sample", boardId: 18410601299, boardName: "Insurance", stage: "Benefits", groupTitle: "Benefits" })]);
  fetchDoctorDbByFax.mockResolvedValue([]);
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("the list", () => {
  it("is one paged read of 50, the total in the title, unread counted, nothing picked on open", async () => {
    renderPage();
    expect(await screen.findByText("NORTHGATE DIABETES")).toBeTruthy();
    expect(fetchInboundFaxes).toHaveBeenCalledWith({ page: 1, perPage: 50 });
    expect(screen.getByText("(5)")).toBeTruthy();
    expect(screen.getByText("2 unread of 3 loaded · newest first")).toBeTruthy();
    // ⚠️ No auto-select: the two board reads behind the pane land only once a
    // rep picks a fax, and his mockup opens on the notice.
    expect(useClinicalsPatients).not.toHaveBeenCalled();
    expect(screen.getByText(/Update Clinicals lives here now/)).toBeTruthy();
    expect(screen.queryByText("Selected fax")).toBeNull();
  });

  it("a row is his: the preview sheet, the name, a Read/Unread pill, number · location · pages · time", async () => {
    renderPage();
    await screen.findByText("NORTHGATE DIABETES");
    const rows = document.querySelectorAll(".fx-row");
    expect(rows.length).toBe(3);
    const first = rows[0] as HTMLElement;
    expect(first.querySelector(".fx-pv")).toBeTruthy();
    expect(within(first).getByText("Unread").className).toContain("pill blue");
    expect(within(first).getByText("(555) 555-0101")).toBeTruthy();
    expect(within(first).getByText("Albany, NY")).toBeTruthy();
    expect(within(first).getByText("3 pages")).toBeTruthy();
    // A fax with no caller-ID name is named by its number, once.
    const second = rows[1] as HTMLElement;
    expect(within(second).getByText("Read").className).toContain("pill grey");
    expect(within(second).getAllByText("(555) 555-0102").length).toBe(2);
    expect(within(second).getByText("1 page")).toBeTruthy();
  });

  it("the Unread pill filters, and 'Load more' asks for page 2", async () => {
    renderPage();
    await screen.findByText("NORTHGATE DIABETES");
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(document.querySelectorAll(".fx-row").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(document.querySelectorAll(".fx-row").length).toBe(3);

    fetchInboundFaxes.mockResolvedValueOnce({ faxes: [fax({ id: 4, fromName: "PAGE TWO", read: true })], hasMore: false, total: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("PAGE TWO")).toBeTruthy();
    expect(fetchInboundFaxes).toHaveBeenLastCalledWith({ page: 2, perPage: 50 });
    expect(screen.getByText("End of inbox · 4 shown")).toBeTruthy();
    expect(screen.getByText("2 unread · newest first")).toBeTruthy();
  });

  it("View fetches the BYTES first and hands the viewer a blob; Download does the same", async () => {
    renderPage();
    await screen.findByText("NORTHGATE DIABETES");
    const first = document.querySelectorAll(".fx-row")[0] as HTMLElement;
    fireEvent.click(within(first).getByRole("button", { name: "Open the PDF" }));
    await waitFor(() => expect(openFileViewer).toHaveBeenCalledTimes(1));
    expect(fetchFaxBlobUrl).toHaveBeenCalledWith(FAXES[0].attachmentUri);
    expect(openFileViewer.mock.calls[0][0]).toMatchObject({ url: "blob:fake", name: "Fax — NORTHGATE DIABETES 2026-09-24.pdf" });
    // ⚠️ Pressing a row's button did not pick the fax.
    expect(screen.queryByText("Selected fax")).toBeNull();

    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(within(first).getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(fetchFaxBlobUrl).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it("a failed read says so — never an empty inbox", async () => {
    fetchInboundFaxes.mockRejectedValueOnce(new Error("RingCentral fax inbox failed (503)"));
    renderPage();
    expect(await screen.findByText("RingCentral fax inbox failed (503)")).toBeTruthy();
    expect(screen.queryByText("No faxes in the inbox.")).toBeNull();
  });
});

describe("picking a fax", () => {
  it("shows his card with the office resolved from BOTH lookups, and mounts the pane", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("NORTHGATE DIABETES"));
    expect(screen.getByText("Selected fax")).toBeTruthy();
    expect(await screen.findByText("Dr Pat Example")).toBeTruthy();
    expect(fetchFaxMatches).toHaveBeenCalledWith("+15555550101");
    expect(fetchDoctorDbByFax).toHaveBeenCalledWith("+15555550101");
    expect(screen.getByText(/found on a patient's record/)).toBeTruthy();
    expect(useClinicalsPatients).toHaveBeenCalled();
    // The find card carries the fax it is about, inline, as his does.
    expect(screen.getByText(/this fax came from/).textContent).toContain("(555) 555-0101");
  });

  it("likely matches are inside the find card: a pick where the pane can work them, the reason where not, a Profile link on each", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("NORTHGATE DIABETES"));
    expect(await screen.findByText(/Likely matches — patients whose doctor faxes from this number/)).toBeTruthy();
    const rows = document.querySelectorAll(".uc-results .uc-row");
    expect(rows.length).toBe(2);
    const jane = rows[0] as HTMLElement;
    expect(jane.className).toContain("pick");
    expect(jane.className).toContain("chase");
    expect(within(jane).getByText("Med Necessity · Chase Clinicals").className).toContain("chip mn");
    const ins = rows[1] as HTMLElement;
    expect(ins.className).not.toContain("pick");
    expect(within(ins).getByText("nothing to update")).toBeTruthy();
    expect(within(ins).getByText("Insurance · Benefits").className).toBe("chip");
    expect(within(jane).getByRole("link", { name: /Profile/ }).getAttribute("href")).toBe(
      "/patient/9001?board=18406060017&from=fax",
    );
    // Picking Jane opens her in the pane below, with the fax named above it.
    fireEvent.click(within(jane).getByText("Jane Sample"));
    expect(await screen.findByText("Search another patient")).toBeTruthy();
    expect(screen.getByTestId("mn-docs").textContent).toContain("9001");
    expect(screen.getByText(/attach it under the clinicals below/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Submit — back to Evaluate/ })).toBeTruthy();
  });

  it("typing a name replaces the likely matches with the search results", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("NORTHGATE DIABETES"));
    await screen.findByText(/Likely matches/);
    fireEvent.change(screen.getByPlaceholderText("Search patients by name…"), { target: { value: "sub" } });
    expect(screen.queryByText(/Likely matches/)).toBeNull();
    expect(screen.getByText("Sub Sample")).toBeTruthy();
  });

  it("Mark read / unread on the card writes RingCentral's read state, both directions", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("NORTHGATE DIABETES"));
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(setFaxRead).toHaveBeenCalledWith(1, true));
    expect(await screen.findByRole("button", { name: "Mark unread" })).toBeTruthy();
    expect(screen.getByText("1 unread of 3 loaded · newest first")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark unread" }));
    await waitFor(() => expect(setFaxRead).toHaveBeenCalledWith(1, false));
  });

  it("⚠️ a patient picked for one fax is NOT still picked under the next", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("NORTHGATE DIABETES"));
    const jane = (await screen.findAllByText("Jane Sample"))[0];
    fireEvent.click(jane);
    await screen.findByText("Search another patient");
    fireEvent.click(screen.getByText("RIVERSIDE ENDO"));
    await waitFor(() => expect(screen.queryByText("Search another patient")).toBeNull());
    expect(screen.getByText("Find a patient")).toBeTruthy();
  });

  it("an unknown number says what that MEANS rather than 'no match'", async () => {
    fetchFaxMatches.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByText("RIVERSIDE ENDO"));
    expect(await screen.findByText(/Offices often send from a different line/)).toBeTruthy();
    expect(screen.getByText("Nobody of ours is with this office right now.")).toBeTruthy();
  });
});

describe("the pure bits", () => {
  it("faxFileName is the classic page's name", () => {
    expect(faxFileName(fax())).toBe("Fax — NORTHGATE DIABETES 2026-09-24.pdf");
    expect(faxFileName(fax({ fromName: "", creationTime: "" }))).toBe("Fax — (555) 555-0101.pdf");
  });

  it("faxPatientChip is his ucBoardChip: two tones, and the board's own name otherwise", () => {
    expect(faxPatientChip({ boardId: 18407459988, boardName: "Subscription", stage: "", groupTitle: "Active" })).toEqual({ cls: "sub", text: "Subscription · Active" });
    expect(faxPatientChip({ boardId: 18406060017, boardName: "Medical Evaluation", stage: "Send Request", groupTitle: "" })).toEqual({ cls: "mn", text: "Med Necessity · Send Request" });
    expect(faxPatientChip({ boardId: 18410804557, boardName: "Welcome Call", stage: "", groupTitle: "Welcome Call" })).toEqual({ cls: "", text: "Welcome Call · Welcome Call" });
  });
});

describe("⚠️ the properties that are silent when they break", () => {
  const SRC = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(SRC, p), "utf8");
  const live = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join("\n");
  const page = live(read("pages/FaxBarPage.tsx"));

  it("the preview box is an ICON — no fetch per row", () => {
    // A rendered thumbnail is a RingCentral read of every fax's PDF per row
    // per load (INCIDENT_2026-08-20's shape). The bytes are fetched on View and
    // Download only, and never inside the row map.
    const rowMap = page.slice(page.indexOf("shown.map((f)"), page.indexOf("</div>\n          <div className=\"fx-foot\">"));
    expect(rowMap).toContain('className="fx-pv"');
    expect(rowMap).not.toContain("fetchFaxBlobUrl(");
    expect(rowMap).not.toContain("<img");
    expect(page.split("fetchFaxBlobUrl(").length - 1).toBe(2);
  });

  it("the stylesheet is scoped, tokens only, and cancels Tailwind's `outline` utility", () => {
    const css = read("pages/fax/faxInbox.css").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const line of css.split("\n")) {
      const m = line.match(/^([^@{\s][^{]*)\{/);
      if (!m) continue;
      for (const sel of m[1].split(",")) {
        const s = sel.trim();
        expect(s === ".cc-fx" || s.startsWith(".cc-fx ") || s.startsWith(".dark .cc-fx") || s.startsWith(":root[data-theme=\"dark\"] .cc-fx"), `unscoped selector: ${s}`).toBe(true);
      }
    }
    expect(css).toMatch(/\.btn\.outline\s*\{[^}]*outline-style:\s*none/);
    expect(css).toMatch(/\.btn\.outline:focus-visible/);
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b(?![^{]*white)/i);
  });

  it("the join is the tested one, and the two board reads are inside FaxPane", () => {
    expect(page).toContain("buildFaxDirectory(");
    expect(page).toContain("fetchFaxMatches(");
    expect(page).toContain("fetchDoctorDbByFax(");
    const i = page.indexOf("function FaxPane(");
    expect(i).toBeGreaterThan(0);
    expect(page.indexOf("useClinicalsPatients()")).toBeGreaterThan(i);
    // And nothing picks a fax on load: the pane is mounted by the rep's click.
    expect(page).not.toMatch(/setSelectedId\(\(cur\) => cur \?\?/);
  });
});
