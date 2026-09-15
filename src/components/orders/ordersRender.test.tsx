// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { OrderHeaderCard } from "./OrderHeaderCard";
import { OrderTimeline } from "./OrderTimeline";
import { OrderLinesCard } from "./OrderLinesCard";
import { ShippingCard } from "./ShippingCard";
import { SubstitutionCard } from "./SubstitutionCard";
import { CardinalCard } from "./CardinalCard";
import { NotesCard, PatientCoverageCard } from "./PatientCoverageCard";
import { OrdersOverview } from "./OrdersOverview";
import { SkuTrackerView } from "./SkuTrackerView";
import { OrdersSidebar } from "./OrdersSidebar";
import { mkOrder, placed, delivered, HOLD_SENTENCE } from "@/lib/orders/fixtures";
import { SKU_GROUPS, type SkuTrackerRow } from "@/lib/orders/skuTrackerApi";

/**
 * Every component on the Orders page, mounted once with fixture data. Pure
 * rules are tested in lib/orders; this catches what only a render catches — a
 * wrong import, a prop shape, a null the JSX did not expect. The contact trio
 * and the sidebar marks reach for RingCentral-backed hooks, which are stubbed
 * so nothing here touches a network.
 */
vi.mock("@/components/masheke/mmKit", () => ({
  PatientContact: ({ phone }: { phone?: string }) => <span data-testid="contact">{phone}</span>,
}));
vi.mock("@/components/shared/ContactStateMarks", () => ({ ContactStateMarks: () => null }));
// The substitution pick reads the board's live label set; nothing here touches
// a network, and `ready: false` would (correctly) disable the control.
vi.mock("@/hooks/useStatusOptions", () => ({
  useStatusOptions: () => ({
    options: {
      color_mm727jnp: [
        { index: 0, label: 'TruSteel 6 mm 23"' },
        { index: 1, label: 'AutoSoft 90 6 mm 23"' },
        { index: 7, label: 'AutoSoft XC 6 mm 23"' },
      ],
    },
    loading: false, error: null, ready: true, reload: () => {},
  }),
}));

const rows: SkuTrackerRow[] = [
  { id: "r1", name: 'TruSteel 6 mm 23"', groupId: SKU_GROUPS.infusionSets, sku: "TN1002833I", description: "TruSteel", uom: "BX", unitCost: 63.77, qtyAvail: 426, status: "Available", lastChanged: "2026-09-15 09:05 ET", oopPrice: null, notes: "", runHistory: "" },
  { id: "r2", name: 'AutoSoft 90 6 mm 23"', groupId: SKU_GROUPS.infusionSets, sku: "TN1002817I", description: "", uom: "BX", unitCost: 71.94, qtyAvail: 220, status: "Backordered", lastChanged: "2026-09-15 09:05 ET", oopPrice: 12, notes: "", runHistory: "" },
  { id: "r3", name: "Dexcom G7 / G7 15-Day → G7 Receiver", groupId: SKU_GROUPS.cgmReceivers, sku: "EDSTKAT013MEDIM", description: "", uom: "EA", unitCost: 234.28, qtyAvail: 1156, status: "Available", lastChanged: "2026-09-15 09:05 ET", oopPrice: null, notes: "", runHistory: "" },
  { id: "log", name: "Last run: 2026-09-15 09:05 ET (cron) — 31 changed", groupId: SKU_GROUPS.runLog, sku: "", description: "", uom: "", unitCost: null, qtyAvail: null, status: "", lastChanged: "", oopPrice: null, notes: "", runHistory: "[2026-09-15 09:05 ET] cron — 45 SKUs" },
];

const held = placed({
  id: "h", name: "Held Person", apiStatus: "Warning", holdReason: "Credit Check Failure", apiMessage: HOLD_SENTENCE,
  infusionSet1: 'AutoSoft 90 6 mm 23"', qtyInfusionSet1: "3", cgmType: "Dexcom G7", qtyMonitor: "1", qtySensors: "9",
  backordered: 'AutoSoft 90 6mm 23" infusion sets', preCheck: "Good to Go", notes: "9/10: a note", dob: "01/01/1980",
  files: { file_mm4cfc8m: [{ assetId: "1", name: "pod.pdf", url: "https://files.example/x" }] },
});
const done = delivered({ id: "d", name: "Done Person", phone: "5555550102", infusionSet1: 'TruSteel 6 mm 23"', qtyInfusionSet1: "3", invoiceNumber: "INV1", invoiceAmount: "215.31" });
// Distinct numbers: the header joins "other orders" on the phone, and the
// fixture default is one number for everybody.
const all = [mkOrder({ id: "t", name: "Waiting Person", phone: "5555550101" }), held, done, mkOrder({ id: "same", name: "Held Person", orderDate: "2026-08-01" })];

// jsdom has no matchMedia; the shared sidebar's mobile hook asks for it on mount.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

const wrap = (ui: React.ReactNode) => render(<MemoryRouter><SidebarProvider>{ui}</SidebarProvider></MemoryRouter>);

