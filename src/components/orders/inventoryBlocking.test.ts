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
    expect(page).toMatch(/<PageLoadingOverlay\s+show=\{view === "orders" && initialLoading/);
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

/**
 * ⚠️⚠️ **AND AN ORDER A REP DEEP-LINKED TO MUST NOT WAIT FOR THE LIST EITHER.**
 *
 * Josh, 2026-09-23, with a screenshot of the order fully drawn underneath a
 * "Loading orders…" overlay: *"this takes 14 seconds to load and i can see it
 * has the patient info via hyper link"*.
 *
 * Two reads run in parallel on `/orders?orderId=X`. The DETAIL is one item and
 * lands in about a second; the LIST is ~1,480 rows over three sequential pages
 * at Monday's 500 cap — cursor pagination, so the pages cannot be parallelised
 * and it is simply slow. Blocking on the second to show the first spent
 * thirteen seconds on a read the rep did not come for.
 *
 * Scanned rather than trusted, for `inventoryBlocking`'s own reason: the
 * failure is a *working* page you cannot click, and its only symptom is a wait.
 */
describe("a deep-linked order paints as soon as ITS read lands", () => {
  it("⚠️⚠️ the overlay stands down once an order is selected", () => {
    expect(src("src/pages/OrdersPage.tsx")).toMatch(
      /<PageLoadingOverlay\s+show=\{view === "orders" && initialLoading && !selectedId\}/,
    );
  });

  it("⚠️ the LANDING keeps it — the overview's counts need the whole board", () => {
    // `fetchOrders` throws rather than return the pages it got, for the same
    // reason: a partial list would render those counts as facts.
    const page = src("src/pages/OrdersPage.tsx");
    expect(page).toContain("initialLoading && !selectedId");
    expect(page, "the overlay was removed outright").toContain("<PageLoadingOverlay");
  });

  it("⚠️ a session-cached list is not blocked on at all", () => {
    // `initialLoading` used to mean "this mount's first fetch has not landed",
    // which was true for 14s even when `lastList` had already painted the
    // sidebar. It means "there is nothing to show" now.
    expect(src("src/hooks/orders/useOrders.ts")).toContain(
      "useState(lastList === null)",
    );
    expect(src("src/hooks/orders/useOrders.ts"), "back to blocking a cached list").not.toMatch(
      /const \[initialLoading, setInitialLoading\] = useState\(true\)/,
    );
  });

  it("⚠️ the header says the list is still arriving, with the row count", () => {
    // Josh: "show a loading icon in upper right until it's all there". With
    // the overlay gone this is the only thing saying the sidebar, the siblings
    // strip and Inventory's open-order counts are still filling in.
    const page = src("src/pages/OrdersPage.tsx");
    expect(page).toMatch(/\(initialLoading \|\| loading\) && \(/);
    expect(page).toContain("Loading orders… ${loadedRows.toLocaleString()}");
  });

  it("⚠️⚠️ and 'First Order' is withheld until there is something to check it against", () => {
    // The column is not maintained per item (§5.35), so the claim is only
    // suppressible once the patient's OTHER orders are known. With an empty
    // list it would print and then be taken back.
    expect(src("src/pages/OrdersPage.tsx")).toContain("ordersLoaded={!initialLoading}");
    const card = src("src/components/orders/OrderHeaderCard.tsx");
    expect(card).toMatch(/ordersLoaded \|\| !\/\^first order\$\/i\.test\(typeWord\)/);
    expect(card, "the prop must default to true so every other caller is unchanged").toContain(
      "ordersLoaded = true",
    );
  });
});
