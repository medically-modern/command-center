/**
 * Brandon's order card — the parts a rep reads at a glance: the tracker's
 * highlight, the partial step, and the pre-tracking card. Each regression
 * here was found by RENDERING it, not by reading it. FAKE data only.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GROUPS } from "@/lib/orders/mondayApi";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";
import type { Order } from "@/lib/orders/workflow";

vi.mock("@/hooks/orders/useSkuTracker", () => ({ useSkuTracker: () => ({ rows: [] }) }));
vi.mock("@/components/orders/SubstitutionCard", () => ({ SubstitutionCard: () => <p>Swap card</p> }));

import { PatientOrderCard } from "./PatientOrderCard";

function order(over: Partial<Order> = {}): Order {
  const base = mondayItemToOrder({ id: "1234567890", name: "Jane Sample", group: { id: GROUPS.acceptedPartial }, column_values: [] });
  return { ...base, orderStatus: "Process Claim", orderDate: "2026-08-01", cahOrderNumber: "1110000000", ...over };
}
const steps = () => Array.from(document.querySelectorAll(".tracker .st")).map((s) => s.className);

describe("the order card", () => {
  it("⚠️ the partial step is 'part', never 'note' — `.note` is the notes card's box", () => {
    render(
      <PatientOrderCard
        order={order({ apiStatus: "Partially Shipped", shipDate: "2026-08-05", tracking: ["123456789012", "", "", "", ""] })}
        canAdjust
      />,
    );
    const cls = steps();
    expect(cls.some((c) => /\bnote\b/.test(c))).toBe(false);
    expect(cls[3]).toContain("part");
    // The ring never sits on a step BEFORE one the order has already passed.
    expect(cls.some((c) => /\bnow\b/.test(c))).toBe(false);
  });

  it("delivered: the last step wears the ring, and the tracker turns green", () => {
    render(
      <PatientOrderCard
        order={order({ apiStatus: "Delivered", deliveryDate: "2026-09-11", groupId: GROUPS.shippedDelivered })}
        canAdjust
      />,
    );
    const cls = steps();
    expect(cls[cls.length - 1]).toMatch(/done now/);
    expect(document.querySelector(".tracker")!.className).toContain("delivered");
    expect(screen.getByTestId("order-card").className).toContain("done");
  });

  it("⚠️ an order from before Cardinal records began: a grey notice, no boxes, no tracker", () => {
    render(<PatientOrderCard order={order({ apiStatus: "", groupId: GROUPS.shippedDelivered, cahOrderNumber: "" })} canAdjust />);
    expect(screen.getByText(/Shipped before Cardinal records began/)).toBeInTheDocument();
    expect(document.querySelector(".tracker")).toBeNull();
    expect(document.querySelectorAll(".shp")).toHaveLength(0);
    // Settled work: the green edge, not the amber "open" one.
    expect(screen.getByTestId("order-card").className).toContain("done");
  });

  it("a hold carries Cardinal's own sentence, once, under the pill", () => {
    const text = "Order has been put on hold, Hold reason: Credit Check Failure, Please contact customer care";
    render(<PatientOrderCard order={order({ apiStatus: text })} canAdjust />);
    expect(screen.getAllByText(/On hold — Credit Check Failure/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(text)).toHaveLength(1);
  });
});