describe("the Orders page renders every card", () => {
  it("header: name, pills, flags, other orders for the patient, and the switch-off note", () => {
    wrap(<OrderHeaderCard order={held} allOrders={all} onSelect={() => {}} />);
    expect(screen.getByText("Held Person")).toBeInTheDocument();
    expect(screen.getAllByText("On hold — Credit Check Failure").length).toBeGreaterThan(0);
    expect(screen.getByText(/This patient's other orders \(1\)/)).toBeInTheDocument();
    // Not a to-place order, so no ordering note either way.
    expect(screen.queryByText(/Ordering from here is coming/)).toBeNull();
  });

  it("a to-place order says where it is placed today (the switch is off)", () => {
    wrap(<OrderHeaderCard order={all[0]} allOrders={all} onSelect={() => {}} />);
    expect(screen.getByText(/Orders are placed on the order board for now/)).toBeInTheDocument();
    expect(screen.queryByText("Mark as Ordered")).toBeNull();
  });

  it("timeline, lines with stock pills, shipping docs, Cardinal, patient, notes", () => {
    wrap(
      <>
        <OrderTimeline order={held} />
        <OrderLinesCard order={held} skuRows={rows} />
        <ShippingCard order={held} />
        <CardinalCard order={done} />
        <PatientCoverageCard order={held} />
        <NotesCard order={held} />
      </>,
    );
    expect(screen.getByText("Where it is")).toBeInTheDocument();
    expect(screen.getByText("Backordered")).toBeInTheDocument(); // the stock pill on the AutoSoft line
    expect(screen.getByText("G7 Receiver")).toBeInTheDocument(); // receiver named from the tracker row
    expect(screen.getByText("POD PDF", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("$215.31")).toBeInTheDocument();
    expect(screen.getByText("9/10: a note")).toBeInTheDocument();
  });

  it("substitution: the pick, the Send button, the verdict and its fix", () => {
    // Nothing to say about an ordinary order — the card renders nothing.
    const { container } = wrap(<SubstitutionCard order={done} skuRows={rows} />);
    expect(container.querySelector(".border.bg-card")).toBeNull();

    const swap = placed({
      id: "s", name: "Swap Person",
      backordered: 'AutoSoft 90 6mm 23" infusion sets',
      infusionSet1: 'AutoSoft 90 6 mm 23"', qtyInfusionSet1: "3", cahOrderNumber: "1120960884",
      substituteInfusionSet: 'TruSteel 6 mm 23"', substitutionStatus: "Sent",
    });
    wrap(<SubstitutionCard order={swap} skuRows={rows} />);
    expect(screen.getByText("Email sent")).toBeInTheDocument();
    expect(screen.getByText('AutoSoft 90 6mm 23" infusion sets')).toBeInTheDocument();
    expect(screen.getByText("TN1002833I", { exact: false })).toBeInTheDocument(); // the pick's SKU, off the tracker
    // The set already on the board is selected, so pressing Send is a re-send.
    expect((screen.getByLabelText("Switch to") as HTMLSelectElement).value).toBe('TruSteel 6 mm 23"');
    expect(screen.getByText("Re-send swap request")).toBeInTheDocument();
    // ⚠️ The backordered set is NOT offered — the email service refuses it.
    const opts = [...(screen.getByLabelText("Switch to") as HTMLSelectElement).options].map((o) => o.value);
    expect(opts).not.toContain('AutoSoft 90 6 mm 23"');
    expect(opts).toContain('AutoSoft XC 6 mm 23"');

  });

  it("substitution: an Error: label reads as not sent, and Send is refused with the reason", () => {
    wrap(
      <SubstitutionCard
        order={placed({
          id: "e", name: "Blocked Person",
          backordered: 'AutoSoft 90 6mm 23" infusion sets', infusionSet1: 'AutoSoft 90 6 mm 23"',
          substituteInfusionSet: 'TruSteel 6 mm 23"', substitutionStatus: "Error: No CAH Order Number",
        })}
        skuRows={rows}
      />,
    );
    expect(screen.getByText("Email not sent")).toBeInTheDocument();
    expect(screen.getByText(/Add the CAH Order Number/)).toBeInTheDocument();
    // No order number and no quantity, so Send is refused with the reason said.
    expect(screen.getByRole("button", { name: /swap request/i })).toBeDisabled();
    expect(screen.getByText(/Cardinal would refuse this/)).toBeInTheDocument();
  });

  it("overview counts and alerts, and the stock table", () => {
    wrap(<OrdersOverview orders={all} skuRows={rows} skuLastRun="Last run: 2026-09-15 09:05 ET (cron)" onSelect={() => {}} onShowStock={() => {}} loading={false} />);
    expect(screen.getByText("The ordering picture")).toBeInTheDocument();
    expect(screen.getByText(/Needs a person \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Cardinal stock alerts \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 open order on it/)).toBeInTheDocument();
  });

  it("stock view lists families and the poll history", () => {
    wrap(<SkuTrackerView rows={rows} loading={false} error={null} lastRun="Last run: 2026-09-15 09:05 ET (cron) — 31 changed" orders={all} onRefresh={() => {}} />);
    expect(screen.getByText(/Infusion sets \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/CGM receiver \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Poll history")).toBeInTheDocument();
  });

  it("sidebar sections and search", () => {
    const { rerender } = wrap(
      <OrdersSidebar orders={all} selectedId={null} onSelect={() => {}} loading={false} initialLoading={false} loadedRows={4} error={null} onRefresh={() => {}} query="" onQueryChange={() => {}} showAllDelivered={false} onShowAllDelivered={() => {}} />,
    );
    expect(screen.getByText(/To place \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Placed · in progress \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Delivered \(1\)/)).toBeInTheDocument();
    rerender(
      <MemoryRouter><SidebarProvider>
        <OrdersSidebar orders={all} selectedId={null} onSelect={() => {}} loading={false} initialLoading={false} loadedRows={4} error={null} onRefresh={() => {}} query="done" onQueryChange={() => {}} showAllDelivered={false} onShowAllDelivered={() => {}} />
      </SidebarProvider></MemoryRouter>,
    );
    expect(screen.getByText("1 of 4 orders")).toBeInTheDocument();
    expect(screen.queryByText(/To place/)).toBeNull();
  });
});
