/**
 * The tracker → `StockRow` mapping. The rules that consume these rows are
 * tested in `infusionStock.test.ts`; what is tested here is the one decision
 * the MAPPING makes, because getting it wrong is silent and points the wrong
 * way: a blank quantity read as 0 makes `stockVerdict` say "Out of stock" in
 * red about a set Cardinal can ship.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ authOk: true }));

vi.mock("@/lib/shared/mondayEndpoint", () => ({
  MONDAY_API_URL: "https://example.invalid/gql",
  mondayIdentityHeaders: () => ({}),
  hasMondayAuth: () => h.authOk,
}));

import { fetchInfusionStock, STOCK_COL } from "./stockApi";
import { indexStock, stockVerdict } from "./infusionStock";

function reply(items: { name: string; qty: string; status: string; changed: string }[]) {
  return vi.fn().mockResolvedValue({
    json: async () => ({
      data: {
        boards: [
          {
            items_page: {
              items: items.map((i) => ({
                name: i.name,
                column_values: [
                  { id: STOCK_COL.qtyAvail, text: i.qty },
                  { id: STOCK_COL.status, text: i.status },
                  { id: STOCK_COL.lastChanged, text: i.changed },
                ],
              })),
            },
          },
        ],
      },
    }),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  h.authOk = true;
});

describe("fetchInfusionStock", () => {
  it("maps a real row", async () => {
    vi.stubGlobal(
      "fetch",
      reply([
        { name: 'AutoSoft XC 6 mm 23"', qty: "1715", status: "Available", changed: "2026-09-09 09:05 ET" },
      ]),
    );
    const rows = await fetchInfusionStock();
    expect(rows[0]).toEqual({
      name: 'AutoSoft XC 6 mm 23"',
      qtyAvail: 1715,
      status: "Available",
      lastChanged: "2026-09-09 09:05 ET",
    });
  });

  /* ⚠️ The tracker's own header row ("Last run: … — 34 changed") carries a
     blank quantity, and so would any row the scraper hasn't filled. Null lets
     the STATUS column decide; 0 would invent a shortage. */
  it("reads a blank quantity as null, never 0", async () => {
    vi.stubGlobal(
      "fetch",
      reply([{ name: "Last run: 2026-09-09 09:05 ET (cron)", qty: "", status: "", changed: "" }]),
    );
    const rows = await fetchInfusionStock();
    expect(rows[0].qtyAvail).toBeNull();
  });

  it("reads an unparseable quantity as null too", async () => {
    vi.stubGlobal(
      "fetch",
      reply([{ name: "x", qty: "n/a", status: "Available", changed: "2026-09-09 09:05 ET" }]),
    );
    expect((await fetchInfusionStock())[0].qtyAvail).toBeNull();
  });

  /* The mapping and the rules have to agree, or the null above just moves the
     bug one file along: a null on an Available row must not render red. */
  it("a null quantity on an Available row does not read as out of stock", async () => {
    vi.stubGlobal(
      "fetch",
      reply([{ name: 'Inset 6 mm 23"', qty: "", status: "Available", changed: "2026-09-09 09:05 ET" }]),
    );
    const v = stockVerdict('Inset 6 mm 23"', indexStock(await fetchInfusionStock()), "2026-09-09");
    expect(v.tone).not.toBe("green");
    expect(v.label).not.toBe("Out of stock");
  });

  /* A 200 carrying errors[] is this app's most common silent failure (§5.2).
     Throwing is what keeps the hook from caching an empty index, which would
     read as "No stock data" on every set — a working feature reporting bad
     news. */
  it("throws on a 200 that carries GraphQL errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ errors: [{ message: "Complexity budget exhausted" }] }),
      }),
    );
    await expect(fetchInfusionStock()).rejects.toThrow(/Complexity budget/);
  });
});

describe("no Monday auth", () => {
  /* ⚠️ This must REJECT, not resolve to []. An empty array indexes to a
     non-null empty Map, and `stockVerdict` answers "No stock data" off one of
     those — so a build with no auth would render a confident negative on every
     infusion set instead of hiding the feature, which is precisely what
     `useInfusionStock`'s header says must not happen. The first cut returned []
     and walked into it (Greptile, PR #55). Rejecting leaves the hook's index
     null, which is what keeps the pills silent. */
  it("rejects rather than reporting an empty board", async () => {
    h.authOk = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchInfusionStock()).rejects.toThrow(/auth/i);
    // And it never reaches the network to find that out.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an empty board is still a legitimate empty answer", async () => {
    // The distinction only holds if a real, authenticated read of an empty
    // board can still resolve — otherwise this is just "throw on empty".
    vi.stubGlobal("fetch", reply([]));
    await expect(fetchInfusionStock()).resolves.toEqual([]);
  });
});
