/**
 * The Subscription view's two rules (§5.45) — the tab, and the one board read
 * it makes.
 *
 * Both are the sort that fail SILENTLY: an unrecognised `?sub=` reading as
 * "orders" puts a rep on the wrong tab with nothing erroring, and a phone
 * needle that is too short would turn a per-patient lookup into "every order in
 * the company" rendered under one patient's name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSubTab } from "./SubscriptionView";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

vi.mock("@/lib/shared/mondayEndpoint", () => ({
  MONDAY_API_URL: "https://example.invalid/gql",
  mondayAuthHeaders: () => ({}),
  mondayIdentityHeaders: () => ({}),
  hasMondayAuth: () => true,
}));

describe("parseSubTab", () => {
  it("is Profile unless the URL says orders", () => {
    expect(parseSubTab("orders")).toBe("orders");
    expect(parseSubTab("profile")).toBe("profile");
  });

  it("⚠️ an unrecognised value is the DEFAULT, never a third state", () => {
    // The rule every query param in this app follows (§5.20 `networkAnswer`).
    for (const raw of [null, "", "Orders", "ORDERS", "nonsense", "1"]) {
      expect(parseSubTab(raw)).toBe("profile");
    }
  });
});

describe("fetchOrdersForPatient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const load = async () => (await import("@/lib/orders/mondayApi")).fetchOrdersForPatient;

  it("⚠️⚠️ FAILS CLOSED below ten digits — and never touches the network", async () => {
    // An unfiltered read of the order board renders ~1,500 orders under one
    // patient's name, which reads as that patient's history. Returning nothing
    // is the only safe answer to "we cannot tell which orders are theirs".
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const fetchOrders = await load();
    for (const bad of ["", "555", "555-0100", "abcdefghij", "12345"]) {
      expect(await fetchOrders(bad)).toEqual([]);
    }
    expect(fetchSpy, "a short needle still queried Monday").not.toHaveBeenCalled();
  });

  it("asks on the LAST TEN digits, so +1 and a bare number are one patient", async () => {
    // Boards store both shapes (§5.28), and `contains_text` is a contiguous
    // substring — the last ten are what every rendering shares.
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(String(init.body));
      return {
        ok: true,
        json: async () => ({ data: { boards: [{ items_page: { items: [{ id: "1" }] } }] } }),
      } as Response;
    }));
    const fetchOrders = await load();
    expect(await fetchOrders("+1 (555) 555-0100")).toHaveLength(1);
    expect(seen[0]).toContain("5555550100");
    expect(seen[0], "the +1 rode into the needle").not.toContain("15555550100");
  });
});

describe("⚠️ the view reads the ORDERS page's own rules, never a second copy", () => {
  it("stage and lines come from the shared modules", () => {
    const text = src("src/components/patient/SubscriptionView.tsx");
    // The group is not the stage on that board and the API status is (§5.35),
    // so a local reading of the status columns would disagree with the page a
    // row opens.
    expect(text).toMatch(/from "@\/lib\/orders\/workflow"/);
    expect(text).toContain("orderStage(o)");
    expect(text).toMatch(/orderLines/);
    expect(text).toMatch(/StagePill/);
  });

  it("⚠️ rows are marked PARTIAL — a list row must never render as an open order", () => {
    // §5.25: the list read carries a subset of columns, so every column it did
    // not ask for is "", which is indistinguishable from a blank board cell.
    expect(src("src/components/patient/SubscriptionView.tsx")).toContain("partial: true");
  });
});
