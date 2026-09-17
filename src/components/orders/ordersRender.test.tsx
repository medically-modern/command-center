// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { OrderHeaderCard } from "./OrderHeaderCard";
import { OrderLinesCard } from "./OrderLinesCard";
import { SubstitutionCard } from "./SubstitutionCard";
import { NotesCard } from "./PatientCoverageCard";
import { OrderDetails } from "./OrderDetails";
import { OrdersOverview } from "./OrdersOverview";
import { SkuTrackerView } from "./SkuTrackerView";
import { OrdersSidebar } from "./OrdersSidebar";
import { mkOrder, placed, delivered, HOLD_SENTENCE } from "@/lib/orders/fixtures";
import { SKU_GROUPS, type SkuTrackerRow } from "@/lib/orders/skuTrackerApi";

/**
 * Every component on the Orders page, mounted once with fixture data. Pure
 * rules are tested in lib/orders; this catches what only a render catches — a
 * wrong import, a prop shape, a null the JSX did not expect — and pins the
 * shape of the 2026-09-17 simplification: ONE sentence answers "where is
 * it", nothing is said twice, and the long tail is folded but still there.
 * The contact trio and the sidebar marks reach for RingCentral-backed hooks,
 * which are stubbed so nothing here touches a network.
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
  it("header: the answer in one sentence, said once, with the other orders one click away", () => {
    wrap(<OrderHeaderCard order={held} allOrders={all} onSelect={() => {}} />);
    expect(screen.getByText("Held Person")).toBeInTheDocument();
    // The headline states the hold — and the flag banner does NOT repeat it.
    expect(screen.getByText("On hold at Cardinal — Credit Check Failure")).toBeInTheDocument();
    expect(screen.queryByText("On hold — Credit Check Failure")).toBeNull();
    // A different fact still gets its banner.
    expect(screen.getByText("Backordered at Cardinal")).toBeInTheDocument();
    // DOB rides under the name; the item id, PO and group are in the drawer, not here.
    expect(screen.getByText(/DOB 01\/01\/1980/)).toBeInTheDocument();
    expect(screen.queryByText(/Item h/)).toBeNull();
    expect(screen.queryByText("Accepted / Partial")).toBeNull();
    // The path, and the paperwork as a button.
    expect(screen.getByLabelText("Order progress")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /POD PDF/ })).toBeInTheDocument();
    expect(screen.getByText(/Other orders \(1\)/)).toBeInTheDocument();
  });

  it("a delivered order: the date and the signature, and a Track button to the carrier", () => {
    wrap(<OrderHeaderCard order={done} allOrders={all} onSelect={() => {}} />);
    expect(screen.getByText("Delivered 9/11/2026")).toBeInTheDocument();
    expect(screen.getByText("Signed by FRONT DOOR")).toBeInTheDocument();
    const track = screen.getByRole("link", { name: /Track package/ });
    expect(track).toHaveAttribute("href", expect.stringContaining("ups.com"));
  });

  it("a to-place order says so and offers no button while the switch is off", () => {
    wrap(<OrderHeaderCard order={all[0]} allOrders={all} onSelect={() => {}} />);
    expect(screen.getByText("Waiting to be placed")).toBeInTheDocument();
    expect(screen.queryByText("Mark as Ordered")).toBeNull();
    expect(screen.queryByText(/order board for now/)).toBeNull();
  });

  it("lines: product and quantity, a stock pill only where it says something, notes, and the drawer", () => {
    wrap(
      <>
        <OrderLinesCard order={held} skuRows={rows} />
        <NotesCard order={held} />
        <OrderDetails order={done} />
      </>,
    );
    expect(screen.getByText("Backordered")).toBeInTheDocument(); // the AutoSoft line's pill
    expect(screen.getByText("G7 Receiver")).toBeInTheDocument(); // receiver named from the tracker row
    expect(screen.queryByText("426 in stock")).toBeNull();      // an available line wears no pill
    expect(screen.getByText("9/10: a note")).toBeInTheDocument();
    // Folded, not dropped: the invoice is still in the DOM, under the drawer.
    expect(screen.getByText("Full order details")).toBeInTheDocument();
    expect(screen.getByText("$215.31")).toBeInTheDocument();
  });

  it("a delivered order wears no stock pill — stock today is not that patient's question", () => {
    wrap(<OrderLinesCard order={delivered({ infusionSet1: 'AutoSoft 90 6 mm 23"', qtyInfusionSet1: "3" })} skuRows={rows} />);
    expect(screen.queryByText("Backordered")).toBeNull();
    expect(screen.getByText('AutoSoft 90 6 mm 23"')).toBeInTheDocument();
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
    expect(screen.getByText("Email sent to Cardinal")).toBeInTheDocument();
    expect(screen.getByText('AutoSoft 90 6mm 23" infusion sets')).toBeInTheDocument();
    expect(screen.getByText("TN1002833I")).toBeInTheDocument(); // the pick's SKU, off the tracker
    // The set already on the board is selected, so pressing Send is a re-send.
    expect((screen.getByLabelText("Switch to") as HTMLSelectElement).value).toBe('TruSteel 6 mm 23"');
    expect(screen.getByText("Re-send swap request")).toBeInTheDocument();
    // ⚠️ The backordered set is NOT offered — the email service refuses it.
    const opts = [...(screen.getByLabelText("Switch to") as HTMLSelectElement).options].map((o) => o.value);
    expect(opts).not.toContain('AutoSoft 90 6 mm 23"');
    expect(opts).toContain('AutoSoft XC 6 mm 23"');

    // The email itself is previewed, read-only — the words Cardinal will read,
    // not a description of them. Nothing here is editable and nothing sends.
    expect(screen.getByText("Preview the email Cardinal will get")).toBeInTheDocument();
    expect(screen.getByText(/switch order 1120960884 to TruSteel 6 mm 23"/)).toBeInTheDocument();
    expect(screen.getByText("Quantity of boxes to ship: 3")).toBeInTheDocument();
    expect(screen.getByText("SKU for new order: TN1002833I")).toBeInTheDocument();
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

  it("landing: the search, what needs a person, and one line on stock", () => {
    const { rerender } = wrap(
      <OrdersOverview orders={all} skuRows={rows} onSelect={() => {}} onShowStock={() => {}} loading={false} query="" onQueryChange={() => {}} />,
    );
    expect(screen.getByLabelText("Find an order")).toBeInTheDocument();
    expect(screen.getByText(/Needs a person \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 SKU Cardinal can't ship today/)).toBeInTheDocument();
    expect(screen.getByText(/1 open order on them/)).toBeInTheDocument();
    // Typing turns the landing into the answer and folds the rest away.
    rerender(
      <MemoryRouter><SidebarProvider>
        <OrdersOverview orders={all} skuRows={rows} onSelect={() => {}} onShowStock={() => {}} loading={false} query="done" onQueryChange={() => {}} />
      </SidebarProvider></MemoryRouter>,
    );
    expect(screen.getByText("Done Person")).toBeInTheDocument();
    expect(screen.getByText("Delivered 9/11")).toBeInTheDocument();
    expect(screen.queryByText(/Needs a person/)).toBeNull();
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
    expect(screen.getByText(/In progress \(1\)/)).toBeInTheDocument();
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
