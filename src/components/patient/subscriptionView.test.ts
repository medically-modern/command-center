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
    // The group is not the stage on that board and the API status is (§5.35),
    // so a local reading of the status columns would disagree with the page a
    // row opens. From pixel-match Phase 2 the pill words live in
    // `lib/patient/orderCard.ts`, which may only turn the slice's answer into
    // Brandon's vocabulary.
    const rules = src("src/lib/patient/orderCard.ts");
    expect(rules).toMatch(/from "@\/lib\/orders\/workflow"/);
    expect(rules).toContain("orderStage(o)");
    expect(rules).toContain("cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage)");
    const card = src("src/components/patient/PatientOrderCard.tsx");
    expect(card).toMatch(/orderLines\(o\)/);
    expect(card).toMatch(/orderTimeline\(o\)/);
    const view = src("src/components/patient/SubscriptionView.tsx");
    expect(view).toMatch(/orderLines\(o\)/);
    expect(view).toMatch(/<PillView pill=\{orderPill\(o\)\} \/>/);
    // ⚠️ No file on this screen reads a status column itself.
    for (const text of [rules, card, view]) {
      expect(text).not.toMatch(/apiStatus\s*(===|!==|\.toLowerCase|\.includes|\.match)/);
      expect(text).not.toMatch(/\.test\(\s*o\.(apiStatus|orderStatus)/);
    }
  });

  it("⚠️⚠️ the selected order is drawn from the FULL read, never a history row", () => {
    // A history row is LIST columns (§5.25): the signed-by, the substitution
    // and the ship-to it did not ask for read "", the same as a blank cell.
    const view = src("src/components/patient/SubscriptionView.tsx");
    expect(view).toContain("usePatientOrderDetail(selRow?.id ?? null)");
    expect(view).toMatch(/detail\.order && detail\.order\.id === selRow\.id \? detail\.order : null/);
    expect(view).toMatch(/<PatientOrderCard key=\{full\.id\} order=\{full\}/);
    expect(view).not.toMatch(/<PatientOrderCard[^>]*order=\{selRow\}/);
  });

  it("⚠️ rows are marked PARTIAL — a list row must never render as an open order", () => {
    // §5.25: the list read carries a subset of columns, so every column it did
    // not ask for is "", which is indistinguishable from a blank board cell.
    expect(src("src/components/patient/SubscriptionView.tsx")).toContain("partial: true");
  });
});

describe("⚠️⚠️ Brandon's grid replaces the snapshot cards — nothing is drawn twice", () => {
  /* Pixel-match, 2026-09-24 (items 5–13). His cards carry every fact the five
     SUBSCRIPTION snapshot sections did, so the snapshot cards are gone rather
     than filtered — a fact editable in one card and read-only in another, on
     one screen, is worse than either alone (§5.45b). */
  const tab = () => {
    const view = src("src/components/patient/SubscriptionView.tsx");
    const start = view.indexOf("function ProfileTab(");
    return view.slice(start, view.indexOf("\nfunction ", start + 1));
  };

  it("the Profile tab draws no stageDetail snapshot card", () => {
    expect(tab()).not.toMatch(/buildStageDetail|snapcard|rogrid/);
  });

  it("his grid, in his order: Send bar on top → overview → [Demographics | Insurance | MN & Auth] → [Order details | Doctor | Financials] → notes", () => {
    const t = tab();
    const order = [
      "<SendBar",
      "<OverviewStrip",
      '<div className="grid3 mnrow">',
      "<DemographicsCard",
      "<InsuranceCard",
      "<MnAuthCard",
      '<div className="grid3">',
      "<OrderDetailsCard",
      "<DoctorCard",
      "<FinancialsCard",
      "<SubscriptionNotesCard",
    ];
    let at = -1;
    for (const piece of order) {
      const i = t.indexOf(piece);
      expect(i, `${piece} missing or out of order`).toBeGreaterThan(at);
      at = i;
    }
  });

  it("⚠️ the old footer line and the separate Contacts card are gone (items 7 and 13)", () => {
    const view = src("src/components/patient/SubscriptionView.tsx");
    expect(view).not.toContain("on Update Clinicals, which writes the Medical Records status");
    expect(view).not.toMatch(/function ContactsCard/);
  });
});

