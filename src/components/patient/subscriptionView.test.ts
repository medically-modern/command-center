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
import { FORM_SECTIONS, parseSubTab } from "./SubscriptionView";
import { STAGE_DETAIL } from "@/lib/commsHub/stageDetail";

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

describe("⚠️⚠️ the form-owned sections are matched by TITLE, so the titles must exist", () => {
  // `ProfileTab` hides exactly these two snapshot cards while the form is on
  // screen, because the form renders the same facts as inputs. It matches on
  // the section TITLE, which is a string in another file — rename one there and
  // this filter silently stops matching, so the patient's Next order shows
  // TWICE, once editable and once not, with nothing erroring.
  const SUBSCRIPTION_BOARD = 18407459988;

  it("every FORM_SECTIONS title is a live section of the Subscription map", () => {
    const titles = STAGE_DETAIL[SUBSCRIPTION_BOARD].map((s) => s.title);
    for (const t of FORM_SECTIONS) {
      expect(titles, `"${t}" is no longer a section — the filter matches nothing`).toContain(t);
    }
  });

  it("and the filter really is the thing that hides them", () => {
    const text = src("src/components/patient/SubscriptionView.tsx");
    expect(text).toMatch(/FORM_SECTIONS\.includes\(sc\.title\)/);
    /* ⚠️ UNCONDITIONAL from 2026-09-22 (§5.46b). The form renders for
       everybody now — inert without the ability — so a `canEdit ?` here would
       double-render its fields for exactly the people who cannot correct
       them: once as a greyed input and once as a read-only row. */
    expect(text).toMatch(/const cards = sections\.filter/);
    expect(text, "the filter went back to being conditional").not.toMatch(/canEdit \? rest\.filter/);
  });
});

describe("⚠️ the compact Send is the SAME button, not a second one", () => {
  // The patient screen carries the send inside a one-line bar, so the shared
  // component grew a `compact` size. Every state and the validation list stay
  // in that one component — a hand-rolled small Save in this file would be a
  // second send affordance to keep in step with the real one.
  const btn = () => src("src/components/subscription/SendToMondayButton.tsx");

  it("is opt-in, so /subscription is byte-identical without it", () => {
    expect(btn()).toContain("compact = false");
    // The page that has always had it must not have started passing it.
    expect(src("src/pages/SubscriptionPage.tsx")).not.toMatch(/SendToMondayButton[^>]*compact/);
  });

  it("⚠️ compact keeps the validation list — a disabled Save must say why", () => {
    // §5.31b: a greyed-out control with no stated reason is the dead end this
    // codebase records reversing. The list is outside every size branch.
    const text = btn();
    expect(text).toContain("Required before sending:");
    expect(text, "the list moved inside a size branch").not.toMatch(/compact[^)]*Required before sending/);
  });

  it("the patient screen passes it, and does not build its own", () => {
    const view = src("src/components/patient/SubscriptionView.tsx");
    expect(view).toMatch(/<SendToMondayButton\s+compact/);
    expect(view, "a second Save appeared").not.toMatch(/btn primary[^"]*"[^>]*onClick=\{handleSend/);
  });
});

