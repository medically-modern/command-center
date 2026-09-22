/**
 * ⚠️⚠️ **INVENTORY MUST NOT BE HELD BEHIND THE ORDER BOARD'S FIRST READ.**
 *
 * Josh, 2026-09-22: *"Inventory - takes too long to load, and even worse i'll
 * accidentally press it, and then i'm stuck and have to wait 15 second before i
 * can do anything or click anywhere else"*.
 *
 * `PageLoadingOverlay` is `fixed inset-0` and captures pointer events, and
 * `initialLoading` is the ORDER BOARD's first read — ~1,500 rows over three
 * sequential pages. It fired on BOTH views, so pressing Inventory by mistake
 * locked the whole window until a read that view barely uses came back.
 *
 * Both halves are scanned rather than trusted, because the failure is a
 * *working* page you cannot click: nothing errors, nothing looks broken, and
 * the only symptom is a wait.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the Inventory view is never blocked by the orders read", () => {
  it("⚠️ the overlay is scoped to the ORDERS view", () => {
    const page = src("src/pages/OrdersPage.tsx");
    expect(page).toMatch(/<PageLoadingOverlay\s+show=\{view === "orders" && initialLoading\}/);
    expect(page, "the overlay went back to blocking both views").not.toMatch(
      /<PageLoadingOverlay\s+show=\{initialLoading\}/,
    );
  });

  it("⚠️ the orders view KEEPS it — there the stale list is on screen behind it", () => {
    // Which is the whole reason the overlay exists: a rep clicking rows of the
    // previous role's list during the window before fresh data lands.
    expect(src("src/pages/OrdersPage.tsx")).toContain("PageLoadingOverlay");
  });

  it("⚠️⚠️ and the open-order count says '—' rather than a false 0 while it lands", () => {
    // Inventory no longer waits for that read, so "not counted yet" is now the
    // common case. A 0 would tell a rep nothing is on order for a SKU that has
    // forty — the one direction this column must not be wrong in.
    const view = src("src/components/orders/SkuTrackerView.tsx");
    expect(view).toMatch(/ordersLoading\s*\?\s*"—"\s*:\s*n/);
    expect(src("src/pages/OrdersPage.tsx")).toMatch(/ordersLoading=\{initialLoading\}/);
  });

  it("the prop defaults to false, so every other caller is unchanged", () => {
    expect(src("src/components/orders/SkuTrackerView.tsx")).toContain("ordersLoading = false");
  });
});
