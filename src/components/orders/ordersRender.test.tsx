// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { OrderHeaderCard } from "./OrderHeaderCard";
import { OrderLinesCard } from "./OrderLinesCard";
import { SubstitutionCard } from "./SubstitutionCard";
import { CashPayCard } from "./CashPayCard";
import { NotesCard } from "./PatientCoverageCard";
import { OrderDetails } from "./OrderDetails";
import { OrdersOverview } from "./OrdersOverview";
import { SkuTrackerView, lastRunLine } from "./SkuTrackerView";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
/* The cash pay card asks who is signed in — the RELEASE is manager-only. The
   ref is hoisted so a test can flip it before mounting. */
const who = vi.hoisted(() => ({ type: "manager" as "manager" | "processor" }));
vi.mock("@/components/AccessProvider", async () => {
  const actual = await vi.importActual<typeof import("@/components/AccessProvider")>("@/components/AccessProvider");
  return {
    ...actual,
    useAccessContext: () => ({
      ...({} as Record<string, unknown>),
      access: { type: who.type },
      email: "rep@medicallymodern.com",
      config: { managers: [], processors: {} },
    }),
  };
});
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
  { id: "r1", name: 'TruSteel 6 mm 23"', groupId: SKU_GROUPS.infusionSets, sku: "TN1002833I", description: "TruSteel", uom: "BX", unitCost: 63.77, qtyAvail: 426, status: "Available", lastChanged: "2026-09-15 09:05 ET", notes: "", runHistory: "" },
  { id: "r2", name: 'AutoSoft 90 6 mm 23"', groupId: SKU_GROUPS.infusionSets, sku: "TN1002817I", description: "", uom: "BX", unitCost: 71.94, qtyAvail: 220, status: "Backordered", lastChanged: "2026-09-15 09:05 ET", notes: "", runHistory: "" },
  { id: "r3", name: "Dexcom G7 / G7 15-Day → G7 Receiver", groupId: SKU_GROUPS.cgmReceivers, sku: "EDSTKAT013MEDIM", description: "", uom: "EA", unitCost: 234.28, qtyAvail: 1156, status: "Available", lastChanged: "2026-09-15 09:05 ET", notes: "", runHistory: "" },
  { id: "log", name: "Last run: 2026-09-15 09:05 ET (cron) — 31 changed", groupId: SKU_GROUPS.runLog, sku: "", description: "", uom: "", unitCost: null, qtyAvail: null, status: "", lastChanged: "", notes: "", runHistory: "[2026-09-15 09:05 ET] cron — 45 SKUs" },
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

  /* §5.39h — Brandon's Inventory: ONE table with category chips, where this
     used to be a card per family. The families are still every family the
     board has, and the poll history still opens. */
  it("inventory: one sortable table, chips for the families, the poll history", () => {
    wrap(<SkuTrackerView rows={rows} loading={false} error={null} lastRun="Last run: 2026-09-15 09:05 ET (cron) — 31 changed" orders={all} onRefresh={() => {}} />);
    expect(screen.getByRole("heading", { name: "Inventory" })).toBeInTheDocument();
    // A chip per family present on the board, plus All.
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Infusion sets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CGM receiver" })).toBeInTheDocument();
    // One table, his five columns exactly — Open orders is commented out
    // behind SHOW_OPEN_ORDERS (Josh, 2026-09-25).
    expect(screen.getAllByRole("table")).toHaveLength(1);
    for (const col of ["Product", "Status", "Available", "Unit cost", "OOP price"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${col}`) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^Open orders/ })).toBeNull();
    // OOP is DERIVED — cost × the cash-pay markup, the mockup's own rule
    // (Josh, 2026-09-25) — never the board's column. 71.94 × 1.25 is the
    // 89.925 float tie a naive round loses.
    expect(screen.getByText("$79.71")).toBeInTheDocument(); // TruSteel, 63.77
    expect(screen.getByText("$89.93")).toBeInTheDocument(); // AutoSoft 90, 71.94
    expect(screen.getByText("$292.85")).toBeInTheDocument(); // G7 receiver, 234.28
    expect(screen.getByText("Poll history")).toBeInTheDocument();
  });

  it("⚠️ the search and the chips narrow the SAME table, and say so when nothing matches", () => {
    wrap(<SkuTrackerView rows={rows} loading={false} error={null} lastRun="" orders={all} onRefresh={() => {}} />);
    const box = screen.getByLabelText("Search inventory");
    fireEvent.change(box, { target: { value: "no-such-sku" } });
    // An empty list says which query and which category, never a blank table.
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  /* Josh, 2026-09-25: *"remove the reload(s) on inventory page, just show more
     plainly when the last check went out and what changed (no need for
     (cron))"* — the page force-reads the board every time it opens instead. */
  describe("⚠️ the Inventory reloads are gone; the last check reads plainly (2026-09-25)", () => {
    it("no Refresh button — but a FAILED read still offers Try again", () => {
      const { rerender } = wrap(
        <SkuTrackerView rows={rows} loading={false} error={null} lastRun="Last run: 2026-09-15 09:05 ET (cron) — 31 changed" orders={all} onRefresh={() => {}} />,
      );
      expect(screen.queryByRole("button", { name: /Refresh/ })).toBeNull();
      rerender(
        <MemoryRouter><SidebarProvider>
          <SkuTrackerView rows={rows} loading={false} error="Monday 503" lastRun="" orders={all} onRefresh={() => {}} />
        </SidebarProvider></MemoryRouter>,
      );
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    });

    it("the last-run line drops '(cron)' and says what changed", () => {
      wrap(<SkuTrackerView rows={rows} loading={false} error={null} lastRun="Last run: 2026-09-15 09:05 ET (cron) — 31 changed" orders={all} onRefresh={() => {}} />);
      expect(screen.getByText("Last checked 9/15 9:05 AM ET · 31 items changed")).toBeInTheDocument();
      expect(screen.queryByText(/\(cron\)/)).toBeNull();
    });

    it("`lastRunLine` parses the scraper's shape and returns anything else VERBATIM", () => {
      expect(lastRunLine("Last run: 2026-09-15 09:05 ET (cron) — 31 changed")).toBe(
        "Last checked 9/15 9:05 AM ET · 31 items changed",
      );
      expect(lastRunLine("Last run: 2026-09-15 13:07 ET — 1 changed")).toBe(
        "Last checked 9/15 1:07 PM ET · 1 item changed",
      );
      expect(lastRunLine("Last run: 2026-09-15 09:05 ET (cron)")).toBe("Last checked 9/15 9:05 AM ET");
      // Scraped text it does not recognise must never be guessed at (§5.39i).
      expect(lastRunLine("Run log rebuilt by hand 9/15")).toBe("Run log rebuilt by hand 9/15");
    });

    it("⚠️ the page force-reads the board on every Inventory open, and hides the one-tab switcher", () => {
      const page = readFileSync(resolve(process.cwd(), "src/pages/OrdersPage.tsx"), "utf8");
      expect(page).toMatch(/if \(view === "stock"\) void refreshSkuTracker\(true\);/);
      // The lone Inventory tab on the Inventory page was redundant (Josh);
      // the orders view keeps the switcher — there it is a real door.
      expect(page).toMatch(/\{\(SHOW_ORDERS_TAB \|\| view === "orders"\) && \(/);
      // The header Refresh is the ORDER BOARD's and stays on the orders view.
      expect(page).toMatch(/\{view === "orders" && \(\s*<Button onClick=\{\(\) => void refetch\(false\)\}/);
    });
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

describe("the cash pay card", () => {
  /* Debbie Hinze's real order, priced against the tracker costs read
     2026-09-21: 3 x 30.95 + 3 x 71.94 + 9 x 57.32, x1.25 per line. The total
     is the figure Janelle quoted her (§5.48 / cashPayPricing). */
  const cashRows: SkuTrackerRow[] = [
    ...rows,
    { id: "c1", name: "t:slim", groupId: SKU_GROUPS.cartridges, sku: "TN1004017", description: "", uom: "BX", unitCost: 30.95, qtyAvail: 900, status: "Available", lastChanged: "2026-09-21 09:05 ET", notes: "", runHistory: "" },
    { id: "c2", name: 'AutoSoft XC 9 mm 43"', groupId: SKU_GROUPS.infusionSets, sku: "TN1002823I", description: "", uom: "BX", unitCost: 71.94, qtyAvail: 400, status: "Available", lastChanged: "2026-09-21 09:05 ET", notes: "", runHistory: "" },
    { id: "c3", name: "Dexcom G7", groupId: SKU_GROUPS.cgmSensors, sku: "EDSTKAT013", description: "", uom: "EA", unitCost: 57.32, qtyAvail: 1200, status: "Available", lastChanged: "2026-09-21 09:05 ET", notes: "", runHistory: "" },
  ];
  const debbie = mkOrder({
    id: "cp", name: "Debbie Hinze", phone: "5555550109", primaryInsurance: "Cash Pay",
    cartridgeType: "t:slim", qtyCartridge: "3",
    infusionSet1: 'AutoSoft XC 9 mm 43"', qtyInfusionSet1: "3",
    cgmType: "Dexcom G7", qtySensors: "9",
  });

  it("renders nothing at all for an insured order", () => {
    const { container } = wrap(<CashPayCard order={done} skuRows={cashRows} />);
    expect(container.textContent).toBe("");
  });

  it("prices the order to the cent and folds the itemisation away", () => {
    wrap(<CashPayCard order={debbie} skuRows={cashRows} />);
    expect(screen.getByText("$1,030.69")).toBeInTheDocument();
    expect(screen.getByText("No payment link yet.")).toBeInTheDocument();
    // ⚠️ Said ONCE: the per-line prices live under the fold, because
    // OrderLinesCard above already names every product (§5.35).
    expect(screen.getByText("How that's worked out")).toBeInTheDocument();
    expect(screen.queryByText("$116.06")).toBeInTheDocument(); // in the DOM, folded
  });

  it("⚠️ refuses to quote rather than quote short when a line has no cost", () => {
    // The tracker is loaded, and the sensors row is simply missing from it.
    wrap(<CashPayCard order={debbie} skuRows={cashRows.filter((r) => r.id !== "c3")} />);
    expect(screen.getByText("This order can't be priced")).toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).toBeNull();
  });

  /* ✅ The flow went live 2026-09-22 (monday webhooks 641115241 mint /
     641125712 text, both verified end to end), so Generate is a real press on
     an order that can be priced. If it is ever switched back off the button
     goes inert with the reason on screen — a safe state, and the §5.39g rule
     this codebase keeps having to reverse: a control whose passing move is
     invisible is worse than one that says what it is waiting for. */
  it("Generate is live, and the dark-mode explanation is gone", () => {
    wrap(<CashPayCard order={debbie} skuRows={cashRows} />);
    expect(screen.getByRole("button", { name: /Generate cash pay link/ })).toBeEnabled();
    expect(screen.queryByText(/aren't switched on yet/)).toBeNull();
  });

  it("a paid order says so and offers neither press", () => {
    wrap(<CashPayCard order={mkOrder({ ...debbie, stripeChargeId: "pi_3abc" })} skuRows={cashRows} />);
    expect(screen.getByText("Paid — this order can go to Cardinal.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate cash pay link/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Send to patient/ })).toBeNull();
    expect(screen.queryByText(/Release this order/)).toBeNull();
  });

  it("a sent link is shown with the amount it was minted for", () => {
    wrap(<CashPayCard order={mkOrder({ ...debbie, cashPayLink: "https://checkout.stripe.com/c/pay/cs_1", cashPayAmount: "1030.69", cashPayLinkSent: "2026-09-22" })} skuRows={cashRows} />);
    expect(screen.getByText(/Waiting on the patient/)).toBeInTheDocument();
    expect(screen.getByText(/Minted for \$1,030.69/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-send to patient/ })).toBeInTheDocument();
  });

  it("⚠️ a rep cannot open the release — it is manager-only", () => {
    who.type = "processor";
    try {
      wrap(<CashPayCard order={debbie} skuRows={cashRows} />);
      const rel = screen.getByRole("button", { name: /Release this order for Cardinal/ });
      expect(rel).toBeDisabled();
      expect(rel.textContent).toMatch(/manager only/);
    } finally {
      who.type = "manager";
    }
  });

  it("a manager's release asks for a reason before it will save", () => {
    wrap(<CashPayCard order={debbie} skuRows={cashRows} />);
    fireEvent.click(screen.getByRole("button", { name: /Release this order for Cardinal/ }));
    const save = screen.getByRole("button", { name: /Release for ordering/ });
    expect(save).toBeDisabled();
    expect(screen.getByText(/only record of why it shipped unpaid/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/How was it paid/), { target: { value: "cheque cleared 9/21" } });
    expect(screen.getByRole("button", { name: /Release for ordering/ })).toBeEnabled();
  });
});
