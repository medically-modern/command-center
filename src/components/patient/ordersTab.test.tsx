/**
 * The patient screen's Subscription › Orders tab — Brandon's `ordersPage`
 * (pixel-match Phase 2): the selected order on top, the latest by default,
 * drawn from ONE full read; the history table underneath, where clicking a row
 * shows that order above. FAKE data only (the 555 range, "Sample" names).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DossierItem } from "@/lib/commsHub/dossier";
import { COL, GROUPS, type MondayItem } from "@/lib/orders/mondayApi";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";
import type { Order } from "@/lib/orders/workflow";

type Detail = { order: Order | null; loading: boolean; error: string; gone: boolean; reload: () => void };

const state = vi.hoisted(() => ({
  abilities: {} as Record<string, boolean>,
  items: [] as unknown[],
  detail: null as unknown as (id: string | null) => Detail,
}));
const detailArgs = vi.hoisted(() => [] as (string | null)[]);
const reload = vi.hoisted(() => vi.fn());

vi.mock("@/components/shell/AbilityLock", () => ({
  useAbility: (a: string) => state.abilities[a] ?? true,
  AbilityLockNote: () => null,
}));
vi.mock("@/hooks/patient/usePatientOrders", () => ({
  usePatientOrders: () => ({ orders: state.items, loading: false, error: "" }),
}));
vi.mock("@/hooks/patient/usePatientOrderDetail", () => ({
  usePatientOrderDetail: (id: string | null) => {
    detailArgs.push(id);
    return state.detail(id);
  },
}));
vi.mock("@/hooks/orders/useSkuTracker", () => ({ useSkuTracker: () => ({ rows: [] }) }));
vi.mock("@/components/orders/SubstitutionCard", () => ({
  SubstitutionCard: ({ order }: { order: Order }) => <p>Swap card for {order.id}</p>,
}));
vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { SubscriptionView } from "./SubscriptionView";

const cv = (id: string, text: string, value: string | null = null) => ({ id, text, value });

/** A FAKE order item. The latest is delivered; the older one partly shipped. */
function item(id: string, over: Record<string, string>, groupId: string): MondayItem {
  return {
    id,
    name: "Jane Sample",
    group: { id: groupId },
    column_values: Object.entries(over).map(([col, text]) => cv(col, text)),
  };
}
const DELIVERED = item(
  "9001",
  {
    [COL.orderStatus]: "Process Claim",
    [COL.apiStatus]: "Delivered",
    [COL.orderDate]: "2026-09-01",
    [COL.cahOrderNumber]: "1120000001",
    [COL.deliveryDate]: "2026-09-11",
    [COL.tracking1]: "1Z999AA10123456784",
    [COL.carrier]: "UPS",
    [COL.cgmType]: "Dexcom G7",
    [COL.qtySensors]: "3",
  },
  GROUPS.shippedDelivered,
);
const OPEN_BO = item(
  "9000",
  {
    [COL.orderStatus]: "Process Claim",
    [COL.apiStatus]: "Backordered",
    [COL.orderDate]: "2026-06-01",
    [COL.cahOrderNumber]: "1110000000",
    [COL.backordered]: 'AutoSoft 90 6mm 23" infusion sets',
    [COL.infusionSet1]: 'AutoSoft 90 6 mm 23"',
    [COL.qtyInfusionSet1]: "3",
  },
  GROUPS.acceptedPartial,
);
/** Shipped before Cardinal records began — no API Status, no ship date. */
const PRE_TRACKING = item(
  "8990",
  { [COL.orderStatus]: "Process Claim", [COL.orderDate]: "2025-12-01" },
  GROUPS.shippedDelivered,
);
const EXTRA_OPEN = item(
  "8999",
  { [COL.orderStatus]: "Order", [COL.orderDate]: "2026-05-01" },
  GROUPS.order,
);

