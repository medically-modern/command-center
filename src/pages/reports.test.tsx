/**
 * Reports & Metrics — Brandon's page, rendered (pixel-match Phase 6b, §5.52).
 *
 * The hooks are faked; the page's job is to turn their answers into his tiles
 * and bars, say when a source has not answered, and never invent a zero.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import { STUCK_GROUP_IDS } from "@/lib/shared/profileStatus";

const state = vi.hoisted(() => ({
  patients: [] as unknown[],
  snapLoading: false,
  hydrating: false,
  snapError: null as string | null,
  counts: {} as Record<string, number>,
  esc: {} as Record<string, number>,
  countsLoading: false,
  reads: {
    subscriptions: { data: null as unknown, error: null as string | null, loading: true },
    formLeads: { data: null as unknown, error: null as string | null, loading: true },
    orders: { data: null as unknown, error: null as string | null, loading: true },
  },
  commsUi: false,
  layout: "redesign" as string,
  refetchSnap: vi.fn(),
  refetchCounts: vi.fn(),
  refetchReads: vi.fn(),
}));

vi.mock("@/hooks/systemMgmt/useSystemPatients", () => ({
  useSystemPatients: () => ({
    patients: state.patients, loading: state.snapLoading, hydrating: state.hydrating, error: state.snapError,
    refetch: state.refetchSnap, escalated: [], completionMap: new Map(), removeEscalation: vi.fn(),
  }),
}));
vi.mock("@/hooks/useRoleCounts", () => ({
  useRoleCounts: () => ({
    counts: state.counts, escalatedCounts: state.esc, crossSellCounts: {}, patientIds: {},
    loading: state.countsLoading, refetch: state.refetchCounts,
  }),
}));
vi.mock("@/hooks/reports/useReportsData", () => ({
  useReportsData: () => ({
    ...state.reads,
    loading: state.reads.subscriptions.loading || state.reads.formLeads.loading || state.reads.orders.loading,
    refetch: state.refetchReads,
  }),
}));
vi.mock("@/hooks/commsInbox/useInbox", () => ({
  useCommsConfig: () => ({ enabled: state.commsUi, ui: state.commsUi, loaded: true }),
}));
vi.mock("@/components/commsInbox/SlaCard", () => ({ default: () => <div data-testid="sla">SLA card</div> }));
vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ({
    access: { type: "manager" },
    email: "brandon@medicallymodern.com",
    config: { managers: [], processors: { "brandon@medicallymodern.com": { name: "Brandon Sample", roles: [] } } },
  }),
}));
vi.mock("@/lib/shared/auth", () => ({ getUser: () => null }));
vi.mock("@/hooks/shell/useShellLayout", () => ({ useShellLayout: () => [state.layout, vi.fn()] }));

import OperationsPage, { TRACKER_URL } from "./OperationsPage";

const PROFILE = 18406352652;
const ME = 18406060017;
const INS = 18410601299;
const WC = 18410804557;

function pt(over: Partial<SystemPatient> & { id: string; boardId: number }): SystemPatient {
  return {
    name: "P", phone: "", dob: "", boardName: "", groupId: "g_live", groupTitle: "", roleRoute: "",
    pipelineStage: "", escalated: false, escalationText: "", escalationLevel: null, escalationNotes: "",
    hasPage: true, isCompleted: false, daysSinceStage: "", stageStart: "", createdAt: "", notes: "",
    stageAdvancerText: "", nextActionDate: "", ...over,
  };
}

function loaded() {
  state.patients = [
    pt({ id: "p1", boardId: PROFILE }),
    pt({ id: "p2", boardId: PROFILE, groupId: "group_mm5z87zt" }),         // a web-form lead
    pt({ id: "p3", boardId: PROFILE, groupId: "group_mm5z87zt" }),         // an imported row (no step)
    pt({ id: "m1", boardId: ME, stageStart: "2020-01-01" }),
    pt({ id: "m2", boardId: ME, groupId: STUCK_GROUP_IDS[0] }),
    pt({ id: "i1", boardId: INS, escalated: true, escalationLevel: "manager" }),
    pt({ id: "w1", boardId: WC, isCompleted: true }),
    pt({ id: "s1", boardId: 18407459988 }),
  ];
  state.snapLoading = false;
  state.hydrating = false;
  state.snapError = null;
  state.counts = { evaluate: 9, benefits: 4, fax: 2, authDenied: 1 };
  state.esc = { evaluate: 2 };
  state.countsLoading = false;
  state.reads = {
    subscriptions: {
      data: [
        { status: "Active", daysToOrder: "Very Late", mr: "MR Expired" },
        { status: "Active", daysToOrder: "30 Days", mr: "MR Valid" },
        { status: "Paused", daysToOrder: "", mr: "" },
      ], error: null, loading: false,
    },
    formLeads: {
      data: [
        { id: "p2", groupId: "group_mm5z87zt", dropOffStep: "Step 5 - Insurance" },
        { id: "p3", groupId: "group_mm5z87zt", dropOffStep: "" },
      ], error: null, loading: false,
    },
    orders: {
      data: [
        { groupId: "group_mm18v6n3", orderStatus: "Order", apiStatus: "", holdReason: "", apiMessage: "", backordered: "", inactiveProducts: "", substitutionStatus: "", preCheck: "" },
        { groupId: "group_mm52gfr5", orderStatus: "Process Claim", apiStatus: "Warning", holdReason: "Credit Check Failure", apiMessage: "", backordered: "", inactiveProducts: "", substitutionStatus: "", preCheck: "" },
        { groupId: "group_mm20m7gz", orderStatus: "Process Claim", apiStatus: "Delivered", holdReason: "", apiMessage: "", backordered: "", inactiveProducts: "", substitutionStatus: "", preCheck: "" },
      ], error: null, loading: false,
    },
  };
  state.commsUi = false;
  state.layout = "redesign";
}

beforeEach(() => {
  loaded();
  state.refetchSnap.mockReset();
  state.refetchCounts.mockReset();
  state.refetchReads.mockReset();
});

const mount = () => render(<MemoryRouter><OperationsPage /></MemoryRouter>);
const tile = (label: string) => screen.getByText(label, { selector: ".tile-s .eyebrow" }).closest(".tile-s") as HTMLElement;
const num = (label: string) => tile(label).querySelector(".n")!;
const sub = (label: string) => tile(label).querySelector(".xs")!.textContent;

describe("Reports & Metrics", () => {
  it("is Brandon's page: the title row, the tracker card, three tile rows and Queues today", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Reports & Metrics" })).toBeTruthy();
    expect(screen.getByText("Brandon Sample · the pipeline in numbers")).toBeTruthy();
    expect(screen.getByText("Patient Pipeline Tracker")).toBeTruthy();
    for (const e of ["Onboarding pipeline", "Subscriptions & orders", "Queues today"]) expect(screen.getByText(e)).toBeTruthy();
    expect(document.querySelectorAll(".tiles")).toHaveLength(3);
  });

  it("⚠️ the tracker is a LINK to Katie's app in a new tab — never a frame", () => {
    mount();
    const a = screen.getByRole("link", { name: /Open the tracker/ }) as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe(TRACKER_URL);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText(/frame policy names only monday\.com/)).toBeTruthy();
  });

  it("the pipeline tiles count active rows per stage, leave the lead out of Intake, and name the import", () => {
    mount();
    expect(num("Intake").textContent).toBe("2");          // p1 + the imported row; the lead is out
    expect(sub("Intake")).toContain("1 are imported referral rows");
    expect(num("Medical Evaluation").textContent).toBe("1"); // the stuck row is not active
    expect(sub("Medical Evaluation")).toMatch(/^avg \d+ days in stage$/);
    expect(num("Insurance").textContent).toBe("1");
    expect(num("Welcome Call").textContent).toBe("0");      // the completed row is not active
  });

  it("Stuck and Escalated read the snapshot's own rules and go red when non-zero", () => {
    mount();
    expect(num("Stuck").textContent).toBe("1");
    expect(num("Stuck").className).toContain("red");
    expect(num("Escalated").textContent).toBe("1");
    expect(num("Escalated").className).toContain("red");
  });

  it("Web-form leads shows the lead count and the top drop-off steps; Total adds leads to the stages", () => {
    mount();
    expect(num("Web-form leads").textContent).toBe("1");
    expect(sub("Web-form leads")).toBe("1 at Step 5 - Insurance");
    expect(num("Total in pipeline").textContent).toBe("5"); // 2 + 1 + 1 + 0 stages, + 1 lead
    expect(sub("Total in pipeline")).toBe("8 patients known");
  });

  it("the subscription and order tiles", () => {
    mount();
    expect(num("Active subscriptions").textContent).toBe("2");
    expect(sub("Active subscriptions")).toBe("1 paused");
    expect(num("Late for an order").textContent).toBe("1");
    expect(num("Late for an order").className).toContain("red");
    expect(num("MR expired").textContent).toBe("1");
    expect(num("Open orders").textContent).toBe("2");       // the delivered one is closed
    expect(sub("Open orders")).toBe("1 on hold · 0 backordered");
  });

  it("⚠️ Queues today ARE the role counts, grouped by stage, with the burndowns' door rule", () => {
    mount();
    const grid = document.querySelector(".stage-grid") as HTMLElement;
    const titles = [...grid.querySelectorAll("section > .eyebrow")].map((e) => e.textContent);
    expect(titles).toEqual(["Intake", "Medical Evaluation", "Insurance", "Welcome Call", "Other"]);
    const ev = within(grid).getByTitle("Open Evaluate") as HTMLAnchorElement;
    expect(ev.getAttribute("href")).toBe("/evaluate");
    expect(ev.querySelector(".tn")!.textContent).toBe("9");
    expect(ev.querySelector(".esc")!.textContent).toBe("2 esc");
    expect((ev.querySelector(".fill") as HTMLElement).style.width).toBe("100%");
    expect(ev.querySelector(".fill")!.className).toContain("bg-violet-500");
    expect((within(grid).getByTitle("Open FAX") as HTMLAnchorElement).getAttribute("href")).toBe("/fax-inbox");
    const denied = within(grid).getByTitle("Auth Denied");
    expect(denied.tagName).toBe("SPAN");
    expect(denied.className).toContain("inert");
    // A role with no count yet reads "—", never 0.
    expect(within(grid).getByTitle("Open Send Request").querySelector(".tn")!.textContent).toBe("—");
    expect(within(grid).queryByTitle(/Communications/)).toBeNull();
  });

  it("⚠️ nothing is a zero until its source has answered", () => {
    state.patients = [];
    state.snapLoading = true;
    state.reads.subscriptions = { data: null, error: null, loading: true };
    state.reads.orders = { data: null, error: null, loading: true };
    state.reads.formLeads = { data: null, error: null, loading: true };
    mount();
    for (const l of ["Intake", "Stuck", "Web-form leads", "Total in pipeline", "Active subscriptions", "Open orders"]) {
      expect(num(l).textContent, l).toBe("—");
      expect(num(l).className, l).toContain("dim");
    }
    expect(screen.getByText("Reading the pipeline boards…")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reading…/ })).toBeTruthy();
  });

  it("a cached snapshot says so, and a failed read is a notice beside its tiles — never a zero", () => {
    state.hydrating = true;
    state.reads.orders = { data: null, error: "HTTP 503", loading: false };
    mount();
    expect(screen.getByText(/Showing the cached snapshot/)).toBeTruthy();
    expect(screen.getByText(/Couldn't read the order board\. HTTP 503/)).toBeTruthy();
    expect(num("Open orders").textContent).toBe("—");
    expect(sub("Open orders")).toBe("not read");
  });

  it("Refresh re-reads every source", () => {
    mount();
    screen.getByRole("button", { name: /Refresh/ }).click();
    expect(state.refetchSnap).toHaveBeenCalledWith(true);
    expect(state.refetchCounts).toHaveBeenCalledWith(true);
    expect(state.refetchReads).toHaveBeenCalledTimes(1);
  });

  it("the Communications SLA card renders only while the Inbox is on", () => {
    const { unmount } = mount();
    expect(screen.queryByTestId("sla")).toBeNull();
    unmount();
    state.commsUi = true;
    mount();
    expect(screen.getByTestId("sla")).toBeTruthy();
    expect(screen.getByText("Communications")).toBeTruthy();
  });

  it("the Back row is for the old layout only — inside the shell the header is the way", () => {
    const { unmount } = mount();
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
    unmount();
    state.layout = "current";
    mount();
    expect(screen.getByRole("button", { name: /Back/ })).toBeTruthy();
  });
});

describe("scans", () => {
  const src = (p: string) => readFileSync(join(__dirname, p), "utf8");
  it("the stylesheet is scoped under .cc-rp, reads tokens only, and cancels Tailwind's `outline`", () => {
    const css = src("reports/reports.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = css.match(/^[^@\s{}][^{}]*(?=\{)/gm) ?? [];
    for (const sel of selectors) {
      for (const part of sel.split(",")) {
        expect(part.trim().startsWith(".cc-rp") || part.trim().startsWith(".dark .cc-rp") || part.trim().startsWith(":root[data-theme=\"dark\"] .cc-rp"), part).toBe(true);
      }
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(css).toMatch(/\.cc-rp \.btn\.outline \{[^}]*outline-style: none/);
  });
  it("the page borrows nothing from Operations and frames nothing", () => {
    // Comments stripped first: the header comment names the thing it must not import.
    const page = src("OperationsPage.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(page).not.toContain("OperationsTab");
    expect(page).not.toMatch(/<iframe/i);
  });
});
