import { describe, it, expect } from "vitest";
import { GROUPS } from "./mondayApi";
import { DELIVERED_LIMIT, sidebarSections, sidebarVisibleList } from "./sidebarList";
import { mkOrder, placed, delivered, HOLD_SENTENCE } from "./fixtures";

describe("sidebarSections", () => {
  const toPlaceOld = mkOrder({ id: "tp1", orderDate: "2026-09-01" });
  const toPlaceNew = mkOrder({ id: "tp2", orderDate: "2026-09-14" });
  const placing = mkOrder({ id: "pl", orderStatus: "Ordered", orderDate: "2026-09-02" });
  const hold = mkOrder({ id: "h", orderStatus: "On Hold", orderDate: "2026-09-20" });
  const fine = placed({ id: "ip1", orderDate: "2026-09-03" });
  const held = placed({ id: "ip2", orderDate: "2026-09-12", apiStatus: HOLD_SENTENCE });
  const shipped = placed({ id: "s1", apiStatus: "SHIPPED", shipDate: "2026-09-13" });
  const d1 = delivered({ id: "d1", deliveryDate: "2026-09-01" });
  const d2 = delivered({ id: "d2", deliveryDate: "2026-09-11" });
  const ret = mkOrder({ id: "r", groupId: GROUPS.returns, orderStatus: "Return in Progress" });
  const can = mkOrder({ id: "c", groupId: GROUPS.cancelled, orderStatus: "Stuck" });
  const all = [d1, can, held, toPlaceNew, ret, shipped, fine, hold, toPlaceOld, d2, placing];

  it("puts every order in exactly one section", () => {
    const s = sidebarSections(all);
    const ids = sidebarVisibleList(all).map((o) => o.id);
    expect(ids.length).toBe(all.length);
    expect(new Set(ids).size).toBe(all.length);
    expect(s.cancelled.map((o) => o.id)).toEqual(["c"]);
    expect(s.returns.map((o) => o.id)).toEqual(["r"]);
  });

  it("To place is oldest first, with Placing riding along after it", () => {
    expect(sidebarSections(all).toPlace.map((o) => o.id)).toEqual(["tp1", "tp2", "pl"]);
  });

  it("in progress floats what needs a person, then oldest first", () => {
    expect(sidebarSections(all).inProgress.map((o) => o.id)).toEqual(["ip2", "ip1"]);
  });

  it("delivered is newest first", () => {
    expect(sidebarSections(all).delivered.map((o) => o.id)).toEqual(["d2", "d1"]);
  });

  it("the visible list runs section by section in render order", () => {
    expect(sidebarVisibleList(all).map((o) => o.id)).toEqual(["tp1", "tp2", "pl", "h", "ip2", "ip1", "s1", "d2", "d1", "r", "c"]);
  });

  it("caps delivered until the rep searches or asks for all", () => {
    const many = Array.from({ length: DELIVERED_LIMIT + 10 }, (_, i) =>
      delivered({ id: `x${i}`, name: i === 0 ? "Needle Person" : "Hay Person", deliveryDate: `2026-08-${String((i % 28) + 1).padStart(2, "0")}` }),
    );
    const capped = sidebarSections(many);
    expect(capped.delivered.length).toBe(DELIVERED_LIMIT);
    expect(capped.deliveredHidden).toBe(10);
    expect(sidebarSections(many, { showAllDelivered: true }).deliveredHidden).toBe(0);
    const searched = sidebarSections(many, { query: "needle" });
    expect(searched.delivered.map((o) => o.id)).toEqual(["x0"]);
    expect(searched.deliveredHidden).toBe(0);
  });

  it("a query filters every section", () => {
    const s = sidebarSections(all, { query: "tp2" });
    expect(sidebarVisibleList(all, { query: "tp2" }).map((o) => o.id)).toEqual(["tp2"]);
    expect(s.inProgress).toEqual([]);
  });
});