describe("⚠️⚠️ SAME options as before — visuals only (Josh, 2026-09-24)", () => {
  /* *"its so so critical that we are just changing the visuals and not the
     backend or label options"*. Each select offers exactly the list the app
     offered for that column before; the mockup's invented lists (plan §2.7) are
     never used. */
  const cards = () => src("src/components/patient/SubscriptionCards.tsx");

  it("the order selects use the SAME lists SubscriptionForm uses", () => {
    const form = src("src/components/subscription/SubscriptionForm.tsx");
    const c = cards();
    for (const list of ["SUBSCRIPTION_OPTIONS", "SENSORS_TYPE_OPTIONS", "SUPPLIES_TYPE_OPTIONS"]) {
      expect(form, `${list} left SubscriptionForm`).toContain(list);
      expect(c, `${list} is not what the card offers`).toContain(`options={${list}}`);
    }
    // The infusion sets are read LIVE, as SubscriptionForm reads them.
    expect(src("src/components/patient/SubscriptionView.tsx")).toContain(
      "useStatusOptions(BOARD_ID, [COL.infusionSet1, COL.infusionSet2])",
    );
  });

  it("insurance and the doctor's method use the SAME sources PatientInfoCard uses", () => {
    const c = cards();
    expect(c).toContain('usePayerOptions("subscription")');
    expect(c).toContain("PRIMARY_INSURANCE_OPTIONS");
    expect(c).toContain("options={SECONDARY_INSURANCE_OPTIONS}");
    expect(c).toContain("options={FAX_PARACHUTE_OPTIONS}");
  });

  it("⚠️ none of the mockup's invented options appear anywhere", () => {
    const c = cards();
    for (const fake of ["Pump & Sensors", "Omnipod 5", "t:slim X2", "AutoSoft XC 6 mm 23"]) {
      expect(c, `mockup option "${fake}" leaked in`).not.toContain(fake);
    }
  });

  it("the Subscription status columns Brandon adds are read LIVE — never a hardcoded id", () => {
    const view = src("src/components/patient/SubscriptionView.tsx");
    expect(view).toMatch(/EXTRA_COL\.orderFrequency,\s*EXTRA_COL\.primaryContact,\s*EXTRA_COL\.alternateContact/);
  });
});