/** The FULL read carries what a list row does not — the signature. */
function full(it: MondayItem, extra: Record<string, string> = {}): Order {
  return mondayItemToOrder({
    ...it,
    column_values: [...it.column_values, ...Object.entries(extra).map(([c, t]) => cv(c, t))],
  });
}
const byId: Record<string, Order> = {
  "9001": full(DELIVERED, { [COL.signedBy]: "FRONT DOOR" }),
  "9000": full(OPEN_BO),
  "8999": full(EXTRA_OPEN),
  "8990": full(PRE_TRACKING),
};

const ITEM: DossierItem = {
  itemId: "8000",
  name: "Jane Sample",
  phone: "5555550100",
  boardId: 18407459988,
  boardName: "Subscription Board - Updated",
  groupId: "topics",
  groupTitle: "Subscriptions",
  isCompleted: false,
  isStuck: false,
  escalationText: "",
  escalationLevel: null,
  isProposedStuck: false,
  dob: "03/14/1958",
  route: "/subscription",
  stageAdvancerText: "",
  notes: "",
  notesColId: "text_mm6vp1z3",
  notesColType: "text",
  nextActionDate: "",
  daysSinceStage: "",
  createdAt: "",
  cols: { color_mm2t7tdy: "Active" },
};

function renderOrders(cols: Record<string, string> = {}) {
  return render(
    <MemoryRouter>
      <div className="cc-pt">
        <SubscriptionView
          item={{ ...ITEM, cols: { ...ITEM.cols, ...cols } }}
          phone="5555550100"
          tab="orders"
          onTab={() => {}}
        />
      </div>
    </MemoryRouter>,
  );
}

const ready = (id: string | null): Detail => ({
  order: id ? byId[id] ?? null : null,
  loading: false,
  error: "",
  gone: false,
  reload,
});

beforeEach(() => {
  state.abilities = {};
  state.items = [OPEN_BO, DELIVERED];
  state.detail = ready;
  detailArgs.length = 0;
  reload.mockClear();
});