describe("⚠️⚠️ the send is built on a record read AT THE PRESS, never the one the tab opened with", () => {
  // The Subscription send writes every board-mirrored column the record holds
  // (Next Order, Order Type, the sets and quantities, auth ids, Doctor, NPI…),
  // and `merged` is whatever this tab read when it opened — hours earlier, on a
  // screen a rep leaves up. Sending it put that morning's values back over
  // anything written since, with a green toast (2026-09-23).
  const handleSend = () => {
    const view = src("src/components/patient/SubscriptionView.tsx");
    const start = view.indexOf("const handleSend = useCallback(");
    return view.slice(start, view.indexOf("}, [", start));
  };

  it("re-reads the board first, and lays only the rep's edits over it", () => {
    expect(handleSend()).toMatch(/\{\s*\.\.\.\(await readFresh\(\)\),\s*\.\.\.edits\s*\}/);
  });

  it("never sends `merged`", () => {
    expect(handleSend(), "the send went back to the record the tab opened with").not.toMatch(
      /sendPatientToMonday\(\s*merged/,
    );
  });

  it("validates what will actually go, not what was on screen", () => {
    expect(handleSend()).toMatch(/validatePatientForSend\(toSend\)/);
  });
});

describe("⚠️ the patient screen's Send is the /subscription page's SAME button, not a second one", () => {
  // Every state and the validation list live in that one component — a
  // hand-rolled Save in this file would be a second send affordance to keep in
  // step with the real one. (It had a small `compact` size for the bar that
  // used to sit ABOVE the form; the Send moved to the bottom on 2026-09-23 and
  // the size went with it, rather than staying behind as a prop nobody passes.)
  const btn = () => src("src/components/subscription/SendToMondayButton.tsx");
  const view = () => src("src/components/patient/SubscriptionView.tsx");

  it("⚠️ the validation list is in the component — a disabled Save must say why", () => {
    // §5.31b: a greyed-out control with no stated reason is the dead end this
    // codebase records reversing.
    expect(btn()).toContain("Required before sending:");
  });

  it("the patient screen renders it exactly ONCE, and builds no Save of its own", () => {
    const text = view();
    expect(text).toMatch(/from "@\/components\/subscription\/SendToMondayButton"/);
    expect(text.match(/<SendToMondayButton\b/g), "a second Send appeared").toHaveLength(1);
    expect(text, "a hand-rolled Save appeared").not.toMatch(/btn primary[^"]*"[^>]*onClick=\{(handleSend|onSend)/);
  });

  it("⚠️⚠️ and it sits in the bar at the TOP of the tab, before the cards (Josh, 2026-09-25 — blue Save)", () => {
    const text = view();
    const start = text.indexOf("function ProfileTab(");
    const tab = text.slice(start, text.indexOf("\nfunction ", start + 1));
    const overview = tab.indexOf("<OverviewStrip");
    const bar = tab.indexOf("<SendBar");
    expect(overview, "the overview strip moved").toBeGreaterThan(-1);
    expect(bar, "the Send bar is not in the Profile tab").toBeGreaterThan(-1);
    expect(bar, "the Send bar must precede the cards").toBeLessThan(overview);
    // The bar stays on screen: sticky, at the top; and it is the blue Save.
    const css = src("src/pages/patient/redesign.css");
    expect(css).toMatch(/\.cc-pt \.sub-send \{[^}]*position: sticky;[^}]*top:/);
    expect(text).toMatch(/<SendToMondayButton\s+blue/);
  });
});


describe("⚠️ the reorder form is WIRED — the whole point of §5.46c", () => {
  /* Josh, 2026-09-22: *"fix the missing stuff, start with the reorder form
     column"*. Seven populated columns on the Subscription board were read by
     nothing in the SPA, so the failure being guarded here is exactly the one
     that hid them: a rule with a test and no caller. §5.31b's own lesson —
     *"a module nobody calls does not fail; it is absent, and its green tests
     say otherwise"*. Each of these was verified to fail with its wiring
     removed. */
  const view = () => src("src/components/patient/SubscriptionView.tsx");

  it("the columns reach the read, or every field is blank with no error", () => {
    // Without this line `item.cols` never carries them and the card renders
    // "Not sent yet" for every patient on the board (§5.11's trap).
    expect(src("src/lib/commsHub/dossierApi.ts")).toContain(
      "...reorderFormColumns(board.boardId)",
    );
  });

  it("the view builds it and hands it to the Upcoming order strip", () => {
    const text = view();
    expect(text).toMatch(/buildReorderForm\(item\.boardId, item\.cols\)/);
    expect(text).toMatch(/<UpcomingOrder facts=\{overview\} reorder=\{reorder\}/);
    expect(text).toMatch(/\{reorder && <ReorderFact form=\{reorder\} \/>\}/);
  });

  it("⚠️ the stamp is labelled by the STATE, never printed on its own", () => {
    /* "No Response" is a reset for the next cycle and the timestamp does not
       reset with it, so a bare "submitted <ts>" puts June's answer on a
       patient we are waiting on today. */
    expect(view()).toMatch(/answered \? "submitted" : "last answered"/);
  });

  it("⚠️ there is no Resend and no Send now — they would be writes", () => {
    /* The Subscription board has no trigger column for the reorder text, so
       either button here is a new integration with `reorder-patient-form`, not
       markup. Copy link is the move a rep can actually make; a greyed-out
       Resend is a control whose only stated move is impossible. */
    const text = view();
    expect(text).not.toMatch(/>\s*Resend/);
    expect(text).not.toMatch(/>\s*Send now/);
    expect(text).toContain("Copy link");
    // And the screen's founding promise still holds for this card.
    expect(text).not.toMatch(/change_column_value/);
  });
});

/**
 * ⚠️ Expected items is WIRED (§5.46d) — a module nobody calls does not fail,
 * it is absent, and its green tests say otherwise (§5.31b).
 */
describe("⚠️ Expected items is WIRED", () => {
  const view = () => src("src/components/patient/SubscriptionView.tsx");

  it("the dossier read fetches the Subscription board's product columns", () => {
    // Without this every line reads blank on every patient, with nothing
    // erroring — §5.11's trap.
    expect(src("src/lib/commsHub/dossierApi.ts")).toContain(
      "...expectedItemsColumns(board.boardId),",
    );
  });

  it("⚠️ and that list is de-duplicated, because it overlaps stageDetail's", () => {
    /* Three expected-items ids are also in stageDetail's SUBSCRIPTION map.
       Each module declares what it needs; Monday makes no promise about a
       repeated id in `column_values(ids:)`. */
    expect(src("src/lib/commsHub/dossierApi.ts")).toMatch(
      /all\.indexOf\(c\) === i/,
    );
  });

  it("the view builds the lines and hands them to the Upcoming order strip", () => {
    const text = view();
    expect(text).toMatch(/expectedItems\(item\.boardId, item\.cols\)/);
    expect(text).toMatch(/expected=\{expected\}/);
    expect(text).toMatch(/<div className="k">Expected items<\/div>/);
  });

  it("⚠️ Status leaves this strip — Brandon's four columns, not five", () => {
    /* His `upcomingOrder` is Next order · Subscription · Expected items ·
       Reorder form. Status is not lost: it is the first fact on the Profile
       tab's own overview strip, which `subscriptionOverview` still returns. */
    const text = view();
    const start = text.indexOf("function UpcomingOrder(");
    const body = text.slice(start, text.indexOf("\nfunction ", start + 1));
    const labels = [...body.matchAll(/<div className="k">([^<]+)<\/div>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Next order", "Subscription", "Expected items"]);
    expect(body).toContain("{reorder && <ReorderFact form={reorder} />}");
    expect(body).not.toMatch(/"Status"|"First order"/);
    expect(src("src/lib/patient/subscriptionOverview.ts")).toMatch(
      /label: "Status"/,
    );
  });
});