describe("Subscription › Orders — the selected order", () => {
  it("opens on the LATEST order, read in full, with its row marked", () => {
    renderOrders();
    expect(screen.getByRole("heading", { name: "Latest order" })).toBeInTheDocument();
    expect(detailArgs.at(-1)).toBe("9001");
    const card = screen.getByTestId("order-card");
    expect(within(card).getByText("#1120000001")).toBeInTheDocument();
    // From the full read only — a history row does not carry the signature.
    expect(card.textContent).toContain("signed FRONT DOOR");
    expect(screen.getByText("Complete — nothing to do on it.")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(within(rows[0]).getByText("latest")).toBeInTheDocument();
  });

  it("⚠️⚠️ never draws a history row as the card — it waits for the full read", () => {
    state.detail = (id) => ({ ...ready(id), order: null, loading: true });
    renderOrders();
    expect(screen.queryByTestId("order-card")).toBeNull();
    expect(screen.getByText("Reading this order…")).toBeInTheDocument();
    expect(screen.getByText("Reading this order from the order board…")).toBeInTheDocument();
  });

  it("clicking a history row shows it above; Back to latest returns", () => {
    renderOrders();
    fireEvent.click(screen.getAllByRole("row")[2]);
    expect(detailArgs.at(-1)).toBe("9000");
    expect(screen.getByRole("heading", { name: /Order #1110000000/ })).toBeInTheDocument();
    expect(screen.getByText(/placed 6\/1\/2026/)).toBeInTheDocument();
    expect(screen.getAllByRole("row")[2]).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: /Back to latest/ }));
    expect(screen.getByRole("heading", { name: "Latest order" })).toBeInTheDocument();
    expect(detailArgs.at(-1)).toBe("9001");
  });

  it("the keyboard picks a row too", () => {
    renderOrders();
    fireEvent.keyDown(screen.getAllByRole("row")[2], { key: "Enter" });
    expect(screen.getByRole("heading", { name: /Order #1110000000/ })).toBeInTheDocument();
  });

  it("the history rows wear his pill words, from the slice's own verdict", () => {
    renderOrders();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Delivered 9/11/2026")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Backordered")).toBeInTheDocument();
  });

  it("'N orders still open' only when more than one is", () => {
    const { unmount } = renderOrders();
    expect(screen.queryByText(/orders still open/)).toBeNull();
    unmount();
    state.items = [EXTRA_OPEN, OPEN_BO, DELIVERED];
    renderOrders();
    expect(screen.getByText("2 orders still open")).toBeInTheDocument();
  });

  it("⚠️ an order from before Cardinal records began is not 'still open'", () => {
    // Found by rendering it: a 2025 order with no tracking was counted, and
    // drawn with the amber "open" edge, as though somebody had work on it.
    state.items = [OPEN_BO, DELIVERED, PRE_TRACKING];
    renderOrders();
    expect(screen.queryByText(/orders still open/)).toBeNull();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[2]).getByText("Shipped · no tracking")).toBeInTheDocument();
  });

  it("⚠️ the swap is /orders' own card, and only for Adjust orders", () => {
    state.items = [OPEN_BO];
    renderOrders();
    expect(screen.getByText("Swap card for 9000")).toBeInTheDocument();
    expect(screen.getByText(/can be swapped below/)).toBeInTheDocument();
  });

  it("without Adjust orders the order still reads in full, and one line says who can swap", () => {
    state.abilities = { adjustOrders: false };
    state.items = [OPEN_BO];
    renderOrders();
    expect(screen.queryByText(/Swap card for/)).toBeNull();
    expect(screen.getByText(/needs/).textContent).toMatch(/Adjust orders/);
    expect(screen.getByText("Part of it is still with Cardinal.")).toBeInTheDocument();
    // The backordered set is named in the still-to-come block either way.
    expect(screen.getByTestId("order-card").textContent).toContain('AutoSoft 90 6mm 23" infusion sets');
  });

  it("a failed read says so, and Try again reads it again", () => {
    state.detail = (id) => ({ ...ready(id), order: null, error: "Monday 503" });
    renderOrders();
    expect(screen.getByText("Couldn't read this order.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the Orders page stays one click away for the order shown", () => {
    renderOrders();
    expect(screen.getByRole("link", { name: /Open on Orders/ })).toHaveAttribute(
      "href",
      "/orders?orderId=9001&from=patient",
    );
  });
});

describe("the Upcoming order strip — his header chip and inline days", () => {
  // Only Date is faked, so Testing Library's own timers keep running.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T16:00:00Z")); // noon ET
  });
  afterEach(() => vi.useRealTimers());

  const NEXT = "date_mkp0nvf1";
  const upcoming = () => screen.getByText("Upcoming order").closest("section") as HTMLElement;

  it("'places in N days' inside the fortnight, and the cadence beside the subscription", () => {
    renderOrders({ [NEXT]: "2026-09-29", color_mm273mv8: "Sensors", color_mm2w6kd: "Reorder", color_mm48kv1c: "90-Days" });
    const box = upcoming();
    expect(within(box).getByText(/places in 5 days/)).toBeInTheDocument();
    expect(within(box).getByText("(in 5 days)")).toBeInTheDocument();
    // His strip: "Sensors · 90-Days" — the order type is the Profile strip's.
    const sub = within(box).getByText("Subscription").parentElement as HTMLElement;
    expect(sub.textContent).toBe("SubscriptionSensors· 90-Days");
  });

  it("⚠️ an overdue order says so on the DATE, amber, and gets no 'places' chip", () => {
    renderOrders({ [NEXT]: "2026-09-20" });
    const box = upcoming();
    expect(within(box).queryByText(/places/)).toBeNull();
    const late = within(box).getByText("(4 days overdue)");
    expect(late.className).toContain("warn");
  });

  it("further out than a fortnight: the days, no chip", () => {
    renderOrders({ [NEXT]: "2026-12-01" });
    const box = upcoming();
    expect(within(box).queryByText(/places/)).toBeNull();
    expect(within(box).getByText("(in 68 days)")).toBeInTheDocument();
  });
});
